// Cues carry forward (MEM-03; D-56, D-57). An accepted review moment or a kept
// note opens the next recording with one question, for example "Last time you
// wanted to slow down during the opening. Keep that cue?". A dismissed one is
// not asked again.
//
// What is carried lives in two optional fields beside Phase 1's kept notes in
// memory.json: `carried` (the cues, each waiting for its answer or kept) and
// `dismissed` (the keys never to ask again). This module adds those fields and
// changes none of Phase 1's: `notes`, `paceCue` and `settings` are left as
// they are, so Phase 1's first cue is what it was. A memory with neither field
// is read as holding none.
//
// Nothing is picked for the person: a question with no answer is still asked
// next time.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its
// inputs, and every function returns new objects. The session reads and
// writes memory.json through src/node/store.js.
import { emptyMemory } from './memory.js';
import { DELIVERY_CUES } from './delivery.js';

/**
 * @typedef {'story' | 'delivery'} Stream
 * @typedef {object} Carried
 * @property {string} key             the same moment in a later take has the same key
 * @property {Stream} stream
 * @property {string} kind            a delivery cue kind, 'talking-point', or 'note'
 * @property {string} text            the cue's wording
 * @property {number | null} beatIndex
 * @property {string | null} where    "the opening", "the ending" or a beat's label in quotes
 * @property {'moment' | 'note'} from
 * @property {'ask' | 'kept'} state   'ask' until the person answers the opening question
 * @typedef {{ key: string, ask: string, options: { value: 'keep' | 'drop', label: string }[] }} OpeningQuestion
 * @typedef {{ stream: Stream, kind: string, text: string, beatIndex: number | null, where: string | null, beatId?: string | null }} CarriedCue
 * @typedef {import('./memory.js').Memory & { carried?: Carried[], dismissed?: string[] }} CarryMemory
 */

/** Every word the person sees from this module. */
export const COPY = Object.freeze({
  ask: 'Last time you wanted to {phrase} during {where}. Keep that cue?',
  askNowhere: 'Last time you wanted to {phrase}. Keep that cue?',
  askNote: 'Last time you noted "{text}". Keep that cue?',
  keep: 'Keep it',
  drop: 'Not this time',
  /** How each delivery cue reads inside the question, while it keeps its own wording. */
  phrases: Object.freeze({
    'slow-down': 'slow down',
    smile: 'smile',
    'more-energy': 'bring more energy',
    pause: 'pause',
    'look-at-lens': 'look at the lens',
    'land-the-point': 'land the point',
  }),
  phraseStory: "get to '{text}'",
  phraseEdited: "keep the cue '{text}'",
});

const ANSWERS = Object.freeze(['keep', 'drop']);

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Fill {name} slots literally (a function replacer, so `$` in a wording is kept as written). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

/** A string as plain text on one line; anything else is empty. */
function plain(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

/** @returns {Carried} */
function copyCarried(c) {
  return {
    key: c.key,
    stream: c.stream === 'story' ? 'story' : 'delivery',
    kind: String(c.kind),
    text: plain(c.text),
    beatIndex: Number.isInteger(c.beatIndex) ? c.beatIndex : null,
    where: plain(c.where) || null,
    from: c.from === 'note' ? 'note' : 'moment',
    state: c.state === 'kept' ? 'kept' : 'ask',
  };
}

/** The carried cues of a memory, as new objects; none when the field is missing. */
function carriedOf(memory) {
  const list = isObject(memory) && Array.isArray(memory.carried) ? memory.carried : [];
  return list.filter((c) => isObject(c) && typeof c.key === 'string').map(copyCarried);
}

/** The dismissed keys of a memory, as a new list; none when the field is missing. */
function dismissedOf(memory) {
  const list = isObject(memory) && Array.isArray(memory.dismissed) ? memory.dismissed : [];
  return list.filter((k) => typeof k === 'string');
}

function notesOf(memory) {
  const list = isObject(memory) && Array.isArray(memory.notes) ? memory.notes : [];
  return list.filter((n) => isObject(n) && plain(n.text) !== '');
}

/** The key of a moment: its source, its cue kind and its beat index, joined. */
function momentKey(moment) {
  const kind = isObject(moment.suggestedCue) ? String(moment.suggestedCue.kind) : '';
  const beat = Number.isInteger(moment.beatIndex) ? String(moment.beatIndex) : '';
  return [String(moment.source), kind, beat].join('|');
}

/** The key of a kept note. A note kept again at a later Return has a new key, so it is asked about again. */
function noteKey(note) {
  return ['note', String(note.id), String(note.keptAt)].join('|');
}

function ownWording(kind) {
  const own = DELIVERY_CUES.find((c) => c.kind === kind);
  return own ? own.text : '';
}

/** How a carried cue reads inside the question. */
function phraseOf(cue) {
  if (cue.stream === 'story') return fill(COPY.phraseStory, { text: cue.text });
  const known = Object.prototype.hasOwnProperty.call(COPY.phrases, cue.kind);
  if (known && cue.text === ownWording(cue.kind)) return COPY.phrases[cue.kind];
  return fill(COPY.phraseEdited, { text: cue.text });
}

/** @returns {OpeningQuestion} */
function question(key, ask) {
  return {
    key,
    ask,
    options: [
      { value: 'keep', label: COPY.keep },
      { value: 'drop', label: COPY.drop },
    ],
  };
}

function askOf(cue) {
  if (cue.from === 'note') return fill(COPY.askNote, { text: cue.text });
  const phrase = phraseOf(cue);
  return cue.where ? fill(COPY.ask, { phrase, where: cue.where }) : fill(COPY.askNowhere, { phrase });
}

/**
 * After a take: carry the person's decisions about its review moments into
 * the memory (D-56). Each accepted moment's suggested cue is added to
 * `carried` in state 'ask'; each dismissed moment's key is recorded in
 * `dismissed` and its cue, if one was carried, is taken away. A moment with no
 * decision changes nothing, so a key already dismissed stays silent. A fresh
 * accept is the person's new choice: it clears the dismissed key and asks
 * again. When two moments of one take share a key, an accept stands over a
 * dismissal.
 *
 * @param {CarryMemory | null | undefined} memory
 * @param {{ moments?: import('./review.js').Moment[], now?: string }} [take]
 *   `now` is accepted for the caller's convenience and is not stored: a carried cue holds no time.
 * @returns {CarryMemory}
 */
export function carryForward(memory, take = {}) {
  const base = isObject(memory) ? memory : emptyMemory();
  let carried = carriedOf(base);
  let dismissed = dismissedOf(base);
  const moments = (isObject(take) && Array.isArray(take.moments) ? take.moments : []).filter(isObject);

  /** @type {Map<string, Carried>} */
  const accepted = new Map();
  /** @type {string[]} */
  const dismissedNow = [];
  for (const moment of moments) {
    const key = momentKey(moment);
    if (moment.decision === 'dismissed') {
      dismissedNow.push(key);
    } else if (moment.decision === 'accepted' && isObject(moment.suggestedCue)) {
      const cue = moment.suggestedCue;
      const stream = cue.stream === 'story' ? 'story' : 'delivery';
      const text = plain(cue.text) || (stream === 'delivery' ? ownWording(cue.kind) : '');
      if (text === '') continue; // no cue to carry
      accepted.set(
        key,
        copyCarried({ key, stream, kind: cue.kind, text, beatIndex: moment.beatIndex, where: moment.where, from: 'moment', state: 'ask' }),
      );
    }
  }

  for (const key of dismissedNow) {
    if (accepted.has(key)) continue;
    carried = carried.filter((c) => c.key !== key);
    if (!dismissed.includes(key)) dismissed.push(key);
  }
  for (const [key, entry] of accepted) {
    dismissed = dismissed.filter((k) => k !== key);
    const at = carried.findIndex((c) => c.key === key);
    if (at === -1) carried.push(entry);
    else carried[at] = entry;
  }
  return { ...base, carried, dismissed };
}

/**
 * The questions the next recording opens with: one per carried cue still
 * waiting for its answer, then one per kept note not yet asked about.
 * @param {CarryMemory | null | undefined} memory
 * @returns {OpeningQuestion[]}
 */
export function openingQuestions(memory) {
  const carried = carriedOf(memory);
  const settled = new Set([...carried.map((c) => c.key), ...dismissedOf(memory)]);
  const cues = carried.filter((c) => c.state === 'ask').map((c) => question(c.key, askOf(c)));
  const notes = notesOf(memory)
    .filter((n) => !settled.has(noteKey(n)))
    .map((n) => question(noteKey(n), fill(COPY.askNote, { text: plain(n.text) })));
  return [...cues, ...notes];
}

/**
 * Apply the person's answers to the opening questions. 'keep' makes the cue
 * one of the carried cues for the coming recording; 'drop' removes it and
 * records its key as dismissed. A question with no answer is left as it is
 * and is asked again next time. Phase 1's kept notes are never changed here.
 *
 * `answerOpening(memory, key, answer)` answers one question.
 *
 * Throws UnknownOpeningError for a key no question asks about, and
 * UnknownOpeningAnswerError for an answer that is neither 'keep' nor 'drop'.
 *
 * @param {CarryMemory | null | undefined} memory
 * @param {{ [key: string]: 'keep' | 'drop' } | string} answers
 * @param {'keep' | 'drop'} [answer]
 * @returns {CarryMemory}
 */
export function answerOpening(memory, answers, answer) {
  const base = isObject(memory) ? memory : emptyMemory();
  const given = typeof answers === 'string' ? { [answers]: answer } : isObject(answers) ? answers : {};
  let carried = carriedOf(base);
  let dismissed = dismissedOf(base);

  for (const [key, value] of Object.entries(given)) {
    if (!ANSWERS.includes(value)) {
      throw namedError('UnknownOpeningAnswerError', `an opening question is answered ${ANSWERS.join(' or ')} (got "${String(value)}")`);
    }
    const at = carried.findIndex((c) => c.key === key);
    const note = at === -1 ? notesOf(base).find((n) => noteKey(n) === key) : null;
    if (at === -1 && !note) throw namedError('UnknownOpeningError', `no opening question has the key "${key}"`);

    if (value === 'drop') {
      carried = carried.filter((c) => c.key !== key);
      if (!dismissed.includes(key)) dismissed.push(key);
    } else if (at !== -1) {
      carried[at] = { ...carried[at], state: 'kept' };
    } else {
      dismissed = dismissed.filter((k) => k !== key);
      carried.push(
        copyCarried({ key, stream: 'story', kind: 'note', text: note.text, beatIndex: null, where: null, from: 'note', state: 'kept' }),
      );
    }
  }
  return { ...base, carried, dismissed };
}

/**
 * The cues the person kept for the coming recording. Split them by `stream`:
 * a 'delivery' cue is a pick for `chooseDeliveryCues`; a 'story' cue is a
 * talking point (kind 'talking-point') or a kept note (kind 'note', the note
 * Phase 1's first cue is built from). Given the beats of the coming recording,
 * each cue also names its beat (`beatId`, null when that place has no beat).
 *
 * @param {CarryMemory | null | undefined} memory
 * @param {{ id?: string, beatId?: string }[]} [beats]
 * @returns {CarriedCue[]}
 */
export function carriedCues(memory, beats) {
  return carriedOf(memory)
    .filter((c) => c.state === 'kept')
    .map((c) => {
      /** @type {CarriedCue} */
      const cue = { stream: c.stream, kind: c.kind, text: c.text, beatIndex: c.beatIndex, where: c.where };
      if (Array.isArray(beats)) {
        const beat = c.beatIndex === null ? null : beats[c.beatIndex];
        const id = isObject(beat) ? (typeof beat.id === 'string' ? beat.id : beat.beatId) : null;
        cue.beatId = typeof id === 'string' ? id : null;
      }
      return cue;
    });
}
