// Ported from jlecomte/voice-activated-teleprompter src/lib/speech-matcher.ts (commit cd222c8), MIT. Copyright (c) 2024 - Present, Julien Lecomte - All Rights Reserved. See NOTICE.
//
// computeSpeechRecognitionTokenIndex is the port (TypeScript to plain
// JavaScript, behaviour kept; the inner loop builds each reference prefix
// incrementally and also reports its distance, which gives the same index).
// createPointFollower (D-07) is YAP's own and uses the port to light the
// current talking point.
//
// MIT License
//
// Copyright (c) 2024 - Present, Julien Lecomte - All Rights Reserved
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

import { tokenize, normalizeToken, stem } from './text.js';
import { levenshteinDistance } from './levenshtein.js';

/**
 * The best-matching reference prefix that starts at lastIndex.
 * @param {string} comparison  recognised tokens joined by single spaces
 * @param {number} tokenCount  how many recognised tokens
 * @param {import('./text.js').TextElement[]} reference  element.index equals its array position
 * @param {number} lastIndex
 * @returns {{ index: number, distance: number }}  distance is Infinity when nothing could be compared
 */
function matchPrefix(comparison, tokenCount, reference, lastIndex) {
  if (lastIndex < 0) {
    lastIndex = 0;
  }

  // The next few tokens from the reference starting at the last recognised
  // token index: recognised length * 2 + 10 elements, delimiters dropped.
  const referenceTokens = reference
    .slice(lastIndex, lastIndex + tokenCount * 2 + 10)
    .filter((element) => element.type === 'TOKEN');

  // Levenshtein distance between the comparison string and each growing prefix.
  let best = Infinity;
  let bestAt = -1;
  let prefix = '';
  for (let i = 0; i < referenceTokens.length; i += 1) {
    prefix = i === 0 ? referenceTokens[0].value : `${prefix} ${referenceTokens[i].value}`;
    const distance = levenshteinDistance(comparison, prefix);
    if (distance < best) {
      best = distance;
      bestAt = i;
    }
  }

  const token = referenceTokens[bestAt];
  if (token) {
    return { index: token.index, distance: best };
  }
  return { index: lastIndex, distance: Infinity };
}

/**
 * The index of the reference token that best matches the end of the recognised
 * text, looking at most recognised length * 2 + 10 elements ahead of
 * lastRecognizedTokenIndex. Returns lastRecognizedTokenIndex when there is
 * nothing to compare against.
 * @param {string} recognized
 * @param {import('./text.js').TextElement[]} reference  as made by tokenize()
 * @param {number} lastRecognizedTokenIndex
 * @returns {number}
 */
export const computeSpeechRecognitionTokenIndex = (recognized, reference, lastRecognizedTokenIndex) => {
  // Tokenize the recognised input and convert the tokens back to a string.
  const recognizedTokens = tokenize(recognized).filter((element) => element.type === 'TOKEN');
  const comparison = recognizedTokens
    .reduce((accumulator, currentToken) => accumulator + ' ' + currentToken.value, '')
    .replace(/\s+/, ' ')
    .trim();
  return matchPrefix(comparison, recognizedTokens.length, reference, lastRecognizedTokenIndex).index;
};

/** Follower settings (D-07). */
export const FOLLOW_DEFAULTS = Object.freeze({
  /** how many of the latest final words are matched against the reference */
  recentWords: 8,
  /** consecutive words that must land in one later point before the light moves */
  confirmWords: 2,
  /** how many points after the current one are searched */
  lookaheadPoints: 2,
  /** consecutive words that must land when they come from stable interim text (more than final words: interim text can still be rewritten) */
  interimConfirmWords: 3,
});

/** @param {string} text @returns {string[]} normalised tokens */
function wordsOf(text) {
  return tokenize(String(text ?? ''))
    .filter((element) => element.type === 'TOKEN')
    .map((element) => normalizeToken(element.value))
    .filter(Boolean);
}

/**
 * Lights exactly one talking point at a time (D-07). The reference is each
 * point's active angle text followed by its keywords, all points in order.
 * Every final word is added to the last recentWords words; the ported matcher
 * is run from each token of the current point and the next lookaheadPoints
 * points, and the start with the smallest distance wins. The newest word lands
 * in a point when the matched token is that word (same stem). The light moves
 * only forward, and only after confirmWords consecutive words land in the same
 * later point, so a single stray word never moves it. Cost per word is bounded
 * by the look-ahead and the recentWords window, not by the length of the take.
 *
 * @param {{ points: { id: string, active: string, angles: { id: string, text: string, keywords?: string[] }[] }[] }} brief
 * @param {{ recentWords?: number, confirmWords?: number, lookaheadPoints?: number }} [options]
 */
export function createPointFollower(brief, options = {}) {
  const cfg = { ...FOLLOW_DEFAULTS, ...options };
  for (const key of ['recentWords', 'confirmWords', 'interimConfirmWords']) {
    if (!Number.isInteger(cfg[key]) || cfg[key] < 1) throw new RangeError(`${key} must be a whole number of 1 or more`);
  }
  if (!Number.isInteger(cfg.lookaheadPoints) || cfg.lookaheadPoints < 0) throw new RangeError('lookaheadPoints must be a whole number of 0 or more');

  /** @type {import('./text.js').TextElement[]} */
  let reference = [];
  /** @type {number[]} point index of each reference element */
  let pointOf = [];
  /** @type {number[]} */
  let segStart = [];
  /** @type {number[]} exclusive */
  let segEnd = [];
  /** @type {string[]} */
  let ids = [];

  let current = 0;
  /** @type {string[]} */
  let recent = [];
  let pending = { point: -1, count: 0 };

  function build(next) {
    if (!next || !Array.isArray(next.points) || next.points.length === 0) {
      throw new TypeError('createPointFollower needs a brief with at least one point');
    }
    reference = [];
    pointOf = [];
    segStart = [];
    segEnd = [];
    ids = next.points.map((p) => p.id);
    next.points.forEach((point, pi) => {
      const angles = Array.isArray(point.angles) ? point.angles : [];
      const angle = angles.find((a) => a.id === point.active) ?? angles[0];
      const tokens = wordsOf([angle?.text ?? '', ...(angle?.keywords ?? [])].join(' '));
      segStart[pi] = reference.length;
      for (const value of tokens) {
        reference.push({ type: 'TOKEN', value, index: reference.length });
        pointOf.push(pi);
        reference.push({ type: 'DELIMITER', value: ' ', index: reference.length });
        pointOf.push(pi);
      }
      segEnd[pi] = reference.length;
    });
  }

  const result = (changed) => ({ pointId: ids[current], index: current, changed });

  /** Add tokens to the recent window and move the light forward when `confirm` consecutive words land in one later point. */
  function step(tokens, confirm) {
    recent.push(...tokens);
    if (recent.length > cfg.recentWords) recent = recent.slice(recent.length - cfg.recentWords);
    const newest = tokens[tokens.length - 1];

    const comparison = recent.join(' ');
    const lastPoint = Math.min(ids.length - 1, current + cfg.lookaheadPoints);
    let best = { index: -1, distance: Infinity };
    for (let s = segStart[current]; s < segEnd[lastPoint]; s += 2) {
      const m = matchPrefix(comparison, recent.length, reference, s);
      if (m.distance < best.distance) best = m;
    }

    const landed = best.index >= 0 && stem(reference[best.index].value) === stem(newest) ? pointOf[best.index] : -1;
    if (landed <= current) {
      pending = { point: -1, count: 0 };
      return result(false);
    }
    pending = pending.point === landed ? { point: landed, count: pending.count + 1 } : { point: landed, count: 1 };
    if (pending.count < confirm) return result(false);
    current = landed;
    pending = { point: -1, count: 0 };
    return result(true);
  }

  build(brief);

  return {
    /**
     * @param {import('./replay.js').Word} word
     * @returns {{ pointId: string, index: number, changed: boolean }}
     */
    onWord(word) {
      if (!word || word.final === false) return result(false);
      const tokens = wordsOf(word.text);
      if (tokens.length === 0) return result(false);
      return step(tokens, cfg.confirmWords);
    },
    /**
     * Words of interim recognition that stayed the same across two results.
     * Fed one word at a time with the stricter interimConfirmWords, so the
     * light follows speech while it is being heard. The same forward-only rule
     * as onWord; the caller never sends a revised, unrelated or wake word.
     * @param {string[]} words
     * @returns {{ pointId: string, index: number, changed: boolean }}
     */
    onStableWords(words) {
      let changed = false;
      for (const text of words ?? []) {
        for (const token of wordsOf(text)) changed = step([token], cfg.interimConfirmWords).changed || changed;
      }
      return result(changed);
    },
    /**
     * Follow a swapped brief: the reference is rebuilt from the new active
     * angles, the lit point stays, the recent words are dropped.
     * @param {object} next
     */
    setBrief(next) {
      const litId = ids[current];
      build(/** @type {any} */ (next));
      const at = ids.indexOf(litId);
      current = at >= 0 ? at : Math.min(current, ids.length - 1);
      recent = [];
      pending = { point: -1, count: 0 };
    },
    /** A deliberate rail selection resets the speech context to that point. */
    setIndex(index) {
      if (!Number.isInteger(index) || index < 0 || index >= ids.length) return;
      current = index; recent = []; pending = { point: -1, count: 0 };
    },
    /** @returns {{ pointId: string, index: number }} */
    current() {
      return { pointId: ids[current], index: current };
    },
  };
}
