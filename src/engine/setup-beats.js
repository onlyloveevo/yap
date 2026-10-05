// The three starts of a recording and the limits that keep a model's beats to
// memory triggers (SETUP-01; D-40, D-41, D-42).
//
// Just talk gives the default beats and asks no model. Start from an idea and
// Paste something ask a model through the `ask` function handed in, then cut
// whatever comes back to the limits: a beat is a short label and a few short
// triggers, never sentences to read out. The beats become Phase 1's episode
// through createEpisode (beatsToPoints): there is no second episode model (D-37).
//
// Pure and browser-safe: imports nothing, never mutates its inputs, and reaches
// a model only through `ask`.

/**
 * @typedef {{ id: string, label: string, points: string[], source: 'default' | 'model' }} StoryBeat
 * @typedef {{ label: string, points: string[] }} RawBeat
 * @typedef {{ source: string, text: string | null }} ModelAnswer
 * @typedef {(request: { task: 'beats', text: string }) => Promise<ModelAnswer>} Ask
 * @typedef {{ beats: StoryBeat[], source: string, shortened: boolean }} WrittenBeats
 */

/** The limits of D-41, and how much of the person's text a model is shown. One setting each. */
export const BEAT_LIMITS = Object.freeze({
  minBeats: 3,
  maxBeats: 6,
  labelWords: 3,
  pointsPerBeat: 3,
  pointWords: 6,
  textChars: 4000,
});

/** Just talk (D-40): four beats, no talking points. */
export const DEFAULT_BEATS = Object.freeze(
  ['Hook', 'Story', 'Point', 'Takeaway'].map((label, i) => Object.freeze({
    id: `s${i + 1}`,
    label,
    points: Object.freeze([]),
    source: 'default',
  })),
);

/** Which default beats fill a list of fewer than three, tried in this order. */
const PAD_ORDER = Object.freeze(['Takeaway', 'Hook', 'Story', 'Point']);

/** An added beat with this label opens the list; every other added beat closes it. */
const OPENING_LABEL = 'Hook';

/** How many "[" a model's text is searched from before giving up. */
const MAX_ARRAY_STARTS = 100;

/** A run of text between spaces is a word when it holds a letter or a digit, in any script. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/** A trigger is not a sentence: the punctuation that ends one is taken off. A question mark stays. */
const END_PUNCTUATION = /[.,;:…。]+$/u;

/**
 * Keep the first `max` words, whole. Never cuts inside a word.
 * @param {string} value
 * @param {number} max
 * @returns {{ text: string, cut: boolean }}
 */
function cutWords(value, max) {
  const words = String(value).split(/\s+/).filter((chunk) => HAS_WORD.test(chunk));
  return {
    text: words.slice(0, max).join(' ').replace(END_PUNCTUATION, ''),
    cut: words.length > max,
  };
}

/**
 * A fresh copy of the default beats.
 * @returns {StoryBeat[]}
 */
export function defaultBeats() {
  return DEFAULT_BEATS.map((beat) => ({ id: beat.id, label: beat.label, points: [], source: 'default' }));
}

/** Index of the "]" that closes the "[" at `start`, or -1. Brackets inside a JSON string do not count. */
function closingBracket(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** @returns {RawBeat[] | null} the entries of `value` that are beats, or null when there are none */
function readBeatList(value) {
  if (!Array.isArray(value)) return null;
  const beats = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string' || !entry.label.trim()) continue;
    const points = Array.isArray(entry.points) ? entry.points.filter((point) => typeof point === 'string') : [];
    beats.push({ label: entry.label, points });
  }
  return beats.length > 0 ? beats : null;
}

/**
 * Read a JSON array of `{ label, points }` out of a model's text, also when the
 * model wraps it in a code fence or writes a line before it. Only the label and
 * the points are kept. Nothing is cut here: limitBeats does that.
 * @param {string} text
 * @returns {RawBeat[] | null} null when no such array is found
 */
export function parseBeats(text) {
  if (typeof text !== 'string') return null;
  let tried = 0;
  for (let start = text.indexOf('['); start !== -1 && tried < MAX_ARRAY_STARTS; start = text.indexOf('[', start + 1)) {
    tried += 1;
    const end = closingBracket(text, start);
    if (end === -1) continue;
    let value;
    try {
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      continue;
    }
    const beats = readBeatList(value);
    if (beats) return beats;
  }
  return null;
}

/**
 * Cut beats to the limits of D-41 and keep the count between 3 and 6 (D-42).
 *
 * Cutting is by whole words from the front. A beat whose label is empty after
 * cutting is dropped. More than six beats: the first six stay. Fewer than
 * three: default beats not already there by label are added (Takeaway first,
 * then Hook, Story, Point); an added Hook opens the list, the others close it.
 * `shortened` is true when something was over a limit and was cut; adding a
 * beat or taking off end punctuation is not shortening.
 * @param {RawBeat[]} raw
 * @returns {{ beats: StoryBeat[], shortened: boolean }}
 */
export function limitBeats(raw) {
  let shortened = false;
  /** @type {{ label: string, points: string[], source: 'default' | 'model' }[]} */
  const kept = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string') continue;
    const label = cutWords(entry.label, BEAT_LIMITS.labelWords);
    if (!label.text) continue;
    if (kept.length === BEAT_LIMITS.maxBeats) {
      shortened = true;
      break;
    }
    if (label.cut) shortened = true;
    const points = [];
    for (const point of Array.isArray(entry.points) ? entry.points : []) {
      if (typeof point !== 'string') continue;
      const trigger = cutWords(point, BEAT_LIMITS.pointWords);
      if (!trigger.text) continue;
      if (points.length === BEAT_LIMITS.pointsPerBeat) {
        shortened = true;
        break;
      }
      if (trigger.cut) shortened = true;
      points.push(trigger.text);
    }
    kept.push({ label: label.text, points, source: 'model' });
  }

  const present = new Set(kept.map((beat) => beat.label.toLowerCase()));
  const added = [];
  for (const label of PAD_ORDER) {
    if (kept.length + added.length >= BEAT_LIMITS.minBeats) break;
    if (!present.has(label.toLowerCase())) added.push(label);
  }
  const asDefault = (label) => ({ label, points: [], source: /** @type {'default'} */ ('default') });
  const opening = added.filter((label) => label === OPENING_LABEL).map(asDefault);
  const closing = DEFAULT_BEATS
    .map((beat) => beat.label)
    .filter((label) => label !== OPENING_LABEL && added.includes(label))
    .map(asDefault);

  const beats = [...opening, ...kept, ...closing].map((beat, i) => ({
    id: `s${i + 1}`,
    label: beat.label,
    points: beat.points,
    source: beat.source,
  }));
  return { beats, shortened };
}

/**
 * The beats for one of the three starts.
 *
 * 'talk' gives the default beats and never calls `ask` (D-40). 'idea' and
 * 'paste' hand the person's text (cut to 4,000 characters) to `ask` and cut
 * the answer to the limits (D-41, D-42). Anything that is not beats — no text,
 * no `ask`, a rejected `ask`, `{ source: 'none' }`, text that is not the
 * expected JSON — gives the default beats. Never rejects.
 * @param {{ start: 'talk' | 'idea' | 'paste', text?: string, ask?: Ask }} input
 * @returns {Promise<WrittenBeats>}
 */
export async function writeBeats(input) {
  const { start, text, ask } = input || {};
  const fallback = () => ({ beats: defaultBeats(), source: 'default', shortened: false });
  if (start !== 'idea' && start !== 'paste') return fallback();
  if (typeof text !== 'string' || typeof ask !== 'function') return fallback();
  const idea = text.trim().slice(0, BEAT_LIMITS.textChars);
  if (!idea) return fallback();

  let answer;
  try {
    answer = await ask({ task: 'beats', text: idea });
  } catch {
    return fallback();
  }
  if (!answer || typeof answer !== 'object' || typeof answer.text !== 'string') return fallback();
  if (typeof answer.source !== 'string' || !answer.source || answer.source === 'none') return fallback();

  const raw = parseBeats(answer.text);
  if (!raw) return fallback();
  const { beats, shortened } = limitBeats(raw);
  if (!beats.some((beat) => beat.source === 'model')) return fallback();
  return { beats, source: answer.source, shortened };
}

/**
 * The talking points createEpisode takes: one per story beat, the label as its title.
 * @param {StoryBeat[]} beats
 * @returns {{ id: string, title: string }[]}
 */
export function beatsToPoints(beats) {
  return (Array.isArray(beats) ? beats : []).map((beat) => ({ id: beat.id, title: beat.label }));
}
