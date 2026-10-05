// What every screen shares (Plan 02-01): shell mode, go(), the nav and the
// quiet line (coming soon, and since Plan 02-04 any other one line a screen
// must say). A screen's own wire.js imports from here, so no screen carries
// nav code of its own.
//
// Nothing here builds markup from words: every line is written with
// textContent (threat T-02-02). Nothing here reads, prints or sends a key.

/** The query that opens a page in shell mode (QUESTIONS.md Q148). Any value counts: `?shell` and `?shell=1` alike. */
export const SHELL_QUERY = 'shell';

/**
 * Where the nav's links go (D-110). Ideas, Create and Review open a screen; Home
 * and Grow say coming soon. Kept in one place so a link can be moved
 * from one list to the other when its screen is built.
 */
export const NAV_OPENS = Object.freeze({ 'nav-ideas': '/', 'nav-create': '/create', 'nav-review': '/review' });
export const NAV_SOON = Object.freeze(['nav-home', 'nav-grow']);

/** How long the coming-soon line stays, in milliseconds. The edit shell's own toast stays this long. */
export const SOON_MS = 2500;

/** How long any other quiet line stays, in milliseconds: long enough to read a sentence. */
export const SAY_MS = 8000;

/** The hook of the line comingSoon appends on a page that has no toast of its own. */
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
 * Say one line in the quietest part the page already has: what YAP cannot do
 * yet, why it cannot hear, or the words its own server refused something with.
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
 * Say that a control is coming soon, through sayQuietly. The line is the
 * control's own label followed by "is coming soon", and it goes after SOON_MS.
 * On a page with no toast of its own the control, when given, also gets the
 * line as its title and "coming soon" after its label for a screen reader.
 *
 * @param {Document} document
 * @param {string} label the control's own label
 * @param {Element} [control] the control that was pressed
 * @returns {Element} the element the line was written into
 */
export function comingSoon(document, label, control) {
  const name = String(label || '').replace(/\s+/g, ' ').trim();
  const line = name ? `${name} is coming soon` : 'Coming soon';
  if (control && !document.querySelector('[data-testid="toast"]')) {
    control.setAttribute('title', line);
    control.setAttribute('aria-label', name ? `${name}, coming soon` : 'Coming soon');
  }
  return /** @type {Element} */ (sayQuietly(document, line, SOON_MS));
}

/**
 * Wire the nav the shells draw (D-110). Its links carry the hooks nav-home,
 * nav-ideas, nav-create, nav-review and nav-grow. Ideas opens `/` and Create
 * opens `/create`, Review opens `/review`, each through go(). Home and Grow say coming soon
 * and change no address. Every other link drawn with href="#" is stopped, so
 * a press on one never leaves the page.
 * @param {Document} document
 */
export function wireNav(document) {
  const scope = document.defaultView || globalThis;
  document.addEventListener('click', (event) => {
    const target = /** @type {any} */ (event.target);
    const link = target && typeof target.closest === 'function' ? target.closest('a') : null;
    if (!link || link.getAttribute('href') !== '#') return;
    event.preventDefault();
    const hook = link.dataset.testid;
    if (Object.prototype.hasOwnProperty.call(NAV_OPENS, hook)) {
      go(NAV_OPENS[hook], scope);
    } else if (NAV_SOON.includes(hook)) {
      // Its own label, read before the first press adds anything to it.
      comingSoon(document, link.textContent, link);
    }
  });
}
