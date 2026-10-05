// What "Refine with YAP" does on the beat list, and how a person's idea becomes
// short beats (Loom 07:06: "It's not a full script ... a few beats").
//
// Three jobs, all pure:
//   momentRows / offeredFromWords   a short title in the person's words and one
//                                   line for each beat; their unused sentences
//                                   offered back as suggestions
//   readRequest / applyRequest      what the person typed is a request about a
//                                   beat, a question or a thought; the requests
//                                   YAP can do with no model are done here
//   listRequestText / readListReply the same asked of a model (prompts/beat-list.md)
//                                   and its answer checked before a row changes
//
// A row is { id, title, line, source, state } as ui/lib/beats-model.js gives it.
// Imports nothing, never mutates its inputs, reaches no page, server or model.

/** One setting each. */
export const LIST_LIMITS = Object.freeze({
  rows: 12,
  titleWords: 4,
  lineWords: 14,
  lineChars: 200,
  suggestions: 3,
  sayChars: 320,
  repeatShare: 0.6,
});

const plain = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const wordsOf = (value) => plain(value).split(' ').filter(Boolean);
const sentencesOf = (value) => plain(value).split(/(?<=[.!?])\s+/).filter(Boolean);
const two = (n) => String(n).padStart(2, '0');
const capital = (value) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** Words that say nothing about a beat by themselves. */
const SMALL = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'for', 'with', 'in', 'on', 'at', 'my', 'is', 'it', 'i', 'that', 'this', 'then', 'so', 'but', 'by', 'from', 'as', 'was', 'be', 'me', 'you', 'they', 'we']);
/** How a spoken sentence starts before it gets to the moment. */
const LEAD_INS = [
  /^(?:so|and|but|well|then|after|when|because|before|while|once)\s+/i,
  /^(?:i|we)\s+(?:want|need|would like|'d like)\s+(?:people|you|them|viewers|everyone|to)\s+(?:to\s+)?/i,
  /^(?:i|we)(?:'ve| have|'m| am|'d| had| was| were)?\s+(?:been\s+|just\s+|really\s+)?/i,
  /^(?:this is|that is|it is|it's|that's|there is|there's)\s+(?:how|why|when|where|what)?\s*/i,
];
/** Where a long sentence can stop and still be a sentence. */
const CLAUSE = /,\s+|\s+(?=(?:and then|before|because|so that|until|while)\b)/i;

const contentWords = (value) => wordsOf(value).map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')).filter((word) => word && !SMALL.has(word));

/** How much of `line` the lines in `others` already say: the share of its words found in any one of them. */
function saidShare(line, others) {
  const mine = contentWords(line);
  if (!mine.length) return 1;
  let most = 0;
  for (const other of others) {
    const theirs = new Set(contentWords(other));
    most = Math.max(most, mine.filter((word) => theirs.has(word)).length / mine.length);
  }
  return most;
}

/**
 * A short title for a beat, made only from the words of its line: the lead-in
 * comes off ("I've been", "After I", "I want people to") and the first few
 * words of what is left stay. "I never pressed record." gives "Never pressed record".
 * @param {string} line
 * @returns {string}
 */
export function shortTitle(line) {
  let rest = sentencesOf(line)[0] || '';
  for (let pass = 0; pass < 2; pass += 1) {
    for (const lead of LEAD_INS) rest = rest.replace(lead, '');
  }
  const picked = wordsOf(rest.split(CLAUSE)[0]).slice(0, LIST_LIMITS.titleWords);
  while (picked.length > 2 && SMALL.has(picked[picked.length - 1].toLowerCase().replace(/[^\p{L}']/gu, ''))) picked.pop();
  const title = picked.join(' ').replace(/[.,;:!?…]+$/u, '');
  return capital(title) || capital(wordsOf(line).slice(0, LIST_LIMITS.titleWords).join(' ').replace(/[.,;:!?…]+$/u, ''));
}

/**
 * One line for a beat: the first sentence of the words, stopped at its first
 * clause when it runs long. Nothing is reworded.
 * @param {string} words
 * @returns {string}
 */
export function oneLine(words) {
  const first = sentencesOf(words)[0] || '';
  // Typed words often stop with no full stop: the line gets one.
  if (wordsOf(first).length <= LIST_LIMITS.lineWords) return first && !/[.!?…]$/u.test(first) ? `${first}.` : first;
  const parts = first.split(CLAUSE);
  let kept = parts[0];
  for (let i = 1; i < parts.length && wordsOf(kept).length < 4; i += 1) kept = `${kept}, ${parts[i]}`;
  if (wordsOf(kept).length > LIST_LIMITS.lineWords) kept = wordsOf(kept).slice(0, LIST_LIMITS.lineWords).join(' ');
  return `${kept.replace(/[.,;:!?…]+$/u, '')}.`;
}

/**
 * The kept beats of an idea as moments: each a short title in the person's
 * words over one line. A suggestion and its state are left as they are.
 * @param {{ id: string, title: string, line: string, source?: string, state?: string }[]} rows
 */
export function momentRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row.source === 'suggestion') return row;
    const line = oneLine(row.line) || plain(row.line);
    return { ...row, title: shortTitle(line) || plain(row.title), line };
  });
}

/**
 * What YAP offers with no model: the sentences the person said that no beat
 * says yet, each as a written beat. Never a stock prompt, never a repeat.
 * @param {{ said?: string[], rows?: { id: string, line: string }[] }} input `said` is everything the person told YAP
 * @returns {{ id: string, title: string, line: string, source: 'suggestion', state: 'suggested' }[]}
 */
export function offeredFromWords({ said = [], rows = [] } = {}) {
  const have = rows.map((row) => plain(row.line));
  const used = new Set(rows.map((row) => row.id));
  const offered = [];
  let n = 1;
  for (const sentence of said.flatMap(sentencesOf)) {
    if (offered.length >= LIST_LIMITS.suggestions) break;
    if (wordsOf(sentence).length < 4 || /\?$/.test(sentence)) continue;
    const line = oneLine(sentence);
    if (saidShare(line, have) >= LIST_LIMITS.repeatShare) continue;
    while (used.has(`suggestion-${n}`)) n += 1;
    const id = `suggestion-${n}`;
    used.add(id);
    have.push(line);
    offered.push({ id, title: shortTitle(line), line, source: 'suggestion', state: 'suggested' });
  }
  return offered;
}

/**
 * The list without the waiting suggestions a kept beat now says: once the
 * person has the words on their list, YAP stops offering them.
 * @param {any[]} rows
 */
export function withoutRepeats(rows) {
  const kept = rows.filter((row) => row.state !== 'suggested').map((row) => plain(row.line));
  return rows.filter((row) => row.state !== 'suggested' || saidShare(row.line, kept) < LIST_LIMITS.repeatShare);
}

/**
 * The kept beat that already says these words, as its row index, or -1.
 * @param {string} words
 * @param {any[]} rows
 */
export function saidBy(words, rows) {
  return rows.findIndex((row) => row.state !== 'suggested' && saidShare(words, [row.line]) >= 0.85);
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const FIRST_NAMES = /\b(?:opening|opener|intro|introduction|hook|start|beginning)\b/i;
const LAST_NAMES = /\b(?:closing|close|ending|end|outro|conclusion|last beat|final beat|last one)\b/i;

/** The last row the person kept, or the last row. */
function lastKept(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].state !== 'suggested') return i;
  return rows.length - 1;
}

/**
 * The rows a piece of a request names, top to bottom of the wording: by number
 * ("beat 3", "2 and 3", "the third"), by place ("the opening", "the closing")
 * or by the words of a title.
 * @returns {number[]} row indexes, each once
 */
export function namedRows(wording, rows) {
  const low = plain(wording).toLowerCase();
  const found = [];
  const add = (at, index) => { if (index >= 0 && index < rows.length && !found.some((each) => each.index === index)) found.push({ at, index }); };
  for (const match of low.matchAll(/\b(\d{1,2})\b/g)) add(match.index, Number(match[1]) - 1);
  ORDINALS.forEach((word, i) => { const at = low.search(new RegExp(`\\b${word}\\b`)); if (at >= 0) add(at, i); });
  NUMBER_WORDS.forEach((word, i) => { const at = low.search(new RegExp(`\\bbeats? ${word}\\b|\\b${word} (?:and|with)\\b|\\b(?:and|with) ${word}\\b`)); if (at >= 0) add(at, i); });
  if (!found.length) {
    rows.forEach((row, index) => {
      const title = plain(row.title).toLowerCase();
      const at = title ? low.indexOf(title) : -1;
      if (at >= 0) add(at, index);
    });
  }
  if (!found.length) {
    const first = low.search(FIRST_NAMES);
    const last = low.search(LAST_NAMES);
    if (first >= 0) add(first, 0);
    if (last >= 0) add(last, lastKept(rows));
  }
  return found.sort((a, b) => a.at - b.at).map((each) => each.index);
}

const ASKS = /\?\s*$|^(?:what|how|why|which|who|should|is|are|does|do|did|can|could|would|will|any)\b/i;
const SWAPS = /\b(?:swap|switch|trade)\b/i;
const MOVES = /\b(?:move|put|bring|push)\b/i;
const REMOVES = /^(?:please\s+)?(?:remove|delete|drop|lose|cut|take out|get rid of)\b/i;
const SHORTENS = /\b(?:shorten|shorter|tighten|tighter|trim|too long|cut down|more concise|less wordy)\b/i;
const WRITES = /^(?:please\s+)?(?:make|change|rewrite|reword|rephrase|fix|improve|merge|combine|split|suggest|help|reorder|rearrange|sort|simplify|expand|lengthen|replace|rename|write|give me|add a beat|add another)\b/i;

/**
 * What the person typed, read as one of:
 *   swap     two beats change places           { a, b }
 *   move     one beat goes somewhere           { from, to }
 *   remove   one beat leaves                   { at }
 *   shorten  one beat gets a shorter line      { at }
 *   ask      a question for YAP
 *   write    a request that needs new wording
 *   thought  the person's own words, to keep as a beat
 * Row numbers are indexes into `rows`. A request that names no beat it can
 * find is 'write': it is never done to a guessed row.
 * @param {string} words
 * @param {{ id: string, title: string, line: string, state?: string }[]} rows
 */
export function readRequest(words, rows) {
  const typed = plain(words);
  const low = typed.toLowerCase();
  const named = namedRows(typed, rows);
  if (SWAPS.test(low)) return named.length >= 2 ? { kind: 'swap', a: named[0], b: named[1] } : { kind: 'write' };
  if (MOVES.test(low) && named.length) {
    const from = named[0];
    let to = -1;
    if (/\b(?:to the top|first|to the start|to the beginning)\b/.test(low) && !(from === 0 && named.length === 1 && /\bfirst beat\b/.test(low))) to = 0;
    else if (/\b(?:to the end|last|to the bottom)\b/.test(low)) to = rows.length - 1;
    else if (/\bup\b/.test(low)) to = from - 1;
    else if (/\bdown\b/.test(low)) to = from + 1;
    else if (named.length >= 2 && /\b(?:before|above)\b/.test(low)) to = named[1] > from ? named[1] - 1 : named[1];
    else if (named.length >= 2 && /\b(?:after|below|under)\b/.test(low)) to = named[1] > from ? named[1] : named[1] + 1;
    else if (named.length >= 2 && /\bto\b/.test(low)) to = named[1];
    return to >= 0 && to < rows.length ? { kind: 'move', from, to } : { kind: 'write' };
  }
  if (SHORTENS.test(low)) return named.length ? { kind: 'shorten', at: named[0] } : { kind: 'write' };
  if (REMOVES.test(low) && named.length && wordsOf(typed).length <= 8) return { kind: 'remove', at: named[0] };
  if (ASKS.test(typed)) return { kind: 'ask' };
  if (WRITES.test(low) || (named.length && /\b(?:beats?|opening|closing|ending|intro|outro)\b/.test(low) && /\b(?:too|more|less|should|needs?|boring|weak|flat|stronger|punchier|clearer)\b/.test(low))) return { kind: 'write' };
  return { kind: 'thought' };
}

/** A shorter line made by cutting, never by rewording: its first sentence, then its first clause. '' when nothing can come off. */
export function shorterLine(line) {
  const whole = plain(line);
  const first = sentencesOf(whole)[0] || '';
  if (first && first !== whole) return first;
  const parts = whole.split(CLAUSE);
  if (parts.length > 1 && wordsOf(parts[0]).length >= 3) return `${parts[0].replace(/[.,;:!?…]+$/u, '')}.`;
  const lean = whole.replace(/\b(?:just|really|very|actually|basically|kind of|sort of|literally)\s+/gi, '');
  return lean !== whole ? lean : '';
}

/**
 * Do a request YAP needs no model for. Gives the new rows and what YAP says it
 * did, or null for a kind that needs wording ('ask', 'write', 'thought').
 * @returns {{ rows: any[], say: string, changed: boolean } | null}
 */
export function applyRequest(request, rows) {
  const name = (index) => `beat ${two(index + 1)}`;
  if (request.kind === 'swap') {
    if (request.a === request.b) return { rows, say: 'Name two different beats to swap.', changed: false };
    const next = rows.slice();
    [next[request.a], next[request.b]] = [next[request.b], next[request.a]];
    return { rows: next, say: `Swapped beats ${two(Math.min(request.a, request.b) + 1)} and ${two(Math.max(request.a, request.b) + 1)}.`, changed: true };
  }
  if (request.kind === 'move') {
    if (request.from === request.to) return { rows, say: `${capital(name(request.from))} is already there.`, changed: false };
    const next = rows.slice();
    const [moving] = next.splice(request.from, 1);
    next.splice(request.to, 0, moving);
    return { rows: next, say: `Moved "${moving.title}" to ${name(request.to)}.`, changed: true };
  }
  if (request.kind === 'remove') {
    const gone = rows[request.at];
    return { rows: rows.filter((_, i) => i !== request.at), say: `Removed "${gone.title}".`, changed: true, removed: gone };
  }
  if (request.kind === 'shorten') {
    const row = rows[request.at];
    const line = shorterLine(row.line);
    if (!line) return { rows, say: `${capital(name(request.at))} is one short line already. Press its pencil to change the words.`, changed: false };
    return { rows: rows.map((each, i) => (i === request.at ? { ...each, line } : each)), say: `Shortened ${name(request.at)} to "${line}"`, changed: true };
  }
  return null;
}

/**
 * YAP's answer to a question when no model answers: what it can count on the
 * list, said plainly. It judges nothing it cannot see.
 * @param {{ rows: any[], formatName?: string, slots?: string[] }} input
 */
export function plainAnswer({ rows, formatName = '', slots = [] }) {
  const kept = rows.filter((row) => row.state !== 'suggested');
  const waiting = rows.length - kept.length;
  const parts = [`You have ${kept.length === 1 ? 'one beat' : `${kept.length} beats`}${waiting ? ` and ${waiting === 1 ? 'one suggestion' : `${waiting} suggestions`} to answer` : ''}.`];
  if (slots.length && kept.length < slots.length) parts.push(`${formatName || 'This format'} usually runs ${slots.join(', ').toLowerCase()}, so one of those has no beat yet.`);
  const longest = kept.reduce((most, row, i) => (wordsOf(row.line).length > most.words ? { words: wordsOf(row.line).length, at: rows.indexOf(row), i } : most), { words: 0, at: -1 });
  if (longest.words > LIST_LIMITS.lineWords) parts.push(`Beat ${two(longest.at + 1)} is the longest at ${longest.words} words. Ask me to shorten it.`);
  else parts.push('Every beat is short enough to say in one breath.');
  return parts.join(' ');
}

/** True when what the person typed asks for a beat to go: only then may a model's answer leave one out. */
export const asksRemoval = (typed) => /\b(?:remove|delete|drop|cut|merge|combine|lose|fewer|get rid|take out|without)\b/i.test(plain(typed));

/**
 * True when `next` is `rows` with the line of row `at` made shorter and nothing
 * else touched: what "make beat 3 shorter" may do and no more.
 */
export function onlyShortens(next, rows, at) {
  return next.length === rows.length && next.every((row, i) => row.id === rows[i].id && (i === at
    ? plain(row.line).length < plain(rows[i].line).length
    : row.title === rows[i].title && row.line === rows[i].line));
}

/** What YAP says to a request for new wording when no model answers: what it does here, and where the person writes. */
export const PLAIN_WRITE = 'Here I swap, move, shorten or remove a beat when you name it, and keep a thought as a new beat. To change the wording, press the pencil on the beat.';

const listed = (rows) => rows.map((row, i) => `${two(i + 1)} [${row.id}] ${row.state === 'suggested' ? '(YAP suggestion, not accepted) ' : ''}${plain(row.title)} | ${plain(row.line)}`).join('\n');

/**
 * The text a model is given with prompts/beat-list.md.
 * `send` is 'write' (the first split of an idea into beats, with suggestions)
 * or 'request' (the person typed `typed` in the panel).
 * `named` is the row the request names, when YAP could tell ("the closing" is the last kept beat).
 * @param {{ send: 'write' | 'request', title?: string, formatName?: string, said?: string[], rows: any[], typed?: string, named?: number }} input
 */
export function listRequestText({ send, title = '', formatName = '', said = [], rows, typed = '', named = -1 }) {
  const meant = rows[named] ? `\nTHE BEAT THEY NAME: ${two(named + 1)} [${rows[named].id}]` : '';
  // What to send comes first: the server cuts a long text at its end.
  return [
    send === 'write' ? 'SEND NOW: the write answer.' : `SEND NOW: the request answer.\nTHE PERSON TYPED: ${plain(typed).slice(0, 500)}${meant}`,
    `IDEA: ${plain(title)}`,
    `FORMAT: ${plain(formatName) || 'Talking head'}`,
    'BEATS NOW (number [id] title | line):',
    listed(rows),
    'WHAT THE PERSON TOLD YAP:',
    ...said.map((each) => `- ${plain(each)}`),
  ].join('\n');
}

/** The first JSON object in a model's text, or null. */
function firstObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** A line that tells the person what they could say, where a beat is the words themselves. */
const IS_A_NOTE = /^(?:i (?:could|can|should|might|would)\b|you (?:could|can|should|might)\b|one line\b|a line\b|say\b|describe\b|explain\b|tell\b|talk about\b|mention\b|share\b)/i;
/** What YAP says, with any beat id a model let slip taken out: the person knows beats by number. */
const withoutIds = (value) => plain(plain(value).replace(/\s*\((?=[^()]*\b(?:own|suggestion|yap)-[a-z0-9-]+)[^()]*\)/gi, '').replace(/\s*\[?\b(?:own|suggestion|yap)-[a-z0-9-]+\b\]?/gi, '')).replace(/\s+([.,;:!?])/g, '$1');

const cleanTitle = (value) => wordsOf(value).slice(0, 8).join(' ').replace(/[.,;:…]+$/u, '');
const cleanLine = (value) => plain(value).slice(0, LIST_LIMITS.lineChars);

/**
 * A model's answer, checked. Null when it cannot be used, so the caller falls
 * back to what YAP does with no model.
 *   write    { kind: 'write', rows, offered }   kept beats retitled in place, new suggestions
 *   change   { kind: 'change', rows, say }      the list as the request leaves it
 *   answer   { kind: 'answer', say }
 *   thought  { kind: 'thought' }                the words are the person's own beat
 * A row keeps its id, source and state. A beat the model adds is a suggestion
 * the person has still to accept. A suggestion that repeats a beat is dropped.
 * @param {string} text
 * @param {any[]} rows the rows the model was shown
 * @param {{ mayRemove?: boolean }} [options] false when the person did not ask for a beat to go
 */
export function readListReply(text, rows, { mayRemove = true } = {}) {
  const reply = firstObject(text);
  if (!reply) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const used = new Set(rows.map((row) => row.id));
  let n = 1;
  const freshId = () => { while (used.has(`suggestion-${n}`)) n += 1; const id = `suggestion-${n}`; used.add(id); return id; };
  const say = withoutIds(reply.say).slice(0, LIST_LIMITS.sayChars);

  if (reply.kind === 'thought') return { kind: 'thought' };
  if (reply.kind === 'answer') return say ? { kind: 'answer', say } : null;

  if (reply.kind === 'write') {
    const written = new Map((Array.isArray(reply.beats) ? reply.beats : []).filter((beat) => beat && byId.has(beat.id)).map((beat) => [beat.id, beat]));
    const next = rows.map((row) => {
      const beat = written.get(row.id);
      if (!beat || row.source === 'suggestion') return row;
      const title = cleanTitle(beat.title);
      const line = cleanLine(beat.line);
      return title && line ? { ...row, title, line } : row;
    });
    // What YAP offers here takes the place of the suggestions still waiting, so only a kept beat makes one a repeat.
    const have = next.filter((row) => row.state !== 'suggested').map((row) => row.line);
    const offered = [];
    for (const beat of Array.isArray(reply.suggestions) ? reply.suggestions : []) {
      if (offered.length >= LIST_LIMITS.suggestions || next.length + offered.length >= LIST_LIMITS.rows) break;
      const title = cleanTitle(beat && beat.title);
      const line = cleanLine(beat && beat.line);
      if (!title || !line || IS_A_NOTE.test(line) || saidShare(line, have) >= LIST_LIMITS.repeatShare) continue;
      have.push(line);
      offered.push({ id: freshId(), title, line, source: 'suggestion', state: 'suggested' });
    }
    return { kind: 'write', rows: next, offered };
  }

  if (reply.kind === 'change') {
    if (!Array.isArray(reply.beats) || !reply.beats.length || !say) return null;
    const seen = new Set();
    const next = [];
    for (const beat of reply.beats.slice(0, LIST_LIMITS.rows)) {
      const title = cleanTitle(beat && beat.title);
      const line = cleanLine(beat && beat.line);
      if (!title || !line) return null;
      const old = beat && typeof beat.id === 'string' ? byId.get(beat.id) : null;
      if (old) {
        if (seen.has(old.id)) return null;
        seen.add(old.id);
        next.push({ ...old, title, line });
      } else {
        next.push({ id: freshId(), title, line, source: 'suggestion', state: 'suggested' });
      }
    }
    // Asked for anything but a removal, a model that leaves a beat out has dropped it by mistake: it goes back where it was.
    if (!mayRemove) rows.forEach((row, at) => { if (!seen.has(row.id)) next.splice(Math.min(at, next.length), 0, row); });
    const same = next.length === rows.length && next.every((row, i) => row.id === rows[i].id && row.title === rows[i].title && row.line === rows[i].line);
    return { kind: 'change', rows: next, say, changed: !same };
  }
  return null;
}
