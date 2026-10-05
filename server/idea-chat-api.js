// Saved idea conversation per idea, behind app-api's own-origin checks.
//
//   GET  /api/app/ideas/<id>/chat   { record, serverTime }  (an empty record when there is none)
//   POST /api/app/ideas/<id>/chat   { op: 'send' | 'claim' | 'reply' | 'fail' | 'accept' | 'dismiss' | 'undo', ... } -> { record, serverTime, result? }
//
// One JSON file per idea at <dataDir>/idea-chat/<id>.json, replaced atomically. The page can only ask for
// the steps src/engine/idea-chat.js allows, so it cannot rewrite history. Each step is read, applied and
// written with no await between them, so two tabs never lose one another's write; a step that no longer
// fits (a stale tab, a question already answered) is refused with 409 and the current record.
// It never touches the idea, its words or its beats: an accepted outline reaches the idea only when the
// page writes it through the idea store's own keptBeats. No model is called here.
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir, readJson, writeJsonAtomic } from '../src/node/store.js';
import { isIdeaId } from '../src/node/idea-store.js';
import { applyChatOp, createChatRecord, readableRecord, IDEA_CHAT_SAVED } from '../src/engine/idea-chat.js';

export const IDEA_CHAT_BODY_BYTES = IDEA_CHAT_SAVED.bodyBytes;

export async function handleIdeaChatApi({ req, rest, method, answer, refuse, readJsonBody, ideas, root, dataDir, now = () => new Date() }) {
  const m = /^ideas\/([^/]+)\/chat$/.exec(rest || '');
  if (!m) return false;
  const id = m[1];
  if (!isIdeaId(id)) { req.resume(); refuse(400, 'An idea id is 1 to 64 lower-case letters, digits and hyphens.'); return true; }
  if (!['GET', 'HEAD', 'POST'].includes(method)) { req.resume(); refuse(405, 'Method not allowed.', { Allow: 'GET, POST' }); return true; }
  if (!ideas().load(id)) { req.resume(); refuse(404, 'No idea has that id.'); return true; }
  const dir = resolveDataDir(root, path.join(resolveDataDir(root, dataDir), 'idea-chat'));
  const file = path.join(dir, `${id}.json`);
  const current = () => {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Object.assign(new Error('Invalid conversation storage.'), { status: 400 });
    let kept;
    try { kept = readJson(file, null); } catch (err) {
      if (err instanceof SyntaxError) throw Object.assign(new Error(`idea-chat/${id}.json is not valid JSON, the file may be half-written`), { name: 'CorruptIdeaChatError' });
      throw err;
    }
    return readableRecord(kept, id);
  };
  const serverTime = () => now().getTime();
  if (method !== 'POST') { answer(200, { record: current(), serverTime: serverTime() }); return true; }

  const body = await readJsonBody(IDEA_CHAT_BODY_BYTES);
  if (body === null) return true;
  // Read, apply and write with no await between them: this is the whole of the race guard.
  const kept = current();
  const stamp = serverTime();
  const out = applyChatOp(kept.ideaId ? kept : createChatRecord(id), body, stamp);
  if (!out.ok) {
    if (out.status === 409) answer(409, { error: out.error, record: out.current || kept, serverTime: stamp });
    else refuse(out.status, out.error);
    return true;
  }
  if (out.record !== kept) {
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(file, out.record);
  }
  answer(200, { record: out.record, serverTime: stamp, ...(out.result ? { result: out.result } : {}) });
  return true;
}
