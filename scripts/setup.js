// The one setup command (INST-01, D-28, D-29, D-30; T-01-26).
//
//   npm run setup                 install, start the server, open Chrome on it
//   npm run setup -- --no-open    the same without opening Chrome
//   npm run setup -- --no-server  install only
//   npm run setup -- --dry-run    print the steps, run nothing
//   npm run setup -- --stop       stop the server setup started
//
// It installs only inside the app folder: `npm install --no-audit --no-fund`
// runs in the app folder with npm's cache and logs pointed inside data/, and
// any inherited global npm setting switched off. It never uses a global flag,
// Python, pip or Homebrew. External programs start from argument arrays, never
// through a shell.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveDataDir } from '../src/node/store.js';
import { portFromEnv } from '../server/serve.js';

const NPM_ARGS = Object.freeze(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
const MIN_NODE_MAJOR = 18;
const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_POLL_MS = 200;

/** @param {string} parent @param {string} child */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** npm next to this Node when it is there, else whatever `npm` is on PATH. */
function defaultNpmCommand() {
  const beside = path.join(path.dirname(process.execPath), 'npm');
  return fs.existsSync(beside) ? beside : 'npm';
}

/** @param {string} command @param {string[]} args @param {{ cwd: string, env: Record<string, string | undefined> }} options */
function defaultRun(command, args, options) {
  const res = spawnSync(command, args, { cwd: options.cwd, env: options.env, stdio: 'inherit' });
  return { status: res.error ? 1 : res.status, error: res.error };
}

/**
 * Start the server detached, its output going to the log file.
 * @param {string} command @param {string[]} args
 * @param {{ cwd: string, env: Record<string, string | undefined>, logFile: string }} options
 */
function defaultSpawnServer(command, args, options) {
  const fd = fs.openSync(options.logFile, 'a');
  try {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    return { pid: child.pid };
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {string[]} args */
function defaultOpenUrl(args) {
  const res = spawnSync('open', args, { stdio: 'ignore' });
  return { status: res.error ? 1 : res.status };
}

/** @param {string} url */
async function defaultFetchHealth(url, appRoot, expectedPid) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.ok === true && data.instance === createHash('sha256').update(appRoot).digest('hex').slice(0,20) && (expectedPid === undefined || data.pid === expectedPid));
  } catch {
    return false;
  }
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The environment npm runs with: npm's cache and logs inside the app folder,
 * global installs switched off whatever the shell says.
 * @param {Record<string, string | undefined>} env
 * @param {string} dataDir
 */
function npmEnv(env, dataDir) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (/^npm_config_(global|location|prefix)$/i.test(key)) delete out[key];
  }
  out.npm_config_cache = path.join(dataDir, 'npm-cache');
  out.npm_config_logs_dir = path.join(dataDir, 'npm-logs');
  out.npm_config_global = 'false';
  out.npm_config_update_notifier = 'false';
  out.npm_config_fund = 'false';
  out.npm_config_audit = 'false';
  return out;
}

/**
 * Run setup. Every outside effect can be injected (tests pass fakes).
 *
 * @param {{
 *   appRoot?: string, argv?: string[], nodeVersion?: string, platform?: string,
 *   env?: Record<string, string | undefined>, nodePath?: string, npmCommand?: string,
 *   run?: (command: string, args: string[], options: any) => { status: number | null } | Promise<{ status: number | null }>,
 *   spawnServer?: (command: string, args: string[], options: any) => { pid: number } | Promise<{ pid: number }>,
 *   openUrl?: (args: string[]) => { status: number | null } | Promise<{ status: number | null }>,
 *   fetchHealth?: (url: string) => Promise<boolean>,
 *   kill?: (pid: number, signal: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {Promise<{ code: number, url: string, wrote: string[] }>}
 */
export async function runSetup(options = {}) {
  const appRoot = path.resolve(options.appRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const argv = options.argv || [];
  const nodeVersion = options.nodeVersion || process.version;
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const nodePath = options.nodePath || process.execPath;
  const npmCommand = options.npmCommand || defaultNpmCommand();
  const run = options.run || defaultRun;
  const spawnServer = options.spawnServer || defaultSpawnServer;
  const openUrl = options.openUrl || defaultOpenUrl;
  const fetchHealth = options.fetchHealth || defaultFetchHealth;
  const kill = options.kill || ((pid, signal) => process.kill(pid, signal));
  const sleep = options.sleep || defaultSleep;
  const log = options.log || ((line) => console.log(line));

  const flags = new Set(argv);
  const port = portFromEnv(env);
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/`;
  const healthUrl = `${base}/health`;
  /** @type {string[]} */
  const wrote = [];
  const done = (code) => ({ code, url, wrote });

  const record = (p) => {
    if (!isInside(appRoot, p)) throw new Error(`Refusing to write outside the app folder: ${p}`);
    wrote.push(p);
  };

  const major = Number(/^v?(\d+)/.exec(String(nodeVersion))?.[1]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    log(`YAP needs Node ${MIN_NODE_MAJOR} or newer (found ${nodeVersion}). Update Node, then run npm run setup again.`);
    return done(1);
  }

  const dataDir = resolveDataDir(appRoot);
  const pidFile = path.join(dataDir, 'server.pid');
  const serverInfoFile = path.join(dataDir, 'server.json');
  const logFile = path.join(dataDir, 'server.log');
  const serverScript = path.join('server', 'serve.js');

  if (flags.has('--stop')) {
    let text = '';
    try {
      text = fs.readFileSync(pidFile, 'utf8').trim();
    } catch {
      log('YAP is not running (no data/server.pid).');
      return done(0);
    }
    const pid = Number(text);
    if (Number.isInteger(pid) && pid > 0) {
      // A process number can be reused after a crash. Never signal a live
      // process until its health response identifies this folder and this PID.
      let alive = true;
      try { kill(pid, 0); }
      catch (err) {
        if (err?.code === 'ESRCH') alive = false;
        else { log(`Could not verify YAP process ${pid}: ${err?.code || 'unknown error'}. Nothing was stopped.`); return done(1); }
      }
      if (alive) {
        let savedPort = port;
        try {
          const info = JSON.parse(fs.readFileSync(serverInfoFile, 'utf8'));
          if (info.pid === pid && Number.isInteger(info.port) && info.port > 0 && info.port <= 65535) savedPort = info.port;
        } catch { /* Older receipts can still be verified on the requested port. */ }
        const verified = await fetchHealth(`http://127.0.0.1:${savedPort}/health`, appRoot, pid);
        if (!verified) {
          log(`Could not verify that process ${pid} is YAP from this folder. Nothing was stopped; the saved receipt is kept for diagnosis. If YAP is busy exporting, try again when it finishes. For an older custom-port install, use the original YAP_PORT.`);
          return done(1);
        }
        try { kill(pid, 'SIGTERM'); log(`Stopped YAP (process ${pid}).`); }
        catch (err) {
          if (err?.code !== 'ESRCH') { log(`Could not stop YAP (process ${pid}): ${err?.code || 'unknown error'}.`); return done(1); }
          log(`YAP was not running any more (process ${pid}).`);
        }
      } else log(`YAP was not running any more (process ${pid}).`);
    } else {
      log('data/server.pid did not hold a process number; removing it.');
    }
    fs.rmSync(serverInfoFile, { force: true });
    fs.rmSync(pidFile, { force: true });
    return done(0);
  }

  if (flags.has('--dry-run')) {
    log('Dry run: nothing will be installed, started or opened.');
    log(`1. Check Node is ${MIN_NODE_MAJOR} or newer (found ${nodeVersion}).`);
    log(`2. In ${appRoot}: npm ${NPM_ARGS.join(' ')} (npm cache and logs inside data/; nothing global).`);
    log(`3. Create ${dataDir} and fetch the video runtime inside node_modules using scripts/prepare-runtime.js; dependency install scripts stay off.`);
    if (!flags.has('--no-server')) {
      log(`4. If ${healthUrl} does not answer, start: node ${serverScript} (output to ${logFile}, pid in ${pidFile}).`);
    }
    if (!flags.has('--no-open')) log(`5. Open Google Chrome on ${url}.`);
    return done(0);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  record(dataDir);

  log(`Installing YAP inside ${appRoot} (npm ${NPM_ARGS.join(' ')}; nothing installed globally)...`);
  const installed = await run(npmCommand, [...NPM_ARGS], { cwd: appRoot, env: npmEnv(env, dataDir) });
  if (!installed || installed.status !== 0) {
    log(`npm install failed (exit ${installed ? installed.status : 'unknown'}). Nothing was started. See the npm output above.`);
    return done(2);
  }

  const prepared = await run(nodePath, ['scripts/prepare-runtime.js'], {cwd:appRoot, env:npmEnv(env,dataDir)});
  if (!prepared || prepared.status !== 0) { log('Local video runtime setup failed. Nothing was started; run setup again after checking the connection.'); return done(2); }

  if (flags.has('--no-server')) {
    log(`YAP is installed (only inside ${appRoot}; nothing installed globally). Start it with: npm start`);
    return done(0);
  }

  if (await fetchHealth(healthUrl, appRoot)) {
    log(`YAP is already running at ${url}; reusing it.`);
  } else {
    record(logFile);
    const child = await spawnServer(nodePath, [serverScript], { cwd: appRoot, env, logFile });
    const pid = child && Number.isInteger(child.pid) ? child.pid : null;
    if (pid === null) {
      log(`YAP's server did not start. See ${path.join('data', 'server.log')}.`);
      return done(4);
    }
    record(pidFile);
    fs.writeFileSync(pidFile, `${pid}\n`);
    record(serverInfoFile);
    fs.writeFileSync(serverInfoFile, JSON.stringify({pid, port}) + '\n');
    let up = false;
    const tries = Math.ceil(HEALTH_TIMEOUT_MS / HEALTH_POLL_MS);
    for (let i = 0; i < tries && !up; i += 1) {
      await sleep(HEALTH_POLL_MS);
      up = await fetchHealth(healthUrl, appRoot);
    }
    if (!up) {
      log(`YAP's server did not answer ${healthUrl} within ${HEALTH_TIMEOUT_MS / 1000} s. See ${path.join('data', 'server.log')} (another program may be using port ${port}; set YAP_PORT to use another).`);
      return done(4);
    }
  }

  if (!flags.has('--no-open')) {
    let opened = false;
    if (platform === 'darwin') {
      try {
        const res = await openUrl(['-a', 'Google Chrome', url]);
        opened = Boolean(res) && res.status === 0;
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      log(`Chrome was not found. Open this address in Chrome: ${url}`);
      log(`YAP is still running there. Stop it with: npm run setup -- --stop`);
      return done(3);
    }
  }

  log(`YAP is running at ${url} (installed only inside ${appRoot}; nothing installed globally)`);
  return done(0);
}

async function main() {
  const result = await runSetup({ argv: process.argv.slice(2) });
  process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`Setup failed: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
