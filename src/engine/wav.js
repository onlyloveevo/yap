// PCM16 WAV parse, encode and slice on Uint8Array. Browser-safe: no `node:` imports.

/** Error thrown for a malformed or unsupported WAV file. */
export class WavFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'WavFormatError';
  }
}

/**
 * @param {DataView} view
 * @param {number} at
 * @returns {string}
 */
function fourcc(view, at) {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

/**
 * Parse a PCM16 RIFF/WAVE file. Unknown chunks are skipped; every chunk size is
 * bounds-checked against the buffer so a malformed header throws instead of reading past the end.
 * @param {Uint8Array} bytes
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, samples: Int16Array }} samples are interleaved
 */
export function parseWav(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new WavFormatError('parseWav expects a Uint8Array');
  if (bytes.length < 12) throw new WavFormatError('not a RIFF/WAVE file: too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourcc(view, 0) !== 'RIFF' || fourcc(view, 8) !== 'WAVE') throw new WavFormatError('not a RIFF/WAVE file');
  let fmt = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = fourcc(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (body + size > bytes.length) throw new WavFormatError(`chunk "${id}" claims ${size} bytes, past the end of the file`);
    if (id === 'fmt ') {
      if (size < 16) throw new WavFormatError('fmt chunk is too short');
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
      if (fmt.format !== 1 && fmt.format !== 0xfffe) throw new WavFormatError(`unsupported WAV format ${fmt.format}: expected 16-bit PCM`);
      if (fmt.bitsPerSample !== 16) throw new WavFormatError(`expected 16-bit PCM, got ${fmt.bitsPerSample}-bit`);
      if (fmt.channels < 1) throw new WavFormatError('fmt chunk has no channels');
      if (fmt.sampleRate < 1) throw new WavFormatError('fmt chunk has no sample rate');
    } else if (id === 'data') {
      if (!fmt) throw new WavFormatError('data chunk before fmt chunk');
      const count = Math.floor(size / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2, true);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, samples };
    }
    at = body + size + (size % 2); // chunks are word-aligned
  }
  throw new WavFormatError(fmt ? 'no data chunk' : 'no fmt chunk');
}

/**
 * Encode interleaved PCM16 samples as a standard 44-byte-header WAV file.
 * Float input is rounded and clipped to the int16 range.
 * @param {{ samples: Int16Array | Float32Array | number[], sampleRate: number, channels?: number }} input
 * @returns {Uint8Array}
 */
export function encodeWav({ samples, sampleRate, channels = 1 }) {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const view = new DataView(out.buffer);
  const put = (at, s) => { for (let i = 0; i < 4; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  put(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    view.setInt16(44 + i * 2, v, true);
  }
  return out;
}

/**
 * Average interleaved channels into one mono Float32Array (int16 scale, not normalised).
 * @param {{ samples: Int16Array, channels: number }} parsed
 * @returns {Float32Array}
 */
export function toMonoFloat({ samples, channels }) {
  const ch = Math.max(1, channels || 1);
  const frames = Math.floor(samples.length / ch);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) sum += samples[f * ch + c];
    out[f] = sum / ch;
  }
  return out;
}

/**
 * Concatenate whole-sample ranges [startSec, endSec] of a mono signal.
 * @template {Int16Array | Float32Array} T
 * @param {T} samples
 * @param {number} sampleRate
 * @param {Array<[number, number]>} ranges
 * @returns {T}
 */
export function sliceRanges(samples, sampleRate, ranges) {
  const bounds = ranges.map(([s, e]) => {
    const a = Math.max(0, Math.min(samples.length, Math.round(s * sampleRate)));
    const b = Math.max(a, Math.min(samples.length, Math.round(e * sampleRate)));
    return [a, b];
  });
  const total = bounds.reduce((n, [a, b]) => n + (b - a), 0);
  const Ctor = /** @type {any} */ (samples.constructor);
  const out = new Ctor(total);
  let at = 0;
  for (const [a, b] of bounds) {
    out.set(samples.subarray(a, b), at);
    at += b - a;
  }
  return out;
}
