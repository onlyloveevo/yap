// Edit by transcript (EDIT-01; D-37, D-49, D-50, D-51): deleting a run of words
// is a cut from the first word's start to the last word's end, and Restore
// puts it back. Also here: trim the start and the end, and rename the
// recording. Beat marks are src/engine/beat-marks.js.
//
// It uses Phase 1's one cut list and its undo (src/engine/cutlist.js) and
// builds no second one. The original words and audio are never changed: an
// edit or a trim is a cut over them. The words are read, never written.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its
// inputs, and every function returns a new list or object.

import { addEditCut, addTrimCut, setApplied } from './cutlist.js';

/**
 * @typedef {import('./cutlist.js').CutList} CutList
 * @typedef {{ text: string, start: number, end: number }} Word
 */

/** titleChars: the longest title a recording keeps; a longer one is cut to it. */
export const EDIT_LIMITS = Object.freeze({ titleChars: 120 });

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * Delete the words from index `from` to index `to`, both included: one applied
 * cut of kind 'edit' from the first word's start to the last word's end.
 * Undo straight after takes the cut out of the list again.
 * @param {CutList} list
 * @param {Word[]} words the take's words, in the order the person sees them
 * @param {number} from index of the first word to delete
 * @param {number} to index of the last word to delete
 * @returns {{ list: CutList, cutId: string }}
 */
export function deleteWords(list, words, from, to) {
  const count = Array.isArray(words) ? words.length : 0;
  const ok = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to < count;
  if (!ok) {
    throw namedError(
      'InvalidWordRangeError',
      `Cannot delete words ${String(from)} to ${String(to)}: the take has ${count} words, numbered from 0, and a range runs from its first word to its last`,
    );
  }
  const out = addEditCut(list, { start: words[from].start, end: words[to].end });
  return { list: out, cutId: out.cuts[out.cuts.length - 1].id };
}

/**
 * Restore a deleted run of words: its cut stays in the list, not applied.
 * Restore is itself a change, so undo applies the cut again.
 * @param {CutList} list
 * @param {string} cutId the id deleteWords returned
 * @returns {CutList}
 */
export function restoreWords(list, cutId) {
  return setApplied(list, cutId, false);
}

function isSeconds(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Trim the start: everything before `at` is cut. A second trim of the start
 * takes the place of the first, and `at` 0 removes the trim. A time inside a
 * word is allowed here; Export refuses a cut that would clip a word.
 * @param {CutList} list
 * @param {number} at seconds from the start of the recording
 * @param {number} [duration] when given, `at` may not be past it
 * @returns {CutList}
 */
export function trimStart(list, at, duration) {
  if (duration !== undefined && !(isSeconds(duration) && duration > 0)) {
    throw namedError('InvalidTrimError', `Cannot trim the start: the recording's duration must be a number of seconds above 0 (got ${String(duration)})`);
  }
  if (!isSeconds(at) || at < 0 || (duration !== undefined && at > duration)) {
    const upTo = duration === undefined ? '0 or more' : `from 0 to ${duration}`;
    throw namedError('InvalidTrimError', `Cannot trim the start at ${String(at)}: the time must be a number of seconds, ${upTo}`);
  }
  return addTrimCut(list, { start: 0, end: at, edge: 'start' });
}

/**
 * Trim the end: everything from `at` to the end is cut. A second trim of the
 * end takes the place of the first, and `at` equal to the duration removes the
 * trim. A time inside a word is allowed here; Export refuses a cut that would
 * clip a word.
 * @param {CutList} list
 * @param {number} at seconds from the start of the recording
 * @param {number} duration the recording's length in seconds
 * @returns {CutList}
 */
export function trimEnd(list, at, duration) {
  if (!(isSeconds(duration) && duration > 0)) {
    throw namedError('InvalidTrimError', `Cannot trim the end: the recording's duration must be a number of seconds above 0 (got ${String(duration)})`);
  }
  if (!isSeconds(at) || at < 0 || at > duration) {
    throw namedError('InvalidTrimError', `Cannot trim the end at ${String(at)}: the time must be a number of seconds, from 0 to ${duration}`);
  }
  return addTrimCut(list, { start: at, end: duration, edge: 'end' });
}

/**
 * Give the recording a name: a copy of the record with the new title, trimmed
 * and cut to EDIT_LIMITS.titleChars characters. Works on any object with a
 * `title`; the title is only ever kept as data.
 * @template {{ title?: string }} T
 * @param {T} recording
 * @param {string} title
 * @returns {T & { title: string }}
 */
export function renameRecording(recording, title) {
  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) {
    throw namedError('InvalidRecordingError', 'Cannot rename: there is no recording to rename');
  }
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed) {
    throw namedError('InvalidTitleError', 'A recording needs a title with at least one character in it');
  }
  // Counted in characters, not code units, so the cut never splits one.
  const kept = Array.from(trimmed).slice(0, EDIT_LIMITS.titleChars).join('').trim();
  return { ...recording, title: kept };
}
