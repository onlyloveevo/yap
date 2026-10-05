// The three idea screens, wired: the first conversation, the shaping screen and
// the draft to confirm. The server picks the screen from the idea's state; this
// module draws the saved conversation into it and runs the coach.
//
// The coach's rules live in src/engine/idea-coach.js. This file asks for a
// reply (the person's own Claude Code through /api/model, the built-in coach
// when Claude does not answer), posts it to the saved conversation, and draws
// what comes back. A reply is made for one moment of the conversation: when the
// person has moved on before it lands, it is dropped.
//
// What the format library decides is drawn from it and from nowhere else: the
// template row and the format cards of the first conversation, the structure
// and the key element's directions of the shaping screen. The optional
// experiments are read from Review (the carried lesson and the running wording
// trials) and never changed here: adding one writes it onto this idea only.
//
// An idea in progress is kept in Create: every move between the three screens
// goes through the coach's `place` event, which keeps the idea listed and
// records the screen it opens on. Save idea therefore never loses an idea, and
// with too little to draft from YAP asks for more on the shaping screen.
//
// Every word is written with textContent. The only markup built here is the
// format icons, which are fixed strings of this file.
import { wireNav, go, sayQuietly, isShellMode } from './app.js';
import { APP_API, getIdea, getMemory, getTrials, patchIdea } from './api.js';
import { dictateInto } from './dictate.js';
import { matchRoute, routeFor } from './routes.js';
import { installOwnIdeaStyle } from './own-idea-style.js';
import { lessonStore } from './return-model.js';
import { COACH_BY, COACH_LIMITS, FORMATS, TEMPLATES, answersOf, coachReply, directionsOf, formatOf, titleFrom } from '../../src/engine/idea-coach.js';
import { formatsFor, keyElementOf, suggestTemplate, templateOf } from '../../src/engine/formats.js';
import { statusLine } from '../../src/engine/experiments.js';

const hook = (id) => document.querySelector(`[data-testid="${id}"]`);
const SERVER_LINE = 'YAP could not save that. Your words are still here.';
/** A little longer than the server gives Claude, so the server's own answer arrives first. */
const CLAUDE_WAIT_MS = 26000;
/** The hooks of the confirm screen's rows: the shell's three, then the rows added for a longer outline. */
const POINT_HOOKS = Object.freeze(['point-opening', 'point-story', 'point-closing', 'point-4', 'point-5']);
const STORY_HOOKS = Object.freeze(['beat-opening', 'beat-story', 'beat-closing', 'beat-4', 'beat-5']);

/** The colour of each platform's badge on the template row. */
const PLATFORM_COLOURS = Object.freeze({ YouTube: '#f0302f', Shorts: '#f0302f', Instagram: '#d6249f', TikTok: '#25262b', LinkedIn: '#0a66c2', Podcast: '#8e44ec' });
/** The sample idea's two thumbnails are pictures made for it; every other idea's directions are set in type. */
const SAMPLE_ID = 'sample';
const SAMPLE_THUMBS = Object.freeze([
  Object.freeze({ key: 'a', name: 'Direction A', words: 'Why I waited', caption: 'Why I keep putting off filming', picture: 'assets/thumb-a.png' }),
  Object.freeze({ key: 'b', name: 'Direction B', words: 'Never hit record', caption: 'I planned for hours. I never hit record.', picture: 'assets/thumb-b.png' }),
]);
/** The one quiet line under YAP's question on the first screen. */
const TOGETHER_LINE = 'We can work that out together.';
/** What the shaping screen says of an idea whose draft could not be made yet. */
const KEPT_LINE = 'Your idea is in Create. YAP needs a little more to draft it.';
/** Wording trials that are still being tried. */
const RUNNING = Object.freeze(['accepted', 'running', 'check-in due']);

/**
 * Talk to YAP: dictate into a box, and say so on the button at once. While YAP
 * listens the button reads "Listening" and a press stops it. The line for a
 * missing or refused microphone is the dictation's own, shown on the page.
 * @param {HTMLInputElement | HTMLTextAreaElement} box
 * @param {HTMLElement} control the Talk to YAP button
 */
export function talkInto(box, control) {
  if (!control.dataset.talkLabel) {
    const label = [...control.childNodes].reverse().find((node) => node.textContent.trim());
    control.dataset.talkLabel = label.textContent.trim();
    // The button follows the dictation: it reads Listening for exactly as long as YAP listens.
    new MutationObserver(() => {
      const on = control.getAttribute('aria-pressed') === 'true';
      label.textContent = on ? 'Listening. Tap to stop' : control.dataset.talkLabel;
      control.classList.toggle('listening', on);
    }).observe(control, { attributes: true, attributeFilter: ['aria-pressed'] });
    const pulse = document.createElement('style');
    pulse.textContent = '@keyframes talk-pulse { 0%, 100% { box-shadow:0 0 0 0 rgba(244,198,107,.5); } 50% { box-shadow:0 0 0 9px rgba(244,198,107,0); } } .listening { animation:talk-pulse 1.4s ease-out infinite; } @media (prefers-reduced-motion: reduce) { .listening { animation:none; outline:2px solid var(--amber); outline-offset:3px; } }';
    document.head.append(pulse);
  }
  const listening = dictateInto(box, { control });
  if (listening) box.focus();
  return listening;
}

/**
 * The experiments Review has to offer an idea: the lesson the person chose to
 * carry (their own, and the sample review's) and each wording trial still
 * running. Read only. A store that cannot be read offers nothing.
 * @returns {Promise<{ id: string, title: string, from: string }[]>}
 */
export async function reviewOffers() {
  const offers = [];
  const memory = async () => {
    const got = await getMemory();
    return got && got.memory ? got.memory : got;
  };
  const lessons = [['own', () => lessonStore({ sample: false, getMemory: memory, saveMemory: async () => {} }).read()], ['sample', () => lessonStore({ sample: true, storage: localStorage }).read()]];
  for (const [name, read] of lessons) {
    try {
      const lesson = await read();
      if (lesson) offers.push({ id: `lesson-${name}`, title: lesson.text, from: `Review · ${lesson.source.title}` });
    } catch {
      // Nothing to offer from here.
    }
  }
  try {
    const got = await getTrials();
    const trials = Array.isArray(got) ? got : (got && (got.trials || got.experiments)) || [];
    for (const trial of trials) {
      if (!trial || !RUNNING.includes(trial.status) || !trial.change) continue;
      offers.push({ id: `trial-${trial.id}`, title: `Say “${trial.change.to}” in place of “${trial.change.from}”`, from: `Live · ${statusLine(trial)}` });
    }
  } catch {
    // Nothing to offer from here.
  }
  return offers;
}

const FORMAT_ICONS = Object.freeze({
  'talking-head': '<circle cx="9" cy="6.5" r="3.5"/><path d="M3.5 21v-3.5a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3V21z"/><path d="m15 17 5-2.5v6L15 18"/>',
  vlog: '<rect x="2.5" y="6" width="14" height="12" rx="3"/><path d="m16.5 10.5 5-2.5v8l-5-2.5"/>',
  story: '<path d="M12 6.5c-2-1.4-4.6-2-8-2v13c3.4 0 6 .6 8 2 2-1.4 4.6-2 8-2v-13c-3.4 0-6 .6-8 2zM12 6.5v13"/>',
  walkthrough: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8 20.5h8M12 17v3.5M10 8.5l4.5 2.5-4.5 2.5z"/>',
  tips: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="2.6"/>',
});

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

function formatIcon(key) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.innerHTML = FORMAT_ICONS[key] || FORMAT_ICONS['talking-head'];
  return icon;
}

/** One request to the saved conversation: a read, or one event. */
async function coachCall(id, event) {
  const init = { mode: 'same-origin', credentials: 'same-origin', cache: 'no-store' };
  if (event) Object.assign(init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  const res = await fetch(`${APP_API}idea-coach/${id}`, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/** Claude's own words for a request, or null when Claude did not answer in time. */
async function askClaude(text) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), CLAUDE_WAIT_MS);
  try {
    const res = await fetch('/api/model', { method: 'POST', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'idea-coach', text }), signal: stop.signal });
    if (!res.ok) return null;
    const answer = await res.json();
    return answer && answer.source === 'claude-code' && typeof answer.text === 'string' ? answer.text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Shell mode: the drawn screen. Nothing is saved, and a press only notes where it would lead. */
function wireShell(stage, id) {
  const self = () => routeFor('idea', { id });
  let busy = false;
  async function change(patch, destination) {
    if (busy) return false;
    busy = true;
    try {
      await patchIdea(id, patch);
      if (destination) go(destination);
      return true;
    } catch (err) {
      sayQuietly(document, err.message);
      return false;
    } finally {
      busy = false;
    }
  }
  document.addEventListener('yap:talk', () => dictateInto(hook('idea-input'), { control: hook('talk-to-yap') }));
  document.addEventListener('yap:idea-message', async (event) => {
    const text = event.detail?.text?.trim();
    if (!text) return;
    if (await change({ message: text, ...(stage === 'conversation' ? { state: 'shaping' } : {}) }, stage === 'conversation' ? self() : null)) {
      hook('idea-input').value = '';
      hook('send').disabled = true;
    }
  });
  document.addEventListener('yap:idea-keep-exploring', () => (stage === 'concept' ? hook('idea-input').focus() : change({ state: 'shaping' }, self())));
  document.addEventListener('yap:idea-save-thought', () => change({ state: 'thought' }, '/create'));
  document.addEventListener('yap:idea-save', () => change({ state: 'confirming' }, self()));
  document.addEventListener('yap:idea-confirm', (event) => change({ state: 'saved', ticks: event.detail?.points || {} }, '/create'));
  for (const [name, format] of [['format-vlog', 'Vlog'], ['format-talking-head', 'Talking head']]) hook(name)?.addEventListener('click', () => change({ format }));
  for (const name of ['thumb-a', 'thumb-b']) hook(name)?.addEventListener('click', () => change({ thumb: name }));
}

function wireLive(stage, id) {
  const self = () => routeFor('idea', { id });
  const input = hook('idea-input');
  const sendButton = hook('send');
  const thread = document.querySelector('.thread');
  // The mark the shell draws beside YAP's own lines.
  const mark = thread.querySelector('svg');
  const panel = hook('idea-panel');

  let idea = null;
  /** @type {import('../../src/engine/idea-coach.js').Coaching} */
  let coaching = null;
  /** The outline as the person sees it on the confirm screen: their edits, before the server has them. */
  let draft = null;
  let ready = false;
  let busy = false;
  let leaving = false;
  /** The rev the coach is answering for, or null. */
  let asking = null;
  let editing = false;
  let allFormats = false;
  /** Shaping: is the right-hand column the format picker (after Change) or the key element's directions? */
  let picking = false;
  /** What Review has to offer this idea. */
  let offers = [];
  /** Shaping: is the story open for editing (after Edit story)? */
  let editingStory = false;

  document.documentElement.dataset.ownIdea = 'true';
  installOwnIdeaStyle(document);
  // Home and Grow open nothing, so they are not offered here.
  for (const name of ['nav-home', 'nav-grow']) if (hook(name)) hook(name).hidden = true;

  const thought = () => (coaching.turns.find((turn) => turn.who === 'you') || { text: idea.title }).text;

  // ---- The conversation, on the left of every stage.

  function message(who, body) {
    const you = who === 'you';
    if (stage === 'conversation') {
      const line = element('div', you ? 'msg-you' : 'msg-yap');
      if (you) {
        line.append(element('p', 'label', 'You'), body);
        body.classList.add('text');
        return line;
      }
      const wrap = element('div', 'body');
      body.classList.add('text');
      wrap.append(body);
      line.append(mark.cloneNode(true), element('p', 'label', 'YAP'), wrap);
      return line;
    }
    const line = element('div', you ? 'msg you' : 'msg yap');
    const speaker = element(stage === 'confirm' ? 'span' : 'p', 'who', you ? (stage === 'confirm' ? 'YOU' : 'You') : 'YAP');
    if (you) line.append(speaker, body);
    else if (stage === 'confirm') {
      const wrap = element('div');
      wrap.append(speaker, body);
      line.append(mark.cloneNode(true), wrap);
    } else line.append(mark.cloneNode(true), speaker, body);
    return line;
  }

  function thinking() {
    const dots = element('p', 'thinking');
    dots.dataset.testid = 'coach-thinking';
    dots.setAttribute('role', 'status');
    dots.setAttribute('aria-label', 'YAP is thinking');
    dots.append(element('i'), element('i'), element('i'));
    return message('yap', dots);
  }

  function renderThread() {
    const lines = coaching.turns.map((turn) => {
      const words = element('p', '', turn.text);
      if (turn.about) words.dataset.about = turn.about;
      return message(turn.who, words);
    });
    // The first screen has one quiet line, under YAP's latest question, the same on every turn.
    const asked = stage === 'conversation' ? lines.findLast((line) => line.classList.contains('msg-yap')) : null;
    if (asked) asked.querySelector('.body').append(element('p', 'quiet', TOGETHER_LINE));
    if (coaching.waiting) lines.push(thinking());
    const by = element('p', 'coach-by', COACH_BY[coaching.by] || '');
    by.dataset.testid = 'idea-provenance';
    by.hidden = !coaching.by;
    thread.replaceChildren(...lines, by);
    thread.scrollTop = thread.scrollHeight;
    thread.classList.toggle('scrolled', thread.scrollTop > 2);
  }

  // ---- Formats: two cards on the first screen, a column on the shaping screen.

  function formatButton(format, className, withPill) {
    const button = element('button', className);
    button.type = 'button';
    button.dataset.testid = `format-${format.key}`;
    button.setAttribute('aria-pressed', String(format.key === coaching.format));
    const words = element('span', 'txt');
    if (withPill) words.append(element('span', 'pill', 'Suggested'));
    words.append(element('span', 't', format.name), element('span', 's', format.sub));
    button.append(formatIcon(format.key), words);
    button.addEventListener('click', () => pick(format.key));
    return button;
  }

  function renderConversation() {
    hook('idea-status').textContent = 'Exploring';
    hook('starting-thought').textContent = `“${titleFrom(thought()) || thought()}”`;
    const template = templateOf(coaching.template);
    hook('template-name').textContent = template.name;
    hook('template-suggested').hidden = template.key !== suggestTemplate(thought());
    hook('template-select').querySelector('.badge').style.background = PLATFORM_COLOURS[template.platform];
    const suggested = formatOf(coaching.suggested);
    // Only the formats that fit where the video is headed: nothing that has to be filmed for something only heard.
    const fits = formatsFor(coaching.template);
    const pair = [fits.find((format) => format.key !== suggested.key), suggested];
    const all = allFormats || !pair.some((format) => format.key === coaching.format);
    const cards = document.querySelector('.formats');
    cards.classList.toggle('all', all);
    cards.replaceChildren(...(all ? fits : pair).map((format) => formatButton(format, format.key === suggested.key ? 'fmt th' : 'fmt', format.key === suggested.key)));
    hook('more-formats').hidden = all;
  }

  /** The template row's menu: every place a video can be headed. */
  function toggleTemplates() {
    const open = hook('template-menu');
    const row = hook('template-select');
    if (open) {
      open.remove();
      row.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = element('div', 'tpl-menu');
    menu.dataset.testid = 'template-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Template');
    for (const template of TEMPLATES) {
      const option = element('button', 'tpl-option');
      option.type = 'button';
      option.dataset.testid = `template-${template.key}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(template.key === coaching.template));
      const dot = element('span', 'dot');
      dot.style.background = PLATFORM_COLOURS[template.platform];
      option.append(dot, element('span', 't', template.name), element('span', 's', template.sub), element('span', 'a', template.aspect));
      option.addEventListener('click', async () => {
        menu.remove();
        row.setAttribute('aria-expanded', 'false');
        if (template.key !== coaching.template) await send({ type: 'template', template: template.key });
        row.focus();
      });
      menu.append(option);
    }
    row.after(menu);
    // The menu lies over the format cards, under the row it belongs to.
    Object.assign(menu.style, { top: `${row.offsetTop + row.offsetHeight + 6}px`, left: `${row.offsetLeft}px`, width: `${row.offsetWidth}px` });
    row.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-selected="true"]').focus();
  }

  // ---- Shaping: the key element's directions, the format picker, and the experiments from Review.

  /** A thumbnail set in type: the direction's short line, large, its last words in amber. */
  function typeCard(words) {
    const all = words.split(' ');
    const top = all.slice(0, Math.max(1, Math.ceil(all.length / 2)));
    const set = element('span', 'tw');
    set.append(element('span', 'l1', top.join(' ')));
    if (all.length > top.length) set.append(element('span', 'l2', all.slice(top.length).join(' ')));
    return set;
  }

  /** Type on a thumbnail is as large as its card takes. */
  function fitType() {
    for (const set of document.querySelectorAll('.thumb.type .tw')) {
      const card = set.parentElement;
      let size = Math.round(card.clientHeight * 0.3);
      set.style.fontSize = `${size}px`;
      while (size > 14 && (set.scrollWidth > card.clientWidth * 0.84 || set.scrollHeight > card.clientHeight * 0.8)) {
        size -= 2;
        set.style.fontSize = `${size}px`;
      }
    }
  }

  /** The right-hand column: the directions for the template's key element, or the formats after Change. */
  function renderColumn() {
    const column = document.querySelector('.thumbs');
    const heading = hook('thumbs-label');
    column.classList.toggle('pictures', !picking && templateOf(coaching.template).element === 'thumbnail');
    if (picking) {
      heading.textContent = 'Format';
      const headed = element('p', 'eyebrow tiny headed', 'Headed for');
      const places = element('div', 'places');
      for (const template of TEMPLATES) {
        const place = element('button', 'place', template.name);
        place.type = 'button';
        place.dataset.testid = `template-${template.key}`;
        place.setAttribute('aria-pressed', String(template.key === coaching.template));
        place.addEventListener('click', async () => {
          // A draft made for a format that does not fit the new place is drafted again.
          if (await send({ type: 'template', template: template.key })) pump();
        });
        places.append(place);
      }
      column.replaceChildren(heading, ...formatsFor(coaching.template).map((format) => formatButton(format, 'fpick', false)), headed, places);
      return;
    }
    const part = keyElementOf(coaching.template);
    const thumbnail = templateOf(coaching.template).element === 'thumbnail';
    heading.textContent = part.heading;
    const directions = thumbnail && id === SAMPLE_ID ? SAMPLE_THUMBS : directionsOf(coaching);
    const cards = directions.flatMap((direction) => {
      const label = element('p', 'dir', direction.name);
      label.dataset.testid = `thumb-${direction.key}-label`;
      const card = element('button', `thumb ${direction.picture ? 'pic' : thumbnail ? 'type' : 'line'}`);
      card.type = 'button';
      card.dataset.testid = `thumb-${direction.key}`;
      card.setAttribute('aria-pressed', String(coaching.pick === direction.key));
      card.setAttribute('aria-label', `${direction.name}: ${direction.words}`);
      if (direction.picture) {
        const picture = element('img');
        picture.src = direction.picture;
        picture.alt = `${direction.words} thumbnail`;
        card.append(picture);
      } else card.append(thumbnail ? typeCard(direction.words) : element('span', 'ln', direction.words));
      card.addEventListener('click', () => send({ type: 'pick', pick: coaching.pick === direction.key ? '' : direction.key }));
      if (!direction.caption) return [label, card];
      const caption = element('p', 'cap', direction.caption);
      caption.dataset.testid = `thumb-${direction.key}-caption`;
      return [label, card, caption];
    });
    // Why this element, said once where the heading alone does not say it. A thumbnail needs no telling.
    const why = element('p', 'why', part.why);
    why.dataset.testid = 'key-element-why';
    // The second direction is cut from the moment the person tells YAP, so it is not there before they have.
    const more = directions.length < 2 ? [element('p', 'why', 'Direction B comes from the moment you tell YAP.')] : [];
    column.replaceChildren(heading, ...(thumbnail ? [] : [why]), ...cards, ...more);
    fitType();
  }

  /** The story fits its column: when it would run under the edge, its boxes tighten, then show their first lines. */
  function fitStory() {
    const story = document.querySelector('.story');
    story.dataset.fit = '0';
    if (editingStory) return;
    for (const level of ['1', '2', '3']) {
      if (story.scrollHeight <= story.clientHeight + 1) break;
      story.dataset.fit = level;
    }
  }

  /** The optional experiments: what Review offers and what this idea already carries, each to add or take off. */
  function renderExperiments() {
    const added = coaching.experiments;
    const all = [...added, ...offers.filter((offer) => !added.some((each) => each.id === offer.id))];
    const card = hook('experiment');
    const list = hook('experiment-list');
    card.hidden = all.length === 0;
    list.hidden = all.length === 0 || card.getAttribute('aria-expanded') !== 'true';
    if (all.length === 0) return;
    hook('experiment-chip').textContent = added.length > 0 ? 'Added' : 'Proposed';
    hook('experiment-title').textContent = all[0].title;
    list.replaceChildren(...all.map((each, i) => {
      const on = added.some((kept) => kept.id === each.id);
      const row = element('div', 'exp-row');
      row.dataset.testid = `experiment-row-${i + 1}`;
      const words = element('span', 'exp-words');
      words.append(element('span', 't', each.title), element('span', 's', each.from));
      const button = element('button', 'small', on ? 'Remove' : 'Add to this idea');
      button.type = 'button';
      button.dataset.testid = `experiment-${on ? 'remove' : 'add'}-${i + 1}`;
      button.addEventListener('click', () => send({ type: 'experiment', ...(on ? { remove: each.id } : { add: each }) }));
      row.append(words, button);
      return row;
    }));
  }

  function renderConcept() {
    const format = formatOf(coaching.format);
    hook('idea-status').textContent = 'Working draft';
    // The sample idea says so once, quietly, beside its status.
    if (id === SAMPLE_ID && !hook('sample-tag')) {
      const tag = element('span', 'sample-tag', 'Sample');
      tag.dataset.testid = 'sample-tag';
      hook('idea-status').parentElement.after(tag);
    }
    hook('idea-kind').textContent = `${templateOf(coaching.template).name} · ${format.name}`;
    hook('change').textContent = picking ? 'Done' : 'Change';
    const answers = answersOf(coaching);
    // While YAP is asking, the story is the format's three slots filling with answers. Once there is a draft, it is the draft.
    const rows = coaching.state === 'proposed'
      ? coaching.outline.beats.map((beat) => ({ label: beat.label, text: beat.line, dim: false }))
      : format.slots.map((slot, i) => ({ label: slot.label, text: answers[i] || slot.hint, dim: !answers[i] }));
    const story = document.querySelector('.story');
    // Edit story is there once there is a line to edit. While it is open the lines are left alone: the person is typing in them.
    hook('edit-story').hidden = !rows.some((row) => !row.dim);
    hook('edit-story').textContent = editingStory ? 'Done' : 'Edit story';
    if (!editingStory || !story.querySelector('textarea')) {
      for (const old of story.querySelectorAll('.lbl, .beat')) old.remove();
      rows.forEach((row, i) => {
        const label = element('p', 'lbl', row.label);
        label.dataset.testid = `${STORY_HOOKS[i]}-label`;
        let beat = element('div', row.dim ? 'beat dim' : 'beat', row.text);
        if (editingStory && !row.dim) {
          beat = element('textarea', 'beat');
          beat.value = row.text;
          beat.rows = 2;
          beat.maxLength = COACH_LIMITS.textChars;
          beat.dataset.was = row.text;
          beat.setAttribute('aria-label', row.label);
        } else {
          // The words sit in a line of their own, so a long answer can show its first lines and keep the rest a hover away.
          beat.replaceChildren(element('span', 'bt', row.text));
          beat.title = row.text;
        }
        beat.dataset.testid = STORY_HOOKS[i];
        story.append(label, beat);
      });
    }
    renderExperiments();
    renderColumn();
    fitStory();
    hook('save-idea').disabled = busy || coaching.waiting === 'outline';
  }

  // ---- The draft on the confirm screen: a title, and beats to tick, edit and accept.

  const pointRows = () => POINT_HOOKS.map((name) => hook(name)).filter(Boolean);

  function renderConfirm() {
    const waiting = coaching.state !== 'proposed';
    panel.dataset.waiting = String(waiting);
    const title = hook('outline-title');
    hook('outline-kind').textContent = `${templateOf(coaching.template).name} · ${formatOf(draft ? draft.format : coaching.format).name}`;
    // What the idea carries besides its beats: the direction picked for its key element, and its experiments.
    const picked = directionsOf(coaching).find((direction) => direction.key === coaching.pick);
    const carried = [...(picked ? [[keyElementOf(coaching.template).name, picked.words]] : []), ...coaching.experiments.map((each) => ['experiment', each.title])];
    hook('idea-carried').hidden = waiting || carried.length === 0;
    hook('idea-carried').replaceChildren(...carried.map(([name, words]) => {
      const row = element('p', 'carried-row');
      row.append(element('span', 'k', name), element('span', 'v', words));
      return row;
    }));
    hook('save-for-later').disabled = waiting || busy;
    if (document.activeElement !== title) title.value = draft ? draft.title : titleFrom(thought());
    title.disabled = waiting;
    hook('idea-summary').textContent = waiting ? 'YAP is drafting your outline.' : editing ? 'Change any line, then press Done.' : 'Untick a beat to leave it out. Edit changes the words.';
    hook('edit').disabled = waiting;
    hook('edit').lastChild.textContent = editing ? 'Done' : 'Edit';
    hook('another-go').disabled = waiting || busy;
    hook('confirm-idea').disabled = waiting || busy;
    document.querySelector('.points').hidden = waiting || editing;
    pointRows().forEach((row, i) => {
      const beat = !waiting && draft ? draft.beats[i] : null;
      row.hidden = !beat;
      row.setAttribute('aria-checked', String(Boolean(beat) && beat.keep !== false));
      hook(`${POINT_HOOKS[i]}-title`).textContent = beat ? beat.label : '';
      hook(`${POINT_HOOKS[i]}-text`).textContent = beat ? beat.line : '';
    });
  }

  function render() {
    if (!ready) return;
    renderThread();
    if (stage === 'conversation') renderConversation();
    else if (stage === 'concept') renderConcept();
    else renderConfirm();
    input.placeholder = 'Add a thought or ask YAP...';
    sendButton.disabled = Boolean(coaching.waiting) || input.value.trim() === '';
  }

  // ---- Changes to the saved conversation.

  /** Send one event. Gives the answer, or null when it was refused; either way the page shows the conversation as the server has it. */
  async function send(event) {
    if (busy || leaving) return null;
    busy = true;
    try {
      const result = await coachCall(id, { ...event, rev: coaching.rev });
      if (result.data && result.data.coaching) coaching = result.data.coaching;
      if (result.ok) return result.data;
      if (result.data && result.data.beats) {
        // Beats were made for this idea somewhere else. They stay as they are, and this opens them.
        leaving = true;
        go(routeFor('beats', { id }));
      } else if (result.status !== 409) sayQuietly(document, (result.data && result.data.error) || SERVER_LINE);
      return null;
    } catch {
      sayQuietly(document, SERVER_LINE);
      return null;
    } finally {
      busy = false;
      render();
    }
  }

  /** Get the coach's answer to whatever YAP owes, and save it. */
  async function pump() {
    if (!ready || leaving || !coaching.waiting || asking === coaching.rev) return;
    const ticket = coaching.rev;
    asking = ticket;
    render();
    const { by, reply } = await coachReply(coaching, askClaude);
    if (leaving) return;
    if (coaching.rev !== ticket) {
      // The person moved on while the coach was thinking: this answer is dropped.
      if (asking === ticket) asking = null;
      pump();
      return;
    }
    let result = null;
    try {
      result = await coachCall(id, { type: 'reply', rev: ticket, by, reply });
    } catch {
      result = null;
    }
    if (asking === ticket) asking = null;
    if (leaving) return;
    if (!result) {
      sayQuietly(document, SERVER_LINE);
      return;
    }
    if (result.data && result.data.coaching) coaching = result.data.coaching;
    if (result.ok && coaching.state === 'proposed') {
      draft = structuredClone(coaching.outline);
      if (stage !== 'confirm') {
        // The draft has its own screen.
        leaving = true;
        go(self());
        return;
      }
    }
    render();
    // A refused reply means the conversation moved on: answer what is owed now.
    if (result.ok || result.status === 409) pump();
  }

  async function say(raw) {
    const text = String(raw || '').trim();
    if (!text || !ready || leaving || coaching.waiting) return;
    if (editing) commitEdits();
    if (!(await send({ type: 'say', text }))) return;
    input.value = '';
    sendButton.disabled = true;
    if (stage === 'conversation') {
      // The first answer moves the idea on to shaping, where YAP's next question lands.
      leaving = true;
      go(self());
      return;
    }
    pump();
  }

  async function pick(format) {
    if (!ready || leaving) return;
    picking = false;
    // Pressing the format already on the table says yes to it.
    if (format === coaching.format && coaching.chosen) return render();
    if (await send({ type: 'format', format })) pump();
  }

  /** Keep the idea in Create, to open on the screen `state` names ('thought' is the first conversation), and go to `destination`. */
  async function move(state, destination = self()) {
    if (!ready || busy || leaving) return;
    busy = true;
    try {
      const placed = await coachCall(id, { type: 'place', screen: state === 'thought' ? '' : state });
      if (!placed.ok && !(placed.data && placed.data.beats)) throw new Error((placed.data && placed.data.error) || SERVER_LINE);
      leaving = true;
      // An idea that already has its beats opens on them.
      go(placed.ok ? destination : routeFor('beats', { id }));
    } catch (err) {
      sayQuietly(document, err.message || SERVER_LINE);
    } finally {
      busy = false;
    }
  }

  /**
   * Save idea. The idea is in Create from its first answer, so this never
   * loses it: it asks for the draft and opens the draft's screen. With too
   * little to draft from, YAP asks its next question here and says why.
   */
  async function saveIdea() {
    if (!ready || leaving || busy || coaching.waiting === 'outline') return;
    if (editingStory) await toggleStory();
    if (coaching.state === 'asking') {
      if (!(await send({ type: 'propose' }))) return;
      if (coaching.waiting === 'question') {
        sayQuietly(document, KEPT_LINE);
        pump();
        return;
      }
    }
    await move('confirming');
  }

  /** Edit story: the lines the person has given open for rewriting; Done saves the ones that changed. */
  async function toggleStory() {
    if (!ready || leaving || busy) return;
    if (!editingStory) {
      editingStory = true;
      render();
      document.querySelector('.story textarea')?.focus();
      return;
    }
    const fields = [...document.querySelectorAll('.story textarea')];
    editingStory = false;
    if (coaching.state === 'proposed') {
      const beats = coaching.outline.beats.map((beat, i) => ({ ...beat, line: fields[i] && fields[i].value.trim() ? fields[i].value : beat.line }));
      await send({ type: 'edit', outline: { ...coaching.outline, beats } });
      draft = structuredClone(coaching.outline);
    } else {
      for (const [index, field] of fields.entries()) {
        if (field.value.trim() && field.value.trim() !== field.dataset.was) await send({ type: 'revise', index, text: field.value });
      }
    }
    render();
  }

  // ---- Editing the draft.

  function commitEdits() {
    const fields = [...document.querySelectorAll('.edits textarea')];
    const beats = draft.beats.map((beat, i) => ({ ...beat, line: fields[i] ? fields[i].value.replace(/\s+/g, ' ').trim() : beat.line })).filter((beat) => beat.line);
    // A draft with every line emptied keeps its beats: an outline has at least one.
    if (beats.length > 0) draft.beats = beats;
    editing = false;
    document.querySelector('.edits').replaceChildren();
  }

  function toggleEdit() {
    if (!ready || leaving || coaching.state !== 'proposed' || !draft) return;
    if (editing) {
      commitEdits();
      render();
      persist();
      return;
    }
    editing = true;
    const edits = document.querySelector('.edits');
    edits.replaceChildren(...draft.beats.map((beat, i) => {
      const field = element('label', '', beat.label);
      const words = element('textarea');
      words.value = beat.line;
      words.rows = 2;
      words.maxLength = COACH_LIMITS.textChars;
      words.dataset.testid = `${POINT_HOOKS[i]}-edit`;
      field.append(words);
      return field;
    }));
    render();
    edits.querySelector('textarea').focus();
  }

  /** Save the draft as the person has it, so a reload shows the same draft. */
  function persist() {
    if (coaching.state === 'proposed' && draft) send({ type: 'edit', outline: draft });
  }

  /** Accept the draft. The idea is saved with its beats, and `destination` opens: its beat list, or the idea inbox. */
  async function accept(destination) {
    if (!ready || leaving || coaching.state !== 'proposed' || !draft) return;
    if (editing) commitEdits();
    if (await send({ type: 'accept', outline: draft })) {
      leaving = true;
      go(destination);
    }
  }

  async function anotherGo() {
    if (!ready || leaving || coaching.state !== 'proposed') return;
    if (editing) commitEdits();
    if (await send({ type: 'again' })) pump();
  }

  // ---- What each stage's screen keeps of its shell, set up once.

  if (stage === 'conversation') {
    const row = hook('template-select');
    row.setAttribute('aria-haspopup', 'listbox');
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => ready && toggleTemplates());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && hook('template-menu')) toggleTemplates();
    });
    hook('format-hint').textContent = 'A starting point. You can change it.';
    document.addEventListener('yap:formats-more', () => {
      allFormats = true;
      render();
    });
  }
  if (stage === 'concept') {
    document.addEventListener('yap:idea-edit-story', () => toggleStory());
    document.querySelector('.thumbs').replaceChildren(hook('thumbs-label'));
    const list = element('div', 'exp-list');
    list.dataset.testid = 'experiment-list';
    list.hidden = true;
    hook('experiment').after(list);
    hook('experiment').hidden = true;
    // The shell's own script opens and closes the card; the list follows it.
    hook('experiment').addEventListener('click', () => {
      if (!ready) return;
      renderExperiments();
      fitStory();
      fitType();
    });
    window.addEventListener('resize', () => {
      if (!ready) return;
      fitStory();
      fitType();
    });
    document.addEventListener('yap:idea-change-format', () => {
      if (!ready) return;
      picking = !picking;
      render();
    });
    document.addEventListener('yap:experiment-bring', () => go('/review'));
    reviewOffers().then((found) => {
      offers = found;
      render();
    });
  }
  if (stage === 'confirm') {
    const card = element('div', 'titlecard');
    card.dataset.testid = 'idea-thumb';
    const kind = element('p', 'kind');
    kind.dataset.testid = 'outline-kind';
    const title = element('textarea');
    title.dataset.testid = 'outline-title';
    title.rows = 2;
    title.maxLength = COACH_LIMITS.titleChars;
    title.setAttribute('aria-label', 'Title');
    title.addEventListener('change', () => {
      if (!draft) return;
      draft.title = title.value.replace(/\s+/g, ' ').trim() || draft.title;
      persist();
    });
    card.append(kind, title);
    hook('idea-thumb').replaceWith(card);

    const points = document.querySelector('.points');
    const edits = element('div', 'edits');
    points.after(edits);
    // A longer outline gets rows of its own, drawn as the shell draws its three.
    for (const name of POINT_HOOKS.slice(3)) {
      const row = hook('point-closing').cloneNode(true);
      row.dataset.testid = name;
      row.querySelector('.ptitle').dataset.testid = `${name}-title`;
      row.querySelector('.ptext').dataset.testid = `${name}-text`;
      row.hidden = true;
      points.append(row);
    }
    // The shell's own script ticks its three rows; the added rows are ticked here. Either way the draft follows.
    points.addEventListener('click', (event) => {
      const row = event.target.closest('.point');
      const at = pointRows().indexOf(row);
      if (!ready || !draft || at === -1 || !draft.beats[at]) return;
      if (at >= 3) row.setAttribute('aria-checked', String(row.getAttribute('aria-checked') !== 'true'));
      draft.beats[at].keep = row.getAttribute('aria-checked') === 'true';
      persist();
    });
    const carried = element('div', 'carried');
    carried.dataset.testid = 'idea-carried';
    carried.hidden = true;
    edits.after(carried);
    const later = element('button', 'text-btn later', 'Save to ideas');
    later.type = 'button';
    later.dataset.testid = 'save-for-later';
    later.addEventListener('click', () => accept('/create'));
    hook('confirm-idea').before(later);
    const again = element('button', 'text-btn again', 'Another go');
    again.type = 'button';
    again.dataset.testid = 'another-go';
    again.addEventListener('click', anotherGo);
    hook('keep-exploring').before(again);
  }

  document.addEventListener('yap:talk', () => ready && talkInto(input, hook('talk-to-yap')));
  document.addEventListener('yap:idea-message', (event) => say(event.detail?.text));
  document.addEventListener('yap:idea-keep-exploring', async () => {
    if (stage === 'concept') return input.focus();
    // Keep exploring with a format on the table says yes to it: YAP's next question is the story's first.
    if (stage === 'conversation' && ready && !coaching.chosen && !(await send({ type: 'format', format: coaching.format }))) return undefined;
    return move('shaping');
  });
  document.addEventListener('yap:idea-save-thought', () => move('thought', '/create'));
  document.addEventListener('yap:idea-save', () => saveIdea());
  // Confirm goes on to the beats; Save to ideas keeps it in the inbox.
  document.addEventListener('yap:idea-confirm', () => accept(routeFor('beats', { id })));
  document.addEventListener('yap:idea-edit', () => toggleEdit());
  // Words scrolled under the heading fade out instead of being cut off.
  thread.addEventListener('scroll', () => thread.classList.toggle('scrolled', thread.scrollTop > 2));
  // Enter sends, as a person expects of a conversation; Shift and Enter makes a new line.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!sendButton.disabled) sendButton.click();
  });
  // The shell's script enables Send for any words; while YAP is answering it stays off.
  input.addEventListener('input', () => {
    if (!ready || coaching.waiting) sendButton.disabled = true;
  });

  // Static module execution precedes DOMContentLoaded. Waiting also covers the
  // unchanged deferred shell script that emits the idea events.
  const handlersReady = document.readyState === 'complete' ? Promise.resolve() : new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  Promise.all([getIdea(id), coachCall(id)]).then(async ([saved, kept]) => {
    if (!saved) throw new Error('This idea was not found.');
    if (!kept.ok || !kept.data || !kept.data.coaching) throw new Error((kept.data && kept.data.error) || 'The conversation could not be opened.');
    idea = saved;
    coaching = kept.data.coaching;
    draft = coaching.outline ? structuredClone(coaching.outline) : null;
    await handlersReady;
    if (idea.state === 'saved' || coaching.state === 'accepted') {
      // A saved idea has its beats: they are what there is to open.
      leaving = true;
      go(routeFor('beats', { id }));
      return;
    }
    ready = true;
    render();
    document.documentElement.dataset.ideaReady = 'true';
    const surface = document.querySelector('[data-idea-surface]');
    if (surface) {
      surface.inert = false;
      surface.setAttribute('aria-busy', 'false');
      surface.style.removeProperty('visibility');
    }
    hook('idea-loading')?.remove();
    thread.scrollTop = thread.scrollHeight;
    thread.classList.toggle('scrolled', thread.scrollTop > 2);
    // Opened on the draft screen with no draft yet: the person asked for one.
    if (stage === 'confirm' && coaching.state === 'asking' && coaching.waiting !== 'outline') {
      await send({ type: 'propose' });
      // Too little to draft from: YAP asks for more on the shaping screen.
      if (coaching.state === 'asking' && coaching.waiting === 'question') return move('shaping');
    }
    return pump();
  }).catch((err) => {
    ready = false;
    document.documentElement.dataset.ideaReady = 'error';
    const gate = hook('idea-loading');
    if (gate) {
      gate.setAttribute('role', 'alert');
      hook('idea-loading-title').textContent = 'Could not open your idea';
      hook('idea-loading-detail').textContent = `${err.message} Your saved idea has not been changed. Return Home to try again.`;
    } else sayQuietly(document, err.message);
  });
}

/**
 * Wire one of the idea screens.
 * @param {'conversation' | 'concept' | 'confirm'} stage
 */
export function wireIdea(stage) {
  wireNav(document);
  const id = matchRoute(location.pathname, location.search)?.params.id;
  if (isShellMode(location)) wireShell(stage, id);
  else wireLive(stage, id);
}
