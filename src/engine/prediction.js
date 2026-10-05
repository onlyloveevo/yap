// YAP's take-2 restart bet: before take 2, YAP bets its restart count will be
// at most take 1's (plus any slack learned from earlier misses); after take 2
// it checks the bet against the detector's real count, and a miss raises the
// next bet's allowance (PRED-01; D-26, seat default (b) of D-35).
//
// The bet is YAP's own, worded as YAP's. It is never a score, grade or
// judgement of the creator. The actual count always comes from the caller's
// detector run (D-23: no invented results).
//
// Pure and browser-safe: imports nothing and never mutates its inputs. The
// session appends logLine(...) entries to the prediction log through
// src/node/store.js.

/**
 * @typedef {{ kind: 'restarts-at-most', forTake: string, predicted: number, slack: number, text: string }} Bet
 * @typedef {{ hit: boolean, actual: number, text: string, nextSlack: number }} BetResult
 * @typedef {{ at: string, kind: string, forTake: string, predicted: number, actual: number | null, hit: boolean | null, slack: number }} LogEntry
 * @typedef {{ enabled?: boolean }} PredictionSettings
 */

/** Seat default (b) of D-35, one setting: YAP makes the take-2 restart bet. */
export const PREDICTION_DEFAULTS = Object.freeze({ enabled: true });

/** Every word of the bet and its result. Each names it as YAP's bet. */
export const COPY = Object.freeze({
  bet: "YAP's bet: {forTake} will have at most {count}.",
  held: "{ForTake} had {count}. YAP's bet held.",
  missed: "{ForTake} had {count}. YAP's bet missed; the next bet allows up to {allow}.",
  restartOne: 'restart',
  restartMany: 'restarts',
});

const KIND = 'restarts-at-most';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Fill {name} slots literally (a function replacer, so `$` in a label is kept as typed). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

function isCount(n) {
  return Number.isInteger(n) && n >= 0;
}

function restarts(n) {
  return `${n} ${n === 1 ? COPY.restartOne : COPY.restartMany}`;
}

function capitalise(s) {
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * The slack in force: the latest log entry's slack, or 0 with no log.
 * @param {LogEntry[]} logEntries
 */
function currentSlack(logEntries) {
  const entries = (logEntries || []).filter((e) => e && e.kind === KIND && isCount(e.slack));
  return entries.length ? entries[entries.length - 1].slack : 0;
}

/**
 * Make YAP's bet for the next take: at most previousActual + slack restarts.
 * Returns null with no previous take or when the bet is switched off.
 * @param {LogEntry[]} logEntries the prediction log so far, oldest first
 * @param {{ forTake: string, previousActual?: number | null, settings?: PredictionSettings }} options
 * @returns {Bet | null}
 */
export function makeBet(logEntries, { forTake, previousActual, settings } = /** @type {any} */ ({})) {
  const s = { ...PREDICTION_DEFAULTS, ...(settings || {}) };
  if (!s.enabled) return null;
  if (previousActual == null) return null;
  if (!isCount(previousActual)) {
    throw namedError('InvalidCountError', `previousActual must be a whole number of restarts (got ${previousActual})`);
  }
  const slack = currentSlack(logEntries);
  const predicted = previousActual + slack;
  const text = fill(COPY.bet, { forTake, count: restarts(predicted) });
  return { kind: KIND, forTake, predicted, slack, text };
}

/**
 * Check YAP's bet against the real restart count. A hit (actual at most the
 * bet) lowers the slack by 1, never below 0; a miss adds the overshoot.
 * @param {Bet} bet
 * @param {number} actual the detector's count for that take
 * @returns {BetResult}
 */
export function checkBet(bet, actual) {
  if (!isCount(actual)) {
    throw namedError('InvalidCountError', `actual must be the detector's whole-number restart count (got ${actual})`);
  }
  const slack = isCount(bet.slack) ? bet.slack : 0;
  const hit = actual <= bet.predicted;
  const nextSlack = hit ? Math.max(0, slack - 1) : slack + (actual - bet.predicted);
  const values = { ForTake: capitalise(bet.forTake), count: restarts(actual), allow: bet.predicted + nextSlack };
  const text = fill(hit ? COPY.held : COPY.missed, values);
  return { hit, actual, text, nextSlack };
}

/**
 * One prediction-log line. With no result it records the bet (actual and hit
 * null, slack in force); with a result it records the outcome and the slack
 * the next bet will read.
 * @param {Bet} bet
 * @param {BetResult | null} result
 * @param {string} at ISO time
 * @returns {LogEntry}
 */
export function logLine(bet, result, at) {
  return {
    at,
    kind: bet.kind,
    forTake: bet.forTake,
    predicted: bet.predicted,
    actual: result ? result.actual : null,
    hit: result ? result.hit : null,
    slack: result ? result.nextSlack : bet.slack,
  };
}
