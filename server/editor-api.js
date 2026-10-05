// The editor's saved changes: remove or restore words, apply or restore
// automatic cuts, and the caption settings. Called by take-api.js after
// app-api's same-origin checks, for POST recordings/:id/{words,autocut,captions}.
//
// Every change is made to the one saved recording by re-reading it after the
// request body has arrived and saving it with no await in between, so two
// requests cannot overwrite each other. A cut change names the cut the page was
// showing (`expectedCutSnapshot`); if the saved cut has moved on, nothing is
// changed (409). A caption change names the caption revision it was made on.
// The saved words and the original media are never written.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveFfmpeg } from '../src/node/export-file.js';
import { resolveDataDir } from '../src/node/store.js';
import { TIMELINE_FPS } from '../src/engine/export.js';
import { handleMediaLibraryApi, sendFile } from './broll-api.js';
import { timedWords } from '../src/engine/editor-words.js';
import { removeWordRange, restoreRun, removeRunAgain, undoLast, changeAutocuts, EditorOpError } from '../src/engine/editor-ops.js';
import { captionState, sanitizeCaptionText, CAPTION_LIMITS, CAPTION_COPY } from '../src/engine/caption-model.js';

export const EDITOR_ACTIONS = Object.freeze(['words', 'autocut', 'captions']);

const num = (x) => typeof x === 'number' && Number.isFinite(x);

function snapshotOf(duration, cuts) {
  return JSON.stringify({ duration, cuts: cuts.map(({ id, start, end, applied }) => ({ id, start, end, applied })).sort((a, b) => a.id.localeCompare(b.id)) });
}

function validSnapshot(expected) {
  return expected && num(expected.duration) && expected.duration > 0 && Array.isArray(expected.cuts)
    && expected.cuts.every((c) => c && typeof c.id === 'string' && num(c.start) && num(c.end) && typeof c.applied === 'boolean');
}

/**
 * @param {{ id: string, action: string, body: any, store: any, info: any, uploading: Set<string>, answer: Function, refuse: Function }} ctx
 */
export function runEditorAction({ id, action, body, store, info, uploading, answer, refuse }) {
  // The recording is read again here, after the body was awaited: a change saved meanwhile is the one this builds on.
  const current = store.load(id);
  if (!current || current.status !== 'ready' || !current.video) { refuse(409, 'Finish and save the take before editing it.'); return; }
  if (uploading.has(id)) { refuse(409, 'The recording is still being saved. Wait for it to finish, then try again.'); return; }
  try {
    if (action === 'captions') { captionsAction(current, body, store, info, answer, refuse); return; }
    const expected = body.expectedCutSnapshot;
    if (!validSnapshot(expected)) { refuse(400, 'Invalid cut snapshot. Reload to review the current cut and try again.'); return; }
    if (snapshotOf(expected.duration, expected.cuts) !== snapshotOf(current.duration, current.cuts.cuts)) {
      refuse(409, 'The saved cut changed in another page. Nothing was changed. Reload to review it, then try again.');
      return;
    }
    let result;
    if (action === 'words') {
      if (body.op === 'delete') result = removeWordRange(current, body.from, body.to);
      else if (body.op === 'restore') result = restoreRun(current, body.cutId);
      else if (body.op === 'remove-again') result = removeRunAgain(current, body.cutId);
      else if (body.op === 'undo') result = undoLast(current);
      else { refuse(400, 'Unknown word edit.'); return; }
    } else {
      result = changeAutocuts(current, body.op, body.ids);
    }
    const next = result.changed ? { ...current, cuts: result.list } : current;
    if (result.changed) store.save(next);
    answer(200, { recording: next, meta: info, changed: result.changed, note: result.note || '', adjusted: Boolean(result.adjusted), cutId: result.cutId || null, count: result.count });
  } catch (error) {
    if (error instanceof EditorOpError) { refuse(error.status, error.message); return; }
    throw error;
  }
}

function captionsAction(current, body, store, info, answer, refuse) {
  const state = captionState(current);
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== state.revision) {
    refuse(409, 'The captions changed in another page. Nothing was changed. Reload to review them, then try again.');
    return;
  }
  let { enabled, corrections } = state;
  if (body.op === 'enable') {
    if (typeof body.enabled !== 'boolean') { refuse(400, 'Captions are turned on or off with true or false.'); return; }
    if (body.enabled && !timedWords(current.transcript, current.duration).length) { refuse(422, CAPTION_COPY.noWords); return; }
    enabled = body.enabled;
  } else if (body.op === 'correct') {
    const timed = timedWords(current.transcript, current.duration);
    const word = Number.isInteger(body.i) ? timed.find((w) => w.i === body.i) : null;
    if (!word) { refuse(422, 'Choose a timed word to correct. Words with no timing are not captioned.'); return; }
    if (typeof body.text !== 'string') { refuse(400, 'The corrected caption text must be text.'); return; }
    const text = sanitizeCaptionText(body.text);
    if (body.text.trim() && !text) { refuse(400, 'That caption text has no visible characters. Use Reset to go back to the saved word.'); return; }
    corrections = corrections.filter((x) => x.i !== word.i);
    if (text && text !== word.text.trim()) {
      if (corrections.length >= CAPTION_LIMITS.maxCorrections) { refuse(422, `A recording keeps at most ${CAPTION_LIMITS.maxCorrections} caption corrections.`); return; }
      corrections.push({ i: word.i, was: current.transcript[word.i].text, text });
      corrections.sort((a, b) => a.i - b.i);
    }
  } else if (body.op === 'clear') {
    corrections = [];
  } else { refuse(400, 'Unknown caption change.'); return; }
  const same = enabled === state.enabled && JSON.stringify(corrections) === JSON.stringify(state.corrections);
  const next = same ? current : { ...current, captions: { enabled, corrections, revision: state.revision + 1 } };
  if (!same) store.save(next);
  answer(200, { recording: next, meta: info, changed: !same, captions: captionState(next) });
}

// ---- Routes of the editor that are not under one recording's cut: the media library and the original as an MP4 ----

const RECORDING_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** One conversion per recording at a time; a second request waits for the first. */
const converting = new Map();

/** The original recording as a constant-frame-rate MP4, the file the exported EDL and XML timelines point at. Made once, then kept. */
function originalAsMp4(ffmpeg, source, target) {
  if (converting.has(target)) return converting.get(target);
  const job = new Promise((resolve) => {
    const tmp = `${target}.tmp-${process.pid}`;
    let child;
    try {
      child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-vf', `fps=${TIMELINE_FPS}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', '-y', tmp], { stdio: 'ignore' });
    } catch { resolve(false); return; }
    child.once('error', () => { fs.rmSync(tmp, { force: true }); resolve(false); });
    child.once('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, target); resolve(true); } else { fs.rmSync(tmp, { force: true }); resolve(false); }
    });
  }).finally(() => converting.delete(target));
  converting.set(target, job);
  return job;
}

/**
 * GET originals/:id and the media library (server/broll-api.js).
 * @returns {Promise<boolean>} true when the request was one of these routes and has been answered
 */
export async function handleEditorExtras({ req, res, rest, method, answer, refuse, readJsonBody, recordings, root, dataDir }) {
  if (await handleMediaLibraryApi({ req, res, rest, method, answer, refuse, readJsonBody, root, dataDir })) return true;
  const m = /^originals\/([^/]+)$/.exec(rest || '');
  if (!m) return false;
  const id = m[1];
  if (!['GET', 'HEAD'].includes(method)) { req.resume(); refuse(405, 'Method not allowed.'); return true; }
  if (!RECORDING_ID.test(id)) { refuse(400, 'Invalid recording id.'); return true; }
  const { store, meta } = recordings();
  const recording = store.load(id);
  if (!recording || recording.status !== 'ready' || !recording.video) { refuse(404, 'No finished recording has that id.'); return true; }
  const info = meta.load(id);
  const name = `YAP-${id}-original.mp4`;
  if (info.sample) { sendFile(req, res, path.join(root, 'sample', `${info.sampleTake === 2 ? 'take2' : 'take1'}.mp4`), 'video/mp4', name); return true; }
  const source = path.join(resolveDataDir(root, path.join(dataDir, 'media')), `${id}.webm`);
  const exportsDir = resolveDataDir(root, path.join(dataDir, 'exports'));
  const target = path.join(exportsDir, `${id}.original.mp4`);
  if (!fs.existsSync(source)) { refuse(404, 'The original recording is not on this computer.'); return true; }
  if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < fs.statSync(source).mtimeMs) {
    const ffmpeg = resolveFfmpeg({ appRoot: root });
    if (!ffmpeg) { refuse(503, 'Run npm run setup from this app folder to restore video export. The original take is safe.'); return true; }
    fs.mkdirSync(exportsDir, { recursive: true });
    if (!await originalAsMp4(ffmpeg, source, target)) { refuse(422, 'The original could not be prepared as an MP4. The recording itself is safe.'); return true; }
  }
  sendFile(req, res, target, 'video/mp4', name);
  return true;
}
