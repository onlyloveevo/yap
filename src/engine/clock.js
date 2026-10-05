// Take clocks. Every time in the engine is seconds from take start.
//
// A Clock has:
//   now()                      seconds since the take started
//   setTimeout(fn, seconds)    run fn after `seconds`; returns a handle
//   clearTimeout(handle)       cancel a pending timer (unknown handles are ignored)
//   isManual                   true for the manual (test / --fast) clock
// The manual clock adds advanceTo(seconds) and runUntilIdle(). It fires timers
// strictly in time order, ties in scheduling order, and now() jumps to each
// timer's time as it fires.

/**
 * @typedef {object} Clock
 * @property {() => number} now
 * @property {(fn: () => void, seconds: number) => unknown} setTimeout
 * @property {(handle: unknown) => void} clearTimeout
 * @property {boolean} isManual
 */

/**
 * @typedef {Clock & { advanceTo: (seconds: number) => void, runUntilIdle: () => void }} ManualClock
 */

/**
 * A clock that only moves when told to. Deterministic: used by tests and by
 * the replay command's --fast mode.
 * @param {number} [startAt=0] the time now() starts at, in seconds
 * @returns {ManualClock}
 */
export function createManualClock(startAt = 0) {
  let current = startAt;
  let seq = 0;
  /** @type {Map<number, {at: number, seq: number, fn: () => void}>} */
  const timers = new Map();

  function nextDue(limit) {
    let best = null;
    for (const t of timers.values()) {
      if (limit !== undefined && t.at > limit) continue;
      if (best === null || t.at < best.at || (t.at === best.at && t.seq < best.seq)) best = t;
    }
    return best;
  }

  function fire(t) {
    timers.delete(t.seq);
    if (t.at > current) current = t.at;
    t.fn();
  }

  return {
    isManual: true,
    now: () => current,
    setTimeout(fn, seconds) {
      if (typeof fn !== 'function') throw new TypeError('setTimeout needs a function');
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      seq += 1;
      timers.set(seq, { at: current + delay, seq, fn });
      return seq;
    },
    clearTimeout(handle) {
      timers.delete(/** @type {number} */ (handle));
    },
    advanceTo(seconds) {
      if (!Number.isFinite(seconds)) throw new TypeError('advanceTo needs a number of seconds');
      for (let t = nextDue(seconds); t !== null; t = nextDue(seconds)) fire(t);
      if (seconds > current) current = seconds;
    },
    runUntilIdle() {
      for (let t = nextDue(); t !== null; t = nextDue()) fire(t);
    },
  };
}

/**
 * A clock on wall time, for real-speed replay and the live take.
 * now() = (performance.now() - t0) / 1000.
 * @returns {Clock}
 */
export function createRealClock() {
  const t0 = performance.now();
  return {
    isManual: false,
    now: () => (performance.now() - t0) / 1000,
    setTimeout(fn, seconds) {
      if (typeof fn !== 'function') throw new TypeError('setTimeout needs a function');
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      return globalThis.setTimeout(fn, delay * 1000);
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(/** @type {any} */ (handle));
    },
  };
}
