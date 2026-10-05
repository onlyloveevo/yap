// Which wording trials belong to which recording (EXP-01). Pure and browser-safe: the page and the server use the same rules.
//
// The counting unit is the existing engine contract (countRecording): each distinct FINISHED recording is one video.
// A recording counts once, however many times its save is retried; exporting never counts. This is a count of finished
// recordings that carried the trial's wording, not of views, and says nothing about how any video performed (D-63).
import { applyWordingTrials } from './experiments.js';

/** A trial counts and shows only in the scope it was accepted in: its idea, else its Just-talk chain. */
export function trialInScope(trial, scope) {
  const own = trial?.scope;
  if (!own || !scope) return false;
  if (typeof own.ideaId === 'string' && own.ideaId) return own.ideaId === scope.ideaId;
  return typeof own.recordingId === 'string' && own.recordingId !== '' && own.recordingId === scope.recordingId;
}

/** The lines of one saved beat that a wording trial could change. */
const beatTexts = beat => [...(beat?.points || []), beat?.preparedAngles?.story, beat?.preparedAngles?.tips].filter(t => typeof t === 'string');

/** Whether any of these lines holds the trial's wording, old or new (the new one once shown, the old one as authored). */
export function textsUseTrial(texts, trial, scope) {
  const change = trial?.change;
  if (!change?.from || !change?.to) return false;
  const forward = [{ ...trial, status: 'running' }];
  const backward = [{ ...trial, status: 'running', change: { from: change.to, to: change.from } }];
  return (texts || []).some(text => typeof text === 'string' && (applyWordingTrials(text, forward, scope) !== text || applyWordingTrials(text, backward, scope) !== text));
}

/** Whether this recording's own authored beats hold the trial's wording, so the trial was really exercised by it. */
export function recordingUsesTrial(recording, trial, scope) {
  return textsUseTrial((recording?.beats || []).flatMap(beatTexts), trial, scope);
}

/** The trials still being counted that apply to this recording's scope, as a deduplicated list (by id). */
export function countableTrials(trials, scope) {
  const seen = new Set(), out = [];
  for (const trial of trials || []) {
    if (!trial || seen.has(trial.id) || !['accepted', 'running'].includes(trial.status) || !trialInScope(trial, scope)) continue;
    seen.add(trial.id);
    out.push(trial);
  }
  return out;
}

/** Merge lists of trials, the first with an id winning. */
export function mergeById(...lists) {
  const seen = new Set(), out = [];
  for (const trial of lists.flat()) {
    if (!trial || seen.has(trial.id)) continue;
    seen.add(trial.id);
    out.push(trial);
  }
  return out;
}

/** A trial that needs the person's check-in decision in this scope (or an unscoped sample trial for a sample take). */
export function dueTrialsFor(trials, scope) {
  return (trials || []).filter(t => t?.status === 'check-in due' && Array.isArray(t.recordings) && t.recordings.length >= t.trialLength && (scope ? trialInScope(t, scope) : !t.scope));
}
