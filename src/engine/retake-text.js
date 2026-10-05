// Ported from vincentventalon/claude-code-video-editing-skill scripts/edit_video.py (commit 65b56df), MIT. Copyright (c) 2026 Vincent Ventalon. See NOTICE.
//
// MIT License
//
// Copyright (c) 2026 Vincent Ventalon
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Changes in this port: English word lists only; tokens follow the seat spike's rule (lower-case,
// curly apostrophe mapped to a straight one, only a-z, 0-9 and the apostrophe kept) instead of the
// original's accent-folding rule that also dropped apostrophes; the similarity ratio is our own
// Ratcliff/Obershelp (seqratio.js); isRestartPhrase is new. Browser-safe: no `node:` imports.

import { sequenceRatio, matchingBlocks } from './seqratio.js';

/** An island that is only these words is filler. */
export const FILLERS = Object.freeze(new Set(['um', 'uh', 'uhm', 'hm', 'hmm', 'mh', 'mm', 'erm', 'er']));
/** Lead-in words that are not part of the sentence ("So, the server..." is the same take as "The server..."). */
export const LEADINS = Object.freeze(new Set(['um', 'uh', 'so', 'well', 'okay', 'ok', 'right']));
/** Linking words a new take often adds in front, set aside only when comparing neighbouring islands. */
export const LINKS = Object.freeze(new Set(['and', 'but', 'so', 'then', 'that']));
/** Words a spoken restart phrase is made of ("sorry, let me start that again"). */
export const RESTART_WORDS = Object.freeze(new Set(['sorry', 'let', "let's", 'me', 'start', 'try', 'that', 'this', 'again', 'over', 'from', 'the', 'top']));

/**
 * One token: lower-case, curly apostrophes mapped to a straight one, everything outside a-z, 0-9 and ' removed.
 * @param {string} text
 */
export function normToken(text) {
  return String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '');
}

/**
 * Tokens of a piece of text; bracketed noise like [Music], (laughs) or *noise* is dropped.
 * @param {string} text
 * @returns {string[]}
 */
export function toks(text) {
  const clean = String(text).replace(/[[(*][^\])*]*[\])*]/g, ' ');
  return clean.split(/[\s\-–—]+/).map(normToken).filter(Boolean);
}

/** @param {string | string[]} t */
const asTokens = (t) => (Array.isArray(t) ? t : toks(t));

/**
 * True when the island has words and every one is a filler.
 * @param {string | string[]} text
 */
export function onlyFillers(text) {
  const t = asTokens(text);
  return t.length > 0 && t.every((x) => FILLERS.has(x));
}

/**
 * Drop lead-in words from the front, keeping at least the last token.
 * @param {string[]} t
 */
export function stripLeadin(t) {
  let k = 0;
  while (k < t.length - 1 && LEADINS.has(t[k])) k += 1;
  return t.slice(k);
}

/**
 * Drop up to two linking words from the front, keeping at least the last token.
 * @param {string[]} t
 */
export function skipLinks(t) {
  let k = 0;
  while (k < Math.min(2, t.length - 1) && LINKS.has(t[k])) k += 1;
  return t.slice(k);
}

/**
 * How much the letters of `abandoned` are the beginning of `rest` (0-1). Letters, not words:
 * Whisper writes "GitStatus" once and "git status" the next time. Both must start together.
 * @param {string[]} abandoned
 * @param {string[]} rest
 */
export function startsLike(abandoned, rest) {
  const a = abandoned.join('');
  const s = rest.join('');
  if (a.length < 2 || s.length < a.length) return 0;
  let best = 0;
  for (let k = -2; k <= 2; k++) {
    const sub = s.slice(0, Math.max(1, a.length + k));
    const blocks = matchingBlocks(a, sub);
    if (blocks.length && blocks[0][0] === 0 && blocks[0][1] === 0 && blocks[0][2] >= 1) {
      const m = blocks.reduce((n, b) => n + b[2], 0);
      best = Math.max(best, (2 * m) / (a.length + sub.length));
    }
  }
  return best;
}

/**
 * The abandoned words are the start of what follows (threshold 0.74, measured by the original author:
 * true false starts 0.75-1.00, a sentence that simply goes on with a similar opening 0.71). Over a run of
 * several islands the first 8 letters must match too, since a shared end is not a shared beginning.
 * @param {string[]} abandoned
 * @param {string[]} rest
 * @param {number} [run]
 */
export function isStartOf(abandoned, rest, run = 1) {
  const a = stripLeadin(abandoned);
  const r = stripLeadin(rest);
  if (run > 1) {
    const ha = a.join('').slice(0, 8);
    const hr = r.join('').slice(0, 8);
    if (sequenceRatio(ha, hr.slice(0, ha.length)) < 0.6) return false;
  }
  return startsLike(a, r) >= 0.74;
}

/**
 * tj starts the sentence of ti again, the end may differ: the first 12 letters (at least 2 words) match
 * at 0.85 or more. For neighbouring islands, also: the first 3 words are the same once linking words are
 * set aside, or ti is said again whole within the first words of tj.
 * @param {string[]} ti
 * @param {string[]} tj
 * @param {boolean} [adjacent]
 */
export function restartsSentence(ti, tj, adjacent = false) {
  ti = stripLeadin(ti);
  tj = stripLeadin(tj);
  if (!ti.length || !tj.length) return false;
  if (adjacent) {
    const a = skipLinks(ti);
    const b = skipLinks(tj);
    if (a.length >= 3 && a.slice(0, 3).every((x, k) => x === b[k]) && a.slice(0, 3).join('').length >= 7) return true;
    const n = ti.length;
    if (n >= 2 && ti.join('').length >= 6) {
      for (let k = 1; k < 4; k++) {
        const piece = tj.slice(k, k + n);
        if (piece.length === n && piece.every((x, m) => x === ti[m])) return true;
      }
    }
  }
  if (ti[0][0] !== tj[0][0]) return false;
  let o = '';
  let k = 0;
  while (k < ti.length && (o.length < 12 || k < 2)) {
    o += ti[k];
    k += 1;
  }
  if (o.length < 12 || k < 2) return false;
  const s = tj.join('').slice(0, o.length);
  return s.length === o.length && sequenceRatio(o, s) >= 0.85;
}

/**
 * The same words twice in a row inside one island ("the the server"); returns the doubled words or null.
 * @param {string | string[]} text
 * @returns {string | null}
 */
export function repeatsItself(text) {
  const t = asTokens(text);
  for (let n = 1; n < 5; n++) {
    for (let i = 0; i + 2 * n <= t.length; i++) {
      const first = t.slice(i, i + n);
      const second = t.slice(i + n, i + 2 * n);
      if (first.join('').length >= 3 && first.every((x, k) => x === second[k])) return t.slice(i, i + 2 * n).join(' ');
    }
  }
  return null;
}

/**
 * The island is only a spoken restart phrase ("sorry, let me start that again", "let me try that again").
 * @param {string | string[]} tokens
 */
export function isRestartPhrase(tokens) {
  const t = asTokens(tokens);
  return t.length > 0 && t.every((x) => RESTART_WORDS.has(x)) && t.some((x) => x === 'again' || x === 'over' || x === 'start');
}

const APOLOGIES = new Set(['sorry', 'oops', 'whoops', 'apologies']);
const LEAD_PHRASES = [['let', 'me'], ["let's"], ['lets'], ['lemme'], ["i'll"], ['i', 'will']];
const RESTART_VERBS = new Set(['start', 'try', 'take', 'begin', 'do', 'restart', 'redo']);
const SELF_ENDING = new Set(['restart', 'redo']);
const OBJECTS = new Set(['that', 'this', 'it']);
const ENDINGS = [['again'], ['over'], ['once', 'more'], ['from', 'the', 'top'], ['from', 'the', 'start'], ['from', 'the', 'beginning']];
/** Words just before a restart phrase that mean it is being talked about, quoted or negated, not meant. */
const DISCUSSION_BEFORE = new Set([
  'not', 'never', 'no', "don't", 'dont', "didn't", 'didnt', "doesn't", "can't", "cant", "won't", "shouldn't", 'without',
  'say', 'says', 'said', 'saying', 'phrase', 'phrases', 'words', 'word', 'quote', 'quoted', 'quotes', 'called', 'mean', 'means', 'meant',
  'when', 'whenever', 'if', 'unless', 'whether', 'type', 'typed', 'typing', 'write', 'wrote', 'tell', 'tells', 'told', 'heard', 'hear',
  'editor', 'editors', 'editing', 'edit', 'caption', 'captions', 'button', 'command', 'detect', 'detects', 'detector', 'like',
]);
/** Reporting verbs: "he went, sorry, let me start that again" is somebody's story, not the speaker's own restart. */
const REPORTING_WORDS = new Set(['go', 'goes', 'going', 'went', 'gone', 'ask', 'asks', 'asked', 'reply', 'replies', 'replied', 'answer', 'answers', 'answered', 'shout', 'shouted', 'yell', 'yelled', 'whisper', 'whispered', 'sing', 'sings', 'sang']);
/** Verbs that can only mean restarting the speech itself ("try", "do", "take" may be a physical action). */
const SPEECH_RESTART_VERBS = new Set(['start', 'begin', 'restart', 'redo']);

/**
 * True when any token talks about, quotes, negates or reports speech. Used over the whole abandoned stretch
 * before a phrase (not just the 3 tokens next to it) to downgrade a cut to a suggestion.
 * @param {string[]} tokens
 */
export function talksAboutSpeech(tokens) {
  return tokens.some((x) => DISCUSSION_BEFORE.has(x) || REPORTING_WORDS.has(x));
}

/** True when the phrase tokens contain a verb that can only refer to restarting speech. @param {string[]} tokens */
export function hasSpeechRestartVerb(tokens) {
  return tokens.some((x) => SPEECH_RESTART_VERBS.has(x));
}

/** Words right after a restart phrase that make it the subject of a sentence ("... again" is a phrase). */
const DISCUSSION_AFTER = new Set(['is', 'are', 'was', 'were', 'means', 'mean', 'phrase', 'button', 'command', 'feature', 'isn\'t', 'works', 'triggers']);

/** @param {string[]} t @param {string[]} pat @param {number} at */
const hasAt = (t, pat, at) => pat.every((x, k) => t[at + k] === x);

/**
 * Length (in tokens) of an explicit first-person restart phrase that begins at t[at], or 0.
 * "sorry let me start that again", "oops let's try that over", "let me start from the top", "sorry start over".
 * An apology or a "let me" lead-in is required, so ordinary words never match.
 * @param {string[]} t
 * @param {number} at
 */
export function restartPhraseLength(t, at) {
  let k = at;
  const apology = APOLOGIES.has(t[k]);
  if (apology) k += 1;
  const lead = LEAD_PHRASES.find((p) => hasAt(t, p, k));
  if (lead) k += lead.length;
  else if (!apology) return 0;
  const verb = t[k];
  if (!RESTART_VERBS.has(verb)) return 0;
  k += 1;
  if (OBJECTS.has(t[k])) k += 1;
  const ending = ENDINGS.find((p) => hasAt(t, p, k));
  if (ending) return k + ending.length - at;
  // "let me redo that" / "let me restart" end the phrase by themselves.
  if (lead && SELF_ENDING.has(verb)) return k - at;
  return 0;
}

/**
 * All spoken restart runs in the tokens: {start, end} (end exclusive). Phrases that follow each other
 * (optionally with a filler between) are one run. Phrases that are discussed, quoted or negated are skipped.
 * @param {string[]} t
 * @returns {Array<{ start: number, end: number }>}
 */
export function findSpokenRestarts(t) {
  const runs = [];
  let i = 0;
  while (i < t.length) {
    const len = restartPhraseLength(t, i);
    if (!len) { i += 1; continue; }
    let end = i + len;
    for (;;) {
      let next = end;
      while (FILLERS.has(t[next])) next += 1;
      const more = restartPhraseLength(t, next);
      if (!more) break;
      end = next + more;
    }
    const before = t.slice(Math.max(0, i - 3), i);
    const talkedAbout = before.some((x) => DISCUSSION_BEFORE.has(x)) || DISCUSSION_AFTER.has(t[end]);
    if (!talkedAbout) runs.push({ start: i, end });
    i = end;
  }
  return runs;
}

/**
 * How the opening of an abandoned attempt matches the sentence that follows the restart: the number of
 * leading tokens (lead-in words set aside) that are exactly the same, and their letters.
 * @param {string[]} abandoned
 * @param {string[]} restart
 * @returns {{ words: number, letters: number, skipA: number, skipB: number }}
 */
export function sharedOpening(abandoned, restart) {
  const skipA = abandoned.length - stripLeadin(abandoned).length;
  const skipB = restart.length - stripLeadin(restart).length;
  const a = abandoned.slice(skipA);
  const b = restart.slice(skipB);
  let words = 0;
  let letters = 0;
  while (words < a.length && words < b.length && a[words] === b[words]) {
    letters += a[words].length;
    words += 1;
  }
  return { words, letters, skipA, skipB };
}
