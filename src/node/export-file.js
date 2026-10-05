// Export to real files (CUT-04; D-21, D-22). Renders the kept ranges of a take
// to `<name>.cut.wav` (always, in plain JavaScript) and to `<name>.cut.mp4`
// when an ffmpeg binary already exists on the machine, then writes
// `<name>.cuts.json` beside them, last.
//
// Threats handled here:
// - T-01-14: the original recording is only ever read (flag 'r'); every output
//   goes to a temporary name and is renamed into place, and no output may land
//   on an input's path.
// - T-01-15: ffmpeg is started with spawnSync and an argument array, never a
//   shell string; the times in it are checked numbers (buildFfmpegArgs).
// - T-01-16: the output folder is resolved with resolveDataDir and must lie
//   inside the app folder.
//
// No npm package is used: ffmpeg is found, never installed (QUESTIONS.md Q1).
// When none is found the cut list says so and the WAV is still rendered.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWav, encodeWav, sliceRanges } from '../engine/wav.js';
import { planExport, buildFfmpegArgs, cutListDocument, ExportRefusedError } from '../engine/export.js';
import { resolveDataDir, writeJsonAtomic } from './store.js';
import { buildCaptionCues } from '../engine/caption-model.js';
import { CaptionExportError, checkCaptionTiles, probeVideoSize, writeCaptionAssets, captionFfmpegArgs } from './caption-export.js';
import { brollFfmpegArgs } from '../engine/broll-plan.js';

/** The app folder: two levels above src/node/. */
const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What the cut list says about the video, word for word. */
export const VIDEO_NOTES = Object.freeze({
  rendered: 'rendered',
  noFfmpeg: 'not rendered: no ffmpeg found on this machine',
  noInput: 'not rendered: no video input',
});

/** @param {string} p */
function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an ffmpeg binary that already exists: YAP_FFMPEG first, then a locally
 * installed ffmpeg-static binary (only if one is ever added at setup), then
 * the first executable `ffmpeg` on PATH. Null when there is none.
 * @param {{ env?: Record<string, string | undefined>, appRoot?: string, exists?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
export function resolveFfmpeg({ env = process.env, appRoot = DEFAULT_APP_ROOT, exists = isExecutableFile } = {}) {
  if (env && env.YAP_FFMPEG) return env.YAP_FFMPEG;
  const local = path.join(appRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (exists(local)) return local;
  const dirs = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'ffmpeg');
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** SHA-256 of a file, read in chunks through a read-only handle. */
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Write bytes to `${file}.tmp-${pid}`, then rename over the final name. */
function writeBytesAtomic(file, bytes) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** A path as written in the cut list: relative to the app folder when inside it, else the file name. */
function shown(appRoot, file) {
  const rel = path.relative(appRoot, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.basename(file);
}

/** The last non-empty line of ffmpeg's error output. */
function lastLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * Export one take: refuse word-clipping cuts (writing nothing), render the
 * kept audio as WAV, render the kept video as MP4 when ffmpeg and a video
 * input exist, and write the cut-list JSON last. The inputs are only read.
 * @param {{ inputWav: string, inputVideo?: string, words?: import('../engine/export.js').Word[],
 *   cuts?: import('../engine/cutlist.js').Cut[], outDir?: string, name: string,
 *   env?: Record<string, string | undefined>, appRoot?: string, ffmpegPath?: string | null,
 *   captions?: { enabled: boolean, corrections?: import('../engine/caption-model.js').Correction[], tiles?: unknown[] },
 *   broll?: { file: string, windows: { cutStart: number, cutEnd: number, clipStart: number, clipEnd: number }[],
 *     asset?: { id: string, sha256: string, name: string }, start?: number, end?: number, inPoint?: number } }} options
 *   ffmpegPath: leave undefined to resolve one; null means "no ffmpeg".
 *   captions: when enabled, the cue pictures the browser drew are laid over the video (src/node/caption-export.js).
 *   Left out or disabled, the export is exactly what it was before captions existed.
 *   broll: a local clip laid over the picture in its windows (src/engine/broll-plan.js); the narration is the original's.
 *   Captions are laid over the finished picture, B-roll included.
 * @returns {{ outputs: { audio: string, video: string | null, cuts: string }, video: string, keptRanges: [number, number][],
 *   captions?: { enabled: true, burned: boolean, cueCount: number, corrected: number, note: string } }}
 */
export function exportTake({
  inputWav, inputVideo, words = [], cuts = [], outDir = 'data/exports', name,
  env = process.env, appRoot = DEFAULT_APP_ROOT, ffmpegPath, captions, broll,
}) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name.startsWith('.') || /[\\/]/.test(name)) {
    throw new ExportRefusedError(`Export refused, nothing was written: "${name}" is not a plain file name`);
  }
  const root = path.resolve(appRoot);
  const dir = resolveDataDir(root, outDir);
  const wavIn = path.resolve(inputWav);
  const videoIn = inputVideo ? path.resolve(inputVideo) : null;

  const finals = {
    audio: path.join(dir, `${name}.cut.wav`),
    video: path.join(dir, `${name}.cut.mp4`),
    cuts: path.join(dir, `${name}.cuts.json`),
  };
  const inputs = [wavIn, videoIn].filter(Boolean).map((p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  });
  for (const out of Object.values(finals)) {
    let real = out;
    try {
      real = fs.realpathSync(out);
    } catch {
      /* does not exist yet */
    }
    if (inputs.includes(out) || inputs.includes(real)) {
      throw new ExportRefusedError(`Export refused, nothing was written: ${path.basename(out)} would overwrite the original recording`);
    }
  }

  // Read the original (read-only) and plan before anything is written.
  const wavBytes = new Uint8Array(fs.readFileSync(wavIn, { flag: 'r' }));
  const sourceSha256 = crypto.createHash('sha256').update(wavBytes).digest('hex');
  const wav = parseWav(wavBytes);
  const frames = Math.floor(wav.samples.length / wav.channels);
  const duration = frames / wav.sampleRate;
  const plan = planExport({ duration, cuts, words });
  const sourceVideoSha256 = videoIn ? sha256File(videoIn) : undefined;
  if (broll) {
    if (!videoIn) throw new CaptionExportError('B-roll is set, but this take has no video to put it on. Nothing was exported.');
    if (!broll.file || !Array.isArray(broll.windows) || !broll.windows.length) throw new CaptionExportError('The B-roll has no part in what you are keeping, so nothing was exported.');
    const clip = fs.realpathSync(broll.file);
    if (inputs.includes(clip) || Object.values(finals).includes(clip)) throw new ExportRefusedError('Export refused, nothing was written: the B-roll clip cannot be the output');
  }

  // Captions are checked before anything is written: a bad or stale tile set stops the export with nothing on disk.
  let captionInfo = null;
  let cues = [];
  let tiles = null;
  if (captions && captions.enabled) {
    cues = buildCaptionCues(words, { corrections: captions.corrections, duration, ranges: plan.keptRanges });
    captionInfo = {
      enabled: /** @type {const} */ (true),
      burned: false,
      cueCount: cues.length,
      corrected: cues.filter((c) => c.corrected).length,
      note: cues.length ? '' : 'None of the timed words are in the part kept, so no captions were burned in.',
    };
    if (cues.length) {
      if (!videoIn) throw new CaptionExportError('Captions are on, but this take has no video to put them on. Nothing was exported.');
      tiles = checkCaptionTiles(cues, captions.tiles);
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  // Audio: whole frames of every channel, in plain JavaScript.
  const frameRanges = /** @type {[number, number][]} */ (plan.keptRanges.map(([s, e]) => [
    Math.round(s * wav.sampleRate) / wav.sampleRate,
    Math.round(e * wav.sampleRate) / wav.sampleRate,
  ]));
  const kept = sliceRanges(wav.samples, wav.sampleRate * wav.channels, frameRanges);
  writeBytesAtomic(finals.audio, encodeWav({ samples: kept, sampleRate: wav.sampleRate, channels: wav.channels }));

  // Video: only when a video input and an ffmpeg binary both exist.
  let video = VIDEO_NOTES.noInput;
  let videoOut = null;
  if (videoIn) {
    const ffmpeg = ffmpegPath === undefined ? resolveFfmpeg({ env, appRoot: root }) : ffmpegPath;
    if (!ffmpeg) video = VIDEO_NOTES.noFfmpeg;
    else {
      const tmp = `${finals.video}.tmp-${process.pid}`;
      let args = buildFfmpegArgs(videoIn, plan.keptRanges, tmp);
      let assetsDir = null;
      let cwd;
      let run;
      try {
        let size = null;
        let inputCount = 1;
        if (broll) {
          size = probeVideoSize(ffmpeg, videoIn);
          if (!size) throw new CaptionExportError('The video size could not be read, so B-roll could not be placed. Nothing was exported.');
          const laid = brollFfmpegArgs(args, { file: path.resolve(broll.file), windows: broll.windows, width: size.width, height: size.height });
          args = laid.args;
          inputCount = laid.inputs;
        }
        if (tiles) {
          size = size || probeVideoSize(ffmpeg, videoIn);
          if (!size) throw new CaptionExportError('The video size could not be read, so captions could not be placed. Nothing was exported.');
          // A private folder inside the export folder, removed below whatever happens.
          assetsDir = fs.mkdtempSync(path.join(dir, '.captions-'));
          const cutSeconds = plan.keptRanges.reduce((n, [s, e]) => n + (e - s), 0);
          const assets = writeCaptionAssets(assetsDir, cues, tiles, cutSeconds);
          args = captionFfmpegArgs(args, { list: assets.list, width: size.width, height: size.height, inputIndex: inputCount });
          cwd = assetsDir;
        }
        run = spawnSync(ffmpeg, args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          encoding: 'utf8',
          shell: false,
          maxBuffer: 16 * 1024 * 1024,
          timeout: tiles ? 600000 : 120000,
          ...(cwd ? { cwd } : {}),
        });
      } finally {
        if (assetsDir) fs.rmSync(assetsDir, { recursive: true, force: true });
      }
      if (!run.error && run.status === 0 && fs.existsSync(tmp)) {
        fs.renameSync(tmp, finals.video);
        video = VIDEO_NOTES.rendered;
        videoOut = path.basename(finals.video);
        if (captionInfo && tiles) captionInfo.burned = true;
      } else {
        fs.rmSync(tmp, { force: true });
        const why = run.error ? run.error.message : `exit ${run.status}${lastLine(run.stderr) ? `: ${lastLine(run.stderr)}` : ''}`;
        video = `not rendered: ffmpeg failed (${why})`;
      }
    }
  }

  // The cut list goes last, so its presence means the export finished.
  const doc = cutListDocument({
    source: shown(root, wavIn),
    sourceSha256,
    duration,
    keptRanges: plan.keptRanges,
    cuts,
    outputs: { audio: path.basename(finals.audio), video: videoOut },
    video,
    ...(videoIn ? { sourceVideo: shown(root, videoIn), sourceVideoSha256 } : {}),
  });
  if (captionInfo) Object.assign(doc, { captions: { ...captionInfo, style: 'yap-luxury-v1' } });
  if (broll && videoOut) {
    Object.assign(doc, { broll: {
      applied: true, clipSha256: broll.asset?.sha256, clipName: broll.asset?.name,
      start: broll.start, end: broll.end, inPoint: broll.inPoint, windows: broll.windows, audio: 'original recording only',
    } });
  }
  writeJsonAtomic(finals.cuts, doc);

  return {
    outputs: { audio: finals.audio, video: videoOut ? finals.video : null, cuts: finals.cuts },
    video,
    keptRanges: plan.keptRanges,
    ...(captionInfo ? { captions: captionInfo } : {}),
  };
}
