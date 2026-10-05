// What the editor shows of a take's saved words: which have usable timing, which
// the cut list has taken out, and what automatic cuts were proposed (Stage A of
// the editor: edit by transcript, autocut review). Captions use src/engine/
// caption-model.js on the same timed words.
//
// It reads the words and the one cut list and changes neither. Timing is never
// reconstructed from text: a word with no usable start and end is reported as
// untimed and is neither editable nor captioned.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its inputs.

import { listCuts } from './cutlist.js';

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {import('./cutlist.js').CutList} CutList
 * @typedef {import('./cutlist.js').Cut} Cut
 * @typedef {Word & { i: number }} TimedWord i is the word's index in the saved transcript
 */

/** A word may end this far past the recording's length (the same slack a cut is given). */
export const WORD_SLACK_SECONDS = 0.25;

/** The kinds of cut YAP proposes by itself; trims and removed words are the person's own. */
export const AUTO_KINDS = Object.freeze(['exchange', 'restart', 'dead-air']);

const KIND_LABEL = Object.freeze({ exchange: 'Talk with YAP', restart: 'Retake', 'dead-air': 'Pause' });

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * The words that have usable timing, each with its index in the saved transcript.
 * A word is timed when it has text and a start and end that are numbers with
 * 0 <= start < end, inside the recording (when `duration` is given), and it does
 * not start before the timed word before it. The rest are left out, never repaired.
 * @param {unknown} words
 * @param {number | null} [duration]
 * @returns {TimedWord[]}
 */
export function timedWords(words, duration = null) {
  const list = Array.isArray(words) ? words : [];
  const limit = isNum(duration) && duration > 0 ? duration + WORD_SLACK_SECONDS : Infinity;
  /** @type {TimedWord[]} */
  const out = [];
  let lastStart = -Infinity;
  list.forEach((w, i) => {
    if (!w || typeof w !== 'object' || typeof w.text !== 'string' || !w.text.trim()) return;
    if (!isNum(w.start) || !isNum(w.end) || w.start < 0 || !(w.end > w.start) || w.end > limit) return;
    if (w.start < lastStart - 1e-6) return;
    lastStart = w.start;
    out.push({ i, text: w.text, start: w.start, end: w.end });
  });
  return out;
}

/** Every plain sentence the person is shown about the transcript, in one place. */
export const TRANSCRIPT_COPY = Object.freeze({
  empty: 'This recording has no saved transcript, so there are no words to edit or caption. Your video and audio are untouched.',
  untimed: 'This recording has words but none of them has usable timing, so YAP cannot cut or caption by word. YAP does not guess timing from text. Your video and audio are untouched.',
  partial: (untimed, total) => `${untimed} of ${total} words have no usable timing. They are shown dimmed and cannot be removed or captioned; the timed words work as normal.`,
});

/**
 * Whether the saved transcript can drive word editing and captions.
 * state: 'ok' every word timed, 'partial' some timed, 'untimed' words but none
 * timed, 'empty' no words. `recovery` names what the person can still do.
 * @param {unknown} words
 * @param {number | null} [duration]
 */
export function transcriptStatus(words, duration = null) {
  const total = Array.isArray(words) ? words.length : 0;
  const timed = timedWords(words, duration).length;
  const state = total === 0 ? 'empty' : timed === 0 ? 'untimed' : timed < total ? 'partial' : 'ok';
  const message = state === 'empty' ? TRANSCRIPT_COPY.empty
    : state === 'untimed' ? TRANSCRIPT_COPY.untimed
      : state === 'partial' ? TRANSCRIPT_COPY.partial(total - timed, total)
        : '';
  const recovery = state === 'empty' || state === 'untimed'
    ? [{ id: 'shorten', label: 'Trim by time instead' }, { id: 'next-take', label: 'Record another take' }]
    : [];
  return { state, total, timed, untimed: total - timed, message, recovery, usable: timed > 0 };
}

/** The cuts that are applied, as [start, end, cut] sorted by start. */
function appliedCuts(cutList, duration) {
  return listCuts(cutList || { cuts: [], undoStack: [] })
    .filter((c) => c.applied)
    .map((c) => ({ cut: c, start: Math.max(0, c.start), end: Number.isFinite(duration) ? Math.min(duration, c.end) : c.end }))
    .filter((c) => c.end > c.start);
}

/**
 * Each timed word with whether the applied cuts take it out. A word is removed
 * when applied cuts cover at least half of its length. `cutId` is the cut that
 * covers its middle (a cut the person made by deleting words wins over an
 * automatic one); `kind` is that cut's kind.
 * @param {TimedWord[]} words
 * @param {CutList} cutList
 * @param {number | null} [duration]
 * @returns {(TimedWord & { removed: boolean, cutId: string | null, kind: string | null, reason: string | null })[]}
 */
export function wordStates(words, cutList, duration = null) {
  const cuts = appliedCuts(cutList, duration);
  return words.map((w) => {
    let covered = 0;
    for (const c of cuts) covered += Math.max(0, Math.min(w.end, c.end) - Math.max(w.start, c.start));
    const removed = covered >= (w.end - w.start) * 0.5 - 1e-9;
    let owner = null;
    if (removed) {
      const mid = (w.start + w.end) / 2;
      const covering = cuts.filter((c) => c.start <= mid && c.end >= mid);
      owner = covering.find((c) => c.cut.kind === 'edit') || covering[0] || cuts.find((c) => c.end > w.start && c.start < w.end) || null;
    }
    return { ...w, removed, cutId: owner ? owner.cut.id : null, kind: owner ? owner.cut.kind : null, reason: owner ? owner.cut.reason : null };
  });
}

/**
 * Consecutive removed words that the same cut took out, as one run. `first` and
 * `last` are transcript indices; an untimed word between two of them does not split a run.
 * @param {ReturnType<typeof wordStates>} states
 * @returns {{ cutId: string | null, kind: string | null, reason: string | null, first: number, last: number, count: number, start: number, end: number }[]}
 */
export function removedRuns(states) {
  const runs = [];
  let open = null;
  states.forEach((w) => {
    if (!w.removed) { open = null; return; }
    if (open && open.cutId === w.cutId) {
      open.last = w.i; open.count += 1; open.end = w.end;
    } else {
      open = { cutId: w.cutId, kind: w.kind, reason: w.reason, first: w.i, last: w.i, count: 1, start: w.start, end: w.end };
      runs.push(open);
    }
  });
  return runs;
}

/** Seconds of the recording that applied cuts remove (merged, so none is counted twice). */
export function removedSeconds(cutList, duration) {
  let total = 0;
  let cursor = 0;
  for (const c of appliedCuts(cutList, duration).sort((a, b) => a.start - b.start)) {
    const start = Math.max(c.start, cursor);
    if (c.end > start) { total += c.end - start; cursor = c.end; }
  }
  return round3(total);
}

/**
 * What the next undo would take back, in plain words, or null when there is nothing to undo.
 * @param {CutList} cutList
 */
export function describeUndo(cutList) {
  const action = cutList && Array.isArray(cutList.undoStack) ? cutList.undoStack[cutList.undoStack.length - 1] : null;
  if (!action) return null;
  if (action.type === 'add-cut') {
    if (action.id === null) return 'Undo: put the trim back';
    const cut = cutList.cuts.find((c) => c.id === action.id);
    if (cut && cut.kind === 'edit') return 'Undo: put the removed words back';
    if (cut && cut.kind === 'trim') return 'Undo: change the trim back';
    return 'Undo the last change';
  }
  const cut = cutList.cuts.find((c) => c.id === action.id);
  const what = cut ? (cut.kind === 'edit' ? 'removed words' : (KIND_LABEL[cut.kind] || cut.kind).toLowerCase()) : 'cut';
  return action.to ? `Undo: keep the ${what} again` : `Undo: remove the ${what} again`;
}

/**
 * The automatic cuts YAP proposed, for the operator to review. Nothing here
 * decides a cut: each item says what it is, how sure YAP was, and whether it is
 * applied, still waiting for the operator (pending, unsure and never decided) or
 * restored. `excerpt` is the saved words inside it, when it has any.
 * @param {CutList} cutList
 * @param {unknown} words
 * @param {number} duration
 */
export function autocutReview(cutList, words, duration) {
  const timed = timedWords(words, duration);
  const cuts = listCuts(cutList || { cuts: [], undoStack: [] }).filter((c) => AUTO_KINDS.includes(c.kind));
  const undone = new Set((cutList?.undoStack || []).filter((a) => a.type === 'set-applied' && a.to === false).map((a) => a.id));
  const items = cuts.map((c) => {
    const inside = timed.filter((w) => w.end > c.start + 1e-6 && w.start < c.end - 1e-6);
    const text = inside.map((w) => w.text).join(' ');
    const state = c.applied ? 'applied' : c.certainty === 'unsure' && !undone.has(c.id) ? 'pending' : 'restored';
    return {
      id: c.id,
      kind: c.kind,
      label: KIND_LABEL[c.kind] || c.kind,
      start: c.start,
      end: c.end,
      seconds: round3(c.end - c.start),
      certainty: c.certainty,
      applied: c.applied,
      state,
      reason: c.reason,
      wordCount: inside.length,
      excerpt: text.length > 90 ? `${text.slice(0, 87)}…` : text,
    };
  });
  const counts = {
    total: items.length,
    applied: items.filter((i) => i.state === 'applied').length,
    pending: items.filter((i) => i.state === 'pending').length,
    restored: items.filter((i) => i.state === 'restored').length,
  };
  const status = transcriptStatus(words, duration);
  let message = '';
  if (!items.length) {
    message = status.state === 'empty' || status.state === 'untimed'
      ? 'YAP heard no words in this take, so it made no cuts. You can still shorten it by hand.'
      : 'YAP found nothing to cut in this take.';
  }
  return {
    items,
    counts,
    message,
    removedSeconds: round3(items.filter((i) => i.applied).reduce((n, i) => n + i.seconds, 0)),
  };
}
