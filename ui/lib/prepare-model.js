import { preparedAngleFields } from '../../src/engine/prepared-angles.js';
// What the prepare stand-in shows for an idea, and the Recording it asks for,
// as pure functions (D-122 to D-127). No page, no server and no model:
// ui/prepare/wire.js does the asking.
//
// The stand-in shows a beat as a label and a few talking points, the shape the
// engine's story beats have (SETUP-01). A beat the person kept on the beat list
// is { id, title, line }: its title is the label and its line is its one
// talking point, cut to the engine's own limit for a point, because a talking
// point is a memory trigger and never a sentence to read out.
//
// A Recording's beats and delivery cues are made by the engine's own
// functions (createEpisode, recordingBeats, chooseDeliveryCues): there is no
// second model of a beat or a cue here.
import { chooseDeliveryCues } from '../../src/engine/delivery.js';
import { createEpisode } from '../../src/engine/episode.js';
import { recordingBeats } from '../../src/engine/recording.js';
import { BEAT_LIMITS, beatsToPoints, defaultBeats, limitBeats } from '../../src/engine/setup-beats.js';

/** The id of the bundled sample idea, the gallery's first card. */
const SAMPLE_ID = 'sample';

/**
 * The bundled sample take, as sample/brief.json and sample/setup.json have it:
 * its idea, its three points each with the angle it opens on, and its delivery
 * cues by beat number. It is a different video than the sample idea (D-124),
 * and nothing of the sample is changed here. A page cannot read those files
 * without asking the server, so they are written out, and
 * test/prepare-model.test.js holds this to the two files.
 */
const SAMPLE_TAKE = Object.freeze({
  idea: 'How I plan a video in twenty minutes',
  points: Object.freeze([
    Object.freeze({ id: 'p1', title: 'Hook', text: 'Three planning habits that save me hours' }),
    Object.freeze({ id: 'p2', title: 'What I do', text: 'Write the hook before anything else' }),
    Object.freeze({ id: 'p3', title: 'Takeaway', text: 'Keep one take and fix it later' }),
  ]),
  deliveryCues: Object.freeze([Object.freeze({ kind: 'slow-down', beat: 1 }), Object.freeze({ kind: 'land-the-point', beat: 3 })]),
});

/** How many rows the stand-in's Recent list draws. */
const RECENT_ROWS = 2;
/** The longest title made from a person's typed words, in characters. */
const TITLE_CHARS = 80;
const NO_TITLE = 'Untitled recording';
const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

/**
 * The words on the button that plays the bundled sample take (D-123). The
 * sample take is about another video than the sample idea (D-124), and the
 * button says so in full.
 */
export const SAMPLE_TAKE_LABEL = 'Try the sample take (a different video: How I plan a video in twenty minutes)';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A beat as the stand-in shows it. */
const shown = (beat) => ({ label: beat.label, points: [...beat.points] });

/**
 * One kept line as talking points: none for an empty line, else the one point,
 * cut by the engine's own rule (limitBeats: whole words from the front, at
 * most BEAT_LIMITS.pointWords, with the punctuation that ends a sentence off).
 * @param {unknown} line
 * @returns {string[]}
 */
function pointsOf(line) {
  if (!text(line)) return [];
  const cut = limitBeats([{ label: 'beat', points: [text(line)] }]).beats.find((beat) => beat.source === 'model');
  return cut ? [...cut.points] : [];
}

/**
 * What the stand-in shows for an idea (D-122): its title, and its kept beats
 * in the kept order as talking points. With no kept beat, the engine's default
 * beats. `showSampleButton` is true only for the bundled sample idea, by its
 * id (D-123, D-140).
 * @param {{ id?: string, title?: string, keptBeats?: { id: string, title: string, line: string }[] } | null} [idea]
 * @returns {{ ideaId: string | null, title: string, beats: { label: string, points: string[] }[], showSampleButton: boolean }}
 */
export function prepareView(idea) {
  const known = idea !== null && typeof idea === 'object' ? idea : {};
  const kept = (Array.isArray(known.keptBeats) ? known.keptBeats : [])
    .filter((beat) => beat !== null && typeof beat === 'object')
    .map((beat) => ({ label: text(beat.title) || text(beat.id), points: pointsOf(beat.line), ...preparedAngleFields(beat.preparedAngles) }))
    .filter((beat) => beat.label);
  return {
    ideaId: typeof known.id === 'string' && known.id ? known.id : null,
    title: text(known.title),
    beats: kept.length > 0 ? kept : defaultBeats().map(shown),
    showSampleButton: known.id === SAMPLE_ID,
  };
}

/** The sample take's beats and cues, built by the engine as its replay builds them. */
function sampleTake() {
  const episode = createEpisode({ points: SAMPLE_TAKE.points.map((point) => ({ id: point.id, title: point.title })) });
  const story = SAMPLE_TAKE.points.map((point, i) => ({ id: episode.beats[i].id, label: point.title, points: [point.text] }));
  const picks = SAMPLE_TAKE.deliveryCues.map((cue) => ({ kind: cue.kind, beatId: episode.beats[cue.beat - 1].id }));
  return { beats: recordingBeats(story, episode), deliveryCues: chooseDeliveryCues(/** @type {any} */ (picks), episode.beats).cues };
}

/**
 * The body of POST /api/app/recordings for a take started on the stand-in
 * (D-127): `{ ideaId, title, idea, beats, deliveryCues, sample }`.
 *
 * An own take: the title and the beats the stand-in shows, each beat as the
 * engine keeps one (with no take yet), and the pressed cues through
 * chooseDeliveryCues, dealt to the beats in order. With no cue pressed the take
 * has no delivery cue. More than three cues, an unknown one or the same one
 * twice is the engine's own refusal, thrown as it throws it. A view with no
 * title (a take started at /prepare/new) takes its title from the first line
 * of the person's words, `view.idea`.
 *
 * The sample take (`sample: true`): the bundled sample's own title, beats and
 * cues, whatever the stand-in shows and whatever chips are pressed (D-124).
 *
 * @param {{ ideaId?: string | null, title?: string, idea?: string, beats?: { label: string, points: string[] }[] } | null} view
 *   what prepareView gave, or the same shape for a take with no idea
 * @param {string[] | null} [pressedCues] the kinds of the pressed chips, in the chips' order
 * @param {{ sample?: boolean }} [options]
 */
export function recordingRequest(view, pressedCues, { sample = false } = {}) {
  const known = view !== null && typeof view === 'object' ? view : {};
  const ideaId = typeof known.ideaId === 'string' && known.ideaId ? known.ideaId : null;
  if (sample) {
    return { ideaId, title: SAMPLE_TAKE.idea, idea: SAMPLE_TAKE.idea, ...sampleTake(), sample: true };
  }
  const shownBeats = (Array.isArray(known.beats) ? known.beats : []).filter((beat) => beat !== null && typeof beat === 'object' && text(beat.label));
  const story = (shownBeats.length > 0 ? shownBeats : defaultBeats()).map((beat, i) => ({
    id: `s${i + 1}`,
    ...preparedAngleFields(beat.preparedAngles),
    label: text(beat.label),
    points: (Array.isArray(beat.points) ? beat.points : []).filter((point) => typeof point === 'string'),
  }));
  const episode = createEpisode({ points: beatsToPoints(story) });
  const kinds = Array.isArray(pressedCues) ? pressedCues : [];
  const words = text(known.idea).slice(0, BEAT_LIMITS.textChars).trim();
  const title = text(known.title) || words.split('\n')[0].trim().slice(0, TITLE_CHARS).trim();
  return {
    ideaId,
    title,
    idea: words || title,
    beats: recordingBeats(story, episode),
    // No cue pressed: no delivery cue. The engine's choice is asked only for a choice the person made.
    deliveryCues: kinds.length > 0 ? chooseDeliveryCues(/** @type {any} */ (kinds.map((kind) => ({ kind }))), episode.beats).cues : [],
    sample: false,
  };
}

/** The day a recording was made, as the Recent list says it: Today, Yesterday, a weekday within the week, else a date. */
function dayOf(createdAt, now) {
  const made = new Date(typeof createdAt === 'string' ? createdAt : NaN);
  if (Number.isNaN(made.getTime())) return '';
  const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(made)) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return WEEKDAYS[made.getDay()];
  return `${made.getDate()} ${MONTHS[made.getMonth()]}`;
}

/**
 * The rows of the stand-in's Recent list for the saved recordings: the newest
 * first, at most the two rows the shell draws, and none when nothing is saved.
 * A row is `{ title, length, date }`, the three parts the shell draws. A draft
 * has no length yet, so `length` is empty.
 * @param {{ title?: string, createdAt?: string }[]} list the store's list, newest first
 * @param {Date} [now]
 * @returns {{ title: string, length: string, date: string }[]}
 */
export function recentRows(list, now = new Date()) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((each) => each !== null && typeof each === 'object')
    .slice(0, RECENT_ROWS)
    .map((each) => ({ title: text(each.title) || NO_TITLE, length: '', date: dayOf(each.createdAt, now) }));
}
