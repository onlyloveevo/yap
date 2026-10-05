// The next-video memory loop: a cue the creator accepted in Review, carried by their own press into the
// next take they prepare, and shown to them in Live as a quiet reminder for that one take.
//
// What this module is: pure rules plus two small, bounded browser-storage helpers. No network, no model,
// no clock of its own. The cue's words are the creator's own accepted words and are carried exactly (or
// as the creator edited them, with the accepted words kept beside them). Nothing here changes a script,
// a beat or a title, and nothing here learns: it is a reminder the creator chose, not a trained habit.
//
// Two stores, both small and versioned:
//  - the pending choice (sessionStorage, this tab): one reference a Review press left for Prepare, plus the
//    draft wording and the Include/Remove choice. It dies with the tab or when a take starts.
//  - the take focus (localStorage, this browser): the words carried onto ONE recording id, so a reload of
//    that recording's Live page shows them again. Another recording never reads them. Removing a cue in
//    Review later does not touch a copy a take already carries.
// Every write is read back; a refused or full store gives { ok: false } and never a pretended save.
import { REVIEW_LIMITS, readReview, activeCues } from './review-own.js';

export const MEMORY_VERSION = 1;
export const MEMORY_LIMITS = Object.freeze({
  /** The cue's own limit in Review, so a carried reminder is never longer than the cue it came from. */
  textChars: REVIEW_LIMITS.cueChars,
  titleChars: 200,
  questionChars: REVIEW_LIMITS.questionChars,
  /** At most this many takes keep a focus; past it the oldest take's copy is dropped (said by the result). */
  maxTakes: 24,
  /** A pending choice older than this is no longer offered. */
  pendingMs: 12 * 60 * 60 * 1000,
});

export const PENDING_KEY = 'yap-review-next:pending:v1';
export const TAKES_KEY = 'yap-review-next:takes:v1';

const isText = (v) => typeof v === 'string';
/** A video or cue id as the Review store makes them: letters, digits, hyphen, underscore; bounded. */
const REF_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** A Recording id, the same rule as src/engine/recording.js. */
const TAKE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isReferenceId = (v) => isText(v) && REF_ID.test(v);
export const isTakeId = (v) => isText(v) && TAKE_ID.test(v);

/** The one place the Prepare address for a Review cue is built. */
export function prepareHref(videoId, cueId) {
  if (!isReferenceId(videoId) || !isReferenceId(cueId)) throw new Error('That cue cannot be sent to Prepare.');
  return `/prepare/new?review=${encodeURIComponent(videoId)}&cue=${encodeURIComponent(cueId)}`;
}

/**
 * The reference an address carries. { present: false } when it carries none; a refusal with a plain line
 * when it carries one that is not a well-formed Review reference. Never reads storage.
 * @returns {{ present: false } | { present: true, ok: true, videoId: string, cueId: string } | { present: true, ok: false, message: string }}
 */
export function parseReference(search) {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(isText(search) ? search : '');
  const hasVideo = q.has('review');
  const hasCue = q.has('cue');
  if (!hasVideo && !hasCue) return { present: false };
  const videoId = q.get('review');
  const cueId = q.get('cue');
  if (!isReferenceId(videoId) || !isReferenceId(cueId) || q.getAll('review').length > 1 || q.getAll('cue').length > 1) {
    return { present: true, ok: false, message: 'That link to a Review cue is not valid, so no reminder was added.' };
  }
  return { present: true, ok: true, videoId, cueId };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

/**
 * Check one reminder's words. Over the limit is a refusal, never a silent cut.
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function checkWording(text) {
  const t = isText(text) ? text.trim() : '';
  if (!t) return { ok: false, message: 'Write the reminder in your own words, or remove it.' };
  if (t.length > MEMORY_LIMITS.textChars) return { ok: false, message: `Keep the reminder under ${MEMORY_LIMITS.textChars} characters (it is ${t.length}).` };
  return { ok: true, text: t };
}

/**
 * The Review cue a reference names, read from the imported video's own stored record. The video must be
 * there with its file and details, and the cue must be on it and not removed. A sample is not an imported
 * video, so nothing here can resolve to one.
 * @param {object | null | undefined} record  the media-store record for the video id
 * @returns {{ ok: true, source: object, accepted: string } | { ok: false, reason: string, message: string }}
 */
export function resolveCue(record, videoId, cueId) {
  if (!record || typeof record !== 'object' || record.id !== videoId || !record.file || !record.video || typeof record.video !== 'object') {
    return { ok: false, reason: 'no-video', message: 'The video that cue came from is not kept in this browser any more, so the reminder was not added.' };
  }
  const title = isText(record.video.title) ? record.video.title.trim() : '';
  if (!title) return { ok: false, reason: 'no-video', message: 'The video that cue came from cannot be read, so the reminder was not added.' };
  const { review } = readReview(record);
  const cue = review.cues.find((c) => c.id === cueId);
  if (!cue) return { ok: false, reason: 'no-cue', message: 'That cue is no longer on its video, so the reminder was not added.' };
  if (cue.removedAt) return { ok: false, reason: 'removed', message: 'That cue was removed in Review, so the reminder was not added. Restore it there to use it.' };
  if (!activeCues(review).includes(cue)) return { ok: false, reason: 'removed', message: 'That cue is not active in Review, so the reminder was not added.' };
  const wording = checkWording(cue.text);
  if (!wording.ok) return { ok: false, reason: 'bad-cue', message: 'That cue cannot be carried: ' + wording.message };
  return {
    ok: true,
    accepted: wording.text,
    source: {
      kind: 'own-review',
      videoId,
      cueId,
      title: clip(title, MEMORY_LIMITS.titleChars),
      question: isText(cue.question) ? clip(cue.question, MEMORY_LIMITS.questionChars) : '',
      keptAt: isText(cue.at) ? cue.at : '',
      cueEdited: cue.edited === true,
    },
  };
}

/**
 * The reminder one take carries: the words shown in Live (the creator's accepted words or their edit of
 * them), the accepted words themselves, and where they came from.
 * @returns {{ ok: true, carry: object } | { ok: false, message: string }}
 */
export function makeCarry({ source, accepted, text, now }) {
  const wording = checkWording(text);
  if (!wording.ok) return wording;
  const base = checkWording(accepted);
  if (!base.ok || !source || source.kind !== 'own-review' || !isReferenceId(source.videoId) || !isReferenceId(source.cueId)) {
    return { ok: false, message: 'That reminder has no readable source, so it was not carried.' };
  }
  return {
    ok: true,
    carry: {
      v: MEMORY_VERSION,
      text: wording.text,
      accepted: base.text,
      edited: wording.text !== base.text,
      source: { ...source },
      at: isText(now) ? now : '',
    },
  };
}

/** A carry as read back from storage: only a well-formed own-Review one, rebuilt field by field; null otherwise. */
export function cleanCarry(c) {
  if (!c || typeof c !== 'object' || c.v !== MEMORY_VERSION || !c.source || typeof c.source !== 'object') return null;
  const s = c.source;
  if (s.kind !== 'own-review' || !isReferenceId(s.videoId) || !isReferenceId(s.cueId) || !isText(s.title) || !s.title.trim()) return null;
  const text = checkWording(c.text);
  const accepted = checkWording(c.accepted);
  if (!text.ok || !accepted.ok) return null;
  return {
    v: MEMORY_VERSION,
    text: text.text,
    accepted: accepted.text,
    edited: text.text !== accepted.text,
    source: {
      kind: 'own-review',
      videoId: s.videoId,
      cueId: s.cueId,
      title: clip(s.title.trim(), MEMORY_LIMITS.titleChars),
      question: isText(s.question) ? clip(s.question, MEMORY_LIMITS.questionChars) : '',
      keptAt: isText(s.keptAt) ? s.keptAt : '',
      cueEdited: s.cueEdited === true,
    },
    at: isText(c.at) ? c.at : '',
  };
}

// ---------- storage helpers ----------

/** A storage, or null when this page may not touch it. */
export function storageOrNull(kind) {
  try { return globalThis[kind] || null; } catch { return null; }
}

/** True when a value can be written and read back, then removed. A refusing or absent store is false. */
export function storageWorks(storage) {
  if (!storage) return false;
  const k = 'yap-review-next:probe';
  try {
    storage.setItem(k, '1');
    const ok = storage.getItem(k) === '1';
    storage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

function write(storage, key, value) {
  if (!storage) return { ok: false, reason: 'storage', message: 'This browser is not letting YAP keep the reminder (storage is blocked or full).' };
  try {
    const text = JSON.stringify(value);
    storage.setItem(key, text);
    if (storage.getItem(key) !== text) throw new Error('read-back differs');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage', message: 'This browser is not letting YAP keep the reminder (storage is blocked or full).' };
  }
}

function readJson(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---- the pending choice (sessionStorage) ----

/**
 * The pending choice: which cue is being offered, the draft wording and whether it is included. Anything
 * unreadable, from another version, or older than the limit is no pending choice.
 */
export function readPending(storage, now = Date.now()) {
  const p = readJson(storage, PENDING_KEY);
  if (!p || typeof p !== 'object' || p.v !== MEMORY_VERSION || !isReferenceId(p.videoId) || !isReferenceId(p.cueId)) return null;
  if (!Number.isFinite(p.at) || now - p.at > MEMORY_LIMITS.pendingMs || p.at - now > 60000) return null;
  return {
    videoId: p.videoId,
    cueId: p.cueId,
    draft: isText(p.draft) && p.draft.length <= MEMORY_LIMITS.textChars * 4 ? p.draft : null,
    included: p.included !== false,
    at: p.at,
  };
}

export function writePending(storage, { videoId, cueId, draft = null, included = true, at = Date.now() }) {
  if (!isReferenceId(videoId) || !isReferenceId(cueId)) return { ok: false, reason: 'bad-reference', message: 'That cue cannot be offered.' };
  return write(storage, PENDING_KEY, { v: MEMORY_VERSION, videoId, cueId, draft: isText(draft) ? draft : null, included: included !== false, at });
}

export function clearPending(storage) {
  try { if (storage) storage.removeItem(PENDING_KEY); return true; } catch { return false; }
}

// ---- the take focus (localStorage) ----

function readTakes(storage) {
  const raw = readJson(storage, TAKES_KEY);
  const empty = { v: MEMORY_VERSION, order: [], entries: {} };
  if (!raw || typeof raw !== 'object' || raw.v !== MEMORY_VERSION || !Array.isArray(raw.order) || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return empty;
  const entries = Object.create(null);
  const order = [];
  for (const id of raw.order) {
    if (!isTakeId(id) || order.includes(id) || !Object.prototype.hasOwnProperty.call(raw.entries, id)) continue;
    const carry = cleanCarry(raw.entries[id]);
    if (carry) { entries[id] = carry; order.push(id); }
  }
  return { v: MEMORY_VERSION, order, entries };
}

/** The reminder one recording carries, or null. Another recording's id never reads it. */
export function readTakeFocus(storage, recordingId) {
  if (!isTakeId(recordingId)) return null;
  const t = readTakes(storage);
  return t.entries[recordingId] || null;
}

/**
 * Carry a reminder onto one new recording. Checks the words again, keeps at most maxTakes takes (the
 * oldest take's copy goes first and the result says so), and reads the write back.
 * @returns {{ ok: true, dropped: string[] } | { ok: false, reason: string, message: string }}
 */
export function saveTakeFocus(storage, recordingId, carry) {
  if (!isTakeId(recordingId)) return { ok: false, reason: 'bad-take', message: 'That recording id is not valid, so the reminder was not carried.' };
  const clean = cleanCarry(carry);
  if (!clean) return { ok: false, reason: 'bad-carry', message: 'That reminder could not be read, so it was not carried.' };
  const t = readTakes(storage);
  const order = t.order.filter((id) => id !== recordingId).concat(recordingId);
  const dropped = order.slice(0, Math.max(0, order.length - MEMORY_LIMITS.maxTakes));
  const kept = order.slice(dropped.length);
  const entries = {};
  for (const id of kept) entries[id] = id === recordingId ? clean : t.entries[id];
  const result = write(storage, TAKES_KEY, { v: MEMORY_VERSION, order: kept, entries });
  return result.ok ? { ok: true, dropped } : result;
}

/** Remove the reminder from one take only. Other takes, and every Review cue, are untouched. */
export function removeTakeFocus(storage, recordingId) {
  if (!isTakeId(recordingId)) return { ok: false, reason: 'bad-take', message: 'That recording id is not valid.' };
  const t = readTakes(storage);
  if (!t.entries[recordingId]) return { ok: true };
  const order = t.order.filter((id) => id !== recordingId);
  const entries = {};
  for (const id of order) entries[id] = t.entries[id];
  return write(storage, TAKES_KEY, { v: MEMORY_VERSION, order, entries });
}

/** The line that says where a carried reminder came from, in words that claim nothing more. */
export function provenanceLine(carry) {
  const c = carry && cleanCarry(carry);
  if (!c) return '';
  const own = c.edited ? 'your wording, adapted from the cue you accepted' : 'the cue you accepted, as you kept it';
  return `From your review of “${c.source.title}” · ${own}`;
}
