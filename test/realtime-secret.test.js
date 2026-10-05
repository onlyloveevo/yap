// Tests for server/realtime-secret.js — LIVE-05, D-12, D-13, D-31.
// The key is the person's own; it is read only here and used only in the
// Authorization header to the fixed api.openai.com endpoint. These tests never
// touch the network (fetch is an injected fake) and use only the sentinel below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mod = await import('../server/realtime-secret.js').catch((err) => {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw err;
});

const SENTINEL = 'sk-test-SENTINEL-0001';
const URL_EXPECTED = 'https://api.openai.com/v1/realtime/client_secrets';

function mint() {
  assert.equal(typeof mod.mintClientSecret, 'function', 'realtime-secret.js exports mintClientSecret()');
  return mod.mintClientSecret;
}

/** A fake fetch that records its calls and answers with `reply` (or rejects with it). */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(url, init);
    return reply;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof body === 'string') throw new SyntaxError(`Unexpected token in JSON: ${body}`);
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

/**
 * Run one mintClientSecret call with console.log/info/warn/error/debug/trace replaced
 * by recorders, then assert that neither the console nor the returned value
 * carries the sentinel key.
 */
async function call(args) {
  const recorded = [];
  const names = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const saved = names.map((n) => console[n]);
  names.forEach((n) => {
    console[n] = (...parts) => recorded.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
  });
  let result;
  try {
    result = await mint()(args);
  } finally {
    names.forEach((n, i) => {
      console[n] = saved[i];
    });
  }
  for (const line of recorded) assert.ok(!line.includes(SENTINEL), 'console output never carries the key');
  assert.ok(!JSON.stringify(result).includes(SENTINEL), 'the returned value never carries the key');
  return { result, recorded };
}

test('OPENAI_CLIENT_SECRETS_URL is fixed to api.openai.com', () => {
  assert.equal(mod.OPENAI_CLIENT_SECRETS_URL, URL_EXPECTED);
});

test('no OPENAI_API_KEY: returns { available: false } and never calls fetch', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1900000000 }));
  const { result } = await call({ env: {}, fetchImpl });
  assert.deepEqual(result, { available: false });
  assert.equal(fetchImpl.calls.length, 0);
});

test('an empty or blank OPENAI_API_KEY counts as no key', async () => {
  for (const value of ['', '   ']) {
    const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1 }));
    const { result } = await call({ env: { OPENAI_API_KEY: value }, fetchImpl });
    assert.deepEqual(result, { available: false });
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('an explicit env is used as given: a key in process.env is not read when env is passed', async () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SENTINEL;
  try {
    const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1 }));
    const { result } = await call({ env: {}, fetchImpl });
    assert.deepEqual(result, { available: false });
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

test('with a key: POSTs to the fixed URL with the Bearer header and a text-only session body', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1900000000 }));
  await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl, instructions: 'Ask one short question.' });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, URL_EXPECTED);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${SENTINEL}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(init.body);
  assert.equal(body.session.type, 'realtime');
  assert.equal(body.session.model, 'gpt-realtime-2.1-mini');
  assert.deepEqual(body.session.output_modalities, ['text']);
  assert.equal(body.session.instructions, 'Ask one short question.');
  assert.deepEqual(body.expires_after, { anchor: 'created_at', seconds: 120 });
  assert.ok(!init.body.includes(SENTINEL), 'the key travels only in the header, never in the body');
});

test('with a key and a 200 reply: returns only { available, value, expiresAt, model }', async () => {
  const fetchImpl = fakeFetch(
    jsonResponse(200, { value: 'ek_abc', expires_at: 1900000000, session: { id: 'sess_1', extra: 'not copied' } }),
  );
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  assert.deepEqual(result, { available: true, value: 'ek_abc', expiresAt: 1900000000, model: 'gpt-realtime-2.1-mini' });
  assert.deepEqual(Object.keys(result).sort(), ['available', 'expiresAt', 'model', 'value']);
});

test('the endpoint cannot be redirected by the environment', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1 }));
  await call({
    env: {
      OPENAI_API_KEY: SENTINEL,
      OPENAI_BASE_URL: 'https://evil.example/v1',
      OPENAI_CLIENT_SECRETS_URL: 'https://evil.example/steal',
      OPENAI_API_BASE: 'https://evil.example',
    },
    fetchImpl,
  });
  assert.equal(fetchImpl.calls[0].url, URL_EXPECTED);
});

test('default instructions are used when none are given', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { value: 'ek_abc', expires_at: 1 }));
  await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(typeof body.session.instructions, 'string');
  assert.ok(body.session.instructions.length > 0);
});

test('a 401 reply returns { available: false, error: "OpenAI returned 401" } without copying the body', async () => {
  const fetchImpl = fakeFetch(jsonResponse(401, { error: { message: `Incorrect API key provided: ${SENTINEL}` } }));
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  assert.deepEqual(result, { available: false, error: 'OpenAI returned 401' });
});

test('a fetch that rejects with the key in its message returns the message with the key redacted', async () => {
  const fetchImpl = fakeFetch(new Error(`connect ECONNREFUSED while sending Bearer ${SENTINEL}`));
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  assert.equal(result.available, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.includes('[redacted]'), 'the key is replaced by [redacted]');
  assert.ok(!result.error.includes(SENTINEL));
});

test('a fetch that throws synchronously never throws to the caller', async () => {
  const fetchImpl = () => {
    throw new TypeError(`Invalid header value: Bearer ${SENTINEL}\n`);
  };
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  assert.equal(result.available, false);
  assert.ok(result.error.includes('[redacted]'));
});

test('a 200 reply with no secret value or with a body that is not JSON is unavailable', async () => {
  for (const body of [{ expires_at: 1 }, { value: '', expires_at: 1 }, 'not json at all']) {
    const fetchImpl = fakeFetch(jsonResponse(200, body));
    const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
    assert.equal(result.available, false);
    assert.equal(typeof result.error, 'string');
  }
});

test('a reply that echoes the key back is refused rather than passed to the page', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { value: SENTINEL, expires_at: 1 }));
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl });
  assert.equal(result.available, false);
});

test('no fetch available: unavailable, no throw', async () => {
  const { result } = await call({ env: { OPENAI_API_KEY: SENTINEL }, fetchImpl: null });
  assert.equal(result.available, false);
});

test('the module source never calls console and has no key-like literal', async () => {
  const src = await readFile(new URL('../server/realtime-secret.js', import.meta.url), 'utf8');
  assert.ok(!/console\s*\./.test(src), 'no console use');
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(src), 'no key-like literal');
});
