// B-roll routes, called by take-api.js after app-api's same-origin checks:
//   PUT  recordings/:id/broll-asset   the clip's bytes (streamed, bounded, probed, then kept under a name made from its hash)
//   GET  recordings/:id/broll-media   ?asset=<32 hex> the kept clip, for the editor's preview
//   POST recordings/:id/broll         { op: 'set' | 'clear', expectedRevision, ... } the saved choice
//
// What keeps this safe:
// - The clip lives in this recording's media folder under a name the server makes (`<id>.broll-<hash>.<ext>`). Nothing
//   the page sends is ever part of a path; the file name it reports is kept only as sanitised display text.
// - A clip is believed only after ffmpeg has read its picture track end to end (src/node/broll-probe.js).
// - A clip is published by rename, so an interrupted upload leaves nothing and an earlier clip is never overwritten.
// - A choice names the revision the page held; if the saved choice moved on, nothing changes (409).
// - Errors are plain words. No path and no ffmpeg output ever reaches the page.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { resolveFfmpeg } from '../src/node/export-file.js';
import { writeJsonAtomic, readJson } from '../src/node/store.js';
import { BROLL_LIMITS, brollState, checkBrollRange, validAsset } from '../src/engine/broll-plan.js';
import { keptRanges } from '../src/engine/cutlist.js';
import { sanitizeCaptionText } from '../src/engine/caption-model.js';
import { probeClip, looksLikeVideo, BrollClipError } from '../src/node/broll-probe.js';

/** The upload bound and deadline; exported so a test can lower them. */
export const brollLimits = { maxBytes: BROLL_LIMITS.maxBytes, probeMs: 120000, afterChunk: null };
/** Clips kept for one recording. Choosing another clip never deletes an earlier one. */
const MAX_ASSETS = 24;
export const BROLL_ACTIONS = Object.freeze(['broll', 'broll-asset', 'broll-media']);

const importing = new Set();
const ASSET_ID = /^[a-f0-9]{32}$/;
const MIME = { mp4: 'video/mp4', webm: 'video/webm' };
const sizeWords = (n) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${+(n / 1024 ** 2).toFixed(1)} MB` : `${n} bytes`);

const clipFile = (mediaDir, id, asset) => path.join(mediaDir, `${id}.broll-${asset.id}.${asset.container}`);
const sidecarFile = (mediaDir, id, assetId) => path.join(mediaDir, `${id}.broll-${assetId}.json`);

/** A kept clip's record, only when its sidecar and its file both exist and agree. Null otherwise. */
export function loadAsset(mediaDir, id, assetId) {
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) return null;
  let asset;
  try { asset = readJson(sidecarFile(mediaDir, id, assetId), null); } catch { return null; }
  if (!validAsset(asset) || asset.id !== assetId) return null;
  const file = clipFile(mediaDir, id, asset);
  try {
    const link = fs.lstatSync(file);
    if (!link.isFile() || link.isSymbolicLink() || link.size !== asset.bytes) return null;
    // The file must really be inside this recording's media folder, whatever the folder itself is a link to.
    const real = fs.realpathSync(file);
    const root = fs.realpathSync(mediaDir);
    if (path.dirname(real) !== root) return null;
  } catch { return null; }
  return asset;
}

/** SHA-256 of a clip, read in chunks through a read-only handle. */
function sha256File(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      hash.update(buf.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/**
 * The clip an export will use, checked once more at the moment of export: it must still be there, the same size and
 * the same bytes. Returns its path. Throws BrollClipError in words for the page otherwise.
 */
export function assetForExport(mediaDir, id, saved) {
  const asset = loadAsset(mediaDir, id, saved.id);
  if (!asset || asset.sha256 !== saved.sha256) throw new BrollClipError('The B-roll clip is missing or has changed. Remove the B-roll and add the clip again. The original recording is safe.', 409);
  const file = clipFile(mediaDir, id, asset);
  if (sha256File(file) !== asset.sha256) throw new BrollClipError('The B-roll clip has changed since it was added. Remove the B-roll and add the clip again. The original recording is safe.', 409);
  return file;
}

class ReceiveError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** Stream the body to a staging file, counting real bytes and hashing as they arrive. */
async function receive(req, mediaDir, id, declared) {
  const staging = path.join(mediaDir, `${id}.broll-${randomBytes(6).toString('hex')}.upload`);
  const handle = await fs.promises.open(staging, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);
  let closed = false;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > brollLimits.maxBytes) throw new ReceiveError(413, `The clip is larger than ${sizeWords(brollLimits.maxBytes)}.`);
      if (head.length < 12) {
        head = Buffer.concat([head, chunk.subarray(0, 12 - head.length)]);
        if (head.length === 12 && !looksLikeVideo(head)) throw new ReceiveError(415, 'This is not a video YAP can read. Use an MP4, WebM, MOV or M4V video file.');
      }
      hash.update(chunk);
      await handle.writeFile(chunk);
      brollLimits.afterChunk?.(bytes);
    }
    if (!req.complete || (Number.isFinite(declared) && bytes !== declared)) throw new ReceiveError(400, 'The clip upload was cut short, so nothing was saved.');
    if (bytes < 64 || !looksLikeVideo(head)) throw new ReceiveError(415, 'This is not a video YAP can read. Use an MP4, WebM, MOV or M4V video file.');
    await handle.sync();
    await handle.close();
    closed = true;
    return { staging, bytes, sha256: hash.digest('hex') };
  } catch (error) {
    if (!closed) await handle.close().catch(() => {});
    await fs.promises.rm(staging, { force: true });
    throw error;
  }
}

function displayName(header) {
  let raw = '';
  try { raw = decodeURIComponent(String(header || '')); } catch { raw = ''; }
  const base = raw.split(/[\\/]/).pop() || '';
  return sanitizeCaptionText(base, BROLL_LIMITS.nameChars) || 'B-roll clip';
}

async function importClip({ req, res, refuse, answer, id, root, mediaDir }) {
  const declared = Number(req.headers['content-length']);
  fs.mkdirSync(mediaDir, { recursive: true });
  const ffmpeg = resolveFfmpeg({ appRoot: root });
  if (!ffmpeg) { req.resume(); refuse(503, 'Run npm run setup from this app folder to restore the video runtime. Nothing was saved.'); return; }
  let received;
  try {
    received = await receive(req, mediaDir, id, declared);
  } catch (error) {
    if (error instanceof ReceiveError) {
      refuse(error.status, error.message);
      req.resume();
      if (error.status === 413) res.once('finish', () => setTimeout(() => req.destroy(), 1000).unref());
      return;
    }
    if (req.aborted || !res.writable || res.socket?.destroyed) return;
    req.resume();
    refuse(error?.code === 'ENOSPC' ? 507 : 500, error?.code === 'ENOSPC' ? 'There is not enough disk space to keep this clip.' : 'The clip could not be received. Please retry.');
    return;
  }
  const assetId = received.sha256.slice(0, 32);
  try {
    // The same clip again: keep the one already here, byte for byte.
    const existing = loadAsset(mediaDir, id, assetId);
    if (existing && existing.sha256 === received.sha256) {
      fs.rmSync(received.staging, { force: true });
      answer(200, { asset: existing, reused: true });
      return;
    }
    const kept = fs.readdirSync(mediaDir).filter((f) => f.startsWith(`${id}.broll-`) && f.endsWith('.json')).length;
    if (kept >= MAX_ASSETS) { fs.rmSync(received.staging, { force: true }); refuse(409, `This recording already keeps ${MAX_ASSETS} B-roll clips. Nothing was added.`); return; }
    const probed = await probeClip(ffmpeg, received.staging, { probeMs: brollLimits.probeMs });
    const asset = {
      id: assetId, bytes: received.bytes, sha256: received.sha256, duration: probed.duration, width: probed.width, height: probed.height,
      container: probed.container, name: displayName(req.headers['x-yap-file-name']),
    };
    // Publish: the clip first, its record last, so a record always has its clip.
    fs.renameSync(received.staging, clipFile(mediaDir, id, asset));
    writeJsonAtomic(sidecarFile(mediaDir, id, assetId), asset);
    answer(200, { asset, reused: false });
  } catch (error) {
    fs.rmSync(received.staging, { force: true });
    if (error instanceof BrollClipError) { refuse(error.status, `${error.message} Nothing was saved.`); return; }
    refuse(500, 'The clip could not be checked. Nothing was saved.');
  }
}

/**
 * @returns {Promise<boolean>} true when the request was a B-roll route and has been answered
 */
export async function handleBrollApi({ req, res, id, action, method, store, info, mediaDir, root, answer, refuse, readJsonBody, uploading, fileReply }) {
  if (!BROLL_ACTIONS.includes(action)) return false;
  const recording = store.load(id);
  if (action === 'broll-media') {
    if (!['GET', 'HEAD'].includes(method)) { req.resume(); refuse(405, 'Method not allowed.'); return true; }
    const asset = loadAsset(mediaDir, id, new URL(req.url, 'http://localhost').searchParams.get('asset'));
    if (!asset) { refuse(404, 'No B-roll clip has that id.'); return true; }
    fileReply(req, res, clipFile(mediaDir, id, asset), MIME[asset.container]);
    return true;
  }
  if (action === 'broll-asset') {
    if (method !== 'PUT') { req.resume(); refuse(405, 'Method not allowed.'); return true; }
    if (!recording || recording.status !== 'ready' || !recording.video) { req.resume(); refuse(409, 'Finish and save the take before adding B-roll.'); return true; }
    if (uploading.has(id)) { req.resume(); refuse(409, 'The recording is still being saved. Wait for it to finish, then try again.'); return true; }
    if (Number(req.headers['content-length']) > brollLimits.maxBytes) { req.resume(); refuse(413, `The clip is larger than ${sizeWords(brollLimits.maxBytes)}.`); return true; }
    // Claimed before any await: a second import for this recording is refused, never interleaved.
    if (importing.has(id)) { req.resume(); refuse(409, 'Another clip is still being added to this recording. Wait for it to finish.'); return true; }
    importing.add(id);
    try { await importClip({ req, res, refuse, answer, id, root, mediaDir }); } finally { importing.delete(id); }
    return true;
  }
  // POST broll
  if (method !== 'POST') { req.resume(); refuse(405, 'Method not allowed.'); return true; }
  const body = await readJsonBody(4 * 1024);
  if (!body) return true;
  // Read again after the body arrived: a change saved meanwhile is the one this builds on. No await from here to the save.
  const current = store.load(id);
  if (!current || current.status !== 'ready' || !current.video) { refuse(409, 'Finish and save the take before editing it.'); return true; }
  if (uploading.has(id)) { refuse(409, 'The recording is still being saved. Wait for it to finish, then try again.'); return true; }
  const state = brollState(current);
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== state.revision) {
    refuse(409, 'The B-roll changed in another page. Nothing was changed. Reload to review it, then try again.');
    return true;
  }
  if (body.op === 'clear') {
    if (!state.asset) { answer(200, { recording: current, meta: info, changed: false, broll: state }); return true; }
    const next = { ...current, broll: { asset: null, start: 0, end: 0, inPoint: 0, revision: state.revision + 1 } };
    store.save(next);
    answer(200, { recording: next, meta: info, changed: true, broll: brollState(next) });
    return true;
  }
  if (body.op !== 'set') { refuse(400, 'Unknown B-roll change.'); return true; }
  const asset = loadAsset(mediaDir, id, body.assetId);
  if (!asset) { refuse(404, 'That B-roll clip is not kept for this recording. Add the clip again.'); return true; }
  const checked = checkBrollRange({ start: body.start, end: body.end, inPoint: body.inPoint }, asset, current.duration, keptRanges(current.cuts, current.duration));
  if (!checked.ok) { refuse(422, checked.error); return true; }
  const same = state.asset && state.asset.id === asset.id && state.start === checked.start && state.end === checked.end && state.inPoint === checked.inPoint;
  if (same) { answer(200, { recording: current, meta: info, changed: false, broll: state }); return true; }
  const next = { ...current, broll: { asset, start: checked.start, end: checked.end, inPoint: checked.inPoint, revision: state.revision + 1 } };
  store.save(next);
  answer(200, { recording: next, meta: info, changed: true, broll: brollState(next) });
  return true;
}
