import { preparedAngleFields } from '../engine/prepared-angles.js';
// The idea store: ideas.json in the data folder, with the bundled idea bank
// read beside it (D-105, D-116, D-117, D-120). An idea and what the person
// chose on it (its kept beats, format, ticks and typed words) are kept on this
// machine only, and are still there after a reload.
//
// Where ideas are kept is a seat default (D-99; QUESTIONS.md Q151). It is named
// once, here: IDEAS_FILE in the data folder. The bank is always the six drawn
// cards and no seventh (Q152): BANK_FILE, which this module only ever reads.
//
// A bundled idea is changed like any other, with no create first. What was
// changed on a bank id is kept in ideas.json under that id, as the changed keys
// alone, and is laid over the bank's idea on every read.
//
// Threats handled here: an id is checked against the route id rule before any
// file is touched, and an id is never part of a file name (T-02-06); the data
// folder is resolved through Phase 1's resolveDataDir and cannot lie outside
// the app folder; the one file is written through a temp file then renamed,
// and a broken file throws and names itself. A patch takes a closed list of
// keys, text is cut to TEXT_MAX characters and lists to LIST_MAX items
// (T-02-05). Nothing here opens a connection or reads a key.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecordingId } from '../engine/recording.js';
import { resolveDataDir, readJson, writeJsonAtomic } from './store.js';

/**
 * @typedef {{ id: string, title: string, line: string }} KeptBeat
 * @typedef {{ id: string, title: string, line: string, source: 'idea' | 'suggestion' }} DrawnBeat
 * @typedef {{
 *   id: string, title: string, thought: string, words: string[],
 *   state: 'exploring' | 'shaping' | 'confirming' | 'saved' | 'thought',
 *   format: string, thumb: string, ticks: Record<string, boolean>,
 *   keptBeats: KeptBeat[], createdAt: string | null,
 *   desc: string, updated: string, beats: DrawnBeat[],
 * }} Idea
 */

const DEFAULT_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one file ideas are kept in, inside the data folder (seat default, Q151). */
export const IDEAS_FILE = 'ideas.json';
/** The bundled idea bank, relative to the app folder. Read only. */
export const BANK_FILE = 'ui/data/idea-bank.json';
/** The states an idea can be in (D-104, D-112 to D-115). */
export const IDEA_STATES = Object.freeze(['exploring', 'shaping', 'confirming', 'saved', 'thought']);
/** The only keys a patch may carry. Every other key is ignored. */
export const PATCH_KEYS = Object.freeze(['state', 'format', 'thumb', 'ticks', 'message', 'keptBeats']);
/**
 * The key that renames an idea. It is its own key beside PATCH_KEYS, not a
 * member of the list: a patch's `title` stays ignored (a title is never set by
 * accident), and `rename` is the one deliberate way to change it.
 */
export const RENAME_KEY = 'rename';
/**
 * The key that keeps the beats YAP wrote for an idea and the person has not
 * answered yet (ui/beats). Its own key beside PATCH_KEYS, as rename is: each
 * is { id, title, line }, and a reload offers the same ones again.
 */
export const OFFERED_KEY = 'offeredBeats';
/** A new title is 1 to this many characters. A longer one is refused, never cut. */
export const TITLE_MAX = 120;
/** Text is cut to this many characters. */
export const TEXT_MAX = 500;
/** A list is cut to this many items. */
export const LIST_MAX = 12;

/** What a patch can leave on an idea. On a bank id these are the keys laid over the bank's idea. */
const KEPT_KEYS = Object.freeze(['title', 'state', 'format', 'thumb', 'ticks', 'words', 'keptBeats', OFFERED_KEY]);
/** The name of one tick: a short lower-case word, as the confirm screen's points are named. */
const TICK_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const CREATED_ID = /^idea-(\d{1,9})$/;
const SOURCES = Object.freeze(['idea', 'suggestion']);

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

const invalid = (message) => namedError('InvalidIdeaError', message);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shown = (v) => (v === undefined ? 'nothing' : JSON.stringify(v));

/**
 * Whether a value can be an idea's id. The same rule as an id in a route and a
 * Recording id; test/idea-store.test.js holds it to the route table.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isIdeaId(id) {
  return isRecordingId(id);
}

/** Text cut to TEXT_MAX characters, never leaving half of a two-part character. */
function cut(text) {
  if (text.length <= TEXT_MAX) return text;
  const last = text.charCodeAt(TEXT_MAX - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? TEXT_MAX - 1 : TEXT_MAX);
}

function assertId(id) {
  if (!isIdeaId(id)) {
    throw namedError('InvalidIdeaIdError', `An idea id is 1 to 64 lower-case letters, digits and hyphens (found ${shown(id)})`);
  }
}

/** One kept beat, as it is saved: its id, title and line and nothing else. */
function keptBeat(value) {
  if (!isObject(value) || !isIdeaId(value.id) || typeof value.title !== 'string' || typeof value.line !== 'string') {
    throw invalid('Each kept beat is { id, title, line }, with an id of lower-case letters, digits and hyphens');
  }
  let angles;try { angles=preparedAngleFields(value.preparedAngles); } catch(error) { throw invalid(error.message); }
  return { id: value.id, title: cut(value.title), line: cut(value.line), ...angles };
}

/**
 * A new title, as it is kept: white space runs become one space and the ends
 * are trimmed. Throws InvalidIdeaError for text that is not a string, is empty
 * once trimmed, holds a control character, or is longer than TITLE_MAX
 * characters (counted as characters, not UTF-16 units).
 * @param {unknown} value
 * @returns {string}
 */
export function cleanTitle(value) {
  if (typeof value !== 'string') throw invalid('rename is text: the idea\'s new title');
  const plain = value.replace(/\s+/g, ' ').trim();
  if (plain === '') throw invalid('A title cannot be empty');
  if (/\p{Cc}/u.test(plain)) throw invalid('A title is plain text, with no control characters');
  if (Array.from(plain).length > TITLE_MAX) throw invalid(`A title is at most ${TITLE_MAX} characters`);
  return plain;
}

/**
 * What a patch changes on an idea, as the keys to keep. Throws
 * InvalidIdeaError, before anything is written, when a listed key carries a
 * value it does not take. A key outside PATCH_KEYS is ignored.
 * @param {Idea} idea the idea as it stands
 * @param {unknown} patch
 * @returns {Partial<Idea>}
 */
function changesOf(idea, patch) {
  if (!isObject(patch)) throw invalid('A patch is an object of the keys to change');
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  const changes = {};
  // A rename changes the title and nothing else: the thought, words, beats, ticks and state stay as they were.
  if (has(RENAME_KEY)) {
    const title = cleanTitle(patch[RENAME_KEY]);
    if (title !== idea.title) changes.title = title;
  }
  if (has('state')) {
    if (!IDEA_STATES.includes(patch.state)) throw invalid(`state is one of ${IDEA_STATES.join(', ')} (found ${shown(patch.state)})`);
    changes.state = patch.state;
  }
  for (const key of ['format', 'thumb']) {
    if (!has(key)) continue;
    if (typeof patch[key] !== 'string') throw invalid(`${key} is text`);
    changes[key] = cut(patch[key]);
  }
  if (has('ticks')) {
    if (!isObject(patch.ticks)) throw invalid('ticks is an object of true and false, by the name of each point');
    const ticks = { ...idea.ticks };
    for (const [name, value] of Object.entries(patch.ticks)) {
      if (!TICK_NAME.test(name) || typeof value !== 'boolean') throw invalid('ticks is an object of true and false, by the name of each point');
      if (name in ticks || Object.keys(ticks).length < LIST_MAX) ticks[name] = value;
    }
    changes.ticks = ticks;
  }
  if (has('message')) {
    if (typeof patch.message !== 'string') throw invalid('message is text');
    const message = cut(patch.message.trim());
    // A typed message is kept after the words already there; the newest LIST_MAX stay.
    if (message) changes.words = [...idea.words, message].slice(-LIST_MAX);
  }
  if (has('keptBeats')) {
    if (!Array.isArray(patch.keptBeats)) throw invalid('keptBeats is a list of { id, title, line }');
    changes.keptBeats = patch.keptBeats.slice(0, LIST_MAX).map(keptBeat);
  }
  if (has(OFFERED_KEY)) {
    if (!Array.isArray(patch[OFFERED_KEY])) throw invalid('offeredBeats is a list of { id, title, line }');
    changes[OFFERED_KEY] = patch[OFFERED_KEY].slice(0, LIST_MAX).map((beat) => { const { id, title, line } = keptBeat(beat); return { id, title, line }; });
  }
  return changes;
}

/** An idea with every key, from whatever keys a record holds. */
function whole(record) {
  return {
    id: record.id,
    title: typeof record.title === 'string' ? record.title : '',
    thought: typeof record.thought === 'string' ? record.thought : '',
    words: Array.isArray(record.words) ? record.words.filter((w) => typeof w === 'string') : [],
    state: IDEA_STATES.includes(record.state) ? record.state : 'saved',
    format: typeof record.format === 'string' ? record.format : '',
    thumb: typeof record.thumb === 'string' ? record.thumb : '',
    ticks: isObject(record.ticks) ? { ...record.ticks } : {},
    keptBeats: Array.isArray(record.keptBeats) ? record.keptBeats : [],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    desc: typeof record.desc === 'string' ? record.desc : '',
    updated: typeof record.updated === 'string' ? record.updated : '',
    beats: Array.isArray(record.beats) ? record.beats : [],
    // Only an idea YAP has written suggestions for carries them.
    ...(Array.isArray(record[OFFERED_KEY]) ? { [OFFERED_KEY]: record[OFFERED_KEY] } : {}),
  };
}

/** The keys of KEPT_KEYS a record holds, and nothing else of it. */
function keptOf(record) {
  const kept = {};
  for (const key of KEPT_KEYS) if (Object.prototype.hasOwnProperty.call(record, key)) kept[key] = record[key];
  return kept;
}

/**
 * The ideas on disk, in `<dataDir>/ideas.json`, with the bundled bank beside
 * them. Nothing is written until the first create or patch.
 * @param {string} [dataDir] relative to the app folder, or absolute inside it; default 'data'
 * @param {{ appRoot?: string }} [options]
 * @returns {{
 *   list(): Idea[],
 *   load(id: string): Idea | null,
 *   create(input: { thought: string, now?: Date | string | number }): Idea,
 *   patch(id: string, patch: object): Idea | null,
 * }}
 */
export function createIdeaStore(dataDir, { appRoot = DEFAULT_APP_ROOT } = {}) {
  const file = path.join(resolveDataDir(appRoot, dataDir), IDEAS_FILE);
  const bankFile = path.join(path.resolve(appRoot), ...BANK_FILE.split('/'));
  const bankName = path.basename(BANK_FILE);
  /** @type {object[] | null} */
  let bank = null;

  /** The bank's ideas, read once per store. The bank file is never written. */
  function readBank() {
    if (bank) return bank;
    const corrupt = (why) => namedError('CorruptIdeaBankError', `${bankName} ${why}`);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(bankFile, 'utf8'));
    } catch (err) {
      if (err instanceof SyntaxError) throw corrupt(`is not valid JSON (${err.message})`);
      if (err && err.code === 'ENOENT') throw corrupt('is missing: the app is not whole');
      throw err;
    }
    if (!isObject(data) || !Array.isArray(data.ideas)) throw corrupt('must hold an "ideas" list');
    const seen = new Set();
    for (const idea of data.ideas) {
      if (!isObject(idea) || !isIdeaId(idea.id) || typeof idea.title !== 'string' || seen.has(idea.id)) {
        throw corrupt('must hold ideas that each have their own id and a title');
      }
      if (idea.beats !== undefined && !(Array.isArray(idea.beats) && idea.beats.every((b) => isObject(b) && isIdeaId(b.id) && SOURCES.includes(b.source)))) {
        throw corrupt(`holds a beat of ${idea.id} that has no id or no source`);
      }
      seen.add(idea.id);
    }
    bank = data.ideas;
    return bank;
  }

  /** The records in ideas.json, in the order they were first written; [] when there is no file. */
  function read() {
    const corrupt = (why) => namedError('CorruptIdeaFileError', `${IDEAS_FILE} ${why}`);
    let data;
    try {
      data = readJson(file, undefined);
    } catch (err) {
      if (err instanceof SyntaxError) throw corrupt(`is not valid JSON, the file may be half-written (${err.message})`);
      throw err;
    }
    if (data === undefined) return [];
    if (!isObject(data) || !Array.isArray(data.ideas)) throw corrupt('must hold an "ideas" list');
    const seen = new Set();
    for (const record of data.ideas) {
      if (!isObject(record) || !isIdeaId(record.id) || seen.has(record.id)) throw corrupt('must hold ideas that each have their own id');
      seen.add(record.id);
    }
    return data.ideas;
  }

  const write = (records) => writeJsonAtomic(file, { version: 1, ideas: records });

  /** A bank idea with what was changed on it laid over it. */
  const overBank = (bankIdea, record) => whole({ ...bankIdea, ...(record ? keptOf(record) : {}) });

  /** Every idea: the bank's first, in their bundled order, then the created ones, oldest first. */
  function all() {
    const bankIdeas = readBank();
    const records = read();
    const bankIds = new Set(bankIdeas.map((i) => i.id));
    return [
      ...bankIdeas.map((idea) => overBank(idea, records.find((r) => r.id === idea.id))),
      ...records.filter((r) => !bankIds.has(r.id)).map(whole),
    ];
  }

  return {
    /** Every idea, as copies: the six bank ideas, sample first, then the created ones. */
    list() {
      return structuredClone(all());
    },

    /**
     * One idea by its id, as a copy; null when it is in neither the bank nor
     * the file. An id that breaks the id rule throws InvalidIdeaIdError before
     * any file is touched.
     */
    load(id) {
      assertId(id);
      const idea = all().find((i) => i.id === id);
      return idea ? structuredClone(idea) : null;
    },

    /**
     * Keep a new idea from the person's first words. Its id is `idea-<n>`,
     * one past the highest in the bank and the file, so it is never a bank id.
     * Throws InvalidIdeaError, and writes nothing, when there are no words.
     */
    create(input) {
      const thought = isObject(input) && typeof input.thought === 'string' ? cut(input.thought.trim()) : '';
      if (!thought) throw invalid('An idea starts from a thought: some words');
      const now = isObject(input) && input.now !== undefined ? input.now : Date.now();
      const at = now instanceof Date || typeof now === 'string' || typeof now === 'number' ? new Date(now) : new Date(NaN);
      if (Number.isNaN(at.getTime())) throw invalid('now is a date');
      const records = read();
      const numbers = [...readBank(), ...records].map((i) => CREATED_ID.exec(i.id)).filter(Boolean).map((m) => Number(m[1]));
      const id = `idea-${Math.max(0, ...numbers) + 1}`;
      assertId(id);
      const idea = whole({ id, title: thought, thought, words: [thought], state: 'exploring', createdAt: at.toISOString() });
      write([...records, idea]);
      return structuredClone(idea);
    },

    /**
     * Change what the person chose on an idea, a bank id or a created one, and
     * give the idea back. Null, with nothing written, when the id is in neither
     * the bank nor the file. A patch with no listed key writes nothing.
     */
    patch(id, patch) {
      assertId(id);
      const idea = all().find((i) => i.id === id);
      if (!idea) return null;
      const changes = changesOf(idea, patch);
      if (Object.keys(changes).length === 0) return structuredClone(idea);
      const records = read();
      const at = records.findIndex((r) => r.id === id);
      // A bank id keeps only its changed keys; a created idea is kept whole.
      if (at === -1) records.push({ id, ...changes });
      else records[at] = { ...records[at], ...changes };
      write(records);
      return structuredClone({ ...idea, ...changes });
    },
  };
}
