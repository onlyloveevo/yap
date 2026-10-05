// Island-by-island transcription (D-19: short windows, never one whole-file pass when the take has a
// silence) and an adapter from a transformers.js Whisper pipeline to the transcriber interface.
// The pipeline is injected, so no package is loaded here. Browser-safe: no `node:` imports.

/**
 * @typedef {[number, number]} Span
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {(samples: Float32Array, opts: { sampleRate: number }) => Promise<Word[]> | Word[]} Transcriber
 */

/** Whisper models expect 16 kHz mono audio in [-1, 1]. */
export const WHISPER_RATE = 16000;

/**
 * The speech between silences; islands shorter than minIsland are dropped.
 * @param {Span[]} silences
 * @param {number} duration
 * @param {{ minIsland?: number }} [opts]
 * @returns {Span[]}
 */
export function islandsBetween(silences, duration, { minIsland = 0.12 } = {}) {
  const sorted = (silences || []).filter((p) => p[1] > p[0]).map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]);
  /** @type {Span[]} */
  const out = [];
  let prev = 0;
  for (const [s, e] of sorted) {
    if (s - prev >= minIsland) out.push([prev, s]);
    prev = Math.max(prev, e);
  }
  if (duration - prev >= minIsland) out.push([prev, duration]);
  return out;
}

/**
 * Transcribe a take one island at a time, awaiting each before the next, and return word times on the
 * take's clock. With no silence the whole signal is the only island.
 * @param {{ samples: Float32Array, sampleRate: number, silences: Span[], transcriber: Transcriber, minIsland?: number }} input
 * @returns {Promise<Word[]>}
 */
export async function transcribeByIslands({ samples, sampleRate, silences, transcriber, minIsland = 0.12 }) {
  const duration = samples.length / sampleRate;
  const islands = silences && silences.length ? islandsBetween(silences, duration, { minIsland }) : [[0, duration]];
  /** @type {Word[]} */
  const words = [];
  for (const [s, e] of islands) {
    const a = Math.max(0, Math.round(s * sampleRate));
    const b = Math.min(samples.length, Math.round(e * sampleRate));
    let got;
    try {
      got = await transcriber(samples.slice(a, b), { sampleRate });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`transcription failed for island ${s.toFixed(2)}-${e.toFixed(2)} s: ${reason}`, { cause: err });
    }
    for (const w of got || []) {
      if (!w || !String(w.text).trim()) continue;
      words.push({ text: String(w.text).trim(), start: s + Number(w.start), end: s + Number(w.end) });
    }
  }
  return words;
}

/**
 * Mono audio as Whisper wants it: 16 kHz (linear resampling) and scaled to [-1, 1]
 * (int16-scale input, any |x| > 1, is divided by 32768).
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function toWhisperAudio(samples, sampleRate) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > peak) peak = v; }
  const scale = peak > 1 ? 1 / 32768 : 1;
  if (sampleRate === WHISPER_RATE) {
    if (scale === 1 && samples instanceof Float32Array) return samples;
    return Float32Array.from(samples, (v) => v * scale);
  }
  const n = Math.round((samples.length * WHISPER_RATE) / sampleRate);
  const out = new Float32Array(n);
  const step = sampleRate / WHISPER_RATE;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const i0 = Math.min(samples.length - 1, Math.floor(pos));
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = (samples[i0] * (1 - frac) + samples[i1] * frac) * scale;
  }
  return out;
}

/**
 * Adapt a transformers.js automatic-speech-recognition pipeline (Apache-2.0, injected; not installed in
 * Phase 1) to the transcriber interface. Chunks come back as { text, timestamp: [start, end] }; a null
 * end takes the next chunk's start, or the island's end for the last chunk.
 * @param {{ pipeline: (audio: Float32Array, options: object) => Promise<{ text?: string, chunks?: Array<{ text: string, timestamp: [number | null, number | null] }> }>,
 *   options?: object }} input  extra options are passed through to the pipeline
 * @returns {Transcriber}
 */
export function createWhisperTranscriber({ pipeline, options = {} }) {
  if (typeof pipeline !== 'function') throw new TypeError('createWhisperTranscriber needs a pipeline function');
  return async (samples, { sampleRate = WHISPER_RATE } = { sampleRate: WHISPER_RATE }) => {
    const audio = toWhisperAudio(samples, sampleRate);
    const islandEnd = audio.length / WHISPER_RATE;
    const out = await pipeline(audio, { ...options, return_timestamps: 'word' });
    const chunks = (out && out.chunks) || [];
    /** @type {Word[]} */
    const words = [];
    chunks.forEach((chunk, k) => {
      const text = String(chunk.text || '').trim();
      if (!text) return;
      const [rawStart, rawEnd] = chunk.timestamp || [null, null];
      const start = rawStart ?? (words.length ? words[words.length - 1].end : 0);
      const next = chunks.slice(k + 1).find((c) => c.timestamp && c.timestamp[0] != null);
      const end = rawEnd ?? (next ? next.timestamp[0] : islandEnd);
      words.push({ text, start, end });
    });
    return words;
  };
}
