// Experiments (EXP-01; D-58 to D-63): the person asks YAP mid-take to try one
// wording instead of another, YAP offers a trial of a few videos, and the
// trial is remembered only once the person says yes.
//
// The exchange, word for word (Deth's confirmed image 17, COFFEE_SOURCE.txt):
//   You: "Hey YAP, let's try 'Grab a coffee' instead of 'Grab a tea.'"
//   YAP: "Try it for three videos, then check in?"
//   You: "Yeah, let's do that."
//   YAP: "Trial saved · Check-in after 3 videos"
//
// "Try X instead of Y" is read here, locally, with no network and no model
// (D-61), so the proposal can show in under a second. A model is asked in one
// place only, readExperimentRequest, and only when the caller passes `ask`.
//
// In a take the angle matcher (src/engine/swap.js) is asked first: "try the
// story instead of the tips" names two angles of the brief and is a swap. Only
// a remark the matcher makes no swap from is read here.
//
// No line this module produces claims or implies views or performance (D-63).
// A trial is a thing to try and then ask about, never a result.
//
// Pure and browser-safe: never mutates its inputs and returns new objects.

import { normalizeToken } from './text.js';

/**
 * @typedef {{ from: string, to: string }} Change
 * @typedef {'Greeting' | 'Hook' | 'Thumbnail' | 'Delivery'} Category
 * @typedef {{ id: string, exchangeId: string | null, category: Category, from: string, to: string,
 *   trialLength: number, status: 'proposed' | 'kept-old', ask: string }} Proposal
 * @typedef {{ greeting?: string, points?: { active?: string, angles?: { id: string, text?: string }[] }[] }} Brief
 * @typedef {'accepted' | 'running' | 'check-in due' | 'kept' | 'reverted'} ExperimentStatus
 * @typedef {{ id: string, category: Category, change: Change, trialLength: number, status: ExperimentStatus,
 *   recordings: string[], acceptedAt: string, scope?: { ideaId?: string, recordingId?: string } }} Experiment
 * @typedef {{ kind: 'experiment', experimentId: string, ask: string, answers: ['keep', 'revert'] }} CheckInQuestion
 */

/**
 * The life of a trial once the person has said yes (D-59): accepted, then
 * running from its first finished recording, then check-in due at its trial
 * length, then kept or reverted by the person's answer. A proposal ('proposed'
 * or 'kept-old') is never one of these and is never saved (D-60).
 */
export const EXPERIMENT_STATUSES = Object.freeze(['accepted', 'running', 'check-in due', 'kept', 'reverted']);
/** A trial still being counted or waiting for its check-in. */
const OPEN_STATUSES = Object.freeze(['accepted', 'running', 'check-in due']);
/** A trial whose new wording is the one in use: every status but reverted. */
const IN_USE_STATUSES = Object.freeze(['accepted', 'running', 'check-in due', 'kept']);

/** Seat defaults, one setting each (D-59, D-61). */
export const EXPERIMENT_DEFAULTS = Object.freeze({
  /** How many videos a trial runs for when the person names no number. */
  trialLength: 3,
  minLength: 1,
  maxLength: 10,
  /** The category tags, in the order they are looked for. */
  categories: Object.freeze(['Greeting', 'Hook', 'Thumbnail', 'Delivery']),
  /** The longest wording, in words, on either side of a change. */
  maxWords: 12,
  /** A remark holding none of these is never sent to a model. */
  trialWords: Object.freeze(['try', 'instead', 'swap', 'rather', 'trial', 'experiment']),
});

/** Every word the person sees about a trial. */
export const COPY = Object.freeze({
  proposal: 'Try it for {count} videos, then check in?',
  proposalOne: 'Try it for {count} video, then check in?',
  saved: 'Trial saved · Check-in after {n} videos',
  savedOne: 'Trial saved · Check-in after {n} video',
  checkIn: "You've tried '{to}' for {n} videos. Keep it?",
  checkInOne: "You've tried '{to}' for {n} video. Keep it?",
  status: 'video {k} of {n}',
  /** The trial length as a word in the proposal, one to ten. */
  counts: Object.freeze(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']),
});

/**
 * The wordings the local reader knows, one table (seat default for D-65,
 * .planning/QUESTIONS.md Q58). `verb` opens the request, with `lead` straight
 * before it when given; `split` stands between the two wordings; `first` says
 * which wording is spoken first. Any words may come before the verb.
 */
const PHRASINGS = Object.freeze([
  { lead: 'rather', verb: 'say', split: ['than'], first: 'to' }, // I'd rather say X than Y
  { verb: 'try', split: ['instead', 'of'], first: 'to' }, // let's try X instead of Y; can we try X instead of Y
  { verb: 'say', split: ['instead', 'of'], first: 'to' }, // let's say X instead of Y
  { verb: 'use', split: ['rather', 'than'], first: 'to' }, // use X rather than Y
  { verb: 'swap', split: ['for'], first: 'from' }, // swap Y for X
]);

/** Quote marks, end punctuation and spaces at either edge of a wording. */
const EDGE_CHARS = '\\s\'"‘’“”`.,!?;:';
const LEADING_EDGE = new RegExp(`^[${EDGE_CHARS}]+`);
const TRAILING_EDGE = new RegExp(`[${EDGE_CHARS}]+$`);
/** A word that ends its sentence: the mark is the last character, not inside a closing quote. */
const ENDS_SENTENCE = /[.!?]$/;

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Fill {name} slots literally (a function replacer, so `$` in a wording is kept as said). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

/** A word as the reader compares it: lower case, no quote marks or punctuation around it. */
const keyOf = (raw) => normalizeToken(raw).replace(/^'+|'+$/g, '');

/** The words of a text as spoken, each with the form it is compared by. */
function wordsOf(text) {
  return String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, key: keyOf(raw) }));
}

/** The compared forms of a text's words, empties dropped. */
const keysOf = (text) => wordsOf(text).map((w) => w.key).filter(Boolean);

/** A wording with the quote marks and end punctuation around it removed; the words inside keep their case. */
const clean = (text) => String(text ?? '').replace(LEADING_EDGE, '').replace(TRAILING_EDGE, '');

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * Read one phrasing from the words of a remark, or null when it is not there.
 * The verb taken is the last one that has the split words after it.
 */
function readPhrasing(words, phrasing, maxWords) {
  const splitAt = (from) => {
    for (let j = from; j + phrasing.split.length <= words.length; j += 1) {
      if (phrasing.split.every((word, k) => words[j + k].key === word)) return j;
    }
    return -1;
  };
  for (let v = words.length - 1; v >= 0; v -= 1) {
    if (words[v].key !== phrasing.verb) continue;
    if (phrasing.lead && (v === 0 || words[v - 1].key !== phrasing.lead)) continue;
    const s = splitAt(v + 1);
    if (s === -1) continue;
    const firstWords = words.slice(v + 1, s);
    // A sentence that ends between the verb and the split words is two
    // sentences, not one request ("Let's try that again. Instead of ...").
    if (firstWords.some((w) => ENDS_SENTENCE.test(w.raw))) return null;
    // The second wording runs to the end of its sentence.
    const rest = words.slice(s + phrasing.split.length);
    const end = rest.findIndex((w) => ENDS_SENTENCE.test(w.raw));
    const secondWords = end === -1 ? rest : rest.slice(0, end + 1);
    const first = clean(firstWords.map((w) => w.raw).join(' '));
    const second = clean(secondWords.map((w) => w.raw).join(' '));
    if (!first || !second) return null;
    if (wordCount(first) > maxWords || wordCount(second) > maxWords) return null;
    return phrasing.first === 'to' ? { to: first, from: second } : { to: second, from: first };
  }
  return null;
}

/**
 * Read "try X instead of Y", and the other phrasings of the table above, from
 * a remark. Synchronous, local, no network and no model (D-61). Returns null
 * for anything else, and when either wording is empty or over maxWords words.
 * @param {string} remark
 * @param {{ maxWords?: number }} [settings]
 * @returns {Change | null}
 */
export function parseTryInstead(remark, settings) {
  const { maxWords } = { ...EXPERIMENT_DEFAULTS, ...(settings || {}) };
  const words = wordsOf(remark);
  for (const phrasing of PHRASINGS) {
    const change = readPhrasing(words, phrasing, maxWords);
    if (change) return change;
  }
  return null;
}

/**
 * The short form of a request, the new wording alone: "let's try grab a
 * coffee instead", "say X instead", "change it to X". What it replaces is the
 * caller's to find (the greeting, or the first line of the beat on screen).
 * Null for the full form ("... instead of Y") and for anything else.
 * @param {string} remark
 * @param {{ maxWords?: number }} [settings]
 * @returns {{ to: string } | null}
 */
export function parseTryShort(remark, settings) {
  const { maxWords } = { ...EXPERIMENT_DEFAULTS, ...(settings || {}) };
  const words = wordsOf(remark);
  const taken = (list) => {
    const to = clean(list.map((w) => w.raw).join(' '));
    return to && wordCount(to) <= maxWords ? { to } : null;
  };
  for (let v = words.length - 1; v >= 0; v -= 1) {
    if (['try', 'say', 'use'].includes(words[v].key)) {
      const s = words.findIndex((w, j) => j > v + 1 && w.key === 'instead');
      if (s === -1 || words[s + 1]?.key === 'of') continue;
      const first = words.slice(v + 1, s);
      if (first.some((w) => ENDS_SENTENCE.test(w.raw))) continue;
      return taken(first);
    }
    if (words[v].key === 'change' && ['it', 'this', 'that'].includes(words[v + 1]?.key) && words[v + 2]?.key === 'to') {
      return taken(words.slice(v + 3));
    }
  }
  return null;
}

/** The first sentence of a text, the marks around it removed: "Grab a tea. Let's get into it." gives "Grab a tea". */
export function firstLine(text) {
  const words = wordsOf(text);
  const end = words.findIndex((w) => ENDS_SENTENCE.test(w.raw));
  return clean((end === -1 ? words : words.slice(0, end + 1)).map((w) => w.raw).join(' '));
}

/** A wording as it opens a line: its first letter a capital. */
export const asLine = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** Whether the words of `part` stand together, in order, inside `whole` (case and punctuation aside). */
function holds(whole, part) {
  const a = keysOf(whole);
  const b = keysOf(part);
  if (b.length === 0 || b.length > a.length) return false;
  for (let i = 0; i + b.length <= a.length; i += 1) {
    if (b.every((word, k) => a[i + k] === word)) return true;
  }
  return false;
}

/**
 * The category tag (D-59), chosen by where the old wording is found (seat
 * default, QUESTIONS.md Q58): the greeting, then the first talking point as
 * it is showing, then a remark that says thumbnail, otherwise Delivery.
 * @param {string} from
 * @param {string} remark
 * @param {Brief | undefined} brief
 * @returns {Category}
 */
function categoryOf(from, remark, brief) {
  const [greeting, hook, thumbnail, delivery] = EXPERIMENT_DEFAULTS.categories;
  if (holds(brief?.greeting, from)) return /** @type {Category} */ (greeting);
  const point = brief?.points?.[0];
  const showing = point?.angles?.find((angle) => angle.id === point.active);
  if (holds(showing?.text, from)) return /** @type {Category} */ (hook);
  if (keysOf(remark).some((key) => key === 'thumbnail' || key === 'thumbnails')) return /** @type {Category} */ (thumbnail);
  return /** @type {Category} */ (delivery);
}

/** A trial length inside the range, or a TrialLengthError. */
function checkedLength(trialLength) {
  const { minLength, maxLength } = EXPERIMENT_DEFAULTS;
  const n = trialLength === undefined ? EXPERIMENT_DEFAULTS.trialLength : trialLength;
  if (!Number.isInteger(n) || n < minLength || n > maxLength) {
    throw namedError('TrialLengthError', `A trial runs for ${minLength} to ${maxLength} videos, a whole number (got ${JSON.stringify(trialLength)})`);
  }
  return n;
}

/** YAP's question for a trial of n videos, the count as a word. */
function proposalLine(n) {
  return fill(n === 1 ? COPY.proposalOne : COPY.proposal, { count: COPY.counts[n - 1] });
}

/**
 * @param {Change} change
 * @param {string} remark
 * @param {{ brief?: Brief, trialLength: number, id?: string, exchangeId?: string | null }} options
 * @returns {Proposal}
 */
function buildProposal(change, remark, { brief, trialLength, id = 'p1', exchangeId = null }) {
  return {
    id,
    exchangeId,
    category: categoryOf(change.from, remark, brief),
    from: change.from,
    to: change.to,
    trialLength,
    status: 'proposed',
    ask: proposalLine(trialLength),
  };
}

/**
 * YAP's proposal for a remark the local reader reads, or null. The proposal
 * is only ever returned: nothing is saved before the person accepts (D-60).
 * @param {string} remark
 * @param {{ brief?: Brief, trialLength?: number, id?: string, exchangeId?: string | null }} [options]
 * @returns {Proposal | null}
 */
export function proposeExperiment(remark, options = {}) {
  const trialLength = checkedLength(options.trialLength);
  let change = parseTryInstead(remark);
  if (!change) {
    // The short form changes the greeting the take opens on. A take with no greeting has no proposal here:
    // the page reads it against the beat on screen (ui/lib/take-run.js).
    const short = parseTryShort(remark);
    const from = short ? firstLine(options.brief?.greeting) : '';
    if (from && keysOf(from).join(' ') !== keysOf(short.to).join(' ')) change = { from, to: asLine(short.to) };
  }
  return change ? buildProposal(change, remark, { ...options, trialLength }) : null;
}

/**
 * A proposal for a change the page read itself (a beat's own line), in the same shape as proposeExperiment's.
 * @param {{ from: string, to: string }} change
 * @param {string} remark
 * @param {{ brief?: Brief, trialLength?: number, id?: string, exchangeId?: string | null }} [options]
 * @returns {Proposal}
 */
export function proposeChange(change, remark, options = {}) {
  return buildProposal(change, remark, { ...options, trialLength: checkedLength(options.trialLength) });
}

/** A model's wording: edges cleaned, cut to maxWords words. */
function cutWording(value, maxWords) {
  if (typeof value !== 'string') return '';
  return clean(clean(value).split(/\s+/).filter(Boolean).slice(0, maxWords).join(' '));
}

/**
 * A model's answer read as a JSON object with `from` and `to` and nothing
 * else (T-01.1-17). Anything else is null.
 * @param {unknown} text
 * @param {number} maxWords
 * @returns {Change | null}
 */
function readModelChange(text, maxWords) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let answer;
  try {
    answer = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const from = cutWording(answer.from, maxWords);
  const to = cutWording(answer.to, maxWords);
  return from && to ? { from, to } : null;
}

/**
 * Read a remark as a request for a trial. The local reader is tried first; a
 * model is asked only when it reads nothing, the remark holds one of the trial
 * words, and the caller passed `ask` (the adapters of SETUP-01). With no `ask`
 * no model is ever called.
 *
 * A trial length outside the range throws TrialLengthError at the call. The
 * promise itself never rejects: a model that fails, or answers with anything
 * but a `from` and a `to`, gives null.
 * @param {string} remark
 * @param {{ brief?: Brief, trialLength?: number, id?: string, exchangeId?: string | null,
 *   ask?: (request: { task: 'experiment', text: string }) => Promise<{ source: string, text: string | null }> }} [options]
 * @returns {Promise<Proposal | null>}
 */
export function readExperimentRequest(remark, options = {}) {
  const trialLength = checkedLength(options.trialLength);
  const { ask, ...rest } = options;
  const local = parseTryInstead(remark);
  if (local) return Promise.resolve(buildProposal(local, remark, { ...rest, trialLength }));
  if (typeof ask !== 'function') return Promise.resolve(null);
  const trialWords = new Set(EXPERIMENT_DEFAULTS.trialWords);
  if (!keysOf(remark).some((key) => trialWords.has(key))) return Promise.resolve(null);
  return Promise.resolve()
    .then(() => ask({ task: 'experiment', text: String(remark) }))
    .then((answer) => {
      const change = readModelChange(answer?.text, EXPERIMENT_DEFAULTS.maxWords);
      return change ? buildProposal(change, remark, { ...rest, trialLength }) : null;
    })
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// The life of a trial: accept or keep old, count once per finished recording,
// check in at the trial length (D-59, D-60, D-62).
// ---------------------------------------------------------------------------

/** The first id of the form e1, e2, ... that no trial in the list has. */
function nextId(existing) {
  const taken = new Set((existing || []).map((experiment) => experiment && experiment.id));
  let n = 1;
  while (taken.has(`e${n}`)) n += 1;
  return `e${n}`;
}

/** The saved line and the check-in question name the count as a figure. */
const savedLine = (n) => fill(n === 1 ? COPY.savedOne : COPY.saved, { n });
const checkInLine = (to, n) => fill(n === 1 ? COPY.checkInOne : COPY.checkIn, { to, n });

/**
 * The person said yes: the proposal becomes an experiment, and YAP's line
 * says so. This is the first moment anything may be saved (D-60); saving is
 * the caller's, through src/node/trial-store.js.
 *
 * The id is `id` when given, else the next free one among `existing` (the
 * trials so far), else 'e1'. A store replaces a trial that has the same id.
 * @param {Proposal} proposal
 * @param {{ now?: string, trialLength?: number, id?: string, existing?: { id: string }[] }} [options]
 * @returns {{ experiment: Experiment, line: string }}
 */
export function acceptExperiment(proposal, { now, trialLength, id, existing } = {}) {
  if (!proposal || proposal.status !== 'proposed') {
    throw namedError('NotAcceptedError', `Only a proposal that has no answer yet can be accepted (status ${JSON.stringify(proposal?.status)})`);
  }
  const n = checkedLength(trialLength === undefined ? proposal.trialLength : trialLength);
  /** @type {Experiment} */
  const experiment = {
    id: id || nextId(existing),
    category: proposal.category,
    change: { from: proposal.from, to: proposal.to },
    trialLength: n,
    status: 'accepted',
    recordings: [],
    acceptedAt: now || new Date().toISOString(),
  };
  return { experiment, line: savedLine(n) };
}

/**
 * The person keeps the old wording: the proposal is answered and that is all.
 * It is not an experiment, and no store saves it.
 * @param {Proposal} proposal
 * @returns {Proposal}
 */
export function keepOld(proposal) {
  return { ...proposal, status: 'kept-old' };
}

/**
 * A recording that used the change has finished: it counts once (D-62). At
 * the trial length the check-in is due, and nothing more is counted until the
 * person has answered. The recording in which the trial was accepted counts
 * as video 1 when it finishes (seat default, QUESTIONS.md Q58).
 * @param {Experiment} experiment
 * @param {string} recordingId
 * @returns {Experiment}
 */
export function countRecording(experiment, recordingId) {
  if (typeof recordingId !== 'string' || recordingId === '') {
    throw new TypeError('countRecording needs the id of the finished recording');
  }
  const next = structuredClone(experiment);
  if (next.status !== 'accepted' && next.status !== 'running') return next;
  if (next.recordings.includes(recordingId)) return next;
  next.recordings.push(recordingId);
  next.status = next.recordings.length >= next.trialLength ? 'check-in due' : 'running';
  return next;
}

/** Whether a trial has run for its trial length and waits for the person's answer. */
function isDue(experiment) {
  return Boolean(experiment)
    && OPEN_STATUSES.includes(experiment.status)
    && Array.isArray(experiment.recordings)
    && experiment.recordings.length >= experiment.trialLength;
}

/**
 * The questions the next recording opens with: one for each trial that has
 * run for its trial length, and none before (D-62). A question asks whether
 * to keep the wording; it never says how the videos did (D-63).
 * @param {Experiment[]} experiments
 * @returns {CheckInQuestion[]}
 */
export function checkInQuestions(experiments) {
  return (experiments || []).filter(isDue).map((experiment) => ({
    kind: 'experiment',
    experimentId: experiment.id,
    ask: checkInLine(experiment.change.to, experiment.trialLength),
    answers: ['keep', 'revert'],
  }));
}

/**
 * The person's answer to a check-in: 'keep' keeps the new wording for good,
 * 'revert' goes back to the old one.
 * @param {Experiment} experiment
 * @param {'keep' | 'revert'} answer
 * @returns {Experiment}
 */
export function answerCheckIn(experiment, answer) {
  if (answer !== 'keep' && answer !== 'revert') {
    throw namedError('CheckInAnswerError', `A check-in is answered "keep" or "revert" (got ${JSON.stringify(answer)})`);
  }
  return { ...structuredClone(experiment), status: answer === 'keep' ? 'kept' : 'reverted' };
}

/**
 * Where a trial stands, as the person sees it: "video 1 of 3".
 * @param {Experiment} experiment
 * @returns {string}
 */
export function statusLine(experiment) {
  return fill(COPY.status, { k: experiment.recordings.length, n: experiment.trialLength });
}

/** Replace every place the words of `from` stand together in `text`, case aside, keeping the marks around them. */
function replaceWording(text, from, to, adaptCase = false) {
  const target = keysOf(from);
  if (target.length === 0 || !to) return text;
  const words = [];
  for (const match of text.matchAll(/\S+/g)) {
    const raw = match[0];
    const key = keyOf(raw);
    if (!key) continue;
    const lead = raw.length - raw.replace(LEADING_EDGE, '').length;
    const trail = raw.length - raw.replace(TRAILING_EDGE, '').length;
    words.push({ key, start: match.index + lead, end: match.index + raw.length - trail });
  }
  let out = '';
  let at = 0;
  for (let i = 0; i + target.length <= words.length; i += 1) {
    if (!target.every((key, k) => words[i + k].key === key)) continue;
    const start = words[i].start;
    const end = words[i + target.length - 1].end;
    // Keep a leading capital: "Grab a tea." becomes "Grab a coffee." also when "grab a coffee" was heard.
    const first = text[start];
    const capital = first !== first.toLowerCase();
    // Mid-sentence, a wording typed with a capital follows the sentence it lands in ("then grab a coffee"), but never an acronym or a name run together.
    const lower = adaptCase && !capital && /^[A-Z][a-z]/.test(to) ? to[0].toLowerCase() + to.slice(1) : to;
    out += text.slice(at, start) + (capital ? to[0].toUpperCase() + to.slice(1) : lower);
    at = end;
    i += target.length - 1;
  }
  return out + text.slice(at);
}

/**
 * A line with one wording swapped for another, whole words, case aside, the marks around kept.
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function swapWording(text, from, to) {
  return replaceWording(String(text ?? ''), from, clean(to), true);
}

/**
 * The greeting the next recording opens on (D-58, D-62): the brief's own,
 * with the change of every trial that is in use (accepted, running, due or
 * kept) applied in order. A proposal, a kept-old answer and a reverted trial
 * change nothing. Null when the brief has no greeting.
 * @param {Brief | undefined} brief
 * @param {(Experiment | Proposal)[]} [experiments]
 * @returns {string | null}
 */
export function greetingFor(brief, experiments) {
  const greeting = brief?.greeting;
  if (typeof greeting !== 'string' || greeting.trim() === '') return null;
  let text = greeting;
  for (const experiment of experiments || []) {
    if (!experiment || !IN_USE_STATUSES.includes(experiment.status) || !experiment.change) continue;
    text = replaceWording(text, experiment.change.from, experiment.change.to);
  }
  return text;
}

/**
 * The scope a wording trial is accepted in: the idea the recording belongs to,
 * else (a take with no idea) its recording chain: the first take's id, which a
 * Just-talk next take carries as the lineageId the caller already resolved.
 * A trial for one idea or chain never touches another's prompts.
 * @param {{ ideaId?: string | null, lineageId?: string | null } | null | undefined} meta
 * @param {string} recordingId
 * @returns {{ ideaId: string } | { recordingId: string }}
 */
export function trialScope(meta, recordingId) {
  return typeof meta?.ideaId === 'string' && meta.ideaId ? { ideaId: meta.ideaId } : { recordingId: (typeof meta?.lineageId === 'string' && meta.lineageId) || recordingId };
}

/** Whether a trial was accepted in this scope. A trial with no scope (the sample, a greeting) is in none. */
function inScope(experiment, scope) {
  const own = experiment?.scope;
  if (!own || !scope) return false;
  if (typeof own.ideaId === 'string' && own.ideaId) return own.ideaId === scope.ideaId;
  return typeof own.recordingId === 'string' && own.recordingId !== '' && own.recordingId === scope.recordingId;
}

/**
 * The wording of one line of the person's own prompt with the trials of this
 * scope applied (EXP-01): each trial in use (accepted, running, due or kept,
 * never a proposal, a kept-old answer or a reverted trial) swaps its exact old
 * wording for its new one, whole words, case aside, the marks around kept.
 * A line that does not hold the old wording comes back as it was, and a trial
 * is the one change it names: nothing here is remembered as a preference, and
 * the person's saved beats are never rewritten, only the text shown.
 * @param {string} text
 * @param {(Experiment | Proposal)[]} [experiments]
 * @param {{ ideaId?: string, recordingId?: string } | null} [scope]
 * @returns {string}
 */
export function applyWordingTrials(text, experiments, scope) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const experiment of experiments || []) {
    if (!experiment || !IN_USE_STATUSES.includes(experiment.status) || !experiment.change || !inScope(experiment, scope)) continue;
    out = replaceWording(out, experiment.change.from, clean(experiment.change.to), true);
  }
  return out;
}
