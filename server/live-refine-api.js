// Saved Live refinement per recording, behind app-api's own-origin checks.
//
//   GET /api/app/recordings/<id>/live-refine   { revision, conversation, revisions, intervals }  (an empty record when none)
//   PUT /api/app/recordings/<id>/live-refine   { baseRevision, conversation, revisions, intervals } -> the saved record
//
// One JSON file per recording at <dataDir>/live-refine/<id>.json, replaced atomically. The page names
// the revision it last saw; if the file has moved on, the save is refused with 409 and the current
// record, so a stale tab can never overwrite newer notes. It never touches the recording, its media or
// any other store, and it records only YAP's own beat wording, never Google Slides content.
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir, readJson, writeJsonAtomic } from '../src/node/store.js';
import { validateSaved, createRefinement, SAVED_LIMITS } from '../src/engine/live-refine.js';

const locks = new Set();
const ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function handleLiveRefineApi({ req, rest, method, answer, refuse, readJsonBody, recordings, root, dataDir }) {
  const m = /^recordings\/([^/]+)\/live-refine$/.exec(rest || '');
  if (!m) return false;
  const id = m[1];
  if (!ID_RULE.test(id)) { req.resume(); refuse(400, 'Invalid recording id.'); return true; }
  if (!['GET', 'HEAD', 'PUT'].includes(method)) { req.resume(); refuse(405, 'Method not allowed.', { Allow: 'GET, PUT' }); return true; }
  const { store, meta } = recordings();
  if (!store.load(id)) { req.resume(); refuse(404, 'No recording has that id.'); return true; }
  if (meta.load(id).sample) { req.resume(); refuse(409, 'Live refinement belongs to your own recording.'); return true; }
  const dir = resolveDataDir(root, path.join(resolveDataDir(root, dataDir), 'live-refine'));
  const file = path.join(dir, `${id}.json`);
  const current = () => {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Object.assign(new Error('Invalid refinement storage.'), { status: 400 });
    const kept = readJson(file, null);
    if (!kept || typeof kept !== 'object') return createRefinement(id);
    return { ...createRefinement(id), ...kept, recordingId: id };
  };
  if (method !== 'PUT') {
    answer(200, current());
    return true;
  }
  if (locks.has(file)) { req.resume(); refuse(409, 'A refinement save is already running.'); return true; }
  locks.add(file);
  try {
    const body = await readJsonBody(SAVED_LIMITS.bodyBytes + 1024);
    if (body === null) return true;
    const checked = validateSaved(body);
    if (!checked.ok) { refuse(checked.status, checked.error); return true; }
    const kept = current();
    if (checked.value.baseRevision !== kept.revision) {
      answer(409, { error: 'These notes changed in another tab. Reload to see them; yours were not saved.', current: kept });
      return true;
    }
    fs.mkdirSync(dir, { recursive: true });
    const next = { version: 1, recordingId: id, revision: kept.revision + 1, updatedAt: new Date().toISOString(), conversation: checked.value.conversation, revisions: checked.value.revisions, intervals: checked.value.intervals };
    writeJsonAtomic(file, next);
    answer(200, next);
    return true;
  } finally {
    locks.delete(file);
  }
}
