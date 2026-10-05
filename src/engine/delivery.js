// The delivery cue stream (DELIV-01; D-38, D-44, D-45, D-46).
//
// STORY says what to talk about next; DELIVERY says how the person wanted to
// say it. They are two separate streams and never merge into one prompt
// stream (D-38): this module is the delivery side only. It reads Phase 1's
// pace measure and nothing else of the story side (not the story cue
// controller, the point follower, the swap or the live loop).
//
// Before recording, the person keeps 1 to 3 of six cues and may edit each
// wording (D-44). Live, one delivery cue shows at a time: the cue chosen for
// the current beat. Pace raises Slow down only when the person chose that cue
// (D-45).
//
// Pure state machine: every time is passed in (seconds of take time); no
// clock, no network, no model. Never mutates its inputs and hands out copies.
// Browser-safe: imports nothing from `node:`.
import { paceCue } from './pace.js';

/**
 * @typedef {'slow-down' | 'smile' | 'more-energy' | 'pause' | 'look-at-lens' | 'land-the-point'} DeliveryKind
 * @typedef {{ id: string, kind: DeliveryKind, text: string, beatId: string | null }} DeliveryCue
 * @typedef {{ kind: DeliveryKind, text?: string, beatId?: string | null }} DeliveryPick
 * @typedef {{ cues: DeliveryCue[] }} Delivery
 * @typedef {'beat' | 'pace'} DeliveryReason  why the cue now showing is showing
 * @typedef {{ cue: DeliveryCue | null, beatId: string | null, reason: DeliveryReason, at: number }} DeliveryChange
 * @typedef {{ cue: DeliveryCue, beatId: string | null, reason: DeliveryReason, from: number, to: number | null }} DeliverySpan
 * @typedef {{ text: string, start: number, end: number }} Word  seconds of take time
 */

/** Every word the person sees from this module: the six cues' own wordings (D-44). */
export const COPY = Object.freeze({
  slowDown: 'Slow down',
  smile: 'Smile',
  moreEnergy: 'More energy',
  pause: 'Pause',
  lookAtLens: 'Look at lens',
  landThePoint: 'Land the point',
});

/** The six delivery cues, in the order the person is offered them (D-44). */
export const DELIVERY_CUES = Object.freeze([
  Object.freeze({ kind: 'slow-down', text: COPY.slowDown }),
  Object.freeze({ kind: 'smile', text: COPY.smile }),
  Object.freeze({ kind: 'more-energy', text: COPY.moreEnergy }),
  Object.freeze({ kind: 'pause', text: COPY.pause }),
  Object.freeze({ kind: 'look-at-lens', text: COPY.lookAtLens }),
  Object.freeze({ kind: 'land-the-point', text: COPY.landThePoint }),
]);

/** One setting each. Change a value here; no other code changes. */
export const DELIVERY_DEFAULTS = Object.freeze({
  min: 1, // the person keeps at least one cue
  max: 3, // and at most three (D-44)
  textChars: 40, // an edited wording is cut to this many characters
  deal: 'in-order', // seat default: cues the person does not place go to the beats in order
  minCueSec: 3, // a Slow down raised by pace stays at least this long
});

const SLOW_DOWN = 'slow-down';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function checkTime(at, what) {
  if (!isFiniteNumber(at)) throw new TypeError(`${what}: time must be a finite number of seconds`);
}

/** @param {DeliveryCue} cue @returns {DeliveryCue} */
function copyCue(cue) {
  return { id: cue.id, kind: cue.kind, text: cue.text, beatId: cue.beatId };
}

/**
 * The person's wording as plain data: white space runs become one space, the
 * ends are trimmed, and it is cut to `maxChars` characters. Empty, or not a
 * string: the cue's own wording.
 */
function wordingOf(text, fallback, maxChars) {
  if (typeof text !== 'string') return fallback;
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain === '') return fallback;
  return Array.from(plain).slice(0, maxChars).join('').trim();
}

function namedBeat(pick) {
  return typeof pick.beatId === 'string' && pick.beatId !== '' ? pick.beatId : null;
}

/** The cues of a delivery object, or none. */
function cuesOf(delivery) {
  return delivery && Array.isArray(delivery.cues) ? delivery.cues.filter((c) => c && typeof c.kind === 'string') : [];
}

/**
 * The person's 1 to 3 delivery cues (D-44). A pick may carry its own wording
 * and its own beat. Picks with no beat are dealt to the beats in order, around
 * the beats other picks named; a cue left over when the beats run out has no
 * beat (`beatId: null`) and never shows by beat.
 *
 * Throws DeliveryCueCountError for fewer than `min` or more than `max` picks,
 * DeliveryCueKindError for an unknown kind or the same kind twice, and
 * DeliveryCueBeatError for a beat that is not in `beats` or that two picks name.
 *
 * @param {DeliveryPick[]} picks
 * @param {{ id: string, title?: string }[]} [beats]  the beats in order; when left out, named beats are kept as given
 * @param {{ min?: number, max?: number, textChars?: number, deal?: string }} [settings]
 * @returns {Delivery}
 */
export function chooseDeliveryCues(picks, beats, settings) {
  const s = { ...DELIVERY_DEFAULTS, ...(settings || {}) };
  const list = Array.isArray(picks) ? picks : [];
  if (list.length < s.min || list.length > s.max) {
    throw namedError('DeliveryCueCountError', `keep ${s.min} to ${s.max} delivery cues (got ${list.length})`);
  }
  const beatsKnown = Array.isArray(beats);
  const beatIds = beatsKnown ? beats.map((b) => (b ? b.id : null)).filter((id) => typeof id === 'string' && id !== '') : [];

  const kinds = new Set();
  const taken = new Set();
  for (const pick of list) {
    const kind = pick ? pick.kind : undefined;
    if (!DELIVERY_CUES.some((c) => c.kind === kind)) {
      const known = DELIVERY_CUES.map((c) => c.kind).join(', ');
      throw namedError('DeliveryCueKindError', `unknown delivery cue "${String(kind)}"; the cues are ${known}`);
    }
    if (kinds.has(kind)) throw namedError('DeliveryCueKindError', `delivery cue "${kind}" was chosen twice`);
    kinds.add(kind);
    const beatId = namedBeat(pick);
    if (beatId === null) continue;
    if (beatsKnown && !beatIds.includes(beatId)) {
      throw namedError('DeliveryCueBeatError', `delivery cue "${kind}" names beat "${beatId}", which is not a beat of this recording`);
    }
    if (taken.has(beatId)) throw namedError('DeliveryCueBeatError', `two delivery cues name beat "${beatId}"; one cue shows at a time`);
    taken.add(beatId);
  }

  const free = s.deal === 'in-order' ? beatIds.filter((id) => !taken.has(id)) : [];
  let next = 0;
  const cues = list.map((pick, i) => {
    const base = /** @type {{ kind: DeliveryKind, text: string }} */ (DELIVERY_CUES.find((c) => c.kind === pick.kind));
    let beatId = namedBeat(pick);
    if (beatId === null && next < free.length) {
      beatId = free[next];
      next += 1;
    }
    return { id: `d${i + 1}`, kind: base.kind, text: wordingOf(pick.text, base.text, s.textChars), beatId };
  });
  return { cues };
}

/**
 * The cue chosen for a beat, or null. A cue with no beat belongs to no beat.
 * @param {Delivery | null | undefined} delivery
 * @param {string | null | undefined} beatId
 * @returns {DeliveryCue | null}
 */
export function cueForBeat(delivery, beatId) {
  if (typeof beatId !== 'string' || beatId === '') return null;
  const cue = cuesOf(delivery).find((c) => c.beatId === beatId);
  return cue ? copyCue(cue) : null;
}

/**
 * The live delivery stream (D-45). One cue shows at a time: the cue chosen for
 * the current beat. When the person chose Slow down, `onWords` measures pace
 * with Phase 1's pace measure at the person's level; while pace is over it,
 * Slow down is the cue shown (reason 'pace'), for at least `minCueSec`; then
 * the beat's own cue returns (reason 'beat'). When Slow down was not chosen,
 * pace raises nothing.
 *
 * `reason` says why the cue now showing is showing, so a change with reason
 * 'pace' always carries the Slow down cue, and Slow down on its own beat still
 * reports the raise (the cue stays, the reason becomes 'pace').
 *
 * There is no clock in here: a change that comes due between two calls (the
 * minimum time of a raised cue running out) is reported on the next call to
 * `onBeat`, `onWords` or `current`, stamped with the time it came due. A caller
 * with a clock calls `current(now)` when that time is up. Times never run
 * backwards: an earlier time is read as the latest time already seen.
 *
 * @param {{ delivery?: Delivery, threshold?: number, minCueSec?: number, onChange?: (change: DeliveryChange) => void }} [options]
 *   `threshold` is the person's pace level in words a minute (Phase 1's default when left out).
 */
export function createDeliveryStream(options = {}) {
  const o = options || {};
  const cues = cuesOf(o.delivery).map(copyCue);
  const slowDown = cues.find((c) => c.kind === SLOW_DOWN) || null;
  const minCueSec = isFiniteNumber(o.minCueSec) && o.minCueSec >= 0 ? o.minCueSec : DELIVERY_DEFAULTS.minCueSec;
  const paceOptions = isFiniteNumber(o.threshold) ? { threshold: o.threshold } : {};
  const onChange = typeof o.onChange === 'function' ? o.onChange : null;

  /** @type {string | null} */
  let beatId = null;
  /** Slow down raised by pace: since when, and when pace fell back (null while it is over). */
  /** @type {{ since: number, fellAt: number | null } | null} */
  let raise = null;
  /** @type {{ cue: DeliveryCue | null, reason: DeliveryReason }} */
  let showing = { cue: null, reason: 'beat' };
  /** @type {DeliverySpan[]} */
  const spanList = [];
  let latest = -Infinity;

  function timeOf(at, what) {
    checkTime(at, what);
    latest = Math.max(latest, at);
    return latest;
  }

  function beatCue() {
    return beatId === null ? null : cues.find((c) => c.beatId === beatId) || null;
  }

  /** @param {DeliveryCue | null} cue @param {DeliveryReason} reason @param {number} at */
  function show(cue, reason, at) {
    const sameCue = (showing.cue ? showing.cue.id : null) === (cue ? cue.id : null);
    if (sameCue && (cue === null || showing.reason === reason)) return;
    const open = spanList[spanList.length - 1];
    if (open && open.to === null) open.to = at;
    showing = { cue, reason: cue ? reason : 'beat' };
    if (cue) spanList.push({ cue: copyCue(cue), beatId, reason, from: at, to: null });
    if (onChange) onChange({ cue: cue ? copyCue(cue) : null, beatId, reason: showing.reason, at });
  }

  /** When a raised Slow down goes: never before its minimum time. */
  function raiseEnd() {
    if (!raise || raise.fellAt === null) return Infinity;
    return Math.max(raise.fellAt, raise.since + minCueSec);
  }

  /** Report the return of the beat's own cue if it came due by `at`. */
  function settle(at) {
    if (!raise) return;
    const end = raiseEnd();
    if (at < end) return;
    raise = null;
    show(beatCue(), 'beat', end);
  }

  return {
    /**
     * The take moved to a beat (or to none).
     * @param {string | null} id
     * @param {number} at
     */
    onBeat(id, at) {
      const t = timeOf(at, 'onBeat');
      settle(t);
      beatId = typeof id === 'string' && id !== '' ? id : null;
      if (!raise) show(beatCue(), 'beat', t);
    },

    /**
     * The words counted so far in the take (the whole list, as Phase 1's pace
     * measure reads it) at time `at`. Call it on each new word, and on a tick
     * when the person may have gone quiet.
     * @param {Word[]} words
     * @param {number} at
     */
    onWords(words, at) {
      const t = timeOf(at, 'onWords');
      settle(t);
      if (!slowDown) return; // not chosen: pace raises nothing (D-45)
      const over = paceCue(words, t, paceOptions).show;
      if (over) {
        if (raise) {
          raise.fellAt = null;
        } else {
          raise = { since: t, fellAt: null };
          show(slowDown, 'pace', t);
        }
      } else if (raise && raise.fellAt === null) {
        raise.fellAt = t;
        settle(t);
      }
    },

    /**
     * The one delivery cue on screen at `at`, or null.
     * @param {number} at
     * @returns {DeliveryCue | null}
     */
    current(at) {
      const t = timeOf(at, 'current');
      settle(t);
      return showing.cue ? copyCue(showing.cue) : null;
    },

    /**
     * Every cue shown so far, from when to when; they never overlap. The cue
     * still showing has `to: null`.
     * @returns {DeliverySpan[]}
     */
    spans() {
      return spanList.map((s) => ({ cue: copyCue(s.cue), beatId: s.beatId, reason: s.reason, from: s.from, to: s.to }));
    },
  };
}
