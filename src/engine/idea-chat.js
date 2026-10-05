// Idea conversation: talk a video idea through with YAP, and keep a structure only on purpose.
//
// Pure rules, browser-safe and Node-safe: no network, no storage, no clock of its own.
// It validates the small structured context the page sends for /api/model (task 'ideate'), composes the
// one request the model reads, checks the model's JSON before the page shows it, and runs the saved
// conversation's state machine (server/idea-chat-api.js keeps the file; the rules live here).
//
// The conversation is its own record. It never edits the idea: the person's words stay theirs in the
// idea store, and an outline YAP suggests joins the idea only by an explicit accept that the page then
// writes through the idea store's own keptBeats.

import { preparedAngleFields } from './prepared-angles.js';

/** Bounds, once. server/model.js and the sidecar enforce these; the page uses the same numbers. */
export const IDEA_CHAT_LIMITS = Object.freeze({
  titleChars: 120,
  thoughtChars: 500,
  formatChars: 40,
  wordChars: 500,
  maxWords: 6,
  beatTitleChars: 120,
  beatLineChars: 500,
  maxBeats: 12,
  turnChars: 700,
  maxContextTurns: 8,
  messageChars: 600,
  answerChars: 900,
  outlineMin: 3,
  outlineMax: 7,
  outlineTitleChars: 80,
  outlineBodyChars: 300,
  /** The whole JSON body stays under the endpoint's 16384-byte read limit. */
  bodyBytes: 14000,
});

/** Bounds of the saved conversation. */
export const IDEA_CHAT_SAVED = Object.freeze({
  maxTurns: 200,
  maxAttempts: 5,
  /** How long a claimed question counts as being answered before it may be asked again on purpose. */
  askTtlMs: 45000,
  bodyBytes: 20000,
});

export const FAILURE_REASONS = Object.freeze(['unavailable', 'unreadable', 'timeout', 'error', 'refused']);

const isText = (v) => typeof v === 'string';
const clean = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const bytes = (s) => new TextEncoder().encode(s).length;
const bad = (status, error) => ({ ok: false, status, error });
const BEAT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TURN_ID = /^t[0-9]{1,4}$/;
const CLIENT_ID = /^[a-z0-9-]{8,40}$/;

/**
 * Check what the page sent for task 'ideate'. Nothing is cut: a field over its limit is refused, so
 * no word, beat or turn is silently dropped from what the model reads.
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string }}
 */
export function validateIdeateFields(fields) {
  const L = IDEA_CHAT_LIMITS;
  const f = fields && typeof fields === 'object' ? fields : {};
  const idea = f.idea && typeof f.idea === 'object' ? f.idea : null;
  if (!idea || !isText(idea.thought) || !clean(idea.thought)) return bad(400, 'The idea has no words yet.');
  const thought = clean(idea.thought);
  const title = isText(idea.title) ? clean(idea.title) : '';
  const format = isText(idea.format) ? clean(idea.format) : '';
  if (thought.length > L.thoughtChars || title.length > L.titleChars || format.length > L.formatChars) return bad(413, 'The idea is too long to discuss.');
  const rawWords = f.words === undefined ? [] : f.words;
  if (!Array.isArray(rawWords) || rawWords.length > L.maxWords) return bad(413, 'Too many earlier words.');
  const words = [];
  for (const w of rawWords) {
    if (!isText(w)) return bad(400, 'An earlier word entry is malformed.');
    const body = clean(w);
    if (body.length > L.wordChars) return bad(413, 'An earlier word entry is too long.');
    if (body) words.push(body);
  }
  const rawBeats = f.beats === undefined ? [] : f.beats;
  if (!Array.isArray(rawBeats) || rawBeats.length > L.maxBeats) return bad(413, 'The outline is too long to discuss.');
  const beats = [];
  for (const b of rawBeats) {
    if (!b || !isText(b.title) || !isText(b.line)) return bad(400, 'A beat in the outline is malformed.');
    const t = clean(b.title);
    const line = clean(b.line);
    if (t.length > L.beatTitleChars || line.length > L.beatLineChars) return bad(413, 'A beat in the outline is too long.');
    beats.push({ title: t, line });
  }
  const rawTurns = f.turns === undefined ? [] : f.turns;
  if (!Array.isArray(rawTurns) || rawTurns.length > L.maxContextTurns) return bad(413, 'Too many earlier turns.');
  const turns = [];
  for (const t of rawTurns) {
    if (!t || !['user', 'assistant'].includes(t.role) || !isText(t.text)) return bad(400, 'An earlier turn is malformed.');
    const body = clean(t.text);
    if (body.length > L.turnChars) return bad(413, 'An earlier turn is too long.');
    if (body) turns.push({ role: t.role, text: body });
  }
  if (!isText(f.message) || !clean(f.message)) return bad(400, 'Say or type something to talk about.');
  const message = clean(f.message);
  if (message.length > L.messageChars) return bad(413, `Keep it under ${L.messageChars} characters.`);
  const value = { idea: { title, thought, format }, words, beats, turns, message };
  if (bytes(JSON.stringify(value)) > L.bodyBytes) return bad(413, 'This is too much to discuss at once.');
  return { ok: true, value };
}

/** The text the model reads. Every part the person supplied is fenced and said to be material by prompts/idea-chat.md. */
export function composeIdeateText(value) {
  const fence = (name, body) => `<<<${name}\n${body}\n${name}>>>`;
  const list = (items, empty) => (items.length ? items.join('\n') : empty);
  const outline = value.beats.map((b, i) => `${i + 1}. ${b.title}: ${b.line}`);
  const turns = value.turns.map((t) => `${t.role === 'user' ? 'PERSON' : 'YAP'}: ${t.text}`);
  return [
    fence('THE IDEA', `title: ${value.idea.title || '(none)'}\nformat: ${value.idea.format || '(not chosen)'}\nfirst thought: ${value.idea.thought}`),
    fence('THEIR OTHER WORDS', list(value.words.map((w) => `- ${w}`), '(none)')),
    fence('CURRENT OUTLINE', list(outline, '(none yet)')),
    fence('EARLIER TURNS', list(turns, '(none yet)')),
    fence('THEY SAY NOW', value.message),
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
 * Check an answer and its optional outline. Used on the model's reply and again on what the page saves.
 * An over-long answer or beat is refused, never cut. An outline must be whole: 3 to 7 beats.
 * @returns {{ ok: true, answer: string, outline: null | { title: string, body: string }[] } | { ok: false, reason: string }}
 */
export function checkReply(obj) {
  const L = IDEA_CHAT_LIMITS;
  if (!obj || typeof obj !== 'object' || !isText(obj.answer) || !clean(obj.answer)) return { ok: false, reason: 'no-answer' };
  const answer = clean(obj.answer);
  if (answer.length > L.answerChars) return { ok: false, reason: 'answer-too-long' };
  const raw = obj.outline;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, answer, outline: null };
  if (!Array.isArray(raw)) return { ok: false, reason: 'bad-outline' };
  if (raw.length < L.outlineMin || raw.length > L.outlineMax) return { ok: false, reason: 'outline-size' };
  const outline = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object' || !isText(b.title) || !isText(b.body)) return { ok: false, reason: 'bad-outline' };
    const title = clean(b.title);
    const body = clean(b.body);
    if (!title || !body) return { ok: false, reason: 'bad-outline' };
    if (title.length > L.outlineTitleChars || body.length > L.outlineBodyChars) return { ok: false, reason: 'outline-too-long' };
    outline.push({ title, body });
  }
  return { ok: true, answer, outline };
}

/** Read the model's actual reply. A reply that is not usable is refused, never repaired. */
export function parseIdeateReply(text) {
  const obj = firstObject(text);
  if (!obj) return { ok: false, reason: 'not-json' };
  return checkReply(obj);
}

export const REPLY_FAILURES = Object.freeze({
  'not-json': 'YAP answered in a form I could not read. Your words are saved. Try again.',
  'no-answer': 'YAP sent no usable answer. Your words are saved. Try again.',
  'answer-too-long': 'YAP\'s answer was too long to show safely. Your words are saved. Try again.',
  'bad-outline': 'YAP\'s suggested beats were malformed, so they are not offered. Your words are saved.',
  'outline-size': 'YAP\'s suggested beats were not 3 to 7, so they are not offered. Your words are saved.',
  'outline-too-long': 'YAP\'s suggested beats were too long to offer whole. Your words are saved.',
});

/** What the person is told for each way a question can fail. Nothing is simulated in its place. */
export const FAILURE_COPY = Object.freeze({
  unavailable: 'YAP could not reach Claude Code on this computer, so there is no reply. Your words are saved and still yours to edit.',
  unreadable: 'YAP got a reply it could not read safely. Your words are saved. You can try again.',
  timeout: 'YAP did not answer in time. Your words are saved. You can try again.',
  error: 'Something went wrong asking YAP. Your words are saved. You can try again.',
  refused: 'YAP could not take that message. Your words are saved. Try a shorter one.',
  superseded: 'You moved on before this one was answered.',
});

// ---------- the saved conversation ----------

/** A new, empty conversation record for one idea. */
export function createChatRecord(ideaId = null) {
  return { version: 1, ideaId, revision: 0, turns: [], accepted: null };
}

/** The kept-beat rows an outline becomes: the id rule of the idea store, the body as the line. */
export function outlineToKept(outline) {
  return outline.map((b, i) => ({ id: `yap-${i + 1}`, title: b.title, line: b.body }));
}

/** Is this turn's question being answered right now, as far as the record can tell? */
export function isFresh(turn, now) {
  return turn.status === 'asking' && Number.isFinite(turn.claimedAt) && now - turn.claimedAt < IDEA_CHAT_SAVED.askTtlMs;
}

/** The newest user turn, or null. */
export function lastUserTurn(record) {
  for (let i = record.turns.length - 1; i >= 0; i -= 1) if (record.turns[i].role === 'user') return record.turns[i];
  return null;
}

/** The turns before `turnId` that carry words, in the shape the request wants: failures and unanswered turns are left out. */
export function contextTurns(record, turnId, count = IDEA_CHAT_LIMITS.maxContextTurns) {
  const index = record.turns.findIndex((t) => t.id === turnId);
  const before = index < 0 ? record.turns : record.turns.slice(0, index);
  const used = before.filter((t) => t.role === 'assistant' || t.status === 'answered');
  return used.slice(-count).map((t) => ({ role: t.role, text: t.text.slice(0, IDEA_CHAT_LIMITS.turnChars) }));
}

const conflict = (error, extra) => ({ ok: false, status: 409, error, ...extra });
const find = (record, id) => (isText(id) && TURN_ID.test(id) ? record.turns.find((t) => t.id === id) : undefined);
const nextId = (record) => `t${record.turns.reduce((n, t) => Math.max(n, Number(t.id.slice(1))), 0) + 1}`;

/**
 * Apply one operation to a record. Pure: returns a new record, never changing the one handed in.
 * The page can only ask for these steps, so it cannot rewrite history, answer a question that is not
 * being asked, or accept words YAP never proposed.
 * @returns {{ ok: true, record: object, result?: object } | { ok: false, status: number, error: string }}
 */
export function applyChatOp(record, op, now) {
  const L = IDEA_CHAT_LIMITS;
  const body = op && typeof op === 'object' ? op : {};
  const at = new Date(now).toISOString();
  const done = (turns, extra = {}, result) => ({ ok: true, record: { ...record, revision: record.revision + 1, turns, ...extra }, ...(result ? { result } : {}) });
  const swap = (id, change) => record.turns.map((t) => (t.id === id ? { ...t, ...change } : t));

  if (body.op === 'send') {
    if (!isText(body.text) || !clean(body.text)) return bad(400, 'Say or type something first.');
    const text = clean(body.text);
    if (text.length > L.messageChars) return bad(413, `Keep it under ${L.messageChars} characters.`);
    if (!isText(body.clientId) || !CLIENT_ID.test(body.clientId)) return bad(400, 'A send needs its own id.');
    const origin = body.origin === 'thought' ? 'thought' : 'follow-up';
    const again = record.turns.find((t) => t.role === 'user' && t.clientId === body.clientId);
    if (again) return { ok: true, record, result: { turn: again, duplicate: true } };
    if (body.baseRevision !== undefined && body.baseRevision !== record.revision) return conflict('This conversation changed in another tab. It has been reloaded; send again if you still want to.', { current: record });
    if (origin === 'thought' && record.turns.length) return conflict('This idea already has a conversation.', { current: record });
    if (record.turns.some((t) => isFresh(t, now))) return conflict('YAP is still answering your last message.', { current: record });
    if (record.turns.length + 2 > IDEA_CHAT_SAVED.maxTurns) return bad(413, 'This conversation is as long as it can be kept.');
    // A newer message supersedes anything still waiting: nothing old is ever asked behind the person's back.
    const waiting = record.turns.map((t) => (t.role === 'user' && ['pending', 'asking'].includes(t.status) ? { ...t, status: 'failed', failure: 'superseded' } : t));
    const turn = { id: nextId(record), role: 'user', text, origin, clientId: body.clientId, status: 'pending', attempts: 0, at };
    return { ...done([...waiting, turn]), result: { turn } };
  }

  if (body.op === 'claim') {
    const turn = find(record, body.turnId);
    if (!turn || turn.role !== 'user') return bad(404, 'No such message.');
    if (lastUserTurn(record)?.id !== turn.id) return conflict('That message is no longer the latest one.', { current: record });
    const retry = body.retry === true;
    if (turn.status === 'answered') return { ok: true, record, result: { claimed: false, turn } };
    const stale = turn.status === 'asking' && !isFresh(turn, now);
    const allowed = turn.status === 'pending' || (retry && (turn.status === 'failed' || stale) && turn.failure !== 'superseded');
    if (!allowed) return { ok: true, record, result: { claimed: false, turn } };
    if (turn.attempts >= IDEA_CHAT_SAVED.maxAttempts) return conflict('That message has been tried as often as it can be. Send it again as a new message.', { current: record });
    const next = { status: 'asking', claimedAt: now, attempts: turn.attempts + 1, failure: undefined };
    return { ...done(swap(turn.id, next)), result: { claimed: true, turn: { ...turn, ...next } } };
  }

  if (body.op === 'reply') {
    const turn = find(record, body.turnId);
    if (!turn || turn.role !== 'user') return bad(404, 'No such message.');
    if (turn.status !== 'asking') return conflict('That question is no longer being asked, so the reply was not kept.', { current: record });
    if (!isText(body.source) || !/^[a-z][a-z-]{0,39}$/.test(body.source)) return bad(400, 'A reply names where it came from.');
    const checked = checkReply(body);
    if (!checked.ok) return bad(400, REPLY_FAILURES[checked.reason] || 'The reply was not usable.');
    const reply = { id: nextId(record), role: 'assistant', replyTo: turn.id, text: checked.answer, source: body.source, at, ...(checked.outline ? { outline: { beats: checked.outline, status: 'open' } } : {}) };
    return { ...done([...swap(turn.id, { status: 'answered', claimedAt: undefined, failure: undefined }), reply]), result: { turn: reply } };
  }

  if (body.op === 'fail') {
    const turn = find(record, body.turnId);
    if (!turn || turn.role !== 'user') return bad(404, 'No such message.');
    if (turn.status !== 'asking') return conflict('That question is no longer being asked.', { current: record });
    if (!FAILURE_REASONS.includes(body.reason)) return bad(400, 'Unknown failure.');
    return done(swap(turn.id, { status: 'failed', failure: body.reason, claimedAt: undefined }));
  }

  if (body.op === 'accept' || body.op === 'dismiss' || body.op === 'undo') {
    if (body.op === 'undo') {
      if (!record.accepted || record.accepted.undone) return conflict('There is no applied outline to undo.', { current: record });
      const turns = record.turns.map((t) => (t.id === record.accepted.turnId && t.outline ? { ...t, outline: { ...t.outline, status: 'undone' } } : t));
      return { ...done(turns, { accepted: { ...record.accepted, undone: true, undoneAt: at } }) };
    }
    const turn = find(record, body.turnId);
    if (!turn || turn.role !== 'assistant' || !turn.outline) return bad(404, 'No such suggestion.');
    if (body.op === 'dismiss') {
      if (turn.outline.status !== 'open') return conflict('That suggestion was already dealt with.', { current: record });
      return done(swap(turn.id, { outline: { ...turn.outline, status: 'dismissed' } }));
    }
    if (!['open', 'undone'].includes(turn.outline.status)) return conflict('That suggestion was already dealt with.', { current: record });
    const previous = Array.isArray(body.previous) ? body.previous : null;
    if (!previous || previous.length > L.maxBeats) return bad(400, 'Accepting needs the outline it replaces.');
    const kept = [];
    for (const p of previous) {
      if (!p || !isText(p.id) || !BEAT_ID.test(p.id) || !isText(p.title) || !isText(p.line) || p.title.length > L.beatTitleChars || p.line.length > L.beatLineChars) return bad(400, 'The outline it replaces is malformed.');
      let angles = {};
      try { angles = preparedAngleFields(p.preparedAngles); } catch { return bad(400, 'The outline it replaces is malformed.'); }
      kept.push({ id: p.id, title: p.title, line: p.line, ...angles });
    }
    const accepted = { turnId: turn.id, beats: turn.outline.beats, previous: kept, at, undone: false, provenance: 'yap-suggestion' };
    return done(swap(turn.id, { outline: { ...turn.outline, status: 'applied' } }), { accepted });
  }

  return bad(400, 'Unknown step.');
}

/** Check a record read from disk: a damaged one is replaced by an empty one rather than trusted. */
export function readableRecord(kept, ideaId) {
  const empty = createChatRecord(ideaId);
  if (!kept || typeof kept !== 'object' || !Array.isArray(kept.turns) || !Number.isInteger(kept.revision)) return empty;
  return { ...empty, ...kept, ideaId };
}
