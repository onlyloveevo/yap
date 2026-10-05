// Rehearsal: the prepare screen as a simulated Live mode (Loom 7:42-8:06). The person's own camera is the canvas, a
// small cue card sits low-centre, a thin beat timeline runs along the bottom and Talk to YAP is top-right. Nothing is
// recording here: no MediaRecorder, no save, no upload, no microphone. Start recording makes the Recording (wire.js) and
// opens the existing record page, so the verified capture pipeline is untouched.
//
// This module builds the rehearsal screen around the stand-in's own elements (beat list, chips, Start, Back are moved,
// not replaced, so every id and data-testid hook stays). It holds the beats being rehearsed, the wording edits with
// Apply and Undo, and the Talk to YAP conversation. The coach is the app's own /api/model task 'coach' (the same
// contract Live uses, src/engine/live-refine.js): an answer shown here came from the provider, and a proposal is only
// ever applied by the person pressing Apply. Nothing here senses the face or claims to.
//
// Words are written with textContent, never as markup. sessionStorage only, one key, bounded.
import {
  COACH_LIMITS, REPLY_FAILURES, appendTurn, applyRevision, canUndo, createRefinement, recentTurns, summarize, undoRevision, validateCoachFields, validateSaved,
} from '../../src/engine/live-refine.js';
import { DELIVERY_CUES, DELIVERY_DEFAULTS } from '../../src/engine/delivery.js';
import { COPY, browserSpeech } from './live-refine.js';

const STYLES = ['/ui/lib/live-refine.css', '/ui/lib/prepare-rehearsal.css'];
const STORE_KEY = 'yap-prepare-rehearsal:v1';
const STORE_SCOPES = 12;
export const MODE_LINE = 'Rehearsal';
export const NOTHING_LINE = 'Nothing is recording.';

/** One beat's words as the coach and the editor see them: its talking points, one per line. */
export const wordsOf = (beat) => (beat && Array.isArray(beat.points) ? beat.points.join('\n') : '');
/** Words back into talking points: one per non-empty line, the person's own words uncut. */
export const pointsFromWords = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export const beatIdOf = (i) => `s${i + 1}`;
export const hashText = (text) => { let h = 2166136261; for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0; return h.toString(36); };

/**
 * A plain, exact cue command ("turn off smile", "add pause") against the six known cues, or null. Anything that is not
 * exactly a known cue name goes to the coach instead: nothing is guessed.
 * @returns {{ on: boolean, kind: string, text: string } | null}
 */
export function parseCueCommand(input, cues = DELIVERY_CUES) {
  const t = String(input ?? '').trim().toLowerCase().replace(/[.!?\s]+$/, '').replace(/^(?:please|can you|could you|yap)[,\s]+/, '');
  const m = /^(turn off|switch off|turn on|switch on|remove|drop|add|enable|disable|stop using|use|i (?:don't|do not|dont) (?:like|want))\s+(?:the\s+)?(.+?)(?:\s+cue)?$/.exec(t.replace(/\u2019/g, "'"));
  if (!m) return null;
  const on = /^(turn on|switch on|add|enable|use)$/.test(m[1]);
  const name = m[2].trim();
  const cue = cues.find((c) => c.text.toLowerCase() === name || c.kind === name || c.kind.replace(/-/g, ' ') === name);
  return cue ? { on, kind: cue.kind, text: cue.text } : null;
}

/** How long one coach request may take before it is given up on (a shorter one may be injected). */
export const ASK_TIMEOUT_MS = 95000;
const TIMED_OUT = 'YAP took too long to answer, so nothing changed. Your words are kept in the box. Press Send to try again.';

const el = (doc, tag, cls, text, testid) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  if (testid) n.setAttribute('data-testid', testid);
  return n;
};
const button = (doc, cls, text, testid, label) => {
  const b = el(doc, 'button', cls, text, testid);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

export function useStyles(doc) {
  for (const href of STYLES) {
    if (doc.querySelector(`link[href="${href}"]`)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.append(link);
  }
}

// ---------- the camera note: visible on every route ----------

/** The one camera line (and Retry camera) every view of this page shows. Moves into the rehearsal header on that view. */
export function createCameraNote(doc, shell, { onRetry }) {
  const root = el(doc, 'div', 'camera-note');
  const line = el(doc, 'p', 'camera-status', 'Checking your camera…', 'camera-status');
  line.setAttribute('role', 'status');
  const retry = button(doc, 'camera-retry', 'Retry camera', 'camera-retry');
  retry.hidden = true;
  retry.addEventListener('click', () => onRetry());
  root.append(line, retry);
  shell.append(root);
  return {
    root,
    say(text, { failed = false } = {}) { line.textContent = text; root.dataset.state = failed ? 'failed' : 'ok'; retry.hidden = !failed; },
    place(host) { if (host) host.append(root); else shell.append(root); },
  };
}

export function cameraFailureLine(err) {
  const name = err && err.name;
  const tail = ' You can still rehearse and edit your words. Nothing is recording.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Camera access was blocked. Allow the camera for this page in your browser, then press Retry camera.${tail}`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No camera was found. Connect one, then press Retry camera.${tail}`;
  if (name === 'NotReadableError' || name === 'AbortError') return `Your camera is busy in another app. Close it, then press Retry camera.${tail}`;
  if (name === 'unsupported') return `This browser cannot open a camera here.${tail}`;
  return `The camera did not start. Press Retry camera.${tail}`;
}

// ---------- storage ----------

function storeRead(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORE_KEY) || 'null');
    if (!raw || raw.v !== 1 || typeof raw.entries !== 'object' || raw.entries === null || !Array.isArray(raw.order)) return { v: 1, entries: {}, order: [] };
    const entries = {};
    for (const scope of raw.order.filter((s) => typeof s === 'string' && raw.entries[s] && typeof raw.entries[s] === 'object').slice(-STORE_SCOPES)) entries[scope] = raw.entries[scope];
    return { v: 1, entries, order: Object.keys(entries) };
  } catch { return { v: 1, entries: {}, order: [] }; }
}
function storeWrite(storage, scope, entry) {
  try {
    const store = storeRead(storage);
    store.order = store.order.filter((s) => s !== scope);
    delete store.entries[scope];
    if (entry) { store.order.push(scope); store.entries[scope] = entry; store.order = store.order.slice(-STORE_SCOPES); }
    storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* storage refused: the rehearsal still stands on this page */ }
}

// ---------- the rehearsal ----------

/**
 * @param {object} o
 * @param {Document} o.document
 * @param {HTMLElement} o.shell  the page's #shell
 * @param {HTMLElement} o.section  the stand-in's #prepare section, which becomes the rehearsal
 * @param {{ cues: () => string[], setCues: (kinds: string[]) => void, onChange: (beats: any[]) => void, scope: () => string | null }} o.hooks
 */
export function mountRehearsal({ document: doc, shell, section, hooks, speech = browserSpeech(), fetchImpl = globalThis.fetch.bind(globalThis), storage = null, timeoutMs = ASK_TIMEOUT_MS }) {
  useStyles(doc);
  const $ = (id) => doc.getElementById(id);
  const startBtn = $('start-recording');
  const backBtn = $('back-home');
  const title = $('prepare-title');
  const grid = section.querySelector('.prepare-grid');
  const oldActions = section.querySelector('.actions');

  let base = [], beats = [], selected = 0, rec = createRefinement(null), drafts = {}, scope = null, baseHash = '', editSeq = 0;
  let pending = null, proposal = null, seq = 0, recognizer = null, lastCue = null, destroyed = false;
  const MAX_CUES = DELIVERY_DEFAULTS.max;

  section.classList.remove('panel', 'panel-wide', 'glass');
  section.classList.add('rehearsal');
  section.setAttribute('aria-label', 'Rehearsal');
  section.removeAttribute('aria-labelledby');
  title.classList.add('rh-title');

  // --- top left: mode, title, way back. Top right: Talk to YAP and settings.
  const mode = el(doc, 'p', 'rh-mode', null, 'rehearsal-mode');
  mode.append(el(doc, 'strong', '', MODE_LINE), el(doc, 'span', '', ` · ${NOTHING_LINE}`));
  const noteHost = el(doc, 'div', 'rh-camera-host');
  const extras = el(doc, 'div', 'rh-extras');
  backBtn.classList.add('rh-back');
  const left = el(doc, 'div', 'rh-left');
  left.append(mode, title, backBtn, noteHost, extras);
  const talk = button(doc, 'help glass coach-open', 'Talk to YAP', 'coach-open', 'Talk to YAP');
  talk.setAttribute('aria-expanded', 'false');
  talk.setAttribute('aria-controls', 'coach-panel');
  const settingsBtn = button(doc, 'menu glass rh-settings-btn', '···', 'rehearsal-settings', 'Settings');
  settingsBtn.setAttribute('aria-expanded', 'false');
  const settings = el(doc, 'div', 'rh-settings glass', null, 'rehearsal-settings-panel');
  settings.hidden = true;
  const sampleSlot = el(doc, 'div', 'rh-sample-slot');
  settings.append(el(doc, 'p', 'rh-settings-title', 'Settings'), el(doc, 'p', 'rh-settings-note', 'Rehearsal never records. The sample take below is a different video, kept only for trying the editor.'), sampleSlot);
  const right = el(doc, 'div', 'rh-right');
  right.append(talk, settingsBtn, settings);

  // --- the stage: cue pills, the small card, controls, the beat timeline
  const pills = el(doc, 'div', 'rh-pills', null, 'rehearsal-cues');
  const cardLabel = el(doc, 'span', 'rh-card-label', '', 'rehearsal-position');
  const editToggle = button(doc, 'rh-link', 'Edit beats & cues', 'rehearsal-edit-toggle');
  editToggle.setAttribute('aria-expanded', 'false');
  editToggle.setAttribute('aria-controls', 'rehearsal-edit');
  const cardHead = el(doc, 'div', 'rh-card-head');
  cardHead.append(cardLabel, editToggle);
  const cardTitle = el(doc, 'h2', 'rh-card-title', '', 'rehearsal-beat-title');
  const cardPoints = el(doc, 'ul', 'rh-points', null, 'rehearsal-points');
  const cardEdited = el(doc, 'span', 'rh-edited', 'edited', 'rehearsal-edited');
  cardEdited.hidden = true;
  const card = el(doc, 'div', 'rh-card glass', null, 'rehearsal-card');
  card.append(el(doc, 'div', 'rh-rule'), (() => { const c = el(doc, 'div', 'rh-card-body'); c.append(cardHead, cardTitle, cardPoints, cardEdited); return c; })());
  const prev = button(doc, 'rh-pill glass', '‹ Previous', 'rehearsal-prev', 'Previous beat');
  const next = button(doc, 'rh-pill glass', 'Next ›', 'rehearsal-next', 'Next beat');
  startBtn.classList.add('rh-start');
  const controls = el(doc, 'div', 'rh-controls');
  controls.append(prev, next, startBtn);
  const startNote = el(doc, 'p', 'rh-start-note', '', 'rehearsal-start-note');
  startNote.setAttribute('role', 'status');
  const stage = el(doc, 'div', 'rh-stage');
  stage.append(pills, card, controls, startNote);
  const rail = el(doc, 'nav', 'rh-rail', null, 'rehearsal-rail');
  rail.setAttribute('aria-label', 'Story beats');

  // --- the edit drawer: the editor, the stand-in's beat list and its delivery chips
  const drawer = el(doc, 'aside', 'rh-drawer glass', null, 'rehearsal-edit');
  drawer.id = 'rehearsal-edit';
  drawer.setAttribute('aria-label', 'Edit beats and cues');
  drawer.hidden = true;
  const editHead = el(doc, 'div', 'rh-drawer-head');
  const editClose = button(doc, 'rh-x', '×', 'rehearsal-edit-close', 'Close editing');
  editHead.append(el(doc, 'strong', '', 'Edit beats & cues'), editClose);
  const editLabel = el(doc, 'label', 'rh-editor-label', '', 'rehearsal-editor-label');
  const editor = el(doc, 'textarea', 'rh-editor', null, 'rehearsal-editor');
  editor.rows = 4;
  editor.id = 'rehearsal-editor';
  editLabel.htmlFor = 'rehearsal-editor';
  const apply = button(doc, 'rh-btn rh-btn-main', 'Apply', 'rehearsal-apply');
  const discard = button(doc, 'rh-btn', 'Discard edit', 'rehearsal-discard');
  const undoBtn = button(doc, 'rh-btn', 'Undo', 'rehearsal-undo');
  const editNote = el(doc, 'p', 'rh-note', '', 'rehearsal-edit-note');
  editNote.setAttribute('role', 'status');
  const editRow = el(doc, 'div', 'rh-row');
  editRow.append(apply, discard, undoBtn);
  const editorBox = el(doc, 'div', 'rh-editor-box');
  editorBox.append(editLabel, editor, editRow, editNote);
  drawer.append(editHead, editorBox);
  if (grid) drawer.append(grid);

  section.replaceChildren(left, right, stage, rail, drawer);
  if (oldActions) oldActions.remove();

  // --- Talk to YAP: the same coach panel and test ids Live uses, in rehearsal
  const status = el(doc, 'p', 'coach-status', `${MODE_LINE}. ${NOTHING_LINE} YAP only changes your beat wording and cues.`, 'coach-status');
  status.setAttribute('role', 'status');
  const beatTitle = el(doc, 'strong', '', '', 'coach-beat-title');
  const beatWords = el(doc, 'p', 'coach-beat-words', '', 'coach-beat-words');
  const log = el(doc, 'div', 'coach-log', null, 'coach-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.tabIndex = 0;
  log.setAttribute('aria-label', 'Conversation with YAP');
  const note = el(doc, 'p', 'coach-note', '', 'coach-note');
  note.setAttribute('role', 'status');
  const propBox = el(doc, 'section', 'coach-proposal', null, 'coach-proposal');
  propBox.hidden = true;
  propBox.setAttribute('aria-label', 'Suggested wording');
  const propText = el(doc, 'textarea', '', null, 'coach-proposal-text');
  propText.rows = 3;
  propText.setAttribute('aria-label', 'Suggested wording, editable');
  const propOrig = el(doc, 'p', 'coach-original', '', 'coach-original');
  const propApply = button(doc, 'coach-primary', 'Apply change', 'coach-apply');
  const propDismiss = button(doc, '', 'Dismiss', 'coach-dismiss');
  const propRow = el(doc, 'div', 'coach-row');
  propRow.append(propApply, propDismiss);
  propBox.append(el(doc, 'span', 'coach-kicker', 'SUGGESTED WORDING — edit if you like'), propText, el(doc, 'span', 'coach-kicker', 'ORIGINAL (kept until you apply)'), propOrig, propRow);
  const coachUndo = button(doc, '', 'Undo last change', 'coach-undo');
  coachUndo.hidden = true;
  const cueUndo = button(doc, '', 'Undo cue change', 'coach-cue-undo');
  cueUndo.hidden = true;
  const input = el(doc, 'textarea', '', null, 'coach-input');
  input.rows = 2;
  input.setAttribute('aria-label', 'Tell YAP what to change or ask a question');
  input.placeholder = 'Ask, or say what to change…';
  input.maxLength = COACH_LIMITS.instructionChars;
  const send = button(doc, 'coach-primary', 'Send', 'coach-send');
  send.type = 'submit';
  const mic = button(doc, '', '🎙 Speak', 'coach-mic', 'Speak your turn (uses your microphone only when you press this)');
  mic.setAttribute('aria-pressed', 'false');
  const cancel = button(doc, '', 'Cancel', 'coach-cancel');
  cancel.hidden = true;
  const sendRow = el(doc, 'div', 'coach-row');
  sendRow.append(mic, send, cancel);
  const form = el(doc, 'form', 'coach-form');
  form.autocomplete = 'off';
  form.append(input, sendRow);
  const closeChat = button(doc, 'coach-primary coach-continue', 'Back to rehearsal', 'coach-close');
  const head = el(doc, 'div', 'coach-head');
  head.append(el(doc, 'strong', '', 'Talk to YAP'), (() => { const s = el(doc, 'span', 'coach-beat', 'Beat: '); s.append(beatTitle); return s; })());
  const panel = el(doc, 'aside', 'coach-panel glass', null, 'coach-panel');
  panel.id = 'coach-panel';
  panel.setAttribute('aria-label', 'Talk to YAP');
  panel.hidden = true;
  panel.append(head, status, beatWords, log, note, propBox, coachUndo, cueUndo, form, el(doc, 'p', 'coach-slides', COPY.slides), closeChat);
  section.append(panel);

  // ----- small helpers
  const say = (text) => { note.textContent = text || ''; note.hidden = !text; };
  const sayEdit = (text) => { editNote.textContent = text || ''; };
  const idOf = (i) => beatIdOf(i);
  const labelOf = (i) => (beats[i] ? beats[i].label : '');
  const draftOf = (i) => (beats[i] && Object.prototype.hasOwnProperty.call(drafts, idOf(i)) ? drafts[idOf(i)] : null);
  const hasDraft = () => beats.some((_, i) => draftOf(i) !== null && draftOf(i) !== wordsOf(beats[i]));

  function persist() {
    if (!storage || !scope) return;
    storeWrite(storage, scope, {
      base: baseHash,
      selected,
      points: beats.map((b) => b.points),
      drafts,
      rec: { conversation: rec.conversation, revisions: rec.revisions },
    });
  }
  function restore() {
    if (!storage || !scope) return;
    const entry = storeRead(storage).entries[scope];
    if (!entry || entry.base !== baseHash || !Array.isArray(entry.points) || entry.points.length !== beats.length) return;
    if (!entry.points.every((p) => Array.isArray(p) && p.every((x) => typeof x === 'string'))) return;
    const checked = validateSaved({ baseRevision: 0, conversation: entry.rec && entry.rec.conversation, revisions: entry.rec && entry.rec.revisions, intervals: [] });
    if (!checked.ok) return;
    beats = beats.map((b, i) => ({ ...b, points: entry.points[i].slice(0, 40) }));
    rec = { ...createRefinement(scope), conversation: checked.value.conversation, revisions: checked.value.revisions };
    if (Number.isInteger(entry.selected) && entry.selected >= 0 && entry.selected < beats.length) selected = entry.selected;
    drafts = {};
    if (entry.drafts && typeof entry.drafts === 'object') for (const [k, v] of Object.entries(entry.drafts)) if (/^s\d+$/.test(k) && typeof v === 'string' && v.length <= 4000) drafts[k] = v;
  }

  // ----- render
  function renderPills() {
    pills.replaceChildren();
    const kinds = hooks.cues();
    const words = (hooks.texts && hooks.texts()) || {};
    for (const kind of kinds) {
      const cue = DELIVERY_CUES.find((c) => c.kind === kind);
      if (cue) pills.append(el(doc, 'span', 'rh-cue-pill glass', typeof words[kind] === 'string' && words[kind] ? words[kind] : cue.text, 'rehearsal-cue'));
    }
    pills.hidden = kinds.length === 0;
  }
  function renderRail() {
    rail.replaceChildren();
    beats.forEach((b, i) => {
      const node = button(doc, 'rh-node', null, 'rehearsal-beat');
      node.dataset.state = i === selected ? 'current' : i < selected ? 'done' : 'ahead';
      const edited = canUndo(rec, idOf(i));
      node.setAttribute('aria-label', `${b.label}${edited ? ', edited' : ''}, ${i === selected ? 'current' : i < selected ? 'before' : 'ahead'}`);
      if (i === selected) node.setAttribute('aria-current', 'step');
      node.append(el(doc, 'span', 'rh-dot'), el(doc, 'span', 'rh-name', b.label));
      node.addEventListener('click', () => select(i));
      rail.append(node);
    });
    rail.style.setProperty('--rh-count', String(Math.max(beats.length, 1)));
  }
  function renderCard() {
    const b = beats[selected];
    if (!b) {
      cardLabel.textContent = 'No beats yet';
      cardTitle.textContent = '';
      cardPoints.replaceChildren();
      cardEdited.hidden = true;
      return;
    }
    cardLabel.textContent = `Beat ${selected + 1} of ${beats.length}`;
    cardTitle.textContent = b.label;
    cardPoints.replaceChildren(...b.points.map((p) => { const li = el(doc, 'li', 'rh-point', null, 'rehearsal-point'); li.append(el(doc, 'span', 'rh-point-dot'), el(doc, 'span', '', p)); return li; }));
    cardEdited.hidden = !canUndo(rec, idOf(selected));
  }
  function renderEditor() {
    const b = beats[selected];
    editLabel.textContent = b ? `Words for “${b.label}” (one talking point per line)` : '';
    editor.disabled = !b;
    if (!b) { editor.value = ''; return; }
    const d = draftOf(selected);
    if (doc.activeElement !== editor || editor.value !== (d ?? wordsOf(b))) editor.value = d !== null ? d : wordsOf(b);
    const dirty = d !== null && d !== wordsOf(b);
    apply.disabled = !dirty;
    discard.disabled = !dirty;
    undoBtn.disabled = !canUndo(rec, idOf(selected));
    startNote.textContent = hasDraft() ? 'You have an edit that is not applied. Apply or Discard it, then Start.' : '';
  }
  function renderChat() {
    const b = beats[selected];
    beatTitle.textContent = b ? b.label : '';
    beatWords.textContent = b ? wordsOf(b) || b.label : '';
    log.replaceChildren(...rec.conversation.map((t) => {
      const m = el(doc, 'div', `coach-msg coach-${t.role}`, null, `coach-msg-${t.role}`);
      m.append(el(doc, 'span', 'coach-who', t.role === 'user' ? 'You' : 'YAP'), el(doc, 'span', '', t.text));
      return m;
    }));
    log.scrollTop = log.scrollHeight;
    propBox.hidden = !proposal;
    propOrig.textContent = proposal ? proposal.original : '';
    propApply.disabled = !proposal;
    coachUndo.hidden = !(b && canUndo(rec, idOf(selected)));
    cueUndo.hidden = !lastCue;
    send.disabled = Boolean(pending);
    cancel.hidden = !pending;
    mic.disabled = !speech.recognitionSupported || Boolean(pending);
    mic.title = speech.recognitionSupported ? '' : COPY.noVoice;
  }
  function render() {
    renderPills();
    renderRail();
    renderCard();
    renderEditor();
    renderChat();
    prev.disabled = selected <= 0;
    next.disabled = selected >= beats.length - 1;
  }

  // ----- beats and selection
  function emit() { hooks.onChange(beats.map((b) => ({ ...b, points: [...b.points] }))); }
  function dropAsk(why) {
    if (pending) { pending.controller.abort(); pending = null; }
    if (proposal) { proposal = null; propText.value = ''; }
    if (why) say(why);
  }
  function select(i) {
    if (i < 0 || i >= beats.length || i === selected) return;
    const had = pending || proposal;
    dropAsk(had ? `Now on “${labelOf(i)}”. The earlier request was dropped.` : '');
    selected = i;
    sayEdit('');
    persist();
    render();
  }
  function setBeats(original, scopeKey) {
    dropAsk('');
    base = original.map((b) => ({ ...b, points: [...b.points] }));
    beats = base.map((b) => ({ ...b, points: [...b.points] }));
    scope = scopeKey;
    baseHash = hashText(JSON.stringify(base.map((b) => [b.label, b.points, b.preparedAngles || null])));
    selected = 0;
    rec = createRefinement(scopeKey);
    drafts = {};
    lastCue = null;
    restore();
    say('');
    sayEdit('');
    render();
    emit();
  }

  // ----- applying words: one path for typed edits and for the coach's proposals
  function applyWords(i, text) {
    const b = beats[i];
    if (!b) return false;
    const from = wordsOf(b);
    const points = pointsFromWords(text);
    if (!points.length) { sayEdit('A beat needs some words. Edit them, or Discard.'); return false; }
    const to = points.join('\n');
    if (to.length > COACH_LIMITS.beatChars) { sayEdit(`Keep a beat under ${COACH_LIMITS.beatChars} characters; it is not cut for you.`); return false; }
    if (to === from) { delete drafts[idOf(i)]; sayEdit('That is already the wording.'); renderEditor(); return false; }
    try {
      rec = applyRevision(rec, { beatId: idOf(i), from, to }).next;
    } catch (err) { sayEdit(err instanceof Error ? err.message : 'Could not apply that.'); return false; }
    beats[i] = { ...b, points };
    delete drafts[idOf(i)];
    editSeq += 1;
    persist();
    render();
    emit();
    return true;
  }
  function undoWords(i) {
    const id = idOf(i);
    let result;
    try { result = undoRevision(rec, { beatId: id }); } catch (err) { sayEdit(err instanceof Error ? err.message : 'Could not undo that.'); return; }
    if (!result) return;
    rec = result.next;
    beats[i] = { ...beats[i], points: pointsFromWords(result.revision.to) };
    delete drafts[id];
    editSeq += 1;
    dropAsk('');
    persist();
    render();
    emit();
    sayEdit('Restored the previous wording.');
    say('Restored the previous wording.');
  }

  editor.addEventListener('input', () => {
    if (!beats[selected]) return;
    const id = idOf(selected);
    if (editor.value === wordsOf(beats[selected])) delete drafts[id]; else drafts[id] = editor.value;
    editSeq += 1; // a typed edit is the person's own: a coach answer still on its way must not overwrite it
    if (proposal && proposal.idx === selected) { proposal = null; propText.value = ''; say('You edited this beat, so the earlier suggestion was dropped.'); }
    sayEdit('');
    persist();
    renderEditor();
    renderChat();
  });
  apply.addEventListener('click', () => { applyWords(selected, editor.value); });
  discard.addEventListener('click', () => { delete drafts[idOf(selected)]; editSeq += 1; sayEdit(''); persist(); render(); });
  undoBtn.addEventListener('click', () => undoWords(selected));
  coachUndo.addEventListener('click', () => undoWords(selected));
  prev.addEventListener('click', () => select(selected - 1));
  next.addEventListener('click', () => select(selected + 1));

  // ----- drawers: one open at a time
  function open(which) {
    const wants = { edit: drawer, chat: panel, settings: settings };
    for (const [name, node] of Object.entries(wants)) node.hidden = name !== which ? true : !node.hidden;
    editToggle.setAttribute('aria-expanded', String(!drawer.hidden));
    talk.setAttribute('aria-expanded', String(!panel.hidden));
    settingsBtn.setAttribute('aria-expanded', String(!settings.hidden));
    section.dataset.open = !drawer.hidden ? 'edit' : !panel.hidden ? 'chat' : !settings.hidden ? 'settings' : '';
    if (!drawer.hidden) editor.focus(); else if (!panel.hidden) input.focus();
    if (drawer.hidden && panel.hidden) stopVoice();
  }
  editToggle.addEventListener('click', () => open('edit'));
  editClose.addEventListener('click', () => { drawer.hidden = false; open('edit'); });
  talk.addEventListener('click', () => open('chat'));
  closeChat.addEventListener('click', () => { panel.hidden = false; open('chat'); });
  settingsBtn.addEventListener('click', () => open('settings'));
  section.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pending) { cancel.click(); e.stopPropagation(); return; }
      for (const [node, name] of [[drawer, 'edit'], [panel, 'chat'], [settings, 'settings']]) if (!node.hidden) { node.hidden = false; open(name); return; }
    }
  });
  doc.addEventListener('keydown', (e) => {
    if (section.hidden || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight') select(selected + 1);
    else if (e.key === 'ArrowLeft') select(selected - 1);
  });

  // ----- delivery cues by plain command (no provider, no sensing)
  function localCue(cmd) {
    const before = hooks.cues();
    const has = before.includes(cmd.kind);
    say('');
    if (cmd.on && has) { say(`The ${cmd.text} cue is already on. Nothing changed.`); return; }
    if (!cmd.on && !has) { say(`The ${cmd.text} cue is already off. Nothing changed.`); return; }
    if (cmd.on && before.length >= MAX_CUES) { say(`${MAX_CUES} cues are already on. Turn one off first. Nothing changed.`); return; }
    const after = cmd.on ? DELIVERY_CUES.map((c) => c.kind).filter((k) => before.includes(k) || k === cmd.kind) : before.filter((k) => k !== cmd.kind);
    hooks.setCues(after);
    lastCue = { before, after: hooks.cues() };
    say(`${cmd.on ? 'Turned on' : 'Turned off'} the ${cmd.text} cue for your take. It is a reminder you chose; YAP does not detect your face. You can undo it.`);
    render();
  }
  cueUndo.addEventListener('click', () => {
    if (!lastCue) return;
    const now = hooks.cues();
    if (now.join() !== lastCue.after.join()) { lastCue = null; say('The cues changed since, so there is nothing to undo here. Use Edit beats & cues.'); render(); return; }
    hooks.setCues(lastCue.before);
    lastCue = null;
    say('Restored your earlier cues.');
    render();
  });

  // ----- Talk to YAP: the real coach, one turn at a time
  const stopVoice = () => {
    if (recognizer) { const r = recognizer; recognizer = null; r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch { /* already stopped */ } }
    mic.setAttribute('aria-pressed', 'false');
  };
  function coachBody(text) {
    const b = beats[selected];
    return {
      task: 'coach',
      beat: { id: idOf(selected), title: summarize(b.label, COACH_LIMITS.titleChars), text: wordsOf(b) || b.label },
      beats: beats.map((x, i) => ({ id: idOf(i), title: summarize(x.label, COACH_LIMITS.titleChars), summary: summarize(wordsOf(x) || x.label) })),
      spoken: '',
      turns: recentTurns(rec, COACH_LIMITS.maxTurns),
      instruction: text,
    };
  }
  async function submit(raw) {
    const text = String(raw || '').trim();
    if (!text || pending || destroyed || !beats[selected]) return;
    stopVoice();
    const cmd = parseCueCommand(text);
    if (cmd) { input.value = ''; localCue(cmd); return; }
    say('');
    const body = coachBody(text);
    const checked = validateCoachFields(body);
    if (!checked.ok) { say(checked.error); return; }
    const idx = selected, id = idOf(idx), startSeq = editSeq, token = ++seq, controller = new AbortController(), original = body.beat.text;
    pending = { token, idx, controller };
    proposal = null;
    render();
    let answer = null, failure = null, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl('/api/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) failure = data.error || COPY.unavailable;
      else if (!data.coach || data.source === 'none') failure = COPY.unavailable;
      else if (!data.coach.ok) failure = REPLY_FAILURES[data.coach.reason] || COPY.unavailable;
      else answer = { ...data.coach, source: data.source };
    } catch (err) { failure = timedOut ? TIMED_OUT : err && err.name === 'AbortError' ? null : COPY.unavailable; }
    finally { clearTimeout(timer); }
    if (destroyed || !pending || pending.token !== token) return; // cancelled, moved to another beat, or left: nothing lands
    pending = null;
    if (failure) { input.value = text; say(failure); render(); input.focus(); return; }
    const prop = answer.proposal && answer.proposal.beatId === id && typeof answer.proposal.text === 'string' ? answer.proposal : null;
    try {
      rec = appendTurn(appendTurn(rec, { role: 'user', text, beatId: id }), { role: 'assistant', text: String(answer.answer), beatId: id, source: answer.source, proposal: prop });
    } catch { /* a turn that cannot be kept is still shown below */ }
    input.value = '';
    const fresh = editSeq === startSeq && selected === idx;
    if (prop && fresh) { proposal = { idx, beatId: id, text: prop.text, original, seq: startSeq }; propText.value = prop.text; }
    else if (prop) say('You edited this beat meanwhile, so the suggestion was dropped. Your words are untouched.');
    persist();
    render();
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); } });
  cancel.addEventListener('click', () => { if (pending) { pending.controller.abort(); pending = null; say('Cancelled. Nothing changed. Your words are kept.'); render(); } });
  propDismiss.addEventListener('click', () => { proposal = null; propText.value = ''; say('Dismissed. Your wording is unchanged.'); render(); });
  propApply.addEventListener('click', () => {
    if (!proposal) return;
    const prop = proposal;
    if (selected !== prop.idx || editSeq !== prop.seq) { proposal = null; say('Your words changed since this suggestion, so it was dropped. Nothing was overwritten.'); render(); return; }
    const text = propText.value.trim();
    if (!text) { say('The wording is empty. Edit it or dismiss.'); return; }
    if (text.length > COACH_LIMITS.proposalChars) { say(`Keep the wording under ${COACH_LIMITS.proposalChars} characters; it is not cut for you.`); return; }
    if (applyWords(prop.idx, text)) { proposal = null; propText.value = ''; say('Applied. Undo is below if you want the earlier wording back.'); render(); }
    else say(editNote.textContent || 'That was not applied.');
  });
  mic.addEventListener('click', () => {
    if (recognizer) { stopVoice(); say(''); return; }
    if (!speech.recognitionSupported || pending) { say(COPY.noVoice); return; }
    say('');
    let r;
    try { r = speech.createRecognizer(); } catch { say(COPY.noVoice); return; }
    r.lang = 'en-US'; r.continuous = false; r.interimResults = true; recognizer = r;
    mic.setAttribute('aria-pressed', 'true');
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i += 1) t += e.results[i][0].transcript; input.value = t.trim().slice(0, COACH_LIMITS.instructionChars); };
    r.onerror = (e) => { stopVoice(); say(['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error) ? COPY.voiceDenied : `Voice stopped (${e.error || 'error'}). Type instead.`); };
    r.onend = () => { if (recognizer === r) { recognizer = null; mic.setAttribute('aria-pressed', 'false'); if (input.value.trim()) say('Check the words, edit them if needed, then Send.'); } };
    try { r.start(); } catch { stopVoice(); say(COPY.noVoice); }
  });

  render();

  return {
    setBeats,
    beats: () => beats.map((b) => ({ ...b, points: [...b.points] })),
    cuesChanged() { lastCue = null; render(); },
    /** A cue's wording was saved or reset: show the words the take will carry, keep any cue Undo. */
    wordingChanged() { renderPills(); },
    hasDraft,
    /** Called by Start: a coach turn in flight is dropped, and an edit not yet applied is not silently left behind. */
    beforeStart() {
      if (hasDraft()) { renderEditor(); if (drawer.hidden) open('edit'); return { ok: false, message: 'You have an edit that is not applied. Apply or Discard it, then Start recording.' }; }
      dropAsk('');
      stopVoice();
      render();
      return { ok: true };
    },
    clearSaved() { if (storage && scope) storeWrite(storage, scope, null); },
    sampleSlot,
    extras,
    noteHost,
    abortAll() { dropAsk(''); stopVoice(); },
    dispose() { destroyed = true; dropAsk(''); stopVoice(); },
    get selected() { return selected; },
  };
}
