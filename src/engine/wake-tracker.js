// The wake tracker (WAKE-02; D-77 to D-81): reads Chrome's results, early and
// final alike, and says when a talk with YAP opens, what its remark is, when
// that remark is complete, and when the exchange never was. Pure: no
// microphone, no network, no model; its only timers are the take clock's.
//
// Text kept per session (D-77): the latest text for every result index of the
// current recognition session. A new text for an index replaces the old one
// whole; early text is rewritten, never appended. A kept index at or above an
// event's resultIndex that the event no longer holds is dropped.
//
// Utterance, open and remark (D-78): the words of all kept results in index
// order. An exchange opens the first time those words hold the wake pair
// ("hey" then a word that sounds like "yap", wake-settings.js). It is tied to
// the session and index where its pair starts, so the same result delivered
// again never opens a second one, and the next exchange can only start at a
// later word. The remark is the words after the pair.
//
// Complete is not final (D-79): the remark is complete when none of its words
// has been added or changed for settleSec, whether its pieces are early or
// final. Then onAct is called, once. The exchange stays correctable until its
// remark has gone correctSec unchanged (a change in that time calls onRevise),
// then onClose is called, and nothing delivered afterwards reaches it.
//
// Which wake is which (D-80): several exchanges can be open at once, each known
// by its session and the place of its "hey". A second wake pair further on in
// the same text is a second exchange, and each exchange reads only its own
// stretch of the text, so a late result for an older one never touches a newer
// one.
//
// Where a remark ends (D-80): at the first of the next wake pair, its
// maxRemarkWords-th word, and the close of its exchange. Words past that are
// ordinary speech (`owns` is false for them). Someone who keeps talking: a
// remark that has words and has not settled keepTalkingSec after its first
// word is taken as complete then, its length fixed at the words it has; a
// rewrite of those same words inside the correction time still calls onRevise.
//
// Once open, the exchange stays with its "hey" (D-81): Chrome often re-spells
// the word after it ("hey yeah" becomes "hey yet") or puts a word before the
// pair; the remark is still the words after that word. Before acting, the
// exchange is dropped (onDrop) only when its "hey" is gone from the utterance
// or the word after it has become a never-list word ('retracted'), or when no
// remark word has come for wakeOnlySec ('wake-only').
//
// Stop and restart (D-81): stop() and end() cancel every pending timer; an
// exchange that has not acted is dropped ('stopped'), one that has acted is
// closed as it stands, and nothing is delivered until a new session begins. A
// restart of recognition begins a new session with no kept text. The last final
// word of the old session is kept for straddleSec of take time, counted from
// when it was heard, and no longer: when it is a "hey", it pairs with the new
// session's first word. An open exchange of the old session keeps its timers
// across the restart and acts once, on the remark it had.
//
// Positions: a word's place is counted over all kept results of the session
// ("flat" position), because Chrome moves words between early results freely
// (" hey" then " hey yap" in one result, or " hey" and " yap" in two).
//
// Timers (T-01.1-19): an exchange holds at most one timer of each kind
// (settle, keep talking, wake only, close); all are cleared when it closes or
// is dropped. The 12-word limit and the keep-talking limit mean that text which
// never stops changing cannot hold an exchange open.

import { normalizeToken } from './text.js';
import { WAKE_SETTINGS, isWakeFirst, isYapLike, isNever } from './wake-settings.js';

/**
 * @typedef {object} TrackerExchange
 * @property {string} id          "x1", "x2", ... from nextId
 * @property {'wake'} trigger
 * @property {number} session     the recognition session its wake pair is in
 * @property {number} index       the result index that held its "hey" when it opened
 * @property {number} heyPos      the place of that "hey" among its result's words when it opened; -1 when the
 *   "hey" was the last word of the session before (the pair straddles a restart, D-81) and `index` is the
 *   result holding the word after it
 * @property {number} start       take time the pair was first seen, less backdateSec, never below 0
 * @property {number|null} end    take time of the remark's last change when it first acted, moved only by a
 *   later change that changed the choice (onRevise returned true); null before it acts
 * @property {string} remark      the words after the wake pair, joined by spaces
 * @property {{ text: string, final: boolean }[]} words  the remark words (Chrome gives no time per word)
 * @property {true} [keptTalking] set when the remark never settled and was taken as complete at keepTalkingSec:
 *   its last words may be narration, not request
 */

/**
 * @typedef {object} TrackerHandlers
 * @property {(x: TrackerExchange) => void} [onOpen]    the wake pair was seen
 * @property {(x: TrackerExchange) => void} [onAct]     the remark is complete: choose now
 * @property {(x: TrackerExchange) => (boolean | void)} [onRevise]  the remark changed after acting, inside
 *   correctSec; return true when the change changed the choice (the exchange's `end` then moves to this change)
 * @property {(x: TrackerExchange) => void} [onClose]   the exchange is over
 * @property {(x: TrackerExchange, reason: 'retracted' | 'wake-only' | 'stopped') => void} [onDrop]  the exchange never was
 */

/** @typedef {{ text: string, token: string, index: number, pos: number, final: boolean }} FlatWord */

/**
 * @typedef {object} Live  an open exchange
 * @property {string} id
 * @property {number} session
 * @property {number} index
 * @property {number} heyPos
 * @property {number} heyAt        the flat position of its "hey" now
 * @property {number} floor        the lowest flat position its "hey" can be found at
 * @property {number} start
 * @property {number|null} end
 * @property {FlatWord[]} remark
 * @property {string} key          the remark's tokens, to tell a change from a re-delivery
 * @property {number} lastChange   take time of the remark's last change
 * @property {number|null} firstWordAt  take time the remark first had a word
 * @property {boolean} acted
 * @property {number|null} fixedLen     the remark's length, once it was taken as complete while the person kept talking
 * @property {boolean} carried     its "hey" was the last word of the session before: it sits at flat position -1
 * @property {unknown} settle      timers, one of each kind at most
 * @property {unknown} keepTalking
 * @property {unknown} wakeOnly
 * @property {unknown} close
 */

const splitWords = (text) => String(text ?? '').split(/\s+/).filter(Boolean);

/**
 * @param {object} options
 * @param {import('./clock.js').Clock} options.clock   the take clock
 * @param {Partial<import('./wake-settings.js').WakeSettings>} [options.settings]  laid over WAKE_SETTINGS
 * @param {() => string} [options.nextId]              the take's exchange id counter; default x1, x2, ...
 * @param {TrackerHandlers} [options.handlers]
 * @param {() => boolean} [options.blocked]            true while another exchange (the held key) is open: the
 *   text is kept, no wake exchange opens, and what was heard meanwhile never opens one later
 */
export function createWakeTracker({ clock, settings: given = {}, nextId, handlers = {}, blocked = () => false } = /** @type {any} */ ({})) {
  if (!clock) throw new TypeError('createWakeTracker needs a clock');
  /** Every number below is read from here (D-73): none is written in this file. */
  const settings = { ...WAKE_SETTINGS, ...given };
  let ownCount = 0;
  const newId = typeof nextId === 'function' ? nextId : () => `x${++ownCount}`;

  let sessionNo = 0;
  /**
   * @type {Map<number, { text: string, final: boolean, words: string[], finalAt: number | null }>} the latest text
   * per result index of this session; finalAt is the take time a final text was first delivered
   */
  const kept = new Map();
  /** @type {{ at: number } | null} a "hey" that was the old session's last final word, and the take time it was heard (D-81) */
  let carry = null;
  /** the flat position from which the next wake pair may start */
  let floor = 0;
  /** @type {{ id: string, from: number, to: number }[]} flat ranges of this session's closed exchanges (wake pair and remark) */
  const closedRanges = [];
  /** @type {Live[]} the open exchanges, in the order they opened */
  const lives = [];
  let halted = false;

  /** @returns {FlatWord[]} every kept word of this session, in index order */
  function flat() {
    /** @type {FlatWord[]} */
    const out = [];
    for (const index of [...kept.keys()].sort((a, b) => a - b)) {
      const r = /** @type {{ final: boolean, words: string[] }} */ (kept.get(index));
      r.words.forEach((text, pos) => out.push({ text, token: normalizeToken(text), index, pos, final: r.final }));
    }
    return out;
  }

  /** Is the wake pair at words[i], words[i + 1]? */
  const pairAt = (words, i) =>
    i + 1 < words.length
    && isWakeFirst(words[i].token, settings)
    && isYapLike(words[i + 1].token, settings)
    && !isNever(words[i + 1].token, settings);

  /** Is words[i] a "hey" an open exchange can stay with: the word after it is not on the never-list (or has not come yet)? */
  const heyAt = (words, i) =>
    isWakeFirst(words[i].token, settings) && (i + 1 >= words.length || !isNever(words[i + 1].token, settings));

  function clear(timer) {
    if (timer !== null) clock.clearTimeout(timer);
    return null;
  }

  /** @param {Live} x */
  function clearTimers(x) {
    x.settle = clear(x.settle);
    x.keepTalking = clear(x.keepTalking);
    x.wakeOnly = clear(x.wakeOnly);
    x.close = clear(x.close);
  }

  /** @param {Live} x */
  const isLive = (x) => lives.includes(x);

  /** @param {Live} x */
  function remove(x) {
    clearTimers(x);
    const i = lives.indexOf(x);
    if (i >= 0) lives.splice(i, 1);
  }

  /** @param {Live} x @returns {TrackerExchange} */
  function snapshot(x) {
    return {
      id: x.id,
      trigger: 'wake',
      session: x.session,
      index: x.index,
      heyPos: x.heyPos,
      start: x.start,
      end: x.end,
      remark: x.remark.map((w) => w.text).join(' '),
      words: x.remark.map((w) => ({ text: w.text, final: w.final })),
      ...(x.fixedLen !== null ? { keptTalking: /** @type {true} */ (true) } : {}),
    };
  }

  /** @param {Live} x */
  function close(x) {
    if (!isLive(x)) return;
    const snap = snapshot(x);
    if (x.session === sessionNo) {
      const to = x.heyAt + 2 + x.remark.length;
      closedRanges.push({ id: x.id, from: x.heyAt, to });
      floor = Math.max(floor, to);
    }
    remove(x);
    handlers.onClose?.(snap);
  }

  /**
   * The exchange never was: no swap, no note, no cut mark.
   * @param {Live} x
   * @param {'retracted' | 'wake-only' | 'stopped'} reason
   */
  function drop(x, reason) {
    if (!isLive(x)) return;
    const snap = snapshot(x);
    // A retracted pair is gone from the text; a pair that is still there (wake only) is used up.
    if (reason !== 'retracted' && x.session === sessionNo) floor = Math.max(floor, x.heyAt + 2);
    remove(x);
    handlers.onDrop?.(snap, reason);
  }

  /** Close once the remark has gone correctSec with no change. @param {Live} x */
  function armClose(x) {
    x.close = clear(x.close);
    const wait = Math.max(0, x.lastChange + settings.correctSec - clock.now());
    x.close = clock.setTimeout(() => {
      x.close = null;
      close(x);
    }, wait);
  }

  /**
   * The remark is complete: choose now, once.
   * @param {Live} x
   * @param {boolean} [keptTalking]  it never settled: its length is fixed at the words it has
   */
  function act(x, keptTalking = false) {
    if (!isLive(x) || x.acted) return;
    x.acted = true;
    x.settle = clear(x.settle);
    x.keepTalking = clear(x.keepTalking);
    x.wakeOnly = clear(x.wakeOnly);
    if (keptTalking) x.fixedLen = x.remark.length;
    x.end = x.lastChange;
    handlers.onAct?.(snapshot(x));
    if (isLive(x)) armClose(x);
  }

  /** Act once the remark has gone settleSec with no change. @param {Live} x */
  function armSettle(x) {
    x.settle = clear(x.settle);
    x.settle = clock.setTimeout(() => {
      x.settle = null;
      act(x);
    }, settings.settleSec);
  }

  /** Someone who keeps talking: act keepTalkingSec after the remark's first word, settled or not. @param {Live} x */
  function armKeepTalking(x) {
    if (x.keepTalking !== null || x.firstWordAt === null) return;
    const wait = Math.max(0, x.firstWordAt + settings.keepTalkingSec - clock.now());
    x.keepTalking = clock.setTimeout(() => {
      x.keepTalking = null;
      if (isLive(x) && !x.acted && x.remark.length > 0) act(x, true);
    }, wait);
  }

  /** Drop the exchange when no remark word has come for wakeOnlySec. @param {Live} x */
  function armWakeOnly(x) {
    if (x.wakeOnly !== null) return;
    x.wakeOnly = clock.setTimeout(() => {
      x.wakeOnly = null;
      if (isLive(x) && !x.acted && x.remark.length === 0) drop(x, 'wake-only');
    }, settings.wakeOnlySec);
  }

  /**
   * The exchange's remark in these words: from after its wake pair to the next
   * wake pair or its longest length, whichever comes first (D-80).
   * @param {Live} x
   * @param {FlatWord[]} words
   */
  function remarkOf(x, words) {
    const from = x.heyAt + 2;
    const most = x.fixedLen !== null ? x.fixedLen : settings.maxRemarkWords;
    let to = Math.min(words.length, from + most);
    for (let j = from; j < to; j += 1) {
      if (pairAt(words, j)) {
        to = j;
        break;
      }
    }
    return words.slice(from, to);
  }

  /**
   * The remark as it now reads. A word added or changed moves the settle time.
   * @param {Live} x
   * @param {FlatWord[]} remark
   * @param {number} now
   */
  function setRemark(x, remark, now) {
    if (!isLive(x)) return;
    const key = remark.map((w) => w.token).join(' ');
    const changed = key !== x.key;
    x.remark = remark;
    if (!x.acted) {
      if (remark.length > 0) {
        x.wakeOnly = clear(x.wakeOnly);
        if (x.firstWordAt === null) x.firstWordAt = now;
        armKeepTalking(x);
      } else {
        x.firstWordAt = null;
        x.keepTalking = clear(x.keepTalking);
        armWakeOnly(x);
      }
    }
    if (!changed) return;
    x.key = key;
    x.lastChange = now;
    if (x.acted) {
      const choiceChanged = handlers.onRevise?.(snapshot(x)) === true;
      if (choiceChanged) x.end = now;
      if (isLive(x)) armClose(x);
    } else if (remark.length > 0) {
      armSettle(x);
    } else {
      x.settle = clear(x.settle);
    }
  }

  /**
   * @param {FlatWord[]} words
   * @param {number} i      the flat position of the pair's "hey"
   * @param {number} now
   * @param {number} lower  the lowest flat position this "hey" can later be found at
   * @param {number} [seenAt]  take time its "hey" was heard, when that was before now (a pair that straddles a restart)
   */
  function open(words, i, now, lower, seenAt = now) {
    const carried = i < 0;
    /** @type {Live} */
    const x = {
      id: newId(),
      session: sessionNo,
      index: words[carried ? 0 : i].index,
      heyPos: carried ? -1 : words[i].pos,
      heyAt: i,
      floor: lower,
      carried,
      start: Math.max(0, seenAt - settings.backdateSec),
      end: null,
      remark: [],
      key: '',
      lastChange: now,
      firstWordAt: null,
      acted: false,
      fixedLen: null,
      settle: null,
      keepTalking: null,
      wakeOnly: null,
      close: null,
    };
    lives.push(x);
    handlers.onOpen?.(snapshot(x));
    setRemark(x, remarkOf(x, words), now);
  }

  /**
   * Where an open exchange's "hey" now is: the wake pair nearest its last
   * place; failing that, the nearest "hey" whose next word is not on the
   * never-list. A place another open exchange was nearer to, or has taken, is
   * not its own. null when the "hey" is gone. A "hey" carried over a restart
   * is not in this session's text: it stays before the first word, and is gone
   * only when that word has become a never-list word.
   * @param {Live} x
   * @param {FlatWord[]} words
   * @param {Map<Live, number>} was   where each open exchange's "hey" was before this reading
   * @param {Set<number>} taken       places already given to an earlier exchange in this reading
   */
  function locate(x, words, was, taken) {
    if (x.carried) return words.length > 0 && isNever(words[0].token, settings) ? null : -1;
    const mine = /** @type {number} */ (was.get(x));
    const free = (i) => {
      if (taken.has(i)) return false;
      for (const [other, at] of was) {
        if (other !== x && isLive(other) && Math.abs(i - at) < Math.abs(i - mine)) return false;
      }
      return true;
    };
    const nearest = (test) => {
      /** @type {number | null} */
      let best = null;
      for (let i = Math.max(0, x.floor); i < words.length; i += 1) {
        if (test(words, i) && free(i) && (best === null || Math.abs(i - mine) < Math.abs(best - mine))) best = i;
      }
      return best;
    };
    return nearest(pairAt) ?? nearest(heyAt);
  }

  /** Read the kept text again after a change. */
  function read(now) {
    const words = flat();
    const mine = lives.filter((x) => x.session === sessionNo);

    // Each open exchange finds its own "hey" again.
    const was = new Map(mine.map((x) => [x, x.heyAt]));
    /** @type {Set<number>} */
    const taken = new Set();
    /** @type {Set<Live>} exchanges that have acted and whose "hey" is gone: left as they are */
    const lost = new Set();
    for (const x of mine) {
      if (!isLive(x)) continue;
      const at = locate(x, words, was, taken);
      if (at === null) {
        if (x.acted) lost.add(x);
        else drop(x, 'retracted');
        continue;
      }
      taken.add(at);
      x.heyAt = at;
    }

    // Then each reads its own stretch: a remark ends where the next wake pair starts.
    for (const x of mine) {
      if (isLive(x) && !lost.has(x)) setRemark(x, remarkOf(x, words), now);
    }

    if (blocked()) {
      floor = Math.max(floor, words.length);
      return;
    }

    // A wake pair past every open and closed exchange is a new one.
    let from = floor;
    for (const x of lives) if (x.session === sessionNo) from = Math.max(from, x.heyAt + 2);

    // A "hey" that ended the session before pairs with this session's first word, for straddleSec and no longer (D-81).
    if (carry && now - carry.at > settings.straddleSec + 1e-9) carry = null;
    if (carry && from === 0 && words.length > 0 && isYapLike(words[0].token, settings) && !isNever(words[0].token, settings)) {
      const seenAt = carry.at;
      carry = null;
      open(words, -1, now, -1, seenAt);
      from = 1;
    }

    let i = from;
    while (i < words.length) {
      if (pairAt(words, i)) {
        open(words, i, now, from);
        from = i + 2;
        i += 2;
      } else {
        i += 1;
      }
    }
  }

  /** The last final word of this session and the take time it was heard, or null. */
  function lastFinalWord() {
    /** @type {{ token: string, at: number } | null} */
    let last = null;
    for (const index of [...kept.keys()].sort((a, b) => a - b)) {
      const r = /** @type {{ final: boolean, words: string[], finalAt: number | null }} */ (kept.get(index));
      if (r.final && r.words.length > 0 && r.finalAt !== null) last = { token: normalizeToken(r.words[r.words.length - 1]), at: r.finalAt };
    }
    return last;
  }

  function beginSession(n) {
    // After a stop the person asked for, nothing is carried over.
    const last = halted ? null : lastFinalWord();
    carry = last && isWakeFirst(last.token, settings) ? { at: last.at } : null;
    sessionNo = n;
    kept.clear();
    closedRanges.length = 0;
    floor = 0;
    halted = false;
  }

  /**
   * Stop (D-81): every pending timer is cancelled. An exchange that has not
   * acted is dropped; one that has acted is closed as it stands. Nothing is
   * read again until a new session begins.
   */
  function halt() {
    halted = true;
    carry = null;
    for (const x of [...lives]) {
      if (x.acted) close(x);
      else drop(x, 'stopped');
    }
  }

  /**
   * Whose is the final word at this place: the id of the exchange (open, or
   * closed in this session) whose wake pair or remark it is part of, or null.
   * A word past the end of a remark is nobody's (D-80).
   * @param {{ session?: number, index?: number, pos?: number }} word
   * @returns {string | null}
   */
  function ownerOf({ session, index, pos } = {}) {
    if (session !== sessionNo || !Number.isInteger(index) || !Number.isInteger(pos)) return null;
    const here = kept.get(/** @type {number} */ (index));
    if (!here || /** @type {number} */ (pos) < 0 || /** @type {number} */ (pos) >= here.words.length) return null;
    let p = /** @type {number} */ (pos);
    for (const [i, r] of kept) if (i < /** @type {number} */ (index)) p += r.words.length;
    for (const x of lives) {
      if (x.session === sessionNo && p >= x.heyAt && p < x.heyAt + 2 + x.remark.length) return x.id;
    }
    const range = closedRanges.find((r) => p >= r.from && p < r.to);
    return range ? range.id : null;
  }

  return {
    /**
     * Recognition started, or started again: a new session, with no kept text.
     * @param {number} n  the session number, counting from 1
     * @param {number} [at]
     */
    session(n, at) {
      void at;
      if (Number.isFinite(n) && n !== sessionNo) beginSession(n);
      else halted = false;
    },
    /**
     * One Chrome result event: every live result from resultIndex up.
     * @param {{ session?: number, resultIndex?: number, length?: number, results: { index: number, text: string, final: boolean }[], at?: number }} event
     */
    results(event) {
      if (!event || !Array.isArray(event.results)) return;
      if (Number.isFinite(event.session) && event.session !== sessionNo) beginSession(/** @type {number} */ (event.session));
      if (halted) return;
      // One Chrome event carries every live result from its resultIndex up: a kept
      // index at or above it that the event no longer holds is gone (Chrome often
      // merges two early results back into one).
      const from = Number.isInteger(event.resultIndex)
        ? /** @type {number} */ (event.resultIndex)
        : Math.min(...event.results.map((r) => r.index));
      const now = clock.now();
      const before = new Map(kept);
      for (const index of [...kept.keys()]) if (index >= from) kept.delete(index);
      for (const r of event.results) {
        if (!Number.isInteger(r.index)) continue;
        const text = String(r.text ?? '');
        const final = Boolean(r.final);
        const had = before.get(r.index);
        const finalAt = !final ? null : had && had.final && had.text === text && had.finalAt !== null ? had.finalAt : now;
        kept.set(r.index, { text, final, words: splitWords(r.text), finalAt });
      }
      read(now);
    },
    /**
     * The person stopped listening: a pending settle is cancelled, an exchange not yet acted is dropped
     * as 'stopped', one that has acted is closed, and no timer is left.
     * @param {number} [at]
     */
    stop(at) {
      void at;
      halt();
    },
    /** The take is over: as stop(). @param {number} [at] */
    end(at) {
      void at;
      halt();
    },
    ownerOf,
    /**
     * Is the final word at this place part of a talk with YAP (its wake pair or its remark)?
     * @param {{ session?: number, index?: number, pos?: number }} word
     * @returns {boolean}
     */
    owns: (word) => ownerOf(word) !== null,
    /** @returns {string} the kept text of this session, one line */
    text() {
      return flat().map((w) => w.text).join(' ');
    },
    /**
     * Is an exchange open: the one with this id, or any when no id is given?
     * @param {string} [id]
     * @returns {boolean}
     */
    isOpen: (id) => (id === undefined ? lives.length > 0 : lives.some((x) => x.id === id)),
  };
}
