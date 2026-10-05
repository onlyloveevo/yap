// The one settings object of the wake path (D-73): every number and every word
// list that decides when "Hey YAP" is heard lives here, so a change of wake
// phrase is an edit to this object plus a new fixture. The word-path detector
// (hey-yap.js), the results-path tracker (wake-tracker.js) and the Web Speech
// source read it; none of them writes a wake number of its own.
//
// The pattern, the never-list and the settle time are the brief's (WAKE-01,
// WAKE-02; D-74, D-75, D-79). They are not tuned to make a recording pass (D-91).

import { normalizeToken } from './text.js';

/**
 * @typedef {object} YapLike  the shape of the word after "hey" (D-74)
 * @property {string} first        its first letter
 * @property {readonly string[]} second  the letters its second letter may be
 * @property {number} minLetters
 * @property {number} maxLetters
 */

/**
 * @typedef {object} WakeSettings
 * @property {readonly string[]} wakeFirst    the word before: "hey" or "hay"
 * @property {YapLike} yapLike                what "sounds like yap" means
 * @property {readonly string[]} neverList    words that never open an exchange after "hey" (D-75)
 * @property {number} settleSec        a remark is complete when unchanged this long (D-79)
 * @property {number} correctSec       after acting, the exchange stays correctable this long (D-79)
 * @property {number} maxRemarkWords   a remark's longest length in words (D-80)
 * @property {number} keepTalkingSec   a remark that never settles is taken as complete after this (D-80)
 * @property {number} wakeOnlySec      a wake pair with no remark word is dropped after this (D-81)
 * @property {number} straddleSec      how long the old session's last word may pair with a new session's first (D-81)
 * @property {number} exchangeEndPause silence that ends an exchange on the word path (sample replay, held key)
 * @property {number} wakeGap          most seconds between "hey" and the word after it on the word path
 * @property {number} backdateSec      an exchange starts this long before its wake pair was first seen
 * @property {number} startWaitSec     how long to wait for Chrome's start event (WAKE-05)
 * @property {number} noWordsSec       how long a running take may go with no text (WAKE-05)
 * @property {readonly number[]} offlineRetrySec  waits before each retry when the service is unreachable (WAKE-05)
 * @property {{ count: number, windowSec: number }} restartBurst  recognition ending this often means stop restarting (WAKE-05)
 */

/** @type {WakeSettings} */
export const WAKE_SETTINGS = Object.freeze({
  wakeFirst: Object.freeze(['hey', 'hay']),
  yapLike: Object.freeze({ first: 'y', second: Object.freeze(['a', 'e', 'i', 'u']), minLetters: 2, maxLetters: 4 }),
  neverList: Object.freeze(['you', 'your', "you're", 'yes', "y'all", 'yo', 'app', 'up', 'jack']),
  settleSec: 0.6,
  correctSec: 2,
  maxRemarkWords: 12,
  keepTalkingSec: 3,
  wakeOnlySec: 4,
  straddleSec: 1.5,
  exchangeEndPause: 0.7,
  wakeGap: 0.8,
  backdateSec: 0.6,
  startWaitSec: 5,
  noWordsSec: 8,
  offlineRetrySec: Object.freeze([2, 5, 10]),
  restartBurst: Object.freeze({ count: 5, windowSec: 10 }),
});

/** A word with its apostrophes removed, so "y'all" and "yall" compare equal. */
const bare = (token) => normalizeToken(token).replace(/'/g, '');

/**
 * Is this the word before the wake word ("hey" or "hay")?
 * @param {string} token
 * @param {Partial<WakeSettings>} [settings]
 * @returns {boolean}
 */
export function isWakeFirst(token, settings = WAKE_SETTINGS) {
  const t = normalizeToken(token);
  if (!t) return false;
  return (settings.wakeFirst || WAKE_SETTINGS.wakeFirst).some((w) => normalizeToken(w) === t);
}

/**
 * Does this word sound like "yap" (D-74)? It is letters only, starts with the
 * pattern's first letter, its second letter is one of the pattern's, and its
 * length is within the pattern's limits. The never-list is a separate test.
 * @param {string} token
 * @param {Partial<WakeSettings>} [settings]
 * @returns {boolean}
 */
export function isYapLike(token, settings = WAKE_SETTINGS) {
  const p = settings.yapLike || WAKE_SETTINGS.yapLike;
  const t = normalizeToken(token);
  if (!/^[a-z]+$/.test(t)) return false;
  if (t.length < p.minLetters || t.length > p.maxLetters) return false;
  return t[0] === p.first && p.second.includes(t[1]);
}

/**
 * Is this word on the never-list (D-75)? Compared whole, apostrophes aside.
 * @param {string} token
 * @param {Partial<WakeSettings>} [settings]
 * @returns {boolean}
 */
export function isNever(token, settings = WAKE_SETTINGS) {
  const t = bare(token);
  if (!t) return false;
  return (settings.neverList || WAKE_SETTINGS.neverList).some((w) => bare(w) === t);
}
