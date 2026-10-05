// The Review detail for a video the person brought in as a file (OWN-02 to OWN-04): the file's own
// facts, their transcript and notes, and YAP's answers from those words. Each suggestion in an answer
// has one action, Try this, which saves it as the lesson carried into the next take.
// Every line is written with textContent.
import { wireNav } from '../lib/app.js';
import { getMemory, saveMemory } from '../lib/api.js';
import { openMediaStore, attachCreatorEvidence } from '../../src/engine/video-import.js';
import {
  REVIEW_LIMITS, buildReviewRequest, checkReviewReply, answerFromWords, makeTurn, appendTurn as appendOwnTurn, readReview,
  savedWords, textStamp, clock,
} from '../../src/engine/review-own.js';
import { askModel, isAsking, mountLessonAction } from '../lib/review-own.js';
import { lessonStore, carriesLesson } from '../lib/return-model.js';
import { mountTrying } from '../lib/carried-lesson.js';


let body, errorLine;
const $ = (testid) => document.querySelector(`[data-testid="${testid}"]`);

/** An element with a hook and its words. */
function el(tag, text, hook, className) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (hook) n.dataset.testid = hook;
  if (className) n.className = className;
  return n;
}
function button(label, hook, action, className) {
  const b = el('button', label, hook, className);
  b.type = 'button';
  b.addEventListener('click', guard(action));
  return b;
}
function guard(action) {
  return async () => {
    try {
      errorLine.textContent = '';
      await action();
    } catch (e) {
      errorLine.textContent = e && e.message ? e.message : 'Something went wrong.';
    }
  };
}

function mediaLine(player, record) {
  const v = record.video;
  return `${v.name} · ${v.duration.toFixed(2)} seconds · kept on this machine, in this browser, and not uploaded.`;
}

const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
const dateOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const CHIPS = ['What is the main point of this video?', 'Which of my notes should I fix first?', 'How could I say my opening differently?'];

async function ownVideo(id) {
  document.querySelector('.detail').classList.add('own');
  let mediaStore;
  let record;
  try {
    mediaStore = await openMediaStore();
    record = await mediaStore.get(id);
  } catch (e) {
    $('detail-title').textContent = 'Video unavailable';
    body.replaceChildren(el('p', 'This browser is not letting YAP use local storage (a private window or blocked storage can do this), so an imported video cannot be opened here. Nothing was lost.', 'storage-unavailable'));
    errorLine.textContent = e.message;
    return;
  }
  if (!record || !record.file) {
    $('detail-title').textContent = 'Video not found';
    body.replaceChildren(el('p', 'This video is not kept in this browser. Videos are kept only in the browser profile and address they were added at.', 'not-found'));
    return;
  }
  if (!record.video || typeof record.video !== 'object' || !(record.video.duration > 0)) {
    $('detail-title').textContent = 'Video unreadable';
    body.replaceChildren(el('p', 'The details kept for this video could not be read. Add the file again from the Review inbox; nothing was changed.', 'record-unreadable'));
    return;
  }
  const v0 = record.video;
  $('detail-title').textContent = v0.title;
  $('detail-title').classList.toggle('long', String(v0.title).length > 60);
  const lede = $('detail-lede');
  lede.textContent = 'Imported video. Ask about your own words, and keep what you decide to try next.';
  lede.hidden = false;

  // ---- the player ----
  const player = el('video', null, 'player');
  player.controls = true;
  player.playsInline = true;
  player.preload = 'metadata';
  const objectUrl = URL.createObjectURL(record.file);
  player.src = `${objectUrl}#t=0.1`;
  addEventListener('pagehide', () => URL.revokeObjectURL(objectUrl));
  let pendingSeek = null;
  player.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      player.currentTime = Math.min(pendingSeek, player.duration);
      pendingSeek = null;
    }
  });
  const playerError = el('p', null, 'player-error', 'fine');
  player.addEventListener('error', () => {
    playerError.textContent = 'This browser cannot play this video\'s picture or sound. Your words about it still work.';
  });
  const seekTo = (seconds) => {
    const to = Math.max(0, Number.isFinite(player.duration) ? Math.min(seconds, player.duration) : seconds);
    if (player.readyState >= 1) player.currentTime = to;
    else pendingSeek = to;
    frame.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const frame = el('div', null, null, 'frame');
  frame.append(player);
  const line = el('p', mediaLine(player, record), 'storage-line', 'fine');

  // ---- what is true of the file ----
  const facts = el('section', null, 'facts', 'facts');
  facts.setAttribute('aria-label', 'About this video');


  // ---- the creator's own words ----
  const transcript = el('textarea', null, 'creator-transcript');
  transcript.rows = 4;
  transcript.maxLength = 100000;
  transcript.id = 'creator-transcript-field';
  transcript.placeholder = 'Paste the transcript of this video';
  transcript.value = v0.transcript && v0.transcript.sourceType === 'creator-supplied' ? v0.transcript.text : '';
  const note = el('textarea', null, 'creator-note');
  note.rows = 2;
  note.maxLength = 5000;
  note.id = 'creator-note-field';
  note.placeholder = 'A note about one moment';
  const time = el('input', null, 'creator-time');
  time.type = 'number';
  time.min = '0';
  time.step = '0.01';
  time.value = '0';
  time.id = 'creator-time-field';
  time.placeholder = 'Seconds into the video';
  const labelFor = (text, field) => { const l = el('label', text, null, 'fine field-label'); l.htmlFor = field.id; return l; };
  const status = el('p', null, 'creator-status', 'fine');
  const savedTranscript = el('div', null, 'creator-saved-transcript');
  const moments = el('div', null, 'creator-saved', 'moments');
  const unsaved = el('p', null, 'words-unsaved', 'fine');
  const savedOf = (r) => savedWords(r.video);
  const checkUnsaved = () => {
    const saved = savedOf(record).transcript;
    unsaved.textContent = transcript.value.trim() !== saved ? 'Your transcript box has changes that are not saved yet. Ask YAP only uses what is saved.' : '';
  };
  transcript.addEventListener('input', checkUnsaved);

  const renderWords = () => {
    const w = savedOf(record);
    savedTranscript.replaceChildren();
    if (w.transcript) {
      savedTranscript.append(el('p', 'Transcript, written by you:', null, 'fine'), el('p', record.video.transcript.text, 'saved-transcript', 'saved-transcript'));
    }
    moments.replaceChildren();
    const notes = record.video.notes || [];
    if (!notes.length) moments.append(el('p', 'No moments yet. Save a note at a second in the video and it appears here, ready to jump to.', 'no-moments', 'fine'));
    [...notes].sort((a, b) => a.time - b.time).forEach((n) => {
      const item = el('div', null, 'saved-note', 'moment');
      const jump = button(clock(n.time), 'note-seek', () => seekTo(n.time), 'seek');
      jump.setAttribute('aria-label', `Jump the video to ${n.time} seconds`);
      item.append(jump, el('p', `Note at ${n.time} s, written by you: ${n.text}`));
      moments.append(item);
    });
    checkUnsaved();
  };
  const renderFacts = () => {
    const v = record.video;
    const w = savedOf(record);
    const card = (hook, label, value, tag) => {
      const c = el('div', null, hook, 'fact');
      c.append(el('span', label, null, 'm-label'), el('span', value, null, 'm-value'), el('span', tag, null, 'm-tag'));
      return c;
    };
    facts.replaceChildren(
      card('fact-length', 'Length', clock(v.duration), 'from the file'),
      card('fact-picture', 'Picture', v.width && v.height ? `${v.width}×${v.height}` : 'unknown', 'from the file'),
      card('fact-size', 'File size', formatBytes(v.size || record.file.size), 'from the file'),
      card('fact-words', 'Your transcript', w.transcript ? `${wordCount(w.transcript).toLocaleString('en-GB')} words` : 'none yet', 'written by you'),
      card('fact-notes', 'Your notes', String(w.notes.length), 'written by you')
    );
  };

  // ---- commit: always on the newest stored record ----
  let transient = [];
  const commit = async (mutator) => {
    record = await mediaStore.update(id, mutator);
    renderAll();
    return record;
  };

  const words = el('section', null, 'creator', 'words');
  const nowBtn = button('Use current time', 'creator-time-now', () => {
    time.value = String(Math.round(Math.min(player.currentTime || 0, player.duration || Infinity) * 100) / 100);
  });
  const timeRow = el('div', null, null, 'row time-row');
  timeRow.append(time, nowBtn);
  words.append(
    el('h2', 'Your own words'),
    el('p', 'Paste a transcript or add a note at a time in the video. Both are kept with this video.', null, 'fine'),
    labelFor('Transcript', transcript), transcript, unsaved,
    labelFor('Note', note), note, labelFor('At second', time), timeRow,
    button('Save my words', 'save-creator', async () => {
      const text = transcript.value;
      const noteText = note.value;
      const at = Number(time.value);
      if (!text.trim() && !noteText.trim()) throw new Error('Write a transcript or a note first.');
      status.textContent = '';
      await commit((rec) => ({ ...rec, video: attachCreatorEvidence(rec.video, { transcript: text, note: noteText, time: at }) }));
      const kept = await mediaStore.get(id);
      const k = kept && kept.video ? savedWords(kept.video) : { transcript: '', notes: [] };
      const noteKept = !noteText.trim() || k.notes.some((n) => n.text === noteText.trim() && n.time === at);
      if (!kept || (text.trim() && k.transcript !== text.trim()) || !noteKept) throw new Error('Your words could not be kept. Nothing was saved.');
      note.value = '';
      status.textContent = 'Saved on this machine with this video.';
    }, 'primary'),
    status
  );
  const wordsAndMoments = el('section', null, 'saved-words', 'panel saved-words');
  wordsAndMoments.append(el('h2', 'Key moments'), moments, savedTranscript);

  // ---- the assistant ----
  const thread = el('div', null, 'ask-thread', 'thread');
  thread.setAttribute('aria-live', 'polite');
  const input = el('input', null, 'ask-input');
  input.type = 'text';
  input.maxLength = REVIEW_LIMITS.questionChars;
  input.placeholder = 'For example: what is the main point?';
  input.setAttribute('aria-label', 'Ask anything about this video');
  const askStatus = el('p', null, 'ask-status', 'fine');
  askStatus.setAttribute('role', 'status');
  const send = el('button', '➤', 'ask-send', 'send');
  send.type = 'button';
  send.setAttribute('aria-label', 'Ask');
  const notice = el('p', null, 'review-notice', 'fine');
  const disclosure = el('p', 'Pressing Ask sends your saved transcript, your saved notes and this question to the model set up on this machine. The video itself is never sent.', 'ask-disclosure', 'fine');
  const composer = el('div', null, null, 'composer');
  composer.append(input, send);
  const chips = el('div', null, 'ask-chips', 'chips');
  CHIPS.forEach((c) => {
    const b = button(c, 'ask-chip', () => { input.value = c; input.focus(); }, 'chip');
    chips.append(b);
  });
  const assistant = el('section', null, 'assistant', 'assistant');
  const aHead = el('div', null, null, 'a-head');
  aHead.append(el('h2', '✦ YAP assistant', null, 'a-title'));
  const aFoot = el('div', null, null, 'a-foot');
  aFoot.append(el('label', 'Ask anything about this video', null, 'fine field-label'), composer, askStatus, disclosure);
  assistant.append(aHead, notice, thread, chips, aFoot);

  // ---- the lesson carried into the next take ----
  const lessons = lessonStore({ sample: false, getMemory, saveMemory });
  const lessonBox = el('section', null, 'lesson-box', 'panel lesson-box');
  const lessonSlot = el('div', null, 'lesson-slot');
  const lessonNone = el('p', 'Press Try this on a suggestion and it shows before your next take.', 'no-lesson', 'fine');
  lessonBox.append(lessonSlot, lessonNone);
  const tryingShown = () => { lessonNone.hidden = Boolean(lessonSlot.querySelector('[data-testid="trying"]')); };
  const renderLesson = async () => {
    await mountTrying(lessonSlot, { onChange: () => { renderThread(); tryingShown(); } }).catch(() => undefined);
    tryingShown();
  };
  function lessonChanged() {
    renderThread();
    renderLesson();
  }

  const nowIso = () => new Date().toISOString();
  const run = (fn) => guard(fn)();

  const turnCard = (t, { isTransient } = {}) => {
    const card = el('article', null, 'turn', 'turn-card');
    card.dataset.turn = t.id;
    card.append(el('p', t.question, 'turn-question', 'bubble'));
    const a = el('div', null, 'turn-answer', 'answer');
    const b = t.basis;
    const based = `${b.notesSent} of ${b.notesTotal} note${b.notesTotal === 1 ? '' : 's'}${b.truncated ? `, first ${b.sentChars.toLocaleString('en-GB')} of ${b.transcriptChars.toLocaleString('en-GB')} transcript characters` : ''}`;
    a.append(el('p', `From your transcript and ${based}.`, 'turn-source', 'fine'));
    a.append(el('p', t.answer.text, 'turn-text', 'a-text'));
    if (t.answer.quotes.length) {
      a.append(el('p', 'From your words:', null, 'fine'));
      t.answer.quotes.forEach((q) => a.append(el('blockquote', q.text, 'turn-quote')));
    }
    if (t.answer.droppedQuotes) a.append(el('p', `${t.answer.droppedQuotes} quoted passage${t.answer.droppedQuotes === 1 ? '' : 's'} could not be found in your words and ${t.answer.droppedQuotes === 1 ? 'was' : 'were'} left out.`, 'turn-dropped', 'fine'));
    if (t.answer.hypotheses.length) {
      a.append(el('p', 'Worth testing:', null, 'fine'));
      const ul = el('ul', null, 'turn-hypotheses');
      t.answer.hypotheses.forEach((h) => ul.append(el('li', h)));
      a.append(ul);
    }
    const saved = savedWords(record.video);
    if (t.basis.transcriptStamp && saved.transcript && textStamp(saved.transcript) !== t.basis.transcriptStamp) {
      a.append(el('p', 'Your transcript has changed since this answer.', 'turn-stale', 'fine'));
    }
    if (isTransient) {
      a.append(el('p', 'Not saved: this answer could not be kept on this machine, so it will not be here after a reload.', 'turn-unsaved', 'fine'));
    } else if (t.answer.suggestion) {
      const next = el('div', null, 'turn-next', 'try-next');
      const action = el('div', null, 'lesson-action');
      next.append(el('p', 'Try next', null, 'try-label'), el('p', t.answer.suggestion, 'turn-suggestion', 'try-text'), action);
      a.append(next);
      mountLessonAction(action, { store: lessons, lesson: { text: t.answer.suggestion, source: { id, title: record.video.title } }, carries: carriesLesson, onChange: lessonChanged });
    }
    card.append(a);
    return card;
  };

  const renderThread = () => {
    const { review, corrupt, skipped } = readReview(record);
    notice.textContent = corrupt
      ? 'The conversations saved on this video could not be read, so they are not shown. They are set aside, not erased. Your transcript and notes are unaffected.'
      : skipped ? `${skipped} saved item${skipped === 1 ? '' : 's'} on this video could not be read and ${skipped === 1 ? 'is' : 'are'} not shown.` : '';
    notice.hidden = !notice.textContent;
    thread.replaceChildren();
    if (!review.turns.length && !transient.length) {
      thread.append(el('p', savedOf(record).transcript ? 'Ask about what you said in this video.' : 'Paste your transcript under Your own words and save it. Then ask YAP about it.', 'ask-empty', 'fine'));
    }
    review.turns.forEach((t) => thread.append(turnCard(t)));
    transient.forEach((t) => thread.append(turnCard(t, { isTransient: true })));
    chips.hidden = review.turns.length > 0 || transient.length > 0;
  };

  function renderAll() {
    renderFacts();
    renderWords();
    renderThread();
    renderLesson();
  }

  // ---- Ask ----
  const asking = (on) => {
    send.disabled = on;
    send.setAttribute('aria-busy', String(on));
    askStatus.textContent = on ? 'Asking YAP about your words.' : askStatus.textContent;
  };
  const ask = async () => {
    if (isAsking()) return;
    askStatus.textContent = '';
    try {
      // The newest stored words, not what this screen last saw: another tab may have saved since.
      const latest = await mediaStore.get(id);
      if (latest && latest.file && latest.video) record = latest;
    } catch (e) {
      askStatus.textContent = e.message;
      return;
    }
    const built = buildReviewRequest(record.video, input.value);
    if (!built.ok) {
      askStatus.textContent = built.message;
      renderAll();
      return;
    }
    asking(true);
    let result;
    try {
      result = await askModel(built.payload);
    } finally {
      asking(false);
    }
    let answer;
    if (!result.ok && result.kind === 'unavailable') {
      // No model on this machine: the answer is read straight from the person's own saved words.
      answer = answerFromWords(built.payload.transcript, built.payload.notes, built.payload.question);
    } else if (!result.ok) {
      askStatus.textContent = result.message;
      return;
    } else {
      const checked = checkReviewReply(result.text, { transcript: built.payload.transcript, notes: built.payload.notes, question: built.payload.question });
      if (!checked.ok) {
        askStatus.textContent = checked.message;
        return;
      }
      answer = checked.answer;
    }
    const turn = makeTurn({ question: built.payload.question, answer, source: result.ok ? result.source : 'your-words', basis: built.basis, now: nowIso() });
    try {
      await commit((rec) => appendOwnTurn(rec, turn));
      input.value = '';
      askStatus.textContent = '';
      // bring the start of the new answer into view inside the thread, not its end
      const newest = thread.lastElementChild;
      if (newest) thread.scrollTop += newest.getBoundingClientRect().top - thread.getBoundingClientRect().top;
    } catch (e) {
      transient = [...transient, turn];
      renderThread();
      askStatus.textContent = `${e.message} The answer is shown below but is not saved.`;
    }
  };
  send.addEventListener('click', guard(ask));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      run(ask);
    }
  });

  // ---- the page ----
  const left = el('div', null, null, 'col-left');
  left.append(frame, playerError, line, words, wordsAndMoments);
  const right = el('div', null, null, 'col-right');
  right.append(assistant, lessonBox);
  const cols = el('div', null, null, 'cols');
  cols.append(left, right);
  body.replaceChildren(facts, cols);
  renderAll();
}


/** Open the page for a video kept in this browser under `id`. */
export function openUpload(id) {
  wireNav(document);
  body = $('detail-body');
  errorLine = $('detail-error');
  return ownVideo(id);
}
