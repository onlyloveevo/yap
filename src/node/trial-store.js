// The trial store: experiments.json in the data folder (EXP-01; D-60, D-66).
// A trial is saved only once the person has accepted it: `save` refuses a
// proposal and a kept-old answer, so nothing reaches the disk before
// acceptance. On this machine only (Phase 1 D-31).
//
// Threats handled here: the data folder is resolved through Phase 1's
// resolveDataDir and cannot lie outside the app folder, also through a symlink
// (T-01.1-15); the file is written through a temp file then renamed, and a
// broken file throws and names itself (T-01.1-16).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENT_STATUSES } from '../engine/experiments.js';
import { resolveDataDir, readJson, writeJsonAtomic } from './store.js';

/** @typedef {import('../engine/experiments.js').Experiment} Experiment */

const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE_NAME = 'experiments.json';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

const isText = (v) => typeof v === 'string' && v.length > 0;

/** Whether a value is a trial the person accepted, whole. */
function isExperiment(value) {
  return value !== null
    && typeof value === 'object'
    && isText(value.id)
    && EXPERIMENT_STATUSES.includes(value.status)
    && value.change !== null
    && typeof value.change === 'object'
    && isText(value.change.from)
    && isText(value.change.to)
    && Number.isInteger(value.trialLength)
    && Array.isArray(value.recordings);
}

/**
 * The trials on disk, in `<dataDir>/experiments.json`. Nothing is written
 * until the first accepted trial is saved.
 * @param {string} [dataDir] relative to the app folder, or absolute inside it; default 'data'
 * @param {{ appRoot?: string }} [options]
 * @returns {{ list(): Experiment[], save(experiment: Experiment): Experiment, remove(id: string): boolean }}
 */
export function createTrialStore(dataDir, { appRoot = DEFAULT_APP_ROOT } = {}) {
  const file = path.join(resolveDataDir(appRoot, dataDir), FILE_NAME);

  /** @returns {Experiment[]} */
  function read() {
    let data;
    try {
      data = readJson(file, null);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw namedError('CorruptTrialFileError', `${FILE_NAME} is not valid JSON, the file may be half-written (${err.message})`);
      }
      throw err;
    }
    if (data === null) return [];
    if (typeof data !== 'object' || !Array.isArray(data.experiments)) {
      throw namedError('CorruptTrialFileError', `${FILE_NAME} must hold an "experiments" list`);
    }
    return data.experiments;
  }

  const write = (experiments) => writeJsonAtomic(file, { version: 1, experiments });

  return {
    /** Every saved trial, oldest first, as copies. */
    list() {
      return structuredClone(read());
    },

    /**
     * Save an accepted trial, replacing the one with the same id. Anything
     * that is not an accepted trial throws NotAcceptedError and writes nothing.
     */
    save(experiment) {
      if (!isExperiment(experiment)) {
        throw namedError('NotAcceptedError', `Only a trial the person accepted is saved (status ${JSON.stringify(experiment?.status)})`);
      }
      const saved = structuredClone(experiment);
      const experiments = read();
      const index = experiments.findIndex((e) => e.id === saved.id);
      if (index === -1) experiments.push(saved);
      else experiments[index] = saved;
      write(experiments);
      return structuredClone(saved);
    },

    /** Take a trial off the disk. False, with nothing written, when it is not there. */
    remove(id) {
      const experiments = read();
      const rest = experiments.filter((e) => e.id !== id);
      if (rest.length === experiments.length) return false;
      write(rest);
      return true;
    },
  };
}
