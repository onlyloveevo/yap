// B-roll: one picture insert per recording, defined in ORIGINAL recording time.
//
// The person picks a stretch of the original recording and a local clip. While that stretch plays, the clip's
// picture replaces the camera picture; the original narration is never touched (the clip's own sound is ignored).
// Preview and Export both use this file, so what the editor shows is what Export renders.
//
// A clip is not stretched or looped. It is laid on the original timeline: the moment `start` shows the clip at
// `inPoint`, and a later moment `t` shows the clip at `inPoint + (t - start)`. Where the stretch crosses a removed
// span, the clip's picture for the removed seconds is removed with it, so picture and narration stay together.
// The clip must be long enough for the whole selected stretch; a range that is too long is refused, never filled
// with black or a frozen frame.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its inputs.

import { keptRanges } from './cutlist.js';

/** @typedef {{ id: string, bytes: number, sha256: string, duration: number, width: number, height: number, name: string, container: 'mp4' | 'webm' }} BrollAsset */
/** @typedef {{ asset: BrollAsset | null, start: number, end: number, inPoint: number, revision: number }} BrollState */

export const BROLL_LIMITS = Object.freeze({
  /** The clip file, in bytes. An engineering bound on the upload; the body is streamed to disk. */
  maxBytes: 512 * 1024 * 1024,
  /** The shortest stretch of the recording a clip can cover. */
  minSeconds: 0.5,
  /** A picture size, in pixels, the export will accept for a clip. */
  maxSide: 8192,
  /** A clip file name kept for display, in characters. */
  nameChars: 80,
});

export const BROLL_COPY = Object.freeze({
  none: 'No B-roll. The camera picture shows all the way through.',
  tooShort: (clip, room, need) => `This clip is ${clip.toFixed(1)} s long. From the chosen start it has ${room.toFixed(1)} s, but the range needs ${need.toFixed(1)} s. Choose a shorter range or an earlier start in the clip.`,
  allCut: 'The chosen range is entirely in a part you removed, so the B-roll would never show. Choose a range in the part you keep, or remove the B-roll.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round3 = (x) => Math.round(x * 1000) / 1000;
const ASSET_ID = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{64}$/;

/** True for an asset record the server wrote after it probed the clip. */
export function validAsset(a) {
  return Boolean(a) && typeof a === 'object' && typeof a.id === 'string' && ASSET_ID.test(a.id)
    && typeof a.sha256 === 'string' && SHA.test(a.sha256) && a.sha256.startsWith(a.id)
    && Number.isInteger(a.bytes) && a.bytes > 0 && isNum(a.duration) && a.duration > 0
    && Number.isInteger(a.width) && a.width > 0 && Number.isInteger(a.height) && a.height > 0
    && (a.container === 'mp4' || a.container === 'webm') && typeof a.name === 'string';
}

/**
 * The saved B-roll of a recording, read defensively.
 * @param {any} recording
 * @returns {BrollState}
 */
export function brollState(recording) {
  const b = recording && typeof recording === 'object' ? recording.broll : null;
  const revision = b && Number.isInteger(b.revision) && b.revision >= 0 ? b.revision : 0;
  if (!b || !validAsset(b.asset) || !isNum(b.start) || !isNum(b.end) || !isNum(b.inPoint) || !(b.end > b.start) || b.start < 0 || b.inPoint < 0) {
    return { asset: null, start: 0, end: 0, inPoint: 0, revision };
  }
  return { asset: { ...b.asset }, start: b.start, end: b.end, inPoint: b.inPoint, revision };
}

/**
 * Check a chosen range against the recording and the clip. Returns `{ ok: true, start, end, inPoint }` with the
 * numbers rounded to milliseconds, or `{ ok: false, error }` in words the person can act on.
 * @param {{ start: unknown, end: unknown, inPoint: unknown }} range
 * @param {{ duration: number }} clip the probed clip
 * @param {number} recordingDuration
 * @param {[number, number][] | null} [kept] the kept ranges of the recording; when given, the range must overlap one
 */
export function checkBrollRange({ start, end, inPoint }, clip, recordingDuration, kept = null) {
  if (!isNum(start) || !isNum(end) || !isNum(inPoint)) return { ok: false, error: 'The B-roll start, end and clip start must be numbers of seconds. Nothing was changed.' };
  const s = round3(start);
  const e = round3(end);
  const i = round3(inPoint);
  if (s < 0 || e > round3(recordingDuration) + 1e-9 || !(e > s)) {
    return { ok: false, error: `Choose a start of at least 0 and an end after it, no later than ${+recordingDuration.toFixed(2)} s (the recording's length). Nothing was changed.` };
  }
  if (e - s < BROLL_LIMITS.minSeconds) return { ok: false, error: `The B-roll must cover at least ${BROLL_LIMITS.minSeconds} s of the recording. Nothing was changed.` };
  if (i < 0 || i >= clip.duration) return { ok: false, error: `The clip starts at ${i} s but it is only ${clip.duration.toFixed(1)} s long. Nothing was changed.` };
  const need = e - s;
  const room = clip.duration - i;
  if (need > room + 0.05) return { ok: false, error: `${BROLL_COPY.tooShort(clip.duration, room, need)} Nothing was changed.` };
  if (kept && !brollWindows(kept, { start: s, end: e, inPoint: i }).length) return { ok: false, error: `${BROLL_COPY.allCut} Nothing was changed.` };
  return { ok: true, start: s, end: e, inPoint: i };
}

/**
 * Where the B-roll falls on the exported cut. One window for each kept range the chosen stretch touches:
 * `cutStart`..`cutEnd` on the exported timeline, showing the clip from `clipStart` to `clipEnd`.
 * @param {[number, number][]} kept ascending kept ranges of the original recording
 * @param {{ start: number, end: number, inPoint: number }} range
 * @returns {{ cutStart: number, cutEnd: number, clipStart: number, clipEnd: number }[]}
 */
export function brollWindows(kept, { start, end, inPoint }) {
  const windows = [];
  let offset = 0;
  for (const [s, e] of kept) {
    const a = Math.max(s, start);
    const b = Math.min(e, end);
    if (b - a > 0.001) {
      windows.push({
        cutStart: round3(offset + (a - s)),
        cutEnd: round3(offset + (b - s)),
        clipStart: round3(inPoint + (a - start)),
        clipEnd: round3(inPoint + (b - start)),
      });
    }
    offset += e - s;
  }
  return windows;
}

/**
 * Preview: the moment of the clip to show while the original recording is at `t`, or null when the camera
 * picture shows. The same arithmetic Export uses for each window.
 * @param {BrollState} broll
 * @param {number} t seconds of the original recording
 * @returns {number | null}
 */
export function brollClipTime(broll, t) {
  if (!broll || !broll.asset || !isNum(t) || t < broll.start || t >= broll.end) return null;
  return round3(broll.inPoint + (t - broll.start));
}

const fixed = (x) => (Math.round(x * 1000) / 1000).toFixed(3);

/**
 * The ffmpeg arguments for the cut with the B-roll laid over the picture. Takes the arguments `buildFfmpegArgs`
 * made and adds the clip as one more input and one overlay stage per window after the concat. The audio chain is
 * not touched, so the narration is exactly what it was without B-roll. The video length is the cut's length.
 *
 * The result still ends its video label as `[v]`, so caption export (caption-export.js) can lay captions over it.
 * @param {string[]} base what buildFfmpegArgs returned
 * @param {{ file: string, windows: { cutStart: number, cutEnd: number, clipStart: number, clipEnd: number }[], width: number, height: number }} broll
 * @returns {{ args: string[], inputs: number }} `inputs` counts every `-i` in the result, so a later stage knows its index
 */
export function brollFfmpegArgs(base, { file, windows, width, height }) {
  const args = [...base];
  const graphAt = args.indexOf('-filter_complex');
  const mapAt = args.indexOf('-map');
  if (graphAt < 0 || mapAt < 0 || args[mapAt + 1] !== '[v]' || !/\[v\]\[a\]$/.test(args[graphAt + 1])) {
    throw new TypeError('The export plan could not take B-roll');
  }
  if (!Array.isArray(windows) || !windows.length) throw new TypeError('B-roll needs at least one window');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > BROLL_LIMITS.maxSide || height > BROLL_LIMITS.maxSide) {
    throw new TypeError('The picture size is not usable for B-roll');
  }
  for (const w of windows) {
    if (![w.cutStart, w.cutEnd, w.clipStart, w.clipEnd].every((x) => isNum(x) && x >= 0) || !(w.cutEnd > w.cutStart) || !(w.clipEnd > w.clipStart)) {
      throw new TypeError('A B-roll window needs ascending finite times');
    }
  }
  const inputs = args.reduce((n, a) => n + (a === '-i' ? 1 : 0), 0);
  const at = inputs; // the clip's input index: it goes after every input the base arguments already had
  args.splice(graphAt, 0, '-i', String(file));
  const n = windows.length;
  const parts = [];
  // The clip is read once and split, one copy per window, each cut to its own moments and moved to its place on the cut.
  parts.push(n === 1
    ? `[${at}:v]null[s0]`
    : `[${at}:v]split=${n}${windows.map((_, k) => `[s${k}]`).join('')}`);
  windows.forEach((w, k) => {
    parts.push(`[s${k}]trim=start=${fixed(w.clipStart)}:end=${fixed(w.clipEnd)},setpts=PTS-STARTPTS+${fixed(w.cutStart)}/TB,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic,crop=${width}:${height},setsar=1,format=yuv420p[b${k}]`);
  });
  let last = '[vbase]';
  windows.forEach((w, k) => {
    const out = k === n - 1 ? '[v]' : `[vo${k}]`;
    parts.push(`${last}[b${k}]overlay=x=0:y=0:format=auto:eof_action=pass:enable='gte(t,${fixed(w.cutStart)})*lt(t,${fixed(w.cutEnd)})'${out}`);
    last = out;
  });
  const g = args.indexOf('-filter_complex');
  args[g + 1] = `${args[g + 1].replace(/\[v\]\[a\]$/, '[vbase][a]')};${parts.join(';')}`;
  return { args, inputs: inputs + 1 };
}

/** Where a suggestion may sit: the face stays on the opening and on the last words. */
export const SUGGEST = Object.freeze({ max: 3, minSeconds: 2.5, maxSeconds: 6, hookSeconds: 4, closeSeconds: 1, apart: 3 });

const endsSentence = (text) => /[.!?]["')\]]?$/.test(String(text).trim());

/**
 * Moments of the take where B-roll fits: a whole sentence or two the person keeps, long enough to show a clip and
 * short enough to hold it, after the opening and before the close. A moment may run across a cut between sentences. Read from the saved words and the cut, nothing
 * else. A take with no heard words gets no suggestion: there is nothing said for a clip to sit over.
 * @param {any} recording
 * @returns {{ start: number, end: number, text: string }[]} in time order, in original recording time
 */
export function suggestBrollMoments(recording, options = {}) {
  const o = { ...SUGGEST, ...options };
  const duration = recording && recording.duration;
  if (!isNum(duration) || duration <= 0) return [];
  const kept = keptRanges(recording.cuts && Array.isArray(recording.cuts.cuts) ? recording.cuts : { cuts: [], undoStack: [] }, duration);
  const total = kept.reduce((n, [s, e]) => n + (e - s), 0);
  const words = (Array.isArray(recording.transcript) ? recording.transcript : [])
    .filter((w) => w && typeof w.text === 'string' && isNum(w.start) && isNum(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  // The kept words on the cut's own clock. A moment may run across a cut (a filler or a pause taken out between two
  // sentences): covering that join is what B-roll is for, so its length is measured in the cut, not in the original.
  /** @type {{ text: string, start: number, end: number, at: number, to: number }[]} */
  const said = [];
  let before = 0;
  for (const [s, e] of kept) {
    for (const w of words) if (w.start >= s - 1e-6 && w.end <= e + 1e-6) said.push({ text: w.text, start: w.start, end: w.end, at: before + (w.start - s), to: before + (w.end - s) });
    before += e - s;
  }
  // Sentences: closed by punctuation or by a pause that is still in the cut.
  const sentences = [];
  let run = [];
  for (const w of said) {
    if (run.length && w.at - run[run.length - 1].to > 0.6) { sentences.push(run); run = []; }
    run.push(w);
    if (endsSentence(w.text)) { sentences.push(run); run = []; }
  }
  if (run.length) sentences.push(run);
  /** @type {{ start: number, end: number, text: string, cutStart: number, cutSeconds: number }[]} */
  const found = [];
  for (let i = 0; i < sentences.length; i++) {
    const from = sentences[i][0];
    let taken = [];
    let j = i;
    while (j < sentences.length && sentences[j][sentences[j].length - 1].to - from.at <= o.maxSeconds) taken = taken.concat(sentences[j++]);
    if (!taken.length) taken = sentences[i].filter((w) => w.to - from.at <= o.maxSeconds);
    if (!taken.length) continue;
    const last = taken[taken.length - 1];
    if (last.to - from.at < o.minSeconds) continue;
    found.push({ start: round3(from.start), end: round3(last.end), text: taken.map((w) => w.text.trim()).join(' '), cutStart: from.at, cutSeconds: last.to - from.at });
    i = Math.max(i, j - 1);
  }
  const fits = (hook) => found.filter((m) => m.cutStart >= hook - 1e-6 && m.cutStart + m.cutSeconds <= total - o.closeSeconds + 1e-6);
  let pool = fits(o.hookSeconds);
  if (!pool.length) pool = fits(Math.min(o.hookSeconds, 1.5));
  // The longest first, then spaced apart, then back in time order.
  const chosen = [];
  for (const m of [...pool].sort((a, b) => b.cutSeconds - a.cutSeconds || a.start - b.start)) {
    if (chosen.length >= o.max) break;
    if (chosen.some((c) => m.start < c.end + o.apart && m.end > c.start - o.apart)) continue;
    chosen.push(m);
  }
  return chosen.sort((a, b) => a.start - b.start).map(({ start, end, text }) => ({ start, end, text }));
}

const keyOf = (word) => String(word).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(?<=[a-z]{3})s$/, '');

/**
 * Library clips in the order they suit some spoken words: a clip whose tags or name are said comes first, and the
 * rest keep the order they came in. `matches` counts the tag words found, so a caller can tell a real match from none.
 * @template {{ name?: string, tags?: string[] }} T
 * @param {string} text
 * @param {T[]} clips
 * @returns {(T & { matches: number })[]}
 */
export function rankBrollClips(text, clips) {
  const said = new Set(String(text || '').split(/\s+/).map(keyOf).filter(Boolean));
  return (Array.isArray(clips) ? clips : [])
    .map((clip, at) => {
      const own = new Set([...(Array.isArray(clip.tags) ? clip.tags : []), ...String(clip.name || '').split(/\s+/)].map(keyOf).filter((k) => k.length > 2));
      return { clip: { ...clip, matches: [...own].filter((k) => said.has(k)).length }, at };
    })
    .sort((a, b) => b.clip.matches - a.clip.matches || a.at - b.at)
    .map((x) => x.clip);
}

/**
 * Search the library by what the person typed: every typed word must be in a clip's name or tags.
 * @template {{ name?: string, tags?: string[] }} T
 * @param {string} query
 * @param {T[]} clips
 * @returns {T[]}
 */
export function searchBrollClips(query, clips) {
  const wanted = String(query || '').toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!wanted.length) return [...(clips || [])];
  return (clips || []).filter((clip) => {
    const hay = [String(clip.name || ''), ...(Array.isArray(clip.tags) ? clip.tags : [])].join(' ').toLowerCase();
    return wanted.every((w) => hay.includes(w));
  });
}

/** Tags as the person typed them, made safe to keep: lower case, short, no duplicates, twelve at most. */
export function cleanTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  for (const raw of list) {
    const tag = String(raw).toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}
