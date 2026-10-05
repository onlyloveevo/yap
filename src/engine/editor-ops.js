// The editor's changes to a recording's one cut list: remove or restore a run of
// words, undo, and apply or restore automatic cuts. Every change goes through
// src/engine/cutlist.js and src/engine/transcript-edit.js (deleteWords,
// restoreWords), so there is still one cut list and one undo stack, and the
// saved words and the original media are never written.
//
// Each function returns the new cut list and what changed, or throws an
// EditorOpError whose `status` and plain `message` the server sends back as it
// is. A change that would clip a spoken word at export, or leave nothing of the
// take, is refused and nothing is saved.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its inputs.

import { setApplied, undo, keptRanges } from './cutlist.js';
import { deleteWords, restoreWords } from './transcript-edit.js';
import { planExport, ExportRefusedError } from './export.js';
import { timedWords, wordStates, AUTO_KINDS } from './editor-words.js';

/** @typedef {import('./cutlist.js').CutList} CutList */

export class EditorOpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.name = 'EditorOpError';
    this.status = status;
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Refuse a cut list that export would refuse (a clipped word, or nothing kept) when the one before it was fine. */
function assertExportable(before, after, recording) {
  const check = (list) => {
    try {
      planExport({ duration: recording.duration, cuts: list.cuts, words: timedWords(recording.transcript, recording.duration) });
      return null;
    } catch (error) {
      if (error instanceof ExportRefusedError) return error;
      throw error;
    }
  };
  const problem = check(after);
  if (problem && !check(before)) {
    const nothing = !keptRanges(after, recording.duration).length;
    if (nothing) throw new EditorOpError(422, 'That would leave nothing in the YAP cut. Nothing was changed.');
    const clipped = problem.clips.length
      ? problem.clips.map((c) => `"${c.word}" at ${Math.round(c.edge * 100) / 100} s`).join(', ')
      : 'a spoken word';
    throw new EditorOpError(422, `That would cut through ${clipped}, because the words overlap in time, so it was not changed. Choose the words on both sides, or trim by time.`);
  }
  if (!keptRanges(after, recording.duration).length && keptRanges(before, recording.duration).length) {
    throw new EditorOpError(422, 'That would leave nothing in the YAP cut. Nothing was changed.');
  }
}

/**
 * Remove the words from transcript index `from` to `to`, both included, as one
 * edit cut (deleteWords). Both ends must be timed words. If the first or last
 * word overlaps its neighbour in time, any cut of it would clip a spoken word,
 * so the change is refused rather than clipping speech.
 * @param {{ transcript: unknown, duration: number, cuts: CutList }} recording
 * @param {number} from
 * @param {number} to
 * @returns {{ list: CutList, changed: boolean, cutId: string | null, adjusted: boolean, note: string }} adjusted is always false: a cut is never moved off the words' own edges
 */
export function removeWordRange(recording, from, to) {
  const timed = timedWords(recording.transcript, recording.duration);
  const byIndex = new Map(timed.map((w) => [w.i, w]));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new EditorOpError(400, 'Choose a first and a last word; the last cannot come before the first.');
  }
  const first = byIndex.get(from);
  const last = byIndex.get(to);
  if (!first || !last) throw new EditorOpError(422, 'The words at both ends of that selection need usable timing. Choose timed words, or trim by time instead.');
  const inRange = timed.filter((w) => w.i >= from && w.i <= to);
  const states = wordStates(inRange, recording.cuts, recording.duration);
  if (states.every((w) => w.removed)) {
    return { list: recording.cuts, changed: false, cutId: null, adjusted: false, note: 'Those words are already removed.' };
  }
  const words = timed.map(({ text, start, end }) => ({ text, start, end }));
  const at = (w) => timed.indexOf(w);
  const { list, cutId } = deleteWords(recording.cuts, words, at(first), at(last));
  const cut = list.cuts.find((c) => c.id === cutId);
  assertExportable(recording.cuts, list, recording);
  return { list, changed: true, cutId, adjusted: false, note: '' };
}

function findCut(list, cutId) {
  const cut = list.cuts.find((c) => c.id === cutId);
  if (!cut) throw new EditorOpError(404, 'No cut has that id. Reload to see the current cut.');
  if (cut.kind === 'trim') throw new EditorOpError(422, 'A trim is changed with Shorten, not here.');
  return cut;
}

/**
 * Put a removed run of words (or any non-trim cut) back, through restoreWords.
 * @param {{ duration: number, transcript: unknown, cuts: CutList }} recording
 * @param {string} cutId
 */
export function restoreRun(recording, cutId) {
  const cut = findCut(recording.cuts, cutId);
  if (!cut.applied) return { list: recording.cuts, changed: false, note: 'That was already restored.' };
  const list = restoreWords(recording.cuts, cutId);
  assertExportable(recording.cuts, list, recording);
  return { list, changed: true, note: '' };
}

/** Take a restored run out of the cut again (apply its cut). */
export function removeRunAgain(recording, cutId) {
  const cut = findCut(recording.cuts, cutId);
  if (cut.applied) return { list: recording.cuts, changed: false, note: 'That is already removed.' };
  const list = setApplied(recording.cuts, cutId, true);
  assertExportable(recording.cuts, list, recording);
  return { list, changed: true, note: '' };
}

/**
 * Undo the last change on the one undo stack.
 * @param {{ duration: number, transcript: unknown, cuts: CutList }} recording
 */
export function undoLast(recording) {
  if (!recording.cuts.undoStack.length) return { list: recording.cuts, changed: false, note: 'There is nothing to undo.' };
  const list = undo(recording.cuts);
  assertExportable(recording.cuts, list, recording);
  return { list, changed: !same(list, recording.cuts), note: '' };
}

/**
 * Apply or restore automatic cuts the operator chose, one at a time or in a
 * group. 'apply' acts on the ids given and nothing else, so an unsure cut is
 * applied only when it is named. 'apply-sure' applies the cuts YAP was sure
 * about that are not applied now, never an unsure one. 'restore-all' restores
 * every applied automatic cut. Trims and removed words are never touched.
 * @param {{ duration: number, transcript: unknown, cuts: CutList }} recording
 * @param {'apply' | 'restore' | 'apply-sure' | 'restore-all'} op
 * @param {string[]} [ids]
 */
/** The cuts YAP makes by itself: the kinds the transcript knows, and filler words. */
const YAP_KINDS = Object.freeze([...AUTO_KINDS, 'filler']);

export function changeAutocuts(recording, op, ids = []) {
  const auto = recording.cuts.cuts.filter((c) => YAP_KINDS.includes(c.kind));
  let targets;
  if (op === 'apply-sure') targets = auto.filter((c) => c.certainty === 'sure' && !c.applied).map((c) => c.id);
  else if (op === 'restore-all') targets = auto.filter((c) => c.applied).map((c) => c.id);
  else if (op === 'apply' || op === 'restore') {
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== 'string')) throw new EditorOpError(400, 'Name the automatic cuts to change.');
    for (const id of ids) {
      const cut = recording.cuts.cuts.find((c) => c.id === id);
      if (!cut) throw new EditorOpError(404, 'No cut has that id. Reload to see the current cut.');
      if (!YAP_KINDS.includes(cut.kind)) throw new EditorOpError(422, 'Only automatic cuts are changed here. Trims and removed words keep their own controls.');
    }
    targets = [...new Set(ids)];
  } else throw new EditorOpError(400, 'Unknown autocut change.');
  let list = recording.cuts;
  let count = 0;
  for (const id of targets) {
    const cut = list.cuts.find((c) => c.id === id);
    const want = op === 'apply' || op === 'apply-sure';
    if (cut.applied === want) continue;
    list = setApplied(list, id, want);
    count += 1;
  }
  if (count) assertExportable(recording.cuts, list, recording);
  return { list, changed: count > 0, count, note: count ? '' : 'Nothing needed changing.' };
}
