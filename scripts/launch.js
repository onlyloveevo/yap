// The double-click launcher's brain, called by `Start YAP.command` and
// `Stop YAP.command` once they have found a Node 18+ (judge launch path).
//
//   node scripts/launch.js start            set up if needed, start, open Chrome
//   node scripts/launch.js stop             stop the server this folder started
//   node scripts/launch.js start --dry-run  say what would happen, run nothing
//   node scripts/launch.js start --force-install   reinstall even if ready
//
// It adds no install logic of its own: first run goes through scripts/setup.js
// untouched (npm ci inside this folder, local video runtime, identity-checked
// server start). It only skips that install on later clicks, when a receipt
// written after a finished install still matches this folder's lockfile,
// platform and runtime files. Stop is setup's identity-checked --stop, never a
// kill by port.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RECEIPT = 'launch-ready.json';
const FLAGS = new Set(['--dry-run', '--no-open', '--no-server', '--force-install']);

/** @param {string} appRoot */
function inputsHash(appRoot) {
  const hash = createHash('sha256');
  for (const name of ['package-lock.json', 'package.json']) hash.update(fs.readFileSync(path.join(appRoot, name)));
  return hash.digest('hex');
}

/** @param {string} dir @param {RegExp} pattern */
function hasFile(dir, pattern) {
  try { return fs.readdirSync(dir).some((n) => pattern.test(n)); } catch { return false; }
}

/** The installed pieces a finished setup leaves, checked on disk. */
function runtimeFilesPresent(appRoot, platform) {
  const nm = path.join(appRoot, 'node_modules');
  const ffmpeg = path.join(nm, 'ffmpeg-static', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(ffmpeg)
    && fs.existsSync(path.join(nm, '@huggingface', 'transformers', 'package.json'))
    && hasFile(path.join(nm, '@huggingface', 'transformers', 'dist'), /^ort-wasm/);
}

/**
 * Is this folder's local install complete and still the one the receipt names?
 * @param {{ appRoot: string, platform: string, arch: string }} o
 * @returns {{ ready: boolean, why: string }}
 */
export function installState({ appRoot, platform, arch }) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(appRoot, 'data', RECEIPT), 'utf8')); }
  catch { return { ready: false, why: 'first run here (no setup receipt)' }; }
  let now;
  try { now = inputsHash(appRoot); } catch { return { ready: false, why: 'package files missing' }; }
  if (receipt.inputs !== now) return { ready: false, why: 'package files changed since the last setup' };
  if (receipt.platform !== platform || receipt.arch !== arch) return { ready: false, why: `folder was set up on ${receipt.platform}/${receipt.arch}` };
  if (!runtimeFilesPresent(appRoot, platform)) return { ready: false, why: 'installed files are missing or incomplete' };
  return { ready: true, why: 'installed runtime matches this folder' };
}

/** Written only after setup got past its install steps. */
function writeReceipt({ appRoot, platform, arch }) {
  if (!runtimeFilesPresent(appRoot, platform)) return false;
  const file = path.join(appRoot, 'data', RECEIPT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ inputs: inputsHash(appRoot), platform, arch }) + '\n');
  return true;
}

/**
 * @param {{
 *   appRoot?: string, argv?: string[], env?: Record<string, string | undefined>,
 *   platform?: string, arch?: string, nodeVersion?: string,
 *   runSetup?: (options: any) => Promise<{ code: number, url: string }>,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {Promise<{ code: number }>}
 */
export async function runLaunch(options = {}) {
  const appRoot = path.resolve(options.appRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const argv = options.argv || [];
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const log = options.log || ((line) => console.log(line));

  const command = argv.find((a) => !a.startsWith('--')) || 'start';
  const flags = argv.filter((a) => a.startsWith('--'));
  const unknown = flags.filter((f) => !FLAGS.has(f));
  if (!['start', 'stop'].includes(command) || unknown.length) {
    log(`Unknown option: ${[command !== 'start' && command !== 'stop' ? command : '', ...unknown].filter(Boolean).join(' ')}. Use "start" or "stop".`);
    return { code: 1 };
  }
  const dry = flags.includes('--dry-run');

  if (!fs.existsSync(path.join(appRoot, 'package.json')) || !fs.existsSync(path.join(appRoot, 'server', 'serve.js'))) {
    log('This does not look like the YAP folder (package.json or server/serve.js is missing). Unzip yap.zip again and double-click Start YAP.command inside the unzipped folder.');
    return { code: 1 };
  }

  let runSetup = options.runSetup;
  if (!runSetup) {
    try { ({ runSetup } = await import('./setup.js')); }
    catch (err) {
      log(`YAP's setup script could not load (${err && err.message ? err.message : err}). The folder looks incomplete: unzip yap.zip again.`);
      return { code: 1 };
    }
  }
  const setupBase = { appRoot, env, ...(options.nodeVersion ? { nodeVersion: options.nodeVersion } : {}) };

  try {
    if (command === 'stop') {
      if (dry) { log('Dry run: would run setup --stop, which signals the server only after its health answer names this folder and its process.'); return { code: 0 }; }
      const res = await runSetup({ ...setupBase, argv: ['--stop'], log });
      if (res.code !== 0) log('YAP was not stopped. If it is still open it is safe to leave: nothing else was touched.');
      return { code: res.code };
    }

    const state = installState({ appRoot, platform, arch });
    const reuse = state.ready && !flags.includes('--force-install');
    const setupArgv = flags.filter((f) => f !== '--force-install');
    if (dry) log(`Launch check: ${reuse ? 'install would be skipped' : 'install would run'} (${flags.includes('--force-install') ? 'forced' : state.why}).`);

    // A ready folder skips the install steps by answering them "done" without
    // running anything; setup still starts or reuses the identity-checked server.
    const reuseRun = () => ({ status: 0 });
    const res = await runSetup({
      ...setupBase,
      argv: setupArgv,
      ...(reuse ? { run: reuseRun } : {}),
      log: (line) => {
        if (reuse && /^Installing YAP inside/.test(line)) log('YAP is already set up in this folder; skipping the reinstall.');
        else log(line);
      },
    });

    // Codes 0, 3 and 4 are all reached after setup's install steps finished.
    if (!reuse && !dry && [0, 3, 4].includes(res.code)) writeReceipt({ appRoot, platform, arch });

    if (res.code === 0 && !dry) log('Keep this folder: your ideas and recordings are saved in its data/ folder. Double-click "Stop YAP.command" when you are finished.');
    else if (res.code === 1) log('YAP did not start. Nothing was installed or changed. Fix the line above, then double-click Start YAP.command again.');
    else if (res.code === 2) log('YAP did not finish setting up. The first setup needs an internet connection: it downloads YAP\'s packages and video runtime into this folder only. Check the connection, then double-click Start YAP.command again; it picks up where it stopped.');
    else if (res.code === 3) log('Google Chrome could not be opened. YAP does not install it for you: get Chrome from https://www.google.com/chrome/ , then double-click Start YAP.command again (it reuses the running YAP). Or paste the address above into Chrome.');
    else if (res.code === 4) log('YAP\'s server did not come up. Another program may be using port 4317: close it, or in Terminal run  YAP_PORT=4318 "./Start YAP.command"  from this folder. Details are in data/server.log.');
    return { code: res.code };
  } catch (err) {
    log(`YAP launch failed: ${err && err.message ? err.message : String(err)}`);
    return { code: 1 };
  }
}

async function main() {
  const result = await runLaunch({ argv: process.argv.slice(2) });
  process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`YAP launch failed: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
