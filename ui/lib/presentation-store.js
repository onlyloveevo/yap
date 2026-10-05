// Where the presentation draft is kept: the browser's localStorage, one key, one
// version, shared by /present (which writes it) and Prepare (which reads it).
// A write is checked by reading it back, so "Saved" is only said when the words
// are really there. When the browser refuses, saveDraft says so and the page
// offers the words as text instead (exportText in presentation-model.js).
import { DRAFT_VERSION, defaultDraft, readDraft } from './presentation-model.js';

export const DRAFT_KEY = 'yap-presentation:v1';

/** localStorage, or null when this page may not touch it. */
function storageOf(scope) {
  try { return (scope || globalThis).localStorage || null; } catch { return null; }
}

/**
 * The kept draft. `status` says what happened: 'new' (nothing kept yet, a fresh
 * draft), 'loaded', 'unreadable' (something was kept but is not a draft; a fresh
 * draft is shown and the unreadable text is left where it is until a save), or
 * 'unavailable' (storage refused).
 * @param {{ localStorage?: Storage }} [scope]
 */
export function loadDraft(scope) {
  const storage = storageOf(scope);
  if (!storage) return { draft: defaultDraft(), status: 'unavailable' };
  let text;
  try { text = storage.getItem(DRAFT_KEY); } catch { return { draft: defaultDraft(), status: 'unavailable' }; }
  if (text === null) return { draft: defaultDraft(), status: 'new' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { draft: defaultDraft(), status: 'unreadable' }; }
  const read = readDraft(raw);
  return read.ok ? { draft: read.draft, status: 'loaded' } : { draft: defaultDraft(), status: 'unreadable' };
}

/**
 * Keep a draft, then read it back. Gives `{ ok: true }` only when the kept text
 * reads back as the same draft.
 * @param {ReturnType<typeof defaultDraft>} draft
 * @param {{ localStorage?: Storage }} [scope]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function saveDraft(draft, scope) {
  const storage = storageOf(scope);
  if (!storage) return { ok: false, error: 'This browser will not keep the presentation.' };
  const text = JSON.stringify({ ...draft, v: DRAFT_VERSION });
  try {
    storage.setItem(DRAFT_KEY, text);
    if (storage.getItem(DRAFT_KEY) !== text) return { ok: false, error: 'This browser did not keep the presentation.' };
  } catch {
    return { ok: false, error: 'This browser refused to keep the presentation.' };
  }
  return { ok: true };
}
