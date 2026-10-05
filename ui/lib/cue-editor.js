// Delivery cue wording, edited before recording (F14, DELIV-01, D-44).
//
// The person keeps 1 to 3 of the engine's six cues and may change the exact
// words of each. The engine already takes a wording per cue
// (chooseDeliveryCues, up to DELIVERY_DEFAULTS.textChars characters); this
// module keeps the person's drafts and hands them to that same engine function,
// so what the take is recorded with is what the engine accepts, nothing faked.
//
// A draft is kept in sessionStorage under its own key, by the same scope as the
// cue choice (the idea, or the start mode and, for typed starts, a hash of the
// typed words): another idea or another start never inherits it, and the
// bundled sample take never reads it. Only the six known kinds are kept, each
// as plain text, and a wording equal to the cue's own is no draft at all (the
// original wording stays the default). A write is checked by reading it back;
// when storage refuses, saveWording says so and changes nothing.
import { DELIVERY_CUES, DELIVERY_DEFAULTS, chooseDeliveryCues } from '../../src/engine/delivery.js';

/** The key the drafts are kept under: one key, one version. */
export const WORDING_KEY = 'yap-prepare-cue-text:v1';
/** At most this many scopes are kept; the oldest go first. */
export const WORDING_SCOPES = 24;
/** The longest wording, in characters: the engine's own limit. */
export const WORDING_MAX = DELIVERY_DEFAULTS.textChars;

/** A scope is the idea (`idea:<id>`), or a start (`new:talk`, `new:<mode>:<hash of the typed words>`): wire.js's cueScope. */
const SCOPE = /^(idea:[a-z0-9-]{1,64}|new:[a-z]{1,16}(:[a-z0-9]{1,16})?)$/;
const KINDS = DELIVERY_CUES.map((cue) => cue.kind);
const ORIGINAL = Object.fromEntries(DELIVERY_CUES.map((cue) => [cue.kind, cue.text]));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const plainOf = (text) => String(text).replace(/\s+/g, ' ').trim();

/** The cue's own wording, which stays the default. */
export const originalWording = (kind) => ORIGINAL[kind];

/**
 * A wording as the person typed it, checked the way the engine will read it.
 * White space runs become one space and the ends are trimmed. Too long, empty or
 * holding a control character is refused: it is never silently cut.
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function checkWording(value) {
  if (typeof value !== 'string') return { ok: false, error: 'A cue wording is text.' };
  const plain = plainOf(value);
  if (plain === '') return { ok: false, error: 'Write the words for this cue, or press Reset to use the original.' };
  if (/\p{Cc}/u.test(plain)) return { ok: false, error: 'A cue wording is plain text.' };
  const length = Array.from(plain).length;
  if (length > WORDING_MAX) return { ok: false, error: `A cue wording is at most ${WORDING_MAX} characters (this one is ${length}).` };
  return { ok: true, value: plain };
}

/** The empty store, and the store as read: known scopes, known kinds, text within the limit. */
function readStore(storage) {
  const empty = { v: 1, entries: {}, order: [] };
  try {
    const raw = JSON.parse(storage.getItem(WORDING_KEY) || 'null');
    if (!isObject(raw) || raw.v !== 1 || !isObject(raw.entries) || !Array.isArray(raw.order)) return empty;
    const entries = {};
    for (const scope of raw.order.filter((name) => typeof name === 'string' && SCOPE.test(name) && Object.hasOwn(raw.entries, name) && isObject(raw.entries[name])).slice(-WORDING_SCOPES)) {
      const kept = {};
      for (const kind of KINDS) {
        const text = Object.hasOwn(raw.entries[scope], kind) ? raw.entries[scope][kind] : undefined;
        const checked = checkWording(text);
        if (checked.ok && checked.value !== ORIGINAL[kind]) kept[kind] = checked.value;
      }
      entries[scope] = kept;
    }
    return { v: 1, entries, order: Object.keys(entries) };
  } catch {
    return empty;
  }
}

/**
 * The drafts of a scope, `{ [kind]: wording }`: only edited cues, none when there is no draft.
 * @param {Storage | null} storage
 * @param {string | null} scope
 * @returns {Record<string, string>}
 */
export function readWording(storage, scope) {
  if (!storage || !scope) return {};
  const store = readStore(storage);
  return Object.hasOwn(store.entries, scope) ? { ...store.entries[scope] } : {};
}

/** Write a scope's drafts; true only when reading the store back gives the same drafts. */
function writeScope(storage, scope, drafts) {
  try {
    const store = readStore(storage);
    delete store.entries[scope];
    store.order = store.order.filter((name) => name !== scope);
    if (Object.keys(drafts).length > 0) {
      store.entries[scope] = drafts;
      store.order.push(scope);
    }
    store.order = store.order.slice(-WORDING_SCOPES);
    store.entries = Object.fromEntries(store.order.map((name) => [name, store.entries[name]]));
    storage.setItem(WORDING_KEY, JSON.stringify(store));
    const back = readWording(storage, scope);
    return JSON.stringify(back) === JSON.stringify(drafts);
  } catch {
    return false;
  }
}

/**
 * Keep one cue's wording for a scope. Gives `{ ok: true, wording }` (the drafts
 * of the scope now) or `{ ok: false, error }`, with nothing changed. A wording
 * equal to the cue's own removes the draft.
 * @param {Storage | null} storage
 * @param {string | null} scope
 * @param {string} kind
 * @param {unknown} text
 */
export function saveWording(storage, scope, kind, text) {
  if (!KINDS.includes(kind)) return { ok: false, error: 'That is not one of the delivery cues.' };
  const checked = checkWording(text);
  if (!checked.ok) return checked;
  if (!storage || typeof scope !== 'string' || !SCOPE.test(scope)) return { ok: false, error: 'This page cannot keep a wording right now.' };
  const drafts = readWording(storage, scope);
  if (checked.value === ORIGINAL[kind]) delete drafts[kind];
  else drafts[kind] = checked.value;
  if (!writeScope(storage, scope, drafts)) return { ok: false, error: 'YAP could not keep that wording on this device. The cue keeps its earlier wording.' };
  return { ok: true, wording: drafts };
}

/** Put one cue back to its original wording. Same answer as saveWording. */
export function resetWording(storage, scope, kind) {
  return saveWording(storage, scope, kind, ORIGINAL[kind]);
}

/** Forget a scope's drafts (the take used them). */
export function clearWording(storage, scope) {
  if (!storage || !scope) return;
  writeScope(storage, scope, {});
}

/**
 * The delivery cues of a request, with the person's wording on the cues they
 * edited. The kinds and the beats each cue was dealt to are the request's own;
 * the wording goes through the engine's chooseDeliveryCues, so it is cut,
 * cleaned and checked there. A request with no cue, or no draft, comes back as
 * it was.
 * @param {{ deliveryCues: any[], beats: any[] }} request what recordingRequest gave
 * @param {Record<string, string>} wording drafts by kind
 * @returns {any[]}
 */
export function cuesWithWording(request, wording) {
  const cues = Array.isArray(request.deliveryCues) ? request.deliveryCues : [];
  if (cues.length === 0 || !isObject(wording) || cues.every((cue) => !Object.hasOwn(wording, cue.kind))) return cues;
  const picks = cues.map((cue) => ({ kind: cue.kind, beatId: cue.beatId, text: Object.hasOwn(wording, cue.kind) ? wording[cue.kind] : cue.text }));
  return chooseDeliveryCues(/** @type {any} */ (picks), request.beats).cues;
}

const el = (document, tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The inline editor under the chips: one row for each pressed cue, with its
 * wording and an Edit button. Edit turns the row into a field with Save, Cancel
 * and Reset; Enter saves, Escape cancels. Words are written with textContent and
 * value only.
 *
 * `render` is called again whenever the pressed cues or the drafts change.
 * @param {Document} document
 * @param {HTMLElement} box the container (hidden while no cue is pressed)
 * @param {{
 *   pressed: () => string[],
 *   wording: () => Record<string, string>,
 *   save: (kind: string, text: string) => { ok: boolean, error?: string },
 *   reset: (kind: string) => { ok: boolean, error?: string },
 * }} source
 * @returns {{ render: () => void }}
 */
export function createCueEditor(document, box, source) {
  /** The kind being edited, if any, and the words typed so far: a re-render never loses them. */
  let editing = null;
  let typed = '';
  /** True from the press on Edit until its field has the focus: a re-render for another reason never takes the focus. */
  let focusField = false;

  function render() {
    const kinds = source.pressed();
    if (editing && !kinds.includes(editing)) editing = null;
    box.replaceChildren();
    box.hidden = kinds.length === 0;
    if (kinds.length === 0) return;
    const heading = el(document, 'h3', 'cue-edit-title', 'Your cue wording');
    const list = el(document, 'ul', 'cue-edit-list');
    const wording = source.wording();
    for (const kind of DELIVERY_CUES.map((cue) => cue.kind).filter((k) => kinds.includes(k))) {
      const shown = Object.hasOwn(wording, kind) ? wording[kind] : ORIGINAL[kind];
      const edited = Object.hasOwn(wording, kind);
      const row = el(document, 'li', 'cue-edit-row');
      row.setAttribute('data-testid', 'cue-edit-row');
      row.dataset.kind = kind;
      if (editing === kind) {
        const form = el(document, 'form', 'cue-edit-form');
        form.noValidate = true;
        const label = el(document, 'label', 'cue-edit-label', `${ORIGINAL[kind]}: the words you will see`);
        const id = `cue-edit-${kind}`;
        label.htmlFor = id;
        const input = /** @type {HTMLInputElement} */ (el(document, 'input', 'cue-edit-input'));
        input.id = id;
        input.type = 'text';
        input.value = typed;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('data-testid', 'cue-edit-input');
        input.setAttribute('aria-describedby', `${id}-note`);
        const note = el(document, 'p', 'cue-edit-note');
        note.id = `${id}-note`;
        note.setAttribute('data-testid', 'cue-edit-note');
        const count = () => { note.classList.remove('is-error'); note.textContent = `${Array.from(input.value).length} / ${WORDING_MAX}`; };
        count();
        const buttons = el(document, 'div', 'cue-edit-buttons');
        const save = el(document, 'button', 'cue-edit-save', 'Save');
        save.type = 'submit';
        save.setAttribute('data-testid', 'cue-edit-save');
        const cancel = el(document, 'button', 'cue-edit-cancel', 'Cancel');
        cancel.type = 'button';
        cancel.setAttribute('data-testid', 'cue-edit-cancel');
        const reset = el(document, 'button', 'cue-edit-reset', 'Reset');
        reset.type = 'button';
        reset.setAttribute('data-testid', 'cue-edit-reset');
        buttons.append(save, cancel, reset);
        form.append(label, input, note, buttons);
        row.append(form);
        input.addEventListener('input', () => { typed = input.value; count(); });
        const stop = () => { editing = null; typed = ''; render(); document.querySelector(`[data-testid="cue-edit-row"][data-kind="${kind}"] [data-testid="cue-edit-button"]`)?.focus(); };
        const refuse = (words) => { note.classList.add('is-error'); note.textContent = words; input.focus(); };
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const answer = source.save(kind, input.value);
          if (!answer.ok) { refuse(answer.error || 'YAP could not keep that wording.'); return; }
          stop();
        });
        cancel.addEventListener('click', stop);
        reset.addEventListener('click', () => {
          const answer = source.reset(kind);
          if (!answer.ok) { refuse(answer.error || 'YAP could not reset that wording.'); return; }
          stop();
        });
        input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(); } });
        row.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); stop(); } });
        list.append(row);
        if (focusField) { focusField = false; queueMicrotask(() => { input.focus(); input.select(); }); }
        continue;
      }
      const words = el(document, 'span', 'cue-edit-words', shown);
      words.setAttribute('data-testid', 'cue-edit-words');
      const kindName = el(document, 'span', 'cue-edit-kind', edited ? `${ORIGINAL[kind]} · edited` : ORIGINAL[kind]);
      const edit = el(document, 'button', 'cue-edit-open', 'Edit');
      edit.type = 'button';
      edit.setAttribute('data-testid', 'cue-edit-button');
      edit.setAttribute('aria-label', `Edit the wording of ${ORIGINAL[kind]}`);
      edit.addEventListener('click', () => { editing = kind; typed = shown; focusField = true; render(); });
      const text = el(document, 'span', 'cue-edit-text');
      text.append(words, kindName);
      row.append(text, edit);
      list.append(row);
    }
    box.append(heading, list);
  }

  return { render };
}

// ---------- the page's own additions ----------
//
// The approved prepare page (ui/prepare/index.html, styles.css) is fingerprinted
// and is not edited. The editor's box and its stylesheet are added by the page's
// script, outside shell mode only, so the shell stays exactly as drawn.

/** The stylesheet of the editor, in the page's own custom properties. */
export const CUE_EDITOR_CSS = `
.cue-edit { margin-top: var(--space-5); }
.cue-edit-title { margin: 0 0 var(--space-2); font-size: 14px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--white-dim); }
.cue-edit-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.cue-edit-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-small); background: var(--glass-strong); }
.cue-edit-text { display: flex; flex-direction: column; min-width: 0; }
.cue-edit-words { font-size: 16px; overflow-wrap: anywhere; }
.cue-edit-kind { font-size: 12px; color: var(--white-dim); }
.cue-edit-open, .cue-edit-save, .cue-edit-cancel, .cue-edit-reset { border: 1px solid var(--glass-border); border-radius: var(--radius-pill); background: var(--glass-strong); padding: var(--space-2) var(--space-4); font-size: 14px; }
.cue-edit-open:hover, .cue-edit-cancel:hover, .cue-edit-reset:hover { background: var(--glass-hover); }
.cue-edit-save { background: var(--amber); border-color: var(--amber); color: var(--amber-ink); font-weight: 600; }
.cue-edit-form { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; }
.cue-edit-label { font-size: 13px; color: var(--white-soft); }
.cue-edit-input { width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--glass-border); border-radius: var(--radius-small); background: var(--glass-strong); font: inherit; font-size: 16px; color: var(--white); }
.cue-edit-input:focus-visible, .cue-edit-open:focus-visible, .cue-edit-save:focus-visible, .cue-edit-cancel:focus-visible, .cue-edit-reset:focus-visible { outline: 2px solid var(--amber); outline-offset: var(--space-1); }
.cue-edit-note { margin: 0; min-height: 18px; font-size: 13px; color: var(--white-dim); }
.cue-edit-note.is-error { color: var(--amber); }
.cue-edit-buttons { display: flex; gap: var(--space-2); flex-wrap: wrap; }
`;

/**
 * Make the editor's box under the cue-limit line, with its stylesheet, and give it back (hidden until a cue is pressed).
 * @param {Document} document
 * @returns {HTMLElement}
 */
export function mountCueEditorBox(document) {
  if (!document.querySelector('style[data-yap="cue-editor"]')) {
    const style = el(document, 'style');
    style.dataset.yap = 'cue-editor';
    style.textContent = CUE_EDITOR_CSS;
    document.head.append(style);
  }
  const box = el(document, 'div', 'cue-edit');
  box.id = 'cue-edit';
  box.setAttribute('data-testid', 'cue-edit');
  box.hidden = true;
  const after = document.getElementById('cue-limit');
  if (after) after.after(box);
  else document.body.append(box);
  return box;
}
