// Pace over the last 10 seconds and the pace cue (LIVE-06, D-14).
// Runs on the live path with no model call and no network (D-11). Pure: the
// caller passes `now` in seconds of take time; this module never reads a clock.
// Browser-safe: imports nothing from `node:`.

/**
 * @typedef {{ text: string, start: number, end: number }} Word  seconds of take time
 * @typedef {{ start: number, end: number } | [number, number]} Range
 * @typedef {{ show: boolean, wpm: number | null, text: string | null }} PaceCue
 */

/** One setting each (D-35). Change a value here; no other code changes. */
export const PACE_DEFAULTS = Object.freeze({
  windowSec: 10, // pace is measured over the last 10 s of transcript (D-14)
  minElapsedSec: 5, // no pace is measured before 5 s of take time
  threshold: 170, // words per minute; the cue shows only ABOVE this
});

/** Exact copy shown to the person (CONTEXT.md "Exact copy"). */
export const COPY = Object.freeze({
  pace: 'Give this point a little space',
});

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Words per minute over the window that ends at `now`.
 * Counts words whose end lies in (now - window, now], where
 * window = min(windowSec, now). Returns null before minElapsedSec.
 * No rounding: wpm = words in window × 60 / window seconds.
 *
 * @param {Word[]} words
 * @param {number} now  seconds of take time
 * @param {{ windowSec?: number, minElapsedSec?: number }} [settings]
 * @returns {number | null}
 */
export function wordsPerMinute(words, now, settings = {}) {
  const windowSec = isFiniteNumber(settings.windowSec) ? settings.windowSec : PACE_DEFAULTS.windowSec;
  const minElapsedSec = isFiniteNumber(settings.minElapsedSec)
    ? settings.minElapsedSec
    : PACE_DEFAULTS.minElapsedSec;
  if (!isFiniteNumber(now) || now < minElapsedSec) return null;
  const window = Math.min(windowSec, now);
  if (!(window > 0)) return null;
  const from = now - window;
  let count = 0;
  for (const w of Array.isArray(words) ? words : []) {
    if (w && isFiniteNumber(w.end) && w.end > from && w.end <= now) count += 1;
  }
  return (count * 60) / window;
}

/**
 * The pace cue at `now`. Shows only when pace is strictly above the threshold.
 * `options` may be explicit ({ threshold, enabled }) or the person's memory
 * settings ({ paceThreshold, paceCue: 'off' }); explicit values win.
 *
 * @param {Word[]} words
 * @param {number} now
 * @param {{ threshold?: number, enabled?: boolean, paceThreshold?: number, paceCue?: string,
 *           windowSec?: number, minElapsedSec?: number }} [options]
 * @returns {PaceCue}
 */
export function paceCue(words, now, options = {}) {
  const opts = options || {};
  const threshold = isFiniteNumber(opts.threshold)
    ? opts.threshold
    : isFiniteNumber(opts.paceThreshold)
      ? opts.paceThreshold
      : PACE_DEFAULTS.threshold;
  const enabled = opts.enabled !== false && opts.paceCue !== 'off';
  const wpm = wordsPerMinute(words, now, opts);
  const show = enabled && wpm !== null && wpm > threshold;
  return { show, wpm, text: show ? COPY.pace : null };
}

/**
 * Whether a pace sits inside a band, inclusive at both ends.
 * @param {number | null} wpm
 * @param {[number, number]} band  [low, high]
 * @returns {boolean}
 */
export function paceInRange(wpm, band) {
  if (!isFiniteNumber(wpm) || !Array.isArray(band) || band.length < 2) return false;
  const [low, high] = band;
  return wpm >= low && wpm <= high;
}

function rangeBounds(r) {
  if (Array.isArray(r)) return [r[0], r[1]];
  if (r && typeof r === 'object') return [r.start, r.end];
  return [NaN, NaN];
}

/**
 * Pace of the kept part of a take: words whose midpoint lies in a kept range
 * (start ≤ mid ≤ end), × 60, divided by the total kept seconds.
 * Returns null for an empty segment (no kept time, or no word in it).
 *
 * @param {Word[]} words
 * @param {Range[]} keptRanges
 * @returns {number | null}
 */
export function segmentPace(words, keptRanges) {
  const ranges = (Array.isArray(keptRanges) ? keptRanges : [])
    .map(rangeBounds)
    .filter(([s, e]) => isFiniteNumber(s) && isFiniteNumber(e) && e > s);
  const keptSec = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
  if (!(keptSec > 0)) return null;
  let count = 0;
  for (const w of Array.isArray(words) ? words : []) {
    if (!w || !isFiniteNumber(w.start) || !isFiniteNumber(w.end)) continue;
    const mid = (w.start + w.end) / 2;
    if (ranges.some(([s, e]) => mid >= s && mid <= e)) count += 1;
  }
  if (count === 0) return null;
  return (count * 60) / keptSec;
}

/**
 * Display form of a pace: a whole number, rounded half up. '' when there is none.
 * @param {number | null} n
 * @returns {string}
 */
export function formatWpm(n) {
  if (!isFiniteNumber(n)) return '';
  return String(Math.floor(n + 0.5));
}
