// The Create gallery's working controls: search, the three-dot card menu and
// Rename (F07). The page's own scripts (ui/gallery/gallery.js and wire.js) call
// these; the words a person types are only ever written with textContent and
// value, never as markup.
//
// Search is one filter beside the format pills: a card shows when it matches
// the pressed pill AND every word typed in the search field. It reads the card
// as drawn (title, description, format tag, and the saved thought a created
// card carries in data-extra), so a bundled card and a saved one answer alike.
//
// Rename sends one request through the page's own patchIdea (ui/lib/api.js);
// the server checks the title again (src/node/idea-store.js cleanTitle). When
// the request fails the dialog stays open with the typed words and the card
// keeps the title it had.

/** The longest search the field takes, in characters. */
export const QUERY_MAX = 80;
/** The longest title a rename takes, in characters. The server holds the same number (idea-store TITLE_MAX). */
export const TITLE_MAX = 120;

/** Lower case, accents dropped, white space runs made one space: how both sides of a match are read. */
export function normalizeText(text) {
  return String(text === undefined || text === null ? '' : text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a text holds every word of a query. An empty query matches all.
 * @param {string} haystack
 * @param {string} query
 */
export function matchesQuery(haystack, query) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeText(haystack);
  return words.every((word) => text.includes(word));
}

/**
 * A title as the person typed it, checked the way the server checks it.
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function checkTitle(value) {
  if (typeof value !== 'string') return { ok: false, error: 'A title is text.' };
  const plain = value.replace(/\s+/g, ' ').trim();
  if (plain === '') return { ok: false, error: 'Write a title first.' };
  if (/\p{Cc}/u.test(plain)) return { ok: false, error: 'A title is plain text.' };
  const length = Array.from(plain).length;
  if (length > TITLE_MAX) return { ok: false, error: `A title is at most ${TITLE_MAX} characters (this one is ${length}).` };
  return { ok: true, value: plain };
}

/** What a search reads on a card. */
export function searchTextOf(card) {
  const read = (selector) => {
    const found = card.querySelector(selector);
    return found ? found.textContent : '';
  };
  return [read('.card-title'), read('.card-desc'), read('.tag'), card.dataset ? card.dataset.extra || '' : ''].join(' ');
}

/**
 * Show the cards that match the pressed format and the search words; hide the rest.
 * @param {Iterable<any>} cards
 * @param {{ format: string | null, query: string }} state
 * @returns {number} how many cards are showing
 */
export function applyFilters(cards, state) {
  let shown = 0;
  for (const card of cards) {
    const formatOk = !state.format || card.dataset.format === state.format;
    const visible = formatOk && matchesQuery(searchTextOf(card), state.query);
    card.hidden = !visible;
    if (visible) shown += 1;
  }
  return shown;
}

const el = (document, tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const MENU_HOOK = 'card-menu';

/** Close the card menu if one is open. */
export function closeCardMenu(document) {
  const open = document.querySelector(`[data-testid="${MENU_HOOK}"]`);
  if (!open) return false;
  if (typeof open._yapClose === 'function') open._yapClose();
  else open.remove();
  return true;
}

/**
 * Open the card menu under a card's three-dot button: Open and Rename. The menu
 * is put on the page, not in the card, so a press on it never reaches the card.
 * Arrow keys move, Escape closes and gives the focus back to the button.
 * @param {Document} document
 * @param {HTMLElement} button
 * @param {{ onOpen: () => void, onRename: () => void }} actions
 */
export function openCardMenu(document, button, actions) {
  closeCardMenu(document);
  const menu = el(document, 'div', 'card-menu');
  menu.dataset.testid = MENU_HOOK;
  menu.setAttribute('data-testid', MENU_HOOK);
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Idea options');
  const items = [['Open', 'card-menu-open', actions.onOpen], ['Rename', 'card-menu-rename', actions.onRename]].map(([label, hook, run]) => {
    const item = el(document, 'button', 'card-menu-item', label);
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-testid', hook);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      close(false);
      run();
    });
    menu.append(item);
    return item;
  });

  function close(refocus) {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    button.setAttribute('aria-expanded', 'false');
    menu.remove();
    if (refocus) button.focus();
  }
  const outside = (event) => { if (!menu.contains(event.target) && !button.contains(event.target)) close(false); };
  menu._yapClose = () => close(false);

  menu.addEventListener('keydown', (event) => {
    const at = items.indexOf(/** @type {any} */ (document.activeElement));
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length].focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
    else if (event.key === 'Tab') close(false);
  });

  document.body.append(menu);
  // The menu hugs its button: it is put under it now, and again when the page scrolls or resizes.
  const place = () => {
    const at = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8));
    const top = Math.min(at.bottom + 6, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(Math.max(8, top))}px`;
  };
  menu._yapPlace = place;
  place();
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  items[0].focus();
  return menu;
}

/**
 * The rename dialog: one field, Save and Cancel. Escape or Cancel closes it with
 * nothing changed; Save checks the title, calls `onSave(title)`, and closes only
 * when that resolves. A refusal (a thrown error) is said in the dialog, in the
 * server's own words, and the typed title stays.
 * @param {Document} document
 * @param {{ title: string, onSave: (title: string) => Promise<void>, returnFocus?: HTMLElement | null }} options
 */
export function openRenameDialog(document, { title, onSave, returnFocus }) {
  const dialog = /** @type {HTMLDialogElement} */ (el(document, 'dialog', 'rename-dialog'));
  dialog.setAttribute('data-testid', 'rename-dialog');
  dialog.setAttribute('aria-labelledby', 'rename-heading');
  const form = el(document, 'form', 'rename-form');
  form.noValidate = true;
  const heading = el(document, 'h2', 'rename-heading', 'Rename idea');
  heading.id = 'rename-heading';
  const label = el(document, 'label', 'rename-label', 'Idea title');
  label.htmlFor = 'rename-input';
  const input = /** @type {HTMLInputElement} */ (el(document, 'input', 'rename-input'));
  input.id = 'rename-input';
  input.type = 'text';
  input.value = title;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('data-testid', 'rename-input');
  input.setAttribute('aria-describedby', 'rename-note');
  const note = el(document, 'p', 'rename-note');
  note.id = 'rename-note';
  note.setAttribute('data-testid', 'rename-note');
  note.setAttribute('role', 'status');
  const count = () => { note.classList.remove('is-error'); note.textContent = `${Array.from(input.value).length} / ${TITLE_MAX}`; };
  const fail = (words) => { note.classList.add('is-error'); note.setAttribute('role', 'alert'); note.textContent = words; };
  count();
  const actions = el(document, 'div', 'rename-actions');
  const cancel = el(document, 'button', 'rename-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.setAttribute('data-testid', 'rename-cancel');
  const save = el(document, 'button', 'rename-save', 'Save');
  save.type = 'submit';
  save.setAttribute('data-testid', 'rename-save');
  actions.append(cancel, save);
  form.append(heading, label, input, note, actions);
  dialog.append(form);

  let saving = false;
  input.addEventListener('input', () => { note.setAttribute('role', 'status'); count(); });
  cancel.addEventListener('click', () => { if (!saving) dialog.close(); });
  // Escape asks the dialog to cancel; while a save is in flight it waits for the answer.
  dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    // Nothing typed that changes the title: nothing is sent (an old title longer than the limit is left alone too).
    if (input.value.replace(/\s+/g, ' ').trim() === title.replace(/\s+/g, ' ').trim()) { dialog.close(); return; }
    const checked = checkTitle(input.value);
    if (!checked.ok) { fail(checked.error); input.focus(); return; }
    saving = true;
    save.disabled = true;
    cancel.disabled = true;
    try {
      await onSave(checked.value);
      saving = false;
      dialog.close();
    } catch (err) {
      saving = false;
      save.disabled = false;
      cancel.disabled = false;
      fail(err instanceof Error && err.message ? err.message : 'YAP could not rename that idea.');
      input.focus();
    }
  });

  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
  return dialog;
}

// ---------- the page's own additions ----------
//
// The approved Create shell (ui/gallery/index.html, styles.css, gallery.js) is
// fingerprinted and is not edited. What search, the menu and Rename need is
// built here, outside shell mode only: the stylesheet below is added to the page
// as a <style> element, and the search field and the no-match message are made
// by mountSearch. In shell mode none of it exists and the shell is as drawn.

/** The stylesheet of the additions. It uses the page's own custom properties, so it follows the approved look. */
export const GALLERY_CSS = `
.card-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.card-desc { overflow-wrap: anywhere; }
.searchbox[hidden], .search-clear[hidden], .empty[hidden], .empty-clear[hidden] { display: none; }
.square { cursor: pointer; }
.square[aria-expanded="true"] { color: var(--amber); border-color: var(--amber); background: var(--amber-tint); }
.searchbox { position: relative; margin-left: auto; flex: 0 1 300px; min-width: 0; }
.searchbox + .square { margin-left: 0; }
.search-input { width: 100%; height: 52px; padding: 0 44px 0 var(--space-4); border: 1px solid var(--field-border); border-radius: var(--radius-nav); background: var(--field); color: var(--white); font: inherit; font-size: 16px; }
.search-input::placeholder { color: var(--white-dim); }
.search-input::-webkit-search-cancel-button { display: none; }
.search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-round); background: transparent; color: var(--white-soft); }
.search-clear svg { width: 18px; height: 18px; }
.search-status { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.empty { margin-top: var(--space-6); padding: var(--space-8) var(--space-4); text-align: center; border: 1px dashed var(--card-border); border-radius: var(--radius-card); }
.empty-line { margin: 0 0 var(--space-4); font-size: 19px; color: var(--white-soft); overflow-wrap: anywhere; }
.empty-clear { margin: 0 auto; height: 46px; font-size: 16px; padding: 0 var(--space-5); }
.more { cursor: pointer; }
.more:hover, .more[aria-expanded="true"] { color: var(--amber); background: var(--amber-tint); }
.card-menu { position: fixed; z-index: 60; min-width: 160px; padding: var(--space-2); display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--glass-border); border-radius: var(--radius-nav); background: rgb(24,21,19); box-shadow: var(--shadow); font-family: var(--font); }
.card-menu-item { height: 42px; padding: 0 var(--space-4); border: 0; border-radius: 8px; background: transparent; color: var(--white); font-size: 16px; text-align: left; cursor: pointer; }
.card-menu-item:hover, .card-menu-item:focus-visible { background: var(--amber-tint); color: var(--amber); outline-offset: -2px; }
.rename-dialog { width: min(460px, calc(100vw - 32px)); padding: var(--space-6); border: 1px solid var(--glass-border); border-radius: var(--radius-panel); background: rgb(24,21,19); color: var(--white); box-shadow: var(--shadow); font-family: var(--font); }
.rename-dialog::backdrop { background: rgba(0,0,0,.55); }
.rename-form { display: flex; flex-direction: column; gap: var(--space-3); }
.rename-heading { margin: 0; font-size: 24px; font-weight: 600; }
.rename-label { font-size: 14px; color: var(--white-soft); }
.rename-input { width: 100%; height: 50px; padding: 0 var(--space-4); border: 1px solid var(--field-border); border-radius: var(--radius-nav); background: var(--field); color: var(--white); font: inherit; font-size: 17px; }
.rename-note { margin: 0; min-height: 20px; font-size: 14px; color: var(--white-dim); overflow-wrap: anywhere; }
.rename-note.is-error { color: var(--amber); }
.rename-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-2); }
.rename-cancel, .rename-save { height: 46px; padding: 0 var(--space-6); border-radius: var(--radius-field); font-size: 16px; font-weight: 500; cursor: pointer; }
.rename-cancel { border: 1px solid var(--field-border); background: var(--chip-bg); }
.rename-save { border: 1px solid var(--amber); background: var(--amber); color: var(--ink); }
.rename-save:disabled, .rename-cancel:disabled { opacity: .5; cursor: default; }
@media (max-width: 760px) {
  :root { --nav-width: 60px; --panel-pad: 14px; --pad-right: 10px; --card-gap: 14px; --top: 12px; --bottom: 12px; }
  .brand { font-size: 18px; padding: 16px 0 0; margin-bottom: 14px; text-align: center; }
  .nav { padding: 0 var(--space-1); }
  .nav-item { font-size: 0; justify-content: center; gap: 0; padding: 0; }
  .stage { padding-left: 10px; }
  .gallery { padding-top: var(--space-5); padding-bottom: var(--space-5); }
  .head { flex-direction: column; align-items: stretch; }
  .title { font-size: 28px; }
  .subtitle { font-size: 16px; }
  .outline { height: 46px; padding: 0 var(--space-4); font-size: 15px; }
  .filters { flex-wrap: wrap; margin-top: var(--space-4); }
  .pill { height: 40px; padding: 0 var(--space-4); font-size: 15px; }
  .square { width: 44px; height: 44px; }
  .searchbox { flex: 1 1 100%; order: 10; margin-left: 0; }
  .searchbox + .square { margin-left: auto; }
  .search-input { height: 46px; }
  .grid { grid-template-columns: minmax(0, 1fr); }
  .card-title { font-size: 18px; }
  .card-desc { font-size: 14.5px; }
}
`;

/** Add a stylesheet to the page once, by its id. */
export function injectStyles(document, id, css) {
  if (document.querySelector(`style[data-yap="${id}"]`)) return;
  const style = el(document, 'style');
  style.dataset.yap = id;
  style.textContent = css;
  document.head.append(style);
}

const hook = (node, name) => { node.setAttribute('data-testid', name); return node; };

/** The search field, its clear button, the sr-only count and the no-match message, put where the shell leaves room. */
function mountSearch(document) {
  const filters = document.querySelector('.filters');
  const toggle = document.querySelector('[data-testid="search"]');
  const grid = document.querySelector('.grid');
  const box = hook(el(document, 'div', 'searchbox'), 'search-box');
  box.id = 'search-box';
  box.setAttribute('role', 'search');
  box.hidden = true;
  const input = /** @type {HTMLInputElement} */ (hook(el(document, 'input', 'search-input'), 'search-input'));
  input.type = 'search';
  input.placeholder = 'Search ideas';
  input.maxLength = QUERY_MAX;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search ideas');
  const clear = /** @type {HTMLButtonElement} */ (hook(el(document, 'button', 'search-clear'), 'search-clear'));
  clear.type = 'button';
  clear.hidden = true;
  clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  box.append(input, clear);
  toggle.before(box);
  toggle.setAttribute('aria-controls', 'search-box');
  toggle.setAttribute('aria-expanded', 'false');
  const status = hook(el(document, 'p', 'search-status'), 'search-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const empty = hook(el(document, 'div', 'empty'), 'gallery-empty');
  empty.hidden = true;
  const emptyLine = hook(el(document, 'p', 'empty-line'), 'gallery-empty-line');
  const emptyClear = /** @type {HTMLButtonElement} */ (hook(el(document, 'button', 'outline empty-clear', 'Clear search'), 'gallery-empty-clear'));
  emptyClear.type = 'button';
  empty.append(emptyLine, emptyClear);
  grid.after(status, empty);
  return { filters, toggle, box, input, clear, status, empty, emptyLine, emptyClear };
}

const FORMAT_OF = { 'filter-talking-head': 'Talking head', 'filter-vlog': 'Vlog', 'filter-walkthrough': 'Walkthrough', 'filter-interview': 'Interview' };

/**
 * Make search work and make it compose with the format pills, over every card
 * on the page, drawn or saved. The shell's own script (gallery.js) still draws
 * its pill presses on the drawn cards; this adds one listener on the document,
 * which runs after the pill's own, and decides every card again from the pressed
 * pill AND the words typed. Call `refresh()` after cards are added or retitled.
 * @param {Document} document
 * @returns {{ refresh: () => void }}
 */
export function wireFilters(document) {
  injectStyles(document, 'gallery-controls', GALLERY_CSS);
  const ui = mountSearch(document);
  const state = { format: null, query: '' };
  const allCards = () => [...document.querySelectorAll('.grid > .card')];

  function refresh() {
    const shown = applyFilters(allCards(), state);
    const filtered = Boolean(state.format) || state.query.trim() !== '';
    ui.status.textContent = filtered ? `${shown} ${shown === 1 ? 'idea' : 'ideas'} shown` : '';
    ui.empty.hidden = shown !== 0;
    if (shown === 0) ui.emptyLine.textContent = state.query.trim() !== '' ? `No ideas match “${state.query.trim()}”.` : 'No ideas in this format yet.';
    ui.emptyClear.hidden = state.query.trim() === '';
  }
  const setQuery = (value) => {
    state.query = value.slice(0, QUERY_MAX);
    ui.clear.hidden = state.query === '';
    refresh();
  };
  const open = () => {
    ui.box.hidden = false;
    ui.toggle.setAttribute('aria-expanded', 'true');
    ui.input.focus();
  };
  const close = (refocus) => {
    ui.input.value = '';
    setQuery('');
    ui.box.hidden = true;
    ui.toggle.setAttribute('aria-expanded', 'false');
    if (refocus) ui.toggle.focus();
  };

  document.addEventListener('click', (event) => {
    const pill = event.target instanceof Element ? event.target.closest('.pill') : null;
    if (!pill) return;
    state.format = FORMAT_OF[pill.getAttribute('data-testid') || ''] || null;
    refresh();
  });
  ui.toggle.addEventListener('click', () => { if (ui.box.hidden) open(); else close(true); });
  ui.input.addEventListener('input', () => setQuery(ui.input.value));
  ui.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (ui.input.value) { ui.input.value = ''; setQuery(''); } else close(true);
  });
  ui.clear.addEventListener('click', () => { ui.input.value = ''; setQuery(''); ui.input.focus(); });
  ui.emptyClear.addEventListener('click', () => { ui.input.value = ''; setQuery(''); if (!ui.box.hidden) ui.input.focus(); });
  // "/" jumps to the search field, as long as the person is not typing somewhere.
  document.addEventListener('keydown', (event) => {
    const target = /** @type {any} */ (event.target);
    const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey && !document.querySelector('dialog[open]')) { event.preventDefault(); open(); }
  });
  return { refresh };
}
