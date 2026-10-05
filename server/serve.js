// YAP's localhost server (LIVE-05, D-12, D-13, D-31, D-34). Node built-ins only.
//
// It serves four folders and nothing else: debug/ (the one unstyled debug
// page), src/engine/ (the engine modules the pages import), sample/ (the
// bundled sample take) and ui/ (the screens, Phase 2: D-104, D-105). A screen
// is reached by its route (`/create` answers ui/gallery/index.html); the route
// table is ui/lib/routes.js. It also mints a short-lived OpenAI Realtime client
// secret for its own page, so the person's OPENAI_API_KEY stays in this Node
// process and never reaches the browser. And it asks a model for story beats
// for its own page (POST /api/model, server/model.js; SETUP-01, D-43).
//
// The page reaches the Node side through the app's API: every path under
// /api/app/ goes to server/app-api.js, which keeps the page's ideas in the data
// folder (D-104, D-105). It is the one place a new POST is answered.
//
// It also hands its own page the speech package's files, once that package is
// installed inside the app folder (GET /vendor/transformers/<file>; INST-02,
// D-68). That route reads one folder and nothing else:
// node_modules/@huggingface/transformers/dist. It is not one of the static
// folders above, and it adds nothing to them.
//
// Security notes (threats T-01-22 to T-01-25, T-01.1-07, T-01.1-23, T-02-01, T-02-02, T-02-04):
// - It always binds 127.0.0.1, whatever host listen() is given.
// - ui/ is one more static folder behind the same path rules as the others. A
//   screen route is matched against a closed table before any file is looked
//   up: its id is 1 to 64 lower-case letters, digits and hyphens, and nothing
//   in it is decoded. A screen page's policy differs from the debug page's
//   only in base-uri 'self', which the page's own base line needs.
// - The secret route and the model route answer only when Origin AND Host name
//   this server (127.0.0.1 or localhost on its own port). Another website in
//   the same browser, or a DNS-rebinding page, gets 403 and spends nothing.
// - The app's API is behind the same two checks: a request that writes must
//   pass fromOwnPage, a request that reads must pass fromOwnPageRead, and a
//   refusal reads nothing and writes nothing.
// - Static paths are decoded once, normalised, kept inside the allowed folders
//   and checked again after symlinks are resolved.
// - The vendor route takes one file name from a closed set of characters and
//   endings, decodes nothing, checks the real path is still inside its one
//   folder, and answers only this server's own page.
// - Nothing here logs a request, a header, a body or the key.

import fs from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { APP_API_PREFIX, handleAppApi } from './app-api.js';
import { handleModel } from './model.js';
import { mintClientSecret } from './realtime-secret.js';
import { instructionsFromSecretFields, safeCut } from '../src/engine/realtime.js';
import { matchRoute } from '../ui/lib/routes.js';
import {screenForState} from '../ui/lib/idea-model.js';
import {openStateOf} from './idea-coach-api.js';
import {createIdeaStore} from '../src/node/idea-store.js';

/** The port setup opens Chrome on. YAP_PORT overrides it. */
export const DEFAULT_PORT = 4317;

/** The only folders (relative to the app root) the server reads files from. */
export const ALLOWED_ROOTS = Object.freeze(['debug', 'src/engine', 'sample', 'ui']);

/** The folder (relative to the app root) the screens live in: one folder per screen, each with its index.html. */
const SCREENS_ROOT = 'ui';

const MAX_BODY_BYTES = 4096; // T-01-25
const MAX_FIELD_CHARS = 500;
const MAX_TITLE_CHARS = 120; // T-01-30
const MAX_POINT_TITLES = 6; // T-01-30
const HARD_DRAIN_BYTES = 1024 * 1024; // past this an oversized body is cut off, not drained
const LOOPBACK = '127.0.0.1';

/** The route the page loads the speech package from (WHISPER_SETTINGS.vendorPath in src/engine/whisper-loader.js). */
export const VENDOR_ROUTE = '/vendor/transformers/';
/** The one folder (relative to the app root) the vendor route reads. Installed by setup, never bundled (D-68). */
export const VENDOR_DIR = 'node_modules/@huggingface/transformers/dist';
/** One path segment: letters, digits, dot, hyphen and underscore, not starting with a dot, at most 128 characters. */
const VENDOR_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
/** The only endings the vendor route serves, each with its content type. */
const VENDOR_TYPES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
});
const VENDOR_NOT_INSTALLED = 'YAP\'s speech package is not installed. Run npm run setup, then reload.';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/**
 * The policy of a page, given its base-uri. A page may run only its own
 * scripts (01-04 threat flag: no third-party scripts). Realtime is reached
 * from the page over wss.
 * @param {string} baseUri
 */
function contentSecurityPolicy(baseUri) {
  return [
    "default-src 'self'",
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    "connect-src 'self' https://api.openai.com wss://api.openai.com https://huggingface.co https://*.huggingface.co https://*.hf.co",
    "media-src 'self' blob: data:",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    `base-uri ${baseUri}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

// The debug page has no base element and may have none.
const CONTENT_SECURITY_POLICY = contentSecurityPolicy("'none'");
// A screen page carries one base line that names its own folder under ui/, so
// its policy differs in base-uri only: this server, nowhere else (T-02-02).
const SCREEN_CONTENT_SECURITY_POLICY = contentSecurityPolicy("'self'");

/**
 * The optional facts a page may send when asking for a secret: the idea, the
 * chosen angle's label and its text, each cut to 500 characters, and the
 * talking-point titles, read only when they come as a list (strings kept, the
 * first 6, each cut to 120 characters). Every cut is the shared surrogate-safe
 * cut, so a body posted straight to this server cannot leave half an emoji in
 * the instructions. Anything else in the body is ignored, including an
 * `instructions` key: the server alone writes the instruction text, so a page
 * cannot write, drop or reword YAP's rules (T-01-29).
 * @param {any} body parsed JSON body
 * @returns {{ idea: string, angleLabel: string, angleText: string, pointTitles: string[] }}
 */
export function readSecretFields(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const field = (v) => safeCut(v, MAX_FIELD_CHARS);
  const titles = Array.isArray(source.pointTitles) ? source.pointTitles : [];
  return {
    idea: field(source.idea),
    angleLabel: field(source.angleLabel),
    angleText: field(source.angleText),
    pointTitles: titles
      .filter((t) => typeof t === 'string')
      .slice(0, MAX_POINT_TITLES)
      .map((t) => safeCut(t, MAX_TITLE_CHARS)),
  };
}

/**
 * @param {string} parent absolute
 * @param {string} child absolute
 */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {any} data
 */
function sendJson(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} text
 */
function sendText(res, status, text, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(text);
}

/**
 * Map a request path to a file inside one of the allowed folders, or null.
 * @param {string} root absolute app root
 * @param {string} rawPath request path without the query, still encoded
 * @returns {{ status: 400 } | { status: 404 } | { status: 200, file: string, allowed: string }}
 */
function resolveStatic(root, rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  let clean = path.posix.normalize(decoded);
  if (!clean.startsWith('/')) return { status: 404 };
  if (clean === '/debug/') clean = '/debug/index.html';
  const rel = clean.slice(1);
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return { status: 404 };

  const allowed = ALLOWED_ROOTS.find((r) => rel.startsWith(`${r}/`));
  if (!allowed) return { status: 404 };
  const allowedDir = path.resolve(root, allowed);
  const file = path.resolve(root, rel);
  if (!isInside(allowedDir, file) || file === allowedDir) return { status: 404 };

  let realDir;
  let realFile;
  try {
    realDir = fs.realpathSync(allowedDir);
    realFile = fs.realpathSync(file);
  } catch {
    return { status: 404 };
  }
  if (!isInside(realDir, realFile) || realFile === realDir) return { status: 404 };
  let stat;
  try {
    stat = fs.statSync(realFile);
  } catch {
    return { status: 404 };
  }
  if (!stat.isFile()) return { status: 404 };
  return { status: 200, file: realFile, allowed };
}

/**
 * Send a file resolveStatic found. A page carries its policy: the screen
 * policy for a page under ui/, the debug policy for any other.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ file: string, allowed: string }} found
 * @returns {boolean} false when the file could not be read
 */
function sendFound(req, res, found, { ideaGate = false, takeGate = false } = {}) {
  const ext = path.extname(found.file).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  let data;
  try {
    data = fs.readFileSync(found.file);
  } catch {
    return false;
  }
  // MEDIA-01: one valid byte range of a video (or sound) answers 206; an invalid range answers 416.
  const rangeHeader = req.headers && req.headers.range;
  if (rangeHeader !== undefined && (ext === '.mp4' || ext === '.m4v' || ext === '.mov' || ext === '.webm' || ext === '.wav')) {
    const size = data.length;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
    let start;
    let end;
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        const n = Number(m[2]);
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
    }
    if (start === undefined || !(start <= end) || start >= size) {
      res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Content-Length': 0,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end();
      return true;
    }
    const part = data.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': part.length,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : part);
    return true;
  }
  if (ideaGate && ext === '.html' && data.includes('data-testid="idea-input"')) {
    const html = data.toString('utf8');
    // Only the interactive idea screens need gating; plain server fixtures
    // retain their original bytes. Only runtime responses change. The approved screen files and ?shell
    // responses remain byte-identical, including their legacy scripts.
    if (!/<div class="app">/.test(html) || !/<body>/.test(html)) return false;
    const gate = '<section data-testid="idea-loading" role="status" aria-live="polite" style="position:fixed;inset:0;z-index:1000;display:grid;place-content:center;gap:16px;padding:32px;background:#171411;color:#fff;font:18px/1.5 -apple-system,BlinkMacSystemFont,Arial,sans-serif"><h1 data-testid="idea-loading-title" style="font-size:24px;margin:0">Loading your idea…</h1><p data-testid="idea-loading-detail" style="margin:0;max-width:440px;color:#c7c4bf">Your saved words and controls will appear when ready. You can return Home at any time.</p><a data-testid="idea-loading-home" href="/" style="color:#f4c66b;width:fit-content">Go Home</a></section>';
    data = Buffer.from(html.replace('<html ', '<html data-idea-ready="false" ')
      .replace('<div class="app">', '<div class="app" data-idea-surface inert aria-busy="true" style="visibility:hidden">')
      .replace('<body>', `<body>${gate}`));
  }
  if (takeGate && ext === '.html' && data.includes('<main class="live-shell"')) {
    // Gate before the first paint, including delayed/failed module downloads.
    // Frozen reference shells remain byte-identical on their explicit routes.
    const retryUrl = String(req.url || '/').replace(/[&"<>]/g, c => ({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
    const gate = '<section data-testid="take-loading" role="status" aria-live="polite" style="position:fixed;inset:0;z-index:1000;display:grid;place-content:center;gap:16px;padding:32px;background:#171411;color:#fff;font:18px/1.5 -apple-system,BlinkMacSystemFont,Arial,sans-serif"><h1 data-testid="take-loading-title" style="font-size:24px;margin:0">Opening your take…</h1><p data-testid="take-loading-detail" style="margin:0;max-width:440px;color:#c7c4bf">Your own points and saved choices will appear when ready.</p><a data-testid="take-loading-home" href="/" style="color:#f4c66b;width:fit-content">Go Home</a><a data-testid="take-loading-retry" href="' + retryUrl + '" style="color:#f4c66b;width:fit-content">Reload this take</a></section><script src="/ui/lib/take-recovery.js"></script>';
    data = Buffer.from(data.toString('utf8').replace('<html ', '<html data-take-ready="false" ')
      .replace('<main class="live-shell"', '<main class="live-shell" data-take-surface inert aria-busy="true" style="visibility:hidden"')
      .replace('<body>', `<body>${gate}`));
  }
  const headers = {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (ext === '.mp4' || ext === '.m4v' || ext === '.mov' || ext === '.webm' || ext === '.wav') headers['Accept-Ranges'] = 'bytes';
  if (ext === '.html') {
    headers['Content-Security-Policy'] = found.allowed === SCREENS_ROOT ? SCREEN_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} root
 */
function serveStatic(req, res, root, rawPath) {
  const found = resolveStatic(root, rawPath);
  if (found.status === 400) return sendText(res, 400, 'Bad request');
  if (found.status !== 200) return sendText(res, 404, 'Not found');
  if (!sendFound(req, res, found)) return sendText(res, 404, 'Not found');
  return undefined;
}

/**
 * Answer a screen route with that screen's page, ui/<screen>/index.html,
 * through the same safe file read as every static path (D-104, D-105).
 * `screen` comes from the route table, never from the request.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} root
 * @param {string} screen a screen folder name from ROUTES
 * @returns {boolean} false when this root holds no page for the screen; nothing was sent
 */
function serveScreen(req, res, root, screen, options) {
  const found = resolveStatic(root, `/${SCREENS_ROOT}/${screen}/index.html`);
  return found.status === 200 && sendFound(req, res, found, options);
}

/**
 * True when the request comes from this server's own page: Origin and Host
 * both name 127.0.0.1 or localhost on the port the request arrived on.
 * @param {http.IncomingMessage} req
 */
function fromOwnPage(req) {
  const port = req.socket.localPort;
  const origin = req.headers.origin;
  const host = req.headers.host;
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return typeof origin === 'string' && typeof host === 'string' && origins.includes(origin) && hosts.includes(host);
}

/**
 * True when a GET or HEAD comes from this server's own page.
 *
 * `fromOwnPage` above asks for an Origin header, which a browser sends with a
 * POST. A browser sends no Origin with a same-origin GET (a script its own page
 * imports, a file its own page fetches), so that check would refuse the page it
 * is there for. Here Host must name this server, and then either Origin names
 * it too, or there is no Origin and the browser's own Sec-Fetch-Site header
 * says same-origin. A page cannot set a Sec- header itself, so another website
 * (cross-site), a typed address (none) and a plain program (no header) are all
 * refused.
 * @param {http.IncomingMessage} req
 */
function fromOwnPageRead(req) {
  const port = req.socket.localPort;
  const host = req.headers.host;
  if (typeof host !== 'string' || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    return typeof origin === 'string' && [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin);
  }
  return req.headers['sec-fetch-site'] === 'same-origin';
}

/**
 * GET and HEAD /vendor/transformers/<file> (INST-02, D-68; threat T-01.1-23).
 *
 * Serves the speech package's own files from one folder, VENDOR_DIR inside the
 * app folder, to this server's own page. `name` is what follows the route in
 * the request, still as it was sent: nothing is decoded, so an encoded dot or
 * slash is simply not a letter of a file name. Anything that is not one plain
 * file name with an allowed ending, or whose real path is not inside the
 * folder, is 404.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} root absolute app root
 * @param {string} name
 */
function serveVendor(req, res, root, name) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    req.resume();
    return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }
  if (!fromOwnPageRead(req)) return sendText(res, 403, 'This address only answers YAP\'s own page.');

  const type = VENDOR_TYPES[path.extname(name)];
  if (!VENDOR_FILE.test(name) || !type) return sendText(res, 404, 'Not found');

  const dir = path.resolve(root, VENDOR_DIR);
  let realRoot;
  let realDir;
  try {
    realRoot = fs.realpathSync(root);
    realDir = fs.realpathSync(dir);
  } catch {
    return sendText(res, 404, VENDOR_NOT_INSTALLED);
  }
  // The package lives inside the app folder (D-68): a folder linked in from elsewhere is not served.
  if (!isInside(realRoot, realDir) || realDir === realRoot) return sendText(res, 404, 'Not found');

  let realFile;
  let stat;
  try {
    realFile = fs.realpathSync(path.join(dir, name));
    stat = fs.statSync(realFile);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  if (!isInside(realDir, realFile) || realFile === realDir || !stat.isFile()) return sendText(res, 404, 'Not found');

  let data;
  try {
    data = fs.readFileSync(realFile);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(method === 'HEAD' ? undefined : data);
}

/**
 * Read a request body up to `maxBytes` (MAX_BODY_BYTES unless the route has its own limit).
 * @param {http.IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<{ tooLarge: boolean, text: string }>}
 */
function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        if (size > HARD_DRAIN_BYTES) req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ tooLarge, text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8') }));
    req.on('error', reject);
  });
}

/**
 * POST /api/realtime/secret (D-12, D-13).
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{ env: Record<string, string | undefined>, fetchImpl: any }} deps
 */
async function handleSecret(req, res, deps) {
  if (!fromOwnPage(req)) {
    req.resume();
    return sendJson(res, 403, { available: false, error: 'This address only answers YAP\'s own page.' });
  }
  const declared = Number(req.headers['content-length']);
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { available: false, error: 'Could not read the request.' });
  }
  if (body.tooLarge || (Number.isFinite(declared) && declared > MAX_BODY_BYTES)) {
    return sendJson(res, 413, { available: false, error: 'Request too large.' });
  }
  let parsed = {};
  if (body.text.trim() !== '') {
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return sendJson(res, 400, { available: false, error: 'Request was not JSON.' });
    }
  }
  // The same builder the engine uses, so the page path mints what the replay path mints.
  const instructions = instructionsFromSecretFields(readSecretFields(parsed));
  let result;
  try {
    result = await mintClientSecret({ env: deps.env, fetchImpl: deps.fetchImpl, instructions });
  } catch {
    result = { available: false, error: 'Could not mint a Realtime secret.' };
  }
  return sendJson(res, 200, result);
}

/**
 * The two folders a server works in: the app root it serves from, and the data
 * folder the app's own data is kept in. `dataDir` is optional and defaults to
 * the `data` folder of the root; a walk gives its own, so it never touches the
 * person's data (QUESTIONS.md Q151). Nothing is created here.
 * @param {{ root?: string, dataDir?: string }} [options]
 * @returns {{ root: string, dataDir: string }} both absolute
 */
export function serverPaths(options = {}) {
  const root = path.resolve(options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const dataDir = path.resolve(options.dataDir || path.join(root, 'data'));
  return { root, dataDir };
}

/**
 * Create YAP's server. It always listens on 127.0.0.1: listen() is wrapped so
 * a host passed to it is replaced.
 *
 * `spawnImpl` stands in for child_process.spawn on the model route, so a test
 * never starts the real `claude` program; left out, the real spawn is used.
 *
 * `dataDir` is where the app's own data is kept (see serverPaths). The app's
 * API, under /api/app/, is the only thing that reads or writes it.
 *
 * @param {{ root?: string, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, spawnImpl?: Function, dataDir?: string }} [options]
 * @returns {http.Server}
 */
export function createYapServer(options = {}) {
  // paths.dataDir is where the app's API keeps the page's data.
  const paths = serverPaths(options);
  const root = paths.root;
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl !== undefined ? options.fetchImpl : globalThis.fetch;
  // One queue per server: the model route runs one model call at a time (T-01.1-09).
  const modelDeps = {
    env,
    fetchImpl,
    spawnImpl: options.spawnImpl,
    fromOwnPage,
    readBody,
    sendJson,
    queue: { tail: Promise.resolve() },
  };
  // The app's API: the own-page checks and the data folder, and one set of stores per server.
  const appDeps = {
    root,
    dataDir: paths.dataDir,
    fromOwnPage,
    fromOwnPageRead,
    readBody,
    sendJson,
    stores: {},
  };

  const server = http.createServer((req, res) => {
    const local = req.socket.localAddress;
    if (local !== LOOPBACK && local !== `::ffff:${LOOPBACK}`) {
      req.resume();
      return sendText(res, 403, 'Forbidden');
    }
    const url = String(req.url || '/');
    const rawPath = url.split('?')[0].split('#')[0] || '/';
    const method = req.method || 'GET';

    if (rawPath === '/api/realtime/secret') {
      if (method !== 'POST') {
        req.resume();
        return sendText(res, 405, 'Method not allowed', { Allow: 'POST' });
      }
      handleSecret(req, res, { env, fetchImpl }).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { available: false, error: 'Server error.' });
      });
      return;
    }

    // POST /api/model (SETUP-01, D-43): behind the same own-page check as the secret route.
    if (rawPath === '/api/model') {
      handleModel(req, res, modelDeps).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { source: 'none', text: null, error: 'Server error.' });
      });
      return;
    }

    // Every path under /api/app/ (D-104, D-105): the page's way to the Node side, for this server's own page only.
    if (rawPath.startsWith(APP_API_PREFIX)) {
      handleAppApi(req, res, appDeps).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
      });
      return;
    }

    // GET and HEAD /vendor/transformers/<file> (INST-02, D-68): the speech package's files, for this server's own page.
    if (rawPath.startsWith(VENDOR_ROUTE)) return serveVendor(req, res, root, rawPath.slice(VENDOR_ROUTE.length));

    if (method !== 'GET' && method !== 'HEAD') {
      req.resume();
      return sendText(res, method === 'POST' ? 404 : 405, method === 'POST' ? 'Not found' : 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    // The tab's icon: a browser asks for it on every page.
    if (rawPath === '/favicon.ico') {
      let icon;
      try {
        icon = fs.readFileSync(path.join(root, 'server', 'favicon.png'));
      } catch {
        return sendText(res, 404, 'Not found');
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': icon.length, 'Cache-Control': 'max-age=86400' });
      return res.end(method === 'HEAD' ? undefined : icon);
    }
    if (rawPath === '/health') return sendJson(res, 200, { ok: true, instance: createHash('sha256').update(root).digest('hex').slice(0,20), pid: process.pid });
    const toDebug = () => {
      res.writeHead(302, { Location: '/debug/', 'Cache-Control': 'no-store', 'Content-Length': 0 });
      return res.end();
    };
    if (rawPath === '/debug') return toDebug();

    // The Review screens: /review is the inbox, /review/<id> the detail stand-in. The id of a
    // video the person brought in is `upload-` and a content hash, longer than a route id (the
    // ROUTES table keeps its eight routes), so the page reads its own id from the address.
    if (rawPath === '/review' || rawPath === '/review/') {
      if (serveScreen(req, res, root, 'review')) return undefined;
      return sendText(res, 404, 'Not found');
    }
    if (/^\/review\/[a-z0-9][a-z0-9-]{0,95}$/.test(rawPath)) {
      if (serveScreen(req, res, root, rawPath === '/review/sample-video' ? 'reviewsample' : 'reviewdetail')) return undefined;
      return sendText(res, 404, 'Not found');
    }

    // A screen route (D-104): the route table picks the screen folder, and its page is the answer.
    const mark = url.indexOf('?');
    const query = mark === -1 ? '' : url.slice(mark + 1).split('#')[0];
    const route = matchRoute(rawPath, query);
    if (route) {
      if(route.name==='idea') {
        if(!fs.existsSync(path.join(root,'ui','conversation','index.html')))return sendText(res,404,'Not found');
        const q=new URLSearchParams(query);
        if(q.has('shell'))route.screen=screenForState(q.get('state'));
        else {
          try {const idea=createIdeaStore(paths.dataDir,{appRoot:root}).load(route.params.id);if(!idea)return sendText(res,404,'Idea not found');route.screen=screenForState(openStateOf(idea,root,paths.dataDir));}
          catch{return sendText(res,500,'Could not open this idea.');}
        }
      }
      if (serveScreen(req, res, root, route.screen, {
        ideaGate: route.name === 'idea' && !new URLSearchParams(query).has('shell'),
        takeGate: ['record','return'].includes(route.screen) && !new URLSearchParams(query).has('shell'),
      })) return undefined;
      // `/` is the Ideas opening once that screen is built; until then it opens the debug page, as before.
      if (route.name === 'ideas') return toDebug();
      return sendText(res, 404, 'Not found');
    }
    return serveStatic(req, res, root, rawPath);
  });

  const listen = server.listen.bind(server);
  /** @type {any} */ (server).listen = (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    const first = args[0];
    const port = first && typeof first === 'object' ? first.port : first;
    return listen({ port: port === undefined ? 0 : Number(port), host: LOOPBACK }, callback);
  };
  return server;
}

/**
 * The port to listen on: YAP_PORT when it is a valid port number, else 4317.
 * @param {Record<string, string | undefined>} env
 */
export function portFromEnv(env) {
  const n = Number(env && env.YAP_PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function main() {
  const port = portFromEnv(process.env);
  const server = createYapServer();
  server.on('error', (err) => {
    const code = err && /** @type {any} */ (err).code;
    if (code === 'EADDRINUSE') {
      process.stderr.write(`YAP could not start: port ${port} on 127.0.0.1 is already in use.\n`);
    } else {
      process.stderr.write(`YAP could not start: ${code || 'unknown error'}\n`);
    }
    process.exit(1);
  });
  server.listen(port, () => {
    process.stdout.write(`YAP is running at http://127.0.0.1:${port}/\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
