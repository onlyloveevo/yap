// Captions: cues built from a take's saved TIMED words, the person's text
// corrections kept apart from those words, and the mapping of a cue's time onto
// the exported cut. Preview and export both use this file, so what the editor
// shows is what Export burns in.
//
// Captions use timed words only. A word with no usable timing is never given a
// time here, and the saved transcript is never written to: a correction is a
// separate record `{ i, was, text }` that applies only while the saved word `i`
// still reads `was`.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its inputs.

import { timedWords } from './editor-words.js';

/** @typedef {{ i: number, was: string, text: string }} Correction */
/** @typedef {{ enabled: boolean, corrections: Correction[], revision: number }} CaptionState */

/** One setting each. A cue is a short line the person can read in one look. */
export const CAPTION_LIMITS = Object.freeze({
  maxWords: 8,
  maxChars: 42,
  /** A cue is never on screen longer than this. */
  maxSeconds: 4.5,
  /** A pause longer than this between two words starts a new cue. */
  pauseBreak: 0.8,
  /** A cue is on screen at least this long, when the next cue leaves room. */
  minSeconds: 0.45,
  /** A cue stays up this long after its last word, when the next cue leaves room. */
  tailHold: 0.25,
  /** One corrected word, in characters. */
  textChars: 40,
  /** Corrections kept per recording. */
  maxCorrections: 2000,
  /** Cues drawn for one export. */
  maxCues: 4000,
});

/** The picture of one cue: a transparent tile laid over the bottom of the video. */
export const CAPTION_TILE = Object.freeze({
  width: 1920,
  height: 320,
  maxBytes: 200 * 1024,
  fontPx: 60,
  minFontPx: 36,
  maxTextWidth: 1536,
  maxLines: 2,
  fontFamily: '"Didot","Bodoni 72","Playfair Display","Hoefler Text",Georgia,"Times New Roman",serif',
  color: '#fbf6ee',
  backing: 'rgba(18,13,11,0.62)',
  hairline: 'rgba(244,198,107,0.55)',
  bottomMargin: 110,
});

export const CAPTION_COPY = Object.freeze({
  noWords: 'Captions need timed words, and this recording has none. Nothing is captioned and nothing is guessed from the text.',
  noneInCut: 'None of the timed words are in the part you are keeping, so there is nothing to caption.',
  off: 'Captions are off for this recording. Exports have no captions.',
});

/** A word may run this far past the end of a kept range and still be captioned in it. */
const END_SLACK = 0.06;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Control characters, line and paragraph separators, zero-width and direction marks: drawn as nothing, so replaced by a space. */
function isHidden(code) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2060 && code <= 0x206f) || code === 0xfeff;
}

/**
 * Plain caption text from anything the person typed: control and direction
 * characters removed, white space collapsed, cut to `max` characters. The text is
 * only ever drawn as pixels, never read as a command.
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function sanitizeCaptionText(text, max = CAPTION_LIMITS.textChars) {
  if (typeof text !== 'string') return '';
  const cleaned = Array.from(text.normalize('NFC'))
    .map((ch) => (isHidden(/** @type {number} */ (ch.codePointAt(0))) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, max).join('').trim();
}

/** The caption state of a recording; a recording saved before captions existed has them off. */
export function captionState(recording) {
  const c = recording && typeof recording === 'object' ? recording.captions : null;
  const corrections = c && Array.isArray(c.corrections)
    ? c.corrections.filter((x) => x && Number.isInteger(x.i) && x.i >= 0 && typeof x.was === 'string' && typeof x.text === 'string' && sanitizeCaptionText(x.text))
    : [];
  return {
    enabled: Boolean(c && c.enabled === true),
    corrections: corrections.slice(0, CAPTION_LIMITS.maxCorrections).map((x) => ({ i: x.i, was: x.was, text: sanitizeCaptionText(x.text) })),
    revision: c && Number.isInteger(c.revision) && c.revision >= 0 ? c.revision : 0,
  };
}

/** Index -> corrected text, for the corrections that still match the saved word they were made on. */
function correctionMap(words, corrections) {
  const map = new Map();
  for (const x of Array.isArray(corrections) ? corrections : []) {
    const word = Array.isArray(words) ? words[x.i] : null;
    if (word && word.text === x.was) map.set(x.i, sanitizeCaptionText(x.text));
  }
  return map;
}

/** Corrections whose saved word has since changed: kept in the record but not used. */
export function staleCorrections(words, corrections) {
  const live = correctionMap(words, corrections);
  return (Array.isArray(corrections) ? corrections : []).filter((x) => !live.has(x.i));
}

/**
 * Where a time on the original recording falls on the exported cut: its seconds
 * from the start of the cut, or null when the time is inside a removed span.
 * @param {number} t
 * @param {[number, number][]} ranges ascending kept ranges
 * @returns {number | null}
 */
export function sourceToCut(t, ranges) {
  let before = 0;
  for (const [s, e] of ranges) {
    if (t >= s - 1e-6 && t <= e + 1e-6) return round3(before + Math.min(Math.max(t, s), e) - s);
    before += e - s;
  }
  return null;
}

/** Where a second of the exported cut falls on the original recording (the inverse of sourceToCut). */
export function cutToSource(t, ranges) {
  let before = 0;
  for (const [s, e] of ranges) {
    if (t <= before + (e - s) + 1e-6) return round3(s + Math.max(0, t - before));
    before += e - s;
  }
  return ranges.length ? ranges[ranges.length - 1][1] : 0;
}

/** The length of the exported cut. */
export function cutLength(ranges) {
  return round3(ranges.reduce((n, [s, e]) => n + (e - s), 0));
}

/**
 * The cues of a take. Without `ranges` they run on the original recording's
 * time (the Original view). With `ranges` (the kept ranges of the cut) only the
 * words wholly inside a kept range are captioned, and every time is in seconds
 * of the exported cut, so a cue whose words sit either side of a removed span is
 * one continuous cue there.
 *
 * Each cue has `from` and `to` (transcript indices of its first and last word),
 * its text, the span of its words (`start`, `end`) and the span it is on screen
 * (`shownFrom`, `shownTo`): the span of its words held a little, kept inside
 * the room the next cue leaves, never more than CAPTION_LIMITS.maxSeconds.
 * @param {unknown} words the saved transcript
 * @param {{ corrections?: Correction[], duration?: number | null, ranges?: [number, number][] | null }} [options]
 * @returns {{ id: string, from: number, to: number, text: string, start: number, end: number, shownFrom: number, shownTo: number, corrected: boolean }[]}
 */
export function buildCaptionCues(words, { corrections = [], duration = null, ranges = null } = {}) {
  const fix = correctionMap(words, corrections);
  let timed = timedWords(words, duration);
  const mapped = Array.isArray(ranges);
  const total = mapped ? cutLength(ranges) : (isNum(duration) ? duration : Infinity);
  /** @type {{ i: number, text: string, start: number, end: number, fixed: boolean }[]} */
  let list = timed.map((w) => ({ i: w.i, text: fix.has(w.i) ? fix.get(w.i) : w.text.trim(), start: w.start, end: w.end, fixed: fix.has(w.i) }));
  if (mapped) {
    // A word is captioned when it lies wholly inside one kept range. The last range may end a few
    // milliseconds before the recording's own length (the audio file's length differs a little), so
    // a word may overrun a range's end by END_SLACK; it never starts before a range's start.
    const starts = [];
    let before = 0;
    for (const [s0, e0] of ranges) { starts.push(before); before += e0 - s0; }
    list = list.flatMap((w) => {
      const k = ranges.findIndex(([s0, e0]) => w.start >= s0 - 1e-6 && w.end <= e0 + END_SLACK);
      if (k < 0) return [];
      const [s0, e0] = ranges[k];
      const at = (t) => round3(starts[k] + Math.min(Math.max(t, s0), e0) - s0);
      return [{ ...w, start: at(w.start), end: at(w.end) }];
    });
  }
  list = list.filter((w) => w.text && isNum(w.start) && isNum(w.end));

  /** @type {typeof list[]} */
  const groups = [];
  let cur = [];
  const chars = (g) => g.reduce((n, w) => n + w.text.length, 0) + Math.max(0, g.length - 1);
  for (const w of list) {
    const last = cur[cur.length - 1];
    const breakBefore = last && (
      cur.length >= CAPTION_LIMITS.maxWords
      || chars(cur) + 1 + w.text.length > CAPTION_LIMITS.maxChars
      || w.start - last.end > CAPTION_LIMITS.pauseBreak
      || w.end - cur[0].start > CAPTION_LIMITS.maxSeconds
      || /[.?!…]["')\]]?$/.test(last.text)
      || (/,$/.test(last.text) && chars(cur) >= 28)
    );
    if (breakBefore) { groups.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  const cues = groups.slice(0, CAPTION_LIMITS.maxCues).map((g) => ({
    id: `c${g[0].i}-${g[g.length - 1].i}`,
    from: g[0].i,
    to: g[g.length - 1].i,
    text: g.map((w) => w.text).join(' '),
    start: round3(g[0].start),
    end: round3(g[g.length - 1].end),
    shownFrom: 0,
    shownTo: 0,
    corrected: g.some((w) => w.fixed),
  }));
  cues.forEach((cue, k) => {
    const next = cues[k + 1];
    const room = next ? next.start : total;
    let to = Math.max(cue.end + CAPTION_LIMITS.tailHold, cue.start + CAPTION_LIMITS.minSeconds);
    to = Math.min(to, room, cue.start + CAPTION_LIMITS.maxSeconds, total);
    cue.shownFrom = cue.start;
    cue.shownTo = round3(Math.max(to, Math.min(cue.end, room)));
  });
  return cues.filter((c) => c.shownTo > c.shownFrom);
}

/**
 * The cue on screen at a moment, or null. Times are in the same timeline the
 * cues were built in.
 * @param {ReturnType<typeof buildCaptionCues>} cues
 * @param {number} t
 */
export function cueAt(cues, t) {
  if (!isNum(t)) return null;
  for (const cue of cues) if (t >= cue.shownFrom - 1e-9 && t < cue.shownTo) return cue;
  return null;
}

/**
 * A short fingerprint of what captions say and when (for "has this changed since
 * the export"): a plain 32-bit hash of each cue's id, text and times. It is for
 * comparing two states, not a security hash.
 * @param {ReturnType<typeof buildCaptionCues>} cues
 */
export function captionFingerprint(cues) {
  let h = 2166136261;
  const mix = (str) => { for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; } };
  for (const c of cues) mix(`${c.id}|${c.text}|${c.shownFrom}|${c.shownTo};`);
  return h.toString(16).padStart(8, '0');
}

/**
 * The lines of a cue's tile: its text wrapped to `maxWidth` pixels by `measure`,
 * the font shrunk until it fits `maxLines` lines. Pure but for `measure`, which
 * the caller gives (a canvas in the browser, a width table in a test).
 * @param {string} text
 * @param {(text: string, fontPx: number) => number} measure width in pixels
 * @returns {{ lines: string[], fontPx: number }}
 */
export function layoutCaption(text, measure) {
  const words = text.split(' ').filter(Boolean);
  for (let px = CAPTION_TILE.fontPx; px >= CAPTION_TILE.minFontPx; px -= 4) {
    const lines = [];
    let line = '';
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (line && measure(trial, px) > CAPTION_TILE.maxTextWidth) { lines.push(line); line = w; } else line = trial;
    }
    if (line) lines.push(line);
    if (lines.length <= CAPTION_TILE.maxLines) return { lines, fontPx: px };
  }
  // At the smallest size, keep two lines and shorten the second with an ellipsis rather than overflow.
  const px = CAPTION_TILE.minFontPx;
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (line && measure(trial, px) > CAPTION_TILE.maxTextWidth) { lines.push(line); line = w; } else line = trial;
  }
  if (line) lines.push(line);
  const kept = lines.slice(0, CAPTION_TILE.maxLines);
  if (lines.length > CAPTION_TILE.maxLines) kept[kept.length - 1] = `${kept[kept.length - 1].replace(/\s+\S*$/, '')}…`;
  return { lines: kept, fontPx: px };
}
