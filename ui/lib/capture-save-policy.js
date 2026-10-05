// What Stop does with a finished capture. Pure: no DOM, no network, no decoding.
// Above the former 128 MiB upload cap the whole recording is decoded in memory several times over, and the 90 s
// alignment timeout cannot cancel that work, so such a take is saved complete and uncut. Live recognition times are
// provisional and are never used for cuts.
export const LARGE_CAPTURE_BYTES = 128 * 1024 * 1024;
export const LARGE_CAPTURE_NOTE = 'This recording is large, so automatic speech timing was not run. The complete recording is saved uncut.';

export const isLargeCapture = (capture) => Number.isFinite(capture?.blob?.size) && capture.blob.size > LARGE_CAPTURE_BYTES;

// sample: no capture (the bundled sample, its own audio) · empty: nothing recognised · align: decode + Whisper · uncut-large: save uncut
export function captureSavePlan({ capture = null, words = [] } = {}) {
  if (!capture) return 'sample';
  if (!words.length) return 'empty';
  return isLargeCapture(capture) ? 'uncut-large' : 'align';
}

// A failed upload whose answer never arrived, arrived without the saved video, or came from a failing server or gateway (5xx) may
// still have been published. A 4xx is a refusal.
export const uploadUncertain = (error) => error?.status === 0 || (error?.status >= 200 && error.status < 300) || error?.status >= 500;

// Labels for a failed Stop. The recording's bytes and the take's details are saved by two separate requests.
export function saveFailureView({ mediaAcked = false, uploadUncertain: uncertain = false } = {}) {
  if (mediaAcked) return { label: 'Recording saved · take not finished', tail: ' Your recording is already saved; press Stop to finish the take.' };
  if (uncertain) return { label: 'Save not confirmed', tail: '' };
  return { label: 'Take not saved', tail: '' };
}
