// Server-side minting of a short-lived OpenAI Realtime client secret
// (LIVE-05, D-12, D-13, D-31). Runs in Node on the person's own machine.
//
// The person's OPENAI_API_KEY is read inside mintClientSecret and used only in
// the Authorization header of one POST to the fixed api.openai.com endpoint
// below. It is never returned, never put in an error message (errors are
// redacted), never logged: this module does not use the console at all. The
// page receives only the ephemeral secret, its expiry and the model.

import { buildClientSecretRequest, buildInstructions, REALTIME_MODEL } from '../src/engine/realtime.js';

/**
 * Fixed endpoint. There is deliberately no environment override, so a crafted
 * environment cannot send the key to another host (T-01-09).
 */
export const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

const SECRET_SECONDS = 120; // T-01-10
const MAX_INSTRUCTIONS = 4000; // bound what a page can ask the server to send
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REDACTED = '[redacted]';

/**
 * Remove the key, any bearer token and anything shaped like an OpenAI key from a message.
 * @param {string} message
 * @param {string} key
 * @returns {string}
 */
function redact(message, key) {
  let out = String(message ?? '');
  if (key) out = out.split(key).join(REDACTED);
  out = out.replace(/Bearer\s+(?!\[redacted\])\S+/gi, `Bearer ${REDACTED}`);
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, REDACTED);
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 300 ? `${out.slice(0, 299)}…` : out;
}

/**
 * Mint a short-lived client secret for a text-only Realtime session.
 *
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch | null,
 *           instructions?: string, model?: string }} [options]
 * @returns {Promise<{ available: true, value: string, expiresAt: number | null, model: string }
 *                  | { available: false, error?: string }>}
 */
export async function mintClientSecret(options = {}) {
  const opts = options || {};
  const env = opts.env !== undefined ? opts.env : globalThis.process ? globalThis.process.env : {};
  const fetchImpl = opts.fetchImpl !== undefined ? opts.fetchImpl : globalThis.fetch;
  const model = opts.model !== undefined ? opts.model : REALTIME_MODEL;

  const rawKey = env && typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  if (!rawKey) return { available: false };
  const key = rawKey;

  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
    return { available: false, error: 'Unknown Realtime model' };
  }
  if (typeof fetchImpl !== 'function') {
    return { available: false, error: 'fetch is not available in this Node' };
  }

  let instructions = typeof opts.instructions === 'string' && opts.instructions.trim() !== ''
    ? opts.instructions
    : buildInstructions();
  if (instructions.length > MAX_INSTRUCTIONS) instructions = instructions.slice(0, MAX_INSTRUCTIONS);
  // Never forward the key inside the body, even if a caller pasted it into the instructions.
  instructions = instructions.split(key).join(REDACTED);

  const body = buildClientSecretRequest({ instructions, model, seconds: SECRET_SECONDS });

  let res;
  try {
    res = await fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err && typeof err.message === 'string' ? err.message : String(err);
    return { available: false, error: `Could not reach OpenAI: ${redact(message, key)}` };
  }

  if (!res || !res.ok) {
    const status = res && Number.isInteger(res.status) ? res.status : 'an error';
    return { available: false, error: `OpenAI returned ${status}` }; // the reply body is not copied
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { available: false, error: 'OpenAI reply was not JSON' };
  }

  const source = data && typeof data === 'object' ? data : {};
  const nested = source.client_secret && typeof source.client_secret === 'object' ? source.client_secret : {};
  const value = typeof source.value === 'string' ? source.value : typeof nested.value === 'string' ? nested.value : '';
  const expiresRaw = source.expires_at !== undefined ? source.expires_at : nested.expires_at;
  const expiresAt = typeof expiresRaw === 'number' && Number.isFinite(expiresRaw) ? expiresRaw : null;

  if (!value || value.includes(key) || /^sk-/.test(value)) {
    return { available: false, error: 'OpenAI reply had no client secret' };
  }

  return { available: true, value, expiresAt, model };
}
