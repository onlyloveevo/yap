// The presentation map, wired. The page draws YAP's fourteen steps as connected
// screen cards; the person writes their own beat under each, switches steps on
// or off, orders them, and goes live. Nothing here calls a model, a server route
// or a camera: Go Live saves the draft and opens the existing Prepare at
// /prepare/new?presentation=1, where the camera check and the existing Start
// recording button make the real Recording.
//
// Every word comes out through textContent or an input's value, never as markup.
// A pressed picture does nothing: the pictures are references, not controls.
import { go } from '../lib/app.js';
import { DELIVERY_CUES } from '../../src/engine/delivery.js';
import { BEAT_MAX, IMAGE_KINDS, LANES, MAX_CUES, PREPARE_ADDRESS, STAGES, TITLE_MAX, checkDraft, exportText, isSuggestion, moveStage, stageById } from '../lib/presentation-model.js';
import { loadDraft, saveDraft } from '../lib/presentation-store.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const loaded = loadDraft();
let draft = loaded.draft;
/** Which cards have their beat open: kept across a redraw. */
const open = new Set();
let going = false;
let saveTimer = 0;
let dirty = false;

const entryOf = (id) => draft.stages.find((entry) => entry.id === id);
const beatsOn = () => draft.stages.filter((entry) => entry.on);

function say(state, line) {
  const box = $('save-status');
  box.dataset.state = state;
  box.textContent = line;
}

/** The words as text, for the copy link and for the fallback box. */
function refreshCopies() {
  const text = exportText(draft);
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  $('copy-download').href = href;
  $('fallback-download').href = href;
  $('fallback-text').value = text;
}

function showFallback(show) {
  $('fallback').hidden = !show;
}

/** Keep the draft now. Says Saved only once the browser has really kept it. */
function save() {
  window.clearTimeout(saveTimer);
  dirty = false;
  refreshCopies();
  const answer = saveDraft(draft);
  if (answer.ok) {
    say('ok', 'Saved in this browser');
    showFallback(false);
  } else {
    say('bad', `Not saved. ${answer.error} Your words are still on this page: copy them from the box below.`);
    showFallback(true);
  }
  return answer;
}

function saveSoon() {
  dirty = true;
  say('', 'Saving…');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 150);
}

function refreshBar() {
  const n = beatsOn().length;
  $('bar-count').textContent = `${n} ${n === 1 ? 'step' : 'steps'} in your talk`;
}

function peekOf(entry) {
  return entry.beat.trim() ? entry.beat : 'Nothing written yet.';
}

function card(info) {
  const entry = entryOf(info.id);
  const root = el('article', 'card');
  root.dataset.testid = 'stage-card';
  root.setAttribute('data-testid', 'stage-card');
  root.dataset.stage = info.id;
  root.dataset.on = String(entry.on);

  const head = el('header', 'card-head');
  const position = beatsOn().findIndex((each) => each.id === info.id);
  const tag = el('span', 'order-tag', entry.on ? `Beat ${position + 1}` : 'Not in your talk');
  tag.setAttribute('data-testid', 'order-tag');
  head.append(el('span', 'num', String(info.n)), el('h3', 'card-name', info.name), tag);

  const shot = el('figure', 'shot');
  const img = el('img');
  img.src = info.image;
  img.alt = `${IMAGE_KINDS[info.imageKind]} for step ${info.n}, ${info.name}`;
  img.decoding = 'async';
  img.setAttribute('data-testid', 'stage-image');
  shot.append(img, el('figcaption', '', IMAGE_KINDS[info.imageKind]));

  const you = el('p', 'says');
  you.append(el('b', '', 'You'), document.createTextNode(info.you));
  const yap = el('p', 'says');
  yap.append(el('b', '', 'YAP'), document.createTextNode(info.yap));
  root.append(head, shot, you, yap);
  if (info.note) root.append(el('p', 'card-note', info.note));
  if (info.open) {
    const link = el('a', 'open-link', 'Open this step in the app');
    link.href = info.open;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('data-testid', 'open-step');
    root.append(link);
  }

  const switchLabel = el('label', 'switch');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = entry.on;
  box.setAttribute('data-testid', 'stage-on');
  box.setAttribute('aria-label', `Include step ${info.n}, ${info.name}, in my talk`);
  box.addEventListener('change', () => {
    entryOf(info.id).on = box.checked;
    save();
    render(`${info.id}:on`);
  });
  switchLabel.append(box, document.createTextNode('In my talk'));
  root.append(switchLabel);

  const details = el('details', 'beat');
  details.setAttribute('data-testid', 'beat-details');
  details.open = open.has(info.id);
  details.addEventListener('toggle', () => { if (details.open) open.add(info.id); else open.delete(info.id); });
  const summary = el('summary');
  summary.append(el('span', 'beat-k', 'Your beat'));
  const peek = el('span', `beat-peek${isSuggestion(entry) ? ' is-suggestion' : ''}`, peekOf(entry));
  peek.setAttribute('data-testid', 'beat-peek');
  summary.append(peek);
  const area = el('textarea');
  area.value = entry.beat;
  area.rows = 3;
  area.setAttribute('data-testid', 'beat-input');
  area.setAttribute('aria-label', `Your beat for step ${info.n}, ${info.name}`);
  area.placeholder = 'Say it your way.';
  const meta = el('div', 'beat-meta');
  const hint = el('span', '', isSuggestion(entry) ? 'A suggestion. Write over it with your own words.' : 'Your own words.');
  const count = el('span', '', '');
  count.setAttribute('data-testid', 'beat-count');
  const paintCount = () => {
    const n = Array.from(area.value).length;
    count.textContent = `${n} / ${BEAT_MAX}`;
    count.dataset.over = String(n > BEAT_MAX);
  };
  paintCount();
  area.addEventListener('input', () => {
    entryOf(info.id).beat = area.value;
    peek.textContent = peekOf(entryOf(info.id));
    peek.classList.toggle('is-suggestion', isSuggestion(entryOf(info.id)));
    hint.textContent = isSuggestion(entryOf(info.id)) ? 'A suggestion. Write over it with your own words.' : 'Your own words.';
    paintCount();
    refreshOrder();
    saveSoon();
  });
  meta.append(hint, count);
  details.append(summary, area, meta);
  root.append(details);
  return root;
}

function renderLanes() {
  const lanes = $('lanes');
  lanes.replaceChildren();
  LANES.forEach((lane, i) => {
    if (i > 0) { const down = el('div', 'lane-down', '↓'); down.setAttribute('aria-hidden', 'true'); lanes.append(down); }
    const section = el('section', 'lane');
    section.dataset.lane = lane.id;
    section.setAttribute('aria-label', `${lane.name} steps`);
    const head = el('div', 'lane-head');
    head.append(el('h2', 'lane-name', lane.name), el('p', 'lane-note', lane.note));
    const body = el('div', 'lane-body');
    const cards = el('div', 'cards');
    for (const info of STAGES.filter((each) => each.lane === lane.id)) cards.append(card(info));
    body.append(cards);
    if (lane.loop) body.append(el('p', 'lane-loop', `↩ ${lane.loop}`));
    section.append(head, body);
    lanes.append(section);
  });
}

function refreshOrder() {
  const list = $('order-list');
  const on = beatsOn();
  list.replaceChildren();
  on.forEach((entry, i) => {
    const info = stageById(entry.id);
    const row = el('li', 'order-row');
    row.setAttribute('data-testid', 'order-row');
    row.dataset.stage = entry.id;
    const text = el('div');
    text.append(el('span', 'name', info.name), el('span', 'peek', peekOf(entry)));
    const moves = el('div', 'moves');
    const earlier = el('button', 'small', 'Earlier');
    earlier.type = 'button';
    earlier.disabled = i === 0;
    earlier.setAttribute('data-testid', 'move-earlier');
    earlier.setAttribute('aria-label', `Move ${info.name} earlier`);
    earlier.addEventListener('click', () => { draft = moveStage(draft, entry.id, -1); save(); render(`${entry.id}:earlier`); });
    const later = el('button', 'small', 'Later');
    later.type = 'button';
    later.disabled = i === on.length - 1;
    later.setAttribute('data-testid', 'move-later');
    later.setAttribute('aria-label', `Move ${info.name} later`);
    later.addEventListener('click', () => { draft = moveStage(draft, entry.id, 1); save(); render(`${entry.id}:later`); });
    moves.append(earlier, later);
    row.append(text, moves);
    list.append(row);
  });
  if (on.length === 0) list.append(el('li', 'order-note', 'No step is switched on yet.'));
  refreshBar();
}

function renderCues() {
  const box = $('cue-chips');
  box.replaceChildren();
  for (const cue of DELIVERY_CUES) {
    const chip = el('button', 'chip', cue.text);
    chip.type = 'button';
    chip.setAttribute('data-testid', 'cue-chip');
    chip.dataset.kind = cue.kind;
    chip.setAttribute('aria-pressed', String(draft.cues.includes(cue.kind)));
    chip.addEventListener('click', () => {
      const on = draft.cues.includes(cue.kind);
      if (!on && draft.cues.length >= MAX_CUES) { $('cue-limit').hidden = false; return; }
      $('cue-limit').hidden = true;
      draft.cues = on ? draft.cues.filter((kind) => kind !== cue.kind) : [...draft.cues, cue.kind];
      chip.setAttribute('aria-pressed', String(!on));
      save();
    });
    box.append(chip);
  }
}

/** Redraw the map and the order. `keep` names the control that had focus so the keyboard stays where it was. */
function render(keep) {
  renderLanes();
  refreshOrder();
  refreshCopies();
  if (!keep) return;
  const [id, what] = keep.split(':');
  const selector = what === 'on' ? `[data-stage="${id}"] [data-testid="stage-on"]` : `[data-stage="${id}"] [data-testid="move-${what}"]`;
  const target = document.querySelector(selector);
  const fallback = document.querySelector(`[data-stage="${id}"] [data-testid="move-${what === 'earlier' ? 'later' : 'earlier'}"]`);
  const aim = target && !target.disabled ? target : fallback && !fallback.disabled ? fallback : null;
  if (aim) aim.focus();
}

function showLiveError(line) {
  const box = $('live-error');
  box.textContent = line;
  box.hidden = !line;
}

/** Name the step an error is about: open its beat and put the cursor in it. */
function pointAt(stageId) {
  if (!stageId) return;
  open.add(stageId);
  const root = document.querySelector(`.card[data-stage="${stageId}"]`);
  if (!root) return;
  root.querySelector('details').open = true;
  root.scrollIntoView({ block: 'center' });
  root.querySelector('textarea').focus();
}

function goLive() {
  if (going) return;
  showLiveError('');
  const checked = checkDraft(draft);
  if (!checked.ok) {
    showLiveError(checked.error);
    pointAt(checked.stageId);
    return;
  }
  going = true;
  $('go-live').disabled = true;
  $('go-live').setAttribute('aria-busy', 'true');
  const answer = save();
  if (!answer.ok) {
    going = false;
    $('go-live').disabled = false;
    $('go-live').removeAttribute('aria-busy');
    showLiveError(`Your talk could not be carried to the camera check: ${answer.error} Nothing was recorded. Copy your words from the box above, then try again.`);
    return;
  }
  go(PREPARE_ADDRESS);
}

function openPreview() {
  const checked = checkDraft(draft);
  $('preview-title').textContent = draft.title || 'Untitled presentation';
  const list = $('preview-list');
  list.replaceChildren();
  for (const entry of beatsOn()) {
    const row = el('li');
    row.append(el('span', 'pname', stageById(entry.id).name), el('span', 'pbeat', entry.beat));
    list.append(row);
  }
  if (!checked.ok) { const why = el('li', 'order-note', checked.error); why.setAttribute('role', 'alert'); list.append(why); }
  $('preview-live').disabled = !checked.ok;
  $('preview').hidden = false;
  $('preview-close').focus();
}

function closePreview() {
  $('preview').hidden = true;
  $('preview-btn').focus();
}

// The share tab reads the saved draft once, and never writes it. Presenter
// editing remains in /present; no form controls or author beats are broadcast.
function renderDisplay() {
  const page = el('main', 'display-page');
  page.dataset.testid = 'presentation-display';
  const head = el('header', 'display-head');
  const title = el('h1', '', loaded.status === 'loaded' ? draft.title : 'Presentation');
  const back = el('a', '', 'Edit presentation');
  back.href = '/present';
  head.append(title, back);
  page.append(head);
  if (loaded.status !== 'loaded' || !checkDraft(draft).ok) {
    const error = el('p', 'display-note', 'No saved presentation is ready to show. Open the editor, save your beats, then reload this tab.');
    error.setAttribute('role', 'status');
    page.append(error);
    document.body.replaceChildren(page);
    return;
  }
  const entries = beatsOn();
  let index = 0;
  const controls = el('nav', 'display-controls');
  controls.setAttribute('aria-label', 'Presentation screens');
  const makeButton = (text, hook, action) => {
    const button = el('button', 'ghost', text);
    button.type = 'button'; button.dataset.testid = hook;
    button.addEventListener('click', action); controls.append(button); return button;
  };
  const stage = el('figure', 'display-stage');
  const image = el('img'); image.dataset.testid = 'display-image';
  const caption = el('figcaption'); caption.dataset.testid = 'display-caption';
  stage.append(image, caption);
  const map = el('section', 'display-map'); map.hidden = true;
  map.dataset.testid = 'display-map';
  const prev = makeButton('Previous', 'display-previous', () => show(index - 1));
  const next = makeButton('Next', 'display-next', () => show(index + 1));
  const full = makeButton('Full map', 'display-full-map', () => { map.hidden = !map.hidden; stage.hidden = !map.hidden; full.textContent = map.hidden ? 'Full map' : 'Current screen'; });
  function show(at) {
    index = Math.max(0, Math.min(entries.length - 1, at));
    const info = stageById(entries[index].id);
    image.src = info.image; image.alt = `${IMAGE_KINDS[info.imageKind]}: ${info.name}`;
    caption.textContent = `${index + 1} / ${entries.length} · ${info.name} · ${IMAGE_KINDS[info.imageKind]}`;
    prev.disabled = index === 0; next.disabled = index === entries.length - 1;
    stage.hidden = false; map.hidden = true; full.textContent = 'Full map';
  }
  for (const [at, entry] of entries.entries()) {
    const info = stageById(entry.id);
    const button = el('button'); button.type = 'button';
    const thumb = el('img'); thumb.src = info.image; thumb.alt = IMAGE_KINDS[info.imageKind];
    button.append(thumb, el('span', '', `${at + 1}. ${info.name}`));
    button.addEventListener('click', () => show(at)); map.append(button);
  }
  page.append(controls, stage, map, el('p', 'display-note', 'Reference walkthrough · Design references and build screenshots, not interactive app screens. Your speaking beats stay in the presenter view.'));
  document.body.replaceChildren(page);
  window.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); show(index + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  show(0);
}

// ---- start ----
if (new URLSearchParams(location.search).get('display') === '1') {
  renderDisplay();
} else {

const titleInput = $('title-input');
titleInput.value = draft.title;
titleInput.addEventListener('input', () => { draft.title = titleInput.value; saveSoon(); });
titleInput.setAttribute('aria-label', `Presentation title, at most ${TITLE_MAX} characters`);
$('go-live').addEventListener('click', goLive);
$('preview-live').addEventListener('click', () => { closePreview(); goLive(); });
$('preview-btn').addEventListener('click', openPreview);
$('preview-close').addEventListener('click', closePreview);
$('preview').addEventListener('keydown', (event) => { if (event.key === 'Escape') closePreview(); });
$('open-order').addEventListener('click', () => { $('order').open = true; $('order').scrollIntoView({ block: 'start' }); });
window.addEventListener('pagehide', () => { if (dirty) save(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) save(); });
// Back from Prepare may show this page from memory with Go Live still held: let it work again.
window.addEventListener('pageshow', (event) => { if (event.persisted) { going = false; $('go-live').disabled = false; $('go-live').removeAttribute('aria-busy'); } });

render();
renderCues();
refreshCopies();
if (loaded.status === 'loaded') say('ok', 'Your saved presentation is back, exactly as you left it.');
else if (loaded.status === 'new') say('', 'Your words are kept in this browser as you type.');
else if (loaded.status === 'unreadable') say('bad', 'A saved presentation was found but could not be read, so this is a fresh one. It is replaced when you type.');
else { say('bad', 'This browser will not keep your presentation. Your words stay on this page: copy them from the box below.'); showFallback(true); }

}
