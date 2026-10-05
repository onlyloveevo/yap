// What every screen shares (Plan 02-01): shell mode, go(), the nav, the quiet
// line (any one line a screen must say) and the shared look (theme.css). A
// screen's own wire.js imports from here, so no screen carries nav code or a
// ground and a typeface of its own.
//
// Nothing here builds markup from words: every line is written with
// textContent, and the nav's icons are built node by node (threat T-02-02).
// Nothing here reads, prints or sends a key.

/** The query that opens a page in shell mode (QUESTIONS.md Q148). Any value counts: `?shell` and `?shell=1` alike. */
export const SHELL_QUERY = 'shell';

/**
 * The nav: Ideas, Create and Review, in that order, and the screen each opens
 * (D-110). Every link opens a screen. Kept in one place so every screen with a
 * sidebar draws the same three links.
 */
export const NAV_OPENS = Object.freeze({ 'nav-ideas': '/', 'nav-create': '/create', 'nav-review': '/review' });

/** Each link's icon, as the paths of a 24 by 24 drawing. The same on every screen. */
export const NAV_ICONS = Object.freeze({
  'nav-ideas': ['M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z'],
  'nav-create': ['M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13', 'm18.5 3.5 2 2L12 14l-3 1 1-3z'],
  'nav-review': ['M4 21h16M5 14l3 3 5-6 3 3M7 4v2M3.5 5h7M17 3v3M15.5 4.5h3'],
});

/** The stylesheet that draws the sidebar, and the mark a page carries once it has it. */
export const NAV_STYLES = '/ui/lib/nav.css';

/** The stylesheet every screen shares: the ground, the glass and the type (ui/lib/theme.css). */
export const THEME_STYLES = '/ui/lib/theme.css';

/** How long any other quiet line stays, in milliseconds: long enough to read a sentence. */
export const SAY_MS = 8000;

/** The hook of the quiet line on a page that has no toast of its own. */
export const SOON_HOOK = 'coming-soon';

const soonTimers = new WeakMap();

/**
 * True when the page was opened in shell mode: it shows its shell's drawn
 * state, saves nothing, asks for no camera, microphone or model, and does not
 * leave the page.
 * @param {{ search?: string } | undefined} location
 */
export function isShellMode(location) {
  const search = location && typeof location.search === 'string' ? location.search : '';
  return new URLSearchParams(search).has(SHELL_QUERY);
}

/**
 * Open an address of this app. In shell mode the page stays where it is and
 * the address it would have opened is written to `data-yap-next` on the html
 * element, where a check reads it.
 * @param {string} path a path of this app: it starts with one slash
 * @param {{ location: any, document: any }} [scope] the window; left out, the page's own
 */
export function go(path, scope = globalThis) {
  // One leading slash, and no second slash or backslash after it: never another site.
  if (typeof path !== 'string' || !/^\/(?![/\\])/.test(path)) {
    throw new TypeError('go() opens only an address of this app: a path that starts with one slash.');
  }
  if (isShellMode(scope.location)) {
    scope.document.documentElement.dataset.yapNext = path;
    return;
  }
  scope.location.assign(path);
}

/**
 * Say one line in the quietest part the page already has: why YAP cannot
 * hear, or the words its own server refused something with.
 *
 * A page with a toast (an element with data-testid="toast", as the edit shell
 * draws) shows the line there. Any other page gets the line in one polite
 * live element appended to the body, made only from the page's own tokens, so
 * no stylesheet is added and no drawn element changes its look. A page has one
 * such place, so a new line takes the last one's. The line goes after `ms`.
 * An empty line takes the current one away, and adds nothing to a page that
 * has said nothing yet.
 *
 * The line is written with textContent, never as markup (threats T-02-02 and
 * T-02-07): it may carry a person's own words or the server's.
 *
 * @param {Document} document
 * @param {string} line the words to show; empty to take the line away
 * @param {number} [ms] how long the line stays, in milliseconds
 * @returns {Element | null} the element the line was written into; null when there was nothing to take away
 */
export function sayQuietly(document, line, ms = SAY_MS) {
  const words = String(line || '').replace(/\s+/g, ' ').trim();
  const view = document.defaultView || globalThis;
  let place = document.querySelector('[data-testid="toast"]') || document.querySelector(`[data-testid="${SOON_HOOK}"]`);
  if (!words) {
    if (place) {
      view.clearTimeout(soonTimers.get(place));
      place.hidden = true;
    }
    return place;
  }
  if (!place) {
    place = document.createElement('div');
    place.dataset.testid = SOON_HOOK;
    place.setAttribute('role', 'status');
    place.setAttribute('aria-live', 'polite');
    // The same quiet pill the edit shell draws its toast as, from the page's own tokens.
    const look = {
      position: 'fixed',
      bottom: 'var(--space-8)',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: 'var(--space-4) var(--space-6)',
      'border-radius': 'var(--radius-pill)',
      border: '1px solid var(--glass-border)',
      background: 'var(--glass)',
      color: 'var(--white)',
      'backdrop-filter': 'blur(var(--blur))',
      'box-shadow': 'var(--shadow)',
      'z-index': '10',
      'pointer-events': 'none',
    };
    for (const [property, value] of Object.entries(look)) place.style.setProperty(property, value);
    document.body.appendChild(place);
  }
  place.textContent = words;
  place.hidden = false;
  view.clearTimeout(soonTimers.get(place));
  soonTimers.set(
    place,
    view.setTimeout(() => {
      place.hidden = true;
    }, ms)
  );
  return place;
}

/**
 * Give the page the shared look: mark the html element with the page's screen
 * folder (data-yap-screen, read off the page's own base line), and add the one
 * stylesheet after the page's own, so its rules win. A page that already links
 * it is left as it is. Every screen imports this module, so every screen gets it.
 * @param {Document} document
 */
export function loadTheme(document) {
  const root = document.documentElement;
  const folder = /\/ui\/([a-z]+)\//.exec(String(document.baseURI || ''));
  if (folder && !root.dataset.yapScreen) root.dataset.yapScreen = folder[1];
  if (document.querySelector('link[href$="lib/theme.css"]')) return;
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = THEME_STYLES;
  document.head.appendChild(sheet);
}

/**
 * Draw the sidebar as every screen draws it: Ideas, Create, Review, each with
 * its icon from NAV_ICONS, and the one stylesheet that sizes them. A link that
 * opens nothing leaves. A page whose own file already holds exactly this is
 * left as it is.
 * @param {Document} document
 */
export function drawNav(document) {
  const nav = document.querySelector('nav[data-testid="nav"]');
  if (!nav) return;
  if (!document.querySelector(`link[href$="lib/nav.css"]`)) {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = NAV_STYLES;
    document.head.appendChild(sheet);
  }
  const SVG = 'http://www.w3.org/2000/svg';
  for (const link of nav.querySelectorAll('a')) {
    const paths = NAV_ICONS[link.dataset.testid];
    if (!paths) {
      link.remove();
      continue;
    }
    const drawn = [...link.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));
    if (drawn.length === paths.length && drawn.every((d, i) => d === paths[i])) continue;
    const icon = document.createElementNS(SVG, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    for (const d of paths) {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      icon.appendChild(path);
    }
    const old = link.querySelector('svg');
    if (old) old.replaceWith(icon);
    else link.prepend(icon);
  }
}

/**
 * Wire the nav (D-110). Its links carry the hooks nav-ideas, nav-create and
 * nav-review: Ideas opens `/`, Create opens `/create`, Review opens `/review`,
 * each through go(). Every other link drawn with href="#" is stopped, so a
 * press on one never leaves the page. Outside shell mode the sidebar is drawn
 * by drawNav; in shell mode a page stays as its reference shell drew it.
 * @param {Document} document
 */
export function wireNav(document) {
  const scope = document.defaultView || globalThis;
  if (!isShellMode(scope.location)) drawNav(document);
  document.addEventListener('click', (event) => {
    const target = /** @type {any} */ (event.target);
    const link = target && typeof target.closest === 'function' ? target.closest('a') : null;
    if (!link || link.getAttribute('href') !== '#') return;
    event.preventDefault();
    const hook = link.dataset.testid;
    if (Object.prototype.hasOwnProperty.call(NAV_OPENS, hook)) go(NAV_OPENS[hook], scope);
  });
}

// The shared look goes on as soon as a screen loads this module. Node loads it too, with no page.
if (typeof document !== 'undefined') loadTheme(document);
