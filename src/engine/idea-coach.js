// The idea coach: the conversation that draws a video idea out of a person,
// and the outline it ends in. Pure functions, and the format library as its
// one import, so the page and Node load the same files.
//
// The shape:
//
//   Turn      { who: 'you' | 'yap', text, at, about? }
//   Outline   { format, title, beats: [{ label, line, keep }] }
//   Coaching  { rev, state, waiting, by, template, format, suggested, chosen, goes,
//               pick, experiments, turns, outline, thin?, added?, lines? }
//
// `template` is where the video is headed and `format` is how it is told; both
// come from src/engine/formats.js. `pick` is the direction the person chose for
// the template's key element ('a', 'b' or ''). `lines` are the directions Claude
// wrote for that element; without them the directions are cut from the
// person's own words. `thin` is set while YAP asks for more because the person
// wanted a draft and there was too little to draft from. `experiments` are the ones
// from Review the person added to this idea. A turn `about: 'format'` is YAP's
// question about the format or the person's answer to it, and a turn
// `about: 'ask'` is a question the person put to YAP: both are part of the
// conversation and no part of the story.
//
// `state` is where the conversation stands:
//   asking    YAP and the person are talking. `waiting` says what YAP owes:
//             'question', 'outline', or null when it is the person's move.
//   proposed  YAP has put an outline forward. The person edits it, asks for
//             another go, says more, or accepts.
//   accepted  The outline became the idea's beats. Nothing changes after that.
//
// Every change goes through step(), which gives the next coaching or refuses.
// `rev` counts the changes. A reply names the rev it was made for, so a reply
// that lands after the conversation moved on is refused and dropped.
//
// Two coaches answer behind coachReply(): the person's own Claude Code, and the
// built-in coach when Claude does not answer. The built-in coach asks the
// questions of the chosen format and builds its outline only from what the
// person typed. It never adds a fact about them.
//
// An outline always carries the format's own beats, under the format's own
// labels and in its order: a talking head is Opening, Story, Closing whoever
// drafted it.

/** @typedef {{ who: 'you' | 'yap', text: string, at: string, about?: 'format' | 'ask' }} Turn */
/** @typedef {{ id: string, title: string, from: string }} IdeaExperiment */
/** @typedef {{ label: string, line: string, keep: boolean }} OutlineBeat */
/** @typedef {{ format: string, title: string, beats: OutlineBeat[] }} Outline */
/**
 * @typedef {{ rev: number, state: 'asking' | 'proposed' | 'accepted',
 *   waiting: 'question' | 'outline' | null, by: '' | 'claude' | 'built-in',
 *   template: string, format: string, suggested: string, chosen: boolean, goes: number,
 *   pick: '' | 'a' | 'b' | 'c', experiments: IdeaExperiment[],
 *   turns: Turn[], outline: Outline | null }} Coaching
 */
/** @typedef {{ words: string, caption: string }} WrittenLine */
/** @typedef {{ kind: 'question', text: string, format?: string, about?: 'format', lines?: WrittenLine[] } | { kind: 'outline', format: string, title: string, say: string, beats: { label: string, line: string }[], lines?: WrittenLine[] }} Reply */

export const COACH_LIMITS = Object.freeze({ textChars: 500, questionChars: 300, titleChars: 80, labelChars: 40, minAnswers: 2, maxAnswers: 3, maxBeats: 5, maxTurns: 24, maxExperiments: 3, experimentChars: 160, lineWords: 12, lineChars: 90 });

/** The one quiet line under the conversation: who is answering. */
export const COACH_BY = Object.freeze({ claude: 'Coached by Claude on this Mac', 'built-in': 'YAP\'s built-in coach' });

/** What YAP says when it hands over an outline. */
export const DRAFT_LINE = 'Here\'s a draft. Does this feel right?';

import { FORMATS, TEMPLATES, THUMB_WORDS, formatFits, formatOf, formatQuestion, formatsFor, isFormat, isTemplate, keyDirections, keyElementOf, readFormatAnswer, readTemplateAnswer, suggestFormat, suggestTemplate, templateOf } from './formats.js';

export { FORMATS, TEMPLATES, formatOf, suggestFormat };

const STATES = Object.freeze(['asking', 'proposed', 'accepted']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Text as it is kept and shown: one line of plain characters, with control
 * characters and runs of white space turned into one space, cut to `max`
 * without leaving half of a two-part character.
 * @param {unknown} value
 * @param {number} [max]
 */
export function plain(value, max = COACH_LIMITS.textChars) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max).trim();
}

/** A title cut at a clause keeps at least this many characters. */
const MIN_TITLE_CHARS = 20;
const SENTENCE_END = /(?<=[.!?])\s+/;
const LEAD_INS = Object.freeze([
  /^(?:i(?: would|'d)? (?:want|like|need) to |i(?:'m| am) going to |let me )?(?:make|do|film|record|shoot|create) (?:a|an|my|this) (?:youtube |short )?(?:video|vlog|reel|short|clip|episode) (?:about|on|where|explaining) /i,
  /^(?:a|an|my) (?:video|vlog|idea) (?:about|on) /i,
]);

/** The sentences of a text, in order. */
function sentences(text) {
  return plain(text, 4000).split(SENTENCE_END).map((part) => part.trim()).filter(Boolean);
}

/**
 * A short title from the person's own first sentence: the lead-in ("I want to
 * make a video about") and the closing full stop are dropped, a lone "i" is
 * written "I", and nothing is added.
 */
export function titleFrom(thought) {
  let title = sentences(thought)[0] || '';
  for (const lead of LEAD_INS) title = title.replace(lead, '');
  title = title.replace(/[.!\s]+$/, '').replace(/\bi\b/g, 'I');
  if (title.length > COACH_LIMITS.titleChars) {
    // Too long for a title: stop at the last clause that fits, or failing that the last whole word.
    const cut = title.slice(0, COACH_LIMITS.titleChars);
    const clause = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'), cut.lastIndexOf(':'));
    const end = clause >= MIN_TITLE_CHARS ? clause : cut.lastIndexOf(' ');
    title = (end > 0 ? cut.slice(0, end) : cut).replace(/[,;:\s]+$/, '');
  }
  return title ? title[0].toUpperCase() + title.slice(1) : '';
}

/**
 * The coaching of an idea nobody has coached yet: the person's first words as
 * the one turn, and YAP owing its first question.
 * @param {{ thought?: string, title?: string, createdAt?: string | null }} idea
 * @returns {Coaching}
 */
export function startCoaching(idea) {
  const known = isObject(idea) ? idea : {};
  const thought = plain(known.thought) || plain(known.title);
  const template = suggestTemplate(thought);
  const read = suggestFormat(thought);
  const format = formatFits(read, template) ? read : formatsFor(template)[0].key;
  return {
    rev: 0, state: 'asking', waiting: 'question', by: '', template, format, suggested: format, chosen: false, goes: 0,
    pick: '', experiments: [],
    turns: thought ? [{ who: 'you', text: thought, at: typeof known.createdAt === 'string' ? known.createdAt : '' }] : [],
    outline: null,
  };
}

/** What the person said of their story after their first thought, in order. A turn about the format is not part of it. */
export function answersOf(coaching) {
  return coaching.turns.filter((turn) => turn.who === 'you').slice(1).filter((turn) => !turn.about).map((turn) => turn.text);
}

/**
 * The directions for this idea's key element. Claude's own lines when it wrote
 * some for this element; otherwise lines cut from the person's own words.
 * @returns {import('./formats.js').Direction[]}
 */
export function directionsOf(coaching) {
  const element = templateOf(coaching.template).element;
  const title = (coaching.outline && coaching.outline.title) || titleFrom(thoughtOf(coaching));
  const cut = keyDirections({ title, answers: answersOf(coaching), element });
  if (!coaching.lines || coaching.lines.element !== element) return cut;
  // Claude's lines first. When it wrote only one that can be used, the second is cut from the person's own words.
  const written = coaching.lines.items.map((line) => ({ words: line.words, caption: element === 'thumbnail' ? line.caption : '' }));
  const spare = cut.filter((direction) => !written.some((line) => line.words.toLowerCase() === direction.words.toLowerCase()));
  return [...written, ...spare].slice(0, 2).map((line, i) => ({ key: i === 0 ? 'a' : 'b', name: `Direction ${i === 0 ? 'A' : 'B'}`, words: line.words, caption: line.caption }));
}

/** The lines a coach wrote for a key element, as they are kept: one or two, each a few words, or null. */
function cleanLines(value, element) {
  if (!Array.isArray(value)) return null;
  const most = element === 'thumbnail' ? THUMB_WORDS.max : COACH_LIMITS.lineWords;
  const items = value
    .filter(isObject)
    .map((line) => ({ words: plain(line.words, COACH_LIMITS.lineChars), caption: plain(line.caption, COACH_LIMITS.lineChars) }))
    .filter((line) => line.words && line.words.split(' ').length <= most)
    .filter((line, i, all) => all.findIndex((other) => other.words.toLowerCase() === line.words.toLowerCase()) === i)
    .slice(0, 2);
  return items.length > 0 ? items : null;
}

/** The words of the direction the person picked, or '' when they picked none. */
export function pickedWords(coaching) {
  const picked = directionsOf(coaching).find((direction) => direction.key === coaching.pick);
  return picked ? picked.words : '';
}

/**
 * Is there enough to draft from? Two answers are an opening and a story. A
 * first thought that already tells it in sentences counts too: three parts in
 * all, between the thought and the answers. One sentence and nothing more is not.
 */
export function enoughToDraft(coaching) {
  const answers = answersOf(coaching).length;
  return answers >= COACH_LIMITS.minAnswers || sentences(thoughtOf(coaching)).length + answers >= COACH_LIMITS.maxAnswers;
}

/** An experiment as an idea keeps it, or null when it has no id or no title. */
function cleanExperiment(value) {
  if (!isObject(value)) return null;
  const id = plain(value.id, 80);
  const title = plain(value.title, COACH_LIMITS.experimentChars);
  return id && title ? { id, title, from: plain(value.from, 80) } : null;
}

/** The person's first thought. */
function thoughtOf(coaching) {
  return (coaching.turns.find((turn) => turn.who === 'you') || { text: '' }).text;
}

/**
 * Beats under the format's own labels, in the format's order. More beats than
 * the format has are folded into its middle beat, so the first stays the
 * opening and the last stays the closing.
 * @param {string} formatKey
 * @param {{ line: string }[]} beats
 */
function formatBeats(formatKey, beats) {
  const labels = formatOf(formatKey).slots.map((slot) => slot.label);
  const lines = beats.map((beat) => beat.line);
  const kept = lines.length <= labels.length ? lines : [lines[0], lines.slice(1, -1).join(' '), lines.at(-1)];
  return kept.map((line, i) => ({ label: labels[i], line: plain(line) }));
}

/** An outline as it is kept: a known format, a capped title, and one to maxBeats beats that each have words. */
function cleanOutline(value, fallbackFormat) {
  if (!isObject(value) || !Array.isArray(value.beats)) return null;
  const beats = value.beats
    .filter(isObject)
    .map((beat) => ({ label: plain(beat.label, COACH_LIMITS.labelChars), line: plain(beat.line), keep: beat.keep !== false }))
    .filter((beat) => beat.line)
    .slice(0, COACH_LIMITS.maxBeats);
  if (beats.length === 0) return null;
  return { format: isFormat(value.format) ? value.format : formatOf(fallbackFormat).key, title: plain(value.title, COACH_LIMITS.titleChars), beats };
}

/** A coaching read back from disk, or null when it is not one. */
export function readCoaching(value) {
  if (!isObject(value) || !STATES.includes(value.state) || !Array.isArray(value.turns) || !Number.isInteger(value.rev)) return null;
  const turns = value.turns
    .filter((turn) => isObject(turn) && (turn.who === 'you' || turn.who === 'yap') && plain(turn.text))
    .map((turn) => ({ who: turn.who, text: plain(turn.text), at: typeof turn.at === 'string' ? turn.at : '', ...(turn.about === 'format' || turn.about === 'ask' ? { about: turn.about } : {}) }));
  const outline = cleanOutline(value.outline, value.format);
  if (turns.length === 0 || (value.state !== 'asking' && !outline)) return null;
  return {
    rev: value.rev, state: value.state,
    waiting: value.state === 'asking' && (value.waiting === 'question' || value.waiting === 'outline') ? value.waiting : null,
    by: value.by === 'claude' || value.by === 'built-in' ? value.by : '',
    template: isTemplate(value.template) ? value.template : TEMPLATES[0].key,
    format: formatOf(value.format).key, suggested: formatOf(value.suggested).key, chosen: value.chosen === true,
    goes: Number.isInteger(value.goes) && value.goes > 0 ? value.goes : 0,
    pick: ['a', 'b'].includes(value.pick) ? value.pick : '',
    experiments: (Array.isArray(value.experiments) ? value.experiments : []).map(cleanExperiment).filter(Boolean).slice(0, COACH_LIMITS.maxExperiments),
    turns, outline,
    ...(value.thin === true && value.state === 'asking' && value.waiting === 'question' ? { thin: true } : {}),
    ...(value.added === true && value.state === 'asking' && value.waiting === 'outline' ? { added: true } : {}),
    ...(isObject(value.lines) && typeof value.lines.element === 'string' && cleanLines(value.lines.items, value.lines.element) ? { lines: { element: value.lines.element, items: cleanLines(value.lines.items, value.lines.element) } } : {}),
  };
}

const refuse = (status, error) => ({ ok: false, status, error });
const STALE = 'The conversation has moved on.';

/**
 * One change to a coaching. Gives `{ ok: true, coaching }` with the next
 * coaching, or `{ ok: false, status, error }` and changes nothing.
 *
 *   say      { text }           the person says something
 *   format   { format }         the person picks a format
 *   template { template }       the person picks where the video is headed
 *   pick     { pick }           the person picks a direction for the key element, or '' for none
 *   experiment { add } | { remove }   the person adds an experiment from Review to this idea, or takes one off
 *   revise   { index, text }    the person rewrites one of their answers, by its place in the story
 *   propose  {}                 the person asks for the outline now; with too little to draft from, YAP asks for more
 *   again    {}                 the person asks for another outline
 *   reply    { by, reply }      a coach answers what YAP owes
 *   edit     { outline }        the person changes the proposed outline
 *   accept   {}                 the proposed outline becomes the idea's beats
 *
 * Every event names the `rev` it was made for and the time `at`.
 * @param {Coaching} coaching
 * @param {{ type: string, rev: number, at?: string } & Record<string, any>} event
 */
export function step(coaching, event) {
  if (!isObject(event) || typeof event.type !== 'string') return refuse(400, 'That is not something the coach can do.');
  if (event.rev !== coaching.rev) return refuse(409, STALE);
  if (coaching.state === 'accepted') return refuse(409, 'This idea is already saved with its beats.');
  const at = typeof event.at === 'string' ? event.at : '';
  const next = { ...coaching, rev: coaching.rev + 1, turns: coaching.turns.slice() };
  const asking = coaching.state === 'asking';
  // "I need more before I can draft this" is said once: whatever comes next answers it or drops it.
  if (event.type !== 'reply') delete next.thin;
  delete next.added;

  if (event.type === 'say') {
    const text = plain(event.text);
    if (!text) return refuse(400, 'Say something first.');
    if (asking && coaching.waiting) return refuse(409, 'YAP is still answering.');
    if (coaching.turns.length >= COACH_LIMITS.maxTurns) return refuse(409, 'This conversation is full. Accept the outline or start a new idea.');
    // A short reply to YAP's format question chooses the format. Anything else is the person telling their story.
    const last = coaching.turns.at(-1);
    const chose = asking && last.who === 'yap' && last.about === 'format' && answersOf(coaching).length === 0 ? readFormatAnswer(text, coaching.format) : null;
    if (chose) {
      next.turns.push({ who: 'you', text, at, about: 'format' });
      next.format = chose;
      next.chosen = true;
      next.template = readTemplateAnswer(text) || coaching.template;
      next.waiting = 'question';
      return { ok: true, coaching: next };
    }
    // A question put to YAP while it is asking is answered from the format, and is no part of the story.
    if (asking && /\?\s*$/.test(text) && answersOf(coaching).length < COACH_LIMITS.maxAnswers) {
      next.turns.push({ who: 'you', text, at, about: 'ask' });
      next.waiting = 'question';
      return { ok: true, coaching: next };
    }
    next.turns.push({ who: 'you', text, at });
    next.state = 'asking';
    next.waiting = asking && answersOf(next).length < COACH_LIMITS.maxAnswers ? 'question' : 'outline';
    // Said after a draft: the next draft takes it in, and YAP says so when it hands it over.
    if (!asking) next.added = true;
    return { ok: true, coaching: next };
  }

  /** The proposed outline is drafted again: the line that handed the last one over makes way for the next. */
  const redraft = () => {
    if (next.turns.at(-1).who === 'yap') next.turns.pop();
    next.state = 'asking';
    next.waiting = 'outline';
  };

  if (event.type === 'format') {
    if (!isFormat(event.format)) return refuse(400, 'That is not a format YAP knows.');
    if (!formatFits(event.format, coaching.template)) return refuse(400, `${formatOf(event.format).name} has to be filmed. Pick where it is headed first.`);
    next.format = event.format;
    next.chosen = true;
    if (!asking) redraft();
    // Nothing answered yet: YAP's earlier question stays in the conversation, and the new format's first question follows it.
    else if (answersOf(coaching).length === 0 && coaching.waiting !== 'outline') next.waiting = 'question';
    return { ok: true, coaching: next };
  }

  if (event.type === 'template') {
    if (!isTemplate(event.template)) return refuse(400, 'That is not a place YAP knows.');
    next.template = event.template;
    if (!formatFits(coaching.format, event.template)) {
      // Something only heard cannot be told by showing it: the format moves to the first one that fits.
      next.format = formatsFor(event.template)[0].key;
      if (!formatFits(coaching.suggested, event.template)) next.suggested = next.format;
      if (!asking) redraft();
    }
    // A direction picked for one key element is no pick for another.
    if (templateOf(event.template).element !== templateOf(coaching.template).element) next.pick = '';
    return { ok: true, coaching: next };
  }

  if (event.type === 'pick') {
    // A key element has at most two directions. One that has no words yet picks nothing (see pickedWords).
    if (!['', 'a', 'b'].includes(event.pick)) return refuse(400, 'That is not one of the directions.');
    next.pick = event.pick;
    return { ok: true, coaching: next };
  }

  if (event.type === 'experiment') {
    if (typeof event.remove === 'string') {
      next.experiments = coaching.experiments.filter((experiment) => experiment.id !== event.remove);
      return { ok: true, coaching: next };
    }
    const added = cleanExperiment(event.add);
    if (!added) return refuse(400, 'An experiment has an id and a title.');
    const others = coaching.experiments.filter((experiment) => experiment.id !== added.id);
    if (others.length >= COACH_LIMITS.maxExperiments) return refuse(409, `An idea carries at most ${COACH_LIMITS.maxExperiments} experiments.`);
    next.experiments = [...others, added];
    return { ok: true, coaching: next };
  }

  if (event.type === 'revise') {
    if (!asking) return refuse(409, STALE);
    const text = plain(event.text);
    // The story's answers, by where each sits among the turns: the first thing the person said is the thought.
    const places = coaching.turns.map((turn, i) => (turn.who === 'you' && !turn.about ? i : -1)).filter((i) => i !== -1).slice(1);
    const place = places[event.index];
    if (!text || place === undefined) return refuse(400, 'That is not a line of the story.');
    next.turns[place] = { ...coaching.turns[place], text };
    return { ok: true, coaching: next };
  }

  if (event.type === 'propose') {
    if (!asking) return refuse(409, STALE);
    // A question the person chose not to answer is taken back, so what follows answers their own last words.
    if (next.turns.at(-1).who === 'yap') next.turns.pop();
    if (!enoughToDraft(coaching)) {
      // Too little to draft from: YAP asks for the next part of the story and says why.
      next.waiting = 'question';
      next.thin = true;
      return { ok: true, coaching: next };
    }
    next.waiting = 'outline';
    return { ok: true, coaching: next };
  }

  if (event.type === 'again') {
    if (coaching.state !== 'proposed') return refuse(409, STALE);
    redraft();
    next.goes = coaching.goes + 1;
    return { ok: true, coaching: next };
  }

  if (event.type === 'reply') {
    if (!asking || !coaching.waiting) return refuse(409, STALE);
    if (event.by !== 'claude' && event.by !== 'built-in') return refuse(400, 'A reply names the coach that made it.');
    const reply = cleanReply(event.reply, coaching);
    if (!reply) return refuse(400, 'That reply is not one the coach can use.');
    next.by = event.by;
    next.waiting = null;
    delete next.thin;
    if (reply.lines) next.lines = { element: templateOf(coaching.template).element, items: reply.lines };
    if (reply.kind === 'question') {
      if (reply.format && !coaching.chosen && answersOf(coaching).length === 0) next.format = next.suggested = reply.format;
      next.turns.push({ who: 'yap', text: reply.text, at, ...(reply.about ? { about: reply.about } : {}) });
      return { ok: true, coaching: next };
    }
    next.state = 'proposed';
    next.format = reply.format;
    next.outline = { format: reply.format, title: reply.title, beats: reply.beats.map((beat) => ({ ...beat, keep: true })) };
    next.turns.push({ who: 'yap', text: reply.say, at });
    return { ok: true, coaching: next };
  }

  if (event.type === 'edit') {
    if (coaching.state !== 'proposed') return refuse(409, STALE);
    const outline = cleanOutline(event.outline, coaching.outline.format);
    if (!outline) return refuse(400, 'An outline keeps at least one beat with words.');
    next.outline = { ...outline, title: outline.title || coaching.outline.title };
    return { ok: true, coaching: next };
  }

  if (event.type === 'accept') {
    if (coaching.state !== 'proposed') return refuse(409, STALE);
    if (keptBeatsOf(coaching.outline).length === 0) return refuse(400, 'Keep at least one beat.');
    next.state = 'accepted';
    return { ok: true, coaching: next };
  }

  return refuse(400, 'That is not something the coach can do.');
}

/**
 * A reply as it is used, or null when it does not answer what YAP owes: a
 * question while an outline is owed is no answer. Text is plain and capped.
 * @param {unknown} value
 * @param {Coaching} coaching
 * @returns {Reply | null}
 */
function cleanReply(value, coaching) {
  if (!isObject(value) || !coaching.waiting) return null;
  const written = cleanLines(value.directions || value.lines, templateOf(coaching.template).element);
  const lines = written ? { lines: written } : {};
  if (value.kind === 'question') {
    const text = plain(value.text, COACH_LIMITS.questionChars);
    if (!text || coaching.waiting !== 'question') return null;
    return { kind: 'question', ...(isFormat(value.format) && formatFits(value.format, coaching.template) ? { format: value.format } : {}), ...(value.about === 'format' ? { about: 'format' } : {}), text, ...lines };
  }
  if (value.kind !== 'outline' || coaching.waiting !== 'outline') return null;
  const outline = cleanOutline(value, coaching.format);
  if (!outline) return null;
  const format = formatFits(outline.format, coaching.template) ? outline.format : coaching.format;
  return {
    kind: 'outline', format,
    title: outline.title || titleFrom(thoughtOf(coaching)),
    say: plain(value.say, COACH_LIMITS.questionChars) || DRAFT_LINE,
    beats: formatBeats(format, outline.beats),
    ...lines,
  };
}

/** What YAP says when it hands over another go, and a draft that takes in what the person said after the last one. */
const AGAIN_LINE = 'Here\'s another way to tell it.';
const ADDED_LINE = 'Here\'s the draft with that added.';
/** Why YAP asks for more when the person wanted a draft. */
export const THIN_LINE = 'I need a little more before I can draft this.';

/**
 * The beats of the built-in outline, all of them the person's own words under
 * the format's own labels. The first answer opens, the last one closes when
 * there are three, and everything said between sits in the middle beat. An
 * outline asked for with less than that starts from the thought.
 */
function builtInBeats(format, thought, answers) {
  let lines;
  if (answers.length >= COACH_LIMITS.maxAnswers) lines = [answers[0], [answers[1], ...answers.slice(COACH_LIMITS.maxAnswers)].join(' '), answers[2]];
  else if (answers.length >= COACH_LIMITS.minAnswers) lines = answers;
  else lines = [...thought, ...answers];
  return formatBeats(format.key, lines.map((line) => ({ line })));
}

/**
 * What the built-in coach answers. A question is the next unanswered slot of
 * the format. An outline is the person's own words under the format's labels
 * (see builtInBeats).
 * @param {Coaching} coaching
 * @returns {Reply}
 */
export function builtInReply(coaching) {
  const answers = answersOf(coaching);
  if (coaching.waiting !== 'outline') {
    const format = formatOf(coaching.format);
    const slot = format.slots[Math.min(answers.length, format.slots.length - 1)];
    // Asked a question, YAP says what this part of the format is for, then asks for it again.
    const lastYou = coaching.turns.findLast((turn) => turn.who === 'you');
    if (coaching.thin) return { kind: 'question', text: `${THIN_LINE} ${slot.ask}` };
    if (lastYou && lastYou.about === 'ask') return { kind: 'question', text: `In ${format.article} the ${slot.label.toLowerCase()} is ${slot.hint[0].toLowerCase()}${slot.hint.slice(1).replace(/[.?]$/, '')}. ${slot.ask}` };
    if (answers.length > 0) return { kind: 'question', text: slot.ask };
    // First of all YAP says where this could go and asks how the person would rather tell it.
    const asked = coaching.turns.some((turn) => turn.who === 'yap' && turn.about === 'format');
    if (!coaching.chosen && !asked) return { kind: 'question', about: 'format', text: formatQuestion(coaching.template, coaching.format) };
    const lead = coaching.chosen ? `${format.article[0].toUpperCase()}${format.article.slice(1)}, then.` : `This could be ${format.article}.`;
    return { kind: 'question', text: `${lead} ${slot.ask}` };
  }
  // Another go offers the next format along, so the person sees a different structure.
  const last = coaching.goes > 0 && coaching.outline ? FORMATS.findIndex((format) => format.key === coaching.outline.format) : -1;
  const fits = formatsFor(coaching.template);
  const format = last === -1 ? formatOf(coaching.format) : fits[(fits.findIndex((each) => each.key === coaching.outline.format) + 1) % fits.length];
  return {
    kind: 'outline', format: format.key, title: titleFrom(thoughtOf(coaching)), say: coaching.goes > 0 ? AGAIN_LINE : coaching.added ? ADDED_LINE : DRAFT_LINE,
    beats: builtInBeats(format, sentences(thoughtOf(coaching)), answers),
  };
}

/**
 * The text Claude is given: the formats, the conversation so far and what YAP
 * owes now. The fixed instruction that goes with it lives in server/model.js.
 * @param {Coaching} coaching
 */
export function coachRequestText(coaching) {
  const answers = answersOf(coaching).length;
  const part = keyElementOf(coaching.template);
  const lines = [
    `Headed for: ${coaching.template}.`,
    `Key element: ${part.name}.`,
    'Formats:',
    ...formatsFor(coaching.template).map((format) => `- ${format.key}: ${format.name}. ${format.sub} Beats: ${format.slots.map((slot) => slot.label).join(', ')}.`),
    `Format so far: ${coaching.format} (${coaching.chosen ? 'the person chose it' : 'your suggestion, change it if another fits better'}).`,
    '',
    'Conversation:',
    ...coaching.turns.map((turn) => `${turn.who === 'you' ? 'YOU' : 'YAP'}: ${turn.text}`),
    '',
    `Answers so far: ${answers} of ${COACH_LIMITS.maxAnswers}.`,
  ];
  if (coaching.waiting === 'outline') {
    lines.push('Send now: the outline.');
    if (coaching.goes > 0 && coaching.outline) {
      lines.push(`The person asked for another go. Your last outline was: ${JSON.stringify({ format: coaching.outline.format, title: coaching.outline.title, beats: coaching.outline.beats.map(({ label, line }) => ({ label, line })) })}`);
      lines.push('Use a different format or a different structure this time.');
    }
  } else if (coaching.thin) {
    lines.push('The person asked for the draft, and there is too little here to draft from.');
    lines.push('Send now: one question. Start with one short sentence that says you need more before you can draft, then ask it.');
  } else {
    lines.push('Send now: one question.');
  }
  // Directions are written from the story, so they are asked for once there is some of it.
  if (answers > 0) lines.push(`Send with it: "directions", two of them, for the ${part.name}.`);
  return lines.join('\n');
}

/**
 * Claude's answer read as a reply, or null when it is not one: no JSON object,
 * the wrong kind for what YAP owes, or no words.
 * @param {unknown} text
 * @param {Coaching} coaching
 * @returns {Reply | null}
 */
export function readCoachReply(text, coaching) {
  if (typeof text !== 'string') return null;
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(from, to + 1));
  } catch {
    return null;
  }
  return cleanReply(parsed, coaching);
}

/**
 * The coach's answer to what YAP owes. `askClaude` is given the request text
 * and resolves to Claude's own words, or to null when Claude did not answer.
 * An answer that cannot be read counts as no answer, and the built-in coach
 * answers instead.
 * @param {Coaching} coaching
 * @param {((text: string) => Promise<string | null>) | undefined} askClaude
 * @returns {Promise<{ by: 'claude' | 'built-in', reply: Reply }>}
 */
export async function coachReply(coaching, askClaude) {
  let reply = null;
  if (typeof askClaude === 'function') {
    try {
      reply = readCoachReply(await askClaude(coachRequestText(coaching)), coaching);
    } catch {
      reply = null;
    }
  }
  return reply ? { by: 'claude', reply } : { by: 'built-in', reply: builtInReply(coaching) };
}

/** The beats an accepted outline leaves on the idea: the kept ones, as the idea store keeps a beat. */
export function keptBeatsOf(outline) {
  const beats = outline && Array.isArray(outline.beats) ? outline.beats : [];
  return beats.filter((beat) => beat.keep !== false && beat.line).map((beat, i) => ({ id: `own-${i + 1}`, title: beat.label || `Beat ${i + 1}`, line: beat.line }));
}
