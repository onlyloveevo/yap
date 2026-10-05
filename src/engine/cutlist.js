// The rough-cut list: the talk with YAP cut from its live timestamps, restart
// cuts proposed by the detector, amber (unsure) cuts applied with one call,
// an undo for every change, and the kept ranges Export renders
// (CUT-01; D-18, D-20, D-21, D-23).
//
// Phase 1.1 adds kinds to this one list, with the same undo (D-37): dead air
// (CUT-05; D-47), a run of words the person deleted in the transcript
// (EDIT-01; D-49) and a trim of the start or the end (D-50). Adding an edit or
// a trim is itself a change that undo takes back.
//
// Amber marks how sure YAP is about a cut, never the person. YAP proposes and
// the person decides. The original recording and its words are never changed:
// this module only describes cuts over them.
//
// Pattern (not code) from louisedesadeleer/cut-video, MIT: per-cut cards, amber
// suggestions applied with a tap, an undo stack.
//
// Pure and browser-safe: imports nothing, never mutates its inputs, and every
// function returns a new list object.

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {{ id: string, start: number, end: number }} Exchange
 * @typedef {{ start: number, end: number, certainty: 'sure' | 'unsure', reason?: string }} RestartProposal
 * @typedef {{ start: number, end: number, certainty: 'sure' | 'unsure', reason?: string }} DeadAirProposal
 * @typedef {{ id: string, kind: string, start: number, end: number, certainty: 'sure' | 'unsure', applied: boolean, reason: string, edge?: 'start' | 'end' }} Cut
 * A trim cut also says which end it trims (`edge`).
 * @typedef {{ type: 'set-applied', id: string, from: boolean, to: boolean }} SetAppliedAction
 * @typedef {{ type: 'add-cut', id: string | null, replaced?: Cut, at?: number }} AddCutAction
 * Undoing an 'add-cut' removes the cut `id` (null when a trim was only removed)
 * and puts back the cut it `replaced`, at the place it held (`at`).
 * @typedef {SetAppliedAction | AddCutAction} UndoAction
 * @typedef {{ cuts: Cut[], undoStack: UndoAction[] }} CutList
 */

/** Every word the person sees about a cut. */
export const COPY = Object.freeze({
  exchange: 'talk with YAP',
  restart: 'restart',
  deadAir: 'dead air',
  edit: 'removed by you',
  trimStart: 'trimmed start',
  trimEnd: 'trimmed end',
  amber: 'amber: tap to apply',
  applied: 'applied',
  undo: 'undo',
});

/** Kind order on equal start times: the exchange cut first. Kinds are an open set. */
const KIND_RANK = Object.freeze({ exchange: 0 });

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Round to the millisecond so edges compare cleanly. */
function ms(x) {
  return Math.round(x * 1000) / 1000;
}

function copyList(list) {
  return {
    cuts: list.cuts.map((c) => ({ ...c })),
    undoStack: list.undoStack.map((a) => (a.replaced ? { ...a, replaced: { ...a.replaced } } : { ...a })),
  };
}

function nextId(list) {
  let max = 0;
  for (const c of list.cuts) {
    const n = Number(String(c.id).replace(/^c/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `c${max + 1}`;
}

function checkRange(start, end, what) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw namedError('InvalidCutRangeError', `${what} needs a start before its end (got ${start} to ${end})`);
  }
}

/** @returns {CutList} */
export function createCutList() {
  return { cuts: [], undoStack: [] };
}

/**
 * Cut the talk with YAP from its live timestamps (no guessing). Each edge is
 * padded into the neighbouring silence by at most `pad` seconds and never past
 * the midpoint of the gap to the adjacent word, so it never enters a word.
 * With no exchange, the list comes back unchanged.
 * @param {CutList} list
 * @param {Exchange | null | undefined} exchange
 * @param {Word[]} [words] the take's words
 * @param {{ pad?: number }} [options]
 * @returns {CutList}
 */
export function addExchangeCut(list, exchange, words = [], { pad = 0.15 } = {}) {
  const out = copyList(list);
  if (!exchange) return out;
  checkRange(exchange.start, exchange.end, 'The talk with YAP');
  let prev = null;
  let next = null;
  for (const w of words || []) {
    if (w.end <= exchange.start && (!prev || w.end > prev.end)) prev = w;
    if (w.start >= exchange.end && (!next || w.start < next.start)) next = w;
  }
  let start = exchange.start - pad;
  if (prev) start = Math.max(start, (prev.end + exchange.start) / 2);
  start = Math.max(0, ms(start));
  if (prev) start = Math.max(start, prev.end);
  let end = exchange.end + pad;
  if (next) end = Math.min(end, (exchange.end + next.start) / 2);
  end = ms(end);
  if (next) end = Math.min(end, next.start);
  out.cuts.push({
    id: nextId(out),
    kind: 'exchange',
    start,
    end,
    certainty: 'sure',
    applied: true,
    reason: COPY.exchange,
  });
  return out;
}

/**
 * Enter the restart detector's proposals: sure cuts are applied, unsure
 * (amber) cuts are listed and wait for one tap.
 * @param {CutList} list
 * @param {RestartProposal[]} proposals
 * @returns {CutList}
 */
export function addRestartCuts(list, proposals) {
  const out = copyList(list);
  for (const p of proposals || []) {
    if (p.certainty !== 'sure' && p.certainty !== 'unsure') {
      throw namedError('InvalidCutError', `A restart proposal must be 'sure' or 'unsure' (got "${p.certainty}")`);
    }
    checkRange(p.start, p.end, 'A restart cut');
    const why = p.reason ? `${COPY.restart}: ${p.reason}` : COPY.restart;
    const sure = p.certainty === 'sure';
    out.cuts.push({
      id: nextId(out),
      kind: 'restart',
      start: p.start,
      end: p.end,
      certainty: p.certainty,
      applied: sure,
      reason: sure ? why : `${why} (${COPY.amber})`,
    });
  }
  return out;
}

/**
 * Enter the dead-air proposals (src/engine/dead-air.js; CUT-05, D-47): a long
 * pause sits in this same list beside the talk with YAP and the restarts. Sure
 * cuts are applied, unsure (amber) cuts are listed and wait for one tap, and
 * either can be undone like any other cut.
 * @param {CutList} list
 * @param {DeadAirProposal[]} proposals
 * @returns {CutList}
 */
export function addDeadAirCuts(list, proposals) {
  const out = copyList(list);
  for (const p of proposals || []) {
    if (p.certainty !== 'sure' && p.certainty !== 'unsure') {
      throw namedError('InvalidCutError', `A dead-air proposal must be 'sure' or 'unsure' (got "${p.certainty}")`);
    }
    checkRange(p.start, p.end, 'A dead-air cut');
    const sure = p.certainty === 'sure';
    out.cuts.push({
      id: nextId(out),
      kind: 'dead-air',
      start: p.start,
      end: p.end,
      certainty: p.certainty,
      applied: sure,
      reason: sure ? COPY.deadAir : `${COPY.deadAir} (${COPY.amber})`,
    });
  }
  return out;
}

/**
 * Cut a range the person removed themselves (edit by transcript; EDIT-01,
 * D-49). The cut is sure and applied, and adding it goes on the undo stack, so
 * undo takes the cut out of the list again.
 * @param {CutList} list
 * @param {{ start: number, end: number, reason?: string }} range
 * @returns {CutList}
 */
export function addEditCut(list, range) {
  const { start, end, reason } = range || {};
  const out = copyList(list);
  checkRange(start, end, 'An edit cut');
  const id = nextId(out);
  out.cuts.push({
    id,
    kind: 'edit',
    start,
    end,
    certainty: 'sure',
    applied: true,
    reason: typeof reason === 'string' && reason ? reason : COPY.edit,
  });
  out.undoStack.push({ type: 'add-cut', id });
  return out;
}

/**
 * Trim one end of the recording (EDIT-01, D-50): a sure, applied cut of kind
 * 'trim'. There is one trim per end at most, so a new trim takes the place of
 * the earlier one for that end, and a range with no length (start equal to
 * end) removes that end's trim and adds none. Each real change goes on the
 * undo stack with what it replaced, so undo brings the earlier trim back.
 * Asking for the trim that is already there changes nothing.
 * @param {CutList} list
 * @param {{ start: number, end: number, edge?: 'start' | 'end' }} range the
 *   end trimmed is `edge`, or the start when the range begins at 0
 * @returns {CutList}
 */
export function addTrimCut(list, range) {
  const { start, end, edge } = range || {};
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw namedError('InvalidCutRangeError', `A trim needs a start at or before its end (got ${start} to ${end})`);
  }
  if (edge !== undefined && edge !== 'start' && edge !== 'end') {
    throw namedError('InvalidCutError', `A trim is of the 'start' or the 'end' (got "${edge}")`);
  }
  const which = edge || (start <= 0 ? 'start' : 'end');
  const out = copyList(list);
  const at = out.cuts.findIndex((c) => c.kind === 'trim' && c.edge === which);
  const earlier = at === -1 ? null : out.cuts[at];
  const none = !(end > start);
  if (none && !earlier) return out;
  if (!none && earlier && earlier.applied && earlier.start === start && earlier.end === end) return out;
  // The id is taken while the earlier trim is still listed, so it is new to the list.
  const id = none ? null : nextId(out);
  if (earlier) out.cuts.splice(at, 1);
  if (id !== null) {
    out.cuts.push({
      id,
      kind: 'trim',
      edge: which,
      start,
      end,
      certainty: 'sure',
      applied: true,
      reason: which === 'start' ? COPY.trimStart : COPY.trimEnd,
    });
  }
  out.undoStack.push(earlier ? { type: 'add-cut', id, replaced: earlier, at } : { type: 'add-cut', id });
  return out;
}

/**
 * Apply or un-apply one cut. A real change goes on the undo stack.
 * @param {CutList} list
 * @param {string} id
 * @param {boolean} applied
 * @returns {CutList}
 */
export function setApplied(list, id, applied) {
  const out = copyList(list);
  const cut = out.cuts.find((c) => c.id === id);
  if (!cut) throw namedError('UnknownCutError', `No cut with id "${id}" in this list`);
  const to = Boolean(applied);
  if (cut.applied === to) return out;
  out.undoStack.push({ type: 'set-applied', id, from: cut.applied, to });
  cut.applied = to;
  return out;
}

/**
 * Apply a cut in one call (the amber one-tap).
 * @param {CutList} list
 * @param {string} id
 * @returns {CutList}
 */
export function applyCut(list, id) {
  return setApplied(list, id, true);
}

/**
 * Undo the last change. With an empty stack the list comes back unchanged.
 * A 'set-applied' action puts the cut back as it was; an 'add-cut' action
 * takes that cut out of the list and puts back the cut it replaced, if any.
 * @param {CutList} list
 * @returns {CutList}
 */
export function undo(list) {
  const out = copyList(list);
  const action = out.undoStack.pop();
  if (!action) return out;
  if (action.type === 'add-cut') {
    if (action.id !== null) out.cuts = out.cuts.filter((c) => c.id !== action.id);
    if (action.replaced) {
      const at = Number.isInteger(action.at) ? Math.min(Math.max(action.at, 0), out.cuts.length) : out.cuts.length;
      out.cuts.splice(at, 0, { ...action.replaced });
    }
    return out;
  }
  const cut = out.cuts.find((c) => c.id === action.id);
  if (cut) cut.applied = action.from;
  return out;
}

/**
 * The cuts in time order: by start, the exchange cut first on equal starts,
 * creation order otherwise.
 * @param {CutList} list
 * @returns {Cut[]}
 */
export function listCuts(list) {
  return list.cuts
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (a.c.start !== b.c.start) return a.c.start - b.c.start;
      const ra = a.c.kind in KIND_RANK ? KIND_RANK[a.c.kind] : 1;
      const rb = b.c.kind in KIND_RANK ? KIND_RANK[b.c.kind] : 1;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    })
    .map(({ c }) => ({ ...c }));
}

/**
 * What stays in the rough cut: the complement of the applied cuts over
 * [0, duration], with overlapping or touching cuts merged so no time is
 * counted twice. Ascending order.
 * @param {CutList} list
 * @param {number} duration seconds
 * @returns {[number, number][]}
 */
export function keptRanges(list, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const applied = list.cuts
    .filter((c) => c.applied)
    .map((c) => [Math.max(0, c.start), Math.min(duration, c.end)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const [s, e] of applied) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  /** @type {[number, number][]} */
  const kept = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) kept.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < duration) kept.push([cursor, duration]);
  return kept;
}

/** Before first review, keep entire aligned words at audio-derived cut edges.
 * Only shrink proposed removals: never delete extra speech to make a cut fit.
 * A proposal wholly inside a word has no safe interval and is omitted.
 * Applies to undecided cuts too, so a later human toggle remains exportable.
 */
export function protectWordEdges(list, words = []) {
  const spans = words.filter(w => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start);
  const safe = list.cuts.map(cut => {
    let {start, end} = cut;
    // Each pass moves monotonically across at least one overlapping word.
    for (let pass = 0; pass <= spans.length; pass++) {
      const beforeStart = start, beforeEnd = end;
      for (const word of spans) {
        if (start > word.start && start < word.end) start = word.end;
        if (end > word.start && end < word.end) end = word.start;
      }
      if (start === beforeStart && end === beforeEnd) break;
    }
    return {...cut, start, end};
  }).filter(cut => cut.end > cut.start);
  const keptIds=new Set(safe.map(c=>c.id));
  return {...list, cuts: safe, undoStack:list.undoStack.filter(action=>keptIds.has(action.id))};
}
