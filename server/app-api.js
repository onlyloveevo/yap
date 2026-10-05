// The app's API: the page's way to the Node side (D-104, D-105). Every route
// sits under APP_API_PREFIX, takes JSON and answers JSON. This file holds the
// ideas routes and the recordings routes; later plans add trials and the rest
// to the same handler, behind the same checks.
//
//   GET  /api/app/ideas        { ideas }
//   POST /api/app/ideas        { thought }  ->  { id }
//   GET  /api/app/ideas/<id>   the idea
//   POST /api/app/ideas/<id>   any of { state, format, thumb, ticks, message, keptBeats }  ->  the idea
//
// An <id> is a bank id (sample, idea-2 to idea-6) or a created one, and both
// kinds are read and changed the same way.
//
// The recordings routes (D-127, DATA-01):
//
//   POST /api/app/recordings        { ideaId, title, idea, beats, deliveryCues, sample }  ->  { id }
//   GET  /api/app/recordings        { recordings }: each one's id, title, status and createdAt, newest first
//   GET  /api/app/recordings/<id>   { recording, meta }
//
// Start recording makes the Recording: the engine's createRecording builds it
// and the recording store saves it as recordings/<id>.json. Which idea it came
// from, and whether it is the bundled sample take, is kept beside it as
// recording-meta/<id>.json: a folder of its own, so the store's list never
// reads it.
//
// Security notes (threats T-02-04, T-02-05, T-02-06, T-02-08, T-02-09):
// - A recording's id is made here, never taken from the page (T-02-08): it is
//   rec-<time>-<n>, by the id rule, and it is the only thing of a request that
//   ever becomes part of a file name. The store checks it again before any
//   file is touched.
// - Who asks is checked before anything else, whatever the path: a request
//   that reads must pass fromOwnPageRead and any other must pass fromOwnPage.
//   Both are server/serve.js's own, handed in. Without them every request is
//   refused. A refusal is 403, reads no file and writes none.
// - A body is at most APP_API_MAX_BODY_BYTES. It must be a JSON object.
// - An id is matched against the id rule on the path as it was sent: nothing is
//   decoded, and an id is never part of a file name. Everything is kept in one
//   file inside the data folder, by src/node/idea-store.js.
// - An answer never names a folder of this machine, and no CORS header is ever
//   sent, so no other site is let in.
// - Nothing here writes to the console or reads a setting of the machine.

import fs from 'node:fs';
import path from 'node:path';
import { handleTakeApi } from './take-api.js';
import { handleEditorExtras } from './editor-api.js';
import { handleLiveUiApi } from './live-ui-api.js';
import { handleLiveRefineApi } from './live-refine-api.js';
import { handleIdeaCoachApi } from './idea-coach-api.js';

import { createRecording, isRecordingId } from '../src/engine/recording.js';
import { createIdeaStore, isIdeaId } from '../src/node/idea-store.js';
import { createRecordingStore } from '../src/node/recording-store.js';
import { readJson, resolveDataDir, writeJsonAtomic } from '../src/node/store.js';

/** Every route of the app's API sits under this prefix. */
export const APP_API_PREFIX = '/api/app/';
/** The largest body a route of the app's API reads: 16 KB. */
export const APP_API_MAX_BODY_BYTES = 16 * 1024;

const OWN_PAGE_ONLY = 'This address only answers YAP\'s own page.';
/** Sent with every answer: no other site may embed or read it. */
const ANSWER_HEADERS = Object.freeze({ 'Cross-Origin-Resource-Policy': 'same-origin' });
/** The store errors whose words are safe and useful to show: they name a file of the app, never a folder. */
const SHOWN_ERRORS = Object.freeze(['CorruptIdeaFileError', 'CorruptIdeaBankError', 'CorruptRecordingFileError', 'CorruptRecordingMetaError']);
const READS = Object.freeze(['GET', 'HEAD']);

/** Where what the app keeps beside a recording lives, inside the data folder: its own folder, never the recording store's. */
const META_FOLDER = 'recording-meta';
/** How many recordings one millisecond may hold before the id maker gives up. */
const MAX_IDS_PER_STAMP = 1000;
const ID_RULE_WORDS = '1 to 64 lower-case letters, digits and hyphens';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * What the app keeps beside each recording: the idea it was prepared from, and
 * whether it is the bundled sample take. One file per recording, in
 * `<dataDir>/recording-meta/<id>.json`, resolved inside the app folder as the
 * stores resolve theirs.
 * @param {string} dataDir
 * @param {string} root the app folder
 */
function createRecordingMeta(dataDir, root) {
  const dir = resolveDataDir(root, path.join(resolveDataDir(root, dataDir), META_FOLDER));
  /** The file of a recording's meta. The id is checked before any file is touched. */
  const fileOf = (id) => {
    if (!isRecordingId(id)) throw namedError('RecordingIdError', `A recording id is ${ID_RULE_WORDS}.`);
    return path.join(dir, `${id}.json`);
  };
  return {
    /** @param {{ id: string, ideaId: string | null, sample: boolean }} meta */
    save(meta) {
      writeJsonAtomic(fileOf(meta.id), { id: meta.id, ideaId: meta.ideaId, sample: meta.sample, ...(meta.sampleTake===2?{sampleTake:2}:{}), ...(meta.returnFrom?{returnFrom:meta.returnFrom}:{}) });
    },
    /** The meta of a recording. A recording saved by another part of the app has none: it is nobody's sample take. */
    load(id) {
      const file = fileOf(id);
      let kept;
      try {
        kept = readJson(file, null);
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw namedError('CorruptRecordingMetaError', `${META_FOLDER}/${id}.json is not valid JSON, the file may be half-written (${err.message})`);
        }
        throw err;
      }
      const known = kept !== null && typeof kept === 'object' ? kept : {};
      return { id, ideaId: typeof known.ideaId === 'string' && isIdeaId(known.ideaId) ? known.ideaId : null, sample: known.sample === true, ...(known.sampleTake===2?{sampleTake:2}:{}), ...(isRecordingId(known.returnFrom)?{returnFrom:known.returnFrom}:{}) };
    },
  };
}

/**
 * A new recording's id: rec-<time>-<n>, the time in base 36 and n counting up
 * from 1 past any id this data folder already holds. Made here, never taken
 * from the page (T-02-08).
 * @param {{ load(id: string): object | null }} store
 * @param {Date} at
 */
function newRecordingId(store, at) {
  const stamp = at.getTime().toString(36);
  for (let n = 1; n <= MAX_IDS_PER_STAMP; n += 1) {
    const id = `rec-${stamp}-${n}`;
    if (store.load(id) === null) return id;
  }
  throw new Error('no free recording id');
}

/**
 * The recordings routes. `rest` is what follows `recordings` in the path: ''
 * for the list and for a new recording, or `/<id>` for one recording. Gives
 * false when the path is no recordings route.
 */
async function recordingsRoutes({ req, method, rest, answer, refuse, readJsonBody, recordings, now }) {
  const one = rest.startsWith('/');
  if (rest !== '' && !one) return false;
  const id = one ? rest.slice(1) : null;
  // `/api/app/recordings/<id>/more` is no route; an id never holds a slash.
  if (id !== null && id.includes('/')) return false;
  // One recording is read by its address; a new one is made at the list's.
  const allowed = id === null ? ['GET', 'POST'] : ['GET'];
  if (!allowed.includes(method)) {
    req.resume();
    refuse(405, 'Method not allowed.', { Allow: allowed.join(', ') });
    return true;
  }
  if (id !== null && !isRecordingId(id)) {
    req.resume();
    refuse(400, `A recording id is ${ID_RULE_WORDS}.`);
    return true;
  }

  if (method === 'GET') {
    const { store, meta } = recordings();
    if (id === null) {
      answer(200, { recordings: store.list() });
      return true;
    }
    const recording = store.load(id);
    if (recording) answer(200, { recording, meta: meta.load(id) });
    else refuse(404, 'No recording has that id.');
    return true;
  }

  const body = await readJsonBody();
  if (body === null) return true; // already refused
  // What is kept beside the record: the idea it came from, and whether it is the sample take.
  const ideaId = body.ideaId === undefined || body.ideaId === null ? null : body.ideaId;
  if (ideaId !== null && !isIdeaId(ideaId)) {
    refuse(400, `An idea id is ${ID_RULE_WORDS}.`);
    return true;
  }
  if (body.sample !== undefined && typeof body.sample !== 'boolean') {
    refuse(400, 'sample must be true or false.');
    return true;
  }
  const { store, meta } = recordings();
  const at = now();
  const newId = newRecordingId(store, at);
  let recording;
  try {
    // Only these four are taken from the page; the id, the status and the time are made here and by the engine.
    recording = createRecording({ id: newId, title: body.title, idea: body.idea, beats: body.beats, deliveryCues: body.deliveryCues, now: at.toISOString() });
  } catch (err) {
    if (!err || err.name !== 'InvalidRecordingError') throw err;
    refuse(400, err.message);
    return true;
  }
  store.save(recording);
  meta.save({ id: newId, ideaId, sample: body.sample === true, ...(body.sampleTake===2?{sampleTake:2}:{}), ...(isRecordingId(body.returnFrom)?{returnFrom:body.returnFrom}:{}) });
  answer(200, { id: newId });
  return true;
}

/**
 * The ideas routes. `rest` is what follows `ideas` in the path: '' for the
 * list, or `/<id>` for one idea. Gives false when the path is no ideas route.
 */
async function ideasRoutes({ req, method, rest, answer, refuse, readJsonBody, ideas }) {
  const one = rest.startsWith('/');
  if (rest !== '' && !one) return false;
  const id = one ? rest.slice(1) : null;
  // `/api/app/ideas/<id>/more` is no route; an id never holds a slash.
  if (id !== null && id.includes('/')) return false;
  if (method !== 'GET' && method !== 'POST') {
    req.resume();
    refuse(405, 'Method not allowed.', { Allow: 'GET, POST' });
    return true;
  }
  if (id !== null && !isIdeaId(id)) {
    req.resume();
    refuse(400, 'An idea id is 1 to 64 lower-case letters, digits and hyphens.');
    return true;
  }
  const store = ideas();

  if (id === null && method === 'GET') {
    answer(200, { ideas: store.list() });
    return true;
  }
  if (method === 'GET') {
    const idea = store.load(id);
    if (idea) answer(200, idea);
    else refuse(404, 'No idea has that id.');
    return true;
  }

  const body = await readJsonBody();
  if (body === null) return true; // already refused
  try {
    if (id === null) {
      answer(200, { id: store.create({ thought: body.thought }).id });
    } else {
      const idea = store.patch(id, body);
      if (idea) answer(200, idea);
      else refuse(404, 'No idea has that id.');
    }
  } catch (err) {
    if (!err || err.name !== 'InvalidIdeaError') throw err;
    refuse(400, err.message);
  }
  return true;
}

/**
 * Every request under /api/app/.
 *
 * `fromOwnPage`, `fromOwnPageRead`, `readBody` and `sendJson` are
 * server/serve.js's own, handed in so these routes are checked exactly as the
 * secret, model and vendor routes are. `stores` is where the handler keeps the
 * stores it opens on `dataDir`, one per server; left out, a store is opened for
 * each request.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, dataDir: string,
 *           fromOwnPage: (req: any) => boolean,
 *           fromOwnPageRead: (req: any) => boolean,
 *           readBody: (req: any, maxBytes: number) => Promise<{ tooLarge: boolean, text: string }>,
 *           sendJson: (res: any, status: number, data: any, extra?: Record<string, string>) => void,
 *           stores?: Record<string, any>,
 *           now?: () => Date }} deps  `now` is the clock a new recording's id and time are read from; left out, the machine's
 */
/** A whole lesson from a sample review, or null. The same rule the page applies (ui/lib/return-model.js). */
function sampleLessonFrom(value) {
  const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const text = line(value?.text, 240), id = line(value?.source?.id, 96), title = line(value?.source?.title, 200);
  const at = new Date(typeof value?.acceptedAt === 'string' ? value.acceptedAt : NaN);
  if (!text || !/^sample-[a-z0-9-]+$/.test(id) || !title || Number.isNaN(at.getTime())) return null;
  return { text, source: { id, title }, acceptedAt: at.toISOString() };
}

export async function handleAppApi(req, res, deps) {
  const { root, dataDir, fromOwnPage, fromOwnPageRead, readBody, sendJson, stores } = deps || {};
  const now = deps && typeof deps.now === 'function' ? deps.now : () => new Date();
  if (typeof sendJson !== 'function' || typeof readBody !== 'function') {
    throw new TypeError('handleAppApi needs sendJson and readBody');
  }
  const answer = (status, data, extra) => sendJson(res, status, data, { ...ANSWER_HEADERS, ...extra });
  const refuse = (status, error, extra) => answer(status, { error }, extra);
  const method = req.method || 'GET';

  // Who asks comes first, so a stranger learns nothing of what is here.
  const check = READS.includes(method) ? fromOwnPageRead : fromOwnPage;
  if (typeof check !== 'function' || !check(req)) {
    req.resume();
    return refuse(403, OWN_PAGE_ONLY);
  }

  const rawPath = String(req.url || '/').split('?')[0].split('#')[0];
  const rest = rawPath.startsWith(APP_API_PREFIX) ? rawPath.slice(APP_API_PREFIX.length) : null;

  /** The body as a JSON object, or null once the request has been refused. */
  async function readJsonBody(maxBytes = APP_API_MAX_BODY_BYTES) {
    const declared = Number(req.headers['content-length']);
    let body;
    try {
      body = await readBody(req, maxBytes);
    } catch {
      refuse(400, 'Could not read the request.');
      return null;
    }
    if (body.tooLarge || (Number.isFinite(declared) && declared > maxBytes)) {
      refuse(413, 'Request too large.');
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      refuse(400, 'Request was not JSON.');
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      refuse(400, 'Request was not a JSON object.');
      return null;
    }
    return parsed;
  }

  /** The idea store on this server's data folder, opened on first use. */
  const ideas = () => {
    if (stores && stores.ideas) return stores.ideas;
    const store = createIdeaStore(dataDir, { appRoot: root });
    if (stores) stores.ideas = store;
    return store;
  };

  /** The recording store and what is kept beside each recording, on this server's data folder, opened on first use. */
  const recordings = () => {
    if (stores && stores.recordings) return stores.recordings;
    const opened = { store: createRecordingStore(dataDir, { appRoot: root }), meta: createRecordingMeta(dataDir, root) };
    if (stores) stores.recordings = opened;
    return opened;
  };

  try {
    if (await handleLiveUiApi({req,res,rest,method,answer,refuse,recordings,root,dataDir})) return undefined;
    if (await handleLiveRefineApi({req,res,rest,method,answer,refuse,readJsonBody,recordings,root,dataDir})) return undefined;
    if (await handleEditorExtras({req,res,rest,method,answer,refuse,readJsonBody,recordings,root,dataDir})) return undefined;
    if (await handleTakeApi({req,res,rest,method,answer,refuse,readJsonBody,recordings,root,dataDir})) return undefined;
    if (await handleIdeaCoachApi({req,rest,method,answer,refuse,readJsonBody,ideas,root,dataDir,now})) return undefined;
    if (rest !== null && (rest === 'ideas' || rest.startsWith('ideas/'))) {
      const handled = await ideasRoutes({ req, method, rest: rest.slice('ideas'.length), answer, refuse, readJsonBody, ideas });
      if (handled) return undefined;
    }
    if (rest !== null && (rest === 'recordings' || rest.startsWith('recordings/'))) {
      const handled = await recordingsRoutes({ req, method, rest: rest.slice('recordings'.length), answer, refuse, readJsonBody, recordings, now });
      if (handled) return undefined;
    }
    req.resume();
    // Review: the experiment accepted in the sample review. It is kept with the YAP folder, in a file of its own,
    // so every browser on this folder carries it and it never mixes with the person's own lesson in memory.json.
    if (rest === 'sample-lesson') {
      const file = path.join(resolveDataDir(root, dataDir), 'sample-lesson.json');
      if (method === 'GET') return answer(200, { lesson: sampleLessonFrom(readJson(file, null)) });
      if (method !== 'POST') return refuse(405, 'Method not allowed.', { Allow: 'GET, POST' });
      const body = await readJsonBody();
      if (!body) return undefined;
      if (body.lesson === null) {
        fs.rmSync(file, { force: true });
        return answer(200, { lesson: null });
      }
      const lesson = sampleLessonFrom(body.lesson);
      if (!lesson) return refuse(400, 'A sample lesson needs its words, the sample review it came from and when it was accepted.');
      writeJsonAtomic(file, lesson);
      return answer(200, { lesson });
    }
    return refuse(404, 'Not found.');
  } catch (err) {
    if (res.headersSent) return undefined;
    // A broken file names itself; anything else says only that it failed.
    if (err && SHOWN_ERRORS.includes(err.name)) return refuse(500, err.message);
    return refuse(500, 'Server error.');
  }
}
