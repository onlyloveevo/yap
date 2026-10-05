// One cue at a time (D-07). Take 2's memory cue holds its first memoryCueSec;
// otherwise the pace cue shows while it is offered, and once shown it stays at
// least minCueSec. This controller only stores cues: their text comes from
// memory.js and pace.js. Pure state machine: times are passed in (seconds of
// take time); no clock, no network. Browser-safe: imports nothing from `node:`.

/**
 * @typedef {'memory' | 'pace'} CueKind
 * @typedef {{ kind: CueKind, text: string, since: number }} Cue
 * @typedef {{ text: string, since: number, withdrawnAt: number | null }} Entry
 */

/** One setting each (D-35). */
export const CUE_DEFAULTS = Object.freeze({
  memoryCueSec: 8, // take 2's memory cue holds the first 8 s
  minCueSec: 3, // a pace cue, once shown, stays at least 3 s
});

const KINDS = Object.freeze(['memory', 'pace']);

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function checkTime(at, what) {
  if (!isFiniteNumber(at)) throw new TypeError(`${what}: time must be a finite number of seconds`);
}

/**
 * @param {{ memoryCueSec?: number, minCueSec?: number }} [settings]
 */
export function createCueController(settings = {}) {
  const s = settings || {};
  const memoryCueSec = isFiniteNumber(s.memoryCueSec) ? s.memoryCueSec : CUE_DEFAULTS.memoryCueSec;
  const minCueSec = isFiniteNumber(s.minCueSec) ? s.minCueSec : CUE_DEFAULTS.minCueSec;

  /** @type {{ memory: Entry | null, pace: Entry | null }} */
  const entries = { memory: null, pace: null };

  function memoryEnd() {
    const m = entries.memory;
    if (!m) return -Infinity;
    const end = m.since + memoryCueSec;
    return m.withdrawnAt === null ? end : Math.min(end, m.withdrawnAt);
  }

  function memoryActive(at) {
    const m = entries.memory;
    return Boolean(m) && at >= m.since && at < memoryEnd();
  }

  /** When the pace cue first shows, or null if it was withdrawn before it could. */
  function paceShowStart() {
    const p = entries.pace;
    if (!p) return null;
    const m = entries.memory;
    let start = p.since;
    if (m && p.since >= m.since && p.since < memoryEnd()) start = memoryEnd();
    if (p.withdrawnAt !== null && start >= p.withdrawnAt) return null;
    return start;
  }

  function paceVisibleUntil() {
    const p = entries.pace;
    const start = paceShowStart();
    if (!p || start === null) return -Infinity;
    if (p.withdrawnAt === null) return Infinity;
    return Math.max(p.withdrawnAt, start + minCueSec);
  }

  function paceVisible(at) {
    const start = paceShowStart();
    return start !== null && at >= start && at < paceVisibleUntil() && !memoryActive(at);
  }

  /** Whether the entry of `kind` is still standing (or still held) at `at`. */
  function alive(kind, at) {
    const e = entries[kind];
    if (!e) return false;
    if (kind === 'memory') return at < memoryEnd();
    return e.withdrawnAt === null || (paceShowStart() !== null && at < paceVisibleUntil());
  }

  return {
    /**
     * Offer a cue. Re-offering a kind that is still standing keeps its original `since`.
     * @param {{ kind: CueKind, text: string }} cue
     * @param {number} at
     */
    offer(cue, at) {
      if (!cue || !KINDS.includes(cue.kind)) {
        throw new TypeError(`offer: cue kind must be one of ${KINDS.join(', ')}`);
      }
      if (typeof cue.text !== 'string' || cue.text.length === 0) {
        throw new TypeError('offer: cue text must be a non-empty string');
      }
      checkTime(at, 'offer');
      const e = entries[cue.kind];
      if (e && alive(cue.kind, at)) {
        if (cue.kind === 'pace') e.withdrawnAt = null;
        return;
      }
      entries[cue.kind] = { text: cue.text, since: at, withdrawnAt: null };
    },

    /**
     * Withdraw the offer of a kind. A shown pace cue still stays its minimum time.
     * @param {CueKind} kind
     * @param {number} at
     */
    withdraw(kind, at) {
      if (!KINDS.includes(kind)) throw new TypeError(`withdraw: kind must be one of ${KINDS.join(', ')}`);
      checkTime(at, 'withdraw');
      const e = entries[kind];
      if (e && e.withdrawnAt === null) e.withdrawnAt = at;
    },

    /**
     * The one cue on screen at `at`, or null.
     * @param {number} at
     * @returns {Readonly<Cue> | null}
     */
    current(at) {
      checkTime(at, 'current');
      if (memoryActive(at)) {
        const m = /** @type {Entry} */ (entries.memory);
        return Object.freeze({ kind: 'memory', text: m.text, since: m.since });
      }
      if (paceVisible(at)) {
        const p = /** @type {Entry} */ (entries.pace);
        return Object.freeze({ kind: 'pace', text: p.text, since: p.since });
      }
      return null;
    },
  };
}
