// The format library: what YAP knows about the kinds of video a person can
// make. Pure data and pure functions, no imports, so the page and Node load
// the same file.
//
// Three things live here and nowhere else:
//
//   Template   where the video is headed: a platform and a shape. It decides
//              the key element, the one thing that matters most there (on a
//              YouTube video, the thumbnail).
//   Format     how the story is told. It decides the structure: three slots,
//              each with its label, the question the coach asks to fill it and
//              the words shown until it is filled. It also carries the beats
//              YAP suggests on the beat list and the sparks the front door
//              offers.
//   Direction  one way to do the key element: a short line written for that
//              element (two to four words for a thumbnail, a line to say for
//              an opening, a title for an episode) and, for a thumbnail, the
//              sentence it came from as its caption.
//
// Nothing here writes a fact about the person. A direction's words are cut
// from what they typed. A suggested beat is a prompt for what to say, never a claim.

/** @typedef {{ label: string, ask: string, hint: string }} Slot */
/** @typedef {{ key: string, title: string, line: string }} SuggestedBeat */
/**
 * @typedef {{ key: string, name: string, sub: string, article: string, choice: string,
 *   slots: Slot[], suggestions: SuggestedBeat[], spark: string }} Format
 */
/** @typedef {{ key: string, name: string, platform: string, aspect: string, sub: string, element: string }} Template */
/** @typedef {{ key: 'a' | 'b', name: string, words: string, caption: string }} Direction */

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Where a video is headed. The first is the one YAP suggests when a thought names no other. */
export const TEMPLATES = deepFreeze([
  { key: 'youtube-video', name: 'YouTube video', platform: 'YouTube', aspect: '16:9', sub: 'Deep dives, tutorials, stories', element: 'thumbnail' },
  { key: 'instagram-reel', name: 'Instagram Reel', platform: 'Instagram', aspect: '9:16', sub: 'Short, visual, engaging', element: 'first-seconds' },
  { key: 'youtube-short', name: 'YouTube Short', platform: 'Shorts', aspect: '9:16', sub: 'Quick tips, moments, hooks', element: 'first-seconds' },
  { key: 'tiktok-video', name: 'TikTok video', platform: 'TikTok', aspect: '9:16', sub: 'Trends, insights, behind the scenes', element: 'first-seconds' },
  { key: 'linkedin-video', name: 'LinkedIn video', platform: 'LinkedIn', aspect: '9:16', sub: 'Thought leadership, updates', element: 'first-line' },
  { key: 'podcast', name: 'Audio / Podcast', platform: 'Podcast', aspect: 'Audio', sub: 'Conversations, solo, guests', element: 'episode-title', audio: true },
]);

/**
 * The key element of each kind of template: the heading over its directions,
 * the name it goes by in a sentence, and why it matters most there.
 */
export const KEY_ELEMENTS = deepFreeze({
  thumbnail: { heading: 'Thumbnail ideas', name: 'thumbnail', chip: 'Proposed thumbnail', why: 'On YouTube the thumbnail decides who presses play.' },
  'first-seconds': { heading: 'First three seconds', name: 'opening line', chip: 'Proposed opening', why: 'A short video is kept or swiped in its first three seconds.' },
  'first-line': { heading: 'First line', name: 'first line', chip: 'Proposed first line', why: 'On LinkedIn only the first line shows before the fold.' },
  'episode-title': { heading: 'Episode title', name: 'episode title', chip: 'Proposed title', why: 'A listener picks an episode by its title.' },
});

/** How the story is told. The first is the one YAP suggests when a thought shows no sign of the others. */
export const FORMATS = deepFreeze([
  {
    key: 'talking-head', name: 'Talking head', sub: 'Tell the story to camera.', article: 'a talking head video', choice: 'tell the story to camera',
    slots: [
      { label: 'Opening', ask: 'When did this last happen to you? Give me the one moment.', hint: 'The moment it started.' },
      { label: 'Story', ask: 'What was going on underneath? Say it the way you would tell a friend.', hint: 'What was going on underneath.' },
      { label: 'Closing', ask: 'What should the viewer do or feel when it ends?', hint: 'What do I want to leave the viewer with?' },
    ],
    suggestions: [
      { key: 'why', title: 'Say why it matters', line: 'One line on why this matters to the person watching.' },
      { key: 'step', title: 'Leave them with a first step', line: 'One thing they can do today.' },
    ],
    spark: 'Something I keep putting off is ',
  },
  {
    key: 'vlog', name: 'Vlog', sub: 'Show the moments as they happen.', article: 'a vlog', choice: 'show what happens as you try', filmed: true,
    slots: [
      { label: 'Setting out', ask: 'Where are you, and what are you about to try?', hint: 'Where you are and what you are about to try.' },
      { label: 'Moments', ask: 'Which two or three moments will you show as it happens?', hint: 'The moments to show.' },
      { label: 'Looking back', ask: 'What do you say to camera once it is over?', hint: 'What you say once it is over.' },
    ],
    suggestions: [
      { key: 'before', title: 'Film the before', line: 'Ten seconds of how things look before you start.' },
      { key: 'wrong', title: 'Keep what goes wrong', line: 'The moment it did not go to plan.' },
    ],
    spark: 'Come with me while I try ',
  },
  {
    key: 'walkthrough', name: 'Walkthrough', sub: 'Show how it is done, step by step.', article: 'a walkthrough', choice: 'show how it is done, step by step',
    slots: [
      { label: 'Setup', ask: 'Who is this for, and where are they stuck before they watch?', hint: 'Who it is for and where they are stuck.' },
      { label: 'Steps', ask: 'What are the steps, in the order you do them?', hint: 'The steps, in order.' },
      { label: 'Result', ask: 'What does it look like when it works?', hint: 'What it looks like when it works.' },
    ],
    suggestions: [
      { key: 'result-first', title: 'Show the result first', line: 'Five seconds of the finished thing before step one.' },
      { key: 'mistake', title: 'Name the common mistake', line: 'The step most people get wrong.' },
    ],
    spark: 'The way I ',
  },
  {
    key: 'story', name: 'Story', sub: 'One thing that happened, start to end.', article: 'a story', choice: 'tell one thing that happened, start to end',
    slots: [
      { label: 'Before', ask: 'Where does it start? Set the scene before anything changed.', hint: 'How things were before.' },
      { label: 'Turn', ask: 'What was the moment it turned?', hint: 'The moment it turned.' },
      { label: 'After', ask: 'What is different now because of it?', hint: 'What is different now.' },
    ],
    suggestions: [
      { key: 'stakes', title: 'Say what was at stake', line: 'What you stood to lose.' },
      { key: 'line', title: 'End on one line', line: 'The sentence you want them to repeat.' },
    ],
    spark: 'The day I almost ',
  },
  {
    key: 'tips', name: 'Tips', sub: 'A few things worth knowing, fast.', article: 'a tips video', choice: 'share a few things worth knowing',
    slots: [
      { label: 'Hook', ask: 'Who needs these, and what does it cost them not to know?', hint: 'Who needs this and why.' },
      { label: 'Tips', ask: 'What are the tips? Keep them short, strongest first.', hint: 'The tips, strongest first.' },
      { label: 'Takeaway', ask: 'If they remember one thing, which is it?', hint: 'The one thing to remember.' },
    ],
    suggestions: [
      { key: 'proof', title: 'Give one proof', line: 'The time one of these tips paid off for you.' },
      { key: 'first', title: 'Say which to try first', line: 'The tip to start with today.' },
    ],
    spark: 'Three mistakes I made when ',
  },
]);

export const isFormat = (key) => FORMATS.some((format) => format.key === key);
export const isTemplate = (key) => TEMPLATES.some((template) => template.key === key);

/** The format a key names; the first format for a key nobody has. */
export function formatOf(key) {
  return FORMATS.find((format) => format.key === key) || FORMATS[0];
}

/** The format a name names ("Talking head"), or null. */
export function formatNamed(name) {
  const wanted = String(name || '').trim().toLowerCase();
  return FORMATS.find((format) => format.name.toLowerCase() === wanted) || null;
}

/** The template a key names; the first template for a key nobody has. */
export function templateOf(key) {
  return TEMPLATES.find((template) => template.key === key) || TEMPLATES[0];
}

/** The formats a template can be told in: a format that has to be filmed is no way to tell something that is only heard. */
export function formatsFor(templateKey) {
  return templateOf(templateKey).audio ? FORMATS.filter((format) => !format.filmed) : FORMATS;
}

/** True when the format can be used where the template is headed. */
export const formatFits = (formatKey, templateKey) => formatsFor(templateKey).some((format) => format.key === formatKey);

/** The key element of a template. */
export function keyElementOf(templateKey) {
  return KEY_ELEMENTS[templateOf(templateKey).element];
}

const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

const FORMAT_SIGNS = Object.freeze([
  ['tips', /\b(?:\d+|three|four|five|six|seven|ten) (?:tips|ways|things|mistakes|lessons|habits|rules|reasons)\b|\btips?\b|\bmistakes\b|\blessons\b/i],
  ['walkthrough', /\bhow (?:to|i|we|you)\b|\bstep(?:s| by step)?\b|\btutorial\b|\bwalk ?through\b|\bset ?up\b|\bguide\b|\bworkflow\b|\bprocess\b|\bdemo\b|\brecipe\b/i],
  ['vlog', /\bvlog\b|\bday in (?:the|my) life\b|\bcome with me\b|\bbehind the scenes\b|\bas i try\b/i],
  ['story', /\bthe (?:day|time|night|moment|year) (?:i|we)\b|\bwhen i\b|\bonce\b|\blast (?:week|month|year|night|summer|winter)\b|\byesterday\b|\bstory\b|\bhappened\b|\bi (?:quit|moved|lost|failed)\b/i],
]);

/** The format a thought reads like. A thought with no sign of the others is told to camera. */
export function suggestFormat(thought) {
  const text = oneLine(thought);
  const found = FORMAT_SIGNS.find(([, sign]) => sign.test(text));
  return found ? found[0] : FORMATS[0].key;
}

const TEMPLATE_SIGNS = Object.freeze([
  ['youtube-short', /\b(?:youtube )?shorts?\b/i],
  ['instagram-reel', /\breels?\b|\binstagram\b|\binsta\b/i],
  ['tiktok-video', /\btik ?tok\b/i],
  ['linkedin-video', /\blinked ?in\b/i],
  ['podcast', /\bpodcast\b|\bepisode\b|\baudio only\b/i],
]);

/** Where a thought says it is headed. A thought that names no place is a YouTube video. */
export function suggestTemplate(thought) {
  const text = oneLine(thought);
  const found = TEMPLATE_SIGNS.find(([, sign]) => sign.test(text));
  return found ? found[0] : TEMPLATES[0].key;
}

/** The format offered beside the suggested one: the first of the others. */
export function otherFormat(suggestedKey) {
  return FORMATS.find((format) => format.key !== formatOf(suggestedKey).key);
}

/** YAP's first question: where this could go, and the choice between the suggested format and the one beside it. */
export function formatQuestion(templateKey, suggestedKey) {
  const template = templateOf(templateKey);
  const suggested = formatOf(suggestedKey);
  const article = /^[aeiou]/i.test(template.name) ? 'an' : 'a';
  return `This could be ${article} ${template.name}. Would you rather ${suggested.choice}, or ${otherFormat(suggested.key).choice}?`;
}

const YES = /^(?:yes|yep|yeah|yup|sure|ok(?:ay)?|sounds good|that works|go with that|let'?s do (?:that|it)|do that|the first(?: one)?)\b/i;
const FORMAT_WORDS = Object.freeze([
  ['talking-head', /\btalking[- ]head\b|\bto (?:the )?camera\b|\btell (?:it|the story)\b/i],
  ['vlog', /\bvlog\b|\bshow (?:it|what happens|the moments)\b|\bas (?:i|it) (?:try|happens?)\b/i],
  ['walkthrough', /\bwalk ?through\b|\bstep by step\b|\btutorial\b/i],
  ['story', /\b(?:as )?a story\b|\bstart to end\b/i],
  ['tips', /\btips\b|\ba list\b/i],
]);
/** A reply this short or shorter can be an answer about the format; a longer one is the person telling their story. */
const FORMAT_ANSWER_MAX_WORDS = 12;

/**
 * What a reply to YAP's format question chooses: a format key, or null when
 * the reply is not about the format at all. "Yes" takes the suggested format.
 * A long reply is the person's story, whatever words it holds.
 */
export function readFormatAnswer(text, suggestedKey) {
  const reply = oneLine(text);
  if (!reply || reply.split(' ').length > FORMAT_ANSWER_MAX_WORDS) return null;
  const named = FORMAT_WORDS.find(([, words]) => words.test(reply));
  if (named) return named[0];
  return YES.test(reply) ? formatOf(suggestedKey).key : null;
}

/** The template a reply names ("YouTube, talking head"), or null. */
export function readTemplateAnswer(text) {
  const reply = oneLine(text);
  if (/\byoutube\b/i.test(reply) && !/\bshorts?\b/i.test(reply)) return 'youtube-video';
  const found = TEMPLATE_SIGNS.find(([, sign]) => sign.test(reply));
  return found ? found[0] : null;
}

/** A direction's caption is at most this long. */
export const DIRECTION_CHARS = 72;
/** The fewest and the most words of a thumbnail's line. */
export const THUMB_WORDS = Object.freeze({ min: 2, max: 4 });
/** The most words of a line to say or to write first, and of an episode title. */
const LINE_WORDS = 12;
const TITLE_WORDS = 6;

/** A person's sentence short enough to stand as a caption: its first sentences that fit, cut at a word when even one is too long. */
function shortWords(text) {
  const whole = oneLine(text);
  if (whole.length <= DIRECTION_CHARS) return whole;
  let kept = '';
  for (const sentence of whole.split(/(?<=[.!?])\s+/)) {
    if (`${kept} ${sentence}`.trim().length > DIRECTION_CHARS) break;
    kept = `${kept} ${sentence}`.trim();
  }
  if (kept) return kept;
  const cut = whole.slice(0, DIRECTION_CHARS);
  const end = cut.lastIndexOf(' ');
  const words = (end > 0 ? cut.slice(0, end) : cut).split(' ');
  // A caption never stops on "and" or "the".
  while (words.length > 1 && WEAK.has(bare(words.at(-1)).toLowerCase())) words.pop();
  return words.join(' ').replace(/[,;:\s]+$/, '');
}

/**
 * The caption under a thumbnail's line: the sentence the line was cut from.
 * A sentence too long for a caption gives the part of it that holds the line.
 */
function captionFor(text, line) {
  const holds = (part) => part.toLowerCase().includes(line.toLowerCase());
  const sentence = oneLine(text).split(/(?<=[.!?])\s+/).find(holds) || oneLine(text);
  if (sentence.length <= DIRECTION_CHARS) return sentence;
  const clauses = sentence.split(/(?<=,)\s+/);
  let at = clauses.findIndex(holds);
  if (at === -1) return shortWords(sentence);
  let kept = clauses[at];
  while (at + 1 < clauses.length && `${kept} ${clauses[at + 1]}`.length <= DIRECTION_CHARS) {
    at += 1;
    kept = `${kept} ${clauses[at]}`;
  }
  kept = kept.replace(/^(?:and then|and|but|so|then)\s+/i, '').replace(/[,;:\s]+$/, '');
  return kept.length > DIRECTION_CHARS ? shortWords(kept) : kept[0].toUpperCase() + kept.slice(1);
}

/** Words a short line neither starts nor ends on. */
const WEAK = new Set(('a an the to of in on at for and or but my your our their his her its i we you they he she it me us them is am are was were be been being '
  + 'that this these those with then just so as if when while would could should will can do did does had have has about into from by than very really there here '
  + "i've i'm i'd i'll it's that's").split(' '));
/** Words that carry the turn of a story. A line that holds one is the stronger line. */
const STRONG = /^(?:never|not|no|nothing|nobody|stop(?:ped)?|quit|afraid|scared|ashamed|wrong|bad|worst|fail(?:ed)?|lost|hate|can't|cannot|won't|didn't|don't|couldn't|finally|truth|mistake)$/i;
const CLAUSE_END = /[.!?;:,]+\s+|\s+(?:and then|and|but|so|because|then|while|before|after|until)\s+/i;
const bare = (word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** The clauses of a text, each as its words. */
function clausesOf(text) {
  return oneLine(text).split(CLAUSE_END).map((clause) => clause.split(' ').map(bare).filter(Boolean)).filter((words) => words.length > 0);
}

/**
 * A short line cut from a person's own words: the run of `min` to `max` words
 * that reads strongest. A run starts and ends on a word that carries weight,
 * is better for holding the turn of the story ("never", "stopped"), and is
 * better at the end of a clause, where a sentence lands. `taken` are lines
 * already used, so two directions never say the same thing.
 */
function cutLine(text, { min, max }, taken = []) {
  const used = taken.map((line) => line.toLowerCase());
  let best = null;
  clausesOf(text).forEach((words) => {
    for (let length = Math.min(max, words.length); length >= min; length -= 1) {
      for (let from = 0; from + length <= words.length; from += 1) {
        const run = words.slice(from, from + length);
        if (WEAK.has(run[0].toLowerCase()) || WEAK.has(run.at(-1).toLowerCase())) continue;
        const line = run.join(' ');
        if (used.includes(line.toLowerCase())) continue;
        const atStart = from === 0;
        const atEnd = from + length === words.length;
        const score = run.filter((word) => STRONG.test(word)).length * 2.5 + (atStart ? 1 : 0) + (atEnd ? 1.5 : 0) + (atStart && atEnd ? 1 : 0) + (length >= 3 ? 0.5 : 0);
        if (!best || score > best.score) best = { line, score };
      }
    }
  });
  if (best) return best.line;
  // Nothing reads as a line of its own: the first words stand, when they are not already used.
  const first = oneLine(text).split(' ').map(bare).filter(Boolean).slice(0, max).join(' ');
  return used.includes(first.toLowerCase()) ? '' : first;
}

/** A line to say or to write first: the person's first sentence when it is short, or its opening clauses that fit. */
function firstLine(text) {
  const sentence = oneLine(text).split(/(?<=[.!?])\s+/)[0] || '';
  const count = (part) => part.split(' ').filter(Boolean).length;
  if (count(sentence) <= LINE_WORDS) return sentence;
  let kept = '';
  for (const clause of sentence.split(/(?<=,)\s+|\s+(?=(?:and|but|so|because|then|while|before|after|until)\s)/i)) {
    if (count(`${kept} ${clause}`) > LINE_WORDS) break;
    kept = `${kept} ${clause}`.trim();
  }
  kept = kept.replace(/[,;:\s]+$/, '');
  if (!kept) {
    const words = sentence.split(' ').slice(0, LINE_WORDS);
    while (words.length > 1 && WEAK.has(bare(words.at(-1)).toLowerCase())) words.pop();
    kept = words.join(' ').replace(/[,;:\s]+$/, '');
  }
  return /[.!?]$/.test(kept) ? kept : `${kept}.`;
}

const SMALL = new Set('a an the to of in on at for and or but with from by as'.split(' '));
/** A line set as a title is set: each word capitalised but the small ones inside it. */
function titleCase(line) {
  return line.split(' ').map((word, i) => (i > 0 && SMALL.has(word.toLowerCase()) ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1))).join(' ');
}

/** A direction's line for one kind of key element, cut from the person's own words. */
function lineFor(element, text, taken) {
  if (element === 'thumbnail') return cutLine(text, THUMB_WORDS, taken);
  if (element === 'episode-title') return titleCase(cutLine(text, { min: 3, max: TITLE_WORDS }, taken) || cutLine(text, { min: 1, max: TITLE_WORDS }, taken));
  const line = firstLine(text);
  return taken.some((used) => used.toLowerCase() === line.toLowerCase()) ? '' : line;
}

/**
 * The directions for an idea's key element, written for that element from the
 * person's own words: one from the title and one from the moment they gave
 * first. A direction exists only once its words do, so a new idea has one and
 * a told story has two. A thumbnail's direction also carries its caption, the
 * sentence the line was cut from.
 * @param {{ title?: string, answers?: string[], element?: string }} idea
 * @returns {Direction[]}
 */
export function keyDirections({ title = '', answers = [], element = 'thumbnail' } = {}) {
  const sources = [oneLine(title), answers.map(oneLine).filter(Boolean)[0] || ''];
  const directions = [];
  sources.forEach((source, i) => {
    if (!source) return;
    const words = lineFor(element, source, directions.map((direction) => direction.words));
    if (!words) return;
    const key = directions.length === 0 ? 'a' : 'b';
    directions.push({ key, name: `Direction ${key.toUpperCase()}`, words, caption: element === 'thumbnail' ? captionFor(source, words) : '' });
  });
  return directions;
}

/** The id a suggested beat goes by on the beat list. */
export const suggestionId = (key) => `yap-${key}`;
/** True for the id of a beat YAP suggested. */
export const isSuggestionId = (id) => typeof id === 'string' && id.startsWith('yap-');

/**
 * The beats YAP suggests for an idea in a format: the person's first thought
 * when no beat says it yet, then the format's own. Each is a row of the beat
 * list, never kept until the person accepts it.
 * @param {{ format?: string, thought?: string, lines?: string[] }} idea `lines` are the beats the idea already has
 * @returns {{ id: string, title: string, line: string, source: 'suggestion', state: 'suggested' }[]}
 */
export function suggestedBeats({ format, thought = '', lines = [] } = {}) {
  const have = lines.map((line) => oneLine(line).toLowerCase());
  const first = oneLine(thought).split(/(?<=[.!?])\s+/)[0] || '';
  const beats = [];
  if (first && first.length <= 160 && !have.some((line) => line.includes(first.toLowerCase().replace(/[.!?]+$/, '')))) {
    beats.push({ key: 'thought', title: 'Open with your first thought', line: first });
  }
  beats.push(...(formatNamed(format) || formatOf(format)).suggestions);
  return beats.map((beat) => ({ id: suggestionId(beat.key), title: beat.title, line: beat.line, source: 'suggestion', state: 'suggested' }));
}

/** The front door's sparks: one sentence to finish for each format, in the library's order. */
export const SPARKS = Object.freeze(FORMATS.map((format) => Object.freeze({ format: format.key, name: format.name, text: format.spark })));
