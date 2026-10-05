// Tests for scripts/setup.js: the one setup command (INST-01, D-28, D-29, D-30;
// T-01-26). Every outside effect is injected: no npm, no server process, no
// Chrome and no network run here. The app root is a scratch folder under .tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded dynamically so a missing module fails each named test (RED) instead
// of crashing the file at load time.
const mod = await import('../scripts/setup.js').catch(() => ({}));
const { runSetup } = mod;

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
fs.mkdirSync(path.join(repoRoot, '.tmp'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(repoRoot, '.tmp', 'setup-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const URL_DEBUG = 'http://127.0.0.1:4317/';
const FORBIDDEN_COMMANDS = ['python', 'python3', 'pip', 'pip3', 'brew'];
const GLOBAL_FLAGS = ['-g', '--global', '--location=global'];

let counter = 0;
function freshRoot() {
  counter += 1;
  const dir = path.join(scratch, `app-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * A fake world. healthy: list of answers fetchHealth gives in order (the last
 * one repeats).
 */
function fakes({ healthy = [false, true], openFails = false, runStatus = 0 } = {}) {
  const calls = { run: [], spawn: [], open: [], health: [], kill: [], order: [] };
  const lines = [];
  let h = 0;
  return {
    calls,
    lines,
    deps: {
      env: { PATH: '/usr/bin', npm_config_global: 'true' },
      platform: 'darwin',
      nodeVersion: 'v22.23.2',
      sleep: async () => {},
      run: (command, args, options) => {
        calls.run.push({ command, args, options });
        calls.order.push('run');
        return { status: runStatus };
      },
      spawnServer: (command, args, options) => {
        calls.spawn.push({ command, args, options });
        calls.order.push('spawn');
        return { pid: 43210 };
      },
      openUrl: (args) => {
        calls.open.push(args);
        calls.order.push('open');
        if (openFails) throw new Error('Unable to find application named Google Chrome');
        return { status: 0 };
      },
      fetchHealth: async (url) => {
        calls.health.push(url);
        const answer = healthy[Math.min(h, healthy.length - 1)];
        h += 1;
        calls.order.push(`health:${answer}`);
        return answer;
      },
      kill: (pid, signal) => {
        calls.kill.push({ pid, signal });
      },
      log: (line) => lines.push(String(line)),
    },
  };
}

function allCommands(calls) {
  return [
    ...calls.run.map((c) => ({ command: c.command, args: c.args })),
    ...calls.spawn.map((c) => ({ command: c.command, args: c.args })),
    ...calls.open.map((args) => ({ command: 'open', args })),
  ];
}

test('module exports runSetup', () => {
  assert.equal(typeof runSetup, 'function');
});

test('installs with npm inside the app folder only, with fixed arguments', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.run.length, 2);
  const [npm] = f.calls.run;
  assert.equal(path.basename(npm.command), 'npm');
  assert.deepEqual(npm.args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(npm.options.cwd, appRoot);
  // npm's own cache and logs stay inside the app folder, and an inherited
  // global flag is switched off.
  assert.ok(isInside(appRoot, npm.options.env.npm_config_cache), npm.options.env.npm_config_cache);
  assert.ok(isInside(appRoot, npm.options.env.npm_config_logs_dir), npm.options.env.npm_config_logs_dir);
  assert.equal(npm.options.env.npm_config_global, 'false');
});

test('never uses a global flag, Python, pip or Homebrew', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  await runSetup({ appRoot, argv: [], ...f.deps });
  for (const { command, args } of allCommands(f.calls)) {
    assert.ok(!FORBIDDEN_COMMANDS.includes(path.basename(command)), command);
    for (const flag of GLOBAL_FLAGS) assert.ok(!args.includes(flag), `${command} ${args.join(' ')}`);
  }
});

test('creates data/, starts the server from the app folder and writes data/server.pid', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.ok(fs.statSync(path.join(appRoot, 'data')).isDirectory());
  assert.equal(f.calls.spawn.length, 1);
  const [srv] = f.calls.spawn;
  assert.match(path.basename(srv.command), /^node/);
  assert.equal(srv.args.length, 1);
  assert.equal(path.resolve(appRoot, srv.args[0]), path.join(appRoot, 'server', 'serve.js'));
  assert.equal(srv.options.cwd, appRoot);
  assert.equal(srv.options.logFile, path.join(appRoot, 'data', 'server.log'));
  const pidFile = path.join(appRoot, 'data', 'server.pid');
  assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), '43210');
  assert.equal(result.url, URL_DEBUG);
});

test('opens Google Chrome on the debug page only after /health answers', async () => {
  const appRoot = freshRoot();
  const f = fakes({ healthy: [false, false, true] });
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.equal(result.code, 0);
  assert.deepEqual(f.calls.open, [['-a', 'Google Chrome', URL_DEBUG]]);
  assert.ok(f.calls.health.every((u) => u === 'http://127.0.0.1:4317/health'));
  const openAt = f.calls.order.indexOf('open');
  assert.equal(f.calls.order[openAt - 1], 'health:true');
  assert.ok(f.lines.some((l) => l.includes(`YAP is running at ${URL_DEBUG}`) && /nothing installed globally/.test(l)));
});

test('reuses a server that already answers instead of starting a second one', async () => {
  const appRoot = freshRoot();
  const f = fakes({ healthy: [true] });
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.spawn.length, 0);
  assert.ok(f.lines.some((l) => /already running/i.test(l)));
  assert.equal(f.calls.open.length, 1);
});

test('refuses Node older than 18 and runs nothing', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: [], ...f.deps, nodeVersion: 'v16.20.0' });
  assert.equal(result.code, 1);
  assert.ok(f.lines.some((l) => l.includes('YAP needs Node 18 or newer (found v16.20.0)')));
  assert.equal(f.calls.run.length + f.calls.spawn.length + f.calls.open.length + f.calls.health.length, 0);
  assert.ok(!fs.existsSync(path.join(appRoot, 'data')));
});

test('says loudly when Chrome cannot be opened, exits 3 and prints the address', async () => {
  const appRoot = freshRoot();
  const f = fakes({ openFails: true });
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.equal(result.code, 3);
  assert.ok(f.lines.some((l) => l.includes('Chrome was not found. Open this address in Chrome:')));
  assert.ok(f.lines.some((l) => l.includes(URL_DEBUG)));
  assert.equal(f.calls.kill.length, 0, 'the server keeps running');
});

test('an open command that exits non-zero counts as Chrome not found', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  f.deps.openUrl = (args) => {
    f.calls.open.push(args);
    return { status: 1 };
  };
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.equal(result.code, 3);
});

test('a failed npm install stops setup with a clear message', async () => {
  const appRoot = freshRoot();
  const f = fakes({ runStatus: 1 });
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.notEqual(result.code, 0);
  assert.equal(f.calls.spawn.length, 0);
  assert.ok(f.lines.some((l) => /npm install failed/i.test(l)));
});

test('a server that never answers is reported, not hidden', async () => {
  const appRoot = freshRoot();
  const f = fakes({ healthy: [false] });
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.notEqual(result.code, 0);
  assert.equal(f.calls.open.length, 0);
  assert.ok(f.lines.some((l) => l.includes(path.join('data', 'server.log'))));
});

test('--no-open skips Chrome', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: ['--no-open'], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.open.length, 0);
  assert.equal(f.calls.spawn.length, 1);
});

test('--no-server installs only', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: ['--no-open', '--no-server'], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.run.length, 2);
  assert.equal(f.calls.spawn.length + f.calls.open.length + f.calls.health.length, 0);
});

test('--dry-run logs the planned steps and runs nothing', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: ['--dry-run'], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.run.length + f.calls.spawn.length + f.calls.open.length + f.calls.health.length, 0);
  const text = f.lines.join('\n');
  assert.match(text, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(text, /server\/serve\.js/);
  assert.match(text, /Google Chrome/);
  assert.ok(!fs.existsSync(path.join(appRoot, 'data')));
});

test('--stop verifies the recorded server and removes its receipt', async () => {
  const appRoot = freshRoot();
  fs.mkdirSync(path.join(appRoot, 'data'));
  fs.writeFileSync(path.join(appRoot, 'data', 'server.pid'), '43210\n');
  const f = fakes({healthy:[true]});
  const result = await runSetup({ appRoot, argv: ['--stop'], ...f.deps });
  assert.equal(result.code, 0);
  assert.deepEqual(f.calls.kill, [{ pid: 43210, signal: 0 }, { pid: 43210, signal: 'SIGTERM' }]);
  assert.ok(!fs.existsSync(path.join(appRoot, 'data', 'server.pid')));
  assert.equal(f.calls.run.length + f.calls.spawn.length + f.calls.open.length, 0);
});

test('--stop with no recorded server says so and changes nothing', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: ['--stop'], ...f.deps });
  assert.equal(result.code, 0);
  assert.equal(f.calls.kill.length, 0);
  assert.ok(f.lines.some((l) => /not running/i.test(l)));
});

test('--stop with a server that already exited still clears the pid file', async () => {
  const appRoot = freshRoot();
  fs.mkdirSync(path.join(appRoot, 'data'));
  fs.writeFileSync(path.join(appRoot, 'data', 'server.pid'), '43210');
  const f = fakes();
  f.deps.kill = () => {
    const err = new Error('kill ESRCH');
    /** @type {any} */ (err).code = 'ESRCH';
    throw err;
  };
  const result = await runSetup({ appRoot, argv: ['--stop'], ...f.deps });
  assert.equal(result.code, 0);
  assert.ok(!fs.existsSync(path.join(appRoot, 'data', 'server.pid')));
});

test('every path setup writes resolves inside the app folder', async () => {
  const appRoot = freshRoot();
  const f = fakes();
  const result = await runSetup({ appRoot, argv: [], ...f.deps });
  assert.ok(Array.isArray(result.wrote) && result.wrote.length >= 2);
  for (const p of result.wrote) assert.ok(isInside(appRoot, p), p);
  for (const c of f.calls.spawn) assert.ok(isInside(appRoot, c.options.logFile));
});

// The judge guide (README.md) is checked in test/launcher.test.js.

test('setup never reuses another clone answering on the requested port',async()=>{
 const {createYapServer}=await import('../server/serve.js');
 const first=freshRoot(),second=freshRoot(),server=createYapServer({root:first,env:{}});await new Promise(r=>server.listen(0,r));
 let spawned=false;
 try{const result=await runSetup({appRoot:second,argv:['--no-open'],env:{YAP_PORT:String(server.address().port)},run:()=>({status:0}),spawnServer:()=>{spawned=true;return {};},log:()=>{}});assert.equal(spawned,true);assert.equal(result.code,4);const health=await fetch(`http://127.0.0.1:${server.address().port}/health`);assert.equal((await health.json()).ok,true);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
