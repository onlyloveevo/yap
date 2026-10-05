// Talking-point coverage: how much of a point's text was said in a segment.
// Input to the beat auto-tick (D-16); the session (Plan 01-07) uses it. It
// measures the words, never the person.

import { contentWords, stem } from './text.js';

/**
 * Distinct stemmed content words of `text` found among the stemmed content
 * words of the segment, divided by the number of distinct stemmed content
 * words of `text`. 1 when the text has no content words (nothing to cover);
 * otherwise 0 when the segment has no words.
 * @param {string} text
 * @param {(import('./replay.js').Word | string)[]} words
 * @returns {number} 0 to 1
 */
export function pointCoverage(text, words) {
  const wanted = new Set(contentWords(text).map(stem));
  if (wanted.size === 0) return 1;
  if (!Array.isArray(words) || words.length === 0) return 0;
  const said = new Set();
  for (const w of words) {
    const t = typeof w === 'string' ? w : w && w.text;
    for (const c of contentWords(t ?? '')) said.add(stem(c));
  }
  let found = 0;
  for (const c of wanted) if (said.has(c)) found += 1;
  return found / wanted.size;
}
