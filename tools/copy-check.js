// The no-grading language check (PRD rule: YAP never scores, grades or
// colour-codes the person). Shared by the tests that read the COPY objects,
// the replay printout and the debug page. Plain ES module, no dependencies,
// safe in Node and in a browser.
//
// A match is not proof of a grade (a word can have an innocent use), so the
// list is kept to words and shapes YAP itself never needs: a hit in any text
// YAP shows the person is a defect to fix in that text.

/** Case-insensitive; whole words where words apply. */
export const GRADING_PATTERNS = Object.freeze([
  /\b(?:score|scored|scores|scoring)\b/i,
  /\b(?:grade|graded|grades|grading)\b/i,
  /\b(?:rating|rated)\b/i,
  /\b(?:rank|ranked|ranking)\b/i,
  /\bwell done\b/i,
  /\bgood job\b/i,
  /\bgreat job\b/i,
  /\bnice work\b/i,
  /\bbad take\b/i,
  /\bpoor\b/i,
  /\bexcellent\b/i,
  /\bterrible\b/i,
  /\bperfect take\b/i,
  /\bnailed it\b/i,
  /\byou failed\b/i,
  /\byou passed\b/i,
  // a number out of ten, such as "7/10" or "8 out of 10"
  /\b\d+(?:\.\d+)?\s*\/\s*10\b/i,
  /\bout of (?:10|ten)\b/i,
  // any percentage
  /\d+(?:\.\d+)?\s*%/,
  /\bper ?cent\b/i,
  // colour words that would colour-code the person
  /\b(?:red|green)\b/i,
]);

/**
 * Every grading-language match in `text`, in order of position.
 * @param {string} text
 * @returns {{ match: string, index: number, pattern: string }[]}
 */
export function findGradingLanguage(text) {
  const s = String(text ?? '');
  const found = [];
  for (const re of GRADING_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of s.matchAll(g)) found.push({ match: m[0], index: m.index ?? 0, pattern: re.source });
  }
  return found.sort((a, b) => a.index - b.index);
}
