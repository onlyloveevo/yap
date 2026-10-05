// The presentation map's own words and rules, as pure functions. No page, no
// storage, no server and no model: ui/present/wire.js draws it,
// ui/lib/presentation-store.js keeps it, and ui/prepare/wire.js reads it back.
//
// A presentation is the person's own walk through YAP's fourteen steps: a title,
// up to three delivery cues, and for each step a beat (their own words, shown as
// the one talking point under their face when they record) and whether the step
// is in the talk at all. The stages stay in one list in running order; the map
// draws them by lane.
//
// Nothing here cuts or pads a word. recordingRequest (ui/lib/prepare-model.js)
// does not cut an own beat either, and the engine's createRecording has no cap on
// beats: the six-beat, three-word and six-word limits belong to beats a model
// writes (limitBeats), never to beats a person writes. A beat that is too long is
// refused with its number, never shortened.
import { DELIVERY_CUES, DELIVERY_DEFAULTS } from '../../src/engine/delivery.js';

export const DRAFT_VERSION = 1;
/** The longest title and the longest beat, in characters. A longer one is refused, never cut. */
export const TITLE_MAX = 120;
export const BEAT_MAX = 500;
export const MAX_CUES = DELIVERY_DEFAULTS.max;
/** Where Go Live opens: the existing Prepare, told to read the presentation. */
export const PREPARE_ADDRESS = '/prepare/new?presentation=1';
export const EDIT_ADDRESS = '/present';

/** Where a screen picture comes from: a design still the app was drawn from, or a screenshot of the app as it was built. Never "live". */
export const IMAGE_KINDS = Object.freeze({
  design: 'Design reference',
  build: 'Build screenshot',
});

export const LANES = Object.freeze([
  Object.freeze({ id: 'make', name: 'Make', note: 'Idea to talking points' }),
  Object.freeze({ id: 'record', name: 'Record', note: 'Prepare, then talk to the camera' }),
  Object.freeze({ id: 'edit', name: 'Edit', note: 'Cuts, export, the next take', loop: 'After step 12 the next take starts again at step 5.' }),
  Object.freeze({ id: 'review', name: 'Review', note: 'What worked', loop: 'What you learn in step 14 goes into the next idea, step 1.' }),
]);

const stage = (n, lane, name, image, imageKind, you, yap, prompt, open, note) => Object.freeze({ id: `s${n}`, n, lane, name, image: `assets/${image}`, imageKind, you, yap, prompt, open: open || null, note: note || '' });

/**
 * The fourteen steps of docs/ara-brief/user-flow.html, in its order and its
 * words. `prompt` is a short suggestion the person is expected to replace;
 * `open` is the address of that step in the working app where one exists
 * without an idea or a recording id.
 */
export const STAGES = Object.freeze([
  stage(1, 'make', 'Ideas', 'design-01.jpg', 'design', 'type or say a rough idea.', 'opens a conversation about it.', 'Start with one rough idea, in a sentence.', '/'),
  stage(2, 'make', 'Talk it through', 'design-02.jpg', 'design', 'add detail and pick a format.', 'keeps your own words and suggests a format.', 'Add the detail that makes it yours.'),
  stage(3, 'make', 'The idea takes shape', 'design-03.jpg', 'design', 'read the story, title and thumbnail ideas.', 'drafts them from what you said.', 'Read what comes back and notice your own words in it.'),
  stage(4, 'make', 'Confirm', 'design-04.jpg', 'design', 'confirm the idea.', 'saves it to your idea bank.', 'Confirm it so it is saved for later.'),
  stage(5, 'make', 'Create', 'design-05.jpg', 'design', 'pick a saved idea to record.', 'opens its talking points.', 'Pick a saved idea to record.', '/create'),
  stage(6, 'make', 'Talking points', 'design-06.jpg', 'design', 'edit, add, remove and reorder the points.', 'splits the idea into beats and suggests some.', 'Shape the points until they sound like you.'),
  stage(7, 'record', 'Prepare', 'build-prepare.jpg', 'build', 'choose your delivery cues and check the camera.', 'shows your points and cues before you start.', 'Choose how you want to come across, then check the camera.', '/prepare/new', 'Screenshot from the build; there is no original design still for this step.'),
  stage(8, 'record', 'Record', 'design-07.jpg', 'design', 'talk to the camera.', 'keeps one point under your face and follows your voice.', 'Talk to the camera; one point stays under your face.'),
  stage(9, 'record', 'Hey YAP, mid-take', 'design-08.jpg', 'design', 'hold H and ask for another angle, or try one change for three videos.', 'changes the point on screen while you keep recording.', 'Hold H and ask for another angle without stopping.'),
  stage(10, 'edit', 'Edit', 'design-09.jpg', 'design', 'press Stop, look at the cuts, put back any you want.', 'has cut your restarts and your talk with it.', 'Press Stop and look at what was cut.'),
  stage(11, 'edit', 'Export', 'design-09.jpg', 'design', 'export the video.', 'renders an MP4 of the cut; the original is kept.', 'Export an MP4; the original stays safe.', null, 'Same screen as step 10.'),
  stage(12, 'edit', 'Next take', 'build-next-take.jpg', 'build', 'keep or drop a cue.', 'starts your next take from what you kept.', 'Keep or drop a cue, and the next take starts from it.', null, 'Screenshot from the build; there is no original design still for this step.'),
  stage(13, 'review', 'Review inbox', 'design-10.jpg', 'design', 'pick a video you published.', 'lists the videos that are ready to review.', 'Pick a video you published.', '/review'),
  stage(14, 'review', 'Review a video', 'design-11.jpg', 'design', 'click a number, read what happened, try one experiment.', 'explains the number and saves the change as a trial.', 'Click a number and try one experiment.'),
]);

export const stageById = (id) => STAGES.find((each) => each.id === id) || null;
const CUE_KINDS = DELIVERY_CUES.map((cue) => cue.kind);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A fresh draft: every step on, in the map's order, each with its replaceable suggestion. */
export function defaultDraft() {
  return { v: DRAFT_VERSION, title: '', cues: [], stages: STAGES.map((each) => ({ id: each.id, on: true, beat: each.prompt })) };
}

/** True while a step still holds the suggestion nobody has written over. */
export const isSuggestion = (entry) => Boolean(entry && stageById(entry.id) && entry.beat === stageById(entry.id).prompt);

/**
 * A draft as it was kept, checked. Unknown steps are dropped and a step the
 * draft does not know is added at the end, switched off with its suggestion;
 * the words themselves are never touched. Anything that is not a draft gives
 * `{ ok: false }` so the caller can say so instead of showing a blank page.
 * @param {unknown} raw
 * @returns {{ ok: true, draft: ReturnType<typeof defaultDraft> } | { ok: false, error: string }}
 */
export function readDraft(raw) {
  if (!isObject(raw) || raw.v !== DRAFT_VERSION) return { ok: false, error: 'The saved presentation is not one this page can read.' };
  if (typeof raw.title !== 'string' || !Array.isArray(raw.stages) || !Array.isArray(raw.cues)) return { ok: false, error: 'The saved presentation is incomplete.' };
  const seen = new Set();
  const stages = [];
  for (const entry of raw.stages) {
    if (!isObject(entry) || !stageById(entry.id) || seen.has(entry.id) || typeof entry.beat !== 'string' || typeof entry.on !== 'boolean') continue;
    seen.add(entry.id);
    stages.push({ id: entry.id, on: entry.on, beat: entry.beat });
  }
  if (stages.length === 0) return { ok: false, error: 'The saved presentation has no steps.' };
  for (const each of STAGES) if (!seen.has(each.id)) stages.push({ id: each.id, on: false, beat: each.prompt });
  const cues = CUE_KINDS.filter((kind) => raw.cues.includes(kind)).slice(0, MAX_CUES);
  return { ok: true, draft: { v: DRAFT_VERSION, title: raw.title, cues, stages } };
}

/**
 * Whether a draft can go live, and why not. The first problem is named in
 * plain words with the step it is on; nothing is repaired.
 * @param {ReturnType<typeof defaultDraft>} draft
 * @returns {{ ok: true } | { ok: false, error: string, stageId: string | null }}
 */
export function checkDraft(draft) {
  if (!isObject(draft) || !Array.isArray(draft.stages)) return { ok: false, error: 'There is no presentation to record yet.', stageId: null };
  if (typeof draft.title !== 'string' || Array.from(draft.title).length > TITLE_MAX) return { ok: false, error: `A title is at most ${TITLE_MAX} characters.`, stageId: null };
  const on = draft.stages.filter((entry) => entry.on);
  if (on.length === 0) return { ok: false, error: 'Switch on at least one step to talk about.', stageId: null };
  for (const entry of on) {
    const info = stageById(entry.id);
    const words = typeof entry.beat === 'string' ? entry.beat : '';
    if (!info) return { ok: false, error: 'A step in this presentation is not one YAP knows.', stageId: null };
    if (words.trim() === '') return { ok: false, error: `Step ${info.n}, ${info.name}, has no words. Write your beat or switch the step off.`, stageId: info.id };
    const length = Array.from(words).length;
    if (length > BEAT_MAX) return { ok: false, error: `Step ${info.n}, ${info.name}, is ${length} characters. A beat is at most ${BEAT_MAX}; shorten it yourself.`, stageId: info.id };
  }
  if (!Array.isArray(draft.cues) || draft.cues.length > MAX_CUES || new Set(draft.cues).size !== draft.cues.length || draft.cues.some((kind) => !CUE_KINDS.includes(kind))) {
    return { ok: false, error: `Pick up to ${MAX_CUES} delivery cues.`, stageId: null };
  }
  return { ok: true };
}

/**
 * The view recordingRequest (ui/lib/prepare-model.js) turns into the body of
 * POST /api/app/recordings: the title as typed, each switched-on step as one
 * beat labelled with the step's name whose one talking point is the person's
 * exact beat, in running order, with no idea attached.
 * @param {ReturnType<typeof defaultDraft>} draft
 * @returns {{ ok: true, view: { ideaId: null, title: string, idea: string, beats: { label: string, points: string[] }[] }, cues: string[] } | { ok: false, error: string, stageId: string | null }}
 */
export function recordingView(draft) {
  const checked = checkDraft(draft);
  if (!checked.ok) return checked;
  const beats = draft.stages.filter((entry) => entry.on).map((entry) => ({ label: stageById(entry.id).name, points: [entry.beat] }));
  return { ok: true, view: { ideaId: null, title: draft.title, idea: draft.title, beats }, cues: [...draft.cues] };
}

/** The draft as plain text a person can copy or keep when the browser will not store it. Their words exactly, in running order. */
export function exportText(draft) {
  const lines = [`Title: ${draft.title}`, ''];
  let n = 0;
  for (const entry of draft.stages) {
    if (!entry.on) continue;
    n += 1;
    lines.push(`${n}. ${stageById(entry.id).name}`, entry.beat, '');
  }
  const cues = draft.cues.map((kind) => DELIVERY_CUES.find((cue) => cue.kind === kind).text);
  if (cues.length) lines.push(`Delivery cues: ${cues.join(', ')}`);
  return lines.join('\n').trimEnd() + '\n';
}

/** A step moved one place within the running order of the switched-on steps; the others stay where they are. */
export function moveStage(draft, id, direction) {
  const order = draft.stages.map((entry, i) => i).filter((i) => draft.stages[i].on);
  const at = order.findIndex((i) => draft.stages[i].id === id);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= order.length) return draft;
  const stages = draft.stages.slice();
  [stages[order[at]], stages[order[to]]] = [stages[order[to]], stages[order[at]]];
  return { ...draft, stages };
}
