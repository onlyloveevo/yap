// Talk to YAP dictates into a text box (D-112): the Ideas opening and the three
// idea screens after it share this one function.
//
// The words come from the same microphone transcript source the live take
// uses (src/engine/webspeech.js): Chrome's speech recognition, with the same
// restarts and the same lines for the ways it cannot hear (src/engine/hearing.js).
// Nothing here listens until the person presses the button, and nothing is
// sent anywhere: the words only go into the box, where the person can change
// them before they press Send.
//
// Heard words are written as the box's value, never as markup (threat T-02-07).
// In shell mode no microphone is asked for (ui/lib/app.js).
//
// The microphone: in a browser with getUserMedia, the press asks for the
// microphone itself and hands that audio track to the recogniser, as the live
// recorder does. Chrome's recogniser left on its default input can hear
// nothing while the page's own microphone is fine (a fake-device Chrome run
// returned only no-speech by default and real words with the track). The
// track is owned here: it is stopped on any stop, on a late answer after a
// stop, and when the page is hidden or unloaded. Only a browser that cannot
// give a stream (no getUserMedia, or NotSupportedError / TypeError) falls back
// to the recogniser's default microphone; a refusal never does.
import { createRealClock } from '../../src/engine/clock.js';
import { createWebSpeechSource } from '../../src/engine/webspeech.js';
import { HEARING_LINES } from '../../src/engine/hearing.js';
import { isShellMode, sayQuietly } from './app.js';

/**
 * The hearing statuses after which the source has stopped listening for good
 * (FINAL in src/engine/hearing.js, less the one for a browser with no speech
 * recognition, which never starts). The dictation is over when one arrives.
 */
const OVER = new Set(['mic-blocked', 'service-blocked', 'no-microphone']);

/**
 * Source errors after which the recogniser is dead and will not retry (webspeech.js:
 * start-failed from a refused native start, language-not-supported). The ones for a
 * blocked microphone or service arrive with their own hearing line and end the
 * dictation through OVER; network and no-speech are recoverable and keep listening.
 */
const DEAD_LINES = {
  'start-failed': 'Dictation could not start in this browser. You can type instead.',
  'language-not-supported': 'Dictation does not support this language here. You can type instead.',
};

/** The dictation running into each text box, so a second call for the same box stops it. */
const running = new WeakMap();

/**
 * Start dictating into a text box, or stop the dictation already running into
 * it: the first call starts, the next one stops, the one after starts again.
 *
 * While it runs, what the microphone source hears is written after the words
 * already in the box: early words as they come, then the final words in their
 * place. Each write fires an `input` event on the box, so the page's own script
 * sees it as typing. If the person types while YAP listens, their words are
 * kept as they are and what is heard next follows them. On a stop, the words
 * in the box stay.
 *
 * The microphone is asked for on the press, so `true` can mean YAP is still
 * waiting for the answer; a second call then cancels the wait. A refused or
 * missing microphone says the source's own line and leaves the button not
 * pressed.
 *
 * A way of not hearing is said in the source's own line (`say`), and taken
 * away again once words arrive or the person stops. A blocked microphone or
 * service ends the dictation: the line stays and the button is no longer
 * pressed. With no speech recognition in the browser, nothing starts and the
 * source's one line for that is said. In shell mode nothing happens at all.
 *
 * @param {{ value: string, dispatchEvent: (event: Event) => boolean }} box the text box (a textarea or an input)
 * @param {object} [options]
 * @param {Element} [options.control] the button that was pressed: it gets aria-pressed "true" while YAP listens
 * @param {(line: string) => void} [options.say] shows one line, or takes it away when given ''; left out, sayQuietly on the page
 * @param {any} [options.scope] the window; left out, the page's own
 * @returns {boolean} true when YAP is now listening
 */
export function dictateInto(box, options = {}) {
  const scope = options.scope || globalThis;
  const control = options.control || null;
  const say = typeof options.say === 'function' ? options.say : (line) => sayQuietly(scope.document, line);

  const current = running.get(box);
  if (current) {
    current.stop();
    return false;
  }
  if (isShellMode(scope.location)) return false;

  const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  const makeSource = (audioTrack) => createWebSpeechSource({
    SpeechRecognition: Recognition,
    audioTrack,
    clock: createRealClock(),
    // Where the browser's `online` event is heard, for the retry after a lost connection.
    onlineTarget: scope,
  });
  const idle = makeSource();
  if (!idle.supported) {
    // No speech recognition here: the source says so itself, in its one hearing event.
    idle.start((event) => {
      if (event.type === 'hearing' && event.hearing.line) say(event.hearing.line);
    });
    return false;
  }
  const devices = scope.navigator && scope.navigator.mediaDevices;
  const direct = Boolean(devices) && typeof devices.getUserMedia === 'function';

  /** What was in the box before YAP listened, the final words heard since, and the early words not yet final. */
  let base = box.value;
  let heard = [];
  let early = '';
  /** The value this dictation last wrote: a box that holds anything else was typed in. */
  let shown = box.value;
  /** Is one of the source's lines showing? */
  let said = false;
  let over = false;
  /** The source once the microphone is settled, and the stream this dictation owns. */
  let source = null;
  let stream = null;

  const pressed = (on) => {
    if (control) control.setAttribute('aria-pressed', String(on));
  };

  /** The person typed while YAP listened: their words become the start, and what is heard next follows them. */
  function keepTyping() {
    if (box.value === shown) return;
    base = box.value;
    heard = [];
    early = '';
  }

  function write() {
    const words = [heard.join(' '), early].filter(Boolean).join(' ');
    const gap = base && words && !/\s$/.test(base) ? ' ' : '';
    const value = `${base}${gap}${words}`;
    shown = value;
    if (box.value === value) return;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function releaseStream() {
    const owned = stream;
    stream = null;
    if (owned) owned.getTracks().forEach((track) => track.stop());
  }

  const onHide = () => finish();

  /** The one way a dictation ends; safe to reach twice. The owned tracks are released even if the source's stop throws. */
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    over = true;
    running.delete(box);
    pressed(false);
    try {
      if (source) source.stop();
    } catch {
      // The source is finished with either way; the microphone is released below.
    } finally {
      releaseStream();
      if (typeof scope.removeEventListener === 'function') scope.removeEventListener('pagehide', onHide);
    }
  }

  /** The dictation cannot go on: its line stays and it is over. */
  function failWith(line) {
    say(line);
    said = true;
    finish();
  }

  /** The microphone is refused or missing: the source's own line stays, and the dictation is over. */
  function fail(status) {
    failWith(HEARING_LINES[status]);
  }

  running.set(box, {
    stop() {
      if (said) say('');
      finish();
    },
  });
  pressed(true);
  if (typeof scope.addEventListener === 'function') scope.addEventListener('pagehide', onHide);

  function listen(audioTrack) {
    if (over) return;
    try {
      source = audioTrack ? makeSource(audioTrack) : idle;
      source.start(onEvent);
    } catch {
      failWith(DEAD_LINES['start-failed']);
    }
  }

  function onEvent(event) {
    if (over) return;
    if (event.type === 'error') {
      if (DEAD_LINES[event.error]) failWith(DEAD_LINES[event.error]);
    } else if (event.type === 'results') {
      // One of Chrome's result events begins: its early words replace the last event's.
      keepTyping();
      early = '';
      write();
    } else if (event.type === 'word') {
      keepTyping();
      heard.push(String(event.word.text));
      write();
    } else if (event.type === 'interim') {
      keepTyping();
      early = String(event.text);
      write();
    } else if (event.type === 'hearing') {
      const { status, line } = event.hearing;
      if (line) {
        say(line);
        said = true;
      } else if (said) {
        say('');
        said = false;
      }
      if (OVER.has(status) || status === 'stopped') finish();
    }
  }

  if (!direct) {
    listen(null);
    return true;
  }
  let asked;
  try {
    asked = Promise.resolve(devices.getUserMedia({ audio: true }));
  } catch (err) {
    asked = Promise.reject(err);
  }
  asked.then((got) => {
    if (over) {
      // Stopped while the browser was asking: the late stream is never used.
      got.getTracks().forEach((track) => track.stop());
      return;
    }
    const audioTrack = got.getAudioTracks()[0];
    if (!audioTrack) {
      got.getTracks().forEach((track) => track.stop());
      fail('no-microphone');
      return;
    }
    stream = got;
    listen(audioTrack);
  }, (err) => {
    if (over) return;
    const name = err && err.name;
    if (name === 'NotSupportedError' || name === 'TypeError') listen(null);
    else fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'mic-blocked' : 'no-microphone');
  });
  return true;
}
