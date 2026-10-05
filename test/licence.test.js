// Licence check (D-32, under the stricter CLAUDE.md rule: reuse only from the
// open-source map, MIT or Apache-2.0, notices kept).
//
// Every file whose header says "Ported from" must be named in NOTICE, and its
// header line must carry the licence and the copyright line. NOTICE must hold
// the full MIT text with both copyright holders. No GPL or AGPL text may sit in
// the app's code folders, and any future npm dependency must be named in NOTICE.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CODE_FOLDERS = ['src', 'scripts', 'server', 'tools', 'debug'];
const TEXT_FOLDERS = [...CODE_FOLDERS, 'prompts'];
const CODE_EXT = new Set(['.js', '.cjs', '.mjs']);
const TEXT_EXT = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.json', '.md', '.txt']);

/**
 * All files under the given app folders whose extension is in exts. Folders
 * that do not exist yet (debug/ before plan 01-07) are skipped.
 * @param {string[]} folders @param {Set<string>} exts
 */
function filesUnder(folders, exts) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  for (const folder of folders) {
    const dir = path.join(appRoot, folder);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

const rel = (file) => path.relative(appRoot, file).split(path.sep).join('/');
const noticePath = path.join(appRoot, 'NOTICE');
const notice = fs.existsSync(noticePath) ? fs.readFileSync(noticePath, 'utf8') : '';

const ported = filesUnder(CODE_FOLDERS, CODE_EXT)
  .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
  .filter(({ text }) => text.includes('Ported from'));

test('NOTICE exists', () => {
  assert.ok(fs.existsSync(noticePath), 'NOTICE file at the app root');
});

test('the ported files are found by their header', () => {
  // The five known ports must be found; more may be added later.
  const names = ported.map(({ file }) => rel(file));
  for (const known of ['src/engine/text.js', 'src/engine/levenshtein.js', 'src/engine/follow.js', 'src/engine/webspeech.js', 'src/engine/retake-text.js']) {
    assert.ok(names.includes(known), known);
  }
});

test('every ported file is named in NOTICE', () => {
  const missing = ported.map(({ file }) => rel(file)).filter((name) => !notice.includes(name));
  assert.deepEqual(missing, [], `ported files missing from NOTICE: ${missing.join(', ')}`);
});

test('every ported file header names its licence, copyright and source repo, and the repo is in NOTICE', () => {
  for (const { file, text } of ported) {
    const header = text.split('\n').find((line) => line.includes('Ported from')) || '';
    assert.match(header, /\bMIT\b|Apache-2\.0/, `${rel(file)} header names its licence`);
    assert.match(header, /Copyright \(c\)/, `${rel(file)} header keeps the copyright line`);
    const repo = /Ported from\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(header);
    assert.ok(repo, `${rel(file)} header names owner/repo`);
    assert.ok(notice.includes(repo[1]), `${repo[1]} is in NOTICE`);
  }
});

test('NOTICE carries the full MIT text and both copyright holders', () => {
  assert.match(notice, /Permission is hereby granted, free of charge/);
  assert.match(notice, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
  assert.match(notice, /Copyright \(c\) 2024 - Present, Julien Lecomte - All Rights Reserved/);
  assert.match(notice, /Copyright \(c\) 2026 Vincent Ventalon/);
  assert.ok(notice.includes('Julien Lecomte'));
  assert.ok(notice.includes('Vincent Ventalon'));
});

test('no GPL or AGPL text sits in the app code folders', () => {
  const hits = filesUnder(TEXT_FOLDERS, TEXT_EXT)
    .filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /GNU General Public License|GNU Affero|GNU Lesser General Public License/i.test(text);
    })
    .map(rel);
  assert.deepEqual(hits, []);
});

test('every npm dependency is named in NOTICE with its licence', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
  for (const name of Object.keys(deps)) {
    const line = notice.split('\n').find((l) => l.includes(name)) || '';
    assert.ok(line, `${name} is named in NOTICE`);
    assert.match(line, /MIT|Apache-2\.0|BSD|ISC|LGPL|GPL/, `${name} line in NOTICE names its licence`);
  }
});
