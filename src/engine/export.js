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

// ---- Timelines other editors open (the cut on the ORIGINAL recording, so every cut can still be moved there) ----

/** Timelines are written at this frame rate; the original is offered as a constant-rate MP4 at the same rate. */
export const TIMELINE_FPS = 30;
/** The sequence starts at one hour, as editors expect. */
const RECORD_START_FRAMES = 3600 * TIMELINE_FPS;

/** Non-drop-frame timecode for a frame count. */
export function timecode(frame, fps = TIMELINE_FPS) {
  const f = Math.max(0, Math.round(frame));
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(f / (3600 * fps)))}:${two(Math.floor(f / (60 * fps)) % 60)}:${two(Math.floor(f / fps) % 60)}:${two(f % fps)}`;
}

/**
 * The kept ranges as timeline events in whole frames: where each comes from in the original and where it lands in
 * the cut. Record times follow one another with no gap. A range shorter than one frame is left out.
 * @param {[number, number][]} keptRanges
 * @returns {{ sourceIn: number, sourceOut: number, recordIn: number, recordOut: number }[]}
 */
export function timelineEvents(keptRanges, fps = TIMELINE_FPS) {
  const events = [];
  let record = 0;
  for (const [s, e] of keptRanges || []) {
    const sourceIn = Math.round(s * fps);
    const sourceOut = Math.round(e * fps);
    if (!(sourceOut > sourceIn)) continue;
    events.push({ sourceIn, sourceOut, recordIn: record, recordOut: record + (sourceOut - sourceIn) });
    record += sourceOut - sourceIn;
  }
  return events;
}

const plainName = (text) => String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim();

/**
 * A CMX3600 edit decision list of the cut. DaVinci Resolve and Premiere Pro both import it.
 * @param {{ title: string, clipName: string, keptRanges: [number, number][], fps?: number,
 *   broll?: { name: string, windows: { cutStart: number, cutEnd: number, clipStart: number, clipEnd: number }[] } | null }} input
 * @returns {string}
 */
export function edlDocument({ title, clipName, keptRanges, fps = TIMELINE_FPS, broll = null }) {
  const lines = [`TITLE: ${plainName(title) || 'YAP cut'}`, 'FCM: NON-DROP FRAME', ''];
  timelineEvents(keptRanges, fps).forEach((ev, i) => {
    const tc = (n) => timecode(n, fps);
    lines.push(`${String(i + 1).padStart(3, '0')}  AX       AA/V  C        ${tc(ev.sourceIn)} ${tc(ev.sourceOut)} ${tc(RECORD_START_FRAMES + ev.recordIn)} ${tc(RECORD_START_FRAMES + ev.recordOut)}`);
    lines.push(`* FROM CLIP NAME: ${plainName(clipName)}`, '');
  });
  for (const w of (broll && broll.windows) || []) {
    const at = (seconds) => timecode(RECORD_START_FRAMES + Math.round(seconds * fps), fps);
    lines.push(`* B-ROLL: ${plainName(broll.name)} FROM ${timecode(Math.round(w.clipStart * fps), fps)} AT ${at(w.cutStart)} TO ${at(w.cutEnd)}`);
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const xml = (text) => String(text == null ? '' : text).replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A Final Cut Pro 7 XML timeline of the cut (xmeml), the XML that Premiere Pro and DaVinci Resolve both import.
 * Video track 1 and one audio track carry the kept ranges of the original; B-roll, when set, sits on video track 2.
 * @param {{ title: string, clipName: string, duration: number, keptRanges: [number, number][], width?: number, height?: number, fps?: number,
 *   broll?: { name: string, duration: number, windows: { cutStart: number, cutEnd: number, clipStart: number, clipEnd: number }[] } | null }} input
 * @returns {string}
 */
export function fcp7XmlDocument({ title, clipName, duration, keptRanges, width = 1920, height = 1080, fps = TIMELINE_FPS, broll = null }) {
  const events = timelineEvents(keptRanges, fps);
  const total = events.length ? events[events.length - 1].recordOut : 0;
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const sourceFrames = Math.max(Math.round(duration * fps), events.reduce((n, ev) => Math.max(n, ev.sourceOut), 0));
  const fileDef = (id, name, frames, withAudio) => `<file id="${id}"><name>${xml(name)}</name><pathurl>${xml(encodeURI(name))}</pathurl>${rate}<duration>${frames}</duration><media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video>${withAudio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : ''}</media></file>`;
  const item = (id, name, frames, ev, file, audio) => `<clipitem id="${id}"><name>${xml(name)}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rate}<start>${ev.recordIn}</start><end>${ev.recordOut}</end><in>${ev.sourceIn}</in><out>${ev.sourceOut}</out>${file}${audio ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}</clipitem>`;
  const video = events.map((ev, i) => item(`video-${i + 1}`, clipName, sourceFrames, ev, i === 0 ? fileDef('file-1', clipName, sourceFrames, true) : '<file id="file-1"/>', false));
  const audio = events.map((ev, i) => item(`audio-${i + 1}`, clipName, sourceFrames, ev, '<file id="file-1"/>', true));
  const brollFrames = broll ? Math.round(broll.duration * fps) : 0;
  const over = ((broll && broll.windows) || []).map((w, i) => item(`broll-${i + 1}`, broll.name, brollFrames, {
    recordIn: Math.round(w.cutStart * fps), recordOut: Math.round(w.cutEnd * fps), sourceIn: Math.round(w.clipStart * fps), sourceOut: Math.round(w.clipStart * fps) + (Math.round(w.cutEnd * fps) - Math.round(w.cutStart * fps)),
  }, i === 0 ? fileDef('file-2', broll.name, brollFrames, false) : '<file id="file-2"/>', false)).filter((_, i) => broll.windows[i].cutEnd > broll.windows[i].cutStart);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    `<sequence id="sequence-1"><name>${xml(plainName(title) || 'YAP cut')}</name><duration>${total}</duration>${rate}`,
    `<timecode>${rate}<string>01:00:00:00</string><frame>${RECORD_START_FRAMES}</frame><displayformat>NDF</displayformat></timecode>`,
    `<media><video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>`,
    `<track>${video.join('')}</track>`,
    ...(over.length ? [`<track>${over.join('')}</track>`] : []),
    '</video>',
    `<audio><track>${audio.join('')}</track></audio>`,
    '</media></sequence>',
    '</xmeml>',
    '',
  ].join('\n');
}
