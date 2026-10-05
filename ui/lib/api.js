// The page's calls to the app's routes on the Node side (D-104, D-105): ideas
// and recordings now, the rest in later plans. A screen's wire.js calls these
// and never builds a request of its own.
//
// Every request goes to a path of this app under /api/app/, with the browser
// told to refuse anything that is not same-origin, so nothing a person types is
// ever sent to another site. An id is checked against the route id rule before
// it is put in a path.
//
// In shell mode (ui/lib/app.js) nothing is sent and nothing is saved: each
// ideas function gives the drawn sample idea back, as the approved shells draw
// it, and test/app-api.test.js holds that drawn idea to the bundled idea bank.
// No recording is drawn: in shell mode a new one has the drawn id, and there
// is none to read or list.
import { isShellMode } from './app.js';
import { matchRoute } from './routes.js';

/** Every route the page calls sits under this prefix. */
export const APP_API = '/api/app/';

/** The id of the bundled sample idea, the gallery's first card. */
const SAMPLE_ID = 'sample';

/**
 * The sample idea as the shells draw it and as the idea bank bundles it
 * (ui/data/idea-bank.json): what every function gives back in shell mode. Every
 * idea in this phase is the drawn sample idea (QUESTIONS.md Q152).
 */
const DRAWN_IDEA = Object.freeze({
  id: SAMPLE_ID,
  title: 'Why I keep putting off filming',
  thought: '',
  words: [],
  state: 'saved',
  format: 'Talking head',
  thumb: '',
  ticks: {},
  keptBeats: [],
  createdAt: null,
  desc: "A personal look at perfectionism, overthinking and how I'm changing that.",
  updated: 'Updated 2 days ago',
  beats: [
    { id: 'hours', title: 'Hours of planning', line: 'I planned for hours.', source: 'idea' },
    { id: 'never', title: 'Never pressed record', line: 'I never pressed record.', source: 'idea' },
    { id: 'delay', title: 'Planning becomes the delay', line: 'Planning can become a way to avoid filming.', source: 'suggestion' },
    { id: 'imperfect', title: 'Try one imperfect take', line: 'Try filming one take before planning any more.', source: 'suggestion' },
    { id: 'first-step', title: 'Leave them with a first step', line: 'Start before you feel ready.', source: 'suggestion' },
  ],
});

/** A fresh copy of the drawn idea, so a caller that changes it changes only its own. */
const drawn = () => structuredClone(DRAWN_IDEA);

/** The path of one idea. Throws for an id that breaks the route id rule, before anything is sent. */
function ideaPath(id) {
  if (typeof id !== 'string' || !matchRoute(`/ideas/${id}`)) {
    throw new TypeError('An idea id is 1 to 64 lower-case letters, digits and hyphens.');
  }
  return `${APP_API}ideas/${id}`;
}

/**
 * One request to a path of this app. With `data` it is a POST of that JSON;
 * without, a GET. Gives the answer's JSON. An answer that is not a success is
 * thrown as an Error carrying the server's own words and its `status`, except
 * a 404 where `missing` is given, which gives `missing` back.
 * @param {{ fetch: Function }} scope the window
 * @param {string} path a path under APP_API
 * @param {{ data?: object, missing?: any }} [options]
 */
async function send(scope, path, options = {}) {
  /** @type {Record<string, any>} */
  const init = { mode: 'same-origin', credentials: 'same-origin', cache: 'no-store' };
  if (options.data !== undefined) {
    init.method = 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.data);
  }
  const res = await scope.fetch(path, init);
  let answer = null;
  try {
    answer = await res.json();
  } catch {
    answer = null;
  }
  if (res.ok) return answer;
  if (res.status === 404 && 'missing' in options) return options.missing;
  const words = answer && typeof answer.error === 'string' ? answer.error : `YAP could not do that (${res.status}).`;
  const err = new Error(words);
  /** @type {any} */ (err).status = res.status;
  throw err;
}

/**
 * One idea by its id, a bank id (`sample`, `idea-2` to `idea-6`) or a created
 * one; null when nobody has that id. In shell mode: the drawn sample idea.
 * @param {string} id
 * @param {{ location: any, fetch: Function }} [scope] the window; left out, the page's own
 * @returns {Promise<object | null>}
 */
export async function getIdea(id, scope = globalThis) {
  const path = ideaPath(id);
  if (isShellMode(scope.location)) return drawn();
  return send(scope, path, { missing: null });
}

/**
 * Keep a new idea from the person's first words, and give `{ id }`. In shell
 * mode nothing is kept and the id is the sample idea's.
 * @param {string} thought
 * @param {{ location: any, fetch: Function }} [scope]
 * @returns {Promise<{ id: string }>}
 */
export async function createIdea(thought, scope = globalThis) {
  if (isShellMode(scope.location)) return { id: SAMPLE_ID };
  return send(scope, `${APP_API}ideas`, { data: { thought } });
}

/**
 * Change what the person chose on an idea and give the idea back; null when
 * nobody has that id. `patch` takes any of state, format, thumb, ticks,
 * message and keptBeats. In shell mode nothing changes: the drawn sample idea.
 * @param {string} id
 * @param {object} patch
 * @param {{ location: any, fetch: Function }} [scope]
 * @returns {Promise<object | null>}
 */
export async function patchIdea(id, patch, scope = globalThis) {
  const path = ideaPath(id);
  // Without a patch this would be sent as a read: a change must say what it changes.
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('A patch is an object of the keys to change.');
  }
  if (isShellMode(scope.location)) return drawn();
  return send(scope, path, { data: patch, missing: null });
}

/** The path of one recording. Throws for an id that breaks the route id rule, before anything is sent. */
function recordingPath(id) {
  if (typeof id !== 'string' || !matchRoute(`/record/${id}`)) {
    throw new TypeError('A recording id is 1 to 64 lower-case letters, digits and hyphens.');
  }
  return `${APP_API}recordings/${id}`;
}

/**
 * Make the Recording a take is recorded into (D-127), and give `{ id }`. The
 * server makes the id. `body` is what ui/lib/prepare-model.js's
 * recordingRequest gives: { ideaId, title, idea, beats, deliveryCues, sample }.
 * In shell mode nothing is sent and nothing is saved: the id is the drawn one,
 * so the next address can be noted.
 * @param {object} body
 * @param {{ location: any, fetch: Function }} [scope]
 * @returns {Promise<{ id: string }>}
 */
export async function createRecordingFor(body, scope = globalThis) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('A recording is asked for with an object: its title, its beats and its delivery cues.');
  }
  if (isShellMode(scope.location)) return { id: SAMPLE_ID };
  return send(scope, `${APP_API}recordings`, { data: body });
}

/**
 * One recording by its id, as `{ recording, meta }`: the engine's record, and
 * beside it `meta.ideaId` (the idea it was prepared from, or null) and
 * `meta.sample` (true for the bundled sample take). Null when nobody has that
 * id. In shell mode nothing is sent and no recording is drawn: null.
 * @param {string} id
 * @param {{ location: any, fetch: Function }} [scope]
 * @returns {Promise<{ recording: object, meta: { id: string, ideaId: string | null, sample: boolean } } | null>}
 */
export async function getRecording(id, scope = globalThis) {
  const path = recordingPath(id);
  if (isShellMode(scope.location)) return null;
  return send(scope, path, { missing: null });
}

/**
 * The saved recordings, newest first: each one's id, title, status and
 * createdAt. In shell mode nothing is sent: none.
 * @param {{ location: any, fetch: Function }} [scope]
 * @returns {Promise<{ id: string, title: string, status: string, createdAt: string }[]>}
 */
export async function listRecordings(scope = globalThis) {
  if (isShellMode(scope.location)) return [];
  const answer = await send(scope, `${APP_API}recordings`);
  return answer && Array.isArray(answer.recordings) ? answer.recordings : [];
}

// Saved take lifecycle; every request stays on the local app origin.
export const saveTake = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/take', {data:patch});
export const restoreCut = (id, cutId, scope=globalThis) => send(scope, recordingPath(id)+'/cuts', {data:{cutId}});
// Trim keeps everything outside [start, end] as engine trim cuts. `expectedCutSnapshot` is the cut the person is looking at; the server refuses (409) if it moved.
export const trimRecording = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/trim', {data:patch});
// `extra` carries what an export needs besides the cut: the caption state the page showed and the caption pictures it drew.
export const exportRecording = (id, scope=globalThis, expectedCutSnapshot, extra) => send(scope, recordingPath(id)+'/export', {data:{...(expectedCutSnapshot===undefined?{}:{expectedCutSnapshot}),...(extra||{})}});
// Editor changes to the one saved cut list. Each names the cut snapshot the page was showing; the server refuses (409) if it moved.
// patch: { op: 'delete', from, to } | { op: 'restore' | 'remove-again', cutId } | { op: 'undo' }, plus expectedCutSnapshot.
export const editWords = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/words', {data:patch});
// patch: { op: 'apply' | 'restore', ids } | { op: 'apply-sure' | 'restore-all' }, plus expectedCutSnapshot.
export const changeAutocuts = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/autocut', {data:patch});
// patch: { op: 'enable', enabled } | { op: 'correct', i, text } | { op: 'clear' }, plus expectedRevision (the caption revision the page holds).
export const changeCaptions = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/captions', {data:patch});
// B-roll: one local clip laid over the picture of a stretch of the original recording.
// patch: { op: 'set', assetId, start, end, inPoint } | { op: 'clear' }, plus expectedRevision (the B-roll revision the page holds).
export const changeBroll = (id, patch, scope=globalThis) => send(scope, recordingPath(id)+'/broll', {data:patch});
// The clip's own bytes go up in one PUT. The file's name is only ever shown back as text; the server decides every real name, type and size.
export async function uploadBroll(id, file, scope=globalThis) {
 let res;
 try{res=await scope.fetch(recordingPath(id)+'/broll-asset',{method:'PUT',mode:'same-origin',credentials:'same-origin',headers:{'Content-Type':file.type||'application/octet-stream','X-Yap-File-Name':encodeURIComponent(String(file.name||'').slice(0,200))},body:file});}
 catch{throw Object.assign(new Error('The clip upload was interrupted, so nothing was saved. Try again.'),{status:0});}
 let result=null;
 try{result=JSON.parse(await res.text());}catch{}
 if(!res.ok)throw Object.assign(new Error((result&&result.error)||`The clip could not be added (the app answered ${res.status}).`),{status:res.status});
 if(!result||!result.asset)throw Object.assign(new Error('The app did not confirm the clip. Nothing was saved.'),{status:res.status});
 return result;
}
export const brollMediaUrl = (id, assetId) => recordingPath(id)+'/broll-media?asset='+encodeURIComponent(assetId);
export const getMemory = (scope=globalThis) => send(scope, APP_API+'memory');
export const saveMemory = (memory, scope=globalThis) => send(scope, APP_API+'memory', {data:memory});
export const getTrials = (scope=globalThis) => send(scope, APP_API+'trials');
// One PUT, no retry loop: Stop is the explicit retry. A reply is only success when the server says the video is published.
export async function uploadMedia(id, blob, scope=globalThis) {
 let res;
 try{res=await scope.fetch(recordingPath(id)+'/media',{method:'PUT',mode:'same-origin',credentials:'same-origin',headers:{'Content-Type':blob.type||'video/webm'},body:blob});}
 catch{throw Object.assign(new Error('The recording upload was interrupted before the app confirmed it was saved. Reload to check, or keep the original recording and press Stop to retry.'),{status:0});}
 let result=null;
 try{result=JSON.parse(await res.text());}catch{}
 if(!res.ok)throw Object.assign(new Error((result&&result.error)||`Could not save recording (the app answered ${res.status}).`),{status:res.status});
 if(!result||!result.video)throw Object.assign(new Error('The app did not confirm that the recording was saved. Reload to check, or keep the original recording and press Stop to retry.'),{status:res.status});
 return result;
}

export const saveTrial = (trial, scope=globalThis) => send(scope, APP_API+'trials', {data:trial});
// The check-in decision is made by the server on the trial as saved now: 'keep' or 'revert', once. A different later answer is refused.
export const answerTrialCheckIn = (trialId, answer, scope=globalThis) => send(scope, APP_API+'trials/'+encodeURIComponent(trialId)+'/check-in', {data:{answer}});
export async function listIdeas(scope=globalThis){if(isShellMode(scope.location))return [];const result=await send(scope,APP_API+'ideas');return result.ideas||[];}
