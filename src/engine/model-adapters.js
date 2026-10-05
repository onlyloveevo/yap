// One order of model adapters, tried in turn (SETUP-01; D-39, D-43).
//
// The seat default of D-43 is one list, MODEL_ORDER: the tester's own Claude
// Code first, then OpenAI with the tester's own key. When no adapter answers,
// the chain says `{ source: 'none', text: null }` and the caller falls back to
// what it can do with no model (setup-beats.js gives the default beats).
// EXP-01 asks through the same chain (D-61).
//
// Pure and browser-safe: imports nothing, takes its timers from the clock
// passed in, and keeps no state between calls. An adapter is any function
// `({ task, text }) => string | null`, so a test hands in a fake.

/**
 * @typedef {{ task: string, text: string }} ModelRequest
 * @typedef {(request: ModelRequest) => Promise<string | null> | string | null} ModelAdapter
 * @typedef {{ source: string, text: string | null }} ModelAnswer
 * @typedef {{ setTimeout(fn: () => void, seconds: number): unknown, clearTimeout(handle: unknown): void }} ChainClock
 */

/** Which model is asked first (D-43). The one setting to change the order (D-39). */
export const MODEL_ORDER = Object.freeze(['claude-code', 'openai']);

/** How long one adapter may take before the next is tried, in seconds, unless the caller says otherwise. */
const DEFAULT_TIMEOUT_SEC = 30;

/** The global timers, in seconds like every engine clock. */
const GLOBAL_CLOCK = {
  setTimeout: (fn, seconds) => globalThis.setTimeout(fn, seconds * 1000),
  clearTimeout: (handle) => globalThis.clearTimeout(/** @type {any} */ (handle)),
};

/**
 * Ask one adapter. Resolves to its text, or to null when it answers with
 * nothing, rejects, throws or runs out of time. Never rejects, and whatever an
 * adapter rejects with is dropped here.
 * @param {ModelAdapter} adapter
 * @param {ModelRequest} request
 * @param {number} timeoutSec
 * @param {ChainClock} clock
 * @returns {Promise<string | null>}
 */
function tryAdapter(adapter, request, timeoutSec, clock) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      resolve(typeof value === 'string' && value.trim() ? value : null);
    };
    timer = clock.setTimeout(() => finish(null), timeoutSec);
    let pending;
    try {
      pending = adapter(request);
    } catch {
      finish(null);
      return;
    }
    Promise.resolve(pending).then(finish, () => finish(null));
  });
}

/**
 * Make the `ask` that tries each adapter in `order` and reports which answered.
 * A name in the order with no adapter given is passed over.
 * @param {object} [options]
 * @param {Record<string, ModelAdapter>} [options.adapters] adapters by name
 * @param {readonly string[]} [options.order] default MODEL_ORDER
 * @param {number} [options.timeoutSec] time limit for each adapter, in seconds
 * @param {ChainClock} [options.clock] default the global timers
 * @returns {(request: ModelRequest) => Promise<ModelAnswer>}
 */
export function createModelChain({ adapters, order = MODEL_ORDER, timeoutSec = DEFAULT_TIMEOUT_SEC, clock = GLOBAL_CLOCK } = {}) {
  const names = Array.isArray(order) ? [...order] : [...MODEL_ORDER];
  const limit = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : DEFAULT_TIMEOUT_SEC;
  const has = (name) => Boolean(adapters) && Object.prototype.hasOwnProperty.call(adapters, name) && typeof adapters[name] === 'function';

  return async function ask(request) {
    const { task, text } = request && typeof request === 'object' ? request : /** @type {any} */ ({});
    for (const name of names) {
      if (!has(name)) continue;
      const answer = await tryAdapter(adapters[name], { task, text }, limit, clock);
      if (answer !== null) return { source: name, text: answer };
    }
    return { source: 'none', text: null };
  };
}
