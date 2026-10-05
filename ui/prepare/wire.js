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
// The prepare view is the Live screen used as a rehearsal (his Loom at 07:42, frame L10): the camera fills the window,
// and over it sit the beat card with a step button either side, the cue YAP raises, the beats as Live's timeline along
// the bottom bar and the pill that starts the recording. The person steps through their beats and nothing is saved: no
// Recording exists until Start recording. Set up, top right, opens the one overlay: the six cues as switches, each
// cue's wording, and the names of the camera and microphone (Live always uses the browser's defaults) with the audio
// level. Slow down and Smile start on; a choice the person made stands. The cues left on show here as they will in
// the take: Slow down when the microphone hears a fast pace (startPaceCoach), Smile when the camera has seen no smile
// for a while (ui/lib/face-coach.js), both measured on this Mac, and a reminder on the beat the take will show it on
// (rehearsalCues). A wording experiment running on this idea shows on the card as the take will show it.
//
// Words are written with textContent, never as markup: a beat may carry the
// person's own words or a model's, and a title is the person's own.
import { go, isShellMode, sayQuietly, wireNav } from '../lib/app.js';
import { createRecordingFor, getIdea, getTrials, listRecordings } from '../lib/api.js';
import { DEFAULT_CUES, SAMPLE_TAKE_LABEL, levelBars, prepareView, recentRows, recordingRequest, rehearsalCues, shownBeats as beatsAsShown, timelineView } from '../lib/prepare-model.js';
import { matchRoute, routeFor } from '../lib/routes.js';
import { DELIVERY_CUES, DELIVERY_DEFAULTS, MEASURED_CUES } from '../../src/engine/delivery.js';
import { startFaceCoach, startPaceCoach } from '../lib/face-coach.js';
import { mountCarriedLesson } from '../lib/carried-lesson.js';
import { defaultBeats, writeBeats } from '../../src/engine/setup-beats.js';
import { outlineFromWords, ideaWords } from '../lib/idea-model.js';
import { EDIT_ADDRESS, recordingView } from '../lib/presentation-model.js';
import { loadDraft } from '../lib/presentation-store.js';
import { clearWording, createCueEditor, mountCueEditorBox, readWording, resetWording, saveWording } from '../lib/cue-editor.js';

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
/** The two kinds of cue, each with its heading; a measured cue also says when it shows. */
const GROUP_MEASURED = 'YAP watches for';
const GROUP_REMINDERS = 'On your beats';
const CUE_NOTES = { 'slow-down': 'When you speed up', smile: 'When you have not smiled for a while' };
const MAX_CUES = DELIVERY_DEFAULTS.max;
/** The label over a beat on the card, as on Live's. */
const STORY_LABEL = 'Story';

const $ = (id) => document.getElementById(id);
const shellEl = $('shell');
const drawnTitle = $('prepare-title').textContent;

const shellMode = isShellMode(location);
wireNav(document);
const route = matchRoute(location.pathname, location.search);
const routeId = route && route.name === 'prepare' ? route.params.id : null;
/** True when the person came from their presentation (/prepare/new?presentation=1): the camera leads, and the beats are theirs. */
const presentationMode = !shellMode && routeId === NEW_ID && new URLSearchParams(location.search).get('presentation') === '1';
/** The presentation draft this view was opened on, once read: its title, its beats and its chosen cue kinds. */
let presentation = null;
/** The idea named in the address. None at /prepare/new, and none in shell mode, where the page is the drawn stand-in. */
const ideaId = !shellMode && routeId && routeId !== NEW_ID ? routeId : null;

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
/** The wording experiments in use, once asked for: the card shows a beat as the take of this idea will. */
let trials = [];
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
/**
 * The kinds on for this scope: known, unique, in chip order, at most three. A choice the person made stands, and an
 * empty one is a real answer. Before any choice, the two cues YAP measures start on (DEFAULT_CUES), so a take recorded
 * as it comes is coached. The drawn page and the presentation path start with none.
 */
function savedCues(scope) {
  if (!scope) return [];
  const list = readCueStore().entries[scope];
  if (!Array.isArray(list)) return presentationMode ? [] : CUE_KINDS.filter((kind) => DEFAULT_CUES.includes(kind));
  return CUE_KINDS.filter((kind) => list.includes(kind)).slice(0, MAX_CUES);
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
  save: (kind, text) => { const answer = saveWording(cueStorage(), cueScope(), kind, text); if (answer.ok) { wording = answer.wording; setTimeout(refreshCue, 0); } return answer; },
  reset: (kind) => { const answer = resetWording(cueStorage(), cueScope(), kind); if (answer.ok) { wording = answer.wording; setTimeout(refreshCue, 0); } return answer; },
});
const refreshEditor = () => { if (cueEditor) cueEditor.render(); if ($('chips').children.length) refreshCue(); };

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

/** Open or close Set up, the one overlay with the cue switches, the cue wording, the camera and the microphone. */
function setSetup(open) {
  if (open) shellEl.dataset.setup = 'open'; else delete shellEl.dataset.setup;
  $('setup-open').setAttribute('aria-expanded', String(open));
  if (open) $('setup-close').focus(); else if (document.activeElement === $('setup-close')) $('setup-open').focus();
}

function show(view) {
  shellEl.dataset.view = view;
  for (const id of ['home', 'compose', 'prepare']) $(id).hidden = id !== view;
  if (view !== 'prepare') setSetup(false);
  if (view === 'prepare' && cameraSettled) startLevel();
  watchFace();
  watchVoice();
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

/** Which beat the card shows now, from 0. */
let currentBeat = 0;
/** The furthest beat this rehearsal reached: the beats before it carry a tick on the timeline. */
let reachedBeat = 0;
/** True while the microphone hears a fast pace, and while the camera has seen no smile for a while. */
const measured = { 'slow-down': false, smile: false };

/** Show one beat on the card and the timeline. The others stay in the list, out of sight. */
function showBeat(index) {
  const rows = [...$('beat-list').children];
  currentBeat = Math.max(0, Math.min(rows.length - 1, index));
  reachedBeat = Math.max(reachedBeat, currentBeat);
  rows.forEach((row, i) => row.classList.toggle('is-current', i === currentBeat));
  const line = timelineView(rows.length, currentBeat, reachedBeat);
  [...$('rail').querySelectorAll('button')].forEach((dot, i) => {
    if (i === currentBeat) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current');
    dot.dataset.state = line.states[i];
    dot.querySelector('.node').textContent = line.states[i] === 'done' ? '\u2713' : '';
  });
  const track = $('rail').querySelector('.beat-track');
  if (track) {
    Object.assign(track.style, { left: `${line.inset}%`, right: `${line.inset}%` });
    Object.assign(track.querySelector('.track-done').style, { width: `${line.done}%` });
    Object.assign(track.querySelector('.track-current').style, { left: `${line.done}%`, width: `${line.current}%` });
  }
  $('beat-prev').disabled = currentBeat <= 0;
  $('beat-next').disabled = currentBeat >= rows.length - 1;
  refreshCue();
}

/** The cue's words as the person will read them: their own wording when they changed it. */
const cueText = (kind) => (wording && wording[kind]) || DELIVERY_CUES.find((cue) => cue.kind === kind).text;

/**
 * The one cue over the camera now, as the take shows one at a time: Slow down while the pace is fast, else Smile while
 * there has been no smile, else the reminder the take will show on this beat. A cue switched off never shows.
 */
function refreshCue() {
  const on = pressedCues();
  const raised = Object.keys(MEASURED_CUES).find((kind) => measured[kind] && on.includes(kind));
  const reminder = raised ? null : rehearsalCues(shownBeats, on, wording)[currentBeat];
  const kind = raised || (reminder && reminder.kind) || null;
  const box = $('live-cue');
  box.hidden = !kind;
  if (!kind) { delete box.dataset.cue; return; }
  box.dataset.cue = kind;
  box.dataset.reason = raised ? MEASURED_CUES[raised] : 'beat';
  $('live-cue-mark').textContent = kind === 'smile' ? '\u{1F642}' : '';
  $('live-cue-text').textContent = cueText(kind);
}

function renderBeats(beats) {
  const list = $('beat-list');
  list.replaceChildren();
  // The words on the card are the take's: a wording experiment running on this idea is laid over them, as Live does.
  for (const b of beatsAsShown(beats, trials, openIdea && openIdea.ideaId)) {
    const li = el('li', 'beat');
    li.setAttribute('data-testid', 'beat');
    const body = el('div', 'beat-body');
    body.append(el('div', 'beat-step', STORY_LABEL));
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
  // The beats as Live's timeline: a track, and one dot with its name per beat.
  const rail = $('rail');
  const track = el('div', 'beat-track');
  track.setAttribute('aria-hidden', 'true');
  track.append(el('span', 'track-done'), el('span', 'track-current'));
  rail.replaceChildren(...(beats.length ? [track] : []));
  for (const [index, b] of beats.entries()) {
    const dot = el('button', 'tl-beat');
    dot.type = 'button';
    dot.setAttribute('data-testid', 'rail-beat');
    dot.append(el('span', 'node'), el('span', 'beat-name', b.label));
    dot.addEventListener('click', () => showBeat(index));
    rail.append(dot);
  }
  reachedBeat = 0;
  showBeat(0);
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
    const kind = DELIVERY_CUES[i].kind;
    const isMeasured = Object.hasOwn(MEASURED_CUES, kind);
    if (i === 0 || isMeasured !== Object.hasOwn(MEASURED_CUES, DELIVERY_CUES[i - 1].kind)) box.append(el('p', 'cue-group pnew', isMeasured ? GROUP_MEASURED : GROUP_REMINDERS));
    const b = el('button', 'chip', name);
    b.type = 'button';
    b.setAttribute('data-testid', 'cue-chip');
    b.setAttribute('aria-pressed', String(restored.includes(DELIVERY_CUES[i].kind)));
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      if (on) { b.setAttribute('aria-pressed', 'false'); note.hidden = true; writeCues(cueScope(), pressedCues()); refreshEditor(); watchFace(); watchVoice(); return; }
      if (box.querySelectorAll('[aria-pressed="true"]').length >= MAX_CUES) { note.hidden = false; return; }
      b.setAttribute('aria-pressed', 'true');
      writeCues(cueScope(), pressedCues());
      refreshEditor();
      watchFace();
      watchVoice();
    });
    box.append(b);
    if (CUE_NOTES[kind]) box.append(el('p', 'cue-note pnew', CUE_NOTES[kind]));
  }
  refreshEditor();
  watchFace();
  watchVoice();
}

/** The microphone the level meter opened, once it has one: the pace is counted from the same sound. */
let micStream = null;
/** The pace coach while it runs, or the promise of it. */
let paceCoach = null;
/** Listen for the pace only while the Slow down cue is on. Nothing is recognised and nothing is kept. */
function watchVoice() {
  const wanted = !shellMode && !presentationMode && shellEl.dataset.view === 'prepare' && pressedCues().includes('slow-down') && Boolean(micStream);
  if (wanted && !paceCoach) {
    paceCoach = startPaceCoach(micStream, { onCue: ({ show }) => { measured['slow-down'] = show; refreshCue(); } });
  } else if (!wanted && paceCoach) {
    const stopping = paceCoach;
    paceCoach = null;
    measured['slow-down'] = false;
    Promise.resolve(stopping).then((coach) => coach.stop());
    refreshCue();
  }
}

/** The face coach while it runs, or the promise of it while the model loads. */
let faceCoach = null;
/**
 * Watch the camera for a smile only while the Smile cue is on and the camera shows a picture: with the cue off the
 * model is never loaded and no frame is read. The drawn page and the presentation path never watch.
 */
function watchFace() {
  const wanted = !shellMode && !presentationMode && shellEl.dataset.view === 'prepare' && pressedCues().includes('smile') && Boolean($('camera').srcObject);
  if (wanted && !faceCoach) {
    faceCoach = startFaceCoach($('camera'), { onCue: ({ show }) => { measured.smile = show; refreshCue(); } });
  } else if (!wanted && faceCoach) {
    const stopping = faceCoach;
    faceCoach = null;
    measured.smile = false;
    Promise.resolve(stopping).then((coach) => coach.stop());
    refreshCue();
  }
}

/**
 * The button that plays the bundled sample take: there only while the sample
 * idea is open (D-123, D-140). It is a button of the stand-in's own
 * Back-button class, in a row of the stand-in's own actions class put under
 * the drawn row, so the page file holds nothing of it. On the prepare view it
 * sits under Start recording, which moves up to make room.
 */
function renderSampleButton(wanted) {
  const drawnRow = $('start-recording').closest('.actions');
  $('start-recording').classList.toggle('has-sample', Boolean(wanted));
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
  const row = el('div', `${drawnRow.className} sample-row`);
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
  renderSampleButton(Boolean(openIdea && openIdea.showSampleButton));
  show('prepare');
  // What the person kept in Review, shown where they are about to record. The sample idea carries the sample's lesson.
  if (!shellMode && !presentationMode && !ideaPending) mountCarriedLesson($('carried'), { sample: Boolean(openIdea && openIdea.showSampleButton), removable: true }).catch(() => {});
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

/** The kinds of the pressed chips, in the chips' order. */
function pressedCues() {
  return [...$('chips').querySelectorAll('[data-testid="cue-chip"]')]
    .map((chip, i) => (chip.getAttribute('aria-pressed') === 'true' ? DELIVERY_CUES[i].kind : null))
    .filter((kind) => kind !== null);
}

/**
 * Make the Recording and open its record address (D-127): the person's own
 * take on Start recording, the bundled sample take on Try the sample take. In
 * shell mode nothing is sent: the address is only noted.
 */
async function startTake(sample) {
  // Nothing is recorded on beats that are not shown yet, and one press makes one Recording.
  if (starting || ideaPending) return;
  const view = openIdea || (presentation ? { ...presentation.view, beats: shownBeats } : { ideaId: null, title: '', idea: typedWords, beats: shownBeats });
  let request;
  try {
    // The person's own wording goes through the engine onto the cues they edited. The sample take has its own cues and reads no draft.
    if (!sample) wording = readWording(cueStorage(), cueScope());
    request = recordingRequest(view, pressedCues(), { sample, wording: sample ? null : wording });
  } catch (err) {
    // The engine's own refusal of a choice of cues, in its own words.
    sayQuietly(document, err instanceof Error ? err.message : NOT_STARTED_LINE);
    return;
  }
  starting = true;
  const scope = cueScope();
  try {
    const { id } = await createRecordingFor(request);
    go(`${routeFor('record', { id })}${sample ? SAMPLE_QUERY : presentationMode ? '?presentation=1' : ''}`);
    // The chosen cues were used by this take: the draft goes only now, never on a failed save. A sample take uses none.
    if (!sample) { clearCues(scope); clearWording(cueStorage(), scope); }
    // Outside shell mode the page is leaving: a press on the way out makes nothing more.
    if (shellMode) starting = false;
  } catch (err) {
    starting = false;
    sayFailure(err, NOT_STARTED_LINE);
  }
}

/** The default microphone's name, read from the device list once the camera is allowed. Live opens the microphone itself. */
async function nameMic() {
  try {
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const first = mics.find((d) => d.deviceId === 'default') || mics[0];
    $('mic-name').textContent = (first && first.label) || 'Default microphone';
  } catch {
    $('mic-name').textContent = 'Default microphone';
  }
}

/**
 * Light the level bars from the microphone for as long as this page is open. Nothing is recorded or sent: the sound
 * is only measured. False when this browser cannot measure it or the stream has no microphone.
 */
function showLevel(stream) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context || stream.getAudioTracks().length === 0) return false;
  const bars = [...$('meter').children];
  const audio = new Context();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  audio.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  // A browser may hold sound back until the first press or key.
  const wake = () => { if (audio.state === 'suspended') audio.resume().catch(() => {}); };
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, wake);
  wake();
  const draw = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const lit = levelBars(Math.sqrt(sum / samples.length), bars.length);
    bars.forEach((bar, i) => bar.classList.toggle('is-on', i < lit));
    requestAnimationFrame(draw);
  };
  draw();
  return true;
}

/**
 * True when the address opens straight on the prepare view, where the level meter is: the microphone is then asked
 * for together with the camera, in one prompt. The three starts ask for the picture only.
 */
const opensOnPrepare = !shellMode && !presentationMode && (Boolean(ideaId) || new URLSearchParams(location.search).get('start') === 'talk');
/** True once the camera was allowed or refused: the meter waits for that answer before asking for anything itself. */
let cameraSettled = false;
let levelStarted = false;

/** Start the level meter the first time the prepare view shows: from the microphone already open, or by asking for it then. */
async function startLevel() {
  if (levelStarted || shellMode || presentationMode) return;
  levelStarted = true;
  let stream = $('camera').srcObject;
  if (!stream || stream.getAudioTracks().length === 0) {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); } catch { stream = null; }
  }
  $('level').hidden = !(stream && showLevel(stream));
  if (stream && stream.getAudioTracks().length > 0) micStream = stream;
  watchVoice();
}

async function startCamera() {
  const video = $('camera');
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: opensOnPrepare });
  } catch {
    // The microphone may be what was refused: the camera alone still shows the framing.
    if (opensOnPrepare) { try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch { stream = null; } }
  }
  if (stream) {
    video.srcObject = stream;
    video.classList.add('is-ready');
    $('cam-name').textContent = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].label) || 'Default camera';
    nameMic();
    sayCamera('Camera on. Check your framing and light. Nothing is recording yet.');
  } else {
    // warm gradient behind stays visible
    $('cam-name').textContent = 'No camera yet';
    $('mic-name').textContent = 'Default microphone';
    sayCamera('YAP cannot see a camera yet. Allow camera access for this page, then reload. You can still start; the recording page asks again.');
  }
  cameraSettled = true;
  if (shellEl.dataset.view === 'prepare') startLevel();
  watchFace();
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
  // The experiments are read with the idea; with none, or no answer, the card shows the beats as they were kept.
  trials = await getTrials().then((answer) => answer.trials || answer || [], () => []);
  if (!Array.isArray(trials)) trials = [];
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
// Set up opens the overlay, and its own close button or Escape closes it.
$('setup-open').addEventListener('click', () => setSetup(true));
$('setup-close').addEventListener('click', () => setSetup(false));
$('beat-prev').addEventListener('click', () => showBeat(currentBeat - 1));
$('beat-next').addEventListener('click', () => showBeat(currentBeat + 1));
// The arrow keys step through the beats, as the two buttons do, unless the person is typing.
document.addEventListener('keydown', (event) => {
  if (shellEl.dataset.view !== 'prepare' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Escape' && shellEl.dataset.setup === 'open') { setSetup(false); return; }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === 'ArrowRight') showBeat(currentBeat + 1);
  else if (event.key === 'ArrowLeft') showBeat(currentBeat - 1);
});
document.addEventListener('yap:start-recording', () => { startTake(false); });

// The Recent list: the shell's two drawn rows in shell mode; outside it, the saved recordings once the three starts are shown.
renderRecent(shellMode ? DRAWN_RECENT : []);
/** One line about the camera, shown only on the presentation path. */
function sayCamera(line) {
  const note = document.querySelector('[data-testid="camera-status"]');
  if (note) note.textContent = line;
}

/**
 * /prepare/new?presentation=1: the person's own presentation, read back from the draft /present keeps. The beats
 * shown are exactly those words in that order, the panel docks low so the camera leads, and Back returns to editing.
 * A draft that is missing or cannot go live is said so, with the way back, and nothing is shown to record.
 */
function openPresentation() {
  shellEl.dataset.presentation = 'true';
  const status = el('p', 'camera-status', 'Checking your camera…');
  status.setAttribute('data-testid', 'camera-status');
  status.setAttribute('role', 'status');
  const first = document.querySelector('#prepare .panel-title');
  first.before(status);
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
  const shareHint = el('p', 'camera-status', 'Open this tab first, then choose it in the screen picker.');
  status.after(display, shareHint);
  // Keep actions entirely visible; only the beats/cues area scrolls in the dock.
  const dock = $('prepare');
  Object.assign(dock.style, { display: 'flex', flexDirection: 'column' });
  Object.assign(dock.querySelector('.prepare-grid').style, { minHeight: '0', overflowY: 'auto', flex: '1 1 auto', gridAutoRows: 'max-content' });
  Object.assign(dock.querySelector('.actions').style, { flexShrink: '0' });
  Object.assign(display.style, { padding: '0', marginBottom: '6px', fontSize: '15px', flexShrink: '0' });
  Object.assign(shareHint.style, { flexShrink: '0', fontSize: '13px' });
  // Cues chosen on the map open already pressed here; a choice already made on this page stands.
  const scope = cueScope();
  if (read.cues.length && !(scope in readCueStore().entries)) writeCues(scope, read.cues);
  openPrepare(read.view.beats, read.view.title);
}

if (presentationMode) openPresentation();
else if (ideaId) showIdea(ideaId);
else if(!shellMode&&new URLSearchParams(location.search).get('start')==='talk')openPrepare(defaultBeats());
else openHome();
if (shellMode) {
  $('cam-name').textContent = 'Built-in camera';
  $('mic-name').textContent = 'Built-in microphone';
} else {
  startCamera();
}
