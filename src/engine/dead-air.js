// Dead air: a long pause in a take, proposed as a cut that keeps a breath at
// each side (CUT-05; D-47, D-48).
//
// It reads the [start, end] pairs findSilences returns (src/engine/silences.js)
// and gives back proposals for the one cut list (addDeadAirCuts in
// src/engine/cutlist.js). YAP proposes and the person decides: the cut can be
// undone like any other. A proposal never enters a word, and the original
// recording and its words are never changed.
//
// The same pass proposes filler words ("um", "uh") as cuts of their own kind:
// a filler is not speech the person meant, and it sits between the same pauses.
//
// Pure and browser-safe: never mutates its inputs, and returns new objects.

import { FILLERS, normToken } from './retake-text.js';

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
  filler: 'a filler word',
});

/** What the recogniser writes for a hesitation: the fillers the retake detector knows, and their longer spellings. */
const HESITATIONS = new Set([...FILLERS, 'umm', 'uhh', 'uhm', 'ah', 'eh', 'mhm']);
/** Chrome's speech service glues a hesitation to the word before it: "so, um" comes back as "Soum." */
const GLUED_HESITATION = /^(so|and|but|well|like|then|okay|ok)(u+h*m+|u+h+|e+r+m*)$/;
/**
 * Words people lean on between sentences. They are filler only when they stand alone: the recogniser wrote them
 * as their own sentence ("You know? Basically.") or set them off with a comma at a sentence start, or a pause
 * sits on both sides. Inside a sentence ("it is basically done", "do you know him") they are the person's words.
 */
const LEANED_ON = [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'], ['basically'], ['literally'], ['actually'], ['like']];
/** A pause this long on a side sets a leaned-on word apart when the recogniser wrote no punctuation. */
const APART = 0.25;
const SENTENCE_END = /[.!?…]["')\]]*$/;
const SET_OFF = /[.!?…,;:]["')\]]*$/;

/** A filler takes the pause after it too, up to this long, so the cut does not leave two pauses in a row. */
const FILLER_TAIL = 0.4;
/** The breath kept before the next word after a filler. */
const FILLER_BREATH = 0.08;
/** How far inside the pause before a filler its cut begins. */
const FILLER_LEAD = 0.04;
/** The recogniser's word times drift from the audio by up to about this much. */
const WORD_DRIFT = 0.15;

/**
 * How many words from `i` on are one filler: a hesitation, a hesitation glued to "so", or a leaned-on word standing alone. 0 for none.
 * @param {Word[]} timed @param {string[]} tokens @param {number} i @param {boolean} [afterFiller] the word before is a filler
 */
function fillerLength(timed, tokens, i, afterFiller = false) {
  if (HESITATIONS.has(tokens[i]) || GLUED_HESITATION.test(tokens[i])) return 1;
  const phrase = LEANED_ON.find((p) => p.every((x, k) => tokens[i + k] === x));
  if (!phrase) return 0;
  const first = timed[i];
  const last = timed[i + phrase.length - 1];
  const prev = timed[i - 1];
  const next = timed[i + phrase.length];
  // "Um, you know." comes back as one sentence: a filler or a comma before the words sets them off as well.
  const before = !prev || afterFiller || SET_OFF.test(prev.text.trim()) || first.start - prev.end >= APART;
  const after = !next || SET_OFF.test(last.text.trim()) || next.start - last.end >= APART;
  return before && after ? phrase.length : 0;
}

/**
 * Filler words as cuts. Fillers said one after another are one cut. Where the take's pauses are known the cut
 * runs from the pause before the filler to the pause after it, since the recogniser's word times drift from the
 * audio; without them it runs from the word's start to just before the next word.
 * A filler under an applied talk-with-YAP or restart cut is already gone and is not proposed again.
 * @param {{ words?: Word[], cuts?: CutLike[], duration?: number, silences?: [number, number][] }} input
 * @returns {(DeadAirProposal & { kind: 'filler' })[]} in time order
 */
export function fillerCuts({ words, cuts, duration, silences } = {}) {
  const timed = (Array.isArray(words) ? words : [])
    .filter((w) => w && typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const tokens = timed.map((w) => normToken(w.text));
  const gone = (Array.isArray(cuts) ? cuts : []).filter((c) => c && c.applied && TAKEN_OUT_BY.includes(c.kind));
  const limit = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const quiet = spansOf(silences, (pair) => [Math.max(0, pair[0]), Math.min(limit, pair[1])]);
  const taken = (w) => gone.some((c) => c.start <= w.start + EPSILON && c.end >= w.end - EPSILON);
  const out = [];
  let i = 0;
  while (i < timed.length) {
    let n = taken(timed[i]) ? 0 : fillerLength(timed, tokens, i);
    if (!n) { i += 1; continue; }
    // Fillers that follow each other are one run.
    for (;;) {
      const more = i + n < timed.length && !taken(timed[i + n]) ? fillerLength(timed, tokens, i + n, true) : 0;
      if (!more) break;
      n += more;
    }
    const first = timed[i];
    const last = timed[i + n - 1];
    const prev = timed[i - 1];
    const next = timed[i + n];
    // The pause the filler follows: it ends at or just before the filler's first word and after the word before it.
    const lead = quiet.filter(([, e]) => e <= first.start + WORD_DRIFT && (!prev || e > prev.end - WORD_DRIFT)).pop();
    // The pause after it: it begins at the filler's last word and ends before the next word is far in.
    const trail = quiet.find(([a, e]) => a >= last.end - WORD_DRIFT && e > last.end && (!next || e <= next.start + WORD_DRIFT));
    let start = lead ? Math.max(lead[0], lead[1] - FILLER_LEAD) : first.start;
    if (prev) start = Math.max(start, prev.end);
    const room = next ? Math.max(last.end, next.start - FILLER_BREATH) : last.end;
    let end = trail ? Math.max(last.end, trail[1] - FILLER_BREATH) : Math.min(room, last.end + FILLER_TAIL);
    if (next) end = Math.min(end, Math.max(last.end, next.start));
    start = ms(start);
    end = ms(Math.min(limit, end));
    if (end > start) out.push({ kind: 'filler', start, end, certainty: 'sure', reason: COPY.filler });
    i += n;
  }
  return out;
}

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

  const fillers = fillerCuts({ words, cuts, duration, silences });
  // A pause is measured around the words that stay: a filler is not a word to keep a breath beside or to stop at,
  // so a pause runs right up to a filler cut and the two leave no sliver between them.
  const fillerSpans = fillers.map((f) => [f.start, f.end]);
  const takenOut = [...cutSpans, ...fillerSpans].sort((x, y) => x[0] - y[0]);
  const stays = spansOf((Array.isArray(words) ? words : []).filter((w) => w && !fillerSpans.some(([fs, fe]) => w.start >= fs - EPSILON && w.end <= fe + EPSILON)), (w) => [w.start, w.end]);
  /** @type {DeadAirProposal[]} */
  const out = [];
  for (const [start, end] of quiet) {
    if (!(end - start > s.minSilence + EPSILON)) continue;
    const middle = (start + end) / 2;
    // No speech on a side means no breath to keep there.
    const leading = start <= EPSILON || (wordSpans.length > 0 && !wordSpans.some(([ws]) => ws < middle));
    const trailing = end >= limit - EPSILON || (wordSpans.length > 0 && !wordSpans.some(([, we]) => we > middle));
    for (const [pieceStart, pieceEnd] of subtract(start, end, takenOut)) {
      const speechBefore = pieceStart === start && !leading;
      const speechAfter = pieceEnd === end && !trailing;
      const from = speechBefore ? ms(pieceStart + s.keepEdge) : pieceStart;
      const to = speechAfter ? ms(pieceEnd - s.keepEdge) : pieceEnd;
      if (!(to > from)) continue;
      for (const [a, b] of subtract(from, to, stays)) {
        if (b - a < s.minPiece - EPSILON) continue;
        out.push({ start: a, end: b, certainty: s.certainty, reason: COPY.reason });
      }
    }
  }
  return [...out, ...fillers].sort((x, y) => x.start - y.start);
}
