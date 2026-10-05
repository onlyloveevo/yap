// The screens' side of the next-video memory loop (rules and storage: src/engine/review-memory.js).
//
//  - sendCueToPrepare: Review's "Use in next video" press. It leaves one bounded reference for Prepare and opens it.
//  - mountPrepareCard: Prepare's "From your review" card. It checks the reference against the video's own stored
//    record, shows the exact words, lets the creator edit them and choose Include or Remove, and hands the
//    chosen words to the take that is about to be started. It never touches the beats or the title.
//  - mountLiveFocus: Live's quiet "Focus for this take" panel, read from the one recording's own copy.
//
// Every word on screen is written with textContent. Nothing here calls a model, trains anything or claims a
// measured effect: the reminder is the creator's own choice to try.
import { openMediaStore } from '../../src/engine/video-import.js';
import {
  MEMORY_LIMITS, checkWording, clearPending, makeCarry, parseReference, prepareHref, provenanceLine, readPending, readTakeFocus,
  removeTakeFocus, resolveCue, storageOrNull, storageWorks, writePending,
} from '../../src/engine/review-memory.js';

const STYLE_HREF = '/ui/lib/review-memory.css';

/** The stylesheet, added once by whichever screen needs it (a page's own file is not edited for this). */
function useStyles(doc) {
  if (doc.querySelector('link[data-review-memory-style]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.dataset.reviewMemoryStyle = 'true';
  doc.head.append(link);
}

function el(doc, tag, text, hook, className) {
  const n = doc.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (hook) n.dataset.testid = hook;
  if (className) n.className = className;
  return n;
}

function button(doc, label, hook, action, className) {
  const b = el(doc, 'button', label, hook, className);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}

// ---------- Review: the press ----------

/**
 * Leave the pending reference and open Prepare. The cue is not copied anywhere yet: Prepare shows it, and
 * only a take the creator then starts carries it. Throws a plain Error when the reference or storage fails.
 * @param {{ videoId: string, cueId: string, go: (path: string) => void, session?: Storage | null }} args
 */
export function sendCueToPrepare({ videoId, cueId, go, session = storageOrNull('sessionStorage') }) {
  const href = prepareHref(videoId, cueId);
  // A press is a fresh offer: a draft from an earlier press of the same cue is not carried over. If storage
  // refuses, the address still carries the reference, so Prepare can show the card for that page view.
  writePending(session, { videoId, cueId, draft: null, included: true, at: Date.now() });
  go(href);
}

// ---------- Prepare: the card ----------

/**
 * @param {{ document: Document, search: string, session?: Storage | null, openStore?: () => Promise<any>, now?: () => string }} args
 * @returns {{ place: (view: string) => void, ready: Promise<void>, forStart: () => { ok: true, carry: object | null } | { ok: false, message: string }, consumed: () => void, state: () => object }}
 */
export function mountPrepareCard({ document: doc, search, session = storageOrNull('sessionStorage'), openStore = openMediaStore, now = () => new Date().toISOString() }) {
  const root = el(doc, 'section', null, 'review-from', 'review-from');
  root.hidden = true;
  root.setAttribute('aria-label', 'From your review');
  let ref = null;
  let resolved = null;
  let included = true;
  let draft = null;
  let note = '';
  let textarea = null;
  let counter = null;

  const state = () => ({ ref, included, draft, hasCard: Boolean(resolved), note });

  function persist() {
    if (ref) writePending(session, { videoId: ref.videoId, cueId: ref.cueId, draft, included, at: Date.now() });
  }
  function fieldValue() {
    return textarea ? textarea.value : draft !== null ? draft : resolved ? resolved.accepted : '';
  }

  function render() {
    root.replaceChildren();
    root.hidden = !resolved && !note;
    if (note && !resolved) {
      root.append(el(doc, 'h2', 'From your review', null, 'review-from-title'), el(doc, 'p', note, 'review-from-note', 'review-from-note'));
      return;
    }
    if (!resolved) return;
    root.append(el(doc, 'h2', 'From your review', 'review-from-title', 'review-from-title'));
    root.append(el(doc, 'p', `“${resolved.source.title}”`, 'review-from-source', 'review-from-source'));
    const asked = resolved.source.question ? ` · your question: “${resolved.source.question}”` : '';
    root.append(el(doc, 'p', `A next-video cue you accepted${asked}`, 'review-from-detail', 'review-from-detail review-fine'));
    const bodyBox = el(doc, 'div', null, 'review-from-body', 'review-from-body');
    if (included) {
      const label = el(doc, 'label', 'Reminder for this take (your words, edit if you like)', null, 'review-from-label');
      textarea = el(doc, 'textarea', null, 'review-from-text', 'review-from-text');
      textarea.rows = 3;
      textarea.value = draft !== null ? draft : resolved.accepted;
      textarea.setAttribute('aria-label', 'Reminder for this take');
      counter = el(doc, 'p', null, 'review-from-count', 'review-from-count review-fine');
      const refresh = () => {
        const check = checkWording(textarea.value);
        const len = textarea.value.trim().length;
        counter.textContent = check.ok ? `${len} / ${MEMORY_LIMITS.textChars}` : check.message;
        counter.dataset.invalid = check.ok ? 'false' : 'true';
        textarea.setAttribute('aria-invalid', String(!check.ok));
        edited.hidden = textarea.value.trim() === resolved.accepted;
      };
      const edited = el(doc, 'button', 'Use the words I accepted', 'review-from-reset', 'review-from-reset');
      edited.type = 'button';
      edited.addEventListener('click', () => { textarea.value = resolved.accepted; draft = null; persist(); refresh(); });
      textarea.addEventListener('input', () => { draft = textarea.value; persist(); refresh(); });
      bodyBox.append(label, textarea, counter, edited);
      refresh();
      root.append(bodyBox);
      root.append(el(doc, 'p', 'Shown to you in Live while you record this take. It stays out of your video, and your title and beats stay as you wrote them.', 'review-from-promise', 'review-from-detail review-fine'));
      const row = el(doc, 'div', null, null, 'review-from-row');
      const inc = button(doc, 'Included', 'review-from-include', () => {}, 'review-from-include is-on');
      inc.setAttribute('aria-pressed', 'true');
      const rem = button(doc, 'Remove', 'review-from-remove', () => { draft = fieldValue(); included = false; persist(); render(); rem2Focus(); });
      rem.setAttribute('aria-pressed', 'false');
      row.append(inc, rem);
      root.append(row);
    } else {
      textarea = null;
      counter = null;
      root.append(el(doc, 'p', 'Removed from this take. Nothing will be copied, and your cue is still in Review.', 'review-from-removed', 'review-from-detail'));
      const row = el(doc, 'div', null, null, 'review-from-row');
      const inc = button(doc, 'Include it again', 'review-from-include', () => { included = true; persist(); render(); }, 'review-from-include');
      inc.setAttribute('aria-pressed', 'false');
      const rem = button(doc, 'Removed', 'review-from-remove', () => {}, 'review-from-remove is-on');
      rem.setAttribute('aria-pressed', 'true');
      rem.disabled = true;
      row.append(inc, rem);
      root.append(row);
    }
  }
  function rem2Focus() {
    const inc = root.querySelector('[data-testid="review-from-include"]');
    if (inc) inc.focus();
  }

  const parsed = parseReference(search);
  const stored = readPending(session);
  const ready = (async () => {
    if (parsed.present && !parsed.ok) {
      note = parsed.message;
      render();
      return;
    }
    if (parsed.present) {
      ref = { videoId: parsed.videoId, cueId: parsed.cueId };
      // The same cue offered again keeps the draft and the choice made on this page; another cue starts fresh.
      if (stored && stored.videoId === ref.videoId && stored.cueId === ref.cueId) { draft = stored.draft; included = stored.included; }
    } else if (stored) {
      ref = { videoId: stored.videoId, cueId: stored.cueId };
      draft = stored.draft;
      included = stored.included;
    } else {
      return;
    }
    let record = null;
    try {
      const store = await openStore();
      record = await store.get(ref.videoId);
    } catch {
      note = 'This browser would not let YAP read your saved video, so the reminder was not added. Nothing was lost.';
      ref = null;
      render();
      return;
    }
    const found = resolveCue(record, ref.videoId, ref.cueId);
    if (!found.ok) {
      note = found.message;
      ref = null;
      clearPending(session);
      render();
      return;
    }
    resolved = found;
    if (draft !== null && !checkWording(draft).ok && draft.trim() === '') draft = null;
    persist();
    render();
  })();

  return {
    ready,
    state,
    /** Put the card where the current view has room for it: under the title, or at the top of the cues column. */
    place(view) {
      const panel = doc.getElementById(view);
      if (!panel) return;
      useStyles(doc);
      const column = view === 'prepare' ? panel.querySelector('.cues') : null;
      if (column) column.prepend(root);
      else panel.querySelector('.panel-title').after(root);
    },
    /** What the take about to start carries: nothing when removed or absent, or the checked reminder. */
    forStart() {
      if (!resolved || !included) return { ok: true, carry: null };
      const made = makeCarry({ source: resolved.source, accepted: resolved.accepted, text: fieldValue(), now: now() });
      if (!made.ok) return { ok: false, message: `${made.message} (Or press Remove to start without it.)` };
      if (!storageWorks(storageOrNull('localStorage'))) {
        return { ok: false, message: 'This browser is not letting YAP keep a reminder for the take (storage is blocked), so it would not show in Live. Press Remove to start without it.' };
      }
      return { ok: true, carry: made.carry };
    },
    /** A take that carries the reminder has started: the offer is spent, so the next Prepare begins clean. */
    consumed() { clearPending(session); },
  };
}

// ---------- Live: the quiet panel ----------

const LONG = 90;

/**
 * Show the reminder this one recording carries, if it carries one. A recording with no copy shows nothing.
 * @returns {{ shown: boolean, dispose: () => void }}
 */
export function mountLiveFocus({ document: doc, recordingId, storage = storageOrNull('localStorage'), host = doc.querySelector('.live-shell') }) {
  const carry = readTakeFocus(storage, recordingId);
  if (!carry || !host) return { shown: false, dispose() {} };
  useStyles(doc);
  const root = el(doc, 'aside', null, 'review-focus', 'review-focus glass');
  root.setAttribute('aria-label', 'Focus for this take');
  const head = el(doc, 'div', null, null, 'review-focus-head');
  head.append(el(doc, 'span', 'Focus for this take', 'review-focus-title', 'review-focus-title'));
  const long = carry.text.length > LONG;
  const words = el(doc, 'p', carry.text, 'review-focus-text', 'review-focus-text');
  const from = el(doc, 'p', provenanceLine(carry), 'review-focus-source', 'review-focus-source');
  const more = el(doc, 'button', null, 'review-focus-toggle', 'review-focus-toggle');
  more.type = 'button';
  const setOpen = (open) => {
    root.dataset.open = String(open);
    more.textContent = open ? 'Less' : 'More';
    more.setAttribute('aria-expanded', String(open));
  };
  more.setAttribute('aria-controls', 'review-focus-body');
  setOpen(!long);
  more.hidden = !long;
  more.addEventListener('click', () => setOpen(root.dataset.open !== 'true'));
  const body = el(doc, 'div', null, null, 'review-focus-body');
  body.id = 'review-focus-body';
  body.append(words, from);
  const drop = button(doc, 'Not for this take', 'review-focus-remove', () => {
    const done = removeTakeFocus(storage, recordingId);
    if (done.ok) { root.remove(); } else { from.textContent = done.message; }
  }, 'review-focus-remove');
  head.append(more);
  root.append(head, body, drop);
  // Wide screens: beside the camera, under the Live UI box. Narrow ones: in the cue stack, above the beat card, so it
  // can never sit on the top controls or the camera's centre.
  const stack = doc.querySelector('.cue-area');
  const narrow = globalThis.matchMedia ? globalThis.matchMedia('(max-width: 900px)') : null;
  const place = () => {
    if (narrow && narrow.matches && stack) stack.prepend(root);
    else host.append(root);
  };
  place();
  if (narrow && narrow.addEventListener) narrow.addEventListener('change', place);
  return { shown: true, dispose() { if (narrow && narrow.removeEventListener) narrow.removeEventListener('change', place); root.remove(); } };
}
