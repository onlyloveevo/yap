// How well YAP can hear (WAKE-05; D-87, D-88). When speech recognition cannot
// hear, the take says which way, in one exact line, and recognition is tried
// again, left alone or stopped as that line says.
//
// This module only decides. It holds no recogniser and names nothing of the
// browser: the Web Speech source tells it what happened (start asked for,
// started, text, an error code, ended, the person's stop, the browser back
// online) and it answers with the status and whether to start recognition
// again. Every time is on the injected take clock and every number comes from
// the settings passed in (WAKE_SETTINGS by default).
//
// The held key is not offered in any status or line: it still needs Chrome's
// words for the remark (D-87).

import { WAKE_SETTINGS } from './wake-settings.js';

/**
 * @typedef {'ok' | 'stopped' | 'no-recognition' | 'waiting-for-permission' | 'mic-blocked'
 *   | 'service-blocked' | 'no-microphone' | 'offline' | 'no-words' | 'restarting'} HearingStatus
 */

/**
 * @typedef {object} Hearing
 * @property {HearingStatus} status
 * @property {string | null} line      the exact text to show, or null (ok and stopped show nothing)
 * @property {boolean} listenAgain     true when the person can ask to listen again
 */

/**
 * The line for each status, word for word as D-88 writes it. ok and stopped
 * show nothing.
 * @type {Readonly<Record<HearingStatus, string | null>>}
 */
export const HEARING_LINES = Object.freeze({
  ok: null,
  stopped: null,
  'no-recognition': 'Open YAP in Google Chrome.',
  'waiting-for-permission': 'YAP is waiting to hear. If Chrome is asking for the microphone, allow it. Otherwise press Listen again.',
  'mic-blocked': 'Allow the microphone for this page, then reload.',
  'service-blocked': 'Speech recognition is switched off in this browser. Open YAP in Google Chrome.',
  'no-microphone': "YAP can't get sound from the microphone. Check it is connected and not in use by another app, then reload.",
  offline: "YAP can't reach speech recognition. Check the internet, then press Listen again.",
  'no-words': "YAP isn't hearing words here. If you are speaking, open YAP in Google Chrome.",
  restarting: 'Speech recognition keeps stopping. If another tab is listening, close it, then press Listen again.',
});

/**
 * Chrome's error codes that are a way of not hearing, and the status of each.
 * A code that is not here gives no status and no line: `no-speech` and
 * `aborted` are not faults (D-87), and nothing the service says is shown.
 * @type {Readonly<Record<string, HearingStatus>>}
 */
export const HEARING_ERRORS = Object.freeze({
  'not-allowed': 'mic-blocked',
  'service-not-allowed': 'service-blocked',
  'audio-capture': 'no-microphone',
  network: 'offline',
});

/** Statuses that hold until the page is reloaded or listening is asked for anew. */
const FINAL = new Set(['no-recognition', 'mic-blocked', 'service-blocked', 'no-microphone']);

/**
 * Statuses that offer Listen again from the moment they are set. offline
 * offers it only once its own retries are used up.
 */
const OFFERS = new Set(['waiting-for-permission', 'restarting']);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * @param {HearingStatus} status
 * @param {boolean} listenAgain
 * @returns {Hearing}
 */
function hearingOf(status, listenAgain) {
  return Object.freeze({ status, line: HEARING_LINES[status], listenAgain });
}

/**
 * The hearing status of one source, and the rules for retry and restart.
 *
 * The caller reports:
 *   asked()          it asked the recogniser to start, for the person (a new
 *                    listen): the checks begin afresh from ok
 *   noRecognition()  it was asked to start and has no recogniser
 *   started()        the recogniser's start event
 *   gotText()        any text arrived, early or final
 *   failed(code)     the recogniser's error event, with Chrome's code
 *   ended()          the recogniser's end event; the answer is true when the
 *                    caller should start recognition again at once
 *   personStopped()  the person's stop: wins over every restart and retry
 *   listenAgain()    the person asked to listen again; acts only when offered
 *   online()         the browser is back online
 *
 * `restart()` is the caller's function that starts recognition again; the
 * machine calls it for an offline retry, on online() and on listenAgain().
 * `onChange(hearing)` is called once each time the hearing changes: a change
 * of status, or offline beginning to offer Listen again.
 *
 * @param {object} options
 * @param {import('./clock.js').Clock} options.clock  the take clock
 * @param {Partial<import('./wake-settings.js').WakeSettings>} [options.settings]
 *   reads startWaitSec, noWordsSec, offlineRetrySec and restartBurst; a field
 *   left out is taken from WAKE_SETTINGS
 * @param {(hearing: Hearing) => void} [options.onChange]
 * @param {() => void} [options.restart]
 * @returns {{ current: () => Hearing, asked: () => void, noRecognition: () => void, started: () => void,
 *   gotText: () => void, failed: (code: string) => void, ended: () => boolean, personStopped: () => void,
 *   listenAgain: () => void, online: () => void, dispose: () => void }}
 */
export function createHearing({ clock, settings, onChange, restart } = /** @type {any} */ ({})) {
  if (!clock || typeof clock.setTimeout !== 'function') throw new TypeError('createHearing needs a clock');
  const { startWaitSec, noWordsSec, offlineRetrySec, restartBurst } = { ...WAKE_SETTINGS, ...(settings || {}) };
  const tell = typeof onChange === 'function' ? onChange : () => {};
  const startAgain = typeof restart === 'function' ? restart : () => {};

  let hearing = hearingOf('ok', false);
  let disposed = false;

  /** the wait for the start event after start was asked for */
  let startTimer = null;
  /** the wait for the first text after recognition first started */
  let wordsTimer = null;
  /** the wait before the next offline retry */
  let retryTimer = null;

  /** has the no-words count begun? It begins once, at the first start. */
  let countingWords = false;
  /** has any text arrived since the checks began? */
  let hadText = false;
  /** network failures since the last text */
  let failures = 0;
  /** recognition failed on the network and has not been started again yet */
  let down = false;
  /** take times of the ends since the last text, inside the burst's time span */
  let ends = [];

  /** @param {unknown} handle */
  function cancel(handle) {
    if (handle !== null) clock.clearTimeout(handle);
    return null;
  }

  function cancelAll() {
    startTimer = cancel(startTimer);
    wordsTimer = cancel(wordsTimer);
    retryTimer = cancel(retryTimer);
  }

  function clearCounts() {
    failures = 0;
    down = false;
    ends = [];
  }

  /**
   * @param {HearingStatus} status
   * @param {boolean} [listenAgain]
   */
  function set(status, listenAgain = OFFERS.has(status)) {
    if (hearing.status === status && hearing.listenAgain === listenAgain) return;
    hearing = hearingOf(status, listenAgain);
    tell(hearing);
  }

  /** stopped, or a final status: nothing is restarted, retried or cleared by text */
  const halted = () => hearing.status === 'stopped' || FINAL.has(hearing.status);

  /** Begin the checks afresh from ok, with the wait for the start event running. */
  function begin() {
    cancelAll();
    clearCounts();
    countingWords = false;
    hadText = false;
    set('ok');
    startTimer = clock.setTimeout(() => {
      startTimer = null;
      // It keeps waiting: nothing is aborted and nothing is started again (D-88).
      if (hearing.status === 'ok') set('waiting-for-permission');
    }, startWaitSec);
  }

  return {
    current: () => hearing,

    asked() {
      if (disposed) return;
      begin();
    },

    noRecognition() {
      if (disposed) return;
      cancelAll();
      clearCounts();
      set('no-recognition');
    },

    started() {
      if (disposed || halted()) return;
      startTimer = cancel(startTimer);
      if (hearing.status === 'waiting-for-permission') set('ok');
      if (countingWords || hadText) return;
      // 8 s of a running take since recognition first started; a restart inside
      // them does not start the count again (D-88).
      countingWords = true;
      wordsTimer = clock.setTimeout(() => {
        wordsTimer = null;
        if (hearing.status === 'ok') set('no-words');
      }, noWordsSec);
    },

    gotText() {
      if (disposed || halted()) return;
      hadText = true;
      cancelAll();
      clearCounts();
      set('ok');
    },

    failed(code) {
      if (disposed || halted()) return;
      if (typeof code !== 'string' || !hasOwn(HEARING_ERRORS, code)) return;
      const status = HEARING_ERRORS[code];
      if (status !== 'offline') {
        cancelAll();
        clearCounts();
        set(status);
        return;
      }
      failures += 1;
      down = true;
      retryTimer = cancel(retryTimer);
      if (failures > offlineRetrySec.length) {
        // The retries are used up: stop retrying and offer Listen again.
        set('offline', true);
        return;
      }
      set('offline', false);
      retryTimer = clock.setTimeout(() => {
        retryTimer = null;
        down = false;
        startAgain();
      }, offlineRetrySec[failures - 1]);
    },

    ended() {
      if (disposed || halted() || hearing.status === 'restarting') return false;
      // The end of a run that failed on the network: the retry starts it again, not this end.
      if (down) return false;
      const now = clock.now();
      ends = ends.filter((at) => now - at < restartBurst.windowSec);
      ends.push(now);
      if (ends.length > restartBurst.count) {
        set('restarting');
        return false;
      }
      return true;
    },

    personStopped() {
      if (disposed) return;
      cancelAll();
      clearCounts();
      set('stopped');
    },

    listenAgain() {
      if (disposed || !hearing.listenAgain) return;
      begin();
      startAgain();
    },

    online() {
      if (disposed || hearing.status !== 'offline' || !down) return;
      retryTimer = cancel(retryTimer);
      down = false;
      startAgain();
    },

    dispose() {
      cancelAll();
      disposed = true;
    },
  };
}
