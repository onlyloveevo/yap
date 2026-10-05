// Tests for server/model.js and its route in server/serve.js: the localhost
// endpoint that asks the tester's own Claude Code (`claude -p`, no shell), else
// OpenAI with the tester's own key, else nobody (SETUP-01; D-39, D-43;
// T-01.1-05 to T-01.1-10).
//
// Nothing here starts the real `claude` program, touches the network or reads a
// real key: spawn and fetch are fakes handed in, and the only key is the
// sentinel below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const SENTINEL = ['sk-test', 'SENTINEL', '0002'].join('-');
const URL_EXPECTED = 'https://api.openai.com/v1/responses';
const startedAt = Date.now();

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const thisFile = fileURLToPath(import.meta.url);

// Everything written to stdout or stderr while this file runs is recorded (and
// still passed on). The last test checks none of it carries the key.
const written = [];
const restoreWrites = [];
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write;
  stream.write = function recordingWrite(chunk, ...rest) {
    try {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    } catch {
      // a chunk that cannot be read as text cannot carry the key as text
    }
    return original.call(stream, chunk, ...rest);
  };
  restoreWrites.push(() => { stream.write = original; });
}

// Loaded dynamically so a missing module fails each named test (RED) instead of
// crashing the file at load time.
const mod = await import('../server/model.js').catch(() => ({}));
const { MODEL_SETTINGS, claudeCodeAdapter, openAiAdapter, handleModel } = mod;
const serve = await import('../server/serve.js').catch(() => ({}));
const { createYapServer } = serve;

const BEATS_JSON = JSON.stringify([
  { label: 'The stall', points: ['Three drafts, none filmed'] },
  { label: 'What changed', points: ['Ten minute timer'] },
  { label: 'Your turn', points: [] },
]);
const IDEA = 'Why I keep putting off filming; $(touch pwned) `id` && rm -rf ~ | "quoted" \'single\'';

function beatsInstruction() {
  return fs.readFileSync(path.join(appRoot, 'prompts', 'write-beats.md'), 'utf8').trim();
}

// --- A stand-in for the `claude` program -------------------------------------------

function endChild(child, code, signal = null) {
  if (child.done) return;
  child.done = true;
  child.stdout.once('end', () => child.emit('close', code, signal));
  child.stdout.end();
}

/** The child prints `text` and exits with `code`. */
function prints(text, code = 0) {
  return (child) => {
    child.stdout.write(text);
    endChild(child, code);
  };
}

/**
 * A fake child_process.spawn. It records each call, collects what is written to
 * the child's standard input, and runs `atStdinEnd` once standard input is
 * closed (so a child whose input is never closed never answers).
 */
function fakeSpawn({ atSpawn, atStdinEnd } = {}) {
  const calls = [];
  const impl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = null;
    const call = { command, args, options, child, stdin: '', stdinEnded: false, kills: [] };
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => { call.stdin += chunk; });
    child.stdin.on('end', () => {
      call.stdinEnded = true;
      if (atStdinEnd) atStdinEnd(child, call);
    });
    child.kill = (signal) => {
      call.kills.push(signal || 'SIGTERM');
      endChild(child, null, signal || 'SIGTERM');
      return true;
    };
    calls.push(call);
    if (atSpawn) atSpawn(child, call);
    return child;
  };
  impl.calls = calls;
  return impl;
}

// --- A stand-in for fetch ------------------------------------------------------------

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(url, init);
    return reply;
  };
  impl.calls = calls;
  return impl;
}

function responsesReply(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      id: 'resp_1',
      status: 'completed',
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [] },
        { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
      ],
    }),
  };
}

// --- The server ------------------------------------------------------------------------

const servers = [];

/** Start a server whose spawn and fetch are always fakes. */
async function start({ env = {}, fetchImpl = fakeFetch(responsesReply(BEATS_JSON)), spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) }) } = {}) {
  const server = createYapServer({ root: appRoot, env, fetchImpl, spawnImpl });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  servers.push(server);
  return { server, port: server.address().port, fetchImpl, spawnImpl };
}

function request(port, { method = 'GET', path: urlPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers, setHost: !('Host' in headers) },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function own(port) {
  return { Origin: `http://127.0.0.1:${port}`, Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' };
}

function post(port, data, headers = own(port)) {
  return request(port, { method: 'POST', path: '/api/model', headers, body: typeof data === 'string' ? data : JSON.stringify(data) });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, what) {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test.after(async () => {
  for (const s of servers) await new Promise((r) => s.close(() => r()));
  for (const restore of restoreWrites) restore();
});

// --- Settings (D-39) ---------------------------------------------------------------------

test('MODEL_SETTINGS holds each seat default once, frozen', () => {
  assert.deepEqual({ ...MODEL_SETTINGS }, {
    claudeTimeoutMs: 20000,
    claudeModel: 'sonnet',
    claudeEffort: 'low',
    claudeMaxTurns: 1,
    openAiTimeoutMs: 20000,
    maxOutputChars: 20000,
    maxBodyBytes: 16384,
    openAiUrl: URL_EXPECTED,
    openAiModel: 'gpt-6-luna',
  });
  assert.ok(Object.isFrozen(MODEL_SETTINGS));
  assert.equal(typeof handleModel, 'function');
});

// --- The Claude Code adapter (T-01.1-05, T-01.1-08) -------------------------------------

test('claudeCodeAdapter starts `claude -p` with an argument array, no shell, and the text on standard input', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) });
  const ask = claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: { PATH: '/usr/bin' } });
  const answer = await ask({ task: 'beats', text: IDEA });
  assert.equal(answer, BEATS_JSON);

  assert.equal(spawnImpl.calls.length, 1);
  const { command, args, options, stdin, stdinEnded } = spawnImpl.calls[0];
  assert.equal(command, 'claude');
  assert.ok(Array.isArray(args), 'the arguments are an array');
  assert.deepEqual(args, [
    '-p', beatsInstruction(),
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format', 'text',
    '--model', 'sonnet',
    '--effort', 'low',
    '--max-turns', '1',
  ]);
  assert.equal(options.shell, false, 'spawn options have shell: false');
  assert.equal(stdin, IDEA, 'the text is written to standard input as it is');
  assert.equal(stdinEnded, true, 'standard input is closed');
  for (const arg of args) {
    assert.equal(arg.includes(IDEA), false, 'the text is in no argument');
    assert.equal(arg.includes('putting off filming'), false, 'no part of the text is in an argument');
  }
  assert.equal(command.includes('putting off'), false);
});

test('the child gets no OPENAI_API_KEY, even when the server has one', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) });
  const env = { PATH: '/usr/bin', HOME: '/Users/tester', OPENAI_API_KEY: SENTINEL, openai_api_key: SENTINEL, COPY_OF_KEY: `x${SENTINEL}y` };
  const before = JSON.stringify(env);
  await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env })({ task: 'beats', text: 'an idea' });
  const childEnv = spawnImpl.calls[0].options.env;
  assert.equal(typeof childEnv, 'object');
  assert.equal('OPENAI_API_KEY' in childEnv, false, 'the child environment has no OPENAI_API_KEY');
  assert.equal(JSON.stringify(childEnv).includes(SENTINEL), false, 'no variable carries the key under another name');
  assert.equal(childEnv.PATH, '/usr/bin');
  assert.equal(childEnv.HOME, '/Users/tester');
  assert.equal(JSON.stringify(env), before, 'the server environment is not changed');
});

test('with no env given the child environment is the process environment without the key', async () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SENTINEL;
  try {
    const spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) });
    await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000 })({ task: 'beats', text: 'an idea' });
    const childEnv = spawnImpl.calls[0].options.env;
    assert.equal('OPENAI_API_KEY' in childEnv, false);
    assert.equal(JSON.stringify(childEnv).includes(SENTINEL), false);
    assert.equal(childEnv.PATH, process.env.PATH);
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

test('a key pasted into the text never reaches the child', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) });
  const ask = claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: { OPENAI_API_KEY: SENTINEL } });
  await ask({ task: 'beats', text: `my idea, and by accident ${SENTINEL} too` });
  const call = spawnImpl.calls[0];
  assert.equal(call.stdin.includes(SENTINEL), false);
  assert.match(call.stdin, /my idea, and by accident .* too/);
  assert.equal(JSON.stringify(call.args).includes(SENTINEL), false);
});

test('a child that exits with code 1 is not available', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints('Not logged in. Please run /login', 1) });
  assert.equal(await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);
});

test('a `claude` that is not installed is not available', async () => {
  const notFound = fakeSpawn({
    atSpawn: (child) => setImmediate(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))),
  });
  assert.equal(await claudeCodeAdapter({ spawnImpl: notFound, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);

  const throws = () => { throw new Error('spawn failed at once'); };
  assert.equal(await claudeCodeAdapter({ spawnImpl: throws, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);
});

test('a child that does not exit within the time limit is killed', async () => {
  const spawnImpl = fakeSpawn({});
  const began = Date.now();
  const answer = await claudeCodeAdapter({ spawnImpl, timeoutMs: 40, env: {} })({ task: 'beats', text: 'an idea' });
  assert.equal(answer, null);
  assert.ok(Date.now() - began < 1500, 'the adapter gave up at its time limit');
  assert.equal(spawnImpl.calls[0].kills.length, 1, 'the child is killed');
});

test('the Sonnet, low-effort, one-turn flags go with every task, and a claude that refuses them is not available', async () => {
  for (const task of ['beats', 'experiment']) {
    const spawnImpl = fakeSpawn({ atStdinEnd: prints('{}') });
    assert.equal(await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task, text: 'an idea' }), '{}');
    const { args, options } = spawnImpl.calls[0];
    const after = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(after('--model'), MODEL_SETTINGS.claudeModel);
    assert.equal(after('--effort'), MODEL_SETTINGS.claudeEffort);
    assert.equal(after('--max-turns'), '1');
    assert.equal(args.includes('--bare'), false, 'user hooks stay on');
    assert.equal(options.shell, false);
  }
  // an older claude that does not know a flag, or a model it cannot reach, exits 1: the chain falls back to none
  const refuses = fakeSpawn({ atStdinEnd: (child, call) => endChild(child, call.args.includes('--model') ? 1 : 0) });
  assert.equal(await claudeCodeAdapter({ spawnImpl: refuses, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);
});

test('output beyond 20,000 characters is cut off and the child is killed', async () => {
  const spawnImpl = fakeSpawn({
    atStdinEnd: (child) => {
      child.stdout.write('a'.repeat(12000));
      child.stdout.write('b'.repeat(12000));
      child.stdout.write('c'.repeat(12000));
    },
  });
  const answer = await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' });
  assert.equal(typeof answer, 'string');
  assert.equal(answer.length, 20000);
  assert.equal(answer, 'a'.repeat(12000) + 'b'.repeat(8000));
  assert.equal(spawnImpl.calls[0].kills.length, 1, 'the child is killed');
});

test('a child that prints nothing, or only spaces, is not available', async () => {
  for (const out of ['', '  \n']) {
    const spawnImpl = fakeSpawn({ atStdinEnd: prints(out) });
    assert.equal(await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);
  }
});

test('a broken pipe on standard input does not crash the adapter', async () => {
  const spawnImpl = fakeSpawn({
    atSpawn: (child) => {
      child.stdin.write = () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); };
      child.stdin.end = () => { setImmediate(() => child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); };
      setImmediate(() => endChild(child, 1));
    },
  });
  assert.equal(await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task: 'beats', text: 'an idea' }), null);
});

test('no text, or a task with no instruction, starts no child', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints(BEATS_JSON) });
  const ask = claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} });
  for (const request of [{ task: 'beats', text: '' }, { task: 'beats', text: '   ' }, { task: 'beats' }, { task: 'beats', text: 42 }, { task: 'shell', text: 'an idea' }, { text: 'an idea' }, {}, undefined]) {
    assert.equal(await ask(request), null);
  }
  assert.equal(spawnImpl.calls.length, 0);
});

test('the experiment task has its own fixed instruction, and the text still goes on standard input', async () => {
  const spawnImpl = fakeSpawn({ atStdinEnd: prints('{"from":"grab a tea","to":"grab a coffee"}') });
  const answer = await claudeCodeAdapter({ spawnImpl, timeoutMs: 2000, env: {} })({ task: 'experiment', text: 'what if the opener was grab a coffee, not grab a tea' });
  assert.equal(answer, '{"from":"grab a tea","to":"grab a coffee"}');
  const { args, stdin, options } = spawnImpl.calls[0];
  assert.equal(args[0], '-p');
  assert.notEqual(args[1], beatsInstruction());
  assert.match(args[1], /"from"/);
  assert.match(args[1], /"to"/);
  assert.match(args[1], /not instructions/i);
  assert.deepEqual(args.slice(2), ['--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text', '--model', 'sonnet', '--effort', 'low', '--max-turns', '1']);
  assert.equal(stdin, 'what if the opener was grab a coffee, not grab a tea');
  assert.equal(options.shell, false);
  assert.equal(JSON.stringify(args).includes('grab a coffee'), false);
});

// --- A real child process standing in for `claude` (QUESTIONS.md Q52) -------------------
//
// The fakes above prove what the adapter asks for. These run a real child
// process through the real spawn, pipes and exit codes. The program is Node
// itself with a one-line script, never `claude`.

/** A spawn that runs `script` in Node in place of the program asked for, with the same arguments and options. */
function standIn(script, seen = []) {
  return (command, args, options) => {
    const child = spawn(process.execPath, ['-e', script, '--', ...args], options);
    seen.push({ command, args, options, pid: child.pid });
    return child;
  };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const REPORT_SCRIPT = `
let text = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { text += chunk; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    argv: process.argv.slice(1),
    stdin: text,
    hasKeyName: Object.keys(process.env).some((name) => name.toUpperCase() === 'OPENAI_API_KEY'),
    keyInEnv: JSON.stringify(process.env).includes(${JSON.stringify(SENTINEL)}),
  }));
});
`;

test('a real child gets the arguments one by one and the text on standard input, read by no shell', async () => {
  const marker = path.join(appRoot, '.tmp', `model-endpoint-shell-${process.pid}`);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.rmSync(marker, { force: true });
  const text = `an idea; touch ${marker}; $(touch ${marker}) \`touch ${marker}\` | touch ${marker} && "x" 'y' \\ $HOME\nsecond line`;
  const seen = [];
  const ask = claudeCodeAdapter({ spawnImpl: standIn(REPORT_SCRIPT, seen), timeoutMs: 10000, env: { PATH: process.env.PATH, OPENAI_API_KEY: SENTINEL } });
  const answer = await ask({ task: 'beats', text });
  const report = JSON.parse(answer);
  assert.equal(report.stdin, text, 'the text arrives on standard input exactly as written');
  assert.deepEqual(report.argv, ['-p', beatsInstruction(), '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text', '--model', 'sonnet', '--effort', 'low', '--max-turns', '1']);
  assert.equal(report.hasKeyName, false, 'the child has no OPENAI_API_KEY');
  assert.equal(report.keyInEnv, false);
  assert.equal(seen[0].command, 'claude');
  assert.equal(seen[0].options.shell, false);
  assert.equal(fs.existsSync(marker), false, 'nothing in the text was run as a command');
});

test('a real child that exits with an error, or a program that is not there, is not available', async () => {
  const failing = claudeCodeAdapter({ spawnImpl: standIn('process.stdout.write("half an answer"); process.exitCode = 3;'), timeoutMs: 10000, env: {} });
  assert.equal(await failing({ task: 'beats', text: 'an idea' }), null);

  const missing = (command, args, options) => spawn(path.join(appRoot, '.tmp', 'no-such-program-for-yap-tests'), args, options);
  assert.equal(await claudeCodeAdapter({ spawnImpl: missing, timeoutMs: 10000, env: {} })({ task: 'beats', text: 'an idea' }), null);
});

test('a real child that outstays the time limit is killed', async () => {
  const seen = [];
  const ask = claudeCodeAdapter({ spawnImpl: standIn('setInterval(() => {}, 1000);', seen), timeoutMs: 300, env: {} });
  assert.equal(await ask({ task: 'beats', text: 'an idea' }), null);
  await waitFor(() => !isRunning(seen[0].pid), 'the child to be gone');
});

test('a real child that floods its output is cut off at 20,000 characters and killed', async () => {
  const seen = [];
  const flood = 'const chunk = "x".repeat(1000); setInterval(() => { process.stdout.write(chunk); }, 1);';
  const answer = await claudeCodeAdapter({ spawnImpl: standIn(flood, seen), timeoutMs: 10000, env: {} })({ task: 'beats', text: 'an idea' });
  assert.equal(answer, 'x'.repeat(20000));
  await waitFor(() => !isRunning(seen[0].pid), 'the child to be gone');
});

// --- The OpenAI adapter (T-01.1-06, T-01.1-10) -------------------------------------------

test('openAiAdapter with no key resolves to null and never calls fetch', async () => {
  for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: '   ' }, { OPENAI_API_KEY: 42 }, null]) {
    const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
    assert.equal(await openAiAdapter({ env, fetchImpl })({ task: 'beats', text: 'an idea' }), null);
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('an explicit env is used as given: a key in the process environment is not read', async () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SENTINEL;
  try {
    const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
    assert.equal(await openAiAdapter({ env: {}, fetchImpl })({ task: 'beats', text: 'an idea' }), null);
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

test('with the key, openAiAdapter posts once to the fixed address with the key only in the Authorization header', async () => {
  const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
  const answer = await openAiAdapter({ env: { OPENAI_API_KEY: `  ${SENTINEL}\n` }, fetchImpl })({ task: 'beats', text: IDEA });
  assert.equal(answer, BEATS_JSON);
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, URL_EXPECTED);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${SENTINEL}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  for (const [name, value] of Object.entries(init.headers)) {
    if (name !== 'Authorization') assert.equal(String(value).includes(SENTINEL), false, `header ${name}`);
  }
  assert.equal(init.body.includes(SENTINEL), false, 'the key is not in the body');
  assert.equal(url.includes(SENTINEL), false);

  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store']);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.instructions, beatsInstruction());
  assert.equal(body.input, IDEA);
  assert.equal(body.store, false, 'the service is asked not to keep the response');
  assert.equal('tools' in body, false);
  assert.equal('stream' in body, false);
});

test('the address cannot be moved by the environment', async () => {
  const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
  await openAiAdapter({
    env: {
      OPENAI_API_KEY: SENTINEL,
      OPENAI_BASE_URL: 'https://evil.example/v1',
      OPENAI_API_BASE: 'https://evil.example',
      OPENAI_RESPONSES_URL: 'https://evil.example/steal',
    },
    fetchImpl,
  })({ task: 'beats', text: 'an idea' });
  assert.equal(fetchImpl.calls[0].url, URL_EXPECTED);
});

test('a key pasted into the text is not sent in the body', async () => {
  const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
  await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl })({ task: 'beats', text: `my idea ${SENTINEL}` });
  assert.equal(fetchImpl.calls[0].init.body.includes(SENTINEL), false);
});

test('a reply that is not 200, or a fetch that throws, resolves to null and says nothing about the key', async () => {
  const cases = [
    responsesReply(`Incorrect API key provided: ${SENTINEL}`, 401),
    responsesReply('rate limited', 429),
    responsesReply('server error', 500),
    new Error(`connect ECONNREFUSED while sending Bearer ${SENTINEL}`),
    () => { throw new TypeError(`Invalid header value: Bearer ${SENTINEL}`); },
    null,
    undefined,
  ];
  for (const reply of cases) {
    const fetchImpl = fakeFetch(reply);
    let answer;
    await assert.doesNotReject(async () => {
      answer = await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl })({ task: 'beats', text: 'an idea' });
    });
    assert.equal(answer, null);
  }
});

test('a reply it cannot read is not available', async () => {
  const shapes = [
    {},
    { output: 'text' },
    { output: [] },
    { output: [{ type: 'message', content: [] }] },
    { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 42 }] }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: '   ' }] }] },
    { output_text: BEATS_JSON },
    null,
    'text',
  ];
  for (const shape of shapes) {
    const fetchImpl = fakeFetch({ ok: true, status: 200, json: async () => shape });
    assert.equal(await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl })({ task: 'beats', text: 'an idea' }), null, JSON.stringify(shape));
  }
  const notJson = fakeFetch({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
  assert.equal(await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl: notJson })({ task: 'beats', text: 'an idea' }), null);
});

test('the reply text is read from every output_text item, in order', async () => {
  const fetchImpl = fakeFetch({
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: '[{"label":"One",' }, { type: 'output_text', text: '"points":[]}]' }] },
      ],
    }),
  });
  assert.equal(await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl })({ task: 'beats', text: 'an idea' }), '[{"label":"One","points":[]}]');
});

test('a reply that echoes the key back is refused, and a long reply is cut to 20,000 characters', async () => {
  const echo = fakeFetch(responsesReply(`here is your key ${SENTINEL}`));
  assert.equal(await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl: echo })({ task: 'beats', text: 'an idea' }), null);

  const long = fakeFetch(responsesReply('z'.repeat(30000)));
  const answer = await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl: long })({ task: 'beats', text: 'an idea' });
  assert.equal(answer.length, 20000);
});

test('a fetch that never answers is given up on at the time limit', async () => {
  let signal;
  const fetchImpl = (url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  };
  const began = Date.now();
  const answer = await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl, timeoutMs: 40 })({ task: 'beats', text: 'an idea' });
  assert.equal(answer, null);
  assert.ok(Date.now() - began < 1500);
  assert.equal(signal.aborted, true, 'the request is aborted');
});

test('no fetch, no text or a task with no instruction: null, and nothing is sent', async () => {
  assert.equal(await openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl: null })({ task: 'beats', text: 'an idea' }), null);
  const fetchImpl = fakeFetch(responsesReply(BEATS_JSON));
  const ask = openAiAdapter({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  for (const request of [{ task: 'beats', text: '' }, { task: 'beats', text: '  ' }, { task: 'beats' }, { task: 'shell', text: 'an idea' }, {}, undefined]) {
    assert.equal(await ask(request), null);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

// --- POST /api/model (T-01.1-07, T-01.1-09) ------------------------------------------------

test('POST /api/model from the own page answers 200 with the source and the text', async () => {
  const { port, spawnImpl, fetchImpl } = await start({ env: { OPENAI_API_KEY: SENTINEL } });
  const res = await post(port, { task: 'beats', text: IDEA });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { source: 'claude-code', text: BEATS_JSON });
  assert.equal(spawnImpl.calls.length, 1);
  assert.equal(spawnImpl.calls[0].stdin, IDEA);
  assert.equal(spawnImpl.calls[0].options.shell, false);
  assert.equal(JSON.stringify(spawnImpl.calls[0].options.env).includes(SENTINEL), false);
  assert.equal(fetchImpl.calls.length, 0, 'OpenAI is not asked when Claude Code answers');
  assert.equal(res.body.includes(SENTINEL), false);
  assert.equal(JSON.stringify(res.headers).includes(SENTINEL), false);
});

test('localhost as Origin and Host is this server too', async () => {
  const { port } = await start();
  const res = await post(port, { task: 'beats', text: 'an idea' }, { Origin: `http://localhost:${port}`, Host: `localhost:${port}` });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).source, 'claude-code');
});

test('when Claude Code is not available, OpenAI answers with the tester\'s own key, and the key is in no response', async () => {
  const { port, fetchImpl } = await start({
    env: { OPENAI_API_KEY: SENTINEL },
    spawnImpl: fakeSpawn({ atStdinEnd: prints('Not logged in', 1) }),
  });
  const res = await post(port, { task: 'beats', text: 'an idea' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { source: 'openai', text: BEATS_JSON });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, URL_EXPECTED);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, `Bearer ${SENTINEL}`);
  assert.equal(res.body.includes(SENTINEL), false, 'the key is in no response body');
  assert.equal(JSON.stringify(res.headers).includes(SENTINEL), false);
});

test('with neither Claude Code nor a key the answer is source none, and OpenAI is never called', async () => {
  const { port, fetchImpl } = await start({ env: {}, spawnImpl: fakeSpawn({ atStdinEnd: prints('', 1) }) });
  const res = await post(port, { task: 'beats', text: 'an idea' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { source: 'none', text: null });
  assert.equal(fetchImpl.calls.length, 0);
});

test('an OpenAI failure that names the key reaches no response', async () => {
  const { port } = await start({
    env: { OPENAI_API_KEY: SENTINEL },
    spawnImpl: fakeSpawn({ atStdinEnd: prints('', 1) }),
    fetchImpl: fakeFetch(new Error(`request failed with Bearer ${SENTINEL}`)),
  });
  const res = await post(port, { task: 'beats', text: 'an idea' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { source: 'none', text: null });
  assert.equal(res.body.includes(SENTINEL), false);
});

test('another website, a missing Origin or a foreign Host gets 403 and asks no model', async () => {
  const { port, spawnImpl, fetchImpl } = await start({ env: { OPENAI_API_KEY: SENTINEL } });
  const cases = [
    { Origin: 'https://evil.example', Host: `127.0.0.1:${port}` },
    { Host: `127.0.0.1:${port}` },
    { Origin: `http://127.0.0.1:${port}`, Host: `evil.example:${port}` },
    { Origin: `http://evil.example:${port}`, Host: `evil.example:${port}` },
    { Origin: `http://127.0.0.1:${port + 1}`, Host: `127.0.0.1:${port}` },
    { Origin: 'null', Host: `127.0.0.1:${port}` },
  ];
  for (const headers of cases) {
    const res = await post(port, { task: 'beats', text: 'an idea' }, headers);
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.body.includes(SENTINEL), false);
    assert.equal(JSON.parse(res.body).source, 'none');
  }
  assert.equal(spawnImpl.calls.length, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a body over 16 KB gets 413 and asks no model; one of 5 KB is read', async () => {
  const { port, spawnImpl, fetchImpl } = await start({ env: { OPENAI_API_KEY: SENTINEL } });
  const big = await post(port, { task: 'beats', text: 'x'.repeat(17000) });
  assert.equal(big.status, 413);
  assert.equal(spawnImpl.calls.length, 0);
  assert.equal(fetchImpl.calls.length, 0);

  const medium = await post(port, { task: 'beats', text: 'word '.repeat(1000) });
  assert.equal(medium.status, 200, 'this route has its own limit, above the secret route\'s 4 KB');
  assert.equal(spawnImpl.calls.length, 1);
});

test('the text is cut to 4,000 characters before a model sees it', async () => {
  const { port, spawnImpl } = await start();
  const res = await post(port, { task: 'beats', text: `  ${'y'.repeat(9000)}  ` });
  assert.equal(res.status, 200);
  assert.equal(spawnImpl.calls[0].stdin, 'y'.repeat(4000));
});

test('an unknown task, a missing text or a body that is not JSON gets 400 and asks no model', async () => {
  const { port, spawnImpl, fetchImpl } = await start({ env: { OPENAI_API_KEY: SENTINEL } });
  const bad = [
    { task: 'shell', text: 'an idea' },
    { task: '__proto__', text: 'an idea' },
    { text: 'an idea' },
    { task: 'beats' },
    { task: 'beats', text: '' },
    { task: 'beats', text: '   ' },
    { task: 'beats', text: 42 },
    { task: 'beats', text: ['an idea'] },
    '{not json',
    '',
    '[]',
    'null',
    '"beats"',
  ];
  for (const body of bad) {
    const res = await post(port, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(JSON.parse(res.body).source, 'none');
  }
  assert.equal(spawnImpl.calls.length, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test('the experiment task is answered through the same adapters', async () => {
  const reply = '{"from":"grab a tea","to":"grab a coffee"}';
  const { port, spawnImpl } = await start({ spawnImpl: fakeSpawn({ atStdinEnd: prints(reply) }) });
  const res = await post(port, { task: 'experiment', text: 'what if the opener was grab a coffee, not grab a tea' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { source: 'claude-code', text: reply });
  assert.notEqual(spawnImpl.calls[0].args[1], beatsInstruction());
});

test('GET /api/model answers 405, and so does every method but POST', async () => {
  const { port, spawnImpl } = await start();
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
    const res = await request(port, { method, path: '/api/model', headers: own(port) });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.allow, 'POST');
  }
  assert.equal(spawnImpl.calls.length, 0);
});

test('two posts at once: the second waits for the first, one model call at a time', async () => {
  const releases = [];
  let active = 0;
  let mostAtOnce = 0;
  const spawnImpl = fakeSpawn({
    atStdinEnd: (child, call) => {
      active += 1;
      mostAtOnce = Math.max(mostAtOnce, active);
      releases.push(() => {
        active -= 1;
        prints(JSON.stringify([{ label: call.stdin, points: [] }]))(child);
      });
    },
  });
  const { port } = await start({ spawnImpl });
  const first = post(port, { task: 'beats', text: 'first idea' });
  const second = post(port, { task: 'beats', text: 'second idea' });

  await waitFor(() => releases.length === 1, 'the first model call to start');
  await sleep(80);
  assert.equal(spawnImpl.calls.length, 1, 'the second call has not started while the first runs');

  releases[0]();
  await waitFor(() => releases.length === 2, 'the second model call to start');
  releases[1]();

  const answers = await Promise.all([first, second]);
  assert.equal(mostAtOnce, 1);
  assert.deepEqual(answers.map((r) => r.status), [200, 200]);
  assert.deepEqual(spawnImpl.calls.map((c) => c.stdin).sort(), ['first idea', 'second idea']);
  for (const [i, text] of ['first idea', 'second idea'].entries()) {
    assert.deepEqual(JSON.parse(JSON.parse(answers[i].body).text), [{ label: text, points: [] }], 'each post gets its own answer');
  }
});

test('a call that fails does not hold up the next one', async () => {
  let n = 0;
  const spawnImpl = fakeSpawn({
    atStdinEnd: (child) => {
      n += 1;
      if (n === 1) endChild(child, 1);
      else prints(BEATS_JSON)(child);
    },
  });
  const { port } = await start({ spawnImpl });
  const [a, b] = await Promise.all([post(port, { task: 'beats', text: 'one' }), post(port, { task: 'beats', text: 'two' })]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.deepEqual([JSON.parse(a.body).source, JSON.parse(b.body).source].sort(), ['claude-code', 'none']);
});

test('the secret route and the static files still answer beside the new route', async () => {
  const { port } = await start({ env: {} });
  const secret = await request(port, { method: 'POST', path: '/api/realtime/secret', headers: own(port), body: '{}' });
  assert.equal(secret.status, 200);
  assert.deepEqual(JSON.parse(secret.body), { available: false });
  const health = await request(port, { path: '/health' });
  assert.equal(JSON.parse(health.body).ok, true);
  assert.match(JSON.parse(health.body).instance, /^[a-f0-9]{20}$/);
  const source = await request(port, { path: '/server/model.js' });
  assert.equal(source.status, 404, 'the server\'s own code is not served');
  const prompt = await request(port, { path: '/prompts/write-beats.md' });
  assert.equal(prompt.status, 404);
});

// --- The instruction and the source ---------------------------------------------------------

test('prompts/write-beats.md asks for memory triggers as a JSON array, and says the text is not orders', () => {
  const prompt = beatsInstruction();
  assert.match(prompt, /3 to 6 story beats/);
  assert.match(prompt, /1 to 3 words/);
  assert.match(prompt, /at most 6 words/);
  assert.match(prompt, /memory triggers/i);
  assert.match(prompt, /never a script/i);
  assert.match(prompt, /JSON array/);
  assert.match(prompt, /`label`/);
  assert.match(prompt, /`points`/);
  assert.match(prompt, /nothing else/i);
  assert.match(prompt, /not instructions/i);
  assert.ok(prompt.length < 4000, 'short enough to hand over as one argument');
  assert.equal(prompt.includes('\0'), false);
});

test('server/model.js names one address, uses no shell and never writes to the console', () => {
  const src = fs.readFileSync(path.join(appRoot, 'server', 'model.js'), 'utf8');
  const addresses = src.match(/\b(?:https?|wss?):\/\/[^\s'"`)]+/g) || [];
  assert.ok(addresses.length >= 1);
  for (const address of addresses) assert.equal(address, URL_EXPECTED);
  assert.equal(/console\s*\./.test(src), false, 'no console use');
  assert.equal(/sk-[A-Za-z0-9_-]{8,}/.test(src), false, 'no key-like literal');
  assert.equal(/shell:\s*true/.test(src), false, 'no shell');
  assert.match(src, /shell:\s*false/);
  assert.equal(/\bexec(?:Sync|File|FileSync)?\s*\(/.test(src), false, 'no exec');
  assert.equal(/process\.(stdout|stderr)/.test(src), false, 'nothing is written to stdout or stderr');
  assert.equal(/\b(writeFile|appendFile|createWriteStream)/.test(src), false, 'nothing is written to a file');
});

// --- The key, last (T-01.1-06) -------------------------------------------------------------

/** Files under the app folder written since this test file started that hold the sentinel. */
function filesHoldingTheKey() {
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.') && entry.name !== '.tmp') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && full !== thisFile) {
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < startedAt - 2000 || stat.size > 5 * 1024 * 1024) continue;
          if (fs.readFileSync(full).includes(SENTINEL)) hits.push(path.relative(appRoot, full));
        } catch {
          // a scratch file another test removed while this one looked
        }
      }
    }
  };
  walk(appRoot);
  return hits;
}

test('the key is in nothing written to stdout or stderr, and in no file written under the app folder', () => {
  assert.ok(written.every((chunk) => !chunk.includes(SENTINEL)), 'the sentinel key reached stdout or stderr');
  assert.deepEqual(filesHoldingTheKey(), []);
});
