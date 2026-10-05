// What the prepare stand-in shows for an idea (Plan 02-05; D-122 to D-126), as
// pure functions: no page, no server and no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loaded dynamically so a missing module fails each named test instead of
// crashing the file at load time.
const model = await import('../ui/lib/prepare-model.js').catch(() => ({}));
const { prepareView, SAMPLE_TAKE_LABEL } = model;
const { defaultBeats, limitBeats, BEAT_LIMITS } = await import('../src/engine/setup-beats.js');

const bank = JSON.parse(fs.readFileSync(path.join(appRoot, 'ui', 'data', 'idea-bank.json'), 'utf8')).ideas;
const sample = bank.find((idea) => idea.id === 'sample');
const second = bank.find((idea) => idea.id === 'idea-2');

/** The sample idea as the idea store gives it once these beats were kept on the beat list. */
function sampleKeeping(ids) {
  const keptBeats = ids.map((id) => {
    const beat = sample.beats.find((b) => b.id === id);
    return { id: beat.id, title: beat.title, line: beat.line };
  });
  return { ...structuredClone(sample), keptBeats };
}
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
/** The engine's default beats as the stand-in shows a beat: its label and its talking points. */
const shownDefaults = () => defaultBeats().map((beat) => ({ label: beat.label, points: beat.points }));

test('prepareView for an idea with three kept beats gives those three in order, each title as the label and each line as its one point', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  const view = prepareView(sampleKeeping(['hours', 'delay', 'never']));
  assert.equal(view.title, 'Why I keep putting off filming', 'the idea\'s own title (D-122)');
  assert.deepEqual(view.beats, [
    { label: 'Hours of planning', points: ['I planned for hours'] },
    { label: 'Planning becomes the delay', points: ['Planning can become a way to'] },
    { label: 'Never pressed record', points: ['I never pressed record'] },
  ], 'the kept beats in the kept order, each line a memory trigger: its first six words, with no full stop');
});

test('prepareView for an idea with no kept beat gives the engine\'s default beats', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  const none = prepareView({ ...structuredClone(second), keptBeats: [] });
  assert.equal(none.title, second.title);
  assert.deepEqual(none.beats, shownDefaults(), 'Hook, Story, Point, Takeaway, with no talking point');
  assert.deepEqual(none.beats.map((beat) => beat.label), ['Hook', 'Story', 'Point', 'Takeaway']);
  // A kept list that is missing, or is not a list, is no kept beat either.
  const { keptBeats, ...without } = structuredClone(second);
  assert.deepEqual(prepareView(without).beats, shownDefaults());
  assert.deepEqual(prepareView({ ...without, keptBeats: 'hours' }).beats, shownDefaults());
  // No idea at all: the default beats and no title.
  for (const nothing of [null, undefined, 'sample', 7]) {
    const view = prepareView(nothing);
    assert.equal(view.title, '');
    assert.deepEqual(view.beats, shownDefaults());
    assert.equal(view.showSampleButton, false);
  }
});

test('a talking point is never longer than BEAT_LIMITS allows, and a kept beat with no line has no talking point', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  const long = 'one two three four five six seven eight nine ten eleven twelve';
  const view = prepareView({
    id: 'idea-7',
    title: 'Mine',
    keptBeats: [
      { id: 's1', title: 'Hook', line: '' },
      { id: 's2', title: 'A long one', line: long },
      { id: 's3', title: 'Not text', line: 7 },
      { id: 's4', title: 'Spaces', line: '   ' },
    ],
  });
  assert.deepEqual(view.beats, [
    { label: 'Hook', points: [] },
    { label: 'A long one', points: ['one two three four five six'] },
    { label: 'Not text', points: [] },
    { label: 'Spaces', points: [] },
  ]);
  for (const beat of [...view.beats, ...prepareView(sampleKeeping(['hours', 'never', 'delay', 'imperfect', 'first-step'])).beats]) {
    assert.ok(beat.points.length <= BEAT_LIMITS.pointsPerBeat, `${beat.label}: ${beat.points.length} points`);
    for (const point of beat.points) assert.ok(words(point) <= BEAT_LIMITS.pointWords, `"${point}" is over ${BEAT_LIMITS.pointWords} words`);
    // The cut is the engine's own: what limitBeats leaves of a point is what is shown.
    assert.deepEqual(limitBeats([{ label: 'x', points: beat.points }]).beats.find((b) => b.source === 'model').points, beat.points);
  }
});

test('a kept beat that is not a beat is passed over, and one with no title is shown by its id', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  const view = prepareView({ id: 'idea-7', title: 'Mine', keptBeats: [null, 'hours', { id: 's1', title: '', line: 'Say it plainly' }, { id: 's2', title: 'Story', line: 'x' }] });
  assert.deepEqual(view.beats, [{ label: 's1', points: ['Say it plainly'] }, { label: 'Story', points: ['x'] }]);
  // Entries that are all not beats leave nothing kept: the default beats.
  assert.deepEqual(prepareView({ id: 'idea-7', title: 'Mine', keptBeats: [null, 4] }).beats, shownDefaults());
});

test('showSampleButton is true only for the idea sample', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  assert.equal(prepareView(sampleKeeping(['hours', 'never'])).showSampleButton, true);
  assert.equal(prepareView({ ...structuredClone(sample), keptBeats: [] }).showSampleButton, true, 'also with nothing kept');
  for (const other of bank.filter((idea) => idea.id !== 'sample')) assert.equal(prepareView(other).showSampleButton, false, other.id);
  assert.equal(prepareView({ id: 'idea-7', title: 'Why I keep putting off filming', keptBeats: [] }).showSampleButton, false, 'the id decides, never the title');
  assert.equal(prepareView({ id: 'Sample', title: 'x' }).showSampleButton, false);
});

test('prepareView says which idea it shows, changes nothing it is given and gives a fresh answer each time', () => {
  assert.equal(typeof prepareView, 'function', 'ui/lib/prepare-model.js exports prepareView');
  const idea = sampleKeeping(['hours', 'never']);
  const before = structuredClone(idea);
  const one = prepareView(idea);
  assert.deepEqual(idea, before, 'the idea is not changed');
  assert.equal(one.ideaId, 'sample');
  assert.equal(prepareView({ title: 'No id' }).ideaId, null);
  one.beats[0].points.push('changed');
  one.beats.pop();
  assert.deepEqual(prepareView(idea).beats.map((beat) => [beat.label, beat.points.length]), [['Hours of planning', 1], ['Never pressed record', 1]]);
  const defaults = prepareView(null);
  defaults.beats[0].points.push('changed');
  assert.deepEqual(prepareView(null).beats, shownDefaults(), 'and the engine\'s default beats are not changed either');
});

test('SAMPLE_TAKE_LABEL says, character for character, that the sample take is a different video (D-123, D-124)', () => {
  assert.equal(SAMPLE_TAKE_LABEL, 'Try the sample take (a different video: How I plan a video in twenty minutes)');
  // The video it names is the bundled sample take's own idea.
  const brief = JSON.parse(fs.readFileSync(path.join(appRoot, 'sample', 'brief.json'), 'utf8'));
  assert.ok(SAMPLE_TAKE_LABEL.includes(`a different video: ${brief.idea})`), 'the label names the sample take\'s own idea in full');
});

// ---------- the Recording the stand-in asks for (Task 2; D-124, D-126, D-127) ----------

const { recordingRequest, recentRows } = model;
const { createRecording, validateRecording, recordingBeats } = await import('../src/engine/recording.js');
const { createEpisode } = await import('../src/engine/episode.js');
const { chooseDeliveryCues } = await import('../src/engine/delivery.js');
const { deliveryFromSetup } = await import('../src/engine/session.js');

const readSample = (name) => JSON.parse(fs.readFileSync(path.join(appRoot, 'sample', name), 'utf8'));
/** The request as the server turns it into a record: the id and the time are the server's. */
const asRecord = (request) => createRecording({ id: 'rec-test-1', title: request.title, idea: request.idea, beats: request.beats, deliveryCues: request.deliveryCues, now: '2026-10-03T12:00:00.000Z' });

test('recordingRequest for an own take gives the idea\'s title, its beats with their takes, and the pressed cues through chooseDeliveryCues', () => {
  assert.equal(typeof recordingRequest, 'function', 'ui/lib/prepare-model.js exports recordingRequest');
  const view = prepareView(sampleKeeping(['hours', 'delay', 'never']));
  const request = recordingRequest(view, ['slow-down', 'land-the-point'], { sample: false });
  assert.deepEqual(Object.keys(request).sort(), ['beats', 'deliveryCues', 'idea', 'ideaId', 'sample', 'title']);
  assert.equal(request.ideaId, 'sample', 'the idea it was prepared from');
  assert.equal(request.title, 'Why I keep putting off filming');
  assert.equal(request.idea, 'Why I keep putting off filming');
  assert.equal(request.sample, false);
  // The beats are the engine's own shape: one episode beat per shown beat, with no take yet, plus the label and the talking points.
  assert.deepEqual(request.beats.map((beat) => [beat.id, beat.label, beat.points, beat.takes]), [
    ['b1', 'Hours of planning', ['I planned for hours'], []],
    ['b2', 'Planning becomes the delay', ['Planning can become a way to'], []],
    ['b3', 'Never pressed record', ['I never pressed record'], []],
  ]);
  const story = view.beats.map((beat, i) => ({ id: `s${i + 1}`, label: beat.label, points: beat.points }));
  const episode = createEpisode({ points: story.map((beat) => ({ id: beat.id, title: beat.label })) });
  assert.deepEqual(request.beats, recordingBeats(story, episode));
  // The cues: the engine's own choice for these picks, dealt to the beats in order.
  assert.deepEqual(request.deliveryCues, chooseDeliveryCues([{ kind: 'slow-down' }, { kind: 'land-the-point' }], episode.beats).cues);
  assert.deepEqual(request.deliveryCues.map((cue) => [cue.kind, cue.text, cue.beatId]), [['slow-down', 'Slow down', 'b1'], ['land-the-point', 'Land the point', 'b2']]);
  const record = asRecord(request);
  assert.deepEqual(validateRecording(record), { ok: true, errors: [] }, 'the engine accepts the record made from it');
  assert.equal(record.status, 'draft');
});

test('with no cue pressed the request has no delivery cue, and the engine accepts it; more than three is the engine\'s own refusal', () => {
  assert.equal(typeof recordingRequest, 'function', 'ui/lib/prepare-model.js exports recordingRequest');
  const view = prepareView({ ...structuredClone(second), keptBeats: [] });
  for (const none of [[], undefined, null]) {
    const request = recordingRequest(view, none, { sample: false });
    assert.deepEqual(request.deliveryCues, [], 'no cue is chosen for the person');
    assert.deepEqual(request.beats.map((beat) => beat.label), ['Hook', 'Story', 'Point', 'Takeaway']);
    assert.equal(validateRecording(asRecord(request)).ok, true);
  }
  assert.deepEqual(recordingRequest(view, ['smile', 'pause', 'look-at-lens']).deliveryCues.map((cue) => cue.beatId), ['b1', 'b2', 'b3'], 'three cues, one per beat in order; left out, the take is the person\'s own');
  assert.equal(recordingRequest(view, ['smile']).sample, false);
  assert.throws(() => recordingRequest(view, ['smile', 'pause', 'look-at-lens', 'slow-down'], { sample: false }), { name: 'DeliveryCueCountError' });
  assert.throws(() => recordingRequest(view, ['smile', 'smile'], { sample: false }), { name: 'DeliveryCueKindError' });
  assert.throws(() => recordingRequest(view, ['shout'], { sample: false }), { name: 'DeliveryCueKindError' });
});

test('recordingRequest for a take started at /prepare/new: the typed words are the idea, their first line is the title, and Just talk has neither', () => {
  assert.equal(typeof recordingRequest, 'function', 'ui/lib/prepare-model.js exports recordingRequest');
  const beats = [{ label: 'Hook', points: ['Say it plainly'] }, { label: 'Story', points: [] }, { label: 'Takeaway', points: [] }];
  const typed = recordingRequest({ ideaId: null, title: '', idea: '  Why most people use AI wrong\nand the story of my client  ', beats }, ['pause'], { sample: false });
  assert.equal(typed.ideaId, null);
  assert.equal(typed.idea, 'Why most people use AI wrong\nand the story of my client');
  assert.equal(typed.title, 'Why most people use AI wrong');
  assert.deepEqual(typed.beats.map((beat) => [beat.label, beat.points]), [['Hook', ['Say it plainly']], ['Story', []], ['Takeaway', []]]);
  assert.equal(validateRecording(asRecord(typed)).ok, true);
  // A long paste: the idea is cut to what the model was shown, and the title to one short line.
  const long = recordingRequest({ title: '', idea: 'word '.repeat(3000), beats }, [], { sample: false });
  assert.ok(long.idea.length <= BEAT_LIMITS.textChars, `${long.idea.length} characters`);
  assert.ok(long.title.length <= 80 && long.title.length > 0, `${long.title.length} characters`);
  assert.ok(Buffer.byteLength(JSON.stringify(long)) < 16 * 1024, 'the request fits the route\'s 16 KB');
  const talk = recordingRequest({ ideaId: null, title: '', beats: prepareView(null).beats }, [], { sample: false });
  assert.equal(talk.title, '');
  assert.equal(talk.idea, '');
  assert.equal(validateRecording(asRecord(talk)).ok, true);
  // A view with no beat at all still makes a record: the default beats.
  assert.deepEqual(recordingRequest({ title: 'x', beats: [] }, []).beats.map((beat) => beat.label), ['Hook', 'Story', 'Point', 'Takeaway']);
  assert.deepEqual(recordingRequest(null, []).beats.map((beat) => beat.label), ['Hook', 'Story', 'Point', 'Takeaway']);
});

test('recordingRequest for the sample take gives the sample\'s own title, beats and cues, as sample/brief.json and sample/setup.json have them, and sample: true', () => {
  assert.equal(typeof recordingRequest, 'function', 'ui/lib/prepare-model.js exports recordingRequest');
  const brief = readSample('brief.json');
  const setup = readSample('setup.json');
  const view = prepareView(sampleKeeping(['hours', 'never']));
  const request = recordingRequest(view, ['smile', 'pause'], { sample: true });
  assert.equal(request.sample, true);
  assert.equal(request.ideaId, 'sample', 'the idea whose stand-in the button sits on');
  assert.equal(request.title, brief.idea, 'the sample take\'s own title, never the sample idea\'s (D-124)');
  assert.equal(request.title, 'How I plan a video in twenty minutes');
  assert.equal(request.idea, brief.idea);
  // The beats: the brief's points, each with its active angle as its one talking point, as the engine's replay saves them.
  const episode = createEpisode(brief);
  const story = episode.beats.map((beat) => {
    const point = brief.points.find((each) => each.id === beat.pointId);
    return { id: beat.id, label: beat.title, points: [point.angles.find((angle) => angle.id === point.active).text] };
  });
  assert.deepEqual(request.beats, recordingBeats(story, episode));
  assert.deepEqual(request.beats.map((beat) => [beat.pointId, beat.label]), [['p1', 'Hook'], ['p2', 'What I do'], ['p3', 'Takeaway']]);
  assert.ok(!request.beats.some((beat) => /planning|pressed record/i.test(beat.label)), 'none of the sample idea\'s kept beats is in the sample take');
  // The cues are the sample's own (setup.json), whatever chips were pressed.
  assert.deepEqual(request.deliveryCues, deliveryFromSetup(setup, episode.beats).cues);
  assert.deepEqual(request.deliveryCues.map((cue) => [cue.kind, cue.beatId]), [['slow-down', 'b1'], ['land-the-point', 'b3']]);
  assert.deepEqual(recordingRequest(view, [], { sample: true }), request, 'the pressed chips change nothing of the sample take');
  assert.equal(validateRecording(asRecord(request)).ok, true);
  // Each answer is a fresh copy.
  request.beats[0].takes.push('changed');
  request.deliveryCues.pop();
  assert.deepEqual(recordingRequest(view, [], { sample: true }).beats[0].takes, []);
  assert.equal(recordingRequest(view, [], { sample: true }).deliveryCues.length, 2);
});

test('recentRows gives the saved recordings as the Recent list shows them: the newest two, each a title and a day', () => {
  assert.equal(typeof recentRows, 'function', 'ui/lib/prepare-model.js exports recentRows');
  const now = new Date(2026, 9, 3, 15, 30);
  const at = (daysAgo, hour = 10) => new Date(2026, 9, 3 - daysAgo, hour).toISOString();
  // The store's list is newest first.
  const list = [
    { id: 'rec-c', title: 'How I plan a video in twenty minutes', status: 'draft', createdAt: at(0) },
    { id: 'rec-b', title: '', status: 'ready', createdAt: at(1, 23) },
    { id: 'rec-a', title: 'Older', status: 'ready', createdAt: at(3) },
  ];
  assert.deepEqual(recentRows(list, now), [
    { title: 'How I plan a video in twenty minutes', length: '', date: 'Today' },
    { title: 'Untitled recording', length: '', date: 'Yesterday' },
  ], 'at most the two rows the shell draws');
  // 3 October 2026 is a Saturday: three days before it is a Wednesday, and within the week a day is named.
  assert.deepEqual(recentRows(list.slice(2), now), [{ title: 'Older', length: '', date: 'Wednesday' }]);
  assert.deepEqual(recentRows([{ id: 'rec-z', title: 'Long ago', createdAt: new Date(2026, 8, 12, 9).toISOString() }], now), [{ title: 'Long ago', length: '', date: '12 Sep' }]);
  assert.deepEqual(recentRows([{ id: 'rec-y', title: 'No time', createdAt: 'soon' }], now), [{ title: 'No time', length: '', date: '' }]);
  assert.deepEqual(recentRows([], now), [], 'nothing saved, nothing listed');
  for (const nothing of [null, undefined, 'x', {}]) assert.deepEqual(recentRows(nothing, now), []);
  assert.deepEqual(recentRows([null, 7, { title: 'Kept' }], now), [{ title: 'Kept', length: '', date: '' }], 'an entry that is not a record is passed over');
});
