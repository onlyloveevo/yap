// The Review detail stand-in (SCREEN-07). Its look is not chosen yet, so the markup is plain;
// the behaviour is the proven slice's: pick a number, see where it comes from and the prepared
// reply (METRIC-01), a proposal with Adjust / Dismiss / Try this (TRIAL-01), trials and what
// they may teach (TRIAL-02), and for a video the person brought in, the storage line and their
// own transcript and note (OWN-02 to OWN-04). Every sample number and reply says it is sample.
// No model is called. Every line is written with textContent.
import { wireNav, go } from '../lib/app.js';
import { sendCueToPrepare } from '../lib/review-memory.js';
import {
  fixtureSnapshot, selectContext, explain, appendTurn, proposeTrial, adjustProposal, acceptTrial,
  dismissProposal, recordApplication, reviewOutcome, nextCreation, performanceMemory, forgetTrial, undoForget,
} from '../../src/engine/review-sample.js';
import { createReviewStore } from '../../src/engine/review-store.js';
import { openMediaStore, attachCreatorEvidence } from '../../src/engine/video-import.js';
import {
  REVIEW_LIMITS, buildReviewRequest, checkReviewReply, makeTurn, appendTurn as appendOwnTurn, readReview, saveCue, editCue, removeCue, restoreCue,
  activeCues, removedCues, cueForTurn, savedWords, sourceLabel, textStamp, clock,
} from '../../src/engine/review-own.js';
import { askModel, isAsking } from '../lib/review-own.js';

wireNav(document);

const id = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const $ = (testid) => document.querySelector(`[data-testid="${testid}"]`);
const body = $('detail-body');
const errorLine = $('detail-error');

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

const NAMES = { ctr: 'Click-through rate', retention: 'Watch ratio', subscribers: 'Subscribers on the watch page' };
const MEASURES = { 'native-watchtime-share': 'watch-time share', ctr: 'click-through rate', retention: 'watch ratio', subscribers: 'subscribers on the watch page' };
const STATUSES = { 'ready-to-try': 'ready to try', 'not-applied': 'not applied', 'awaiting-evidence': 'waiting for results', proposed: 'proposed' };
const OUTCOMES = { 'no-clear-change': 'no clear change (sample result, inconclusive)' };
const plain = (map, key, fallback) => (key && map[key]) || fallback;
const THUMBS = { 'current-thumb': ['thumb-current.jpg', 'Current thumbnail (sample)'], 'proposed-thumb': ['thumb-proposed.jpg', 'Proposed thumbnail (sample)'] };

function mediaLine(player, record) {
  const v = record.video;
  return `${v.name} · ${v.duration.toFixed(2)} seconds · kept on this machine, in this browser, and not uploaded.`;
}

// ---------- a sample with no review ----------
function noReview() {
  $('detail-title').textContent = 'Sample video';
  body.replaceChildren(el('p', 'This sample has no review to show.', 'no-review'));
}

// ---------- the sample review ----------
function sampleReview() {
  let store;
  let state;
  try {
    store = createReviewStore(localStorage);
    state = store.load();
  } catch (e) {
    errorLine.textContent = e.message;
    return;
  }
  let snapshot = fixtureSnapshot();
  const videoId = snapshot.video.id;
  let context = null;
  let proposal = null;
  let lastForgotten = null;
  let pendingSeek = null;

  $('detail-title').textContent = snapshot.video.title;
  const label = el('p', 'ⓘ Sample review · Not connected', 'sample-label', 'sample');
  const sentence = el('p', 'Every number and every reply on this screen is sample data, not measured from this video. No model is called.', 'sample-sentence', 'fine');
  const mismatch = el('p', 'The inbox card is titled "Why my first launch failed", but this sample review plays the bundled sample take, which is a different video.', 'sample-mismatch', 'fine');
  const player = el('video', null, 'player');
  player.controls = true;
  player.muted = true;
  player.preload = 'metadata';
  player.src = `${snapshot.video.media}#t=0.1`;
  player.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) {
      player.currentTime = Math.min(pendingSeek, player.duration);
      pendingSeek = null;
    }
  });
  const numbers = el('section', null, 'numbers');
  const metrics = el('div', null, 'metrics', 'metric-cards');
  const buckets = el('div', null, 'buckets', 'row strip');
  const where = el('p', null, 'context', 'fine');
  const reply = el('div', null, 'reply', 'reply');
  const thumbs = el('div', null, 'thumbs', 'thumbs');
  const askRow = el('div', null, null, 'row');
  const question = el('input', null, 'question');
  question.value = 'Why is this low?';
  question.setAttribute('aria-label', 'Your question about the picked number');
  askRow.append(question, button('Discuss (prepared reply)', 'ask', () => {
    if (!context) throw new Error('Pick a number first.');
    save(appendTurn(state, context, question.value));
  }), button('What could I try?', 'propose', () => {
    if (!context) throw new Error('Pick a number first.');
    proposal = proposeTrial(context);
    renderProposal();
  }));
  const turns = el('div', null, 'turns');
  const picked = el('div', null, 'picked', 'panel');
  picked.append(where, reply, thumbs, askRow, turns);
  numbers.append(el('h2', 'Numbers (sample)'), metrics, picked);

  const proposalBox = el('section', null, 'proposal');
  proposalBox.hidden = true;
  const proposalCopy = el('p', null, 'proposal-copy');
  const change = el('input', null, 'proposal-change');
  change.setAttribute('aria-label', 'Change to try');
  const reason = el('input', null, 'proposal-reason');
  reason.setAttribute('aria-label', 'Your reason');
  reason.placeholder = 'Your reason (optional)';
  const choice = el('p', null, 'choice-status', 'fine');
  const choiceRow = el('div', null, null, 'row');
  choiceRow.append(
    button('Adjust', 'adjust', () => {
      proposal = adjustProposal(proposal, change.value, reason.value);
      renderProposal();
    }),
    button('Dismiss', 'dismiss', () => {
      save(dismissProposal(state, proposal));
      proposalBox.hidden = true;
      proposal = null;
      choice.textContent = 'Dismissed. No trial was saved.';
    }),
    button('Try this', 'accept', () => {
      if (!proposal) throw new Error('There is no proposal to accept.');
      save(acceptTrial(state, proposal));
      choice.textContent = 'Trial saved on this machine, once. Not yet applied; no benefit is claimed.';
    }, 'primary')
  );
  proposalBox.append(el('h2', 'Proposed trial (sample)'), proposalCopy, change, reason, choiceRow, choice);

  const trialsBox = el('section', null, 'trials-box');
  const trialsList = el('div', null, 'trials');
  const memory = el('p', null, 'memory-line', 'fine');
  const nextBox = el('div', null, 'next-copy', 'fine');
  const trialRow = el('div', null, null, 'row');
  trialRow.append(
    button('Undo last forget', 'undo-forget', () => {
      if (lastForgotten) save(undoForget(state, lastForgotten));
    }),
    button('Next creation: show relevant trials', 'next', () => {
      nextBox.replaceChildren(el('p', 'Relevant accepted trials for the next YouTube long video:'));
      for (const t of nextCreation(state, snapshot.video)) nextBox.append(el('p', `${t.change} · ${t.retrievalLabel}`));
    })
  );
  trialsBox.append(el('h2', 'Trials on this video'), trialsList, trialRow, nextBox, memory);

  const provenance = el('p', null, 'provenance', 'fine');
  const frame = el('div', null, null, 'frame');
  frame.append(player);
  const left = el('div', null, null, 'col-left');
  left.append(frame, el('p', 'Retention by part of the video (sample). Pick a part to jump the player.', null, 'fine'), buckets, provenance);
  const right = el('div', null, null, 'col-right');
  right.append(numbers, proposalBox, trialsBox);
  const cols = el('div', null, null, 'cols');
  cols.append(left, right);
  const head = el('div', null, null, 'head');
  head.append(label, sentence, mismatch);
  body.replaceChildren(cols);
  const title = $('detail-title');
  title.after(head);

  function save(next) {
    store.save(next);
    state = next;
    renderState();
  }
  function select(metric, bucket) {
    context = selectContext(snapshot, metric, bucket);
    proposal = null;
    proposalBox.hidden = true;
    if (context.seek !== null) {
      if (player.readyState >= 1) player.currentTime = Math.min(context.seek, player.duration);
      else pendingSeek = context.seek;
    }
    renderContext();
    renderMetrics();
  }
  function renderMetrics() {
    metrics.replaceChildren();
    buckets.replaceChildren();
    for (const [metric, name] of [['ctr', 'Impressions click-through rate'], ['retention', 'Segment watch ratio'], ['subscribers', 'Subscribers on the watch page']]) {
      const c = selectContext(snapshot, metric);
      const f = c.facts[metric] || c.facts.ratio;
      const b = button('', `metric-${metric}`, () => select(metric), 'metric-card');
      b.append(el('span', name, null, 'm-label'), el('span', f.display, null, 'm-value'), el('span', 'sample', null, 'm-tag'));
      b.setAttribute('aria-pressed', String(Boolean(context && context.metricId === metric)));
      metrics.append(b);
    }
    for (const b of snapshot.metrics.retention.buckets) {
      const btn = button(`Part ${b.start}–${b.end} s: ${b.ratio}× (sample)`, `bucket-${b.id}`, () => select('retention', b.id));
      btn.setAttribute('aria-pressed', String(Boolean(context && context.bucket && context.bucket.id === b.id)));
      buckets.append(btn);
    }
    provenance.textContent = 'Where the sample numbers come from: made-up sample data, not measured from this video. They cover a sample first seven days, compared with a sample group of ten similar videos.';
  }
  function renderReplyInto(target, r) {
    target.replaceChildren(el('p', 'Prepared reply (sample)', null, 'sample-tag'), el('p', r.text, 'reply-text'));
    for (const a of r.alternatives) target.append(el('p', `Possible reason: ${a.text}`));
    target.append(el('p', r.decision, 'reply-step'));
  }
  function renderContext() {
    if (!context) {
      where.textContent = 'No number picked yet. Pick one above to see where it comes from and a prepared reply.';
      reply.replaceChildren();
      thumbs.replaceChildren();
      return;
    }
    const rule = context.facts[Object.keys(context.facts)[0]].rule;
    where.textContent = `${NAMES[context.metricId]}${context.bucket ? ` · part ${context.bucket.start}–${context.bucket.end} s` : ''} · from the sample data · ${rule === 'source value' ? 'shown as given' : rule}.`;
    renderReplyInto(reply, explain(context));
    thumbs.replaceChildren();
    if (context.metricId === 'ctr') {
      for (const a of context.snapshot.assets) {
        const [file, caption] = THUMBS[a.id] || [null, a.id];
        const fig = document.createElement('figure');
        const frame = el('div', null, null, 'thumb-frame');
        if (file) {
          const img = document.createElement('img');
          img.src = file;
          img.alt = caption;
          frame.append(img);
        }
        fig.append(frame, el('figcaption', caption, null, 'fine'));
        thumbs.append(fig);
      }
    }
  }
  function renderProposal() {
    proposalBox.hidden = false;
    proposalCopy.textContent = `${proposal.change}. ${proposal.prediction}. Main measure: ${plain(MEASURES, proposal.primaryMeasure, 'not set')}; second measure: ${plain(MEASURES, proposal.secondaryMeasure, 'none')}. ${proposal.checkIn}. Trying this means ready to try, not applied and not shown to work.`;
    change.value = proposal.change;
    choice.textContent = 'Proposed, not saved as a trial.';
  }
  function renderState() {
    turns.replaceChildren();
    for (const t of state.turns.filter((t) => t.context.videoId === videoId)) {
      const item = el('div', null, 'turn', 'turn');
      item.append(el('p', `${t.question} — about ${NAMES[t.context.metricId]}${t.context.bucket ? ` (part ${t.context.bucket.start}–${t.context.bucket.end} s)` : ''}, from the sample data`));
      const r = el('div');
      renderReplyInto(r, t.reply);
      item.append(r);
      turns.append(item);
    }
    trialsList.replaceChildren();
    const mine = state.trials.filter((t) => t.context.videoId === videoId);
    if (!mine.length) trialsList.append(el('p', 'No trial saved yet.', 'no-trials', 'fine'));
    for (const t of mine) {
      const art = el('article', null, 'trial', 'trial-item');
      art.dataset.trial = t.id;
      art.append(el('h3', t.change), el('p', `Sample trial · ${plain(STATUSES, t.status, t.status)} · main measure: ${plain(MEASURES, t.primaryMeasure, 'not set')}; second: ${plain(MEASURES, t.secondaryMeasure, 'none')} · applied: ${t.application ? (t.application.applied ? 'yes' : 'no') : 'not recorded'} · result: ${t.outcome ? plain(OUTCOMES, t.outcome.status, 'recorded') : 'not yet known'}${t.confounded ? ' · overlapping changes: cannot be told apart' : ''}`, null, 'fine'));
      const row = el('div', null, null, 'row');
      const now = () => new Date().toISOString();
      for (const [lab, action] of [
        ['Record applied', () => save(recordApplication(state, t.id, { applied: true, at: now(), sourceType: 'user-report' }))],
        ['Record not applied', () => save(recordApplication(state, t.id, { applied: false, at: now(), sourceType: 'user-report' }))],
        ['Show sample result', () => save(reviewOutcome(state, t.id, { sourceType: 'sample', status: 'no-clear-change', comparable: false, reason: 'Illustrative outcome without compatible measured watch-time evidence', values: { ctr: 2.5 } }))],
        ['Forget', () => { lastForgotten = t.id; save(forgetTrial(state, t.id)); }],
      ]) row.append(button(lab, `trial-${lab.toLowerCase().replace(/[^a-z]+/g, '-')}`, action));
      art.append(row);
      trialsList.append(art);
    }
    memory.textContent = `Measured results YAP remembers: ${performanceMemory(state).length}. A sample result is marked inconclusive and is never remembered as performance.`;
  }
  renderMetrics();
  renderContext();
  renderState();
}

// ---------- a video the person brought in ----------
// The imported-video Review: the player, what is true of the file, the creator's own words (kept, with
// notes that jump the player), Ask YAP about those words, and cues the creator chooses for the next
// video. Everything is kept on the video's own record. No number, transcript or reading of the picture
// is ever made up: the model only ever sees the saved transcript, the saved notes and the question.
const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
const dateOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const CHIPS = ['What is the main point of this video?', 'Which of my notes should I fix first?', 'How could I say my opening differently?'];

async function ownVideo() {
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
  const truth = el('section', null, 'not-available', 'truth');
  truth.append(
    el('p', 'Numbers (click-through rate, retention, subscribers): not available. A video file does not carry them.', 'numbers-na'),
    el('p', 'Automatic transcript: not available. YAP has not listened to this video.', 'transcript-na'),
    el('p', 'Reading of the picture: not available. YAP has not looked at this video.', 'vision-na')
  );

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
    el('p', 'Paste a transcript or add a note at a time in the video. Both are kept with this video and marked as written by you. YAP has not analysed them until you ask.', null, 'fine'),
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
  aHead.append(el('h2', '✦ YAP assistant', null, 'a-title'), el('span', 'Text only', null, 'badge'));
  const aFoot = el('div', null, null, 'a-foot');
  aFoot.append(el('label', 'Ask anything about this video', null, 'fine field-label'), composer, askStatus, disclosure);
  assistant.append(aHead, notice, thread, chips, aFoot);

  // ---- cues ----
  const cuesBox = el('section', null, 'cues-box', 'panel cues-box');
  const cuesList = el('div', null, 'cues', 'cues');
  cuesBox.append(
    el('h2', '💡 Next-video cues'),
    el('p', 'Things you chose to try next time. They are your ideas, not results, and they stay with this video. YAP does not carry them to other videos on its own.', null, 'fine'),
    cuesList
  );

  const drafts = new Map();
  const openDrafts = new Set();
  const cueEdits = new Map();
  const nowIso = () => new Date().toISOString();
  const run = (fn) => guard(fn)();

  const turnCard = (t, { isTransient } = {}) => {
    const { review } = readReview(record);
    const card = el('article', null, 'turn', 'turn-card');
    card.dataset.turn = t.id;
    card.append(el('p', t.question, 'turn-question', 'bubble'));
    const a = el('div', null, 'turn-answer', 'answer');
    const b = t.basis;
    const based = `${b.notesSent} of ${b.notesTotal} note${b.notesTotal === 1 ? '' : 's'}${b.truncated ? `, first ${b.sentChars.toLocaleString('en-GB')} of ${b.transcriptChars.toLocaleString('en-GB')} transcript characters` : ''}`;
    a.append(el('p', `Answered from your saved transcript and notes (${based}) by ${sourceLabel(t.source)}. YAP did not watch or listen to the video.`, 'turn-source', 'fine'));
    if (!t.answer.structured) a.append(el('p', 'This reply did not come in the usual form, so its passages were not checked against your words.', 'turn-unchecked', 'fine'));
    a.append(el('p', t.answer.text, 'turn-text', 'a-text'));
    if (t.answer.quotes.length) {
      a.append(el('p', 'From your words:', null, 'fine'));
      t.answer.quotes.forEach((q) => a.append(el('blockquote', q.text, 'turn-quote')));
    }
    if (t.answer.droppedQuotes) a.append(el('p', `${t.answer.droppedQuotes} quoted passage${t.answer.droppedQuotes === 1 ? '' : 's'} could not be found in your words and ${t.answer.droppedQuotes === 1 ? 'was' : 'were'} left out.`, 'turn-dropped', 'fine'));
    if (t.answer.hypotheses.length) {
      a.append(el('p', 'Hypotheses, not measurements:', null, 'fine'));
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
    } else {
      const cue = cueForTurn(review, t.id);
      if (cue) {
        a.append(el('p', '✓ Saved as a next-video cue', 'cue-saved-flag', 'fine'));
      } else if (openDrafts.has(t.id)) {
        const ta = el('textarea', null, 'cue-draft');
        ta.rows = 2;
        ta.maxLength = REVIEW_LIMITS.cueChars;
        ta.value = drafts.has(t.id) ? drafts.get(t.id) : t.answer.suggestion;
        ta.placeholder = 'What will you try in your next video? Your own words.';
        ta.setAttribute('aria-label', 'Your cue for the next video');
        ta.addEventListener('input', () => drafts.set(t.id, ta.value));
        const row = el('div', null, null, 'row');
        row.append(
          button('Save cue', 'cue-save', async () => {
            await commit((rec) => saveCue(rec, { turnId: t.id, text: ta.value, now: nowIso() }));
            openDrafts.delete(t.id);
            drafts.delete(t.id);
            renderAll();
          }, 'primary'),
          button('Cancel', 'cue-cancel', () => { openDrafts.delete(t.id); renderThread(); })
        );
        a.append(el('p', t.answer.suggestion ? 'YAP\'s suggestion is filled in. Change it to your own wording.' : 'YAP made no suggestion. Write your own.', null, 'fine'), ta, row);
      } else {
        a.append(button('Save as next-video cue', 'cue-offer', () => { openDrafts.add(t.id); renderThread(); const f = thread.querySelector('[data-testid="cue-draft"]'); if (f) f.focus(); }));
      }
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
      thread.append(el('p', savedOf(record).transcript ? 'Ask a question about what you said in this video. Answers come from your saved transcript and notes only, and say so.' : 'Add and save a transcript of this video under Your own words, then ask about it. YAP has not listened to the video, so your words are all it has.', 'ask-empty', 'fine'));
    }
    review.turns.forEach((t) => thread.append(turnCard(t)));
    transient.forEach((t) => thread.append(turnCard(t, { isTransient: true })));
    chips.hidden = review.turns.length > 0 || transient.length > 0;
  };

  const cueArticle = (c, review) => {
    const art = el('article', null, 'cue', 'cue-item');
    art.dataset.cue = c.id;
    if (cueEdits.has(c.id)) {
      const ta = el('textarea', cueEdits.get(c.id), 'cue-edit-text');
      ta.rows = 2;
      ta.maxLength = REVIEW_LIMITS.cueChars;
      ta.setAttribute('aria-label', 'Edit your cue');
      ta.addEventListener('input', () => cueEdits.set(c.id, ta.value));
      const row = el('div', null, null, 'row');
      row.append(
        button('Save', 'cue-edit-save', async () => {
          await commit((rec) => editCue(rec, { cueId: c.id, text: ta.value, now: nowIso() }));
          cueEdits.delete(c.id);
          renderAll();
        }, 'primary'),
        button('Cancel', 'cue-edit-cancel', () => { cueEdits.delete(c.id); renderCues(); })
      );
      art.append(ta, row);
      return art;
    }
    art.append(el('p', c.text, 'cue-body', 'cue-text'));
    const when = dateOf(c.at);
    art.append(el('p', `${c.edited ? 'Your wording, adapted from YAP\'s suggestion' : 'YAP\'s suggestion, kept as it was'} · from your question "${c.question}"${when ? ` · kept ${when}` : ''} · your choice to try, not a measured result`, 'cue-provenance', 'fine'));
    const row = el('div', null, null, 'row');
    row.append(
      button('Use in next video', 'cue-use', () => sendCueToPrepare({ videoId: record.id, cueId: c.id, go }), 'primary'),
      button('Edit', 'cue-edit', () => { cueEdits.set(c.id, c.text); renderCues(); }),
      button('Remove', 'cue-remove', () => commit((rec) => removeCue(rec, { cueId: c.id, now: nowIso() })))
    );
    art.append(row, el('p', 'Opens Prepare with this cue to include or leave out. Nothing is copied until you start a take.', 'cue-use-hint', 'fine cue-use-hint'));
    return art;
  };

  const renderCues = () => {
    const { review } = readReview(record);
    cuesList.replaceChildren();
    const active = activeCues(review);
    if (!active.length) cuesList.append(el('p', 'No cues yet. Save one from an answer when you want to try it in your next video.', 'no-cues', 'fine'));
    active.forEach((c) => cuesList.append(cueArticle(c, review)));
    removedCues(review).forEach((c) => {
      const row = el('div', null, 'cue-removed', 'row removed');
      row.append(el('p', `Removed: ${c.text}`, null, 'fine'), button('Undo', 'cue-undo', () => commit((rec) => restoreCue(rec, { cueId: c.id }))));
      cuesList.append(row);
    });
  };

  function renderAll() {
    renderFacts();
    renderWords();
    renderThread();
    renderCues();
  }

  // ---- Ask ----
  const asking = (on) => {
    send.disabled = on;
    send.setAttribute('aria-busy', String(on));
    askStatus.textContent = on ? 'Asking the model about your words. This can take up to a minute.' : askStatus.textContent;
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
    if (!result.ok) {
      askStatus.textContent = result.message;
      return;
    }
    const checked = checkReviewReply(result.text, { transcript: built.payload.transcript, notes: built.payload.notes, question: built.payload.question });
    if (!checked.ok) {
      askStatus.textContent = checked.message;
      return;
    }
    const turn = makeTurn({ question: built.payload.question, answer: checked.answer, source: result.source, basis: built.basis, now: nowIso() });
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
  right.append(assistant, cuesBox);
  const cols = el('div', null, null, 'cols');
  cols.append(left, right);
  body.replaceChildren(facts, truth, cols);
  renderAll();
}

if (id === 'sample-video') sampleReview();
else if (/^sample-[2-6]$/.test(id)) noReview();
else if (/^upload-[0-9a-f]{64}$/.test(id)) ownVideo();
else {
  $('detail-title').textContent = 'Video not found';
  body.replaceChildren(el('p', 'There is no review at this address.', 'not-found'));
}
