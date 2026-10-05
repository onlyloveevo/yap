// Ported from jlecomte/voice-activated-teleprompter src/lib/speech-recognizer.ts (commit cd222c8), MIT. Copyright (c) 2024 - Present, Julien Lecomte - All Rights Reserved. See NOTICE.
//
// What is ported (TypeScript to plain JavaScript): the recogniser set-up
// (lang, continuous results, interim results), the walk over results from
// resultIndex splitting final from interim text, and the automatic restart when
// Chrome ends recognition while we still want to listen. YAP's own additions:
// the injected constructor (feature detection happens in the caller), word
// timestamps, pause markers, error events, the stop guarantee, (Phase 1.1,
// WAKE-02) the session, results and stopped events with each final word's
// place in its result, and (WAKE-05) the hearing status, with the restart now
// decided by hearing.js in place of the unconditional one.
//
// MIT License
//
// Copyright (c) 2024 - Present, Julien Lecomte - All Rights Reserved
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Network: recognition audio goes to Chrome's own speech service. That is one of
// the network calls D-31 allows; this module adds none of its own.

import { createHearing } from './hearing.js';
import { WAKE_SETTINGS } from './wake-settings.js';

/** Errors after which listening stops: the microphone or the service is refused or missing. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

/** A clock that never runs anything, for a source with no recogniser and no clock: it only says so. */
const IDLE_CLOCK = Object.freeze({ now: () => 0, setTimeout: () => null, clearTimeout: () => {}, isManual: false });

/**
 * The live transcript from Chrome's microphone recognition (D-06), emitting the
 * same source events as the sample replay (replay.js): {type:'word', word},
 * {type:'pause', at}, plus {type:'interim', text} and {type:'error', error} for
 * display. The live take passes interim text on and ignores error events.
 *
 * Chrome's results, early and final (WAKE-02, D-77): the source also sends
 *   {type:'session', session, at}   recognition started or started again;
 *                                   `session` counts from 1
 *   {type:'results', session, resultIndex, length, results:[{index, text, final}], at}
 *                                   one per Chrome result event, before that
 *                                   event's words: every live result from
 *                                   resultIndex up to length, text as Chrome gave it
 *   {type:'stopped', at}            the caller's stop(); the source's last event
 * and each final word carries `session`, `index` (its result) and `pos` (its
 * place among that result's words). A result that arrives with no start event
 * before it begins a session itself, so every results event has a session.
 *
 * The recogniser is never asked to favour a phrase and never switched to
 * on-device recognition (WAKE-03, D-83): Chrome refuses the first and the
 * session then returns no text.
 *
 * How well YAP can hear (WAKE-05; D-87, D-88): the source also sends
 *   {type:'hearing', hearing:{status, line, listenAgain}}
 * each time the hearing changes; the take passes it on and keeps the latest in
 * state().hearing. hearing.js decides the status and whether Chrome's end
 * event starts recognition again; this source owns the recogniser. `no-speech`
 * and `aborted` restart at once; a blocked microphone or service does not
 * restart; a network failure is retried after 2 s, 5 s and 10 s and on the
 * page's `online` event; more than 5 ends in 10 s with no text stops the
 * restarting until listenAgain(). A source with no recogniser sends the one
 * no-recognition status from start(push) and nothing else. stop() sends the
 * `stopped` status just before the `stopped` event, and nothing restarts or
 * retries after it.
 *
 * Timestamps: Web Speech gives no time per word. Each final result's words end
 * at the take-clock time the result arrives: the last word ends then, earlier
 * words are spaced back by wordSpacingSec. If that would place a word before the
 * previous final result's end (or before listening started), the spacing
 * shrinks so every word lands after it. These are estimates for display and the
 * live rules; the rough cut takes its word times from the recording.
 *
 * A pause marker at the result's time follows each final result: it records
 * where Chrome ended an utterance. The live take still closes an exchange only
 * on its own silence timer, a key release or the end event.
 *
 * @param {object} options
 * @param {any} [options.SpeechRecognition]  constructor; in Chrome pass
 *   window.SpeechRecognition || window.webkitSpeechRecognition. Missing: supported false.
 * @param {import('./clock.js').Clock} options.clock  the take clock
 * @param {MediaStreamTrack} [options.audioTrack] consented recorder microphone; must be live audio.
 *   Unsupported overloads fall back to the browser microphone and emit input-fallback.
 * @param {string} [options.lang='en-US']
 * @param {number} [options.wordSpacingSec=0.3]
 * @param {Partial<import('./wake-settings.js').WakeSettings>} [options.settings]  the hearing
 *   numbers (startWaitSec, noWordsSec, offlineRetrySec, restartBurst); WAKE_SETTINGS by default
 * @param {(text: string, before?: string) => string} [options.rewrite]  the take's own reading of each
 *   result's text before it is sent on (the person's wake word, wake-settings.js); `before` is the
 *   last word of the result before it
 * @param {{ addEventListener: Function, removeEventListener: Function }} [options.onlineTarget]
 *   where the browser's `online` event is heard (the page passes its global object); the
 *   listener is added on start and removed on stop. With none given, nothing is listened for.
 * @returns {{ supported: boolean, start: (push: (event: import('./replay.js').SourceEvent) => void) => void, stop: () => void, listenAgain: () => void }}
 *   listenAgain() is the person asking to listen again; it acts only when the hearing offers it
 */
export function createWebSpeechSource({
  SpeechRecognition,
  audioTrack,
  clock,
  lang = 'en-US',
  wordSpacingSec = 0.3,
  settings = WAKE_SETTINGS,
  onlineTarget,
  rewrite = null,
} = /** @type {any} */ ({})) {
  const supported = typeof SpeechRecognition === 'function';
  if (supported && !clock) throw new TypeError('createWebSpeechSource needs a clock');
  if (!Number.isFinite(wordSpacingSec) || wordSpacingSec <= 0) throw new RangeError('wordSpacingSec must be a number above 0');

  /** @type {any} */
  let recognizer = null;
  /** @type {((event: import('./replay.js').SourceEvent) => void) | null} */
  let push = null;
  let shouldListen = false;
  let lastFinalEnd = 0;
  /** recognition sessions so far; the current one's number once it is announced */
  let session = 0;
  /** has the current run of the recogniser been announced as a session? */
  let announced = false;
  /** is the `online` listener on its target? */
  let hearingOnline = false;
  let legacyInput = false;

  /**
   * How well YAP can hear (WAKE-05). It decides; this source owns the recogniser.
   * A hearing event is sent whenever a push function is held, also once listening
   * has stopped for a blocked microphone: that is when the line matters.
   */
  const hearing = createHearing({
    clock: clock || IDLE_CLOCK,
    settings,
    onChange: (h) => {
      if (push) push(/** @type {any} */ ({ type: 'hearing', hearing: h }));
    },
    // An offline retry, the online event or a Listen again call: never after the person's stop.
    restart: () => {
      if (!push || recognizer === null) return;
      shouldListen = true;
      listen();
    },
  });

  const onOnline = () => hearing.online();

  /** @param {any} event  a source event (replay.js SourceEvent, or session, results, stopped) */
  function emit(event) {
    if (shouldListen && push) push(event);
  }

  /** Recognition is running: Chrome said so, or a result arrived without its saying so. */
  function announceSession() {
    session += 1;
    announced = true;
    emit({ type: 'session', session, at: clock.now() });
    hearing.started();
  }

  /**
   * @param {{ text: string, index: number, pos: number }[]} finals  the words of this event's final results, in order
   * @param {number} at
   */
  function emitFinal(finals, at) {
    if (finals.length === 0) return;
    const room = at - lastFinalEnd;
    const spacing = room > 0 ? Math.min(wordSpacingSec, room / finals.length) : 0;
    finals.forEach(({ text, index, pos }, i) => {
      const end = at - (finals.length - 1 - i) * spacing;
      emit({ type: 'word', word: { text, start: Math.max(lastFinalEnd, end - spacing), end, final: true, session, index, pos } });
    });
    if (at > lastFinalEnd) lastFinalEnd = at;
    emit({ type: 'pause', at });
  }

  function listen() {
    // Check every attempt: a device may end while recognition is restarting.
    // Invalid/ended input must never silently select a different microphone.
    if (audioTrack != null && (audioTrack.kind !== 'audio' || audioTrack.readyState !== 'live')) {
      emit({ type: 'error', error: 'audio-capture' });
      hearing.failed('audio-capture');
      shouldListen = false;
      return;
    }
    try {
      if (audioTrack != null && !legacyInput) {
        try {
          recognizer.start(audioTrack);
        } catch (err) {
          // Legacy bindings may reject the optional track overload. Only these
          // synchronous capability errors permit fallback; permissions, ended
          // tracks and service failures never select another input.
          if (!err || !['NotSupportedError', 'TypeError'].includes(err.name)) throw err;
          legacyInput = true;
          emit({ type: 'input-fallback', input: 'default-microphone', reason: err.name });
          recognizer.start();
        }
      } else recognizer.start();
    } catch (err) {
      // A validated live track leaves InvalidStateError as the existing
      // already-running case. Never issue a duplicate legacy start for it.
      if (err && err.name === 'InvalidStateError') return;
      const error = ({ NotAllowedError: 'not-allowed', SecurityError: 'not-allowed',
        NotReadableError: 'audio-capture', NetworkError: 'network' })[err?.name] || 'start-failed';
      emit({ type: 'error', error });
      if (error === 'start-failed') hearing.personStopped();
      else hearing.failed(error);
      shouldListen = false;
    }
  }

  function build() {
    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;

    r.onstart = () => {
      if (!shouldListen || announced) return;
      announceSession();
    };

    r.onresult = (/** @type {any} */ e) => {
      if (!shouldListen) return;
      if (!announced) announceSession();
      /** @type {{ index: number, text: string, final: boolean }[]} */
      const results = [];
      /** @type {{ text: string, index: number, pos: number }[]} */
      const finals = [];
      let interimTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        const result = e.results[i];
        const heard = String(result[0].transcript);
        const transcript = rewrite ? rewrite(heard, i > 0 ? String(e.results[i - 1][0].transcript).trim().split(/\s+/).pop() : '') : heard;
        const final = Boolean(result.isFinal);
        results.push({ index: i, text: transcript, final });
        if (final) transcript.split(/\s+/).filter(Boolean).forEach((text, pos) => finals.push({ text, index: i, pos }));
        else interimTranscript += transcript;
      }
      const at = clock.now();
      // The first text of any kind, early or final, returns the hearing to ok (D-87),
      // and says so before the text itself is sent.
      if (results.some((result) => result.text.trim() !== '')) hearing.gotText();
      emit({ type: 'results', session, resultIndex: e.resultIndex, length: e.results.length, results, at });
      emitFinal(finals, at);
      if (interimTranscript.trim()) emit({ type: 'interim', text: interimTranscript.trim() });
    };

    r.onerror = (/** @type {any} */ e) => {
      const error = String((e && e.error) || 'unknown');
      emit({ type: 'error', error });
      hearing.failed(error);
      if (FATAL_ERRORS.has(error)) stopListening();
    };

    r.onend = () => {
      announced = false;
      // hearing.js decides whether this end starts recognition again (D-87, D-88).
      if (shouldListen && hearing.ended()) listen();
    };
    return r;
  }

  function stopListening() {
    if (!shouldListen) return;
    shouldListen = false;
    if (recognizer) recognizer.stop();
  }

  return {
    supported,
    start(fn) {
      if (typeof fn !== 'function') throw new TypeError('start needs a push function');
      if (!supported) {
        // No speech recognition in this browser: say so, once per start, and nothing else (D-88).
        hearing.noRecognition();
        fn(/** @type {any} */ ({ type: 'hearing', hearing: hearing.current() }));
        return;
      }
      if (shouldListen) throw new Error('web speech source already listening');
      push = fn;
      if (recognizer === null) recognizer = build();
      lastFinalEnd = Math.max(lastFinalEnd, clock.now());
      shouldListen = true;
      announced = false;
      if (onlineTarget && !hearingOnline) {
        onlineTarget.addEventListener('online', onOnline);
        hearingOnline = true;
      }
      hearing.asked();
      listen();
    },
    stop() {
      // The stopped status goes out first, and cancels every pending retry and wait (D-87).
      if (push) hearing.personStopped();
      stopListening();
      if (onlineTarget && hearingOnline) {
        onlineTarget.removeEventListener('online', onOnline);
        hearingOnline = false;
      }
      // The person's stop reaches the take as the source's last event (D-81).
      if (push) push({ type: 'stopped', at: clock.now() });
      push = null;
    },
    // Release the native recognizer's audio boundary, not the recorder track.
    // stop() asks Chrome to finalize audio already collected. Its normal onend
    // restart opens a new session, so later speech cannot join this held turn.
    // Unlike source.stop(), this deliberately keeps final-result delivery alive.
    finishHeldUtterance() {
      if (!shouldListen || !recognizer || !announced) return false;
      const closingSession=session;
      try { recognizer.stop(); }
      catch { return false; } // unsealed engine custody remains conservative
      emit({type:'held-audio-end',session:closingSession,at:clock.now()});
      return true;
    },
    listenAgain() {
      if (push) hearing.listenAgain();
    },
  };
}
