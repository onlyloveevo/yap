// Burning captions into an exported MP4 with the ffmpeg that ships with the app.
//
// The bundled ffmpeg has no font to rely on, so the words are never given to an
// ffmpeg filter. The browser draws each cue as a transparent PNG tile (the same
// drawing the preview shows) and the server lays those tiles over the bottom of
// the video with ffmpeg's `overlay` filter, fed by one image sequence listing
// each tile and how long it stays up.
//
// What keeps this safe:
// - Caption text is never in an ffmpeg argument, filter or list file. Only
//   file names the server made (`t000001.png`), numbers it computed and sizes
//   it probed are.
// - Each tile is checked (caption-png.js) before it is written, and each is
//   matched to a cue the server built from the saved words, by id and by text.
// - Tiles are written into a fresh private folder inside the export folder and
//   removed afterwards. Nothing outside it is read or written.
//
// Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CAPTION_TILE } from '../engine/caption-model.js';
import { checkTilePng, blankTilePng, CaptionTileError } from './caption-png.js';

/** Thrown for a caption problem the person can act on; the message is shown as it is. */
export class CaptionExportError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'CaptionExportError';
  }
}

/** The picture size of a video, read from what ffmpeg says about it; null when it cannot be read. */
export function probeVideoSize(ffmpeg, file) {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], { encoding: 'utf8', shell: false, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const text = `${run.stderr || ''}`;
  const m = /Stream #\d+:\d+[^\n]*Video:[^\n]*?[,\s](\d{2,5})x(\d{2,5})[,\s\[]/.exec(text);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Check the tiles the browser sent against the cues the server built. Every cue
 * needs exactly one tile with the same text, no tile may be left over, and each
 * must be a good PNG of the tile size. Returns id -> bytes.
 * @param {{ id: string, text: string }[]} cues
 * @param {{ id: unknown, text: unknown, png: unknown }[]} tiles png is base64
 * @returns {Map<string, Buffer>}
 */
export function checkCaptionTiles(cues, tiles) {
  if (!Array.isArray(tiles)) throw new CaptionExportError('The captions were not drawn, so the export was stopped. Reload the editor and export again.');
  const want = new Map(cues.map((c) => [c.id, c.text]));
  const got = new Map();
  for (const t of tiles) {
    if (!t || typeof t.id !== 'string' || typeof t.text !== 'string' || typeof t.png !== 'string') throw new CaptionExportError('A caption picture was malformed, so the export was stopped.');
    if (!want.has(t.id) || got.has(t.id)) throw new CaptionExportError('The captions changed since they were drawn. Reload the editor and export again.');
    if (want.get(t.id) !== t.text) throw new CaptionExportError('The caption text changed since it was drawn. Reload the editor and export again.');
    if (t.png.length > Math.ceil(CAPTION_TILE.maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t.png)) throw new CaptionExportError('A caption picture was not valid, so the export was stopped.');
    const bytes = Buffer.from(t.png, 'base64');
    try {
      checkTilePng(bytes, CAPTION_TILE);
    } catch (error) {
      if (error instanceof CaptionTileError) throw new CaptionExportError(`The captions could not be used: ${error.message}. Nothing was exported.`);
      throw error;
    }
    got.set(t.id, bytes);
  }
  for (const id of want.keys()) if (!got.has(id)) throw new CaptionExportError('A caption picture is missing, so the export was stopped. Reload the editor and export again.');
  return got;
}

const fixed = (x) => (Math.round(x * 1000) / 1000).toFixed(3);

/**
 * Write the tiles and the image-sequence list into `dir` (a private folder).
 * Each cue's tile is shown from its `shownFrom` to its `shownTo`, a blank tile
 * between. Identical pictures are written once.
 * @param {string} dir
 * @param {{ id: string, shownFrom: number, shownTo: number }[]} cues in time order
 * @param {Map<string, Buffer>} tiles
 * @param {number} cutSeconds the length of the exported cut
 * @returns {{ list: string, tileFiles: number, shown: number }}
 */
export function writeCaptionAssets(dir, cues, tiles, cutSeconds) {
  fs.writeFileSync(path.join(dir, 'blank.png'), blankTilePng(CAPTION_TILE.width, CAPTION_TILE.height), { flag: 'wx' });
  const names = new Map();
  const nameOf = (bytes) => {
    const key = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!names.has(key)) {
      const name = `t${String(names.size + 1).padStart(6, '0')}.png`;
      fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
      names.set(key, name);
    }
    return names.get(key);
  };
  const lines = ['ffconcat version 1.0'];
  let cursor = 0;
  let shown = 0;
  for (const cue of cues) {
    const from = Math.max(cue.shownFrom, cursor);
    const to = Math.min(cue.shownTo, cutSeconds);
    if (!(to - from > 0.001)) continue;
    if (from - cursor > 0.001) lines.push("file 'blank.png'", `duration ${fixed(from - cursor)}`);
    lines.push(`file '${nameOf(tiles.get(cue.id))}'`, `duration ${fixed(to - from)}`);
    cursor = to;
    shown += 1;
  }
  if (cutSeconds - cursor > 0.001) lines.push("file 'blank.png'", `duration ${fixed(cutSeconds - cursor)}`);
  // The concat reader gives the last picture no length of its own, so it is named once more.
  lines.push("file 'blank.png'");
  fs.writeFileSync(path.join(dir, 'captions.ffconcat'), `${lines.join('\n')}\n`, { flag: 'wx' });
  return { list: path.join(dir, 'captions.ffconcat'), tileFiles: names.size, shown };
}

/**
 * The ffmpeg arguments for the cut with the caption image sequence laid over its
 * bottom: the arguments `buildFfmpegArgs` made (and, with B-roll, `brollFfmpegArgs`), with the sequence added as the
 * last input and one overlay stage after the picture is complete.
 * @param {string[]} base what buildFfmpegArgs returned
 * @param {{ list: string, width: number, height: number }} captions
 */
export function captionFfmpegArgs(base, { list, width, height, inputIndex }) {
  const args = [...base];
  const graphAt = args.indexOf('-filter_complex');
  const mapAt = args.indexOf('-map');
  // The graph ends `[v][a]` for a plain cut, or `[v]` when B-roll was laid over the picture first (the audio label came earlier).
  if (graphAt < 0 || mapAt < 0 || args[mapAt + 1] !== '[v]' || !/\[v\](\[a\])?$/.test(args[graphAt + 1])) {
    throw new CaptionExportError('The export plan could not take captions, so nothing was exported.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 16384 || height > 16384) {
    throw new CaptionExportError('The video size could not be read, so captions could not be placed. Nothing was exported.');
  }
  const tileHeight = Math.max(2, Math.round((width * CAPTION_TILE.height) / CAPTION_TILE.width / 2) * 2);
  // The caption sequence is the last input. Its index is the count of inputs already there: 1 for a plain cut, 2 with B-roll.
  const index = inputIndex === undefined ? args.reduce((n, a) => n + (a === '-i' ? 1 : 0), 0) : inputIndex;
  if (!Number.isInteger(index) || index < 1 || index > 8) throw new CaptionExportError('The export plan could not take captions, so nothing was exported.');
  args.splice(graphAt, 0, '-f', 'concat', '-safe', '1', '-i', list);
  const at = args.indexOf('-filter_complex');
  args[at + 1] = `${args[at + 1]};[${index}:v]format=rgba,scale=${width}:${tileHeight}:flags=bicubic,setpts=PTS-STARTPTS[cap];[v][cap]overlay=x=0:y=main_h-overlay_h:format=auto:eof_action=pass[vc]`;
  const map = args.indexOf('-map');
  args[map + 1] = '[vc]';
  return args;
}
