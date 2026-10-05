import { preparedAngleFields } from '../../src/engine/prepared-angles.js';
import { emptyMemory, applyReturn, firstCue } from '../../src/engine/memory.js';
import { makeBet, checkBet } from '../../src/engine/prediction.js';
import { statusLine, checkInQuestions, trialScope } from '../../src/engine/experiments.js';
import { trialInScope, dueTrialsFor } from '../../src/engine/trial-scope.js';
export const BET_OPEN_LINE = "YAP's bet stays open: this take has no transcript to count restarts in.";

/** A completed detector run with zero proposals is zero; an unanalysed take
 * is unknown. Transcriptless microphone takes must not invent a zero. */
export function restartCount(recording) {
  if (!recording || recording.status !== 'ready') return null;
  if (!recording.transcript?.length) return null;
  return recording.cuts?.cuts?.filter(c => c.kind === 'restart').length ?? null;
}
export function betFor(recording, log = []) { return makeBet(log, { forTake: 'take 2', previousActual: restartCount(recording) }); }

/** Resolve Just talk's original recording without changing persisted metadata. */
export async function memoryMetaForTake(meta, loadRecording) {
  if (!meta || meta.sample || !meta.returnFrom) return meta;
  const lineageIds = [meta.id].filter(Boolean), seen = new Set(lineageIds);
  let current = meta;
  while (current.returnFrom && !seen.has(current.returnFrom)) {
    const id = current.returnFrom; seen.add(id); lineageIds.push(id);
    const saved = await loadRecording(id);
    if (!saved?.meta) throw new Error('Could not establish which idea this saved cue belongs to.');
    current = saved.meta;
  }
  return { ...meta, lineageId: current.id, lineageIds };
}
const scopeOf = meta => meta?.ideaId ? `idea:${meta.ideaId}` : (meta?.lineageId || meta?.id) ? `recording:${meta.lineageId || meta.id}` : null;
const provenance = (recording, meta) => ({ sample: Boolean(meta?.sample), recordingId: recording.id, ...(meta?.ideaId ? { ideaId: meta.ideaId } : {}), ...(scopeOf(meta) ? { scopeId: scopeOf(meta) } : {}) });
export function memoryForTake(memory, meta) {
  const base = memory || emptyMemory();
  return { ...base, notes: (base.notes || []).filter(n => {
    if (meta?.sample) return n.sample !== false;
    if (n.sample === true) return false;
    if (n.scopeId) return n.scopeId === scopeOf(meta);
    if (n.ideaId) return n.ideaId === meta?.ideaId;
    // Legacy notes remain readable in storage; only a known recording lineage
    // can authorize applying them. Missing provenance is never global consent.
    return Boolean(n.recordingId && [meta?.id, ...(meta?.lineageIds || [])].includes(n.recordingId));
  }) };
}
export function keptCueView(memory, meta) {
  const note = memoryForTake(memory, meta).notes.at(-1);
  if (!note || meta?.sample) return null;
  const scope = meta?.ideaId ? 'this idea' : 'this recording’s next takes';
  const summary = note.prefer && note.over ? `${note.prefer} over ${note.over}` : note.text.replace(/^Noted:\s*/i, '');
  return { text: `${meta?.ideaId ? 'This idea' : 'Next takes'}: ${summary}`, description: `Saved for ${scope}. Exact correction: “${note.rawCorrection || note.text}”. Manage or remove it on the Return screen.` };
}
export function pendingNote(recording, memory, meta) {
  const sourceNotes = recording?.notes || [];
  const pending = sourceNotes.find(n => (!n.status || n.status === 'pending') && !memory?.returnDecisions?.[`${recording.id}:${n.id}`]);
  if (pending) return { ...pending, id: `${recording.id}:${pending.id}`, sourceNoteId: pending.id, ...provenance(recording, meta) };
  // When every correction from this take was answered, do not re-offer a
  // discarded correction or replace it with an unrelated prepared cue.
  if (sourceNotes.length) {
    const saved = !meta?.sample && memoryForTake(memory, meta).notes.findLast(n => n.recordingId === recording.id && n.rawCorrection);
    return saved ? { ...saved, stored: true } : null;
  }
  const newest = memoryForTake(memory, meta).notes.at(-1);
  if (newest) return { ...newest, stored: true };
  const moment = recording?.reviewMoments?.find(m => m.decision === 'accepted' && m.suggestedCue);
  if (moment) return { id: moment.id, text: moment.suggestedCue, prefer: null, over: null, ...provenance(recording, meta) };
  const cue = recording?.deliveryCues?.find(c => (c.kind === 'pace' || /slow down/i.test(c.text)) && !memory?.returnDecisions?.[`cue-${recording.id}-${c.id || c.kind}`]);
  return cue ? { id: `cue-${recording.id}-${cue.id || cue.kind}`, text: cue.text, prefer: null, over: null, ...provenance(recording, meta) } : null;
}
const quoted = text => `“${text}”`;
/** The scope this Return belongs to for wording trials: its idea, else its Just-talk chain; none for the bundled sample. */
export const returnTrialScope = (recording, meta) => (!recording || meta?.sample) ? null : trialScope(meta, recording.id);
/** Each due wording trial of this scope as the person is asked, in the engine's own words (checkInQuestions). */
export function checkInItems(trials, recording, meta) {
  const due = dueTrialsFor(trials, returnTrialScope(recording, meta));
  const asked = new Map(checkInQuestions(due).map(q => [q.experimentId, q]));
  return due.filter(t => asked.has(t.id)).map(t => ({ trialId: t.id, ask: asked.get(t.id).ask, keepLabel: `Keep ${quoted(t.change.to)}`, revertLabel: `Return to ${quoted(t.change.from)}`, trial: t }));
}
/** What a decided trial says on the card; the finished videos are never rewritten by it. */
export function decisionLine(trial, meta) {
  const where = meta?.ideaId ? 'Next takes of this idea' : meta?.sample ? 'The next take' : 'Next takes in this recording’s chain';
  if (trial.status === 'kept') return `Kept ${quoted(trial.change.to)}. ${where} start with it. Videos you already recorded are unchanged.`;
  if (trial.status === 'reverted') return `Returned to ${quoted(trial.change.from)}. ${where} start with it. Videos you already recorded are unchanged.`;
  return null;
}
export function returnView({ memory, trials = [], bet, recording, meta, note = pendingNote(recording, memory, meta) }) {
  const scope = returnTrialScope(recording, meta);
  const mine = t => !recording || t.recordings?.includes(recording.id) || trialInScope(t, scope);
  const relevant = [...trials].filter(t => t.recordings?.length && mine(t));
  const trial = [...relevant].reverse().find(t => ['accepted', 'running'].includes(t.status));
  const decided = !trial && [...relevant].reverse().find(t => ['kept', 'reverted'].includes(t.status));
  const checkIns = checkInItems(trials, recording, meta);
  const text = note?.text || '';
  const exact = !meta?.sample && note?.sample !== true && note?.rawCorrection;
  const scopeWords = meta?.ideaId ? 'this idea' : 'this recording’s next takes';
  const separateQuote = exact && (note.stored || exact.length > 120);

  return {
    original: note?.rawCorrection || null,
    exact: Boolean(exact),
    quote: separateQuote ? exact : null,
    title: exact ? (note.stored ? 'Saved correction' : 'Next take') : 'From last time',
    contextLine: exact && !note.stored ? 'Already applied in your finished take.' : null,
    scopeLine: exact ? (note.stored ? `Future takes ${meta?.ideaId ? "of this idea" : "in this recording’s chain"} start with this preference. Removing it stops future reuse; your finished take keeps the correction.` : `Keep uses it on the next take and ${meta?.ideaId ? 'future takes of this idea' : 'later takes in this recording’s chain'}. Finished take only does not carry it forward.`) : null,
    keepLabel: exact ? (note.stored ? (meta?.ideaId ? 'Saved for this idea' : 'Saved for future takes') : 'Keep for future takes') : 'Keep',
    dropLabel: exact ? (note.stored ? 'Remove from future takes' : 'Finished take only') : note?.sourceNoteId ? 'Just this once' : 'Drop',
    question: exact ? (note.stored ? `Saved for ${scopeWords}.` : separateQuote ? 'Use this exact correction again on the next take?' : `Use “${exact}” again on the next take?`) : note ? (/^slow down$/i.test(text) ? 'Last time you wanted to slow down during the opening. Keep that cue?' : `From last time: ${text}. Keep that cue?`) : 'No delivery note saved from this take yet.',
    trialStatus: trial ? `Trying '${trial.change.to}' · ${statusLine(trial)}` : null,
    checkIns,
    decisionLine: decided ? decisionLine(decided, meta) : null,
    betOptional: !meta?.sample && !recording?.transcript?.length,
    betExplanation: 'This finished take has no transcript, so YAP cannot compare restarts between takes. Your correction choice still works.',
    betLine: goalLine(bet, recording),
    note,
  };
}
export function memoryDecision(memory, note, keep, now) {
  const base = structuredClone(memory || emptyMemory());
  if (!note) return base;
  base.returnDecisions = { ...(base.returnDecisions || {}), [note.id]: keep ? 'keep' : 'once' };
  if (!keep) return { ...base, notes: base.notes.filter(n => n.id !== note.id) };
  const other = base.notes.filter(n => (typeof note.sample === 'boolean' && typeof n.sample === 'boolean' && n.sample !== note.sample) || (!note.sample && (n.scopeId || null) !== (note.scopeId || null)));
  const scoped = { ...base, notes: base.notes.filter(n => !other.includes(n)) };
  const next = applyReturn(scoped, { notes: { [note.id]: 'keep' } }, { pendingNotes: [{ ...note, status: 'pending' }], now });
  next.notes = [...other, ...next.notes];
  next.notes = next.notes.map(n => n.id === note.id ? { ...n, ...(typeof note.sample === 'boolean' ? { sample: note.sample } : {}), ...(note.recordingId ? {recordingId: note.recordingId} : {}), ...(note.ideaId ? {ideaId: note.ideaId} : {}), ...(note.scopeId ? {scopeId: note.scopeId} : {}) } : n);
  return next;
}
/** What to aim for on the next take, from the last take's own restart count. Empty when YAP has no count. */
export function goalLine(bet, recording) {
  const last = restartCount(recording);
  if (!bet || last == null) return '';
  return last === 0 ? 'Last take had no restarts. Aim for the same.' : `Last take had ${last} restart${last === 1 ? '' : 's'}. Aim for fewer.`;
}
export function betResultView(bet, actual) {
  if (!bet || actual == null) return { line: BET_OPEN_LINE, nextLine: null };
  const result = checkBet(bet, actual);
  const next = makeBet([{ kind: bet.kind, slack: result.nextSlack }], { forTake: 'the next take', previousActual: actual });
  return { line: result.text, nextLine: next?.text || null };
}
export function take2Request(recording, meta, memory = null) {
  const remembered = firstCue(memoryForTake(memory, meta));
  const cues = structuredClone((recording.deliveryCues || []).filter(c => c.kind !== 'memory' && memory?.returnDecisions?.[`cue-${recording.id}-${c.id || c.kind}`] !== 'once'));
  if (remembered) cues.unshift({ id: 'return-memory', kind: 'memory', text: remembered.text, beatId: recording.beats?.[0]?.id || null });
  return { ideaId: meta?.ideaId || null, sample: Boolean(meta?.sample), title: recording.title, idea: recording.idea, beats: recording.beats.map(b => ({ id: b.id, pointId: b.pointId, title: b.title || b.label, label: b.label || b.title, points: [...(b.points || [])], ...preparedAngleFields(b.preparedAngles), takes: [], chosenTakeId: null, tick: { ticked: false, by: null, reason: null } })), deliveryCues: cues };
}

// ---- the carried lesson: what a person picked in Review to use in their next video ----
//
// It sits beside the kept notes above, as one optional field of memory.json, `carriedLesson`. A kept
// note is a correction a take already applied; a carried lesson is advice accepted in Review. There is
// one at a time. A lesson from a sample review never enters memory.json: it is kept in a file of its own in the
// YAP folder (sample-lesson.json), with a copy in this browser, so a fresh browser on the same folder carries it too.

/**
 * @typedef {object} CarriedLesson
 * @property {string} text                              the lesson, as the person accepted it
 * @property {{ id: string, title: string }} source     the review it came from: its address id and its name
 * @property {string} acceptedAt                        when it was accepted (ISO time)
 */
export const LESSON_MAX_CHARS = 240;
export const SAMPLE_LESSON_KEY = 'yap-sample-lesson-v1';
/** A review of a bundled sample video. Its lessons stay apart from the person's own. */
export const isSampleReview = id => /^sample-/.test(String(id ?? ''));
const lessonError = (name, message) => Object.assign(new Error(message), { name });
const oneLine = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** A whole lesson, or null: half a lesson is no lesson. */
function lessonFrom(value) {
  const text = oneLine(value?.text).slice(0, LESSON_MAX_CHARS), id = oneLine(value?.source?.id), title = oneLine(value?.source?.title);
  const at = new Date(value?.acceptedAt ?? NaN);
  if (!text || !id || !title || Number.isNaN(at.getTime())) return null;
  return { text, source: { id, title }, acceptedAt: at.toISOString() };
}
const sameLesson = (a, b) => Boolean(a && b && a.text === b.text && a.source.id === b.source.id);
function newLesson(lesson, now, sample) {
  if (isSampleReview(lesson?.source?.id) !== sample) throw lessonError('SampleLessonError', 'A sample lesson stays with the sample, and your own lesson stays with you.');
  const next = lessonFrom({ ...lesson, acceptedAt: now });
  if (!next) throw lessonError('EmptyLessonError', 'A lesson needs its words and the review it came from.');
  return next;
}

/** @returns {CarriedLesson | null} the lesson this memory carries */
export const carriedLessonOf = memory => lessonFrom(memory?.carriedLesson);
/** Accept a lesson from a person's own review. The same lesson accepted twice stays as first accepted; another replaces it. */
export function acceptLesson(memory, lesson, now = new Date().toISOString()) {
  const base = memory || emptyMemory(), next = newLesson(lesson, now, false);
  return sameLesson(carriedLessonOf(base), next) ? base : { ...base, carriedLesson: next };
}
export function removeLesson(memory) {
  const { carriedLesson: _removed, ...rest } = memory || emptyMemory();
  return rest;
}
/**
 * Where the lesson is kept: memory.json for a person's own (through getMemory and saveMemory), this
 * browser's storage for a sample. A page picks one by what it is showing, a sample or the person's own.
 * @param {{ sample: boolean, getMemory?: Function, saveMemory?: Function, storage?: Storage, now?: () => string }} deps
 */
/** The YAP folder's keeping of the sample lesson, asked through the app's own API. None outside a page. */
export const SAMPLE_LESSON_API = '/api/app/sample-lesson';
function pageFolder() {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return null;
  const call = async (init) => {
    const res = await fetch(SAMPLE_LESSON_API, { mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', ...init });
    if (!res.ok) throw lessonError('LessonNotKeptError', 'the YAP folder did not keep it');
    return (await res.json()).lesson ?? null;
  };
  return { read: () => call({}), write: (lesson) => call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson }) }) };
}
/**
 * @param {{ sample: boolean, getMemory?: Function, saveMemory?: Function, storage?: Storage, now?: () => string, folder?: null | { read: () => Promise<object | null>, write: (lesson: object | null) => Promise<unknown> } }} deps
 *   `folder`: where the sample lesson is kept beside the browser. Left out, a page uses the YAP folder.
 */
export function lessonStore({ sample, getMemory, saveMemory, storage, now = () => new Date().toISOString(), folder = pageFolder() }) {
  if (!sample) return {
    read: async () => carriedLessonOf(await getMemory()),
    async accept(lesson) { const next = acceptLesson(await getMemory(), lesson, now()); await saveMemory(next); return carriedLessonOf(next); },
    async remove() { await saveMemory(removeLesson(await getMemory())); },
  };
  const read = async () => {
    // The folder is the record: what it holds replaces this browser's copy. When it does not answer, the copy stands.
    if (folder) try {
      const kept = lessonFrom(await folder.read());
      if (kept) storage.setItem(SAMPLE_LESSON_KEY, JSON.stringify(kept)); else storage.removeItem(SAMPLE_LESSON_KEY);
    } catch { /* this browser's copy stands */ }
    try { const kept = lessonFrom(JSON.parse(storage.getItem(SAMPLE_LESSON_KEY))); return kept && isSampleReview(kept.source.id) ? kept : null; } catch { return null; }
  };
  return {
    read,
    async accept(lesson) {
      const next = newLesson(lesson, now(), true), kept = await read();
      if (sameLesson(kept, next)) return kept;
      if (folder) await folder.write(next);
      storage.setItem(SAMPLE_LESSON_KEY, JSON.stringify(next));
      return next;
    },
    async remove() { if (folder) await folder.write(null); storage.removeItem(SAMPLE_LESSON_KEY); },
  };
}
/** True when `kept` is this very suggestion, already accepted. */
export const carriesLesson = (kept, lesson) => sameLesson(kept, lessonFrom({ ...lesson, acceptedAt: kept?.acceptedAt }));

// ---- what YAP is trying with you: the carried lesson and the running experiments, read as one list ----
//
// A lesson is advice the person accepted in Review. An experiment is a wording they asked for in a take
// ("Try for 3 videos"). To the person both are one thing, so every screen reads them through here.

/**
 * The lesson a screen shows and the store it is kept in. A sample take reads the sample's lesson. A
 * person's own screen reads their own, and the one they picked in the sample review when they have none.
 * @param {{ sample: boolean, getMemory?: Function, saveMemory?: Function, storage?: Storage }} deps
 * @returns {Promise<{ lesson: CarriedLesson | null, store: ReturnType<typeof lessonStore> }>}
 */
export async function lessonInUse({ sample, getMemory, saveMemory, storage }) {
  const fromSample = lessonStore({ sample: true, storage });
  if (sample) return { lesson: await fromSample.read(), store: fromSample };
  const own = lessonStore({ sample: false, getMemory, saveMemory });
  const lesson = await own.read();
  if (lesson) return { lesson, store: own };
  const picked = storage ? await fromSample.read() : null;
  return picked ? { lesson: picked, store: fromSample } : { lesson: null, store: own };
}

/** Where a wording experiment stands, in the person's words. */
function experimentDetail(trial) {
  if (trial.status === 'kept') return 'Kept. It is your wording now.';
  if (trial.status === 'check-in due') return `${trial.trialLength} of ${trial.trialLength} videos done.`;
  const done = trial.recordings?.length || 0;
  return `Video ${Math.min(done + (trial.status === 'accepted' ? 1 : 0), trial.trialLength) || 1} of ${trial.trialLength}. YAP asks you after video ${trial.trialLength}.`;
}

/**
 * @typedef {object} TryingItem
 * @property {'lesson' | 'experiment'} kind
 * @property {string} id
 * @property {string} name      the thing being tried, by name
 * @property {string} detail    where it came from or where it stands
 * @property {boolean} sample   it came from the sample review
 * @property {{ trialId: string, ask: string, keepLabel: string, revertLabel: string } | null} checkIn  the question a finished experiment asks
 */
/**
 * Everything YAP is trying with the person, newest experiment first, the lesson on top.
 * @param {{ lesson?: CarriedLesson | null, trials?: object[] }} state
 * @returns {TryingItem[]}
 */
export function tryingItems({ lesson = null, trials = [] } = {}) {
  const items = [];
  if (lesson) items.push({ kind: 'lesson', id: 'lesson', name: lesson.text, detail: `From your review of ${lesson.source.title}`, sample: isSampleReview(lesson.source.id), checkIn: null });
  const asked = new Map(checkInQuestions(trials.filter(t => t?.status === 'check-in due')).map(q => [q.experimentId, q]));
  for (const t of [...trials].reverse()) {
    if (!t?.change?.to || !['accepted', 'running', 'check-in due', 'kept'].includes(t.status)) continue;
    const ask = asked.get(t.id);
    items.push({
      kind: 'experiment', id: t.id, sample: !t.scope,
      name: `Say ${quoted(t.change.to)} instead of ${quoted(t.change.from)}`,
      detail: experimentDetail(t),
      checkIn: ask ? { trialId: t.id, ask: ask.ask, keepLabel: `Keep ${quoted(t.change.to)}`, revertLabel: `Return to ${quoted(t.change.from)}` } : null,
    });
  }
  return items;
}

const mmss = seconds => { const s = Math.max(0, Math.floor((Number(seconds) || 0) + 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const restartsOf = n => n === 0 ? 'no restarts' : `${n} restart${n === 1 ? '' : 's'}`;
/** The length of a take after its applied cuts. */
function cutLength(recording) {
  const cuts = (recording?.cuts?.cuts || []).filter(c => c.applied !== false && c.end > c.start).sort((a, b) => a.start - b.start);
  let removed = 0, at = 0;
  for (const c of cuts) { const from = Math.max(c.start, at); if (c.end > from) { removed += c.end - from; at = c.end; } }
  return Math.max(0, (recording?.duration || 0) - removed);
}
/**
 * One sentence about what changed between a take and the one after it, from what YAP measured in both:
 * restarts when both takes have words, else the length after the cut.
 * @param {object} previous the earlier take's recording
 * @param {object} current the take just finished
 * @param {{ previous?: string, current?: string }} [names] what to call them
 */
export function takeChange(previous, current, { previous: was = 'take 1', current: now = 'Take 2' } = {}) {
  const a = restartCount(previous), b = restartCount(current);
  const Was = was.charAt(0).toUpperCase() + was.slice(1);
  if (a != null && b != null && (a > 0 || b > 0)) {
    if (b === a) return `${now} had ${restartsOf(b)}, the same as ${was}.`;
    if (b === 0) return `${now} had no restarts. ${Was} had ${a}.`;
    return b < a ? `${now} had ${restartsOf(b)}, down from ${a} in ${was}.` : `${now} had ${restartsOf(b)}, up from ${a} in ${was}.`;
  }
  const before = cutLength(previous), after = cutLength(current), diff = Math.round(after - before);
  if (!(after > 0)) return `${now} is saved.`;
  if (!(before > 0) || diff === 0) return `${now} runs ${mmss(after)} after the cut${before > 0 ? `, the same as ${was}` : ''}.`;
  return `${now} runs ${mmss(after)} after the cut, ${Math.abs(diff)} second${Math.abs(diff) === 1 ? '' : 's'} ${diff < 0 ? 'shorter' : 'longer'} than ${was}.`;
}
