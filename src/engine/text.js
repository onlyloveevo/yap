// Ported from jlecomte/voice-activated-teleprompter src/lib/word-tokenizer.ts (commit cd222c8), MIT. Copyright (c) 2024 - Present, Julien Lecomte - All Rights Reserved. See NOTICE.
//
// tokenize() is the port (TypeScript to plain JavaScript, behaviour kept, one
// fix: an unclosed "[" hint no longer loops forever; it runs to the end of
// the text). normalizeToken, STOPWORDS, stem and contentWords are YAP's own.
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

/**
 * @typedef {object} TextElement
 * @property {'TOKEN'|'DELIMITER'} type
 * @property {string} value
 * @property {number} index
 */

/**
 * Split text into alternating TOKEN and DELIMITER runs. Text between "[" and
 * "]" is a hint and is part of a delimiter.
 * @param {string|null} text
 * @returns {TextElement[]}
 */
export const tokenize = (text) => {
  /** @type {TextElement[]} */
  const results = [];

  if (text === null || text === undefined) {
    return results;
  }

  /** @type {TextElement|null} */
  let current = null;
  let i = 0;

  while (i < text.length) {
    let s = text[i];
    let inToken;

    // Special case for text within between [ and ], which the original author uses as hints in teleprompter text
    if (s === '[') {
      const hintLength = text.substring(i).indexOf(']');
      // Fix: the original fell back to s.substring(i), which is empty for i > 0
      // and never advanced; an unclosed hint now runs to the end of the text.
      s = hintLength > 0 ? text.substring(i, i + hintLength + 1) : text.substring(i);
      inToken = false;
    } else {
      inToken = /[A-Za-zÀ-ÿА-Яа-я0-9_]/.test(s);
    }

    if (current === null) {
      current = {
        type: inToken ? 'TOKEN' : 'DELIMITER',
        value: s,
        index: 0,
      };
    } else if (
      (current.type === 'TOKEN' && inToken) ||
      (current.type === 'DELIMITER' && !inToken)
    ) {
      current.value += s;
    } else if (
      (current.type === 'TOKEN' && !inToken) ||
      (current.type === 'DELIMITER' && inToken)
    ) {
      const lastIndex = current.index;
      results.push(current);
      current = {
        type: inToken ? 'TOKEN' : 'DELIMITER',
        value: s,
        index: lastIndex + 1,
      };
    }

    i += s.length;
  }

  // Don't forget to add the last one, whatever it was...
  if (current !== null) {
    results.push(current);
  }

  return results;
};

/**
 * Lower-case, map the curly apostrophe to a straight one, and strip every
 * character outside a-z, 0-9 and the apostrophe. "YAP!" -> "yap".
 * @param {string} s
 * @returns {string}
 */
export function normalizeToken(s) {
  return String(s).toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9']/g, '');
}

/** A fixed small English stopword list (normalised forms). */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'we', 'you', 'it', 'is', 'are', 'was', 'to', 'of',
  'and', 'or', 'but', 'so', 'that', 'this', 'about', 'when', "let's", 'lets', 'just',
  'like', 'do', "don't", 'not', 'in', 'on', 'at', 'for', 'with', 'be', 'can',
]);

/**
 * Strip one trailing "ing", "ed" or "s", only when the word is longer than 4
 * letters. "planning" -> "plann", "hours" -> "hour", "tips" -> "tips".
 * @param {string} word
 * @returns {string}
 */
export function stem(word) {
  const w = String(word);
  if (w.length <= 4) return w;
  if (w.endsWith('ing')) return w.slice(0, -3);
  if (w.endsWith('ed')) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/**
 * The words of a text that carry meaning: split on whitespace, normalised,
 * empties and stopwords dropped, order kept. Not stemmed.
 * @param {string} text
 * @returns {string[]}
 */
export function contentWords(text) {
  return String(text ?? '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter((w) => w && !STOPWORDS.has(w));
}
