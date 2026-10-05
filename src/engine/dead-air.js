// Dead air: a long pause in a take, proposed as a cut that keeps a breath at
// each side (CUT-05; D-47, D-48).
//
// It reads the [start, end] pairs findSilences returns (src/engine/silences.js)
// and gives back proposals for the one cut list (addDeadAirCuts in
// src/engine/cutlist.js). YAP proposes and the person decides: the cut can be
// undone like any other. A proposal never enters a word, and the original
// recording and its words are never changed.
//
// Pure and browser-safe: imports nothing, never mutates its inputs, and returns
// new objects.

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {{ kind: string, start: number, end: number, applied: boolean }} CutLike
 * @typedef {{ minSilence?: number, keepEdge?: number, minPiece?: number, certainty?: 'sure' | 'unsure' }} DeadAirSettings
 * @typedef {{ start: number, end: number, certainty: 'sure' | 'unsure', reason: string }} DeadAirProposal
 */

/**
 * Seat defaults, one setting each (D-47; asked in .planning/QUESTIONS.md).
 * minSilence: a silence must be longer than this to be proposed.
 * keepEdge: the breath kept beside the speech on each side.
 * minPiece: a piece left outside another cut that is shorter than this is left alone.
 * certainty: 'sure' cuts are applied (with undo); 'unsure' ones wait for one tap.
 */
export const DEAD_AIR_DEFAULTS = Object.freeze({
  minSilence: 1.2,
  keepEdge: 0.3,
  minPiece: 0.2,
  certainty: 'sure',
});

/** Every word the person sees about a dead-air proposal. */
export const COPY = Object.freeze({
  reason: 'a long pause',
});

/** Cuts that already remove time: a silence under one of these is not proposed again. */
const TAKEN_OUT_BY = Object.freeze(['exchange', 'restart']);

/** Two times closer than this are the same time. */
const EPSILON = 1e-6;

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Round to the millisecond so edges compare cleanly. */
function ms(x) {
  return Math.round(x * 1000) / 1000;
}

function settingsOf(settings) {
  const s = { ...DEAD_AIR_DEFAULTS, ...(settings || {}) };
  for (const key of ['minSilence', 'keepEdge', 'minPiece']) {
    if (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < 0) {
      throw namedError('InvalidDeadAirSettingsError', `Dead air: ${key} must be a number of seconds, zero or more (got ${s[key]})`);
    }
  }
  if (s.certainty !== 'sure' && s.certainty !== 'unsure') {
    throw namedError('InvalidDeadAirSettingsError', `Dead air: certainty must be 'sure' or 'unsure' (got "${s.certainty}")`);
  }
  return s;
}

/** The usable [start, end] spans of a list, in time order. */
function spansOf(items, read) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const [start, end] = read(item);
    if (typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      out.push([start, end]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * What is left of [start, end] once every blocking span is taken out.
 * @param {number} start
 * @param {number} end
 * @param {[number, number][]} blockers in time order
 * @returns {[number, number][]}
 */
function subtract(start, end, blockers) {
  /** @type {[number, number][]} */
  const pieces = [];
  let cursor = start;
  for (const [bs, be] of blockers) {
    if (be <= cursor) continue;
    if (bs >= end) break;
    if (bs > cursor) pieces.push([cursor, bs]);
    cursor = Math.max(cursor, be);
    if (cursor >= end) break;
  }
  if (cursor < end) pieces.push([cursor, end]);
  return pieces;
}

/**
 * Propose the dead air of a take as cuts.
 *
 * A silence strictly longer than `minSilence` becomes a proposal from its start
 * plus `keepEdge` to its end minus `keepEdge`. A side with no speech beside it
 * keeps nothing: the very start of the take (before the first word), the very
 * end, or a side that is already cut. The parts under an applied talk-with-YAP
 * or restart cut are taken out, a piece shorter than `minPiece` is dropped, and
 * a range is pulled back to a word's edge so it never enters a word.
 *
 * @param {{ silences?: [number, number][], duration?: number, words?: Word[], cuts?: CutLike[], settings?: DeadAirSettings }} input
 * @returns {DeadAirProposal[]} in time order
 */
export function deadAirCuts({ silences, duration, words, cuts, settings } = {}) {
  const s = settingsOf(settings);
  const limit = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const wordSpans = spansOf(words, (w) => [w.start, w.end]);
  const cutSpans = spansOf(
    (Array.isArray(cuts) ? cuts : []).filter((c) => c && c.applied && TAKEN_OUT_BY.includes(c.kind)),
    (c) => [c.start, c.end],
  );
  const quiet = spansOf(silences, (pair) => [Math.max(0, pair[0]), Math.min(limit, pair[1])]);

  /** @type {DeadAirProposal[]} */
  const out = [];
  for (const [start, end] of quiet) {
    if (!(end - start > s.minSilence + EPSILON)) continue;
    const middle = (start + end) / 2;
    // No speech on a side means no breath to keep there.
    const leading = start <= EPSILON || (wordSpans.length > 0 && !wordSpans.some(([ws]) => ws < middle));
    const trailing = end >= limit - EPSILON || (wordSpans.length > 0 && !wordSpans.some(([, we]) => we > middle));
    for (const [pieceStart, pieceEnd] of subtract(start, end, cutSpans)) {
      const speechBefore = pieceStart === start && !leading;
      const speechAfter = pieceEnd === end && !trailing;
      const from = speechBefore ? ms(pieceStart + s.keepEdge) : pieceStart;
      const to = speechAfter ? ms(pieceEnd - s.keepEdge) : pieceEnd;
      if (!(to > from)) continue;
      for (const [a, b] of subtract(from, to, wordSpans)) {
        if (b - a < s.minPiece - EPSILON) continue;
        out.push({ start: a, end: b, certainty: s.certainty, reason: COPY.reason });
      }
    }
  }
  return out;
}
