// Tests for src/node/store.js: memory.json and the prediction log on disk,
// inside the app folder only (D-34; T-01-05, T-01-07).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded dynamically so a missing module fails each named test (RED) instead of
// crashing the file at load time.
const mod = await import('../src/node/store.js').catch(() => ({}));
const { resolveDataDir, readJson, writeJsonAtomic, appendJsonl, readJsonl } = mod;

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
fs.mkdirSync(path.join(appRoot, '.tmp'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(appRoot, '.tmp', 'store-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('module exports the planned API', () => {
  for (const fn of [resolveDataDir, readJson, writeJsonAtomic, appendJsonl, readJsonl]) assert.equal(typeof fn, 'function');
});

test('resolveDataDir returns the absolute path inside the app folder', () => {
  assert.equal(resolveDataDir(appRoot, '.tmp/x'), path.join(appRoot, '.tmp', 'x'));
});

test('resolveDataDir defaults to <appRoot>/data', () => {
  assert.equal(resolveDataDir(appRoot), path.join(appRoot, 'data'));
});

test('resolveDataDir throws for ../outside', () => {
  assert.throws(() => resolveDataDir(appRoot, '../outside'), { name: 'DataDirOutsideAppError' });
});

test('resolveDataDir throws for an absolute path outside the app folder', () => {
  assert.throws(() => resolveDataDir(appRoot, path.resolve(appRoot, '..', 'elsewhere')), { name: 'DataDirOutsideAppError' });
  assert.throws(() => resolveDataDir(appRoot, '/etc'), { name: 'DataDirOutsideAppError' });
});

test('resolveDataDir accepts an absolute path inside the app folder', () => {
  const inside = path.join(appRoot, '.tmp', 'abs');
  assert.equal(resolveDataDir(appRoot, inside), inside);
});

test('resolveDataDir refuses a sibling folder whose name starts like the app folder', () => {
  assert.throws(() => resolveDataDir(appRoot, `${appRoot}-evil`), { name: 'DataDirOutsideAppError' });
});

test('readJson returns the fallback when the file is absent', () => {
  assert.deepEqual(readJson(path.join(scratch, 'missing.json'), { empty: true }), { empty: true });
});

test('writeJsonAtomic writes through a temp file and leaves none behind', () => {
  const dir = path.join(scratch, 'atomic');
  const file = path.join(dir, 'memory.json');
  writeJsonAtomic(file, { version: 1, notes: [] });
  writeJsonAtomic(file, { version: 1, notes: [{ id: 'n1' }] });
  assert.deepEqual(readJson(file, null), { version: 1, notes: [{ id: 'n1' }] });
  assert.deepEqual(fs.readdirSync(dir), ['memory.json']);
});

test('readJson fails loud on a corrupt file', () => {
  const file = path.join(scratch, 'corrupt.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => readJson(file, null), SyntaxError);
});

test('appendJsonl then readJsonl returns entries in append order', () => {
  const file = path.join(scratch, 'log', 'predictions.jsonl');
  appendJsonl(file, { n: 1 });
  appendJsonl(file, { n: 2 });
  appendJsonl(file, { n: 3 });
  assert.deepEqual(readJsonl(file), [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test('readJsonl returns [] when the file is absent', () => {
  assert.deepEqual(readJsonl(path.join(scratch, 'none.jsonl')), []);
});
