// Build the zip Jack's team receives (D-28, Q9).
//
//   node scripts/pack.js --out <file.zip>    write the zip there
//   npm run pack                             write dist/yap.zip
//
// The zip is made by `git archive` from the last commit, so it holds exactly
// what is committed: the app's files under a YAP/ folder, each with the mode
// it was committed with. The two launchers must be committed executable, or a
// double-click cannot run them; the script refuses to pack when they are not.
// The internal .claude and .planning folders and the internal docs stay out.
// Uncommitted changes in the packed paths stop the pack; the script lists them.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Runnable release only. Development tests/tools stay in the isolated source tree.
 * Legacy test audio is retained for reproducible regression, never redistributed. */
export const PACK_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'Start YAP.command',
  'Stop YAP.command',
  'README.md',
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

/** The files a judge double-clicks. The zip must carry them as executable. */
const LAUNCHERS = Object.freeze(['Start YAP.command', 'Stop YAP.command']);

/**
 * The git archive arguments for the given paths (argument array, no shell).
 * @param {string} outFile absolute, or relative to the app root
 * @param {string[]} paths
 */
export function archiveArgs(outFile, paths) {
  return ['archive', '--format=zip', '--prefix=YAP/', '-o', outFile, 'HEAD', '--', ...paths];
}

/** @param {string} appRoot @param {string[]} args */
function git(appRoot, args) {
  return spawnSync('git', args, { cwd: appRoot, encoding: 'utf8' });
}

/**
 * @param {{ appRoot?: string, out?: string, log?: (line: string) => void }} [options]
 *   out: where to write the zip (default dist/yap.zip in the app folder)
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

  // git archive copies each file's committed mode into the zip.
  const plain = LAUNCHERS.filter((p) => present.includes(p) && !git(appRoot, ['ls-tree', 'HEAD', '--', p]).stdout.startsWith('100755'));
  if (plain.length) {
    log(`Cannot pack: not executable in the last commit, so a double-click could not run it: ${plain.join(', ')}. Run chmod +x on it and commit.`);
    return { code: 1, zip: null };
  }

  const zip = path.resolve(options.out || path.join(appRoot, 'dist', 'yap.zip'));
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  const res = git(appRoot, archiveArgs(zip, present));
  if (res.status !== 0) {
    log(`git archive failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
    return { code: 1, zip: null };
  }
  const size = fs.statSync(zip).size;
  log(`Packed ${zip} (${(size / (1024 * 1024)).toFixed(2)} MB, ${size} bytes)`);
  return { code: 0, zip };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const at = process.argv.indexOf('--out');
  if (at !== -1 && !process.argv[at + 1]) {
    console.log('Cannot pack: --out needs a file path, for example --out /tmp/YAP.zip');
    process.exitCode = 1;
  } else {
    process.exitCode = pack({ out: at === -1 ? undefined : process.argv[at + 1] }).code;
  }
}
