// Word timings for a real take (INST-02; D-69).
//
// Phase 1 cut only the bundled sample take, whose word times are on file. A real take has no word
// times until a transcriber gives them. This module turns the take's sound into timed words: it finds
// the silences (silences.js), gives each stretch of speech between them to the transcriber
// (islands.js), and tidies what comes back, so a real take's words keep the same promises as the
// sample take's words on file: in order, inside the take, none overlapping the next.
//
// It decides no cut. Its words and silences go to the same restart detector (restarts.js) and
// dead-air finder (dead-air.js) as the sample take's.
//
// The take's sound stays in memory on this machine. It is given to nothing but the transcriber passed
// in, and this module makes no network request (Phase 1 D-31).
//
// Browser-safe: no `node:` imports, no package. It never changes its inputs.

import { findSilences } from './silences.js';
import { transcribeByIslands } from './islands.js';

/**
 * @typedef {[number, number]} Span
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {(samples: Float32Array, opts: { sampleRate: number }) => Promise<Word[]> | Word[]} Transcriber
 * @typedef {{ silences?: { rms_window?: number, rms_floor?: number, quiet_db?: number, min_silence?: number },
 *   minIsland?: number }} RealTakeSettings
 *   silences: passed to findSilences. minIsland: a stretch of speech shorter than this is not transcribed.
 */

/** @param {unknown} x */
function isTime(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * The words in time order, each inside 0 to `duration`, none starting before the one before it ends.
 *
 * Dropped: anything that is not a word, a word with no text, a word with a time that is not a number,
 * a word that runs backwards, and a word with no length left inside the take. Where two words overlap,
 * the earlier one ends where the later one starts; a word that starts together with the word before it
 * starts where that word ends, and is dropped when nothing of it is left.
 *
 * @param {Word[]} words
 * @param {number} [duration] seconds; without it nothing is clamped at the end
 * @returns {Word[]} new objects; the words given are never changed
 */
export function tidyWords(words, duration) {
  const limit = isTime(duration) && duration >= 0 ? duration : Infinity;
  /** @type {Word[]} */
  const inside = [];
  for (const w of Array.isArray(words) ? words : []) {
    if (!w || typeof w !== 'object' || typeof w.text !== 'string') continue;
    const text = w.text.trim();
    if (!text || !isTime(w.start) || !isTime(w.end)) continue;
    const start = Math.max(0, w.start);
    const end = Math.min(limit, w.end);
    if (!(end > start)) continue;
    inside.push({ text, start, end });
  }
  // Array.prototype.sort is stable, so words that start together keep the order they came in.
  inside.sort((a, b) => a.start - b.start);

  /** @type {Word[]} */
  const out = [];
  for (const w of inside) {
    const before = out[out.length - 1];
    if (before && w.start < before.end) {
      if (w.start > before.start) before.end = w.start;
      else w.start = before.end;
    }
    if (!(w.end > w.start)) continue;
    out.push(w);
  }
  return out;
}

/**
 * Timed words for a real take, from its sound and a transcriber.
 *
 * The transcriber is called once per stretch of speech, one after the other, with only that stretch's
 * samples. A take that is all silence never calls it. A transcriber that throws makes this reject with
 * an error naming the stretch's start and end; nothing is swallowed.
 *
 * @param {{ samples: Float32Array, sampleRate: number, transcriber: Transcriber, settings?: RealTakeSettings }} input
 *   samples: the take's sound, mono, on any scale (the silence finder measures against the take's own peak)
 * @returns {Promise<{ words: Word[], silences: Span[], duration: number }>}
 *   times in seconds on the take's own clock; silences as findSilences gives them
 */
export async function realTakeWords({ samples, sampleRate, transcriber, settings } = {}) {
  if (!samples || typeof samples.length !== 'number' || typeof samples.slice !== 'function') {
    throw new TypeError('realTakeWords needs the take\'s sound as an array of samples');
  }
  if (!isTime(sampleRate) || sampleRate <= 0) {
    throw new TypeError(`realTakeWords needs a sample rate above 0 (got ${sampleRate})`);
  }
  if (typeof transcriber !== 'function') {
    throw new TypeError('realTakeWords needs a transcriber function');
  }
  const silenceSettings = (settings && settings.silences) || {};
  if (silenceSettings.channels !== undefined && silenceSettings.channels !== 1) {
    throw new TypeError(`realTakeWords takes mono sound: mix the take down first (got channels ${silenceSettings.channels})`);
  }

  const { silences, duration } = findSilences(samples, sampleRate, silenceSettings);

  // findSilences gives no silences both for a take with no pause and for a take with no sound at all.
  // The second has nothing to transcribe. Its silences are passed on as findSilences gave them, so
  // nothing after this proposes a cut on a take with no sound.
  let hasSound = false;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i]) { hasSound = true; break; }
  }
  if (!hasSound) return { words: [], silences, duration };

  const words = await transcribeByIslands({
    samples,
    sampleRate,
    silences,
    transcriber,
    minIsland: settings ? settings.minIsland : undefined,
  });
  return { words: tidyWords(words, duration), silences, duration };
}
