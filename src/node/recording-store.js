// The recording store: one JSON file per recording, in
// `<dataDir>/recordings/<id>.json` (DATA-01; D-71, D-72). On this machine
// only (Phase 1 D-31): nothing here opens a connection, and a recording's
// video is a file name and a size in the record, never the bytes.
//
// Threats handled here:
// - T-01.1-15: the data folder and its recordings folder are resolved through
//   Phase 1's resolveDataDir, which refuses anything outside the app folder,
//   also through a symlink.
// - T-01.1-16: each file is written through a temp file then renamed, so an
//   interrupted write never leaves half a file; a broken file throws and names
//   itself.
// - T-01.1-18: the id is the file name. It must be lower-case letters, digits
//   and hyphens, 1 to 64 characters; '../x' and 'a/b' are refused before any
//   file is touched.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecordingId, validateRecording } from '../engine/recording.js';
import { resolveDataDir, readJson, writeJsonAtomic } from './store.js';

/** @typedef {import('../engine/recording.js').Recording} Recording */

const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FOLDER = 'recordings';
const EXT = '.json';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * The recordings on disk.
 * @param {string} [dataDir] relative to the app folder, or absolute inside it; default 'data'
 * @param {{ appRoot?: string }} [options]
 * @returns {{ save(recording: Recording): Recording, load(id: string): Recording | null,
 *   list(): { id: string, title: string, status: string, createdAt: string }[] }}
 */
export function createRecordingStore(dataDir, { appRoot = DEFAULT_APP_ROOT } = {}) {
  const dir = resolveDataDir(appRoot, path.join(resolveDataDir(appRoot, dataDir), FOLDER));

  /** The file of a recording. Refuses an id that is not a plain file name before any file is touched. */
  function fileOf(id) {
    if (!isRecordingId(id)) {
      throw namedError(
        'RecordingIdError',
        `A recording id is 1 to 64 lower-case letters, digits and hyphens, starting with a letter or a digit (got ${JSON.stringify(id)})`,
      );
    }
    return path.join(dir, `${id}${EXT}`);
  }

  /** @returns {Recording | null} */
  function read(id) {
    const file = fileOf(id);
    try {
      return readJson(file, null);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw namedError('CorruptRecordingFileError', `${FOLDER}/${id}${EXT} is not valid JSON, the file may be half-written (${err.message})`);
      }
      throw err;
    }
  }

  return {
    /** Save a recording whole, replacing the one with the same id. Returns a copy of what was saved. */
    save(recording) {
      const file = fileOf(recording?.id);
      const { ok, errors } = validateRecording(recording);
      if (!ok) throw namedError('InvalidRecordingError', `Recording ${recording.id} was not saved: ${errors[0]}`);
      const saved = structuredClone(recording);
      writeJsonAtomic(file, saved);
      return structuredClone(saved);
    },

    /** The recording with this id, or null when there is none. */
    load(id) {
      return read(id);
    },

    /** Every recording's id and title, newest first. */
    list() {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch (err) {
        if (err && err.code === 'ENOENT') return [];
        throw err;
      }
      return names
        .filter((name) => name.endsWith(EXT) && isRecordingId(name.slice(0, -EXT.length)))
        .map((name) => read(name.slice(0, -EXT.length)))
        .filter((recording) => recording !== null)
        .map(({ id, title, status, createdAt }) => ({ id, title, status, createdAt }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(a.id).localeCompare(String(b.id)));
    },
  };
}
