import { preparedAngleFields } from './prepared-angles.js';
// The Recording record (DATA-01; D-71): one record for one recording, with
// its beats and their takes, delivery cues, the video it points at, the
// transcript, the cut list, the review moments and the trials that ran in it.
//
// It adds no second model beside Phase 1 (D-37): `beats` are the episode's
// beats with their takes as src/engine/episode.js keeps them (Phase 1 D-15),
// plus the story beat's label and talking points; `cuts` is the cut list of
// src/engine/cutlist.js with its undo stack. Delivery cues, review moments and
// experiment entries are stored as the modules that make them shape them.
//
// The record is saved on this machine only (Phase 1 D-31), through
// src/node/recording-store.js. `video` is a file name inside the data folder
// and a size, never the bytes.
//
// Pure and browser-safe: never mutates its inputs and returns new objects.

import { createCutList } from './cutlist.js';

/**
 * @typedef {import('./episode.js').Beat} EpisodeBeat
 * @typedef {import('./episode.js').Episode} Episode
 * @typedef {import('./cutlist.js').CutList} CutList
 * @typedef {import('./cutlist.js').Word} Word
 * @typedef {'draft' | 'recording' | 'processing' | 'ready'} RecordingStatus
 * @typedef {EpisodeBeat & { label: string, points: string[] }} RecordingBeat
 * @typedef {{ id: string, label: string, points: string[], source?: string }} StoryBeat
 * @typedef {{ id: string, kind: string, text: string, beatId: string | null }} DeliveryCue
 * @typedef {{ id: string, time: number, type: 'story' | 'delivery', observation: string,
 *   suggestedCue: string | null, decision: null | 'accepted' | 'dismissed' }} ReviewMoment
 * @typedef {{ file: string, mime: string, bytes: number }} VideoRef
 * @typedef {{ id: string, line: string }} RecordingExperiment the id and the status line of a trial that ran in this recording
 * @typedef {{ version: 1, id: string, title: string, status: RecordingStatus, idea: string, beats: RecordingBeat[],
 *   deliveryCues: DeliveryCue[], video: VideoRef | null, duration: number | null, transcript: Word[], cuts: CutList,
 *   reviewMoments: ReviewMoment[], experiments: RecordingExperiment[], createdAt: string }} Recording
 */

/** The life of a recording, in order (D-71). */
export const RECORDING_STATUSES = Object.freeze(['draft', 'recording', 'processing', 'ready']);

/** What the person may decide about a review moment; null is no decision yet. */
const MOMENT_DECISIONS = Object.freeze([null, 'accepted', 'dismissed']);

/**
 * A recording id is also its file name (T-01.1-18): lower-case letters, digits
 * and hyphens, 1 to 64 characters, starting with a letter or a digit.
 */
const RECORDING_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RULE = '1 to 64 lower-case letters, digits and hyphens, starting with a letter or a digit';

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const shown = (v) => (v === undefined ? 'nothing' : JSON.stringify(v));

/**
 * Whether a value can be a recording's id, and so its file name.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isRecordingId(id) {
  return typeof id === 'string' && RECORDING_ID.test(id);
}

/** The first problem with a video reference, or null. */
function videoProblem(video) {
  if (video === null) return null;
  if (!isObject(video)) return 'video must be null or { file, mime, bytes }';
  if (!isText(video.file) || /[\\/]/.test(video.file) || video.file === '.' || video.file === '..') {
    return `video.file must be a file name inside the data folder, never a path (found ${shown(video.file)})`;
  }
  if (!isText(video.mime)) return 'video.mime must be a non-empty string';
  if (!Number.isInteger(video.bytes) || video.bytes < 0) return 'video.bytes must be the size of the file as a whole number, never the bytes themselves';
  return null;
}

/**
 * Check a recording whole, in the style of validateBrief. `errors` lists
 * every problem found, the first one first.
 * @param {unknown} obj
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRecording(obj) {
  if (!isObject(obj)) return { ok: false, errors: ['the recording must be an object'] };
  const r = /** @type {Record<string, any>} */ (obj);
  const errors = [];

  if (r.version !== 1) errors.push(`version must be 1 (found ${shown(r.version)})`);
  if (!isRecordingId(r.id)) errors.push(`id must be ${ID_RULE} (found ${shown(r.id)})`);
  if (typeof r.title !== 'string') errors.push('title must be a string');
  if (!RECORDING_STATUSES.includes(r.status)) {
    errors.push(`status must be one of ${RECORDING_STATUSES.join(', ')} (found ${shown(r.status)})`);
  }
  if (typeof r.idea !== 'string') errors.push('idea must be a string');

  if (!Array.isArray(r.beats)) {
    errors.push('beats must be an array of beats, each with its takes');
  } else {
    r.beats.forEach((beat, i) => {
      const name = isObject(beat) && isText(beat.id) ? `beat ${beat.id}` : `beat ${i + 1}`;
      if (!isObject(beat)) errors.push(`${name} must be an object`);
      else {
        if (!Array.isArray(beat.takes)) errors.push(`${name} needs its takes, as an array`);
        try { preparedAngleFields(beat.preparedAngles); } catch(error) { errors.push(`${name}: ${error.message}`); }
      }
    });
  }

  // Older recordings may predate pending-note persistence. New notes remain
  // proposals until the person answers Return; never add them to memory here.
  if (r.notes !== undefined) {
    if (!Array.isArray(r.notes) || r.notes.some(n => !isObject(n) || !isText(n.id) || !isText(n.text) ||
      (n.appliedFrom !== undefined && (typeof n.appliedFrom !== 'string' || n.appliedFrom.length>100)) ||
      (n.rawCorrection !== undefined && (typeof n.rawCorrection !== 'string' || n.rawCorrection.length > 4000)) ||
      (n.prefer != null && typeof n.prefer !== 'string') || (n.over != null && typeof n.over !== 'string') ||
      (n.status !== undefined && !['pending', 'kept', 'once'].includes(n.status)))) {
      errors.push('notes must contain an id, text and optional preference for each pending correction');
    } else if (new Set(r.notes.map(n => n.id)).size !== r.notes.length) errors.push('notes must have unique ids within a recording');
  }

  if (!Array.isArray(r.deliveryCues)) errors.push('deliveryCues must be an array');

  const video = videoProblem(r.video);
  if (video) errors.push(video);

  if (r.duration !== null && !isTime(r.duration)) errors.push(`duration must be null or a number of seconds (found ${shown(r.duration)})`);

  if (!Array.isArray(r.transcript)) {
    errors.push('transcript must be an array of words');
  } else {
    const at = r.transcript.findIndex((w) => !isObject(w) || typeof w.text !== 'string' || !isTime(w.start) || !isTime(w.end));
    if (at !== -1) errors.push(`transcript word ${at + 1} needs a text, a start and an end`);
  }

  if (!isObject(r.cuts) || !Array.isArray(r.cuts.cuts) || !Array.isArray(r.cuts.undoStack)) {
    errors.push('cuts must be a cut list: { cuts, undoStack }');
  }

  if (!Array.isArray(r.reviewMoments)) {
    errors.push('reviewMoments must be an array');
  } else {
    r.reviewMoments.forEach((moment, i) => {
      const name = isObject(moment) && isText(moment.id) ? `review moment ${moment.id}` : `review moment ${i + 1}`;
      if (!isObject(moment)) errors.push(`${name} must be an object`);
      else if (!MOMENT_DECISIONS.includes(moment.decision)) {
        errors.push(`${name} has a decision that is not null, "accepted" or "dismissed" (found ${shown(moment.decision)})`);
      }
    });
  }

  if (!Array.isArray(r.experiments)) errors.push('experiments must be an array');
  if (!isText(r.createdAt)) errors.push('createdAt must be a time, as a string');

  return { ok: errors.length === 0, errors };
}

/**
 * A new recording: a draft with nothing recorded yet. Start recording makes
 * one; the take fills the rest. Throws InvalidRecordingError, naming the first
 * problem, when what it is given cannot make a valid record.
 * @param {{ id: string, title?: string, idea?: string, beats?: RecordingBeat[], deliveryCues?: DeliveryCue[], now?: string }} input
 * @returns {Recording}
 */
export function createRecording({ id, title = '', idea = '', beats = [], deliveryCues = [], now } = /** @type {any} */ ({})) {
  const recording = {
    version: 1,
    id,
    title,
    status: 'draft',
    idea,
    beats: structuredClone(beats),
    deliveryCues: structuredClone(deliveryCues),
    video: null,
    duration: null,
    transcript: [],
    cuts: createCutList(),
    reviewMoments: [],
    experiments: [],
    createdAt: now || new Date().toISOString(),
  };
  const { ok, errors } = validateRecording(recording);
  if (!ok) throw namedError('InvalidRecordingError', `createRecording: ${errors[0]}`);
  return /** @type {Recording} */ (recording);
}

/**
 * A new record with the status changed. An unknown status throws
 * RecordingStatusError.
 * @param {Recording} recording
 * @param {RecordingStatus} status
 * @returns {Recording}
 */
export function setStatus(recording, status) {
  if (!RECORDING_STATUSES.includes(status)) {
    throw namedError('RecordingStatusError', `A recording is ${RECORDING_STATUSES.join(', ')} (got ${shown(status)})`);
  }
  return { ...structuredClone(recording), status };
}

/**
 * The beats a recording stores: one per episode beat, in order, each with
 * the episode beat as it is (id, takes, chosen take, tick) and the story
 * beat's label and talking points. An episode beat with no story beat keeps
 * its title as its label and has no points.
 * @param {StoryBeat[] | undefined} storyBeats
 * @param {Episode} episode
 * @returns {RecordingBeat[]}
 */
export function recordingBeats(storyBeats, episode) {
  if (!episode || !Array.isArray(episode.beats)) {
    throw new TypeError('recordingBeats needs an episode with its beats');
  }
  const story = Array.isArray(storyBeats) ? storyBeats : [];
  return episode.beats.map((beat, i) => {
    const storyBeat = story[i];
    return {
      ...structuredClone(beat),
      ...preparedAngleFields(storyBeat?.preparedAngles),
      label: storyBeat && isText(storyBeat.label) ? storyBeat.label : beat.title,
      points: storyBeat && Array.isArray(storyBeat.points) ? [...storyBeat.points] : [],
    };
  });
}
