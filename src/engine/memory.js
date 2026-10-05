// Return: keep-or-drop questions for each pending note plus the pacing
// question; only kept notes enter memory; take 2's first cue comes from the
// newest kept note (MEM-01, MEM-02; D-24, D-25, D-35).
//
// Pure and browser-safe: imports nothing and never mutates its inputs. The
// session reads and writes memory.json through src/node/store.js.

/**
 * @typedef {{ id: string, exchangeId?: string, text: string, prefer?: string | null, over?: string | null, status?: string }} Note
 * @typedef {{ id: string, text: string, prefer: string | null, over: string | null, keptAt: string }} KeptNote
 * @typedef {{ version: 1, notes: KeptNote[], paceCue: 'on' | 'off', settings: { paceThreshold: number } }} Memory
 * @typedef {{ notes?: { [noteId: string]: 'keep' | 'once' }, pace?: 'keep' | 'off' }} ReturnAnswers
 * @typedef {{ noteMode?: 'ask-at-return' | 'this-recording-only' }} MemorySettings
 */

/**
 * Seat default (a) of D-35, one setting: a remark is noted at once and kept or
 * dropped at Return. 'this-recording-only' is the alternative from his GPT's
 * draft: notes last for this recording and never enter memory.
 */
export const MEMORY_DEFAULTS = Object.freeze({ noteMode: 'ask-at-return' });

/** Every word the person sees at Return and in take 2's memory cue. */
export const COPY = Object.freeze({
  noteAsk: 'Keep for next time, or just this once?',
  noteKeep: 'Keep for next time',
  noteOnce: 'Just this once',
  paceAsk: 'Was the pacing cue helpful?',
  paceKeep: 'Keep using it',
  paceOff: 'Not next time',
  cueTemplate: 'From last time: {prefer} over {over}',
  cueTextTemplate: 'From last time: {text}',
});

const NOTE_MODES = Object.freeze(['ask-at-return', 'this-recording-only']);

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function settingsOf(settings) {
  const s = { ...MEMORY_DEFAULTS, ...(settings || {}) };
  if (!NOTE_MODES.includes(s.noteMode)) {
    throw namedError('UnknownNoteModeError', `noteMode must be one of ${NOTE_MODES.join(', ')} (got "${s.noteMode}")`);
  }
  return s;
}

/** Fill {name} slots literally (a function replacer, so `$` in a note is kept as typed). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

function isPending(note) {
  return note && (!note.status || note.status === 'pending');
}

function noteKey(note) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  if (note.prefer || note.over) return `pair:${norm(note.prefer)}|${norm(note.over)}`;
  return `text:${norm(note.text)}`;
}

/** @returns {Memory} */
export function emptyMemory() {
  return { version: 1, notes: [], paceCue: 'on', settings: { paceThreshold: 170 } };
}

/**
 * The questions Return asks: one per pending note (only when notes can be
 * kept), then the pacing question, which is always asked (D-24).
 * @param {Note[]} pendingNotes
 * @param {{ settings?: MemorySettings }} [options]
 */
export function returnQuestions(pendingNotes, { settings } = {}) {
  const s = settingsOf(settings);
  const questions = [];
  if (s.noteMode === 'ask-at-return') {
    for (const note of (pendingNotes || []).filter(isPending)) {
      questions.push({
        kind: 'note',
        noteId: note.id,
        text: note.text,
        ...(typeof note.rawCorrection === 'string' ? {rawCorrection: note.rawCorrection} : {}),
        ...(typeof note.appliedFrom === 'string' ? {appliedFrom: note.appliedFrom} : {}),
        ask: COPY.noteAsk,
        options: [
          { value: 'keep', label: COPY.noteKeep },
          { value: 'once', label: COPY.noteOnce },
        ],
      });
    }
  }
  questions.push({
    kind: 'pace',
    ask: COPY.paceAsk,
    options: [
      { value: 'keep', label: COPY.paceKeep },
      { value: 'off', label: COPY.paceOff },
    ],
  });
  return questions;
}

/**
 * Apply the person's Return answers. Only notes answered 'keep' enter memory;
 * a note answered 'once', or not answered, leaves no trace. A kept note with
 * the same prefer/over pair as one already kept is stored once, as the newest.
 * @param {Memory} memory
 * @param {ReturnAnswers} answers
 * @param {{ pendingNotes?: Note[], now?: string, settings?: MemorySettings }} [options]
 * @returns {Memory}
 */
export function applyReturn(memory, answers, { pendingNotes = [], now, settings } = {}) {
  const s = settingsOf(settings);
  const base = memory || emptyMemory();
  let notes = base.notes.map((n) => ({ ...n }));
  const noteAnswers = (answers && answers.notes) || {};
  if (s.noteMode === 'ask-at-return') {
    const keptAt = now || new Date().toISOString();
    for (const note of (pendingNotes || []).filter(isPending)) {
      if (noteAnswers[note.id] !== 'keep') continue;
      const key = noteKey(note);
      notes = notes.filter((n) => noteKey(n) !== key);
      notes.push({
        id: note.id,
        text: note.text,
        ...(typeof note.rawCorrection === 'string' ? {rawCorrection: note.rawCorrection} : {}),
        ...(typeof note.appliedFrom === 'string' ? {appliedFrom: note.appliedFrom} : {}),
        prefer: note.prefer == null ? null : note.prefer,
        over: note.over == null ? null : note.over,
        keptAt,
      });
    }
  }
  let paceCue = base.paceCue;
  if (answers && answers.pace === 'keep') paceCue = 'on';
  if (answers && answers.pace === 'off') paceCue = 'off';
  return { ...base, notes, paceCue, settings: { ...base.settings } };
}

/**
 * Take 2's first cue: built from the newest kept note, or null when memory
 * holds none (D-25).
 * @param {Memory} memory
 * @returns {{ kind: 'memory', text: string } | null}
 */
export function firstCue(memory) {
  const notes = (memory && memory.notes) || [];
  const newest = notes[notes.length - 1];
  if (!newest) return null;
  const text =
    newest.prefer && newest.over
      ? fill(COPY.cueTemplate, { prefer: newest.prefer, over: newest.over })
      : fill(COPY.cueTextTemplate, { text: newest.text });
  return { kind: 'memory', text };
}
