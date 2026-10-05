// Live refinement: talk with YAP about the beat you are presenting, and change its words on purpose.
//
// Pure rules, browser-safe and Node-safe: no network, no storage, no clock of its own.
// It validates the small structured context the page sends, composes the one request
// /api/model (task 'coach') receives, checks the model's JSON before the page shows it, and keeps
// the append-only revision log and the saved conversation.
//
// It changes only YAP's own beats. It never reads or edits Google Slides or any slide content.

/** Bounds, once. server/model.js enforces these on what it receives; the page uses the same numbers. */
export const COACH_LIMITS = Object.freeze({
  idChars: 64,
  titleChars: 80,
  beatChars: 1200,
  summaryChars: 160,
  maxBeats: 20,
  spokenChars: 800,
  maxTurns: 6,
  turnChars: 700,
  instructionChars: 500,
  answerChars: 900,
  proposalChars: 1200,
  /** The whole JSON body stays under the endpoint's 16384-byte read limit. */
  bodyBytes: 14000,
});
export const SAVED_LIMITS = Object.freeze({
  maxTurns: 200,
  maxRevisions: 200,
  maxIntervals: 200,
  turnChars: 1500,
  textChars: 1200,
  bodyBytes: 15000,
});
export const COACH_VERSION = 1;

const isText = (v) => typeof v === 'string';
const isId = (v) => isText(v) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const clean = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const bytes = (s) => new TextEncoder().encode(s).length;
const bad = (status, error) => ({ ok: false, status, error });

/**
 * Check what the page sent for task 'coach'. Nothing is cut: a field over its limit is refused, so
 * no beat, turn or instruction is ever silently dropped from what the model reads.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string }}
 */
export function validateCoachFields(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const beat = f.beat && typeof f.beat === 'object' ? f.beat : null;
  if (!beat || !isId(beat.id) || !isText(beat.title) || !isText(beat.text)) return bad(400, 'The current beat is missing.');
  const title = clean(beat.title);
  const text = clean(beat.text);
  if (!text) return bad(400, 'The current beat has no words.');
  if (title.length > COACH_LIMITS.titleChars || text.length > COACH_LIMITS.beatChars) return bad(413, 'The current beat is too long to discuss.');
  if (!Array.isArray(f.beats) || !f.beats.length || f.beats.length > COACH_LIMITS.maxBeats) return bad(400, 'The beat list is missing or too long.');
  const beats = [];
  for (const b of f.beats) {
    if (!b || !isId(b.id) || !isText(b.title) || !isText(b.summary)) return bad(400, 'A beat in the list is malformed.');
    const t = clean(b.title);
    const s = clean(b.summary);
    if (t.length > COACH_LIMITS.titleChars || s.length > COACH_LIMITS.summaryChars) return bad(413, 'A beat summary is too long.');
    beats.push({ id: b.id, title: t, summary: s });
  }
  if (!beats.some((b) => b.id === beat.id)) return bad(400, 'The current beat is not one of the beats.');
  const spoken = f.spoken === undefined || f.spoken === null ? '' : f.spoken;
  if (!isText(spoken)) return bad(400, 'The spoken words are malformed.');
  if (spoken.length > COACH_LIMITS.spokenChars) return bad(413, 'The spoken words are too long.');
  const rawTurns = f.turns === undefined ? [] : f.turns;
  if (!Array.isArray(rawTurns) || rawTurns.length > COACH_LIMITS.maxTurns) return bad(413, 'Too many earlier turns.');
  const turns = [];
  for (const t of rawTurns) {
    if (!t || !['user', 'assistant'].includes(t.role) || !isText(t.text)) return bad(400, 'An earlier turn is malformed.');
    const body = clean(t.text);
    if (body.length > COACH_LIMITS.turnChars) return bad(413, 'An earlier turn is too long.');
    turns.push({ role: t.role, text: body });
  }
  if (!isText(f.instruction)) return bad(400, 'Say or type what you want to change.');
  const instruction = clean(f.instruction);
  if (!instruction) return bad(400, 'Say or type what you want to change.');
  if (instruction.length > COACH_LIMITS.instructionChars) return bad(413, `Keep it under ${COACH_LIMITS.instructionChars} characters.`);
  const value = { beat: { id: beat.id, title, text }, beats, spoken: clean(spoken), turns, instruction };
  if (bytes(JSON.stringify(value)) > COACH_LIMITS.bodyBytes) return bad(413, 'This is too much to discuss at once.');
  return { ok: true, value };
}

/**
 * The text the model reads. Every part the person or their speech supplied is fenced and said to be
 * material: the fixed instruction (prompts/live-refine.md) is what tells the model that.
 */
export function composeCoachText(value) {
  const fence = (name, body) => `<<<${name}\n${body}\n${name}>>>`;
  const beats = value.beats.map((b, i) => `${i + 1}. [${b.id}] ${b.title}: ${b.summary}${b.id === value.beat.id ? '  <- CURRENT' : ''}`).join('\n');
  const turns = value.turns.length ? value.turns.map((t) => `${t.role === 'user' ? 'PRESENTER' : 'YAP'}: ${t.text}`).join('\n') : '(none yet)';
  return [
    fence('CURRENT BEAT', `id: ${value.beat.id}\ntitle: ${value.beat.title}\nwords: ${value.beat.text}`),
    fence('ALL BEATS', beats),
    fence('RECENTLY SPOKEN', value.spoken || '(nothing yet)'),
    fence('EARLIER TURNS', turns),
    fence('PRESENTER NOW', value.instruction),
  ].join('\n\n');
}

/** The first balanced JSON object in a reply, ignoring a code fence or words around it. */
function firstObject(text) {
  const src = String(text ?? '');
  for (let start = src.indexOf('{'); start >= 0; start = src.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i += 1) {
      const c = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(src.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
          } catch {
            // not this one; try the next opening brace
          }
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Read the model's actual reply. A reply that is not usable is refused, never repaired: the page then
 * says so and shows no Apply button. `proposal` is only ever for the CURRENT beat, and only whole:
 * an over-long proposal is refused rather than cut.
 * @returns {{ ok: true, answer: string, proposal: null | { beatId: string, text: string } } | { ok: false, reason: string }}
 */
export function parseCoachReply(text, context) {
  const obj = firstObject(text);
  if (!obj) return { ok: false, reason: 'not-json' };
  if (!isText(obj.answer) || !clean(obj.answer)) return { ok: false, reason: 'no-answer' };
  const answer = clean(obj.answer);
  if (answer.length > COACH_LIMITS.answerChars) return { ok: false, reason: 'answer-too-long' };
  const raw = obj.proposal;
  if (raw === undefined || raw === null || raw === '' || (typeof raw === 'object' && !Array.isArray(raw) && raw.text === null)) {
    return { ok: true, answer, proposal: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'bad-proposal' };
  if (raw.beatId !== undefined && raw.beatId !== context.beat.id) return { ok: false, reason: 'other-beat' };
  if (!isText(raw.text)) return { ok: false, reason: 'bad-proposal' };
  const proposed = clean(raw.text);
  if (!proposed) return { ok: true, answer, proposal: null };
  if (proposed.length > COACH_LIMITS.proposalChars) return { ok: false, reason: 'proposal-too-long' };
  if (proposed === context.beat.text) return { ok: true, answer, proposal: null };
  return { ok: true, answer, proposal: { beatId: context.beat.id, text: proposed } };
}

export const REPLY_FAILURES = Object.freeze({
  'not-json': 'YAP answered in a form I could not read. Nothing was changed. Try again.',
  'no-answer': 'YAP sent no usable answer. Nothing was changed. Try again.',
  'answer-too-long': 'YAP\'s answer was too long to show safely. Nothing was changed. Ask for something shorter.',
  'bad-proposal': 'YAP\'s suggested wording was malformed, so it is not offered. Nothing was changed.',
  'other-beat': 'YAP suggested wording for a different beat, so it is not offered. Nothing was changed.',
  'proposal-too-long': 'YAP\'s suggested wording was too long to offer whole. Ask for a shorter version.',
});

// ---------- the revision log ----------

/** A new, empty refinement record for one recording. */
export function createRefinement(recordingId = null) {
  return { version: COACH_VERSION, recordingId, revision: 0, conversation: [], revisions: [], intervals: [] };
}

/**
 * The words a beat shows now, from its original words and the log: replayed, never stored twice.
 * @param {{ revisions: any[] }} state
 */
export function effectiveText(state, beatId, original) {
  let text = original;
  for (const r of state.revisions) if (r.beatId === beatId) text = r.to;
  return text;
}

/** Applied revisions of one beat not yet undone, oldest first. */
function liveStack(state, beatId) {
  const stack = [];
  for (const r of state.revisions) {
    if (r.beatId !== beatId) continue;
    if (r.kind === 'apply') stack.push(r);
    else stack.pop();
  }
  return stack;
}

export const canUndo = (state, beatId) => liveStack(state, beatId).length > 0;

/**
 * Append an Apply. Returns the next record and the revision, never changing `state`.
 * `at` is the clean-take second the new wording begins from; earlier footage keeps the old words.
 */
export function applyRevision(state, { beatId, from, to, at = 0, wallMs = 0 }) {
  if (!isId(beatId) || !isText(to) || !clean(to)) throw new TypeError('A revision needs a beat and its new words.');
  const text = clean(to);
  if (text.length > SAVED_LIMITS.textChars) throw new RangeError('The new words are too long to keep whole.');
  if (state.revisions.length >= SAVED_LIMITS.maxRevisions) throw new RangeError('This recording holds as many revisions as it can keep.');
  const revision = { n: state.revisions.length + 1, kind: 'apply', beatId, from: String(from), to: text, atTakeSeconds: Number(at) || 0, wallMs: Number(wallMs) || 0, scope: 'new-delivery' };
  return { next: { ...state, revisions: [...state.revisions, revision] }, revision };
}

/** Append an Undo of the latest not-yet-undone Apply of this beat: it restores exactly the wording before it. */
export function undoRevision(state, { beatId, at = 0, wallMs = 0 }) {
  const stack = liveStack(state, beatId);
  const last = stack.at(-1);
  if (!last) return null;
  if (state.revisions.length >= SAVED_LIMITS.maxRevisions) throw new RangeError('This recording holds as many revisions as it can keep.');
  const revision = { n: state.revisions.length + 1, kind: 'undo', beatId, from: last.to, to: last.from, undoes: last.n, atTakeSeconds: Number(at) || 0, wallMs: Number(wallMs) || 0, scope: 'new-delivery' };
  return { next: { ...state, revisions: [...state.revisions, revision] }, revision };
}

/** Append a turn to the conversation, keeping the newest SAVED_LIMITS.maxTurns. */
export function appendTurn(state, turn) {
  if (!turn || !['user', 'assistant'].includes(turn.role) || !isText(turn.text)) throw new TypeError('A turn needs a role and words.');
  const text = clean(turn.text).slice(0, SAVED_LIMITS.turnChars);
  const entry = { role: turn.role, text, beatId: turn.beatId && isId(turn.beatId) ? turn.beatId : null, ...(turn.source ? { source: String(turn.source).slice(0, 40) } : {}), ...(turn.proposal ? { proposal: { beatId: turn.proposal.beatId, text: turn.proposal.text } } : {}), ...(turn.error ? { error: true } : {}) };
  return { ...state, conversation: [...state.conversation, entry].slice(-SAVED_LIMITS.maxTurns) };
}

/** The last few turns, in the shape the request carries: failures and empty turns are left out. */
export function recentTurns(state, count = COACH_LIMITS.maxTurns) {
  return state.conversation.filter((t) => !t.error && t.text).slice(-count).map((t) => ({ role: t.role, text: t.text.slice(0, COACH_LIMITS.turnChars) }));
}

/** A one-line summary of a beat for the model. Cut on a word at the limit, with an ellipsis the model can see. */
export function summarize(text, limit = COACH_LIMITS.summaryChars) {
  const t = clean(String(text ?? '')).replace(/\s+/g, ' ');
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit - 1);
  return `${cut.slice(0, Math.max(1, cut.lastIndexOf(' ')))}…`;
}

// ---------- the saved sidecar ----------

/**
 * Check a record the page wants saved. Bounded, shape-checked, never trusted with a path.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string }}
 */
export function validateSaved(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!Number.isInteger(b.baseRevision) || b.baseRevision < 0) return bad(400, 'baseRevision must be a whole number.');
  if (!Array.isArray(b.conversation) || b.conversation.length > SAVED_LIMITS.maxTurns) return bad(413, 'Too many turns to keep.');
  if (!Array.isArray(b.revisions) || b.revisions.length > SAVED_LIMITS.maxRevisions) return bad(413, 'Too many revisions to keep.');
  const intervals = b.intervals === undefined ? [] : b.intervals;
  if (!Array.isArray(intervals) || intervals.length > SAVED_LIMITS.maxIntervals) return bad(413, 'Too many refinement intervals to keep.');
  const conversation = [];
  for (const t of b.conversation) {
    if (!t || !['user', 'assistant'].includes(t.role) || !isText(t.text) || t.text.length > SAVED_LIMITS.turnChars) return bad(400, 'A saved turn is malformed.');
    const entry = { role: t.role, text: t.text, beatId: t.beatId === null || t.beatId === undefined ? null : t.beatId };
    if (entry.beatId !== null && !isId(entry.beatId)) return bad(400, 'A saved turn names a bad beat.');
    if (t.source !== undefined) entry.source = String(t.source).slice(0, 40);
    if (t.error === true) entry.error = true;
    if (t.proposal) {
      if (!isId(t.proposal.beatId) || !isText(t.proposal.text) || t.proposal.text.length > SAVED_LIMITS.textChars) return bad(400, 'A saved proposal is malformed.');
      entry.proposal = { beatId: t.proposal.beatId, text: t.proposal.text };
    }
    conversation.push(entry);
  }
  const revisions = [];
  for (const [i, r] of b.revisions.entries()) {
    if (!r || !['apply', 'undo'].includes(r.kind) || !isId(r.beatId) || !isText(r.from) || !isText(r.to) || r.from.length > SAVED_LIMITS.textChars || r.to.length > SAVED_LIMITS.textChars) return bad(400, 'A saved revision is malformed.');
    if (r.n !== i + 1) return bad(400, 'Revisions must be numbered in order.');
    const at = Number(r.atTakeSeconds);
    if (!Number.isFinite(at) || at < 0 || at > 86400) return bad(400, 'A saved revision has a bad time.');
    revisions.push({ n: r.n, kind: r.kind, beatId: r.beatId, from: r.from, to: r.to, ...(r.kind === 'undo' && Number.isInteger(r.undoes) ? { undoes: r.undoes } : {}), atTakeSeconds: at, wallMs: Number.isFinite(Number(r.wallMs)) ? Number(r.wallMs) : 0, scope: 'new-delivery' });
  }
  const kept = [];
  for (const iv of intervals) {
    const nums = [iv?.cleanSeconds, iv?.uiStartSeconds, iv?.uiEndSeconds];
    if (!iv || !nums.every((n) => n === null || n === undefined || (Number.isFinite(n) && n >= 0 && n <= 86400))) return bad(400, 'A refinement interval is malformed.');
    kept.push({ cleanSeconds: iv.cleanSeconds, uiStartSeconds: iv.uiStartSeconds ?? null, uiEndSeconds: iv.uiEndSeconds ?? null, wallStartMs: Number(iv.wallStartMs) || 0, wallEndMs: Number(iv.wallEndMs) || 0 });
  }
  return { ok: true, value: { baseRevision: b.baseRevision, conversation, revisions, intervals: kept } };
}
