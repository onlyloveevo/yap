// Instant local swap (LIVE-04, D-10, D-11): a remark moves the talking points
// to the prepared angle it asks for, locally and deterministically, with no
// network call and no model.
//
// YAP acts only on a remark it understands in full. Any word it does not
// know, or any word order it does not know, means no swap and no note: a
// missed swap is seen on the spot and said again, while a wrong note would
// reach Return and memory.
//
// The words YAP knows:
//   - its own words, the closed lists below (VOCABULARY, sixteen lists):
//     asking words, rejecting words, pointing words, fillers and padding,
//     three lists for ordinary speech: leadFirst (a word that is a filler
//     only as the first token of a clause: "right so the story"), liking (the
//     asking words that are about liking) and barePointer (this, that, it),
//     and away (the requests for change that name nothing);
//   - a negation, known by its shape and not by a list of phrases: no, not,
//     never and the like, any word ending in n't, "cannot", and an auxiliary
//     followed by nt (dont, isnt, cant, wont);
//   - the one-word angle labels of the brief, each by itself or through a
//     regular plural (s; es after s, x, z, ch, sh or o; y to ies): "stories"
//     names story, "tip" names tips. Nothing is stripped from a word or a
//     label; the shorter form is extended and compared for equality;
//   - in a request that names no label ("let's talk about when it went
//     wrong"), the words of the brief's angles.
//
// A remark is read left to right as frames. A rejecting frame is a negative
// marker (a rejecting word or a negation) followed by one or more labels, or
// by a pointer at what is showing ("this angle", "that one", "these ones"),
// or by a bare pointer. An asking frame is a label with no negative marker,
// or asking words followed by words of the brief. Fillers and padding that
// run to the next break or the end say nothing, before a frame and after one
// ("um can we do the story", "the story I think").
//
// A bare pointer is "this", "that" or "it" with no angle word after it: "I
// hate this", "I don't like it", "not this". It points at what is showing
// only under a negative marker other than stop ("stop it" is about the
// take), only when every asking word in the frame is a liking word ("I can't
// do this" and "I don't get it" are not about the angle), and a bare "that"
// only when it ends its clause ("I hate that we do the story" does not point).
//
// A request for change that names nothing (REMARK-01, D-86) is a rejecting
// frame that points at what is showing: "I want a different angle", "give me
// another one", "something else please", "change the angle", "can we
// switch", "no, the other one". It is read only where the words fit no other
// frame, so "switch to the story" and "change it to the story" still ask for
// story. "different" and "other" count only before an angle word; "another"
// and "something else" also by themselves; "change" and "switch" by
// themselves or with what is showing as their object ("the angle", "this
// one", "it"). A "no" before it says nothing ("no, the other one"); with no
// break after that "no", only a pointing word, "another" or a phrase may
// follow, so "no change" and "no other angle" are not understood. Any other
// negative marker on it keeps what is showing and is not understood ("I
// don't want a different angle"). "skip this point" and "next point please"
// are about the point: "point" and "next" are not words YAP knows.
//
// "this isn't working" (also "this angle", "this one", and "isnt") judges
// what is showing and asks for nothing: it neither asks nor rejects, and by
// itself it changes nothing. It is read once, before any frame, so the
// request after it counts: "this isn't working, go to the story" asks for
// story. With no break after it, the request must open the way a request
// after a rejection does ("this isn't working go to the story"); a bare
// label straight after it is not understood. A label is never its subject:
// "the story angle isn't working" stays a statement YAP does not act on.
//
// When a remark makes no swap, explainNoSwap gives the reason (REMARK-02):
// 'nothing-prepared' when YAP read the remark and the brief holds nothing to
// change to, 'not-understood' when a word or the word order is not known.
//
// What holds inside a remark that is understood:
//   - an angle whose label follows a negative marker in the same frame is
//     never offered;
//   - a bare label together with a pointing rejection ("the story, not that
//     one", "not that one, the story") is not understood, because nothing
//     says which angle "that one" is;
//   - a request may follow a rejection in one breath, with no comma, when
//     "but", a lead word or an asking phrase opens it ("not tips but story",
//     "I don't like the tips angle can we do the story"); a bare label
//     straight after a rejection ("not tips story") is not understood;
//   - a remark asks for one angle at most;
//   - with nothing asked for, YAP moves off the showing angle only when the
//     remark rejects it by name or points at it, and then to the first
//     remaining angle in brief order.
//
// The candidates are the non-active angles of the current point and of every
// point ahead of it whose label the remark does not reject. Each is scored:
//   +1 per word of the angle's label, text and keywords that the remark asks
//      for (compared after stem)
//   +2 when the remark asks for the angle's label
// Nothing is subtracted, so no score is below 0. Ties go to brief order.
// YAP's own words carry no content (D-86): what, my, this, that, one, me, it
// and the like are never words of the brief, whatever an angle's text holds,
// so they never score.

import { contentWords, normalizeToken, stem } from './text.js';

/** Every user-facing string this module emits. */
export const COPY = Object.freeze({
  note: 'Noted: {prefer} over {over}',
  preparedReplyLabel: "YAP's reply (on screen, prepared)",
});

// ---------------------------------------------------------------------------
// The words YAP knows. Every list is closed: a word in none of them, that is
// not a negation by shape, not a label of the brief and (in a request that
// names no label) not a word of the brief, makes the remark not understood.
// A phrase is written as one string with single spaces.
// ---------------------------------------------------------------------------

/** Fillers, hedges and openers that say nothing by themselves. An entry may be a phrase. */
const LEAD = [
  'okay', 'ok', 'so', 'um', 'uh', 'yeah', 'yes', 'well', 'and', 'then', 'now', 'please', 'yap', 'hey', 'maybe',
  "let's", 'lets', 'let', 'us', 'me', 'can', 'could', 'would', 'should', 'i', 'we', 'you',
  "i'd", "i'm", "i'll", "we'd", "we'll", 'actually', 'just', 'instead',
  'think', 'guess', 'hmm', 'oh', 'ah', 'alright', 'erm', 'er', 'shall',
  'you know what', 'you know', 'kind of', 'sort of',
];
/** A lead word only as the first token of a clause: "right so the story" asks, "yeah right the story" does not. */
const LEAD_FIRST = ['right'];
/** Asking words and phrases. */
const ASK = [
  'switch back to', 'go back to', 'back to', 'go with', 'give me', 'switch to', 'talk about', 'how about', 'what about',
  'do', 'try', 'use', 'have', 'want', 'wanted', 'wanna', 'prefer', 'like', 'love', 'need', 'more', 'rather', 'to',
  'change it to', 'switch it to', 'move on to', 'go to', 'change to', 'move to', 'jump to', 'show me',
  'put up', 'pull up', 'bring up', 'bring back', 'show', 'get', 'see', 'put', 'feel', 'feeling',
  'tell', 'open with',
];
/** One of these may stand before a label, or point at what is showing. */
const POINTING = ['the', 'a', 'an', 'that', 'this', 'some', 'these', 'those'];
/** One of these may stand after a label ("the story angle"). */
const ANGLE = ['angle', 'angles', 'one', 'ones', 'version'];
/** Joins the labels of one rejection ("tips or story"). */
const JOIN = ['or', 'and'];
/** Padding after a frame. An entry may be a phrase. */
const CLOSING = [
  'please', 'instead', 'now', 'then', 'thanks', 'okay', 'ok', 'yeah', 'back',
  'here', 'up', 'for this one', 'for this', 'for now', 'this time',
];
/** Padding after a rejecting frame only. */
const REJECT_CLOSING = ['anymore', 'either'];
/** Rejecting words and phrases. */
const REJECT = [
  'get rid of', 'anything but', 'instead of', 'rather than', 'tired of', 'sick of', 'enough of', 'less of',
  'stop', 'skip', 'drop', 'lose', 'ditch', 'hate', 'dislike', 'less', 'enough',
];
/** Words that negate on their own. */
const NEGATIVE = ['no', 'not', 'never', 'without', 'nor', 'neither', 'none', 'nothing', 'nobody', 'nowhere'];
/** What stands before "nt" in a verb negation written without its apostrophe (dont, isnt, cant, wont). */
const AUXILIARY = [
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'ca', 'could', 'wo', 'would', 'should', 'must', 'might', 'need', 'ai', 'sha',
];
/** Small words a request that names no label may hold between the words of the brief. */
const LINK = [
  'when', 'where', 'it', 'my', 'of', 'in', 'on', 'at', 'for', 'about', 'with', 'me',
  'how', 'what', 'go', 'give', 'switch', 'talk', 'back',
];
/**
 * Asking words about liking. A bare pointer ("I don't like it") counts only
 * when every asking phrase beside it is one of these: "I can't do this" and
 * "I don't get it" are not about the angle.
 */
const LIKING = ['like', 'love', 'want', 'wanna', 'prefer', 'need', 'feel', 'feeling'];
/** Words that, with no angle word after them, point at what is showing ("I hate this", "I don't like it"). */
const BARE_POINTER = ['this', 'that', 'it'];
// A request for change that names nothing (REMARK-01, D-86) is a rejection of
// what is showing. Four kinds of wording, one list:
/** Asks for change by itself or before an angle word: "another", "another one". */
const AWAY_BARE = ['another'];
/** Asks for change only before an angle word: "a different one", "the other angle". */
const AWAY_BEFORE_ANGLE = ['different', 'other'];
/** Asks for change as a whole phrase: "something else". */
const AWAY_PHRASE = ['something else', 'something different'];
/** A verb that asks for change, by itself or with what is showing as its object: "change the angle", "switch it". */
const AWAY_VERB = ['change', 'switch'];
const AWAY = [...AWAY_BARE, ...AWAY_BEFORE_ANGLE, ...AWAY_PHRASE, ...AWAY_VERB];
/**
 * Words the rule names one by one. "working" is known in one clause shape
 * only, "this isn't working" before a request (see statementAt); it is no
 * asking word, no rejecting word and no padding.
 */
const OTHER = ['but', 'really', 'cannot', 'working'];

/** Every word list of the rule, read-only: for tests and for the brief check. */
export const VOCABULARY = Object.freeze({
  lead: Object.freeze([...LEAD]),
  leadFirst: Object.freeze([...LEAD_FIRST]),
  ask: Object.freeze([...ASK]),
  pointing: Object.freeze([...POINTING]),
  angle: Object.freeze([...ANGLE]),
  join: Object.freeze([...JOIN]),
  closing: Object.freeze([...CLOSING]),
  rejectClosing: Object.freeze([...REJECT_CLOSING]),
  reject: Object.freeze([...REJECT]),
  negative: Object.freeze([...NEGATIVE]),
  auxiliary: Object.freeze([...AUXILIARY]),
  link: Object.freeze([...LINK]),
  liking: Object.freeze([...LIKING]),
  barePointer: Object.freeze([...BARE_POINTER]),
  away: Object.freeze([...AWAY]),
  other: Object.freeze([...OTHER]),
});

/** The entries of a list word by word, longest first. */
const phrasesOf = (list) => list.map((entry) => entry.split(' ')).sort((a, b) => b.length - a.length);
/** The one-word entries of a list. */
const singleWordsOf = (list) => new Set(list.filter((entry) => !entry.includes(' ')));
/** The entries of a list that are phrases, word by word, longest first. */
const longPhrasesOf = (list) => phrasesOf(list.filter((entry) => entry.includes(' ')));
/** Every word of every entry of the lists. */
const wordsOf = (...lists) => new Set(lists.flatMap((list) => list.flatMap((entry) => entry.split(' '))));

const LEAD_WORDS = singleWordsOf(LEAD);
const LEAD_PHRASES = longPhrasesOf(LEAD);
const LEAD_FIRST_WORDS = new Set(LEAD_FIRST);
const ASK_PHRASES = phrasesOf(ASK);
const POINTING_WORDS = new Set(POINTING);
const ANGLE_WORDS = new Set(ANGLE);
const JOIN_WORDS = new Set(JOIN);
const CLOSING_WORDS = singleWordsOf(CLOSING);
const CLOSING_PHRASES = longPhrasesOf(CLOSING);
const REJECT_CLOSING_WORDS = new Set(REJECT_CLOSING);
const REJECT_PHRASES = phrasesOf(REJECT);
const NEGATIVE_WORDS = new Set(NEGATIVE);
const AUXILIARY_WORDS = new Set(AUXILIARY);
const LIKING_WORDS = new Set(LIKING);
const BARE_POINTER_WORDS = new Set(BARE_POINTER);
const AWAY_BARE_WORDS = new Set(AWAY_BARE);
const AWAY_BEFORE_ANGLE_WORDS = new Set(AWAY_BEFORE_ANGLE);
const AWAY_PHRASES = phrasesOf(AWAY_PHRASE);
const AWAY_VERB_WORDS = new Set(AWAY_VERB);
/** Words a request that names no label passes over. */
const HARMLESS_WORDS = wordsOf(LEAD, LEAD_FIRST, ASK, POINTING, ANGLE, CLOSING, LINK, ['or']);
/**
 * YAP's own words: every word of every list except the auxiliaries. They
 * carry no content: one of them is never an angle label and never a word of
 * the brief, whatever an angle's text holds (D-86).
 */
const OWN_WORDS = wordsOf(
  LEAD, LEAD_FIRST, ASK, POINTING, ANGLE, JOIN, CLOSING, REJECT_CLOSING, REJECT, NEGATIVE, LINK, LIKING, BARE_POINTER, AWAY, OTHER,
);
/** "should we really ...": a question with really in it is doubt, not a request. */
const QUESTION_OPENERS = new Set(['can', 'could', 'would', 'should', 'shall']);
const QUESTION_SUBJECTS = new Set(['i', 'we', 'you']);
/** "this angle", "that one", "these ones": the pointing words and angle words that point at what is showing. */
const SHOWING_POINTERS = new Set(['this', 'that', 'these', 'those']);
const SHOWING_NOUNS = new Set(['angle', 'angles', 'one', 'ones']);

/**
 * Whether a normalised token is a verb negation, known by its shape: it ends
 * in n't, is "cannot", or is an auxiliary followed by nt.
 * @param {string} token
 * @returns {boolean}
 */
function isVerbNegation(token) {
  return token.endsWith("n't")
    || token === 'cannot'
    || (token.endsWith('nt') && AUXILIARY_WORDS.has(token.slice(0, -2)));
}

/**
 * Whether a normalised token negates, known by its shape: it is a negative
 * word, ends in n't, is "cannot", or is an auxiliary followed by nt.
 * @param {string} token
 * @returns {boolean}
 */
function negates(token) {
  return NEGATIVE_WORDS.has(token) || isVerbNegation(token);
}

/** Whether a normalised token is one of YAP's own words. */
const isOwnToken = (token) => OWN_WORDS.has(token) || negates(token);

/**
 * Whether a word is one YAP listens for itself: a word of its lists, or a
 * negation known by shape. Such a word is never an angle label and never a
 * word of the brief.
 * @param {string} word
 * @returns {boolean}
 */
export function isOwnWord(word) {
  return isOwnToken(normalizeToken(word));
}

/**
 * @typedef {object} Match
 * @property {string} label              the winning angle label
 * @property {string} angleId            the winning angle
 * @property {string} fromLabel          the current point's previously active label
 * @property {string} [requestedOver]    one explicitly rejected prepared label, from the validated reading
 * @property {number} currentPointIndex
 * @property {number} score
 */

/**
 * @typedef {object} Swap
 * @property {string|null} exchangeId
 * @property {number|null} at           take clock seconds (set by the live take)
 * @property {number|null} latencySec   (set by the live take)
 * @property {number|null} computeMs    (set by the live take)
 * @property {{label: string}} from
 * @property {{label: string}} to
 * @property {string} [requestedOver]    the stated comparison when it differs from the actual source
 * @property {{pointId: string, fromAngleId: string, toAngleId: string}[]} changed
 * @property {string} note              the note line, "Noted: story over tips"
 * @property {{text: string, source: 'prepared'|'realtime'}} reply
 */

/**
 * @typedef {object} Marker  a negative marker at a position
 * @property {number} length    how many tokens it takes
 * @property {string} word      the marker as spoken
 * @property {boolean} negation true for a negation by shape, false for a rejecting word
 * @property {boolean} verb     true for a verb negation (don't, isnt, cannot)
 */

/**
 * @typedef {object} Frame
 * @property {'reject'|'ask-label'|'ask-words'} kind
 * @property {number} end                 the index of the first token after the frame
 * @property {string[]} labels            the labels named, as spoken
 * @property {string[]} words             the words of the brief asked for (ask-words only)
 * @property {boolean} pointsAtShowing    a reject frame that points at the showing angle
 * @property {number} leads               how many lead words opened the frame
 * @property {number} asks                how many asking phrases the frame holds
 * @property {boolean} contrast           the frame opened with "but", straight after a rejection
 */

/**
 * @typedef {object} Reading
 * @property {boolean} understood        false when a word or the word order is not known; every list is then empty
 * @property {string[]} want             stems of the labels and brief words asked for (for scoring)
 * @property {string[]} reject           stems of rejectWords
 * @property {string[]} wantWords        the labels asked for, as spoken (normalised, not stemmed)
 * @property {string[]} rejectWords      the labels rejected, as spoken (normalised, not stemmed)
 * @property {boolean} hasReject         the remark holds a rejecting frame
 * @property {boolean} pointsAtShowing   a rejecting frame points at the showing angle
 */

/**
 * @param {string} prefer
 * @param {string} over
 * @returns {string}
 */
export function noteText(prefer, over) {
  return COPY.note.replace('{prefer}', prefer).replace('{over}', over);
}

/**
 * The tokens of a remark in order, normalised, with null wherever a
 * clause-ending mark (, ; : . ! ?) sat.
 * @param {string} remark
 * @returns {(string|null)[]}
 */
function tokensOf(remark) {
  /** @type {(string|null)[]} */
  const tokens = [];
  for (const raw of String(remark ?? '').split(/\s+/)) {
    if (!raw) continue;
    const parts = raw.split(/[,;:.!?]+/);
    parts.forEach((part, i) => {
      const t = normalizeToken(part);
      if (t) tokens.push(t);
      if (i < parts.length - 1) tokens.push(null);
    });
  }
  return tokens;
}

// The prepared angle's UI name is "Practical tips" while its stored label is
// "tips". Resolve that exact adjacent phrase only when tips is prepared and
// practical is not itself a competing label. Keep punctuation and negation in
// place; this is not permission to ignore arbitrary descriptive words.
function tokensForBrief(remark, kindOf) {
  const tokens = tokensOf(remark);
  return tokens.filter((token, i) => !(token === 'practical'
    && kindOf(token) !== 'label'
    && ['tip', 'tips'].includes(tokens[i + 1])
    && kindOf(tokens[i + 1]) === 'label'));
}

/** The phrase of a list that starts at tokens[j] (lists are longest first), if any. */
const phraseAt = (phrases, tokens, j) => phrases.find((phrase) => phrase.every((word, k) => tokens[j + k] === word));

/**
 * The negative marker that starts at tokens[j], or null: a rejecting phrase
 * (longest first), else a negating token. It is looked for before anything
 * else at a position, so "instead of" is a marker although "instead" alone
 * is a lead and closing word.
 * @param {(string|null)[]} tokens
 * @param {number} j
 * @returns {Marker|null}
 */
function markerAt(tokens, j) {
  const token = tokens[j];
  if (token == null) return null;
  const phrase = phraseAt(REJECT_PHRASES, tokens, j);
  if (phrase) return { length: phrase.length, word: phrase.join(' '), negation: false, verb: false };
  if (negates(token)) return { length: 1, word: token, negation: true, verb: isVerbNegation(token) };
  return null;
}

/**
 * How many tokens of lead-in start at tokens[j], 0 when none: a lead phrase
 * (longest first), else a lead word. Never where a marker starts.
 * @param {(string|null)[]} tokens
 * @param {number} j
 * @returns {number}
 */
function leadAt(tokens, j) {
  if (tokens[j] == null || markerAt(tokens, j)) return 0;
  const phrase = phraseAt(LEAD_PHRASES, tokens, j);
  if (phrase) return phrase.length;
  if (LEAD_WORDS.has(tokens[j])) return 1;
  // "right so the story": a lead word only as the first token of a clause.
  if (LEAD_FIRST_WORDS.has(tokens[j]) && (j === 0 || tokens[j - 1] === null)) return 1;
  return 0;
}

/**
 * How many tokens of closing padding start at tokens[j], 0 when none: a
 * closing phrase (longest first), else a closing word. Never where a marker
 * starts.
 * @param {(string|null)[]} tokens
 * @param {number} j
 * @param {boolean} underMarker  the frame has a negative marker, so "anymore" and "either" count too
 * @returns {number}
 */
function closingAt(tokens, j, underMarker) {
  if (tokens[j] == null || markerAt(tokens, j)) return 0;
  const phrase = phraseAt(CLOSING_PHRASES, tokens, j);
  if (phrase) return phrase.length;
  if (CLOSING_WORDS.has(tokens[j]) || (underMarker && REJECT_CLOSING_WORDS.has(tokens[j]))) return 1;
  return 0;
}

/** How many tokens of padding (a lead or closing entry) start at tokens[j], 0 when none. */
const paddingAt = (tokens, j) => leadAt(tokens, j) || closingAt(tokens, j, false);

/**
 * Read one frame from tokens[start]. Returns null when the words there fit
 * no frame. In order: "but" (only straight after a rejection); lead entries;
 * asking phrases with at most one negative marker among them; one pointing
 * word; then the label(s), a pointer at what is showing ("this angle"), a
 * bare pointer ("this", "it"), or (when asking, with no marker) words of the
 * brief.
 * @param {(string|null)[]} tokens
 * @param {number} start
 * @param {'reject'|'ask-label'|'ask-words'|null} prev  the frame just read, or null at the start and after a break
 * @param {(token: string) => 'label'|'word'|null} kindOf
 * @returns {Frame|null}
 */
function readFrame(tokens, start, prev, kindOf) {
  let j = start;
  // "but" straight after a rejection opens what follows ("not tips but
  // story"); anywhere else it is not understood.
  let contrast = false;
  if (tokens[j] === 'but') {
    if (prev !== 'reject') return null;
    contrast = true;
    j += 1;
  }

  // Lead entries, a phrase counting as one.
  let leads = 0;
  for (let n = leadAt(tokens, j); n > 0; n = leadAt(tokens, j)) {
    j += n;
    leads += 1;
  }

  // The asking part: asking phrases, with at most one negative marker among them.
  /** @type {(Marker & {first: boolean})|null} */
  let marker = null;
  let asks = 0;
  let onlyLiking = true; // no asking phrase outside the liking list was taken
  for (;;) {
    const found = markerAt(tokens, j);
    if (found) {
      if (marker) return null; // two negatives: "don't drop the tips"
      if (found.word === 'nor' && prev !== 'reject') return null; // "story nor tips": nor only carries a rejection on
      marker = { ...found, first: j === start };
      j += found.length;
      continue;
    }
    if (tokens[j] === 'really' && (markerAt(tokens, j + 1) || phraseAt(ASK_PHRASES, tokens, j + 1))) {
      // "should we really do the story" is doubt; "I really want the story" asks.
      if (j - 2 >= start && QUESTION_OPENERS.has(tokens[j - 2]) && QUESTION_SUBJECTS.has(tokens[j - 1])) return null;
      j += 1;
      continue;
    }
    const ask = phraseAt(ASK_PHRASES, tokens, j);
    if (ask) {
      if (marker && !marker.negation) return null; // "skip to the story"
      if (marker && marker.word === 'no' && ask.join(' ') !== 'more') return null; // "no need for the story"
      if (!LIKING_WORDS.has(ask.join(' '))) onlyLiking = false;
      j += ask.length;
      asks += 1;
      continue;
    }
    break;
  }

  /** @type {string|null} */
  let pointing = null;
  if (POINTING_WORDS.has(tokens[j])) {
    if (marker && marker.word === 'no') return null; // "no the tips" is "no, the tips"
    pointing = tokens[j];
    j += 1;
  }

  const afterAsk = prev === 'ask-label' || prev === 'ask-words';
  // "the story angle isn't ...": the label before is the subject of a statement, not a request.
  const subjectOfStatement = marker !== null && afterAsk && marker.verb && marker.first;
  const passClosing = () => {
    for (let n = closingAt(tokens, j, marker !== null); n > 0; n = closingAt(tokens, j, marker !== null)) j += n;
  };
  const frame = (kind, fields) => ({ kind, end: j, labels: [], words: [], pointsAtShowing: false, leads, asks, contrast, ...fields });

  // Labels.
  if (tokens[j] != null && kindOf(tokens[j]) === 'label') {
    const labels = [];
    for (;;) {
      labels.push(tokens[j]);
      j += 1;
      if (ANGLE_WORDS.has(tokens[j])) j += 1;
      // Only a rejection carries a list on: "I don't like tips or story".
      if (!marker || !JOIN_WORDS.has(tokens[j])) break;
      let k = j + 1;
      if (POINTING_WORDS.has(tokens[k])) k += 1;
      if (tokens[k] == null || kindOf(tokens[k]) !== 'label') break;
      j = k;
    }
    passClosing();
    if (marker) return subjectOfStatement ? null : frame('reject', { labels });
    if (afterAsk) return null; // a remark asks once
    // A request by label follows a rejection inside one clause only when
    // something opens it: "but", a lead word or an asking phrase. A bare label
    // straight after a rejection ("not tips story") is not understood.
    if (prev === 'reject' && !contrast && leads === 0 && asks === 0) return null;
    return frame('ask-label', { labels });
  }

  // Pointing at what is showing: "this angle", "that one", "these ones".
  if (marker && SHOWING_POINTERS.has(pointing) && SHOWING_NOUNS.has(tokens[j])) {
    j += 1;
    passClosing();
    return subjectOfStatement ? null : frame('reject', { pointsAtShowing: true });
  }

  // A bare pointer at what is showing: "I hate this", "I don't like it",
  // "not this". Only under a marker other than stop ("stop it" is about the
  // take), and only when every asking phrase in the frame is a liking word
  // ("I can't do this" and "I don't get it" are not about the angle).
  if (marker && marker.word !== 'stop' && onlyLiking) {
    // "this" or "that" with no angle word after it (a label was read above), or "it" with no pointing word.
    const bareThisOrThat = pointing !== null && BARE_POINTER_WORDS.has(pointing) && !ANGLE_WORDS.has(tokens[j]);
    const bareIt = pointing === null && tokens[j] != null && BARE_POINTER_WORDS.has(tokens[j]);
    if (bareThisOrThat || bareIt) {
      if (bareIt) j += 1;
      passClosing();
      // "I hate that we do the story": there "that" opens a clause, it does
      // not point. A bare "that" must end its clause.
      if (pointing === 'that' && tokens[j] != null) return null;
      return subjectOfStatement ? null : frame('reject', { pointsAtShowing: true });
    }
  }

  // A talk-about request: asking words, then words of the brief.
  if (!marker && asks > 0) {
    if (afterAsk) return null;
    const words = [];
    while (tokens[j] != null && !markerAt(tokens, j)) {
      const token = tokens[j];
      if (!HARMLESS_WORDS.has(token)) {
        if (kindOf(token) !== 'word') return null; // a label, or a word YAP does not know
        words.push(token);
      }
      j += 1;
    }
    if (words.length === 0) return null;
    return frame('ask-words', { words });
  }

  return null;
}

/**
 * Read a request for change that names nothing (REMARK-01, D-86) from
 * tokens[start]: "I want a different angle", "give me another one",
 * "something else please", "change the angle", "no, the other one". It is a
 * rejecting frame that points at the showing angle. Returns null when the
 * words there are not one. In order: "but" (only straight after a
 * rejection); lead entries; a "no" that says nothing; asking phrases; the
 * wording itself; closing padding.
 *
 * No other negative marker may stand in it: "I don't want a different angle"
 * and "never change the angle" keep what is showing, and are not understood.
 * @param {(string|null)[]} tokens
 * @param {number} start
 * @param {'reject'|'ask-label'|'ask-words'|null} prev  the frame just read, or null at the start and after a break
 * @returns {Frame|null}
 */
function readAway(tokens, start, prev) {
  let j = start;
  let contrast = false;
  if (tokens[j] === 'but') {
    if (prev !== 'reject') return null;
    contrast = true;
    j += 1;
  }

  let leads = 0;
  const passLeads = () => {
    for (let n = leadAt(tokens, j); n > 0; n = leadAt(tokens, j)) {
      j += n;
      leads += 1;
    }
  };
  passLeads();

  // "no, the other one": a "no" before the request says nothing. With no
  // break after it, only a pointing word, "another" or a phrase may follow:
  // "no the other one" asks for change; "no change", "no other angle" and
  // "no need to change" keep what is showing.
  let noJoined = false;
  if (tokens[j] === 'no') {
    if (tokens[j + 1] === null) {
      j += 2;
      passLeads();
    } else {
      noJoined = true;
      j += 1;
    }
  }

  // The asking part, as in an asking frame, with no negative marker in it.
  let asks = 0;
  while (!noJoined) {
    if (tokens[j] === 'really') {
      // "should we really change the angle" is doubt; "I really want a different angle" asks.
      if (j - 2 >= start && QUESTION_OPENERS.has(tokens[j - 2]) && QUESTION_SUBJECTS.has(tokens[j - 1])) return null;
      j += 1;
      continue;
    }
    const ask = phraseAt(ASK_PHRASES, tokens, j);
    if (!ask) break;
    j += ask.length;
    asks += 1;
  }

  const phrase = phraseAt(AWAY_PHRASES, tokens, j);
  if (phrase) {
    j += phrase.length; // "something else"
  } else if (AWAY_VERB_WORDS.has(tokens[j])) {
    if (noJoined) return null; // "no change"
    j += 1;
    // Its object, when said, is what is showing: "the angle", "this one", "it", "this".
    if ((tokens[j] === 'the' || SHOWING_POINTERS.has(tokens[j])) && ANGLE_WORDS.has(tokens[j + 1])) j += 2;
    else if ((tokens[j] === 'it' || tokens[j] === 'this') && closingAt(tokens, j, false) < 2) j += 1; // not "this time"
  } else {
    const pointed = POINTING_WORDS.has(tokens[j]);
    if (pointed) j += 1;
    if (AWAY_BARE_WORDS.has(tokens[j])) {
      j += 1; // "another", "another one"
      if (ANGLE_WORDS.has(tokens[j])) j += 1;
    } else if (AWAY_BEFORE_ANGLE_WORDS.has(tokens[j]) && ANGLE_WORDS.has(tokens[j + 1]) && (pointed || !noJoined)) {
      j += 2; // "a different one", "the other angle"
    } else {
      return null;
    }
  }

  for (let n = closingAt(tokens, j, false); n > 0; n = closingAt(tokens, j, false)) j += n;
  return { kind: 'reject', end: j, labels: [], words: [], pointsAtShowing: true, leads, asks, contrast };
}

/**
 * How many tokens "this isn't working" takes at tokens[start], 0 when the
 * words there are not that statement (REMARK-01, D-85). Its shape: lead
 * entries; "this", "this angle" or "this one"; "isn't" or "isnt"; "working";
 * closing padding. It judges what is showing and asks for nothing
 * (QUESTIONS.md Q33), so it neither asks nor rejects: by itself it changes
 * nothing. A label is never its subject: "the story angle isn't working"
 * and "this story isn't working" are not this statement and are not
 * understood.
 * @param {(string|null)[]} tokens
 * @param {number} start
 * @returns {number}
 */
function statementAt(tokens, start) {
  let j = start;
  for (let n = leadAt(tokens, j); n > 0; n = leadAt(tokens, j)) j += n;
  if (tokens[j] !== 'this') return 0;
  j += 1;
  if (SHOWING_NOUNS.has(tokens[j])) j += 1;
  if (tokens[j] !== "isn't" && tokens[j] !== 'isnt') return 0;
  if (tokens[j + 1] !== 'working') return 0;
  j += 2;
  for (let n = closingAt(tokens, j, true); n > 0; n = closingAt(tokens, j, true)) j += n;
  return j - start;
}

/**
 * A false start may introduce an explicit imperative: "this is, go to the
 * story". Consume only the incomplete demonstrative/copula, never a no-word,
 * subject, label, or arbitrary unknown token. The full request after it still
 * has to pass the ordinary all-words/all-order reader. This is one initial
 * restart only; it does not make "this is the story" a request.
 */
function falseStartAt(tokens, start) {
  let j = start;
  for (let n = leadAt(tokens, j); n > 0; n = leadAt(tokens, j)) j += n;
  if (tokens[j] !== 'this' || tokens[j + 1] !== 'is') return 0;
  j += 2;
  while (tokens[j] === null) j += 1;
  const imperative = phraseAt(ASK_PHRASES, tokens, j);
  // Intentionally exclude wanting, liking, modal questions and bare labels.
  const verbs = new Set(['go', 'switch', 'change', 'move', 'jump', 'show', 'give', 'try', 'use', 'open', 'tell', 'put', 'pull', 'bring']);
  return imperative && verbs.has(imperative[0]) ? j - start : 0;
}

/**
 * Read a remark: what it asks for, what it rejects, and whether YAP
 * understood it in full. A remark with an unknown word, or with words that
 * fit no frame, is not understood, and every list comes back empty.
 * @param {string} remark
 * @param {(token: string) => 'label'|'word'|null} [kindOf] what a token that is not one of YAP's own words is:
 *   an angle label, a word of the brief, or neither. Left out, every such token counts as a label.
 * @returns {Reading}
 */
export function splitClauses(remark, kindOf = () => 'label') {
  return readTokens(tokensOf(remark), kindOf);
}

/**
 * Read the tokens of a remark (see splitClauses).
 * @param {(string|null)[]} tokens
 * @param {(token: string) => 'label'|'word'|null} kindOf
 * @returns {Reading}
 */
function readTokens(tokens, kindOf) {
  // One of YAP's own words is never a label and never a word of the brief.
  const kind = (token) => (isOwnToken(token) ? null : kindOf(token));
  /** @type {Frame[]} */
  const frames = [];
  let understood = tokens.some((token) => token !== null);
  /** @type {'reject'|'ask-label'|'ask-words'|null} */
  let prev = null;
  let asked = false; // an asking frame has been read
  let pointed = false; // a reject frame that points at the showing angle has been read
  let stated = false; // "this isn't working" has been read
  let i = 0;
  while (understood && i < tokens.length) {
    if (tokens[i] === null) {
      prev = null;
      i += 1;
      continue;
    }
    // Padding that runs to the next break or the end says nothing, at the
    // start of a clause ("okay,", "yes please") and after a frame ("the
    // story I think", "do the story now please yap").
    let k = i;
    for (let n = paddingAt(tokens, k); n > 0; n = paddingAt(tokens, k)) k += n;
    if (tokens[k] == null) {
      i = k;
      continue;
    }
    // "this isn't working" says nothing, once, before any frame: the request
    // after it is read ("this isn't working, go to the story"). With no break
    // after it, what follows must open the way a request after a rejection
    // does: "this isn't working go to the story" asks, "this isn't working
    // story" is not understood.
    const said = frames.length === 0 && !stated ? (statementAt(tokens, i) || falseStartAt(tokens, i)) : 0;
    if (said > 0) {
      stated = true;
      prev = 'reject';
      i += said;
      continue;
    }
    // A frame as Phase 1 reads it, else a request for change that names nothing.
    const frame = readFrame(tokens, i, prev, kind) ?? readAway(tokens, i, prev);
    if (!frame) {
      understood = false;
    } else if (frame.kind === 'reject') {
      // "the story, not that one": nothing says which angle "that one" is.
      if (frame.pointsAtShowing && asked) understood = false;
      else if (frame.pointsAtShowing) pointed = true;
    } else if (asked) {
      understood = false; // a remark asks for one angle at most
    } else if (frame.kind === 'ask-label' && pointed && frame.asks === 0 && !frame.contrast) {
      // "not that one, the story"; "not this one, let's do the story" and
      // "not this one but story" are understood.
      understood = false;
    } else {
      asked = true;
    }
    if (!understood) break;
    frames.push(frame);
    prev = frame.kind;
    i = frame.end;
  }

  const read = understood ? frames : [];
  const asking = read.filter((frame) => frame.kind !== 'reject');
  const rejecting = read.filter((frame) => frame.kind === 'reject');
  const rejectWords = rejecting.flatMap((frame) => frame.labels);
  return {
    understood,
    want: asking.flatMap((frame) => [...frame.labels, ...frame.words]).map(stem),
    reject: rejectWords.map(stem),
    wantWords: asking.filter((frame) => frame.kind === 'ask-label').flatMap((frame) => frame.labels),
    rejectWords,
    hasReject: rejecting.length > 0,
    pointsAtShowing: rejecting.some((frame) => frame.pointsAtShowing),
  };
}

/** Word endings whose regular plural adds "es". */
const ES_ENDINGS = ['s', 'x', 'z', 'ch', 'sh', 'o'];

/**
 * The regular plurals of a word: the word plus "s"; plus "es" after s, x, z,
 * ch, sh or o; and "ies" in place of a final y. The word is never shortened
 * beyond that y.
 * @param {string} word
 * @returns {string[]}
 */
function regularPlurals(word) {
  const forms = [`${word}s`];
  if (ES_ENDINGS.some((ending) => word.endsWith(ending))) forms.push(`${word}es`);
  if (word.endsWith('y')) forms.push(`${word.slice(0, -1)}ies`);
  return forms;
}

/**
 * Whether a spoken word names a label (both normalised): they are equal, or
 * one is a regular plural of the other.
 * @param {string} word
 * @param {string} label
 * @returns {boolean}
 */
function namesLabel(word, label) {
  if (!word || !label) return false;
  return word === label || regularPlurals(label).includes(word) || regularPlurals(word).includes(label);
}

const activeAngle = (point) => point.angles.find((a) => a.id === point.active);

/**
 * The words of an angle a request may ask for: its label, text and keywords,
 * stemmed. One of YAP's own words is never among them (D-86): what, my, this,
 * that, one, me, it and the like carry no content, so they never score a
 * match, not even through a stem ("whats").
 */
function angleBag(angle) {
  const words = contentWords([angle.label, angle.text, ...(angle.keywords ?? [])].join(' '));
  return new Set(words.filter((word) => !isOwnToken(word)).map(stem));
}

/**
 * What a brief holds, for reading a remark: each angle's words, and what a
 * token that is not one of YAP's own words is by this brief (an angle label,
 * a word of the brief, or neither).
 * @param {{points?: object[]}} brief
 * @returns {{ bags: Map<object, Set<string>>, kindOf: (token: string) => 'label'|'word'|null }}
 */
function wordsOfBrief(brief) {
  const points = brief?.points ?? [];
  const bags = new Map(points.flatMap((point) => point.angles.map((angle) => [angle, angleBag(angle)])));
  const labels = [...new Set([...bags.keys()].map((angle) => normalizeToken(angle.label)))];
  const briefWords = new Set([...bags.values()].flatMap((bag) => [...bag]));
  const kindOf = (token) => {
    if (labels.some((label) => namesLabel(token, label))) return 'label';
    return briefWords.has(stem(token)) ? 'word' : null;
  };
  return { bags, kindOf };
}

/**
 * Pick the angle a remark asks for, among the non-active angles of the current
 * point and every point ahead of it that the remark does not reject by name.
 * Returns null when the remark is not understood in full or asks for no
 * change. Pure: it keeps no state between calls and never mutates the brief.
 * @param {string} remark
 * @param {{points: object[]}} brief
 * @param {{ currentPointIndex?: number }} [options]
 * @returns {Match|null}
 */
export function matchAngle(remark, brief, { currentPointIndex = 0 } = {}) {
  const current = brief?.points?.[currentPointIndex];
  if (!current) return null;

  const { bags, kindOf } = wordsOfBrief(brief);
  const read = readTokens(tokensForBrief(remark, kindOf), kindOf);
  if (!read.understood) return null;

  const names = (words, label) => {
    const normal = normalizeToken(label);
    return words.some((word) => namesLabel(word, normal));
  };
  const askedFor = (label) => names(read.wantWords, label);
  const rejected = (label) => names(read.rejectWords, label);
  if ([...bags.keys()].some((angle) => askedFor(angle.label) && rejected(angle.label))) return null;
  const asksForLabel = read.wantWords.length > 0;
  const wantSet = new Set(read.want);

  let best = null;
  for (const point of brief.points.slice(currentPointIndex)) {
    for (const angle of point.angles) {
      if (angle.id === point.active) continue;
      if (rejected(angle.label)) continue;
      let score = 0;
      for (const word of bags.get(angle)) if (wantSet.has(word)) score += 1;
      if (askedFor(angle.label)) score += 2;
      if (best === null || score > best.score) best = { angle, score };
    }
  }
  if (!best) return null;
  if (best.score > 0) {
    // A label was asked for and the best angle is another one: no swap.
    if (asksForLabel && !askedFor(best.angle.label)) return null;
  } else {
    // A label was asked for and no angle here or ahead carries it: no swap.
    if (asksForLabel) return null;
    // Nothing was asked for. Move only when the remark rejects what is
    // showing, by name or by pointing at it.
    const showing = activeAngle(current)?.label ?? '';
    if (!rejected(showing) && !read.pointsAtShowing) return null;
  }

  // The UI transition and the speaker's comparison are separate facts. Read
  // an explicit comparator only from the already validated negative frames,
  // resolving plurals against prepared labels; never infer it from raw text.
  const rejectedLabels = [...new Set([...bags.keys()].filter(angle => rejected(angle.label)).map(angle => angle.label))];
  return {
    label: best.angle.label,
    angleId: best.angle.id,
    fromLabel: activeAngle(current)?.label ?? '',
    ...(asksForLabel && rejectedLabels.length === 1 && rejectedLabels[0] !== activeAngle(current)?.label
      ? { requestedOver: rejectedLabels[0] } : {}),
    currentPointIndex,
    score: best.score,
  };
}

/** Why a remark made no swap (REMARK-02, D-82). */
const NOTHING_PREPARED = 'nothing-prepared';
const NOT_UNDERSTOOD = 'not-understood';
/** Stands for the thing asked for when the brief does not hold it. No spoken token is ever this: normalizeToken strips it. */
const UNPREPARED = '*';

/**
 * Why a remark makes no swap (REMARK-02, D-82), for the `heard` event of an
 * exchange that changes nothing. Returns null when the remark does make a
 * swap. It reads the same lists as matchAngle. Pure: it keeps no state and
 * never mutates the brief.
 *
 * 'nothing-prepared': YAP read the remark and this brief holds nothing to
 * change to. Either every word is known and no change follows ("I don't want
 * the story angle" while tips is showing, "this isn't working"), or the
 * remark is a request whose object is not in the brief: asking words, then
 * words that are neither a label nor words of the brief ("can I open with the
 * mistake instead?", "what about my intro?").
 *
 * 'not-understood': the remark holds a word YAP does not act on that is not
 * such an object ("make this punchier", "skip this point"), or an order of
 * words it does not know ("the story, not that one"), or no words at all.
 * @param {string} remark
 * @param {{points: object[]}} brief
 * @param {{ currentPointIndex?: number }} [options]
 * @returns {'nothing-prepared'|'not-understood'|null}
 */
export function explainNoSwap(remark, brief, { currentPointIndex = 0 } = {}) {
  if (matchAngle(remark, brief, { currentPointIndex })) return null;

  const { kindOf } = wordsOfBrief(brief);
  const tokens = tokensForBrief(remark, kindOf);
  if (readTokens(tokens, kindOf).understood) return NOTHING_PREPARED;

  // Put one stand-in where each run of words YAP does not know sits, and read
  // again with the stand-in as a word of the brief. Only an asking frame takes
  // a word of the brief, so the remark is understood exactly when every such
  // run is the thing a request asks for.
  const unknown = (token) => token !== null && !isOwnToken(token) && kindOf(token) === null;
  const withStandIn = [];
  for (const token of tokens) {
    if (!unknown(token)) withStandIn.push(token);
    else if (withStandIn[withStandIn.length - 1] !== UNPREPARED) withStandIn.push(UNPREPARED);
  }
  if (!withStandIn.includes(UNPREPARED)) return NOT_UNDERSTOOD;
  const read = readTokens(withStandIn, (token) => (token === UNPREPARED ? 'word' : kindOf(token)));
  return read.understood && read.want.includes(UNPREPARED) ? NOTHING_PREPARED : NOT_UNDERSTOOD;
}

/**
 * Apply a match: every candidate point (the current one and those ahead) that
 * has an angle with the winning label switches to it; others stay. Returns a
 * new brief and never mutates the input.
 * @param {{points: object[]}} brief
 * @param {Match} match
 * @param {{ exchangeId?: string|null }} [meta]
 * @returns {{ brief: object, swap: Swap }}
 */
export function applySwap(brief, match, { exchangeId = null } = {}) {
  const next = structuredClone(brief);
  const changed = [];
  next.points.forEach((point, i) => {
    if (i < match.currentPointIndex) return;
    const target = point.angles.find((a) => a.label === match.label);
    if (!target || target.id === point.active) return;
    changed.push({ pointId: point.id, fromAngleId: point.active, toAngleId: target.id });
    point.active = target.id;
  });

  // The label being replaced: the current point's, unless the current point
  // already showed the winning label (then the first point that changed).
  let fromLabel = match.fromLabel;
  if (fromLabel === match.label && changed.length > 0) {
    const firstFrom = brief.points.find((p) => p.id === changed[0].pointId).angles.find((a) => a.id === changed[0].fromAngleId);
    fromLabel = firstFrom.label;
  }

  // The reply shown is the prepared reply of the angle the current point now
  // shows, or of the winning angle when the current point has no such angle.
  const currentPoint = next.points[match.currentPointIndex];
  const replyAngle = currentPoint.angles.find((a) => a.label === match.label)
    ?? next.points.flatMap((p) => p.angles).find((a) => a.id === match.angleId);

  const swap = {
    exchangeId,
    at: null,
    latencySec: null,
    computeMs: null,
    from: { label: fromLabel },
    to: { label: match.label },
    changed,
    ...(match.requestedOver && match.requestedOver !== fromLabel ? { requestedOver: match.requestedOver } : {}),
    note: noteText(match.label, match.requestedOver ?? fromLabel),
    reply: { text: replyAngle ? replyAngle.reply : '', source: 'prepared' },
  };
  return { brief: next, swap };
}
