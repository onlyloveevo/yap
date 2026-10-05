// Tests for src/engine/memory.js: Return's keep-or-drop questions, kept notes
// and take 2's first cue (MEM-01, MEM-02; D-24, D-25, D-35).
import test from 'node:test';
import assert from 'node:assert/strict';

// Loaded dynamically so a missing module fails each named test (RED) instead of
// crashing the file at load time.
const mod = await import('../src/engine/memory.js').catch(() => ({}));
const { emptyMemory, returnQuestions, applyReturn, firstCue, MEMORY_DEFAULTS, COPY } = mod;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const NOW = '2026-10-03T09:00:00.000Z';
const N1 = deepFreeze({ id: 'n1', exchangeId: 'x1', text: 'story over tips', prefer: 'story', over: 'tips', status: 'pending' });
const N2 = deepFreeze({ id: 'n2', exchangeId: 'x2', text: 'slower over faster secret-two', prefer: 'slower', over: 'faster', status: 'pending' });

test('module exports the planned API', () => {
  for (const fn of [emptyMemory, returnQuestions, applyReturn, firstCue]) assert.equal(typeof fn, 'function');
  assert.ok(Object.isFrozen(COPY));
  assert.ok(Object.isFrozen(MEMORY_DEFAULTS));
});

test('MEMORY_DEFAULTS.noteMode is ask-at-return (seat default a, one setting)', () => {
  assert.equal(MEMORY_DEFAULTS.noteMode, 'ask-at-return');
});

test('emptyMemory is version 1 with no notes, pace cue on and threshold 170', () => {
  assert.deepEqual(emptyMemory(), { version: 1, notes: [], paceCue: 'on', settings: { paceThreshold: 170 } });
});

test('returnQuestions asks keep-or-once for each pending note, then the pacing question', () => {
  const qs = returnQuestions(deepFreeze([N1]));
  assert.equal(qs.length, 2);
  assert.equal(qs[0].kind, 'note');
  assert.equal(qs[0].noteId, 'n1');
  assert.equal(qs[0].ask, 'Keep for next time, or just this once?');
  assert.deepEqual(qs[0].options.map((o) => o.label), ['Keep for next time', 'Just this once']);
  assert.deepEqual(qs[0].options.map((o) => o.value), ['keep', 'once']);
  assert.equal(qs[1].kind, 'pace');
  assert.equal(qs[1].ask, 'Was the pacing cue helpful?');
  assert.deepEqual(qs[1].options.map((o) => o.label), ['Keep using it', 'Not next time']);
  assert.deepEqual(qs[1].options.map((o) => o.value), ['keep', 'off']);
});

test('with no pending notes, returnQuestions asks only the pacing question', () => {
  const qs = returnQuestions([]);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].ask, 'Was the pacing cue helpful?');
});

test('applyReturn stores only the kept note; a just-this-once note appears nowhere', () => {
  const mem = applyReturn(
    deepFreeze(emptyMemory()),
    deepFreeze({ notes: { n1: 'keep', n2: 'once' }, pace: 'keep' }),
    { pendingNotes: deepFreeze([N1, N2]), now: NOW },
  );
  assert.deepEqual(mem.notes, [{ id: 'n1', text: 'story over tips', prefer: 'story', over: 'tips', keptAt: NOW }]);
  assert.equal(mem.paceCue, 'on');
  assert.ok(!JSON.stringify(mem).includes('secret-two'));
});

test('a note with no answer is not kept', () => {
  const mem = applyReturn(emptyMemory(), { notes: {}, pace: 'keep' }, { pendingNotes: [N1], now: NOW });
  assert.deepEqual(mem.notes, []);
});

test('pace off sets the pace cue off', () => {
  const mem = applyReturn(emptyMemory(), { notes: {}, pace: 'off' }, { pendingNotes: [], now: NOW });
  assert.equal(mem.paceCue, 'off');
});

test('with no pending notes applyReturn changes only the pace preference', () => {
  const before = deepFreeze(applyReturn(emptyMemory(), { notes: { n1: 'keep' }, pace: 'keep' }, { pendingNotes: [N1], now: NOW }));
  const after = applyReturn(before, { notes: {}, pace: 'off' }, { pendingNotes: [], now: '2026-10-04T00:00:00.000Z' });
  assert.deepEqual(after, { ...before, paceCue: 'off' });
});

test('keeping a note with the same prefer/over pair stores it once', () => {
  let mem = applyReturn(emptyMemory(), { notes: { n1: 'keep' }, pace: 'keep' }, { pendingNotes: [N1], now: NOW });
  const again = deepFreeze({ ...N1, id: 'n3', text: 'Story over tips' });
  mem = applyReturn(mem, { notes: { n3: 'keep' }, pace: 'keep' }, { pendingNotes: [again], now: '2026-10-03T10:00:00.000Z' });
  assert.equal(mem.notes.length, 1);
  assert.equal(mem.notes[0].prefer, 'story');
});

test('kept notes are stored in the order kept, newest last', () => {
  const mem = applyReturn(emptyMemory(), { notes: { n1: 'keep', n2: 'keep' }, pace: 'keep' }, { pendingNotes: [N1, N2], now: NOW });
  assert.deepEqual(mem.notes.map((n) => n.id), ['n1', 'n2']);
  const later = applyReturn(
    mem,
    { notes: { n4: 'keep' }, pace: 'keep' },
    { pendingNotes: [{ id: 'n4', text: 'faces over slides', prefer: 'faces', over: 'slides', status: 'pending' }], now: NOW },
  );
  assert.deepEqual(later.notes.map((n) => n.id), ['n1', 'n2', 'n4']);
});

test("noteMode 'this-recording-only' stores no notes and asks only the pacing question", () => {
  const settings = { ...MEMORY_DEFAULTS, noteMode: 'this-recording-only' };
  const mem = applyReturn(emptyMemory(), { notes: { n1: 'keep' }, pace: 'keep' }, { pendingNotes: [N1], now: NOW, settings });
  assert.deepEqual(mem.notes, []);
  assert.equal(returnQuestions([N1], { settings }).length, 1);
});

test('firstCue builds a memory cue from the most recent kept note', () => {
  const mem = applyReturn(emptyMemory(), { notes: { n1: 'keep' }, pace: 'keep' }, { pendingNotes: [N1], now: NOW });
  assert.deepEqual(firstCue(mem), { kind: 'memory', text: 'From last time: story over tips' });
});

test('firstCue reads the newest kept note', () => {
  const mem = applyReturn(emptyMemory(), { notes: { n1: 'keep', n2: 'keep' }, pace: 'keep' }, { pendingNotes: [N1, N2], now: NOW });
  assert.equal(firstCue(mem).text, 'From last time: slower over faster');
});

test('firstCue returns null when memory holds no kept note', () => {
  assert.equal(firstCue(emptyMemory()), null);
});

test('applyReturn does not mutate the memory it is given', () => {
  const mem = deepFreeze(emptyMemory());
  applyReturn(mem, { notes: { n1: 'keep' }, pace: 'off' }, { pendingNotes: [N1], now: NOW });
  assert.deepEqual(mem, emptyMemory());
});
