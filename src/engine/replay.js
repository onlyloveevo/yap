// Replay source (D-06 sample-replay mode): feeds a word-timed transcript into
// the engine on a clock, as if it were being spoken, with no microphone. Each
// word arrives at its end time (when a speech recogniser would have it); a pause
// marker arrives where the speaker paused; an end event follows the last word.
//
// Scheduling is relative to the moment start() is called: an item at transcript
// time T arrives (T - startAt) / speed seconds after start(). Word, pause and end
// times in the events stay in transcript seconds, so with the default speed 1,
// startAt 0 and a clock that starts with the take, word.end equals clock.now()
// when the word arrives.

/**
 * @typedef {object} Word
 * @property {string} text   as spoken; may carry case and punctuation
 * @property {number} start  seconds from take start
 * @property {number} end    seconds from take start
 * @property {boolean} [final]  default true
 */

/**
 * @typedef {{type: 'word', word: Word}
 *   | {type: 'pause', at: number}
 *   | {type: 'key', down: boolean, at: number}
 *   | {type: 'end', at: number}
 *   | {type: 'interim', text: string}
 *   | {type: 'error', error: string}} SourceEvent
 * 'interim' and 'error' come only from the Web Speech source and are for
 * display; the live take ignores them.
 */

/** Replay settings. pauseMarkerSec: a gap between two words at least this long emits a pause marker. */
export const REPLAY_DEFAULTS = Object.freeze({ pauseMarkerSec: 0.5 });

// Float slack so a gap written as exactly 0.5 s counts as 0.5 s.
const EPS = 1e-9;

/** Thrown when start() is called on a source that was stopped. */
export class ReplayStoppedError extends Error {
  constructor(message = 'replay source was stopped; create a new one to replay again') {
    super(message);
    this.name = 'ReplayStoppedError';
  }
}

/**
 * @param {Word[]} words ascending by start
 * @param {{ clock: import('./clock.js').Clock, speed?: number, startAt?: number, pauseMarkerSec?: number }} options
 *   speed: 1 is real speed, 2 twice as fast. startAt: transcript seconds to start
 *   from; words ending before it are skipped.
 * @returns {{ start: (push: (event: SourceEvent) => void) => void, stop: () => void }}
 */
export function createReplaySource(words, { clock, speed = 1, startAt = 0, pauseMarkerSec = REPLAY_DEFAULTS.pauseMarkerSec } = /** @type {any} */ ({})) {
  if (!Array.isArray(words)) throw new TypeError('createReplaySource needs an array of words');
  if (!clock) throw new TypeError('createReplaySource needs a clock');
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('speed must be a number above 0');
  if (!Number.isFinite(startAt) || startAt < 0) throw new RangeError('startAt must be a number of seconds, 0 or more');
  if (!Number.isFinite(pauseMarkerSec) || pauseMarkerSec <= 0) throw new RangeError('pauseMarkerSec must be a number above 0');

  /** @type {unknown[]} */
  let handles = [];
  let started = false;
  let stopped = false;

  /** Every event to emit, in transcript seconds, in emit order. */
  function plan() {
    /** @type {{ at: number, event: SourceEvent }[]} */
    const items = [];
    let lastEnd = startAt;
    let prev = null;
    for (const word of words) {
      if (prev !== null && word.start - prev.end >= pauseMarkerSec - EPS) {
        const at = prev.end + pauseMarkerSec;
        if (at >= startAt && word.end >= startAt) items.push({ at, event: { type: 'pause', at } });
      }
      prev = word;
      if (word.end < startAt) continue;
      items.push({ at: word.end, event: { type: 'word', word: { final: true, ...word } } });
      if (word.end > lastEnd) lastEnd = word.end;
    }
    items.push({ at: lastEnd, event: { type: 'end', at: lastEnd } });
    return items;
  }

  return {
    start(push) {
      if (typeof push !== 'function') throw new TypeError('start needs a push function');
      if (stopped) throw new ReplayStoppedError();
      if (started) throw new Error('replay source already started');
      started = true;
      for (const item of plan()) {
        const delay = (item.at - startAt) / speed;
        handles.push(clock.setTimeout(() => {
          if (!stopped) push(item.event);
        }, delay));
      }
    },
    stop() {
      stopped = true;
      for (const h of handles) clock.clearTimeout(h);
      handles = [];
    },
  };
}
