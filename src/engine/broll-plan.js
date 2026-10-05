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
