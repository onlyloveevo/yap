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
    betLine: bet?.text || 'A restart bet needs a take with a transcript first.',
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
