// The Create gallery, wired (D-116). The page is the approved shell, and its
// own script (gallery.js) does the format filters and search and fires the
// shell's events. This module answers those events, wires the nav, builds the
// saved ideas' own cards, and runs each card's three-dot menu (Open, Rename).
// Outside shell mode the screen follows the Loom's idea inbox (frame L09): the
// search field top right, a chips row of platforms that filters the ideas, a
// "Popular formats" row of the format library, each card with its picture from
// that frame, that starts a new idea headed there, then "Your ideas" four to a
// row, ending in the "Develop a new idea" tile.
// Outside shell mode a rename is one patchIdea to this app's own server. In
// shell mode the page is its reference shell: search and the menus do nothing.
import { go, isShellMode, sayQuietly, wireNav } from '../lib/app.js';
import { APP_API, listIdeas, patchIdea } from '../lib/api.js';
import { TEMPLATES, formatNamed, templateOf } from '../../src/engine/formats.js';
import { closeCardMenu, openCardMenu, openRenameDialog, wireFilters } from '../lib/gallery-controls.js';
import { routeFor } from '../lib/routes.js';

/** The id of the bundled sample idea: the first card (D-116, D-117). */
const SAMPLE_ID = 'sample';
/** The six drawn cards are the bundled sample bank. */
const CARDS = 6;
const BUNDLED = [SAMPLE_ID, 'idea-2', 'idea-3', 'idea-4', 'idea-5', 'idea-6'];
const NOT_REACHED = 'YAP could not reach its own server. Nothing was renamed.';
/** Where each bundled sample idea is headed: all YouTube but the fourth, as in the Loom's inbox. */
const BUNDLED_PLATFORM = Object.freeze({ 4: 'Instagram' });
/** The chips row: every platform of the format library, then the person's own saved ideas. */
const CHIPS = Object.freeze([['all', 'All'], ...[...new Set(TEMPLATES.map((template) => template.platform))].map((platform) => [platform.toLowerCase(), platform]), ['saved', 'Saved']]);
/** Each platform's small mark on its chip, drawn here. The marks on the format pictures are part of the pictures. */
const MARKS = Object.freeze({
  YouTube: '<rect x="1.5" y="5" width="21" height="14" rx="4.2" fill="#f03"/><path d="M10 9v6l5.2-3z" fill="#fff"/>',
  Instagram: '<defs><linearGradient id="mark-instagram" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".65" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#mark-instagram)"/><rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3.4" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="2.6" stroke="#fff" stroke-width="1.5"/><circle cx="15.6" cy="8.4" r=".9" fill="#fff"/>',
  Shorts: '<path d="M17.77 10.32l-1.2-.5L18 9.06a3.74 3.74 0 0 0-3.5-6.62L6 6.94a3.74 3.74 0 0 0 .23 6.74l1.2.49L6 14.93a3.75 3.75 0 0 0 3.5 6.63l8.5-4.5a3.74 3.74 0 0 0-.23-6.74z" fill="#f03"/><path d="M10 14.65v-5.3L15 12z" fill="#fff"/>',
  TikTok: '<circle cx="12" cy="12" r="10.5" fill="#0b0b0d" stroke="rgba(255,255,255,.28)" stroke-width="1"/><path d="M13.3 6.4v7.7a2.5 2.5 0 1 1-2.5-2.5M13.3 6.4c.3 1.8 1.5 2.9 3.2 3.1" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  LinkedIn: '<rect x="2" y="2" width="20" height="20" rx="4.5" fill="#0a66c2"/><circle cx="7.6" cy="7.7" r="1.35" fill="#fff"/><rect x="6.5" y="10" width="2.2" height="7.4" fill="#fff"/><path d="M10.7 10h2.1v1.1c.5-.8 1.4-1.3 2.5-1.3 1.9 0 2.7 1.3 2.7 3.2v4.4h-2.2v-3.9c0-1-.3-1.7-1.3-1.7s-1.6.7-1.6 1.9v3.7h-2.2z" fill="#fff"/>',
  Podcast: '<circle cx="12" cy="12" r="10.5" fill="#9b4de0"/><circle cx="12" cy="10.6" r="1.7" fill="#fff"/><path d="M12 13.6v4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M9 13.6a4.2 4.2 0 1 1 6 0M7.2 15.6a7 7 0 1 1 9.6 0" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
  Saved: '<path d="M7 4h10v16l-5-3.6L7 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
});
const LOOK = `
.gallery .outline { height:50px; margin-top:0; padding:0 var(--space-5); font-size:16px; }
.gallery .filters { flex-wrap:wrap; margin-top:var(--space-5); }
.gallery .pill { height:44px; display:inline-flex; align-items:center; gap:9px; padding:0 16px; border-color:var(--card-border); background:var(--chip-bg); font-size:15.5px; }
.gallery .pill:hover { color:var(--white); border-color:var(--field-border); }
.gallery .pill[aria-pressed="true"] { border-color:var(--amber); background:var(--amber-tint); }
.pill .mark { width:20px; height:20px; stroke:none; }
.section-head { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--space-4); margin-top:var(--space-6); }
.section-head h2 { display:inline-block; margin:0; font-size:22px; font-weight:600; }
.section-head .sample-tag { vertical-align:3px; }
.section-head p { margin:4px 0 0; font-size:15px; color:var(--white-dim); }
.section-head .quiet { margin-left:auto; height:38px; padding:0 12px; font-size:15px; }
.popular { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:14px; margin-top:var(--space-4); }
.pop { display:flex; flex-direction:column; min-width:0; padding:8px 8px 12px; border:1px solid var(--card-border); border-radius:var(--radius-card); background:var(--card-bg); color:var(--white); text-align:left; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
.pop:hover, .pop:focus-visible { border-color:var(--amber); box-shadow:0 0 16px var(--amber-tint), inset 0 0 12px var(--amber-tint); outline:none; }
.pop.is-chip { border-color:var(--amber); box-shadow:0 0 0 1px var(--amber), 0 0 18px var(--amber-glow), inset 0 0 12px var(--amber-tint); }
.pop img { display:block; width:100%; height:auto; aspect-ratio:3 / 2; object-fit:cover; border-radius:var(--radius-thumb); }
/* A name never loses its end: on a narrow card the ratio drops to its own line. */
.pop .name { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:4px 6px; margin:10px 4px 0; font-size:15px; font-weight:600; white-space:nowrap; }
.pop .aspect { padding:2px 7px; border-radius:var(--radius-pill); background:rgba(255,255,255,.08); font-size:11px; font-weight:500; color:var(--white-soft); }
.pop .sub { margin:5px 4px 0; font-size:12.5px; line-height:1.35; color:var(--white-dim); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.gallery .grid { grid-template-columns:repeat(4, minmax(0, 1fr)); gap:18px; }
.gallery .card { padding:0; overflow:hidden; container-type:inline-size; transition:border-color .15s, box-shadow .15s; }
.gallery .card:first-child { border-color:var(--card-border); box-shadow:none; }
.gallery .card:hover, .gallery .card:focus-visible { border-color:var(--amber); box-shadow:0 0 16px var(--amber-tint); }
/* Each sample picture has a format chip painted along its foot. The picture is set taller than its box, so the box ends above that chip. */
.gallery .thumb { aspect-ratio:5 / 2; border-radius:0; }
.gallery .thumb img { height:117%; object-position:60% 0; }
.card-top { display:flex; align-items:flex-start; gap:8px; margin:12px 8px 0 14px; }
.gallery .card-title { flex:1; min-width:0; margin:0; font-size:16.5px; line-height:1.3; -webkit-line-clamp:2; }
.gallery .more { flex:none; margin-top:-3px; }
.card-meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:2px 10px; margin:5px 14px 0; }
.gallery .card-meta .tag { position:static; min-width:0; padding:0; background:none; font-size:13px; color:var(--white-soft); }
.gallery .updated { font-size:13px; }
@container (max-width: 330px) { .card-meta { flex-direction:column; } }
.gallery .card-desc { margin:8px 14px 14px; font-size:13.5px; line-height:1.45; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.thumb-words { display:grid; place-items:center; width:100%; height:100%; padding:8px 16px; background:radial-gradient(90% 140% at 12% 20%, rgba(244,198,107,.34), transparent 60%), radial-gradient(80% 130% at 95% 100%, rgba(190,96,24,.42), transparent 62%), linear-gradient(135deg, #2a2019, #14100c); }
.thumb-words span { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; max-width:92%; padding-bottom:5px; transform:rotate(-3deg); font-size:clamp(14px, 6.6cqw, 28px); font-weight:800; font-style:italic; line-height:1.08; text-transform:uppercase; text-align:center; text-wrap:balance; overflow-wrap:anywhere; text-shadow:0 2px 10px rgba(0,0,0,.55); box-shadow:inset 0 -3px 0 var(--amber); }
.tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:190px; padding:18px; border:1px solid var(--card-border); border-radius:var(--radius-card); background:var(--card-bg); color:var(--white); text-align:center; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
.tile:hover, .tile:focus-visible { border-color:var(--amber); box-shadow:0 0 16px var(--amber-tint); outline:none; }
.tile .plus { display:grid; place-items:center; width:44px; height:44px; margin-bottom:6px; border:1px solid var(--field-border); border-radius:var(--radius-round); }
.tile .plus svg { width:20px; height:20px; stroke-width:2; }
.tile strong { font-size:16.5px; font-weight:600; }
.tile .sub { max-width:24ch; font-size:13.5px; line-height:1.45; color:var(--white-dim); }
.empty-start { margin:0 auto; height:46px; font-size:16px; }
.empty-start[hidden] { display:none; }
@media (max-width: 1100px) {
  .popular, .gallery .grid { grid-template-columns:repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .popular { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .gallery .grid { grid-template-columns:minmax(0, 1fr); }
}
`;

/**
 * The idea a drawn card stands for: card 1 is the sample idea, and cards 2 to
 * 6 are idea-2 to idea-6.
 * @param {unknown} card the card's number, as the shell's event carries it
 * @returns {string | null}
 */
function ideaIdOf(card) {
  if (!Number.isInteger(card) || card < 1 || card > CARDS) return null;
  return card === 1 ? SAMPLE_ID : `idea-${card}`;
}

/** What starting an idea in a format is called: "Start an Instagram Reel", "Start a podcast". */
const startWords = (template) => (template.platform === 'Podcast' ? 'Start a podcast' : `Start ${/^[aeiou]/i.test(template.name) ? 'an' : 'a'} ${template.name}`);

const shell = isShellMode(location);

wireNav(document);

// Picking a card opens the beat list for that idea.
document.addEventListener('yap:idea-pick', (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  const id = ideaIdOf(detail && detail.id);
  if (id) go(routeFor('beats', { id }));
});

// The button top right and the last tile of the grid both open the Ideas opening.
document.addEventListener('yap:idea-new', () => go(routeFor('ideas')));

if (!shell) {
  const make = (tag, className, text) => {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  };
  const style = make('style', '', LOOK);
  document.head.append(style);
  document.querySelector('[data-testid="subtitle"]').textContent = 'Turn your ideas into scroll-stopping content.';

  // The Loom's words on the button top right; the grid's last tile says "Develop a new idea".
  document.querySelector('[data-testid="new-idea"]').lastChild.textContent = 'Start from a blank idea';

  // The chips row: platforms, each with its mark, in place of the drawn format pills.
  const row = document.querySelector('.filters');
  for (const drawn of row.querySelectorAll('.pill')) drawn.remove();
  row.prepend(...CHIPS.map(([key, label]) => {
    const chip = make('button', 'pill');
    chip.type = 'button';
    chip.dataset.testid = `filter-${key}`;
    chip.dataset.chip = key;
    if (key !== 'all' && key !== 'saved') chip.dataset.platform = label;
    if (MARKS[label]) chip.insertAdjacentHTML('beforeend', `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">${MARKS[label]}</svg>`);
    chip.append(label);
    chip.setAttribute('aria-pressed', String(key === 'all'));
    return chip;
  }));

  // Popular formats: every template of the format library, with its picture. Picking one starts a new idea headed there.
  const section = (title, sub) => {
    const head = make('div', 'section-head');
    const words = make('div');
    words.append(make('h2', '', title), make('p', '', sub));
    head.append(words);
    return head;
  };
  const popular = make('div', 'popular');
  popular.dataset.testid = 'popular-formats';
  for (const template of TEMPLATES) {
    const card = make('button', 'pop');
    card.type = 'button';
    card.dataset.testid = `popular-${template.key}`;
    card.setAttribute('aria-label', startWords(template));
    card.dataset.platform = template.platform;
    const picture = make('img');
    picture.src = `assets/format-${template.key}.jpg`;
    picture.alt = '';
    picture.width = 380;
    picture.height = 250;
    picture.draggable = false;
    const name = make('span', 'name');
    name.append(make('span', '', template.name), make('span', 'aspect', template.aspect));
    card.append(picture, name, make('span', 'sub', template.sub));
    card.addEventListener('click', () => go(`${routeFor('ideas')}?template=${template.key}`));
    popular.append(card);
  }
  const yours = section('Your ideas', 'Pick an idea to start creating, or develop a new one.');
  // The one quiet tag that says the drawn ideas are samples sits by their heading.
  yours.querySelector('h2').after(' ', document.querySelector('[data-testid="sample-tag"]'));
  // One quiet way to the bundled sample take.
  const sample = make('button', 'quiet', 'Try the sample');
  sample.type = 'button';
  sample.dataset.testid = 'gallery-sample';
  sample.addEventListener('click', () => go('/prepare/sample'));
  yours.append(sample);
  const grid = document.querySelector('.grid');
  grid.before(section('Popular formats', 'Pick a format to get started, or choose one of your ideas below.'), popular, yours);

  // Each drawn card says its format and where it is headed, and takes the Loom's
  // shape: the picture edge to edge, then the title beside its three dots, then
  // one line of format, place and date, then the description.
  for (const card of document.querySelectorAll('.card')) {
    card.dataset.platform = BUNDLED_PLATFORM[card.dataset.id] || 'YouTube';
    card.querySelector('.tag').textContent = `${card.dataset.format} · ${card.dataset.platform}`;
    const top = make('div', 'card-top');
    const meta = make('div', 'card-meta');
    card.querySelector('.card-title').before(top);
    top.append(card.querySelector('.card-title'), card.querySelector('.more'));
    meta.append(card.querySelector('.tag'), card.querySelector('.updated'));
    top.after(meta);
    card.querySelector('.rule').remove();
    card.querySelector('.card-foot').remove();
  }

  // The last tile of the grid starts a new idea. It is not an idea, so no chip or search hides it.
  const tile = make('button', 'tile');
  tile.type = 'button';
  tile.dataset.testid = 'develop-idea';
  tile.innerHTML = '<span class="plus"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>';
  tile.append(make('strong', '', 'Develop a new idea'), make('span', 'sub', 'Start with a thought, voice note or blank canvas.'));
  tile.addEventListener('click', () => go(routeFor('ideas')));
  grid.append(tile);

  // Search and the chips decide together what shows; the approved shell file is not edited.
  const filters = wireFilters(document);
  const refreshFilters = () => filters.refresh();

  // A pressed platform chip rings that platform's format card. When the chip finds
  // no idea, the no-match message offers to start one headed there.
  const startHere = make('button', 'outline empty-start');
  startHere.type = 'button';
  startHere.dataset.testid = 'gallery-empty-start';
  startHere.hidden = true;
  document.querySelector('[data-testid="gallery-empty"]').append(startHere);
  startHere.addEventListener('click', () => go(`${routeFor('ideas')}?template=${startHere.dataset.template}`));
  const followChip = () => {
    const pressed = document.querySelector('.pill[data-chip][aria-pressed="true"]');
    const platform = pressed ? pressed.dataset.platform : undefined;
    for (const each of popular.children) each.classList.toggle('is-chip', each.dataset.platform === platform);
    const template = TEMPLATES.find((each) => each.platform === platform);
    const none = !document.querySelector('.grid > .card:not([hidden])');
    startHere.hidden = !(template && none && document.querySelector('[data-testid="search-input"]').value.trim() === '');
    if (template) {
      startHere.dataset.template = template.key;
      startHere.textContent = startWords(template);
    }
  };
  document.addEventListener('click', followChip);
  document.addEventListener('input', followChip);
  document.addEventListener('keyup', followChip);
  const titleOf = (card) => card.querySelector('.card-title').textContent;
  /** The idea a card stands for, drawn or saved. */
  const ideaOf = (card) => (card.dataset.custom ? { id: card.dataset.id, state: card.dataset.state } : { id: ideaIdOf(Number(card.dataset.id)), state: 'saved' });
  const openCard = (card) => {
    const { id, state } = ideaOf(card);
    if (id) go(routeFor(state === 'thought' ? 'idea' : 'beats', { id }));
  };

  /** Put a title on a card: the heading, its full words on hover, and the names read aloud. */
  function setTitle(card, title) {
    const heading = card.querySelector('.card-title');
    heading.textContent = title;
    heading.title = title;
    if (card.dataset.custom) {
      card.title = title;
      card.setAttribute('aria-label', `${card.dataset.state === 'thought' ? 'Continue exploring' : 'Open idea'}: ${title}`);
    }
    const more = card.querySelector('.more');
    if (more) more.setAttribute('aria-label', `More options for ${title}`);
  }

  function renameCard(card, more) {
    const { id } = ideaOf(card);
    openRenameDialog(document, {
      title: titleOf(card),
      returnFocus: more,
      onSave: async (value) => {
        let saved;
        try {
          saved = await patchIdea(id, { rename: value });
        } catch (err) {
          // The server's own words when it answered; one plain line when it did not.
          const refused = err && typeof (/** @type {any} */ (err).status) === 'number';
          throw new Error(refused ? /** @type {Error} */ (err).message : NOT_REACHED);
        }
        if (!saved) throw new Error('That idea is no longer kept on this device. Nothing was renamed.');
        setTitle(card, saved.title);
        refreshFilters();
      },
    });
  }

  /** Make a card's three-dot button a real menu. The press stops here, so it never picks the card. */
  function wireMenu(card) {
    const more = card.querySelector('.more');
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (more.getAttribute('aria-expanded') === 'true' && closeCardMenu(document)) return;
      openCardMenu(document, more, { onOpen: () => openCard(card), onRename: () => renameCard(card, more) });
    });
    more.setAttribute('aria-label', `More options for ${titleOf(card)}`);
  }

  for (const card of document.querySelectorAll('.card')) wireMenu(card);

  // Newly saved ideas remain reachable; drawn sample cards keep their drawn look.
  const coached = fetch(`${APP_API}idea-coach`, { mode: 'same-origin', credentials: 'same-origin', cache: 'no-store' }).then((res) => (res.ok ? res.json() : {})).then((data) => data.ideas || {}).catch(() => ({}));
  Promise.all([listIdeas(), coached]).then(([ideas, coachedIdeas]) => {
    const template = document.querySelector('.card');
    // A title kept on a drawn card (a rename) shows again after a reload.
    BUNDLED.forEach((id, i) => {
      const idea = ideas.find((each) => each.id === id);
      const card = document.querySelector(`.card[data-id="${i + 1}"]`);
      if (idea && card && typeof idea.title === 'string' && idea.title && idea.title !== titleOf(card)) setTitle(card, idea.title);
    });
    for (const idea of ideas.filter((i) => !BUNDLED.includes(i.id) && ['saved', 'thought'].includes(i.state))) {
      const card = template.cloneNode(true);
      card.dataset.testid = 'saved-' + idea.id;
      card.setAttribute('data-testid', 'saved-' + idea.id);
      card.dataset.id = idea.id;
      card.hidden = false;
      card.dataset.custom = '1';
      card.dataset.state = idea.state;
      const format = formatNamed(idea.format) ? idea.format : 'Talking head';
      const platform = templateOf(coachedIdeas[idea.id] && coachedIdeas[idea.id].template).platform;
      card.dataset.format = format;
      card.dataset.platform = platform;
      card.dataset.extra = idea.thought || '';
      for (const child of card.querySelectorAll('[data-testid]')) child.removeAttribute('data-testid');
      const title = card.querySelector('.card-title');
      const description = card.querySelector('.card-desc');
      title.textContent = idea.title;
      // The line under the title is the person's own: their first thought, or their first beat when the thought is the title.
      const firstBeat = idea.keptBeats && idea.keptBeats[0] ? idea.keptBeats[0].line : '';
      const ownWords = idea.thought && idea.thought.replace(/[.!?\s]+$/, '') !== idea.title ? idea.thought : '';
      description.textContent = idea.state === 'thought' ? (ownWords || 'Continue exploring this thought.') : (ownWords || firstBeat);
      // The card clamps both to two lines, as on a sample card; the full words show on hover and when the idea is opened.
      for (const text of [title, description]) text.title = text.textContent;
      card.querySelector('.updated').textContent = idea.state === 'thought' ? 'Saved thought' : 'Your idea';
      card.querySelector('.tag').textContent = `${format} · ${platform}`;
      card.querySelector('.more').setAttribute('data-testid', 'more-' + idea.id);
      setTitle(card, idea.title);
      // A press on the three-dot button is the menu's own (wireMenu stops it); only the card itself opens.
      card.onclick = (e) => { if (!e.target.closest('.more')) openCard(card); };
      card.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openCard(card); } };
      // A person's idea has no photograph. Its picture is its picked direction, or its title, set as a thumbnail sets words, filling the picture box.
      const words = make('div', 'thumb-words');
      words.append(make('span', '', idea.thumb || idea.title));
      card.querySelector('img').replaceWith(words);
      wireMenu(card);
      grid.prepend(card);
    }
    refreshFilters();
  }).catch((e) => sayQuietly(document, 'Could not read saved ideas: ' + e.message));
}
