// Hey YAP exchange detector (LIVE-03, D-08).
//
// The word path: timed final words (the sample replay) and the held key. On a
// microphone take Chrome's results are read by wake-tracker.js instead; both
// read one wake rule from wake-settings.js (D-73).
//
// An exchange is the stretch of a take where the person talks to YAP. It opens
// on the wake pair ("hey" or "hay", then a word that sounds like "yap" and is
// not on the never-list (WAKE-01, D-74, D-75), adjacent tokens, at most wakeGap
// seconds apart) or on a key press, and records exact start and end times so
// the cut (D-18) needs no guessing:
//   wake: start = the "hey" word start; end = the last remark word end. It
//         closes after exchangeEndPause seconds with no new word, or on an end
//         event. A pause event never closes it.
//   key:  start = key down; end = key up. It closes on key release (or an end
//         event); silence does not close it.
// Ordinary uses of "yap" ("they yap", "stop yapping", "Yap is ...") never open
// one: tokens are compared whole after normalizeToken, never by substring.
// While an exchange is open a second wake pair is just part of the remark.

import { WAKE_SETTINGS, isWakeFirst, isYapLike, isNever } from './wake-settings.js';

/**
 * Every live setting is one value (D-35) so Phase 2 can tune it. Each is read
 * from WAKE_SETTINGS, the one settings object of the wake path (D-73); a
 * caller's settings may still override any of them.
 */
export const HEY_YAP_DEFAULTS = Object.freeze({
  /** seconds of silence that end a wake exchange */
  exchangeEndPause: WAKE_SETTINGS.exchangeEndPause,
  /** most seconds between the end of "hey" and the start of the word after it */
  wakeGap: WAKE_SETTINGS.wakeGap,
  /** accepted spellings of the first wake word (normalised) */
  wakeFirst: WAKE_SETTINGS.wakeFirst,
  /** the shape of the second wake word: anything that sounds like "yap" (D-74) */
  yapLike: WAKE_SETTINGS.yapLike,
  /** words that never open an exchange after "hey" (D-75) */
  neverList: WAKE_SETTINGS.neverList,
});

const EPSILON = 1e-9;

/**
 * @typedef {object} Exchange
 * @property {string} id        "x1", "x2", ... in order
 * @property {'wake'|'key'} trigger
 * @property {number} start     seconds from take start
 * @property {number|null} end  seconds from take start (null in the exchange-open snapshot)
 * @property {string} remark    the words after the wake pair (or during the key hold), joined by spaces
 * @property {import('./replay.js').Word[]} words  the remark words
 */

/**
 * @param {Partial<import('./wake-settings.js').WakeSettings>} [settings]  exchangeEndPause, wakeGap, wakeFirst, yapLike, neverList
 * @param {{ onOpen?: (x: Exchange) => void, onClose?: (x: Exchange) => void }} [handlers]
 */
export function createExchangeDetector(settings = {}, handlers = {}) {
  const cfg = { ...HEY_YAP_DEFAULTS, ...settings };

  let count = 0;
  /** @type {import('./replay.js').Word|null} the previous word outside an exchange */
  let prev = null;
  /** @type {null | {id: string, trigger: 'wake'|'key', start: number, words: import('./replay.js').Word[], lastWordEnd: number}} */
  let open = null;
  /** @type {unknown} */
  let timer = null;
  /** @type {import('./clock.js').Clock|null} */
  let timerClock = null;
  /** @type {Exchange[]} */
  const closed = [];

  function disarm() {
    if (timer !== null && timerClock) timerClock.clearTimeout(timer);
    timer = null;
  }

  function arm(clock) {
    disarm();
    timerClock = clock;
    timer = clock.setTimeout(() => {
      timer = null;
      close(null);
    }, cfg.exchangeEndPause);
  }

  function snapshot(o, end) {
    return {
      id: o.id,
      trigger: o.trigger,
      start: o.start,
      end,
      remark: o.words.map((w) => w.text).join(' '),
      words: o.words.slice(),
    };
  }

  /** @param {number|null} endAt explicit end (key release), or null to end at the last word */
  function close(endAt) {
    if (!open) return;
    disarm();
    const x = snapshot(open, endAt ?? open.lastWordEnd);
    open = null;
    prev = null;
    closed.push(x);
    handlers.onClose?.(x);
  }

  function begin(trigger, start, lastWordEnd) {
    count += 1;
    open = { id: `x${count}`, trigger, start, words: [], lastWordEnd };
    handlers.onOpen?.(snapshot(open, null));
  }

  const isWakePair = (a, b) =>
    isWakeFirst(a.text, cfg) &&
    isYapLike(b.text, cfg) &&
    !isNever(b.text, cfg) &&
    b.start - a.end <= cfg.wakeGap + EPSILON;

  return {
    /**
     * @param {import('./replay.js').SourceEvent} event
     * @param {import('./clock.js').Clock} clock
     * @returns {{ inExchange: boolean }}
     */
    push(event, clock) {
      switch (event.type) {
        case 'end': {
          if (open && open.trigger === 'key' && open.words.length === 0) close(event.at);
          else close(null);
          prev = null;
          break;
        }
        case 'key': {
          if (event.down && !open) {
            begin('key', event.at, event.at);
          } else if (!event.down && open && open.trigger === 'key') {
            close(event.at);
          }
          break;
        }
        case 'word': {
          const word = event.word;
          if (open) {
            open.words.push(word);
            open.lastWordEnd = word.end;
            if (open.trigger === 'wake') arm(clock);
          } else if (prev && isWakePair(prev, word)) {
            begin('wake', prev.start, word.end);
            arm(clock);
          } else {
            prev = word;
          }
          break;
        }
        default:
          // 'pause' and anything else never open or close an exchange.
          break;
      }
      return { inExchange: open !== null };
    },
    /** @returns {boolean} */
    isOpen: () => open !== null,
    /** @returns {Exchange[]} every closed exchange, in order */
    exchanges: () => closed.slice(),
  };
}
