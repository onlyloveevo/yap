// Loads labelled sample takes and their brief from disk (Node only): the
// bundled sample in sample/ by default, or a named sample folder inside the
// app folder. The engine itself never reads files; the replay command and the
// tests come through here. Read-only: nothing is ever written.
//
// Threat handled here: a sample folder name cannot point outside the app
// folder, also through `..` or a symlink (T-01.1-27), and a take name stays a
// plain name.

import fs from 'node:fs';
import path from 'node:path';
import { parseWav, toMonoFloat } from '../engine/wav.js';
import { parseBrief } from '../engine/brief.js';
import { resolveDataDir } from './store.js';

const TAKE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${file} (${(err && err.code) || err})`);
  }
}

/**
 * Resolve a sample folder relative to the app folder and refuse anything that
 * lands outside it, including through a symlink. Runs before any file of the
 * folder is read.
 * @param {string} appRoot the app folder
 * @param {string} [dir] relative to appRoot, or absolute; default 'sample'
 * @returns {string} absolute path of an existing folder inside appRoot
 */
export function resolveSampleDir(appRoot, dir = 'sample') {
  if (typeof dir !== 'string' || dir === '') throw new Error(`"${dir}" is not a sample folder name`);
  let target;
  try {
    // The same checks as the data folder: resolve, take the real path, refuse anything outside.
    target = resolveDataDir(appRoot, dir);
  } catch (err) {
    if (err && err.name === 'DataDirOutsideAppError') {
      throw namedError('SampleDirOutsideAppError', `The sample folder must be inside the app folder; "${dir}" resolves outside it`);
    }
    throw err;
  }
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch (err) {
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err;
  }
  if (!stat) throw namedError('SampleDirNotFoundError', `The sample folder "${dir}" does not exist`);
  if (!stat.isDirectory()) throw namedError('SampleDirNotFoundError', `The sample folder "${dir}" is not a folder`);
  return target;
}

/**
 * One sample take: its word-timed transcript and its audio as mono floats.
 * @param {string} appRoot the app folder
 * @param {string} take    'take1' or 'take2' (a plain name, no path)
 * @param {string} [dir]   the sample folder, inside the app folder; default 'sample'
 * @returns {{ takeId: string, label: string | null, source: string | null,
 *   words: import('../engine/replay.js').Word[], pcm: { samples: Float32Array, sampleRate: number }, duration: number }}
 */
export function loadTake(appRoot, take, dir = 'sample') {
  if (typeof take !== 'string' || !TAKE_NAME.test(take)) throw new Error(`"${take}" is not a sample take name`);
  const folder = resolveSampleDir(appRoot, dir);
  const wordsFile = path.join(folder, `${take}.words.json`);
  let transcript;
  try {
    transcript = JSON.parse(readText(wordsFile));
  } catch (err) {
    throw new Error(err instanceof SyntaxError ? `${wordsFile} is not valid JSON (${err.message})` : err.message);
  }
  if (!transcript || !Array.isArray(transcript.words)) throw new Error(`${wordsFile} has no words array`);
  transcript.words.forEach((w, i) => {
    if (!w || typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      throw new Error(`${wordsFile}: word ${i} needs text, start and end`);
    }
  });
  const wavFile = path.join(folder, `${take}.wav`);
  let bytes;
  try {
    bytes = fs.readFileSync(wavFile);
  } catch (err) {
    throw new Error(`cannot read ${wavFile} (${(err && err.code) || err})`);
  }
  const wav = parseWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const samples = toMonoFloat(wav);
  return {
    takeId: take,
    label: typeof transcript.label === 'string' ? transcript.label : null,
    source: typeof transcript.source === 'string' ? transcript.source : null,
    words: transcript.words.map((w) => ({ ...w })),
    pcm: { samples, sampleRate: wav.sampleRate },
    duration: samples.length / wav.sampleRate,
  };
}

/**
 * The folder's optional setup.json, parsed; null when the folder has none.
 * What the setup may hold is checked by its reader, not here.
 * @param {string} folder absolute sample folder
 * @returns {Record<string, any> | null}
 */
function loadSetup(folder) {
  const file = path.join(folder, 'setup.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`cannot read ${file} (${(err && err.code) || err})`);
  }
  let setup;
  try {
    setup = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message})`);
  }
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) throw new Error(`${file} must hold a JSON object`);
  return setup;
}

/**
 * A sample: the brief, both takes and the folder's setup when it has one.
 * @param {string} appRoot
 * @param {string} [dir] the sample folder, inside the app folder; default 'sample' (the bundled sample)
 */
export function loadSample(appRoot, dir = 'sample') {
  const folder = resolveSampleDir(appRoot, dir);
  const briefFile = path.join(folder, 'brief.json');
  return {
    brief: parseBrief(readText(briefFile), briefFile),
    take1: loadTake(appRoot, 'take1', dir),
    take2: loadTake(appRoot, 'take2', dir),
    setup: loadSetup(folder),
  };
}
