// Export planning (CUT-04; D-21, D-22): which ranges of the take are kept, the
// refusal of any cut that would clip a word, the ffmpeg argument list that
// renders the kept ranges, and the cut-list document written beside an export.
//
// The original recording is never changed: Export only ever writes new files
// beside it (src/node/export-file.js does the writing).
//
// Pure and browser-safe: imports nothing from `node:`, never mutates inputs.

import { keptRanges as keptOf, listCuts } from './cutlist.js';

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {import('./cutlist.js').Cut} Cut
 * @typedef {{ cutId: string, word: string, edge: number }} Clip
 */

/** A cut edge closer than this to a word's start or end touches it; it does not clip it. */
const EDGE_EPSILON = 1e-6;

/** Thrown when Export would clip a word or would keep nothing. Nothing is written. */
export class ExportRefusedError extends Error {
  /**
   * @param {string} message
   * @param {Clip[]} [clips]
   */
  constructor(message, clips = []) {
    super(message);
    this.name = 'ExportRefusedError';
    /** @type {Clip[]} */
    this.clips = clips;
  }
}

/**
 * Applied cuts merged where they overlap or touch, each merged span keeping the
 * ids of the cuts whose edges it starts and ends on.
 * @param {Cut[]} cuts
 * @param {number} duration
 */
function mergedApplied(cuts, duration) {
  const spans = cuts
    .filter((c) => c && c.applied)
    .map((c) => ({ start: Math.max(0, c.start), end: Math.min(duration, c.end), id: String(c.id) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  /** @type {Array<{ start: number, end: number, startId: string, endId: string }>} */
  const merged = [];
  for (const c of spans) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) {
      if (c.end > last.end) {
        last.end = c.end;
        last.endId = c.id;
      }
    } else merged.push({ start: c.start, end: c.end, startId: c.id, endId: c.id });
  }
  return merged;
}

/**
 * Plan an export: the kept ranges over [0, duration] (the complement of the
 * applied cuts, merged first). Refuses, with every clip named, when a rendered
 * cut edge lies strictly inside a word; an edge exactly at a word's start or
 * end is allowed. Unapplied (amber) cuts are ignored here.
 * @param {{ duration: number, cuts?: Cut[], words?: Word[] }} input
 * @returns {{ keptRanges: [number, number][], keptSeconds: number }}
 */
export function planExport({ duration, cuts = [], words = [] }) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ExportRefusedError(`Export needs a take with a duration (got ${duration})`);
  }
  const list = Array.isArray(cuts) ? cuts : [];
  /** @type {Clip[]} */
  const clips = [];
  for (const span of mergedApplied(list, duration)) {
    const edges = [];
    if (span.start > 0) edges.push([span.start, span.startId]);
    if (span.end < duration) edges.push([span.end, span.endId]);
    for (const [edge, cutId] of edges) {
      for (const w of Array.isArray(words) ? words : []) {
        if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
        if (edge > w.start + EDGE_EPSILON && edge < w.end - EDGE_EPSILON) {
          clips.push({ cutId, word: String(w.text), edge });
        }
      }
    }
  }
  if (clips.length) {
    const named = clips.map((c) => `cut ${c.cutId} at ${c.edge} s would clip "${c.word}"`).join('; ');
    throw new ExportRefusedError(`Export refused, nothing was written: ${named}`, clips);
  }
  const kept = keptOf({ cuts: list, undoStack: [] }, duration);
  if (!kept.length) throw new ExportRefusedError('Export refused, nothing was written: every second of the take is cut');
  const keptSeconds = kept.reduce((n, [s, e]) => n + (e - s), 0);
  return { keptRanges: kept, keptSeconds };
}

/** A time as a plain decimal string for an ffmpeg filter (never a shell string). */
function num(x) {
  return String(Number(x.toFixed(6)));
}

/**
 * The ffmpeg arguments that render the kept ranges of `input` (video and
 * audio) into one MP4 at `output`. An argument array for spawn, never a shell
 * string; every time is checked to be a finite number first.
 * @param {string} input
 * @param {[number, number][]} ranges ascending kept ranges in seconds
 * @param {string} output
 * @returns {string[]}
 */
export function buildFfmpegArgs(input, ranges, output) {
  if (!Array.isArray(ranges) || !ranges.length) throw new TypeError('buildFfmpegArgs needs at least one kept range');
  let prev = -Infinity;
  for (const r of ranges) {
    const ok = Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number' &&
      Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] >= 0 && r[1] > r[0] && r[0] >= prev;
    if (!ok) throw new TypeError(`buildFfmpegArgs needs ascending [start, end] numbers (got ${JSON.stringify(r)})`);
    prev = r[1];
  }
  const parts = [];
  const pads = [];
  ranges.forEach(([s, e], i) => {
    parts.push(`[0:v]trim=start=${num(s)}:end=${num(e)},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${num(s)}:end=${num(e)},asetpts=PTS-STARTPTS[a${i}]`);
    pads.push(`[v${i}][a${i}]`);
  });
  parts.push(`${pads.join('')}concat=n=${ranges.length}:v=1:a=1[v][a]`);
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', String(input),
    '-filter_complex', parts.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-f', 'mp4',
    '-y', String(output),
  ];
}

/**
 * The cut-list JSON written beside an export: every cut (applied or not, in
 * time order), the kept ranges, the outputs and whether video was rendered.
 * @param {{ source: string, sourceSha256: string, duration: number, keptRanges: [number, number][],
 *   cuts?: Cut[], outputs: { audio: string | null, video: string | null }, video: string,
 *   sourceVideo?: string, sourceVideoSha256?: string }} input
 */
export function cutListDocument({ source, sourceSha256, duration, keptRanges, cuts = [], outputs, video, sourceVideo, sourceVideoSha256 }) {
  const doc = {
    version: 1,
    source,
    sourceSha256,
    duration,
    keptRanges: keptRanges.map(([s, e]) => [s, e]),
    cuts: listCuts({ cuts: Array.isArray(cuts) ? cuts : [], undoStack: [] }),
    outputs: { audio: outputs.audio ?? null, video: outputs.video ?? null },
    video,
  };
  if (sourceVideo !== undefined) Object.assign(doc, { sourceVideo, sourceVideoSha256 });
  return doc;
}
