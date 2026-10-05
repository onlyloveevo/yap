// The bundled sample takes carry the demo's Hey YAP moment (Plan 01.1-14;
// D-55, D-58, D-63, D-64): take 1's one exchange is the coffee exchange, word
// for word, answered in the take with "Yeah, let's do that."
//
// These tests read the committed files in sample/ and check them with the real
// engine: the take, the trial reader, the restart and dead-air detectors, the
// beats and the review moments. They never run text-to-speech or ffmpeg, and
// they hold no level of their own: every level is the engine's, and the only
// numbers written here are the plan's (a proposal within 1.0 s, spans that
// agree within 0.3 s, an .mp4 within 0.2 s of its .wav, 90% of words in sound).
//
// The Phase 1 takes (the swap from tips to story) are checked by
// test/sample.test.js on test/fixtures/angle-sample/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrief } from '../src/engine/brief.js';
import { parseWav } from '../src/engine/wav.js';
import { findSilences } from '../src/engine/silences.js';
import { createManualClock } from '../src/engine/clock.js';
import { createEpisode, EPISODE_DEFAULTS } from '../src/engine/episode.js';
import { emptyMemory } from '../src/engine/memory.js';
import { chooseDeliveryCues } from '../src/engine/delivery.js';
import { parseTryInstead } from '../src/engine/experiments.js';
import { PACE_DEFAULTS } from '../src/engine/pace.js';
import { planExport } from '../src/engine/export.js';
import { runTake, finishTake, deliveryFromSetup } from '../src/engine/session.js';
import { loadTake } from '../src/node/sample-files.js';

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sampleDir = path.join(appRoot, 'sample');
const fixtureDir = path.join(appRoot, 'test', 'fixtures', 'angle-sample');

// The demo exchange, word for word (D-58; ui-shell/ref/COFFEE_SOURCE.txt).
const REQUEST = "Hey YAP, let's try 'Grab a coffee' instead of 'Grab a tea.'";
const ANSWER = "Yeah, let's do that.";
const ASK = 'Try it for three videos, then check in?';
const SAVED = 'Trial saved · Check-in after 3 videos';
const TEA = "Grab a tea. Let's get into it.";
const COFFEE = "Grab a coffee. Let's get into it.";

const exists = (name) => fs.existsSync(path.join(sampleDir, name));
const readJson = (name, dir = sampleDir) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
/** A JSON file of sample/, or null when it is missing: a missing file fails an assertion, not the load. */
const optional = (name) => (exists(name) ? readJson(name) : null);
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const lower = (text) => String(text).toLowerCase();
const texts = (words) => words.map((w) => w.text).join(' ');

/** Read the movie duration (seconds) from the mvhd box of an MP4 file. */
function mp4Duration(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  function walk(start, end) {
    let at = start;
    while (at + 8 <= end) {
      let size = view.getUint32(at);
      const kind = type(at + 4);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header) return null;
      if (kind === 'moov') return walk(at + header, at + size);
      if (kind === 'mvhd') {
        const body = at + header;
        if (bytes[body] === 1) return Number(view.getBigUint64(body + 24)) / view.getUint32(body + 20);
        return view.getUint32(body + 16) / view.getUint32(body + 12);
      }
      at += size;
    }
    return null;
  }
  return walk(0, bytes.length);
}

/**
 * Both takes run the way the loop runs them: take 1 live with the setup's
 * delivery cues and no trial accepted before, then its rough cut, beats and
 * review moments; take 2 on the same episode with the trials take 1 accepted.
 * Run once and shared by the tests that only read it.
 */
let analysed = null;
function analyse() {
  if (!analysed) {
    analysed = (async () => {
      const brief = parseBrief(fs.readFileSync(path.join(sampleDir, 'brief.json'), 'utf8'), 'sample/brief.json');
      const setup = optional('setup.json');
      let episode = createEpisode(brief);
      let accepted = [];
      let current = brief;
      const out = {};
      for (const name of ['take1', 'take2']) {
        const take = loadTake(appRoot, name);
        const chosen = setup ? deliveryFromSetup(setup, episode.beats) : null;
        const events = [];
        const live = await runTake({
          takeId: take.takeId,
          brief: current,
          words: take.words,
          clock: createManualClock(),
          memory: emptyMemory(),
          delivery: chosen ? { cues: chosen.cues, beatIds: episode.beats.map((b) => b.id) } : null,
          experiments: { accepted },
          onEvent: (event) => events.push(event),
        });
        const result = finishTake({ live, pcm: take.pcm, words: take.words, episode, memory: emptyMemory() });
        out[name] = { take, events, result, plan: optional(`${name}.plan.json`) };
        episode = result.episode;
        accepted = [...accepted, ...live.experiments];
        current = live.briefAfter;
      }
      out.brief = brief;
      return out;
    })();
  }
  return analysed;
}

const cutsOf = (result, kind) => result.cutList.cuts.filter((c) => c.kind === kind);
const eventsOf = (events, type) => events.filter((e) => e.type === type);

// ---- the brief, the setup and the script ----

test('sample/brief.json validates, opens on the tea greeting, and keeps the idea and the three points of the Phase 1 brief', () => {
  const text = fs.readFileSync(path.join(sampleDir, 'brief.json'), 'utf8');
  const brief = parseBrief(text, 'sample/brief.json');
  assert.equal(brief.greeting, TEA);
  const raw = JSON.parse(text);
  const phase1 = readJson('brief.json', fixtureDir);
  assert.equal(raw.idea, phase1.idea);
  // The Takeaway carries one more angle, the line take 1's presenter closes on. Everything else is what it was.
  const closing = raw.points[2].angles.find((a) => a.id === 'p3-numbers');
  assert.equal(closing.text, 'The rest of the plan comes together in twenty minutes');
  const before = raw.points.map((p) => ({ ...p, angles: p.angles.filter((a) => a !== closing) }));
  assert.deepEqual(before, phase1.points, 'the three points and their other angles are what they were');
  assert.equal(raw.label, 'sample');
});

test('sample/setup.json goes through chooseDeliveryCues and gives Slow down on beat 1 and Land the point on beat 3', () => {
  assert.ok(exists('setup.json'), 'sample/setup.json exists');
  const setup = readJson('setup.json');
  const beats = createEpisode(parseBrief(fs.readFileSync(path.join(sampleDir, 'brief.json'), 'utf8'), 'sample/brief.json')).beats;
  const picks = setup.deliveryCues.map((cue) => ({ kind: cue.kind, beatId: beats[cue.beat - 1].id }));
  const { cues } = chooseDeliveryCues(picks, beats);
  assert.deepEqual(cues.map((c) => [c.text, c.beatId]), [['Slow down', beats[0].id], ['Land the point', beats[2].id]]);
  // The replay's own reader of the file gives the same cues.
  assert.deepEqual(deliveryFromSetup(setup, beats).cues.map((c) => [c.kind, c.beatId]), [['slow-down', beats[0].id], ['land-the-point', beats[2].id]]);
});

test('sample/script.json holds the coffee exchange word for word, its spoken yes, a planted pause, and never speaks the takeaway in take 1', () => {
  const script = readJson('script.json');
  assert.equal(script.label, 'sample');
  const take1 = script.takes.take1;
  const spoken = take1.filter((item) => 'say' in item);
  const at = spoken.findIndex((item) => item.role === 'exchange');
  assert.ok(at >= 0, 'take 1 has an exchange');
  assert.equal(spoken.filter((item) => item.role === 'exchange').length, 1, 'take 1 has one exchange');
  assert.equal(spoken[at].say, REQUEST);
  assert.equal(spoken[at + 1].role, 'answer', 'the spoken yes comes straight after the request');
  assert.equal(spoken[at + 1].say, ANSWER);
  assert.equal(take1.filter((item) => 'gap' in item && item.role === 'pause').length, 1, 'one planted long pause');
  assert.ok(!spoken.some((item) => item.point === 'p3'), 'no line of take 1 is about the takeaway');
  assert.equal(script.takes.take2.find((item) => 'say' in item).say, COFFEE, 'take 2 opens on the coffee greeting');
  assert.ok(!script.takes.take2.some((item) => item.role === 'exchange' || item.role === 'answer'));
  // D-63: the takes say nothing about views or how a video did.
  for (const item of [...take1, ...script.takes.take2]) {
    if ('say' in item) assert.ok(!/\b(?:views?|audience|performance|viral|subscribers?)\b/i.test(item.say), `"${item.say}"`);
  }
});

// ---- the files of each take ----

for (const name of ['take1', 'take2']) {
  test(`${name}: the words file is a labelled sample that names the synthetic voice`, () => {
    const transcript = readJson(`${name}.words.json`);
    assert.equal(transcript.label, 'sample');
    assert.match(transcript.source, /synthetic voice Kokoro-82M v1\.0 \/ af_heart \(Apache-2\.0 model\)/);
    const plan = readJson(`${name}.plan.json`);
    assert.equal(plan.label, 'sample');
    assert.equal(plan.take, name);
  });

  test(`${name}: no word falls inside a planned gap, and at least 90% of words sit at least half inside sounding audio`, () => {
    const { words } = readJson(`${name}.words.json`);
    const plan = readJson(`${name}.plan.json`);
    assert.ok(plan.gaps.length >= 1);
    for (const w of words) {
      for (const [s, e] of plan.gaps) assert.ok(overlap(w.start, w.end, s, e) <= 1e-6, `"${w.text}" ${w.start}-${w.end} is inside the gap ${s}-${e}`);
    }
    const wav = parseWav(new Uint8Array(fs.readFileSync(path.join(sampleDir, `${name}.wav`))));
    const { silences } = findSilences(wav.samples, wav.sampleRate, { channels: wav.channels });
    const sounding = words.filter((w) => {
      const quiet = silences.reduce((n, [s, e]) => n + overlap(w.start, w.end, s, e), 0);
      return w.end - w.start - quiet >= 0.5 * (w.end - w.start);
    });
    assert.ok(sounding.length >= 0.9 * words.length, `${sounding.length} of ${words.length} words sound`);
  });

  test(`${name}: the .mp4 exists, is titled a labelled sample, and lasts as long as the .wav to within 0.2 s`, () => {
    assert.ok(exists(`${name}.mp4`), `sample/${name}.mp4 exists`);
    const mp4 = fs.readFileSync(path.join(sampleDir, `${name}.mp4`));
    assert.equal(mp4.subarray(4, 8).toString('latin1'), 'ftyp');
    assert.ok(mp4.includes(Buffer.from('labelled sample')), 'the MP4 title names it a sample');
    const wav = parseWav(new Uint8Array(fs.readFileSync(path.join(sampleDir, `${name}.wav`))));
    const wavSeconds = wav.samples.length / wav.channels / wav.sampleRate;
    const seconds = mp4Duration(new Uint8Array(mp4));
    assert.ok(seconds !== null && Math.abs(seconds - wavSeconds) <= 0.2, `MP4 ${seconds} s, WAV ${wavSeconds} s`);
    const plan = readJson(`${name}.plan.json`);
    assert.ok(Math.abs(wavSeconds - plan.duration) <= 0.01, `WAV ${wavSeconds} s, plan ${plan.duration} s`);
  });
}

// ---- take 1 through the take and the detectors ----

test('take 1 holds exactly one Hey YAP exchange, the coffee exchange: proposed within 1.0 s and accepted by voice, with no angle swap and no note', async () => {
  const { take1 } = await analyse();
  const { result, events } = take1;
  assert.equal(result.exchanges.length, 1, `exchanges: ${JSON.stringify(result.exchanges.map((x) => [x.start, x.end, x.remark]))}`);
  const change = parseTryInstead(result.exchanges[0].remark);
  assert.ok(change, `the trial reader reads "${result.exchanges[0].remark}"`);
  assert.deepEqual(change, { to: 'Grab a coffee', from: 'Grab a tea' });

  const proposed = eventsOf(events, 'experiment-proposed');
  assert.equal(proposed.length, 1, 'one proposal');
  assert.equal(proposed[0].proposal.ask, ASK);
  assert.ok(proposed[0].latencySec <= 1.0, `the proposal came ${proposed[0].latencySec} s after the request`);

  const answered = eventsOf(events, 'experiment-answered');
  assert.equal(answered.length, 1, 'one answer');
  assert.equal(answered[0].answer, 'accepted');
  assert.equal(answered[0].by, 'voice');
  assert.equal(answered[0].line, SAVED);
  assert.ok(answered[0].at > proposed[0].at, 'the yes comes after the proposal');

  assert.equal(result.experiments.length, 1, 'one trial accepted in the take');
  const trial = result.experiments[0];
  assert.deepEqual([lower(trial.change.from), lower(trial.change.to), trial.trialLength], ['grab a tea', 'grab a coffee', 3]);
  assert.deepEqual(eventsOf(events, 'greeting').map((e) => e.text), [TEA, COFFEE], 'the take opens on the tea greeting and ends on the coffee one');
  assert.equal(result.greeting, COFFEE);

  assert.equal(result.swaps.length, 0, 'this sample asks for no angle change');
  assert.equal(result.notes.length, 0);
  assert.equal(eventsOf(events, 'heard').length, 0, 'the exchange changed something, so no "Nothing changed" line');
});

test("take 1's rough cut: two restart cuts, one talk with YAP from the wake pair to the end of the spoken yes, and one dead-air cut inside the planted pause; Export accepts it", async () => {
  const { take1 } = await analyse();
  const { result, take, plan } = take1;
  const restarts = cutsOf(result, 'restart');
  assert.equal(restarts.length, 2, `restart cuts: ${JSON.stringify(restarts.map((c) => [c.start, c.end, c.certainty, c.reason]))}`);
  for (const c of restarts) assert.equal(c.certainty, 'sure');
  assert.equal(result.restartCount, 2, "YAP's bet counts two restarts");
  assert.ok(restarts.some((c) => /sorry let me start that again/.test(c.reason)), 'one restart is the spoken "Sorry, let me start that again."');

  const talk = cutsOf(result, 'exchange');
  assert.equal(talk.length, 1, 'one talk with YAP');
  const words = take.words;
  const hey = words.findIndex((w, i) => /^hey$/i.test(w.text) && /^yap\W*$/i.test((words[i + 1] || {}).text || ''));
  assert.ok(hey >= 0, 'the wake pair is in the words');
  const yes = ANSWER.split(' ');
  const yesAt = words.findIndex((_, i) => yes.every((t, k) => words[i + k] && words[i + k].text === t));
  assert.ok(yesAt > hey, 'the spoken yes is in the words, after the request');
  const yesEnd = words[yesAt + yes.length - 1].end;
  assert.ok(talk[0].start <= words[hey].start && words[hey].start - talk[0].start <= 0.3, `the cut starts at ${talk[0].start}; the wake pair at ${words[hey].start}`);
  assert.ok(talk[0].end >= yesEnd && talk[0].end - yesEnd <= 0.3, `the cut ends at ${talk[0].end}; the spoken yes at ${yesEnd}`);

  const deadAir = cutsOf(result, 'dead-air');
  assert.equal(deadAir.length, 1, `dead-air cuts: ${JSON.stringify(deadAir.map((c) => [c.start, c.end]))}`);
  assert.ok(plan && Array.isArray(plan.pauses) && plan.pauses.length === 1, 'the plan file names one planted pause');
  const [pauseStart, pauseEnd] = plan.pauses[0];
  assert.ok(deadAir[0].start >= pauseStart && deadAir[0].end <= pauseEnd, `the dead-air cut ${deadAir[0].start}-${deadAir[0].end} lies inside the planted pause ${pauseStart}-${pauseEnd}`);

  for (const c of result.cutList.cuts) assert.equal(c.applied, true, `the ${c.kind} cut at ${c.start} s is applied`);
  const exported = planExport({ duration: result.duration, cuts: result.cutList.cuts, words });
  assert.ok(exported.keptSeconds > 0 && exported.keptSeconds < result.duration, 'no word is clipped, and time was taken out');
});

test("take 1: the opening ran over the pace level, the takeaway was never covered, and the review gives a story moment and a delivery moment with no score (D-55)", async () => {
  const { take1, brief } = await analyse();
  const { result } = take1;
  assert.equal(result.beats.length, 3);
  assert.ok(result.beats[0].summary.paceWpm > PACE_DEFAULTS.threshold, `the opening beat ran at ${result.beats[0].summary.paceWpm} words a minute`);
  const takeaway = result.beats[2];
  assert.ok(takeaway.summary.coverage < EPISODE_DEFAULTS.coverageMin, `the takeaway's coverage is ${takeaway.summary.coverage}`);
  assert.equal(takeaway.tick.ticked, false);

  const point = brief.points[2];
  const takeawayText = point.angles.find((a) => a.id === point.active).text;
  const story = result.moments.filter((m) => m.type === 'story');
  const delivery = result.moments.filter((m) => m.type === 'delivery');
  assert.ok(story.length >= 1, 'at least one story moment');
  assert.ok(story.some((m) => m.observation.includes(takeawayText)), `a story moment names "${takeawayText}": ${story.map((m) => m.observation).join(' | ')}`);
  assert.ok(delivery.length >= 1, 'at least one delivery moment');
  assert.ok(delivery.some((m) => m.source === 'pace' && m.beatIndex === 0), 'one delivery moment is the pace of the opening');
  for (const m of result.moments) {
    assert.equal(m.decision, null, 'YAP points; the person decides');
    assert.ok(!/\d/.test(m.observation.replace(takeawayText, '')), `no number in "${m.observation}"`);
    for (const key of ['score', 'grade', 'rating', 'colour', 'color']) assert.ok(!(key in m), `a moment has no ${key}`);
  }
});

test("take 1's plan file names the exchange, the spoken yes, the planted pause and the point never spoken, and they agree with the detectors to within 0.3 s", async () => {
  const { take1 } = await analyse();
  const { result, events, take, plan } = take1;
  assert.ok(plan, 'sample/take1.plan.json exists');
  for (const key of ['answer', 'pauses', 'neverSpoken']) assert.ok(key in plan, `the plan has "${key}"`);
  assert.ok(Array.isArray(plan.exchange) && Array.isArray(plan.answer), 'the exchange and the answer are spans');
  assert.equal(plan.pauses.length, 1);
  assert.deepEqual(plan.neverSpoken, ['p3']);
  assert.ok(plan.answer[0] > plan.exchange[1], 'the answer is said after the request');

  const exchange = result.exchanges[0];
  assert.ok(exchange, 'the take heard an exchange');
  assert.ok(Math.abs(exchange.start - plan.exchange[0]) <= 0.3, `the exchange starts at ${exchange.start}, planned ${plan.exchange[0]}`);
  const proposed = eventsOf(events, 'experiment-proposed')[0];
  assert.ok(proposed, 'the take proposed a trial');
  const requestEnd = proposed.at - proposed.latencySec;
  assert.ok(Math.abs(requestEnd - plan.exchange[1]) <= 0.3, `the request ends at ${requestEnd}, planned ${plan.exchange[1]}`);
  assert.ok(Math.abs(exchange.end - plan.answer[1]) <= 0.3, `the talk with YAP ends at ${exchange.end}; the answer was planned to end at ${plan.answer[1]}`);

  const { silences } = findSilences(take.pcm.samples, take.pcm.sampleRate);
  const [pauseStart, pauseEnd] = plan.pauses[0];
  assert.ok(
    silences.some(([s, e]) => Math.abs(s - pauseStart) <= 0.3 && Math.abs(e - pauseEnd) <= 0.3),
    `a silence was found at the planted pause ${pauseStart}-${pauseEnd}`,
  );
});

// ---- take 2 ----

test('take 2 opens on the coffee greeting, has no Hey YAP exchange, one restart and no dead-air cut, and all three beats are ticked', async () => {
  const { take2 } = await analyse();
  const { result, events, take, plan } = take2;
  const greeting = COFFEE.split(' ');
  assert.equal(texts(take.words.slice(0, greeting.length)), COFFEE);
  assert.deepEqual(eventsOf(events, 'greeting').map((e) => e.text), [COFFEE], 'the trial accepted in take 1 is in use');

  assert.equal(result.exchanges.length, 0);
  assert.equal(result.proposals.length, 0);
  const restarts = cutsOf(result, 'restart');
  assert.equal(restarts.length, 1, `restart cuts: ${JSON.stringify(restarts.map((c) => [c.start, c.end, c.certainty, c.reason]))}`);
  assert.equal(restarts[0].certainty, 'sure');
  assert.equal(result.restartCount, 1);
  assert.equal(cutsOf(result, 'dead-air').length, 0, 'no pause of take 2 is long enough to cut');
  assert.deepEqual(result.beats.map((b) => [b.title, b.tick.ticked]), [['Hook', true], ['What I do', true], ['Takeaway', true]], result.beats.map((b) => `${b.title}: ${b.tick.reason}`).join('; '));

  assert.ok(plan, 'sample/take2.plan.json exists');
  for (const key of ['answer', 'pauses', 'neverSpoken']) assert.ok(key in plan, `the plan has "${key}"`);
  assert.equal(plan.exchange, null);
  assert.equal(plan.answer, null);
  assert.deepEqual(plan.pauses, []);
  assert.deepEqual(plan.neverSpoken, []);
});
