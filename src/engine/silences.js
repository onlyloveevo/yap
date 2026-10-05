// Silence finder: a JavaScript port of pauses() in the seat's spike
// (spikes/s3_loop/detect_retakes.round1_clean.py). Browser-safe: no `node:` imports.

/** Defaults are the spike's SETTINGS values for these keys. */
export const SILENCE_DEFAULTS = Object.freeze({ rms_window: 0.02, rms_floor: 1e-12, quiet_db: -38, min_silence: 0.12 });

/**
 * Find quiet spans the way the spike's pauses() does: mono mix, 20 ms moving mean of x²
 * aligned like numpy convolve mode "same", quiet where the RMS sits more than 38 dB under the peak,
 * runs of at least min_silence kept. End indices are exclusive.
 * @param {ArrayLike<number>} samples interleaved samples (int16 scale)
 * @param {number} sampleRate
 * @param {{ channels?: number, rms_window?: number, rms_floor?: number, quiet_db?: number, min_silence?: number }} [opts]
 * @returns {{ silences: Array<[number, number]>, duration: number }}
 */
export function findSilences(samples, sampleRate, opts = {}) {
  const o = { ...SILENCE_DEFAULTS, ...opts };
  const ch = Math.max(1, opts.channels || 1);
  const n = Math.floor(samples.length / ch);
  const x = new Float64Array(n);
  if (ch === 1) for (let i = 0; i < n; i++) x[i] = samples[i];
  else for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) sum += samples[f * ch + c];
    x[f] = sum / ch;
  }
  const duration = n / sampleRate;
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (!peak) return { silences: [], duration };

  const w = Math.max(1, Math.trunc(sampleRate * o.rms_window));
  const left = Math.ceil((w - 1) / 2); // window covers i - left … i + right
  const right = Math.floor((w - 1) / 2);
  const sq = (i) => (i >= 0 && i < n ? x[i] * x[i] : 0);
  let sum = 0;
  for (let j = -left; j <= right; j++) sum += sq(j);

  const silences = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    let quiet = false;
    if (i < n) {
      const power = Math.max(0, sum) / w;
      quiet = 20 * Math.log10(Math.sqrt(power + o.rms_floor) / peak) < o.quiet_db;
      sum += sq(i + right + 1) - sq(i - left);
    }
    if (quiet && runStart < 0) runStart = i;
    else if (!quiet && runStart >= 0) {
      if ((i - runStart) / sampleRate >= o.min_silence) silences.push([runStart / sampleRate, i / sampleRate]);
      runStart = -1;
    }
  }
  return { silences, duration };
}
