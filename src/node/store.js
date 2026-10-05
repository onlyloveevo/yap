// The data store: memory.json and the prediction log on disk, inside the app
// folder only (D-34). The only module in this plan that touches the disk;
// Node built-ins only. Default data location is <appRoot>/data/ (gitignored).
//
// Threats handled here: a --data-dir argument cannot point outside the app
// folder (T-01-05), and JSON is written through a temp file then renamed so an
// interrupted write never leaves a half-written memory.json (T-01-07).

import fs from 'node:fs';
import path from 'node:path';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** The real path of the nearest part of `target` that exists (resolves symlinks). */
function realNearest(target) {
  let probe = target;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(probe), ...rest.reverse());
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
      const parent = path.dirname(probe);
      if (parent === probe) return target;
      rest.push(path.basename(probe));
      probe = parent;
    }
  }
}

/**
 * Resolve the data directory relative to the app folder and refuse anything
 * that lands outside it, including through a symlink.
 * @param {string} appRoot the app folder
 * @param {string} [dir] relative to appRoot, or absolute; default 'data'
 * @returns {string} absolute path inside appRoot
 */
export function resolveDataDir(appRoot, dir = 'data') {
  const root = path.resolve(appRoot);
  const target = path.resolve(root, dir);
  const outside = () =>
    namedError('DataDirOutsideAppError', `The data folder must be inside the app folder; "${dir}" resolves outside it`);
  if (!isInside(root, target)) throw outside();
  if (!isInside(realNearest(root), realNearest(target))) throw outside();
  return target;
}

/**
 * Read a JSON file, or return the fallback when it does not exist. A file
 * that exists but is not valid JSON throws (fail loud).
 * @param {string} file
 * @param {any} fallback
 */
export function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * Write JSON through `${file}.tmp-${pid}` then rename over the target.
 * @param {string} file
 * @param {any} data
 */
export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Append one entry as a JSON line.
 * @param {string} file
 * @param {any} entry
 */
export function appendJsonl(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/**
 * Read every JSON line in append order; [] when the file does not exist. A
 * line that is not valid JSON throws with its line number (fail loud).
 * @param {string} file
 * @returns {any[]}
 */
export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw namedError('CorruptLogLineError', `${path.basename(file)} line ${i + 1} is not valid JSON`);
    }
  });
  return out;
}
