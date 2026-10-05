// Brief validation (PREP-01, D-04). A brief is an idea plus exactly three
// talking points; each point carries 2-3 prepared angles. A brief is checked
// whole: a broken or half-written file is rejected with an error naming the
// file and the first problem, and no partial brief is ever returned.
//
// Brief file (JSON):
//   version 1, label "sample", idea (string), points (3), each point:
//   id ("p1"), title ("Hook"), active (an angle id), angles (2-3), each angle:
//   id ("p1-tips"), label (one plain word such as "tips", "story" or
//   "numbers", and not one of YAP's own words), text (the talking point
//   shown), reply (YAP's silent on-screen answer), keywords (strings).
//
// YAP hears a label one spoken word at a time (src/engine/swap.js), so a label
// of several words, or one with a hyphen or a symbol, could never be named in
// a remark, and a label that is also one of the words YAP listens for could
// not be told apart from that word. Both are refused here.

import { isOwnWord } from './swap.js';

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
/** One plain word: letters, digits and apostrophes and nothing else, in either case. */
const isOneWord = (v) => /^[a-z0-9']+$/i.test(v.trim());

/**
 * @param {unknown} obj
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBrief(obj) {
  const errors = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['the brief must be a JSON object'] };
  }
  const brief = /** @type {Record<string, any>} */ (obj);
  if (brief.version !== 1) errors.push(`version must be 1 (found ${JSON.stringify(brief.version)})`);
  if (!isText(brief.idea)) errors.push('idea must be a non-empty string');
  if (!Array.isArray(brief.points)) {
    errors.push('points must be an array of 3 talking points');
    return { ok: false, errors };
  }
  if (brief.points.length !== 3) errors.push(`points must hold exactly 3 talking points (found ${brief.points.length})`);

  const pointIds = new Set();
  brief.points.forEach((point, i) => {
    const name = point && isText(point.id) ? `point ${point.id}` : `point ${i + 1}`;
    if (point === null || typeof point !== 'object') {
      errors.push(`${name} must be an object`);
      return;
    }
    if (!isText(point.id)) errors.push(`${name} needs an id`);
    else if (pointIds.has(point.id)) errors.push(`${name} has a duplicate id`);
    else pointIds.add(point.id);
    if (!isText(point.title)) errors.push(`${name} needs a title`);
    if (!Array.isArray(point.angles)) {
      errors.push(`${name} needs 2-3 angles (found none)`);
      return;
    }
    if (point.angles.length < 2 || point.angles.length > 3) {
      errors.push(`${name} needs 2-3 angles (found ${point.angles.length})`);
    }
    const angleIds = new Set();
    point.angles.forEach((angle, k) => {
      const aname = angle && isText(angle.id) ? `angle ${angle.id} in ${name}` : `angle ${k + 1} in ${name}`;
      if (angle === null || typeof angle !== 'object') {
        errors.push(`${aname} must be an object`);
        return;
      }
      for (const field of ['id', 'label', 'text', 'reply']) {
        if (!isText(angle[field])) errors.push(`${aname} needs a non-empty ${field}`);
      }
      if (!Array.isArray(angle.keywords) || !angle.keywords.every((w) => typeof w === 'string')) {
        errors.push(`${aname} needs a keywords array of strings`);
      }
      if (isText(angle.id)) {
        if (angleIds.has(angle.id)) errors.push(`${aname} has a duplicate id`);
        angleIds.add(angle.id);
      }
      if (isText(angle.label)) {
        if (!isOneWord(angle.label)) {
          errors.push(`${aname} needs a one-word label, letters and digits only (found "${angle.label}")`);
        } else if (isOwnWord(angle.label)) {
          errors.push(`${aname} needs another label: "${angle.label}" is a word YAP listens for`);
        }
      }
    });
    if (!isText(point.active)) errors.push(`${name} needs an active angle id`);
    else if (!angleIds.has(point.active)) errors.push(`${name} has active "${point.active}", which is not one of its angles`);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Parse and validate a brief file's text. Throws one Error naming the file and
 * the first problem; never returns a partial brief.
 * @param {string} text
 * @param {string} fileName
 * @returns {object} the brief
 */
export function parseBrief(text, fileName) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`${fileName}: not valid JSON, the file may be half-written (${err.message})`);
  }
  const { ok, errors } = validateBrief(obj);
  if (!ok) throw new Error(`${fileName}: ${errors[0]}`);
  return obj;
}
