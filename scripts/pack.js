// Build dist/yap.zip, the package Jack's team receives (D-28, Q9).
//
//   npm run pack     (or: node scripts/pack.js)
//
// The zip is made by `git archive` from the last commit, so it holds exactly
// what is committed: the app's files under a yap/ folder. The internal .claude
// and .planning folders and the internal docs stay out. Uncommitted changes in
// the packed paths are NOT in the zip; the script says so loudly.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Runnable release only. Development tests/tools stay in the isolated source tree.
 * Legacy test audio is retained for reproducible regression, never redistributed. */
export const PACK_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'INSTALL.md',
  'START-HERE.md',
  'Start YAP.command',
  'Stop YAP.command',
  'NOTICE',
  'LICENSE',
  'src',
  'scripts',
  'server',
  'sample',
  'debug',
  'ui',
  'prompts',
  'tools/browser.js',
  'test/shells',
]);

/**
 * The git archive arguments for the given paths (argument array, no shell).
 * @param {string} outFile path relative to the app root
 * @param {string[]} paths
 */
export function archiveArgs(outFile, paths) {
  return ['archive', '--format=zip', '--prefix=yap/', '-o', outFile, 'HEAD', '--', ...paths];
}

/** @param {string} appRoot @param {string[]} args */
function git(appRoot, args) {
  return spawnSync('git', args, { cwd: appRoot, encoding: 'utf8' });
}

/**
 * @param {{ appRoot?: string, log?: (line: string) => void }} [options]
 * @returns {{ code: number, zip: string | null }}
 */
export function pack(options = {}) {
  const appRoot = path.resolve(options.appRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const log = options.log || ((line) => console.log(line));

  const present = PACK_PATHS.filter((p) => git(appRoot, ['cat-file', '-e', `HEAD:${p}`]).status === 0);
  const absent = PACK_PATHS.filter((p) => !present.includes(p));
  if (!present.includes('package.json')) {
    log('Cannot pack: package.json is not committed (is this the YAP app folder with at least one commit?).');
    return { code: 1, zip: null };
  }
  if (absent.length) log(`Not in the last commit, so not packed: ${absent.join(', ')}`);

  const dirty = git(appRoot, ['status', '--porcelain', '--', ...PACK_PATHS]);
  if (dirty.status === 0 && dirty.stdout.trim() !== '') {
    log('Cannot pack: commit these changes first so the zip contains the tested build:');
    for (const line of dirty.stdout.trim().split('\n')) log(`  ${line}`);
    return { code: 1, zip: null };
  }

  fs.mkdirSync(path.join(appRoot, 'dist'), { recursive: true });
  const outRel = path.join('dist', 'yap.zip');
  const res = git(appRoot, archiveArgs(outRel, present));
  if (res.status !== 0) {
    log(`git archive failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
    return { code: 1, zip: null };
  }
  const zip = path.join(appRoot, outRel);
  const size = fs.statSync(zip).size;
  log(`Packed ${zip} (${(size / (1024 * 1024)).toFixed(2)} MB, ${size} bytes)`);
  return { code: 0, zip };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = pack().code;
}
