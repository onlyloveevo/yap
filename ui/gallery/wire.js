// The Create gallery, wired (D-116). The page is the approved shell, and its
// own script (gallery.js) does the format filters and search and fires the
// shell's events. This module answers those events, wires the nav, builds the
// saved ideas' own cards, and runs each card's three-dot menu (Open, Rename).
// Outside shell mode a rename is one patchIdea to this app's own server; in
// shell mode search and the menus still say coming soon and change nothing.
import { comingSoon, go, isShellMode, sayQuietly, wireNav } from '../lib/app.js';
import { listIdeas, patchIdea } from '../lib/api.js';
import { closeCardMenu, openCardMenu, openRenameDialog, wireFilters } from '../lib/gallery-controls.js';
import { routeFor } from '../lib/routes.js';

/** The id of the bundled sample idea: the first card (D-116, D-117). */
const SAMPLE_ID = 'sample';
/** The six drawn cards are the bundled sample bank. */
const CARDS = 6;
const BUNDLED = [SAMPLE_ID, 'idea-2', 'idea-3', 'idea-4', 'idea-5', 'idea-6'];
const NOT_REACHED = 'YAP could not reach its own server. Nothing was renamed.';

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

const shell = isShellMode(location);

wireNav(document);

// Picking a card opens the beat list for that idea.
document.addEventListener('yap:idea-pick', (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  const id = ideaIdOf(detail && detail.id);
  if (id) go(routeFor('beats', { id }));
});

// "Develop a new idea" opens the Ideas opening.
document.addEventListener('yap:idea-new', () => go(routeFor('ideas')));

if (shell) {
  // In shell mode search and the three-dot menus are not built: each says coming
  // soon and changes nothing (D-116). Each one's label is its own, read here,
  // before the first press adds "coming soon" to it.
  const SOON = '[data-testid="search"], .more';
  const soonLabels = new Map([...document.querySelectorAll(SOON)].map((control) => [control, control.getAttribute('aria-label') || '']));
  document.addEventListener('click', (event) => {
    const target = /** @type {any} */ (event.target);
    const control = target && typeof target.closest === 'function' ? target.closest(SOON) : null;
    if (control && soonLabels.has(control)) comingSoon(document, soonLabels.get(control), control);
  });
}

if (!shell) {
  // Search and the format pills decide together what shows; the approved shell file is not edited.
  const filters = wireFilters(document);
  const refreshFilters = () => filters.refresh();
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

  for (const card of document.querySelectorAll('.card')) {
    const updated = card.querySelector('.updated');
    if (updated) updated.textContent = 'Bundled example idea';
    wireMenu(card);
  }

  // Newly saved ideas remain reachable; drawn sample cards keep their drawn look.
  listIdeas().then((ideas) => {
    const grid = document.querySelector('.grid');
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
      card.dataset.format = idea.format;
      card.dataset.extra = idea.thought || '';
      for (const child of card.querySelectorAll('[data-testid]')) child.removeAttribute('data-testid');
      const title = card.querySelector('.card-title');
      const description = card.querySelector('.card-desc');
      title.textContent = idea.title;
      description.textContent = idea.state === 'thought' ? 'Saved thought · continue exploring' : idea.thought;
      // Compact only authored cards; full words remain available when opening or inspecting them.
      for (const text of [title, description]) {
        text.title = text.textContent;
        Object.assign(text.style, { display: '-webkit-box', webkitBoxOrient: 'vertical', webkitLineClamp: '3', overflow: 'hidden', overflowWrap: 'anywhere' });
      }
      card.querySelector('.updated').textContent = 'Saved on this device';
      card.querySelector('.tag').textContent = idea.format;
      card.querySelector('.more').setAttribute('data-testid', 'more-' + idea.id);
      setTitle(card, idea.title);
      // A press on the three-dot button is the menu's own (wireMenu stops it); only the card itself opens.
      card.onclick = (e) => { if (!e.target.closest('.more')) openCard(card); };
      card.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openCard(card); } };
      card.querySelector('img')?.remove();
      card.querySelector('.thumb').style.minHeight = '80px';
      wireMenu(card);
      grid.prepend(card);
    }
    refreshFilters();
  }).catch((e) => sayQuietly(document, 'Could not read saved ideas: ' + e.message));

  const original = document.querySelector('[data-testid="new-idea"]');
  const group = document.createElement('div');
  Object.assign(group.style, { display: 'flex', gap: '10px', flexWrap: 'wrap' });
  original.before(group);
  group.append(original);
  for (const [label, hook, path] of [['Just talk', 'just-talk', '/prepare/new?start=talk'], ['Try the sample', 'gallery-sample', '/prepare/sample']]) {
    const button = original.cloneNode(true);
    button.textContent = label;
    button.dataset.testid = hook;
    button.onclick = () => go(path);
    group.append(button);
  }
  for (const hook of ['nav-home', 'nav-grow']) {
    const item = document.querySelector(`[data-testid="${hook}"]`);
    if (item) {
      item.append(document.createTextNode(' · soon'));
      item.setAttribute('aria-disabled', 'true');
    }
  }
}
