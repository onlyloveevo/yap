// The app's routes (D-104), as pure functions. The server uses them to pick
// the screen folder for a request path, and the screens use them to build the
// address a press opens. No imports, so the page and Node load the same file.

/**
 * An id in a route: 1 to 64 lower-case letters, digits and hyphens, starting
 * with a letter or a digit. The same rule as a Recording id (isRecordingId in
 * src/engine/recording.js); test/ui-routes.test.js holds the two together.
 */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Every route: its name, its pattern (`:id` stands for one id) and the screen
 * folder under ui/ whose page answers it. A route with a `query` matches only
 * when the address carries those values, and is listed before the plain route
 * of the same pattern.
 *
 * `/ideas/:id` is one idea being developed. Its state picks which of three
 * screens is shown; that choice is made behind the `idea` screen, not here.
 */
export const ROUTES = Object.freeze(
  [
    { name: 'ideas', pattern: '/', screen: 'ideas' },
    { name: 'idea', pattern: '/ideas/:id', screen: 'idea' },
    { name: 'gallery', pattern: '/create', screen: 'gallery' },
    { name: 'beats', pattern: '/create/:id/beats', screen: 'beats' },
    { name: 'prepare', pattern: '/prepare/:id', screen: 'prepare' },
    { name: 'return', pattern: '/record/:id', screen: 'return', query: Object.freeze({ take: '2' }) },
    { name: 'record', pattern: '/record/:id', screen: 'record' },
    { name: 'edit', pattern: '/video/:id/edit', screen: 'edit' },
    { name: 'present', pattern: '/present', screen: 'present' },
  ].map((route) => Object.freeze(route))
);

/** The query of an address as URLSearchParams, whatever form it came in. */
function readQuery(searchParams) {
  if (searchParams instanceof URLSearchParams) return searchParams;
  if (typeof searchParams === 'string') return new URLSearchParams(searchParams);
  return new URLSearchParams();
}

/**
 * The id a path carries under a pattern: '' for a pattern with no id, the id
 * when the path fits, and null when it does not. Nothing is decoded, so an
 * encoded letter is not a letter of an id.
 * @param {string} pattern
 * @param {string} pathname
 */
function idUnder(pattern, pathname) {
  const at = pattern.indexOf(':id');
  if (at === -1) return pathname === pattern ? '' : null;
  const before = pattern.slice(0, at);
  const after = pattern.slice(at + 3);
  if (pathname.length <= before.length + after.length) return null;
  if (!pathname.startsWith(before) || !pathname.endsWith(after)) return null;
  const id = pathname.slice(before.length, pathname.length - after.length);
  return ID.test(id) ? id : null;
}

/**
 * The route a path names, or null.
 * @param {string} pathname the path alone, without its query, as it was sent
 * @param {URLSearchParams | string} [searchParams] the address's query
 * @returns {{ name: string, screen: string, params: { id?: string } } | null}
 */
export function matchRoute(pathname, searchParams) {
  if (typeof pathname !== 'string') return null;
  const query = readQuery(searchParams);
  for (const route of ROUTES) {
    const id = idUnder(route.pattern, pathname);
    if (id === null) continue;
    if (route.query && !Object.entries(route.query).every(([key, value]) => query.get(key) === value)) continue;
    return { name: route.name, screen: route.screen, params: id === '' ? {} : { id } };
  }
  return null;
}

/**
 * The address of a route.
 * @param {string} name a route name from ROUTES
 * @param {{ id?: string }} [params]
 * @returns {string} a path, with its query where the route has one
 */
export function routeFor(name, params = {}) {
  const route = ROUTES.find((r) => r.name === name);
  if (!route) throw new TypeError(`No route is named ${JSON.stringify(name)}.`);
  let address = route.pattern;
  if (route.pattern.includes(':id')) {
    const id = params && params.id;
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new TypeError(`The route ${name} needs an id of 1 to 64 lower-case letters, digits and hyphens.`);
    }
    address = route.pattern.replace(':id', id);
  }
  if (route.query) address += `?${new URLSearchParams(route.query).toString()}`;
  return address;
}
