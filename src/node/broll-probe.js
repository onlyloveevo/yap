// Looking at a B-roll clip with the ffmpeg the app already has. Nothing the browser says about the file (its name,
// its type, its size on screen) is believed: the container, the picture track, the picture size and the length are
// read from the bytes, and the picture track is decoded end to end.
//
// What keeps this safe:
// - ffmpeg is started with an argument array, never a shell string, and only ever reads the file.
// - What this returns, and every error it carries, is plain words and numbers: never ffmpeg's own text, never a path.
// - Each run has a deadline, so a hostile file cannot hold the server.
//
// Node built-ins only.

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { BROLL_LIMITS } from '../engine/broll-plan.js';

/** Thrown for a clip problem the person can act on; the message is shown as it is. */
export class BrollClipError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 422) {
    super(message);
    this.name = 'BrollClipError';
    this.status = status;
  }
}

const SUPPORTED = 'Use an MP4, WebM, MOV or M4V video file.';

/** Run ffmpeg without a shell and without blocking the event loop; resolves with what it wrote, never rejects. */
function run(ffmpeg, args, ms) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    let child;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout, stderr, timedOut, ...r }); } };
    const timer = setTimeout(() => { timedOut = true; child?.kill('SIGKILL'); }, ms);
    try {
      child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch {
      finish({ code: -1 });
      return;
    }
    child.stdout.on('data', (d) => { if (stdout.length < 1 << 20) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1 << 20) stderr += d; });
    child.once('error', () => finish({ code: -1 }));
    child.once('close', (code) => finish({ code }));
  });
}

/** The first bytes tell a plausible video container from anything else, before a single byte is kept. */
export function looksLikeVideo(head) {
  if (head.length >= 4 && head.subarray(0, 4).toString('hex') === '1a45dfa3') return true;
  if (head.length >= 8) {
    const tag = head.toString('latin1', 4, 8);
    return ['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(tag);
  }
  return false;
}

/** PNG or JPEG, by its first bytes. A picture becomes a short clip before it is kept (server/broll-api.js). */
export function looksLikeImage(head) {
  if (head.length < 4) return false;
  const hex = head.subarray(0, 4).toString('hex');
  return hex === '89504e47' || hex.startsWith('ffd8ff');
}

/** Run ffmpeg to the end with a deadline; true when it exited cleanly. Never throws. */
export async function runClipTool(ffmpeg, args, ms = 120000) {
  const result = await run(ffmpeg, args, ms);
  return !result.timedOut && result.code === 0;
}

/**
 * @param {string} ffmpeg
 * @param {string} file
 * @param {{ probeMs?: number }} [options]
 * @returns {Promise<{ duration: number, width: number, height: number, container: 'mp4' | 'webm', hasAudio: boolean }>}
 * @throws {BrollClipError}
 */
export async function probeClip(ffmpeg, file, { probeMs = 120000 } = {}) {
  let size;
  try { size = fs.statSync(file).size; } catch { throw new BrollClipError('The clip could not be read.'); }
  if (!size) throw new BrollClipError('The clip is empty.');
  const info = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], 30000);
  const text = info.stderr || '';
  const format = /Input #0, ([^,\n]+(?:,[^,\n ]+)*), from/.exec(text);
  const names = format ? format[1].split(',') : [];
  const container = names.includes('webm') || names.includes('matroska') ? 'webm' : names.includes('mp4') || names.includes('mov') ? 'mp4' : null;
  if (!container) throw new BrollClipError(`This is not a video YAP can read. ${SUPPORTED}`, 415);
  const videoLines = text.split('\n').filter((l) => /Stream #0:\d+[^\n]*: Video:/.test(l) && !/attached pic/.test(l));
  if (!videoLines.length) throw new BrollClipError('This file has no picture, only sound or a still image. B-roll needs a video with a picture track.');
  const dims = /Video:[^\n]*?[,\s](\d{2,5})x(\d{2,5})[,\s\[]/.exec(videoLines[0]);
  const width = dims ? Number(dims[1]) : 0;
  const height = dims ? Number(dims[2]) : 0;
  if (!(width >= 16 && height >= 16 && width <= BROLL_LIMITS.maxSide && height <= BROLL_LIMITS.maxSide)) throw new BrollClipError('The clip picture size could not be read or is outside what YAP can use.');
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : NaN;
  if (!(duration >= BROLL_LIMITS.minSeconds)) throw new BrollClipError(dur ? `The clip is only ${duration.toFixed(1)} s long. B-roll needs at least ${BROLL_LIMITS.minSeconds} s.` : 'The clip has no readable length. It may be cut short or damaged.');
  // Decode the picture track end to end: damage or a cut-short file fails here, before anything is saved.
  const decode = await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-an', '-nostats', '-progress', 'pipe:1', '-f', 'null', '-'], probeMs);
  if (decode.timedOut) throw new BrollClipError('Checking the clip took too long, so it was not used.');
  if (decode.code !== 0) throw new BrollClipError('The clip could not be decoded. It may be damaged or cut short.');
  const times = [...decode.stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]) / 1e6);
  const decoded = times.length ? times[times.length - 1] : 0;
  if (!(decoded >= duration - 0.5)) throw new BrollClipError(`The clip says it is ${duration.toFixed(1)} s but only ${decoded.toFixed(1)} s of picture could be decoded. It looks cut short.`);
  return { duration: Math.round(duration * 1000) / 1000, width, height, container, hasAudio: videoLines.length > 0 && /Stream #0:\d+[^\n]*: Audio:/.test(text) };
}
