// Tests for src/engine/experiments.js: the local reader for "try X instead of
// Y", YAP's proposal of a trial, and the trial's life (EXP-01; D-58 to D-63,
// D-65). The exchange is Deth's confirmed image 17 (COFFEE_SOURCE.txt):
//   You: "Hey YAP, let's try 'Grab a coffee' instead of 'Grab a tea.'"
//   YAP: "Try it for three videos, then check in?"
import test from 'node:test';
import assert from 'node:assert/strict';
import { findGradingLanguage } from '../tools/copy-check.js';

// Loaded dynamically so a missing module fails each named test (RED) instead of
// crashing the file at load time.
const mod = await import('../src/engine/experiments.js').catch(() => ({}));
const { EXPERIMENT_DEFAULTS, COPY, parseTryInstead, proposeExperiment, readExperimentRequest } = mod;
const { acceptExperiment, keepOld, countRecording, checkInQuestions, answerCheckIn, greetingFor, statusLine } = mod;

const DEMO = "let's try 'Grab a coffee' instead of 'Grab a tea.'";
const GREETING = "Grab a tea. Let's get into it.";

/** A brief written here: the sample brief gains its greeting in a later plan. */
function makeBrief() {
  const angle = (id, label, text) => ({ id, label, text, reply: `Prepared reply for ${label}.`, keywords: [] });
  return {
    version: 1,
    label: 'test',
    idea: 'How I plan a video',
    greeting: GREETING,
    points: [
      {
        id: 'p1',
        title: 'Hook',
        active: 'p1-tips',
        angles: [
          angle('p1-tips', 'tips', 'Three planning habits save me hours every week'),
          angle('p1-story', 'story', 'The video I planned the night before and lost'),
        ],
      },
      {
        id: 'p2',
        title: 'Middle',
        active: 'p2-tips',
        angles: [angle('p2-tips', 'tips', 'Write the first line the night before'), angle('p2-story', 'story', 'What went wrong on the day')],
      },
      {
        id: 'p3',
        title: 'Close',
        active: 'p3-tips',
        angles: [angle('p3-tips', 'tips', 'Pick one habit and keep it for a week'), angle('p3-story', 'story', 'What I do now')],
      },
    ],
  };
}

/** Every string inside a value, however deep. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** D-63: no line about an experiment claims or implies views or performance. */
const CLAIM_WORDS = [
  'views', 'viewers', 'audience', 'performance', 'perform', 'engagement', 'retention',
  'clicks', 'subscribers', 'better', 'improve', 'boost', 'grow',
];
const CLAIM_RE = new RegExp(`\\b(?:${CLAIM_WORDS.join('|')})\\b`, 'i');
function assertNoClaim(line) {
  assert.equal(CLAIM_RE.test(line), false, `"${line}" holds a word about views or performance`);
  assert.deepEqual(findGradingLanguage(line), [], `"${line}" holds grading language`);
}

// ---------- the module ----------

test('the module exports the reader, the proposal and their settings', () => {
  for (const fn of [parseTryInstead, proposeExperiment, readExperimentRequest]) assert.equal(typeof fn, 'function');
  assert.equal(typeof EXPERIMENT_DEFAULTS, 'object');
  assert.equal(typeof COPY, 'object');
});

test('EXPERIMENT_DEFAULTS holds the trial settings, frozen', () => {
  assert.ok(Object.isFrozen(EXPERIMENT_DEFAULTS));
  assert.equal(EXPERIMENT_DEFAULTS.trialLength, 3);
  assert.equal(EXPERIMENT_DEFAULTS.minLength, 1);
  assert.equal(EXPERIMENT_DEFAULTS.maxLength, 10);
  assert.deepEqual([...EXPERIMENT_DEFAULTS.categories], ['Greeting', 'Hook', 'Thumbnail', 'Delivery']);
  assert.equal(EXPERIMENT_DEFAULTS.maxWords, 12);
  assert.deepEqual([...EXPERIMENT_DEFAULTS.trialWords], ['try', 'instead', 'swap', 'rather', 'trial', 'experiment']);
});

test('COPY is frozen and holds the exact lines of the exchange', () => {
  assert.ok(Object.isFrozen(COPY));
  assert.equal(COPY.proposal, 'Try it for {count} videos, then check in?');
  assert.equal(COPY.saved, 'Trial saved · Check-in after {n} videos');
  assert.equal(COPY.checkIn, "You've tried '{to}' for {n} videos. Keep it?");
  assert.equal(COPY.status, 'video {k} of {n}');
});

// ---------- the demo sentence ----------

test('the demo sentence is read as tea to coffee', () => {
  assert.deepEqual(parseTryInstead(DEMO), { to: 'Grab a coffee', from: 'Grab a tea' });
});

test('the demo sentence as Chrome writes it is read as tea to coffee', () => {
  assert.deepEqual(parseTryInstead("let's try grab a coffee instead of grab a tea"), { to: 'grab a coffee', from: 'grab a tea' });
});

test('the demo sentence with curly quotes and the wake words before it is read as tea to coffee', () => {
  assert.deepEqual(
    parseTryInstead('Hey YAP, let’s try ‘Grab a coffee’ instead of ‘Grab a tea.’'),
    { to: 'Grab a coffee', from: 'Grab a tea' },
  );
});

// ---------- the 5 other phrasings (seat default for D-65, QUESTIONS.md Q58) ----------

const OTHER_PHRASINGS = [
  ['can we try X instead of Y', 'can we try grab a coffee instead of grab a tea'],
  ["let's say X instead of Y", "let's say grab a coffee instead of grab a tea"],
  ['swap Y for X', 'swap grab a tea for grab a coffee'],
  ['use X rather than Y', 'use grab a coffee rather than grab a tea'],
  ["I'd rather say X than Y", "I'd rather say grab a coffee than grab a tea"],
];
for (const [name, remark] of OTHER_PHRASINGS) {
  test(`phrasing read: ${name}`, () => {
    assert.deepEqual(parseTryInstead(remark), { to: 'grab a coffee', from: 'grab a tea' });
  });
}

// ---------- 10 ordinary sentences ----------

const ORDINARY = [
  'three planning habits save me hours every week',
  "I don't like this angle",
  'try the story instead',
  'make this punchier',
  'what about my intro',
  'instead of planning I just start',
  "let's try that again",
  'I tried coffee once',
  'can we open with the number',
  "grab a coffee and let's get into it",
];
for (const sentence of ORDINARY) {
  test(`ordinary sentence gives nothing: ${sentence}`, () => {
    assert.equal(parseTryInstead(sentence), null);
  });
}

// ---------- the edges of X and Y ----------

test('a remark whose X is empty gives nothing', () => {
  assert.equal(parseTryInstead("let's try instead of grab a tea"), null);
});

test('a remark whose Y is empty gives nothing', () => {
  assert.equal(parseTryInstead("let's try grab a coffee instead of"), null);
});

test('an X or a Y longer than 12 words gives nothing, and 12 words are read', () => {
  const twelve = 'one two three four five six seven eight nine ten eleven twelve';
  assert.deepEqual(parseTryInstead(`try ${twelve} instead of tea`), { to: twelve, from: 'tea' });
  assert.equal(parseTryInstead(`try ${twelve} thirteen instead of tea`), null);
  assert.equal(parseTryInstead(`try coffee instead of ${twelve} thirteen`), null);
});

test('quote marks and end punctuation around X and Y are removed and the words inside keep their case', () => {
  assert.deepEqual(
    parseTryInstead('Can we try "Hello There, Friends!" instead of "Hi All."?'),
    { to: 'Hello There, Friends', from: 'Hi All' },
  );
});

test('two ordinary sentences in one remark are not joined into a request', () => {
  assert.equal(parseTryInstead("Let's try that again. Instead of planning I just start."), null);
});

test('what is said after the request has ended is not part of the old wording', () => {
  assert.deepEqual(
    parseTryInstead("let's try grab a coffee instead of grab a tea. So the first habit is planning"),
    { to: 'grab a coffee', from: 'grab a tea' },
  );
});

test('parseTryInstead reads nothing from an empty or missing remark', () => {
  assert.equal(parseTryInstead(''), null);
  assert.equal(parseTryInstead(undefined), null);
  assert.equal(parseTryInstead(null), null);
});

test('parseTryInstead is synchronous and calls no network', () => {
  const keep = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const refuse = () => {
    throw new Error('the local reader must not use the network');
  };
  globalThis.fetch = refuse;
  globalThis.WebSocket = refuse;
  try {
    const result = parseTryInstead(DEMO);
    assert.equal(typeof result?.then, 'undefined', 'the result is not a promise');
    assert.deepEqual(result, { to: 'Grab a coffee', from: 'Grab a tea' });
  } finally {
    globalThis.fetch = keep.fetch;
    globalThis.WebSocket = keep.WebSocket;
  }
});

// ---------- YAP's proposal ----------

test('the demo sentence gives a proposal for a three-video greeting trial', () => {
  assert.deepEqual(proposeExperiment(DEMO, { brief: makeBrief() }), {
    id: 'p1',
    exchangeId: null,
    category: 'Greeting',
    from: 'Grab a tea',
    to: 'Grab a coffee',
    trialLength: 3,
    status: 'proposed',
    ask: 'Try it for three videos, then check in?',
  });
});

test('a proposal carries the id and the exchange it was given', () => {
  const proposal = proposeExperiment(DEMO, { brief: makeBrief(), id: 'p4', exchangeId: 'x2' });
  assert.equal(proposal.id, 'p4');
  assert.equal(proposal.exchangeId, 'x2');
});

test('old wording found in the greeting gives the category Greeting, in any case', () => {
  assert.equal(proposeExperiment("let's try grab a coffee instead of grab a tea", { brief: makeBrief() }).category, 'Greeting');
});

test('old wording found in the first talking point gives the category Hook', () => {
  const proposal = proposeExperiment("let's try 'four planning habits' instead of 'three planning habits'", { brief: makeBrief() });
  assert.equal(proposal.category, 'Hook');
});

test('a remark that says thumbnail gives the category Thumbnail', () => {
  const proposal = proposeExperiment("for the thumbnail let's try a close shot instead of a wide shot", { brief: makeBrief() });
  assert.equal(proposal.category, 'Thumbnail');
});

test('any other change gives the category Delivery', () => {
  assert.equal(proposeExperiment("let's try a slow start instead of a fast start", { brief: makeBrief() }).category, 'Delivery');
  assert.equal(proposeExperiment(DEMO, {}).category, 'Delivery', 'with no brief there is no greeting to find it in');
});

test('a trial length of 5 asks for five videos', () => {
  const proposal = proposeExperiment(DEMO, { brief: makeBrief(), trialLength: 5 });
  assert.equal(proposal.trialLength, 5);
  assert.equal(proposal.ask, 'Try it for five videos, then check in?');
});

test('a trial length of 1 asks for one video', () => {
  assert.equal(proposeExperiment(DEMO, { brief: makeBrief(), trialLength: 1 }).ask, 'Try it for one video, then check in?');
});

test('a trial length of 10 asks for ten videos', () => {
  assert.equal(proposeExperiment(DEMO, { brief: makeBrief(), trialLength: 10 }).ask, 'Try it for ten videos, then check in?');
});

for (const bad of [0, 11, 2.5]) {
  test(`a trial length of ${bad} throws TrialLengthError`, () => {
    assert.throws(() => proposeExperiment(DEMO, { brief: makeBrief(), trialLength: bad }), { name: 'TrialLengthError' });
  });
}

test('an ordinary sentence gives no proposal', () => {
  assert.equal(proposeExperiment('make this punchier', { brief: makeBrief() }), null);
});

test('proposeExperiment does not change the brief it is given', () => {
  const brief = makeBrief();
  const before = structuredClone(brief);
  proposeExperiment(DEMO, { brief });
  assert.deepEqual(brief, before);
});

// ---------- the one place a model may be asked ----------

/** A fake `ask` that records its calls and answers with `answer`. */
function fakeAsk(answer) {
  const calls = [];
  const ask = async (request) => {
    calls.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ask, calls };
}

const UNREAD = 'what if the opener was grab a coffee, not grab a tea, instead';

test('the demo sentence resolves to a proposal and the model is never asked', async () => {
  const { ask, calls } = fakeAsk({ source: 'claude', text: '{"from":"x","to":"y"}' });
  const proposal = await readExperimentRequest(DEMO, { brief: makeBrief(), ask });
  assert.equal(calls.length, 0, 'ask was called for a sentence the local reader reads');
  assert.equal(proposal.from, 'Grab a tea');
  assert.equal(proposal.to, 'Grab a coffee');
  assert.equal(proposal.ask, 'Try it for three videos, then check in?');
});

test('a remark the reader cannot read that holds a trial word asks the model once', async () => {
  const { ask, calls } = fakeAsk({ source: 'claude', text: '{"from":"grab a tea","to":"grab a coffee"}' });
  const proposal = await readExperimentRequest(UNREAD, { brief: makeBrief(), ask });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { task: 'experiment', text: UNREAD });
  assert.deepEqual(proposal, {
    id: 'p1',
    exchangeId: null,
    category: 'Greeting',
    from: 'grab a tea',
    to: 'grab a coffee',
    trialLength: 3,
    status: 'proposed',
    ask: 'Try it for three videos, then check in?',
  });
});

test('with no ask given nothing is called and the answer is null', async () => {
  assert.equal(await readExperimentRequest(UNREAD, { brief: makeBrief() }), null);
});

test('a remark with no trial word never reaches the model', async () => {
  const { ask, calls } = fakeAsk({ source: 'claude', text: '{"from":"a","to":"b"}' });
  assert.equal(await readExperimentRequest('make this punchier', { brief: makeBrief(), ask }), null);
  assert.equal(calls.length, 0);
});

test('readExperimentRequest never rejects: a failing or empty model gives null', async () => {
  const answers = [
    new Error('the model is down'),
    { source: 'none', text: null },
    { source: 'claude', text: 'I think you want coffee.' },
    { source: 'claude', text: '{"from":"grab a tea"}' },
    { source: 'claude', text: '{"from":"","to":"grab a coffee"}' },
    { source: 'claude', text: '{"from":5,"to":["grab a coffee"]}' },
    { source: 'claude', text: '["grab a tea","grab a coffee"]' },
    undefined,
  ];
  for (const answer of answers) {
    const { ask } = fakeAsk(answer);
    assert.equal(await readExperimentRequest(UNREAD, { brief: makeBrief(), ask }), null, JSON.stringify(String(answer?.text ?? answer)));
  }
});

test("the model's from and to are each cut to 12 words", async () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  const { ask } = fakeAsk({ source: 'claude', text: JSON.stringify({ from: long, to: `"${long}."`, extra: 'ignored' }) });
  const proposal = await readExperimentRequest(UNREAD, { brief: makeBrief(), ask });
  const twelve = 'one two three four five six seven eight nine ten eleven twelve';
  assert.equal(proposal.from, twelve);
  assert.equal(proposal.to, twelve);
  assert.deepEqual(Object.keys(proposal).sort(), ['ask', 'category', 'exchangeId', 'from', 'id', 'status', 'to', 'trialLength']);
});

// ---------- D-63: no claim about views or performance ----------

test('the check for claims bites on a known-bad line', () => {
  for (const bad of ['This will boost your views', 'Coffee might perform better', 'Your audience retention will grow']) {
    assert.ok(CLAIM_RE.test(bad), `"${bad}" was not flagged`);
  }
});

test('no COPY string claims or implies views or performance', () => {
  const all = strings(COPY);
  assert.ok(all.length >= 4, `only ${all.length} strings checked`);
  for (const line of all) assertNoClaim(line);
});

test('no proposal line of any trial length claims or implies views or performance', () => {
  for (let n = 1; n <= 10; n += 1) assertNoClaim(proposeExperiment(DEMO, { brief: makeBrief(), trialLength: n }).ask);
});

// ---------- the trial's life: accept or keep old (D-58, D-59, D-60) ----------

const NOW = '2026-10-03T09:00:00.000Z';
const coffeeProposal = (options = {}) => proposeExperiment(DEMO, { brief: makeBrief(), ...options });
const coffeeTrial = (options = {}) => acceptExperiment(coffeeProposal(), { now: NOW, ...options }).experiment;
/** The coffee trial after each of the given recordings has finished. */
const counted = (...ids) => ids.reduce((experiment, id) => countRecording(experiment, id), coffeeTrial());

test('the module exports the life of a trial', () => {
  for (const fn of [acceptExperiment, keepOld, countRecording, checkInQuestions, answerCheckIn, greetingFor, statusLine]) {
    assert.equal(typeof fn, 'function');
  }
});

test('accepting the proposal gives the experiment and the saved line', () => {
  const { experiment, line } = acceptExperiment(coffeeProposal(), { now: NOW });
  assert.deepEqual(experiment, {
    id: 'e1',
    category: 'Greeting',
    change: { from: 'Grab a tea', to: 'Grab a coffee' },
    trialLength: 3,
    status: 'accepted',
    recordings: [],
    acceptedAt: NOW,
  });
  assert.equal(line, 'Trial saved · Check-in after 3 videos');
});

test('accepting with a trial length of 5 saves a five-video trial', () => {
  const { experiment, line } = acceptExperiment(coffeeProposal(), { now: NOW, trialLength: 5 });
  assert.equal(experiment.trialLength, 5);
  assert.equal(line, 'Trial saved · Check-in after 5 videos');
});

test('accepting a one-video trial says 1 video', () => {
  assert.equal(acceptExperiment(coffeeProposal({ trialLength: 1 }), { now: NOW }).line, 'Trial saved · Check-in after 1 video');
});

test('accepting with a trial length outside 1 to 10 throws TrialLengthError', () => {
  for (const bad of [0, 11, 2.5]) {
    assert.throws(() => acceptExperiment(coffeeProposal(), { now: NOW, trialLength: bad }), { name: 'TrialLengthError' });
  }
});

test('accepting stamps the time when none is given', () => {
  const { experiment } = acceptExperiment(coffeeProposal());
  assert.equal(Number.isNaN(Date.parse(experiment.acceptedAt)), false);
});

test('a second trial gets the next free id when the trials so far are passed', () => {
  const first = coffeeTrial();
  const second = acceptExperiment(coffeeProposal(), { now: NOW, existing: [first] }).experiment;
  assert.equal(second.id, 'e2');
  assert.equal(acceptExperiment(coffeeProposal(), { now: NOW, id: 'e9' }).experiment.id, 'e9');
});

test('accepting does not change the proposal it is given', () => {
  const proposal = coffeeProposal();
  const before = structuredClone(proposal);
  acceptExperiment(proposal, { now: NOW });
  assert.deepEqual(proposal, before);
});

test('keeping the old wording gives the proposal with status kept-old', () => {
  const proposal = coffeeProposal();
  const kept = keepOld(proposal);
  assert.deepEqual(kept, { ...proposal, status: 'kept-old' });
  assert.equal(proposal.status, 'proposed', 'the proposal given is not changed');
  assert.equal('change' in kept, false, 'a kept-old proposal is not an experiment');
});

test('a proposal answered keep old cannot be accepted afterwards', () => {
  assert.throws(() => acceptExperiment(keepOld(coffeeProposal()), { now: NOW }), { name: 'NotAcceptedError' });
});

// ---------- the counter and the check-in (D-62) ----------

test('a finished recording counts once and the trial is running', () => {
  const trial = coffeeTrial();
  const once = countRecording(trial, 'r1');
  assert.deepEqual(once.recordings, ['r1']);
  assert.equal(once.status, 'running');
  assert.deepEqual(trial.recordings, [], 'the experiment given is not changed');
  assert.equal(trial.status, 'accepted');
});

test('the same recording counted again changes nothing', () => {
  const once = countRecording(coffeeTrial(), 'r1');
  assert.deepEqual(countRecording(once, 'r1'), once);
});

test('the third recording brings the count to 3 and the check-in due', () => {
  const third = counted('r1', 'r2', 'r3');
  assert.deepEqual(third.recordings, ['r1', 'r2', 'r3']);
  assert.equal(third.status, 'check-in due');
});

test('a recording after the trial length is not counted while the check-in waits', () => {
  const third = counted('r1', 'r2', 'r3');
  assert.deepEqual(countRecording(third, 'r4'), third);
});

test('a recording is not counted once the check-in is answered', () => {
  const kept = answerCheckIn(counted('r1', 'r2', 'r3'), 'keep');
  assert.deepEqual(countRecording(kept, 'r4'), kept);
});

test('countRecording needs the id of the finished recording', () => {
  const trial = coffeeTrial();
  assert.throws(() => countRecording(trial, ''), { name: 'TypeError', message: /finished recording/ });
  assert.throws(() => countRecording(trial, undefined), { name: 'TypeError', message: /finished recording/ });
});

test('the check-in question is absent at counts 0, 1 and 2 and present at 3', () => {
  assert.deepEqual(checkInQuestions([coffeeTrial()]), [], 'count 0');
  assert.deepEqual(checkInQuestions([counted('r1')]), [], 'count 1');
  assert.deepEqual(checkInQuestions([counted('r1', 'r2')]), [], 'count 2');
  const questions = checkInQuestions([counted('r1', 'r2', 'r3')]);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].ask, "You've tried 'Grab a coffee' for 3 videos. Keep it?");
  assert.deepEqual(questions[0], {
    kind: 'experiment',
    experimentId: 'e1',
    ask: "You've tried 'Grab a coffee' for 3 videos. Keep it?",
    answers: ['keep', 'revert'],
  });
});

test('a one-video trial asks after 1 video', () => {
  const trial = countRecording(acceptExperiment(coffeeProposal(), { now: NOW, trialLength: 1 }).experiment, 'r1');
  assert.equal(checkInQuestions([trial])[0].ask, "You've tried 'Grab a coffee' for 1 video. Keep it?");
});

test('checkInQuestions asks only about trials that are due, and takes an empty or missing list', () => {
  const due = { ...counted('r1', 'r2', 'r3'), id: 'e2' };
  const questions = checkInQuestions([counted('r1'), due, keepOld(coffeeProposal())]);
  assert.deepEqual(questions.map((q) => q.experimentId), ['e2']);
  assert.deepEqual(checkInQuestions([]), []);
  assert.deepEqual(checkInQuestions(undefined), []);
});

test('answering keep gives status kept and no further question', () => {
  const due = counted('r1', 'r2', 'r3');
  const kept = answerCheckIn(due, 'keep');
  assert.equal(kept.status, 'kept');
  assert.deepEqual(checkInQuestions([kept]), []);
  assert.equal(due.status, 'check-in due', 'the experiment given is not changed');
  assert.equal(greetingFor(makeBrief(), [kept]), "Grab a coffee. Let's get into it.");
});

test('answering revert gives status reverted and the greeting goes back', () => {
  const reverted = answerCheckIn(counted('r1', 'r2', 'r3'), 'revert');
  assert.equal(reverted.status, 'reverted');
  assert.deepEqual(checkInQuestions([reverted]), []);
  assert.equal(greetingFor(makeBrief(), [reverted]), GREETING);
});

test('an answer that is neither keep nor revert throws CheckInAnswerError', () => {
  assert.throws(() => answerCheckIn(counted('r1', 'r2', 'r3'), 'maybe'), { name: 'CheckInAnswerError' });
});

test('the status line after one counted recording reads video 1 of 3', () => {
  assert.equal(statusLine(counted('r1')), 'video 1 of 3');
});

// ---------- the greeting the next recording opens on (D-58, D-62) ----------

test('the accepted coffee trial turns the greeting into Grab a coffee', () => {
  assert.equal(greetingFor({ greeting: GREETING }, [coffeeTrial()]), "Grab a coffee. Let's get into it.");
});

test('the greeting is the same when the change was heard in lower case', () => {
  const heard = proposeExperiment("let's try grab a coffee instead of grab a tea", { brief: makeBrief() });
  const { experiment } = acceptExperiment(heard, { now: NOW });
  assert.deepEqual(experiment.change, { from: 'grab a tea', to: 'grab a coffee' });
  assert.equal(greetingFor({ greeting: GREETING }, [experiment]), "Grab a coffee. Let's get into it.");
});

test('old wording in the middle of the greeting is replaced as it was said, with no capital added', () => {
  const heard = acceptExperiment(proposeExperiment("let's try grab a coffee instead of grab a tea", { brief: makeBrief() }), { now: NOW }).experiment;
  assert.equal(greetingFor({ greeting: 'Right, grab a tea, then we start.' }, [heard]), 'Right, grab a coffee, then we start.');
});

test('every place the old wording stands in the greeting is replaced, and the marks around it stay', () => {
  assert.equal(
    greetingFor({ greeting: "Grab a tea! Yes, 'grab a tea'." }, [coffeeTrial()]),
    "Grab a coffee! Yes, 'Grab a coffee'.",
  );
});

test('with no experiment the greeting is the brief\'s own', () => {
  assert.equal(greetingFor({ greeting: GREETING }, []), GREETING);
  assert.equal(greetingFor({ greeting: GREETING }, undefined), GREETING);
});

test('a kept-old proposal changes no greeting', () => {
  assert.equal(greetingFor({ greeting: GREETING }, [keepOld(coffeeProposal())]), GREETING);
  assert.equal(greetingFor({ greeting: GREETING }, [coffeeProposal()]), GREETING, 'nor does a proposal with no answer');
});

test('a brief with no greeting gives null', () => {
  assert.equal(greetingFor({ idea: 'x' }, [coffeeTrial()]), null);
  assert.equal(greetingFor(undefined, [coffeeTrial()]), null);
});

test('a trial whose old wording is not in the greeting leaves it as it is', () => {
  assert.equal(greetingFor({ greeting: 'Hello there.' }, [coffeeTrial()]), 'Hello there.');
});

test('greetingFor changes neither the brief nor the experiments it is given', () => {
  const brief = makeBrief();
  const trials = [coffeeTrial()];
  const before = structuredClone({ brief, trials });
  greetingFor(brief, trials);
  assert.deepEqual({ brief, trials }, before);
});

// ---------- D-63 over every line the trial's life adds ----------

test('no saved line, check-in question or status line claims or implies views or performance', () => {
  for (let n = 1; n <= 10; n += 1) {
    const { experiment, line } = acceptExperiment(coffeeProposal(), { now: NOW, trialLength: n });
    assertNoClaim(line);
    let trial = experiment;
    for (let k = 1; k <= n; k += 1) {
      trial = countRecording(trial, `r${k}`);
      assertNoClaim(statusLine(trial));
    }
    const questions = checkInQuestions([trial]);
    assert.equal(questions.length, 1, `a ${n}-video trial is due after ${n}`);
    assertNoClaim(questions[0].ask);
  }
});

test('a trial at its third video holds a count and a question, never a result', () => {
  const third = counted('r1', 'r2', 'r3');
  assert.deepEqual(Object.keys(third).sort(), ['acceptedAt', 'category', 'change', 'id', 'recordings', 'status', 'trialLength']);
  assert.deepEqual(Object.keys(checkInQuestions([third])[0]).sort(), ['answers', 'ask', 'experimentId', 'kind']);
  assert.deepEqual(Object.keys(answerCheckIn(third, 'keep')).sort(), Object.keys(third).sort());
});
