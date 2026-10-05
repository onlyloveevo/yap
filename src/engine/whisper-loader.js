// The wiring from YAP's speech package to the transcriber (INST-02; D-67, D-68, D-69).
//
// A real take gets its word timings from Whisper running in the browser. This module loads the speech
// package from the app's own folder, through the localhost server's vendor route (server/serve.js),
// points the package's runtime files at the same route, asks for the speech pipeline, and wraps it
// with createWhisperTranscriber (islands.js). The result goes to realTakeWords (real-take.js).
//
// What leaves this machine (Phase 1 D-31, threat T-01.1-24):
// - The take's sound never does. Transcription runs in the browser, and the sound is given to nothing
//   but the pipeline loaded here.
// - The package and its runtime files come from the app's own server, never from another site.
// - The one outside fetch is the package's own: the speech model's files, once, from the model hub.
//   The browser keeps them afterwards. Phase 1's D-31 allows exactly that.
//
// This module names no package in an import of its own. The caller passes in the function that imports
// a module by address, so a plain `node --test` needs no package. The install is Plan 01.1-15, after a
// person's check (QUESTIONS.md Q43).
//
// Browser-safe: no `node:` imports. It makes no network request itself.

import { createWhisperTranscriber } from './islands.js';

/**
 * The settings of the speech wiring, one field each. Pass `settings` to loadWhisper to override any.
 *
 * Fields marked [ASSUMED] are facts about the package taken as given while it is not installed.
 * Plan 01.1-15 confirms each one against the package on disk.
 */
export const WHISPER_SETTINGS = Object.freeze({
  /** The server route the package is loaded from. It must be a path on YAP's own server. */
  vendorPath: '/vendor/transformers/',
  /**
   * [ASSUMED] The package's browser build: this file in its `dist` folder. Plan 01.1-15 confirms it.
   * The package's own manifest names it as its build for a plain script address (read 3 Oct 2026).
   */
  entry: 'transformers.min.js',
  /**
   * [ASSUMED] The speech model: small, English, with word times. Plan 01.1-15 confirms it loads
   * (asked in .planning/QUESTIONS.md Q54).
   */
  model: 'onnx-community/whisper-tiny.en_timestamped',
  /** The pipeline to ask the package for. */
  task: 'automatic-speech-recognition',
  /**
   * The model reads 30 s of sound at a time. A longer stretch of speech is read in pieces this long,
   * each overlapping the next by `strideSeconds`, so no word after the first 30 s is lost.
   * [ASSUMED] The package takes these as `chunk_length_s` and `stride_length_s`, as its own source
   * says (read 3 Oct 2026). Plan 01.1-15 confirms word times still come back with them set.
   */
  chunkSeconds: 30,
  strideSeconds: 5,
});

/** Every word the person can be shown by this module. */
export const COPY = Object.freeze({
  notInstalled: 'Real-take cuts need YAP\'s speech package. Run npm run setup, then reload.',
  modelFailed: 'YAP could not load its speech model. Check the internet once, then reload.',
});

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {(samples: Float32Array, opts: { sampleRate: number }) => Promise<Word[]>} Transcriber
 * @typedef {{ vendorPath?: string, entry?: string, model?: string, task?: string, chunkSeconds?: number, strideSeconds?: number }} WhisperSettings
 * @typedef {{ ok: true, transcriber: Transcriber }
 *   | { ok: false, reason: 'not-installed' | 'model-failed', line: string, detail: string }} LoadResult
 *   line: the one plain line for the person. detail: why, for the debug page; never shown as a line.
 */

/** One file name: letters, digits, dot, hyphen and underscore, not starting with a dot. */
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
/** A path on this server: one folder name or more, each of the same letters, between slashes. */
const OWN_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)+$/;
const MAX_DETAIL = 200;

/** @param {unknown} err */
function detailOf(err) {
  let text = 'unknown error';
  try {
    if (err instanceof Error) text = err.message;
    else if (err !== undefined && err !== null) text = String(err);
  } catch {
    text = 'unknown error';
  }
  return text.slice(0, MAX_DETAIL);
}

/** @param {unknown} why @returns {LoadResult} */
function notInstalled(why) {
  return { ok: false, reason: 'not-installed', line: COPY.notInstalled, detail: detailOf(why) };
}

/** @param {unknown} why @returns {LoadResult} */
function modelFailed(why) {
  return { ok: false, reason: 'model-failed', line: COPY.modelFailed, detail: detailOf(why) };
}

/** @param {unknown} x */
function isObject(x) {
  return Boolean(x) && typeof x === 'object';
}

/**
 * The settings in force, or null when they would load code from anywhere but this server.
 * @param {unknown} given
 */
function settingsOf(given) {
  const s = { ...WHISPER_SETTINGS, ...(isObject(given) && !Array.isArray(given) ? given : {}) };
  if (typeof s.vendorPath !== 'string' || typeof s.entry !== 'string') return null;
  const vendorPath = s.vendorPath.endsWith('/') ? s.vendorPath : `${s.vendorPath}/`;
  if (!OWN_PATH.test(vendorPath) || !FILE_NAME.test(s.entry)) return null;
  return { ...s, vendorPath };
}

/** The last part of an address: its file name. @param {string} address */
function fileNameOf(address) {
  return address.split(/[?#]/)[0].split('/').pop() || '';
}

/**
 * Point the package's runtime files at the app's own server, and stop it looking for models on the
 * local disk. When the package loads it sets its runtime file addresses to another site; they are
 * replaced here, before the pipeline is asked for, keeping the package's own file names.
 * @param {any} env the package's settings object
 * @param {string} vendorPath
 * @returns {boolean} false when the runtime settings are not there to be set
 */
function pointAtOwnServer(env, vendorPath) {
  if (!isObject(env) || !isObject(env.backends) || !isObject(env.backends.onnx)) return false;
  env.allowLocalModels = false;
  const onnx = env.backends.onnx;
  if (!isObject(onnx.wasm)) onnx.wasm = {};
  onnx.wasm.numThreads = 1;
  const current = onnx.wasm.wasmPaths;
  /** @type {string | Record<string, string>} */
  let next = vendorPath;
  if (isObject(current)) {
    const entries = Object.entries(current);
    const names = entries.map(([, address]) => (typeof address === 'string' ? fileNameOf(address) : ''));
    if (entries.length > 0 && names.every((name) => FILE_NAME.test(name))) {
      next = Object.fromEntries(entries.map(([key], k) => [key, `${vendorPath}${names[k]}`]));
    }
  }
  onnx.wasm.wasmPaths = next;
  return true;
}

/**
 * Load YAP's speech package and give back a transcriber for realTakeWords.
 *
 * It never rejects and never throws. When the package is not installed the person gets one plain line
 * and nothing breaks; the same when the speech model cannot be loaded.
 *
 * In the page, the importer is the browser's own dynamic import of the address it is given.
 *
 * @param {{ importer: (url: string) => Promise<any>, settings?: WhisperSettings, onProgress?: (progress: any) => void }} input
 *   importer: the caller's function that imports a module by address.
 *   onProgress: called by the package while the model's files load.
 * @returns {Promise<LoadResult>}
 */
export async function loadWhisper(input) {
  try {
    const { importer, settings, onProgress } = isObject(input) ? /** @type {any} */ (input) : {};
    if (typeof importer !== 'function') return notInstalled('no importer function was given to loadWhisper');
    const s = settingsOf(settings);
    if (!s) return notInstalled('the speech package is loaded from YAP\'s own server only: check vendorPath and entry');

    let lib;
    try {
      lib = await importer(`${s.vendorPath}${s.entry}`);
    } catch (err) {
      return notInstalled(err);
    }
    if (!isObject(lib) || typeof lib.pipeline !== 'function') {
      return notInstalled('the file loaded is not the speech package: it has no pipeline function');
    }
    if (!pointAtOwnServer(lib.env, s.vendorPath)) {
      // Without these settings the runtime would fetch its own files from another site.
      return notInstalled('the speech package\'s runtime settings were not found, so it was not used');
    }

    let pipe;
    try {
      pipe = await lib.pipeline(s.task, s.model, typeof onProgress === 'function' ? { progress_callback: onProgress } : {});
    } catch (err) {
      return modelFailed(err);
    }
    if (typeof pipe !== 'function') return modelFailed('the speech model did not load as a pipeline');

    const options = { chunk_length_s: s.chunkSeconds, stride_length_s: s.strideSeconds };
    return { ok: true, transcriber: createWhisperTranscriber({ pipeline: pipe, options }) };
  } catch (err) {
    return notInstalled(err);
  }
}
