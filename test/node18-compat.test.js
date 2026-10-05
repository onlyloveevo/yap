// Node 18 check (D-29, Q12): YAP runs on a fresh Mac with Claude Code, so Node
// 18 or newer. This test fails if code or tests use an API added after Node 18
// from a fixed list. Comments are stripped before scanning so a comment that
// names an API does not count; this file is excluded because it holds the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const thisFile = fileURLToPath(import.meta.url);
const FOLDERS = ['src', 'scripts', 'server', 'tools', 'debug', 'test'];
const EXT = new Set(['.js', '.cjs', '.mjs']);

/** APIs added after Node 18, each with the Node version that added it. */
const NEWER_APIS = [
  { name: 'Array.prototype.toSorted (Node 20)', re: /\.toSorted\s*\(/ },
  { name: 'Array.prototype.toReversed (Node 20)', re: /\.toReversed\s*\(/ },
  { name: 'Array.prototype.toSpliced (Node 20)', re: /\.toSpliced\s*\(/ },
  { name: 'Object.groupBy (Node 21)', re: /\bObject\s*\.\s*groupBy\b/ },
  { name: 'Map.groupBy (Node 21)', re: /\bMap\s*\.\s*groupBy\b/ },
  { name: 'import.meta.dirname (Node 20.11)', re: /\bimport\s*\.\s*meta\s*\.\s*dirname\b/ },
  { name: 'import.meta.filename (Node 20.11)', re: /\bimport\s*\.\s*meta\s*\.\s*filename\b/ },
  { name: 'Promise.withResolvers (Node 22)', re: /\bPromise\s*\.\s*withResolvers\b/ },
  { name: 'Array.fromAsync (Node 22)', re: /\bArray\s*\.\s*fromAsync\b/ },
  { name: 'node:test mock timers (Node 20.4)', re: /\bmock\s*\.\s*timers\b/ },
  { name: 'String.prototype.isWellFormed (Node 20)', re: /\.isWellFormed\s*\(/ },
  { name: 'String.prototype.toWellFormed (Node 20)', re: /\.toWellFormed\s*\(/ },
  { name: 'fs glob (Node 22)', re: /\b(?:fs|fsp|fsPromises|promises)\s*\.\s*glob(?:Sync)?\b/ },
  { name: 'fs glob import (Node 22)', re: /\bimport\s*\{[^}]*\bglob(?:Sync)?\b[^}]*\}\s*from\s*['"](?:node:)?fs(?:\/promises)?['"]/ },
];

/**
 * Remove // and block comments, keeping string and template literal text.
 * Regex literals are not parsed; that can only hide code, never invent it.
 * @param {string} src
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** @param {string} src @returns {string[]} names of newer APIs found */
export function findNewerApis(src) {
  const code = stripComments(src);
  return NEWER_APIS.filter(({ re }) => re.test(code)).map(({ name }) => name);
}

function files() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && EXT.has(path.extname(entry.name))) out.push(full);
    }
  };
  for (const folder of FOLDERS) {
    const dir = path.join(appRoot, folder);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out.filter((f) => path.resolve(f) !== path.resolve(thisFile));
}

test('the scanner catches a newer API in code and ignores one in a comment', () => {
  assert.deepEqual(findNewerApis('const b = a.toSorted();'), ['Array.prototype.toSorted (Node 20)']);
  assert.deepEqual(findNewerApis('const d = import.meta.dirname;'), ['import.meta.dirname (Node 20.11)']);
  assert.deepEqual(findNewerApis("import { glob } from 'node:fs';"), ['fs glob import (Node 22)']);
  assert.deepEqual(findNewerApis('t.mock.timers.enable();'), ['node:test mock timers (Node 20.4)']);
  assert.deepEqual(findNewerApis('// a.toSorted() is Node 20\nconst x = 1;'), []);
  assert.deepEqual(findNewerApis('/* Promise.withResolvers() */ const y = 2;'), []);
  assert.deepEqual(findNewerApis("const url = 'http://x'; const z = Object.groupBy(a, f);"), ['Object.groupBy (Node 21)']);
});

test('no code or test uses an API added after Node 18', () => {
  const hits = [];
  for (const file of files()) {
    for (const name of findNewerApis(fs.readFileSync(file, 'utf8'))) {
      hits.push(`${path.relative(appRoot, file)}: ${name}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('package.json promises Node 18 or newer', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.engines && pkg.engines.node, '>=18');
});
