// The coach that watches and listens (L25). The face coach watches the person's own camera picture for a smile and
// raises the Smile cue when there has not been one for a while. A smile clears it.
//
//   import { startFaceCoach } from '../lib/face-coach.js';
//   const coach = await startFaceCoach(videoElement, { onCue: ({ id, show }) => { ... } });
//   coach.stop();
//
// `onCue` is called with `{ id: 'smile', show: true }` when the cue should appear and `{ id: 'smile', show: false }`
// when it should go. The picture is read on this Mac by the face model in ui/lib/face/ (MediaPipe face landmarker,
// credited in NOTICE): no frame leaves the page and nothing is fetched from another address. When the model cannot
// load, `stop()` does nothing and the cue never shows.
//
// When to show is the engine's rule (createSmileWatch in src/engine/delivery.js). This module only reads the camera.
//
// The same for the voice, with the same shape:
//
//   const pace = await startPaceCoach(mediaStream, { onCue: ({ id, show }) => { ... } });
//   pace.stop();
//
// `onCue` is called with `{ id: 'slow-down', show }`. The pace is counted from the loudness of the microphone on this
// Mac (createVoicePace in src/engine/pace.js): no speech service is used, so it works with no network and whether or
// not the browser's recogniser has returned a word yet.
import { createSmileWatch } from '../../src/engine/delivery.js';
import { createVoicePace } from '../../src/engine/pace.js';

const FACE_DIR = new URL('./face/', import.meta.url);
const at = (name) => new URL(name, FACE_DIR).href;
/** How often a frame is read, in milliseconds. A read takes about 10 ms. */
const EVERY_MS = 200;
const SMILE_SHAPES = ['mouthSmileLeft', 'mouthSmileRight'];

/** @type {Promise<any> | null} the loaded model, shared by every coach on this page */
let loading = null;

/**
 * The model's runtime writes its start-up notice ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") through
 * console.error. It is a notice, not a fault: it is kept out of the console, and every other line is passed on.
 */
let noticeQuieted = false;
function quietRuntimeNotice() {
  if (noticeQuieted || typeof console === 'undefined') return;
  noticeQuieted = true;
  const error = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && /^INFO: Created TensorFlow Lite XNNPACK delegate/.test(args[0])) return;
    error.apply(console, args);
  };
}

function loadLandmarker() {
  if (!loading) {
    quietRuntimeNotice();
    loading = import(at('vision_bundle.js')).then(({ FaceLandmarker }) => FaceLandmarker.createFromOptions(
      { wasmLoaderPath: at('vision_wasm_internal.js'), wasmBinaryPath: at('vision_wasm_internal.wasm') },
      { baseOptions: { modelAssetPath: at('face_landmarker.task'), delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true },
    ));
    // A failed load is not kept: the next start tries again.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** The smile score of one result: the mean of the two mouth corners, or null with no face in view. */
function smileScore(result) {
  const shapes = result && result.faceBlendshapes && result.faceBlendshapes[0] ? result.faceBlendshapes[0].categories : null;
  if (!shapes) return null;
  let sum = 0;
  for (const name of SMILE_SHAPES) {
    const shape = shapes.find((each) => each.categoryName === name);
    if (!shape) return null;
    sum += shape.score;
  }
  return sum / SMILE_SHAPES.length;
}

/**
 * @param {HTMLVideoElement} videoElement the camera picture the person sees
 * @param {{ onCue?: (cue: { id: 'smile', show: boolean }) => void, settings?: object }} [options]
 *   `settings` overrides the engine's SMILE_DEFAULTS
 * @returns {Promise<{ stop(): void }>}
 */
export async function startFaceCoach(videoElement, { onCue, settings } = {}) {
  const idle = { stop() {} };
  let landmarker;
  try {
    landmarker = await loadLandmarker();
  } catch {
    return idle;
  }
  const watch = createSmileWatch(settings);
  const say = (show) => { if (typeof onCue === 'function') onCue({ id: 'smile', show }); };
  let stamp = 0;
  const timer = setInterval(() => {
    if (!videoElement.videoWidth || videoElement.readyState < 2) return;
    const now = performance.now();
    // The model wants each frame's time to be later than the last.
    stamp = Math.max(stamp + 1, now);
    let score = null;
    try {
      score = smileScore(landmarker.detectForVideo(videoElement, stamp));
    } catch {
      return;
    }
    const answer = watch.sample(score, now / 1000);
    if (answer.changed) say(answer.show);
  }, EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      if (watch.showing()) say(false);
    },
  };
}

/** How often the loudness is read, in milliseconds: about once a screen frame, as the pace rule was measured. */
const LOUDNESS_EVERY_MS = 16;

/**
 * @param {MediaStream} stream a stream with the person's microphone in it
 * @param {{ onCue?: (cue: { id: 'slow-down', show: boolean }) => void, settings?: object }} [options]
 *   `settings` overrides the engine's pace settings (threshold, in words a minute, is the usual one)
 * @returns {Promise<{ stop(): void }>}
 */
export async function startPaceCoach(stream, { onCue, settings } = {}) {
  const idle = { stop() {} };
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context || !stream || stream.getAudioTracks().length === 0) return idle;
  let audio;
  let analyser;
  try {
    audio = new Context();
    analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
  } catch {
    return idle;
  }
  const samples = new Float32Array(analyser.fftSize);
  const pace = createVoicePace(settings);
  const say = (show) => { if (typeof onCue === 'function') onCue({ id: 'slow-down', show }); };
  // A browser may hold sound back until the first press or key.
  const wake = () => { if (audio.state === 'suspended') audio.resume().catch(() => {}); };
  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, wake);
  wake();
  let showing = false;
  const timer = setInterval(() => {
    if (audio.state !== 'running') return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const { show } = pace.sample(Math.sqrt(sum / samples.length), performance.now() / 1000);
    if (show !== showing) { showing = show; say(show); }
  }, LOUDNESS_EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, wake);
      audio.close().catch(() => {});
      if (showing) say(false);
    },
  };
}

