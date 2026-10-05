import { preparedAngleFields } from '../../src/engine/prepared-angles.js';
// The prepare stand-in, wired (D-98, D-104, D-122, D-125, D-126). The page is
// the stand-in's shell, not one of Deth's chosen frames: it does the job of
// "recording preparation" until he locks that screen.
//
// The shell's own script (prepare.js) was fake data, so it is not part of the
// app and this module takes its place. `show`, `renderRecent`, `renderBeats`,
// `renderChips` and the camera preview are that script's own functions, ported
// as they build things and fed real data: every id and data-testid hook is
// kept. In shell mode they are fed the shell's drawn data, no camera is asked
// for and no model is called, so the page is the shell whatever the address.
//
// Outside shell mode:
// - /prepare/new is the stand-in as its shell stands: Just talk gives the
//   engine's default beats and calls no model; an idea or a paste goes to this
//   app's model route through writeBeats, with the default beats last (D-125).
// - /prepare/<id> opens straight on the picked idea: its title, and its kept
//   beats as talking points (D-122).
// - The chips are the engine's six delivery cues; 1 to 3 can be on (D-126).
//   Under them each pressed cue has an Edit button: its exact wording can be
//   changed, kept per idea or start (ui/lib/cue-editor.js) and put on the
//   recording's cues through the engine's chooseDeliveryCues. The original
//   wording stays the default, and the sample take never uses a draft.
// - Outside shell mode a prepared beat list opens as Rehearsal (ui/lib/prepare-rehearsal.js), a simulated Live
//   mode: the camera is the canvas, a small cue card, a thin beat timeline and Talk to YAP. The stand-in's own beat
//   list, chips, Start and Back are moved into it, so their ids stay. Nothing is recording and no microphone is
//   opened until the person presses Start recording, which makes the Recording from the CURRENT edited beats and
//   opens the existing record page. The camera line (and Retry camera) is shown on every view.
// - Start recording makes the Recording (D-127) and opens /record/<id>.
//   recordingRequest (ui/lib/prepare-model.js) turns what is shown and the
//   pressed chips into the request: the chips become the take's delivery cues
//   through the engine's chooseDeliveryCues.
// - When the sample idea is open there is one more button, Try the sample take
//   (D-123, D-140). It is built here from the stand-in's own Back-button class,
//   so nothing is added to the page file, and it is on no other screen. It
//   makes the bundled sample take's Recording and opens /record/<id>?sample=1.
// - The Recent list shows the saved recordings, the newest two.
//
// Words are written with textContent, never as markup: a beat may carry the
// person's own words or a model's, and a title is the person's own.
import { go, isShellMode, sayQuietly } from '../lib/app.js';
import { createRecordingFor, getIdea, listRecordings } from '../lib/api.js';
import { SAMPLE_TAKE_LABEL, prepareView, recentRows, recordingRequest } from '../lib/prepare-model.js';
import { matchRoute, routeFor } from '../lib/routes.js';
import { DELIVERY_CUES, DELIVERY_DEFAULTS } from '../../src/engine/delivery.js';
import { defaultBeats, writeBeats } from '../../src/engine/setup-beats.js';
import { outlineFromWords, ideaWords } from '../lib/idea-model.js';
import { EDIT_ADDRESS, recordingView } from '../lib/presentation-model.js';
import { loadDraft } from '../lib/presentation-store.js';
import { mountPrepareCard } from '../lib/review-memory.js';
import { saveTakeFocus, storageOrNull } from '../../src/engine/review-memory.js';
import { cameraFailureLine, createCameraNote, mountRehearsal } from '../lib/prepare-rehearsal.js';
import { clearWording, createCueEditor, cuesWithWording, mountCueEditorBox, readWording, resetWording, saveWording } from '../lib/cue-editor.js';

/** `/prepare/new` names no idea: it is the stand-in's own opening (D-104). */
const NEW_ID = 'new';
/** The hook of the button that plays the bundled sample take. */
const SAMPLE_HOOK = 'try-sample-take';
/** The mark on the record address of a sample take. */
const SAMPLE_QUERY = '?sample=1';
const NO_IDEA_LINE = 'YAP has no idea at this address. You can start from here instead.';
const NO_ANSWER_LINE = 'YAP could not open that idea: its own server did not answer.';
const NOT_STARTED_LINE = 'YAP could not start the recording: its own server did not answer.';
const WRITING_LINE = 'YAP is splitting this into beats.';
/** The longest the writing line stays by itself, in milliseconds: it is taken away as soon as the beats are there. */
const WRITING_MS = 10 * 60 * 1000;

// The shell's drawn data, shown only in shell mode.
const DRAWN_RECENT = [
  { title: 'Why clients stall on decisions', length: '2:41', date: 'Yesterday' },
  { title: 'Three things I wish I knew sooner', length: '1:58', date: 'Tuesday' },
];
const DRAWN_DEFAULT_BEATS = [
  { label: 'Hook', points: ['Start with the surprise'] },
  { label: 'Story', points: ['One moment that happened'] },
  { label: 'Point', points: ['What it showed you'] },
  { label: 'Takeaway', points: ['One thing to do next'] },
];
const DRAWN_IDEA_BEATS = [
  { label: 'Hook', points: ['The thing nobody says', 'Say it plainly'] },
  { label: 'Client story', points: ['The client who stalled', 'What we tried first'] },
  { label: 'What went wrong', points: ['Where it fell apart', 'What I missed', 'How it felt'] },
  { label: 'Insight', points: ['What changed my mind'] },
  { label: 'Takeaway', points: ['One thing to try', 'Say it once more'] },
];

/** The six delivery cues by their own wording, in the order the person is offered them (DELIV-01). */
const CUES = DELIVERY_CUES.map((cue) => cue.text);
const MAX_CUES = DELIVERY_DEFAULTS.max;

const $ = (id) => document.getElementById(id);
const shellEl = $('shell');
const drawnTitle = $('prepare-title').textContent;

const shellMode = isShellMode(location);
const route = matchRoute(location.pathname, location.search);
const routeId = route && route.name === 'prepare' ? route.params.id : null;
/** True when the person came from their presentation (/prepare/new?presentation=1): the camera leads, and the beats are theirs. */
const presentationMode = !shellMode && routeId === NEW_ID && new URLSearchParams(location.search).get('presentation') === '1';
/** The presentation draft this view was opened on, once read: its title, its beats and its chosen cue kinds. */
let presentation = null;
/** The idea named in the address. None at /prepare/new, and none in shell mode, where the page is the drawn stand-in. */
const ideaId = !shellMode && routeId && routeId !== NEW_ID ? routeId : null;

/** The "From your review" card (a cue kept in Review and sent here by the creator). Not built in shell mode or for a presentation. */
const reviewCard = shellMode || presentationMode ? null : mountPrepareCard({ document, search: location.search });
/** The Recording a start already made when keeping its reminder failed, so a retry makes no second one. */
let madeRecordingId = null;

/** The idea the prepare view is showing, once it is known; null at /prepare/new and for an idea nobody has. */
let openIdea = null;
/** Which of the three starts the person picked: talk, idea or paste. */
let start = 'talk';
/** True while a model is writing the beats: a second press asks nothing more. */
let writing = false;
/** The beats the prepare view shows now: what a take started here is recorded on. */
let shownBeats = [];
/** The person's own words the shown beats were written from; empty for Just talk and for an idea. */
let typedWords = '';
/** True while a Recording is being made: a second press makes no second one. */
let starting = false;
/** True while the idea in the address is being fetched: its beats are not shown yet. */
let ideaPending = false;
/** True once the saved recordings were asked for: the Recent list is filled once. */
let recentAsked = false;

// Unstarted cue choices survive a reload of this tab (sessionStorage only: no cross-device claim). One key, one
// version, at most CUE_SCOPES scopes; a scope is the idea, or the start mode and, for typed starts, a hash of the
// typed words, so a new idea or another start never inherits. Only the six known cue kinds are kept, at most three.
const CUE_KEY = 'yap-prepare-cues:v1';
const CUE_SCOPES = 24;
const CUE_KINDS = DELIVERY_CUES.map((cue) => cue.kind);
const wordsHash = (text) => { let h = 2166136261; for (const ch of String(text).trim().replace(/\s+/g, ' ')) { h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0; } return h.toString(36); };
/** The scope the chips now belong to, or null in shell mode (the drawn page reads and writes no storage). */
function cueScope() {
  if (shellMode) return null;
  if (ideaId) return `idea:${ideaId}`;
  if (presentation) return `new:presentation:${wordsHash(JSON.stringify([presentation.view.title, presentation.view.beats]))}`;
  return start === 'talk' ? 'new:talk' : `new:${start}:${wordsHash(typedWords)}`;
}
function readCueStore() {
  try {
    const raw = JSON.parse(globalThis.sessionStorage.getItem(CUE_KEY) || 'null');
    if (!raw || raw.v !== 1 || typeof raw.entries !== 'object' || raw.entries === null || !Array.isArray(raw.order)) return { v: 1, entries: {}, order: [] };
    const entries = {};
    for (const scope of raw.order.filter((name) => typeof name === 'string' && Array.isArray(raw.entries[name])).slice(-CUE_SCOPES)) entries[scope] = raw.entries[scope];
    return { v: 1, entries, order: Object.keys(entries) };
  } catch {
    return { v: 1, entries: {}, order: [] };
  }
}
/** The kinds saved for this scope: known, unique, in chip order, at most three. Empty is a real answer. */
function savedCues(scope) {
  if (!scope) return [];
  const list = readCueStore().entries[scope];
  return Array.isArray(list) ? CUE_KINDS.filter((kind) => list.includes(kind)).slice(0, MAX_CUES) : [];
}
function writeCues(scope, kinds) {
  if (!scope) return;
  try {
    const store = readCueStore();
    store.order = store.order.filter((name) => name !== scope).concat(scope).slice(-CUE_SCOPES);
    store.entries = Object.fromEntries(store.order.map((name) => [name, name === scope ? kinds : store.entries[name]]));
    globalThis.sessionStorage.setItem(CUE_KEY, JSON.stringify(store));
  } catch { /* storage refused: the choice still stands on this page */ }
}
function clearCues(scope) {
  if (!scope) return;
  try {
    const store = readCueStore();
    delete store.entries[scope];
    store.order = store.order.filter((name) => name !== scope);
    globalThis.sessionStorage.setItem(CUE_KEY, JSON.stringify(store));
  } catch { /* nothing to clear if storage refuses */ }
}

/** sessionStorage, or null when this page may not read it. */
function cueStorage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}
/** The person's wording drafts for the scope the chips belong to now, by cue kind. */
let wording = {};
/** The editor under the chips. Not built in shell mode: the drawn page keeps its drawn chips only. */
const cueEditor = shellMode ? null : createCueEditor(document, mountCueEditorBox(document), {
  pressed: () => pressedCues(),
  wording: () => wording,
  save: (kind, text) => { const answer = saveWording(cueStorage(), cueScope(), kind, text); if (answer.ok) { wording = answer.wording; if (rehearsal) rehearsal.wordingChanged(); } return answer; },
  reset: (kind) => { const answer = resetWording(cueStorage(), cueScope(), kind); if (answer.ok) { wording = answer.wording; if (rehearsal) rehearsal.wordingChanged(); } return answer; },
});
const refreshEditor = () => { if (cueEditor) cueEditor.render(); };
/** A shorter request limit for tests only: it can never lengthen the rehearsal's own. */
const askLimit = Number(globalThis.YAP_REHEARSAL_TIMEOUT_MS);

/** Rehearsal replaces the stand-in's beats screen outside shell mode; in shell mode the drawn page stays exactly as drawn. */
let rehearsal = null;
let cameraNote = null;
/** The kinds of the pressed chips, in the chips' order. */
function pressedCues() {
  return [...$('chips').querySelectorAll('[data-testid="cue-chip"]')]
    .map((chip, i) => (chip.getAttribute('aria-pressed') === 'true' ? DELIVERY_CUES[i].kind : null))
    .filter((kind) => kind !== null);
}
/** Set the chips to exactly these kinds (the coach's plain cue commands): stored, shown and kept like a press. */
function setPressedCues(kinds) {
  const chips = [...$('chips').querySelectorAll('[data-testid="cue-chip"]')];
  const wanted = DELIVERY_CUES.map((cue) => cue.kind).filter((kind) => kinds.includes(kind)).slice(0, MAX_CUES);
  chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(wanted.includes(DELIVERY_CUES[i].kind))));
  $('cue-limit').hidden = true;
  writeCues(cueScope(), wanted);
  refreshEditor();
}
if (!shellMode) {
  rehearsal = mountRehearsal({
    document,
    shell: shellEl,
    section: $('prepare'),
    storage: cueStorage(),
    ...(Number.isFinite(askLimit) && askLimit >= 20 && askLimit < 95000 ? { timeoutMs: askLimit } : {}),
    hooks: {
      cues: () => pressedCues(),
      texts: () => wording,
      setCues: (kinds) => setPressedCues(kinds),
      // What the rehearsal shows is what a take started here is recorded on: the beats as edited.
      onChange: (beats) => { shownBeats = beats; renderBeats(beats); },
    },
  });
  cameraNote = createCameraNote(document, shellEl, { onRetry: () => { startCamera(); } });
}

/** Say what went wrong in the server's own words, or in one plain line when it did not answer. */
function sayFailure(err, plain) {
  const refused = err && typeof (/** @type {any} */ (err).status) === 'number';
  sayQuietly(document, refused ? /** @type {Error} */ (err).message : plain);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function show(view) {
  shellEl.dataset.view = view;
  for (const id of ['home', 'compose', 'prepare']) $(id).hidden = id !== view;
  if (reviewCard) reviewCard.place(view);
  if (cameraNote) cameraNote.place(view === 'prepare' ? rehearsal.noteHost : null);
}

function renderRecent(rows) {
  const list = $('recent-list');
  list.replaceChildren();
  for (const r of rows) {
    const li = el('li', 'recent-row');
    li.dataset.testid = 'recent-row';
    li.setAttribute('data-testid', 'recent-row');
    const title = el(r.href ? 'a' : 'span', 'r-title', r.title);
    if (r.href) { title.href = r.href; title.style.textDecoration = 'underline'; title.style.textUnderlineOffset = '4px'; title.setAttribute('aria-label', `${r.status === 'ready' ? 'Open' : 'Continue'} recording: ${r.title}`); }
    li.append(title, el('span', 'r-len', r.status === 'draft' ? 'Not finished' : r.length), el('span', 'r-date', r.date));
    list.append(li);
  }
}

function renderBeats(beats) {
  const list = $('beat-list');
  list.replaceChildren();
  for (const b of beats) {
    const li = el('li', 'beat');
    li.setAttribute('data-testid', 'beat');
    const body = el('div', 'beat-body');
    const label = el('div', 'beat-label', b.label);
    label.setAttribute('data-testid', 'beat-label');
    const pts = el('ul', 'beat-points');
    for (const p of b.points) {
      const pt = el('li', 'beat-point', p);
      pt.setAttribute('data-testid', 'beat-point');
      pts.append(pt);
    }
    body.append(label, pts);
    if(b.preparedAngles){const details=el('details','prepared-angles-summary');details.dataset.testid='prepared-angles-summary';Object.assign(details.style,{marginTop:'12px',fontSize:'14px',lineHeight:'1.45'});details.append(el('summary','','Your prepared alternatives'));for(const [kind,words] of Object.entries(b.preparedAngles)){details.append(el('strong','',kind==='story'?'Story':'Practical tips'),el('p','',words));}Object.assign(details.querySelector('summary').style,{cursor:'pointer',color:'var(--gold, #f2c86b)'});details.querySelectorAll('strong').forEach(e=>Object.assign(e.style,{display:'block',marginTop:'10px'}));details.querySelectorAll('p').forEach(e=>Object.assign(e.style,{margin:'4px 0 10px',whiteSpace:'pre-wrap'}));body.append(details);}
    li.append(el('span', 'beat-rule'), body);
    list.append(li);
  }
}

function renderChips() {
  const box = $('chips');
  const note = $('cue-limit');
  box.replaceChildren();
  note.hidden = true;
  const scope = cueScope();
  const restored = savedCues(scope);
  wording = readWording(cueStorage(), scope);
  for (const [i, name] of CUES.entries()) {
    const b = el('button', 'chip', name);
    b.type = 'button';
    b.setAttribute('data-testid', 'cue-chip');
    b.setAttribute('aria-pressed', String(restored.includes(DELIVERY_CUES[i].kind)));
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      if (on) { b.setAttribute('aria-pressed', 'false'); note.hidden = true; writeCues(cueScope(), pressedCues()); refreshEditor(); if (rehearsal) rehearsal.cuesChanged(); return; }
      if (box.querySelectorAll('[aria-pressed="true"]').length >= MAX_CUES) { note.hidden = false; return; }
      b.setAttribute('aria-pressed', 'true');
      writeCues(cueScope(), pressedCues());
      refreshEditor();
      if (rehearsal) rehearsal.cuesChanged();
    });
    box.append(b);
  }
  refreshEditor();
  if (rehearsal) rehearsal.cuesChanged();
}

/**
 * The button that plays the bundled sample take: there only while the sample
 * idea is open (D-123, D-140). It is a button of the stand-in's own
 * Back-button class, in a row of the stand-in's own actions class put under
 * the drawn row, so the page file holds nothing of it and the drawn row, Back
 * and Start recording, stays as it is drawn.
 */
function renderSampleButton(wanted) {
  if (rehearsal) {
    // Rehearsal: the sample take is a separately labelled option in Settings, never the main journey.
    rehearsal.sampleSlot.replaceChildren();
    if (!wanted) return;
    const sample = el('button', 'text-button', `Sample: ${SAMPLE_TAKE_LABEL}`);
    sample.type = 'button';
    sample.setAttribute('data-testid', SAMPLE_HOOK);
    sample.addEventListener('click', () => { startTake(true); });
    rehearsal.sampleSlot.append(sample);
    return;
  }
  const drawnRow = $('start-recording').parentElement;
  const there = document.querySelector(`[data-testid="${SAMPLE_HOOK}"]`);
  if (!wanted) {
    if (there) there.parentElement.remove();
    return;
  }
  if (there) return;
  const button = el('button', $('back-home').className, SAMPLE_TAKE_LABEL);
  button.type = 'button';
  button.setAttribute('data-testid', SAMPLE_HOOK);
  button.addEventListener('click', () => { startTake(true); });
  const row = el('div', drawnRow.className);
  row.append(button);
  drawnRow.after(row);
}

/** Show the prepare view on these beats, under the idea's title when one is open and the drawn heading otherwise. */
function openPrepare(beats, title) {
  shownBeats = beats;
  if(!shellMode)$('start-recording').disabled=beats.length===0;
  $('prepare-title').textContent = title || drawnTitle;
  renderBeats(beats);
  renderChips();
  // The rehearsal holds the beats from here on: what it restores or edits is what shownBeats becomes (onChange).
  if (rehearsal) rehearsal.setBeats(beats, cueScope() ? `rh:${cueScope()}` : null);
  renderSampleButton(Boolean(openIdea && openIdea.showSampleButton));
  show('prepare');
}

/** The three starts, with the saved recordings in the Recent list: asked for once, the first time this view is shown. */
function openHome() {
  show('home');
  if (shellMode || recentAsked) return;
  recentAsked = true;
  listRecordings()
    .then((list) => {
      const rows = recentRows(list, new Date());
      renderRecent(rows.map((row, i) => ({ ...row, status: list[i].status, href: routeFor(list[i].status === 'ready' ? 'edit' : 'record', { id: list[i].id }) })));
    })
    .catch((err) => sayFailure(err, 'YAP could not list your recordings: its own server did not answer.'));
}

/**
 * Make the Recording and open its record address (D-127): the person's own
 * take on Start recording, the bundled sample take on Try the sample take. In
 * shell mode nothing is sent: the address is only noted.
 */
async function startTake(sample) {
  // Nothing is recorded on beats that are not shown yet, and one press makes one Recording.
  if (starting || ideaPending) return;
  // Rehearsal: an edit typed but not applied is the person's to settle first; a coach turn still in flight is dropped.
  if (rehearsal && !sample) {
    const ready = rehearsal.beforeStart();
    if (!ready.ok) { sayQuietly(document, ready.message); return; }
  }
  // The beats the rehearsal now shows (edited, applied) are what is recorded on, for an idea as for a typed start.
  const view = openIdea ? { ...openIdea, beats: shownBeats } : (presentation ? { ...presentation.view, beats: shownBeats } : { ideaId: null, title: '', idea: typedWords, beats: shownBeats });
  let request;
  try {
    request = recordingRequest(view, pressedCues(), { sample });
    // The person's own wording goes through the engine onto the cues they edited. The sample take has its own cues and reads no draft.
    if (!sample) {
      wording = readWording(cueStorage(), cueScope());
      request = { ...request, deliveryCues: cuesWithWording(request, wording) };
    }
  } catch (err) {
    // The engine's own refusal of a choice of cues, in its own words.
    sayQuietly(document, err instanceof Error ? err.message : NOT_STARTED_LINE);
    return;
  }
  // A reminder from Review goes only with a take of the creator's own: never the sample take, never a refused one.
  starting = true;
  let focus = { ok: true, carry: null };
  if (!sample && reviewCard) {
    await reviewCard.ready;
    focus = reviewCard.forStart();
    if (!focus.ok) { starting = false; sayQuietly(document, focus.message); return; }
  }
  const scope = cueScope();
  try {
    const { id } = madeRecordingId && focus.carry ? { id: madeRecordingId } : await createRecordingFor(request);
    if (focus.carry) {
      madeRecordingId = id;
      const kept = saveTakeFocus(storageOrNull('localStorage'), id, focus.carry);
      if (!kept.ok) { starting = false; sayQuietly(document, `${kept.message} Your recording is ready: press Start recording to try again, or Remove the reminder first.`); return; }
      reviewCard.consumed();
    }
    // The rehearsal's own camera is let go before the record page opens; that page asks for its own.
    if (!shellMode) { releaseCamera(); if (rehearsal) rehearsal.abortAll(); }
    go(`${routeFor('record', { id })}${sample ? SAMPLE_QUERY : presentationMode ? '?presentation=1' : ''}`);
    // The chosen cues were used by this take: the draft goes only now, never on a failed save. A sample take uses none.
    if (!sample) { clearCues(scope); clearWording(cueStorage(), scope); if (rehearsal) rehearsal.clearSaved(); }
    // Outside shell mode the page is leaving: a press on the way out makes nothing more.
    if (shellMode) starting = false;
  } catch (err) {
    starting = false;
    sayFailure(err, NOT_STARTED_LINE);
  }
}

/** The camera stream held for the preview, so it can be let go (pagehide, Start) and asked for again (Retry camera). */
let cameraStream = null;
let cameraAsk = 0;
/** Let the preview's tracks go. Nothing else is held: no recorder and no microphone are ever opened on this page. */
function releaseCamera() {
  cameraAsk += 1;
  if (cameraStream) { for (const track of cameraStream.getTracks()) track.stop(); cameraStream = null; }
  const video = $('camera');
  video.srcObject = null;
  video.classList.remove('is-ready');
}
/** Ask for the camera (video only, never audio) and say plainly how it went, on every view. Retry camera calls this again. */
async function startCamera() {
  const video = $('camera');
  const ask = cameraAsk + 1;
  releaseCamera();
  cameraAsk = ask;
  sayCamera('Checking your camera…');
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    sayCamera(cameraFailureLine({ name: 'unsupported' }), true);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    // The warm gradient behind stays visible.
    if (ask === cameraAsk) sayCamera(cameraFailureLine(err), true);
    return;
  }
  // A newer ask, or the page leaving, means this stream is not wanted: it is let go at once.
  if (ask !== cameraAsk) { for (const track of stream.getTracks()) track.stop(); return; }
  cameraStream = stream;
  video.srcObject = stream;
  video.classList.add('is-ready');
  sayCamera('Camera on. Check your framing and light. Nothing is recording yet.');
}

/** Ask this app's model route (the tester's own Claude Code, then their own key, D-125). writeBeats falls back to the default beats. */
async function askModel(request) {
  const res = await fetch('/api/model', {
    method: 'POST',
    mode: 'same-origin',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return res.json();
}

/** The beats for what the person typed: the model's, cut to the limits, or the engine's default beats (D-125). */
async function makeBeats() {
  if (shellMode) return openPrepare(DRAWN_IDEA_BEATS);
  if (writing) return undefined;
  const text = $('idea-input').value;
  writing = true;
  // A model can take many seconds: the page says what it is waiting for, and stops saying it once the beats are there.
  if (text.trim()) sayQuietly(document, WRITING_LINE, WRITING_MS);
  try {
    const written = await writeBeats({ start, text, ask: askModel });
    sayQuietly(document, '');
    // The person's words go with the take that is recorded on these beats.
    typedWords = text;
    const fallback=outlineFromWords({thought:text}).map(r=>({id:r.id,label:r.title,points:[r.line]}));
    openPrepare(written.source==='default'&&fallback.length?fallback:written.beats);
    if(written.source==='default'&&fallback.length)sayQuietly(document,'YAP was unavailable. These editable points use your own words.');
  } finally {
    writing = false;
  }
  return undefined;
}

/** /prepare/<id>: the picked idea's title and its kept beats, straight on the prepare view (D-122). */
async function showIdea(id) {
  // The three starts are not this address's view: nothing of them is shown while the idea is fetched.
  ideaPending = true;
  openPrepare([]);
  let idea = null;
  let line = NO_IDEA_LINE;
  try {
    idea = await getIdea(id);
  } catch (err) {
    const refused = err && typeof (/** @type {any} */ (err).status) === 'number';
    line = refused ? /** @type {Error} */ (err).message : NO_ANSWER_LINE;
  }
  ideaPending = false;
  if (!idea) {
    openHome();
    sayQuietly(document, line);
    return;
  }
  openIdea = prepareView(idea);
  openIdea.idea=ideaWords(idea).join('\n');
  if(idea.keptBeats?.length||idea.ticks?.['outline-edited'])openIdea.beats=(idea.keptBeats||[]).map(b=>({label:b.title,points:b.line?[b.line]:[],...preparedAngleFields(b.preparedAngles)}));
  else if(!idea.beats?.length){const own=outlineFromWords(idea);if(own.length)openIdea.beats=own.map(b=>({label:b.title,points:[b.line]}));}
  openPrepare(openIdea.beats, openIdea.title);
}

for (const btn of document.querySelectorAll('.choice')) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    start = mode;
    // Just talk: the default beats, and no model (D-125).
    if (mode === 'talk') {
      typedWords = '';
      openPrepare(shellMode ? DRAWN_DEFAULT_BEATS : defaultBeats());
      return;
    }
    $('idea-input').value = '';
    show('compose');
    $('idea-input').focus();
  });
}
$('make-beats').addEventListener('click', () => { makeBeats(); });
$('compose-back').addEventListener('click', () => openHome());
// Back from an open idea is back to its beat list; with no idea it is back to the three starts, as in the shell.
$('back-home').addEventListener('click', () => {
  if (presentation || presentationMode) { go(EDIT_ADDRESS); return; }
  if (openIdea && openIdea.ideaId) go(routeFor('beats', { id: openIdea.ideaId }));
  else openHome();
});
// The press fires the shell's own event; the Recording is made in answer to it (D-127).
$('start-recording').addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('yap:start-recording'));
});
document.addEventListener('yap:start-recording', () => { startTake(false); });

// The Recent list: the shell's two drawn rows in shell mode; outside it, the saved recordings once the three starts are shown.
renderRecent(shellMode ? DRAWN_RECENT : []);
/** One line about the camera, on every view outside shell mode (and Retry camera when it failed). */
function sayCamera(line, failed = false) {
  if (cameraNote) cameraNote.say(line, { failed });
}

/**
 * /prepare/new?presentation=1: the person's own presentation, read back from the draft /present keeps. The beats
 * shown are exactly those words in that order, the panel docks low so the camera leads, and Back returns to editing.
 * A draft that is missing or cannot go live is said so, with the way back, and nothing is shown to record.
 */
function openPresentation() {
  shellEl.dataset.presentation = 'true';
  $('back-home').textContent = 'Back to presentation editing';
  $('back-home').setAttribute('data-testid', 'back-to-presentation');
  // Only a presentation the person actually kept is read here: with none kept, the suggestions are not theirs to record.
  const kept = loadDraft();
  const read = kept.status === 'loaded' ? recordingView(kept.draft) : { ok: false, error: 'No presentation has been saved in this browser yet.' };
  if (!read.ok) {
    const back = el('a', 'text-button', 'Back to presentation editing');
    back.href = EDIT_ADDRESS;
    back.setAttribute('data-testid', 'back-to-presentation-link');
    $('home').append(back);
    openHome();
    sayQuietly(document, `Your presentation cannot go live yet. ${read.error}`);
    return;
  }
  presentation = read;
  const display = el('a', 'text-button', 'Open presentation to share ↗');
  display.href = '/present?display=1';
  display.target = '_blank';
  display.rel = 'noopener';
  display.dataset.testid = 'open-presentation-display';
  const shareHint = el('p', 'camera-status-hint', 'Open this tab first, then choose it in the screen picker.');
  rehearsal.extras.append(display, shareHint);
  // Cues chosen on the map open already pressed here; a choice already made on this page stands.
  const scope = cueScope();
  if (read.cues.length && !(scope in readCueStore().entries)) writeCues(scope, read.cues);
  openPrepare(read.view.beats, read.view.title);
}

if (presentationMode) openPresentation();
else if (ideaId) showIdea(ideaId);
else if(!shellMode&&new URLSearchParams(location.search).get('start')==='talk')openPrepare(defaultBeats());
else openHome();
if (!shellMode) {
  startCamera();
  // The camera is let go when the page goes away, and asked for again if the browser brings the page back from its cache.
  globalThis.addEventListener('pagehide', () => { releaseCamera(); rehearsal.dispose(); });
  globalThis.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}
