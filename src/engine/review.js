// Review moments (REVIEW-01 as docs/PRD-engine-additions.md defines it; D-52
// to D-55). After a take, YAP points at the moments worth a second look. Each
// moment has a time, a type (story or delivery), one observation and an
// optional suggested cue; the person adds it as a cue or dismisses it.
//
// Moments are built only from data the engine already has (D-53): each beat's
// coverage and pace from the take's beat results, the talking point of each
// beat, the restart cuts of the cut list, the delivery cues the person chose
// and their pace level. No model is called and no audio is read.
//
// YAP never scores, grades or colour-codes the person (D-54). An observation
// is a sentence about what happened in the take. Nothing YAP measured is
// written into a moment: no pace figure, no coverage figure, no count.
//
// Pure and browser-safe: imports nothing from `node:`, never mutates its
// inputs, and every function returns new objects.
import { PACE_DEFAULTS } from './pace.js';
import { EPISODE_DEFAULTS } from './episode.js';
import { DELIVERY_CUES } from './delivery.js';

/**
 * @typedef {{ uncutRestarts?: number, coverage?: number, paceWpm?: number | null }} BeatSummary
 * @typedef {{ beatId?: string, id?: string, pointId?: string, title?: string, start?: number, end?: number, summary?: BeatSummary | null }} BeatResult
 *   one beat of a finished take, as `finishTake` of session.js gives it
 * @typedef {{ id?: string, kind: string, start: number, end: number }} Cut
 * @typedef {{ stream: 'story' | 'delivery', kind: string, text: string }} SuggestedCue
 * @typedef {'accepted' | 'dismissed'} Decision
 * @typedef {object} Moment
 * @property {string} id                       'm1', 'm2', ... in time order
 * @property {number} time                     seconds of take time
 * @property {'story' | 'delivery'} type
 * @property {'uncovered' | 'pace' | 'restart'} source
 * @property {string | null} beatId
 * @property {number | null} beatIndex
 * @property {string} where                    "the opening", "the ending" or the beat's label in quotes
 * @property {string} observation              one sentence about the take
 * @property {SuggestedCue | null} suggestedCue
 * @property {Decision | null} decision        null until the person decides
 */

/** Every word the person sees from this module. Sentences about the take, with no number in them (D-54). */
export const COPY = Object.freeze({
  neverGotTo: "You never got to '{point}'",
  spedUp: 'You sped up during {where}',
  startedAgain: 'You started again during {where}',
  opening: 'the opening',
  ending: 'the ending',
  named: "'{title}'",
  take: 'the take',
});

const DECISIONS = Object.freeze(['accepted', 'dismissed']);
/** The order moments of one beat at one time come in: the sources as D-53 lists them. */
const SOURCE_ORDER = Object.freeze({ uncovered: 0, pace: 1, restart: 2 });

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Fill {name} slots literally (a function replacer, so `$` in a talking point is kept as written). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

/** A string as plain text on one line; anything else is empty. */
function plain(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** @param {Moment} m @returns {Moment} */
function copyMoment(m) {
  return { ...m, suggestedCue: m.suggestedCue ? { ...m.suggestedCue } : null };
}

/**
 * Where in the take a beat sits, in words: the first beat is the opening, the
 * last is the ending, any other is named by its label.
 * @param {number} index  the beat's place, from 0
 * @param {number} total  how many beats the take has
 * @param {string} [title]  the beat's label
 * @returns {string}
 */
export function whereOf(index, total, title) {
  if (index === 0) return COPY.opening;
  if (Number.isInteger(total) && total > 1 && index === total - 1) return COPY.ending;
  const label = plain(title);
  return label ? fill(COPY.named, { title: label }) : COPY.take;
}

function beatsOf(beats) {
  return (Array.isArray(beats) ? beats : [])
    .filter((b) => b && typeof b === 'object')
    .map((b, index) => {
      const summary = b.summary && typeof b.summary === 'object' ? b.summary : {};
      return {
        index,
        beatId: typeof b.beatId === 'string' ? b.beatId : typeof b.id === 'string' ? b.id : null,
        pointId: typeof b.pointId === 'string' ? b.pointId : null,
        title: plain(b.title),
        start: isFiniteNumber(b.start) ? b.start : null,
        end: isFiniteNumber(b.end) ? b.end : null,
        coverage: isFiniteNumber(summary.coverage) ? summary.coverage : null,
        paceWpm: isFiniteNumber(summary.paceWpm) ? summary.paceWpm : null,
      };
    });
}

/** The talking point of a beat: by point id, by beat id, or by position; else the beat's label. */
function pointTextOf(pointTexts, beat) {
  let text = '';
  if (Array.isArray(pointTexts)) {
    text = plain(pointTexts[beat.index]);
  } else if (pointTexts && typeof pointTexts === 'object') {
    const own = (key) => (key !== null && Object.prototype.hasOwnProperty.call(pointTexts, key) ? plain(pointTexts[key]) : '');
    text = own(beat.pointId) || own(beat.beatId);
  }
  return text || beat.title;
}

/** A beat the take reached has a span with some time in it. */
function reached(beat) {
  return beat.start !== null && beat.end !== null && beat.end > beat.start;
}

/** The beat a time falls in; else the last beat begun by then; else the first beat. */
function beatAt(beats, time) {
  const within = beats.find((b, k) => reached(b) && time >= b.start && (k === beats.length - 1 ? time <= b.end : time < b.end));
  if (within) return within;
  const begun = beats.filter((b) => b.start !== null && b.start <= time);
  return begun[begun.length - 1] || beats[0] || null;
}

/** The chosen delivery cue of a kind, or null. */
function chosenCue(delivery, kind) {
  const cues = delivery && Array.isArray(delivery.cues) ? delivery.cues : [];
  return cues.find((c) => c && c.kind === kind) || null;
}

/** The wording of a delivery cue: the person's when they chose it, else the cue's own. */
function wordingOf(delivery, kind) {
  const chosen = chosenCue(delivery, kind);
  const own = DELIVERY_CUES.find((c) => c.kind === kind);
  return (chosen && plain(chosen.text)) || (own ? own.text : '');
}

/**
 * The review moments of one finished take, in time order (D-52, D-53):
 * - a talking point never covered (coverage under `coverageMin`): a story
 *   moment that suggests the talking point as a story cue. Its time is the
 *   start of its beat, or the end of the take when the beat was never reached;
 * - pace over the person's level in a beat, when Slow down is among the cues
 *   they chose: a delivery moment that suggests Slow down in their wording;
 * - each restart cut: a delivery moment at the cut's start that suggests Pause.
 *
 * @param {object} [take]
 * @param {BeatResult[]} [take.beats]         the take's beat results, in order
 * @param {{ [id: string]: string } | string[]} [take.pointTexts]  each beat's talking point: keyed by point id or beat id, or listed in beat order
 * @param {Cut[] | { cuts: Cut[] }} [take.cuts]  the cuts of the cut list (or the cut list)
 * @param {{ cues: { kind: string, text: string }[] }} [take.delivery]  the delivery cues the person chose
 * @param {number} [take.threshold]           the person's pace level, words a minute (Phase 1's default when left out)
 * @param {number} [take.coverageMin]         the episode's coverage level (its default when left out)
 * @returns {Moment[]}
 */
export function reviewMoments(take) {
  const t = take && typeof take === 'object' ? take : {};
  const beats = beatsOf(t.beats);
  const threshold = isFiniteNumber(t.threshold) ? t.threshold : PACE_DEFAULTS.threshold;
  const coverageMin = isFiniteNumber(t.coverageMin) ? t.coverageMin : EPISODE_DEFAULTS.coverageMin;
  const cuts = Array.isArray(t.cuts) ? t.cuts : t.cuts && Array.isArray(t.cuts.cuts) ? t.cuts.cuts : [];
  const takeEnd = beats.reduce((max, b) => Math.max(max, b.end !== null ? b.end : 0, b.start !== null ? b.start : 0), 0);
  const slowDown = chosenCue(t.delivery, 'slow-down');

  /** @type {Omit<Moment, 'id'>[]} */
  const found = [];
  const add = (source, type, time, beat, observation, suggestedCue) => {
    found.push({
      time,
      type,
      source,
      beatId: beat ? beat.beatId : null,
      beatIndex: beat ? beat.index : null,
      where: beat ? whereOf(beat.index, beats.length, beat.title) : COPY.take,
      observation,
      suggestedCue,
      decision: null,
    });
  };

  for (const beat of beats) {
    if (beat.coverage !== null && beat.coverage < coverageMin) {
      const point = pointTextOf(t.pointTexts, beat);
      if (point) {
        add('uncovered', 'story', reached(beat) ? beat.start : takeEnd, beat, fill(COPY.neverGotTo, { point }), {
          stream: 'story',
          kind: 'talking-point',
          text: point,
        });
      }
    }
    if (slowDown && beat.paceWpm !== null && beat.paceWpm > threshold) {
      const where = whereOf(beat.index, beats.length, beat.title);
      add('pace', 'delivery', beat.start !== null ? beat.start : 0, beat, fill(COPY.spedUp, { where }), {
        stream: 'delivery',
        kind: 'slow-down',
        text: wordingOf(t.delivery, 'slow-down'),
      });
    }
  }

  for (const cut of cuts) {
    if (!cut || cut.kind !== 'restart' || !isFiniteNumber(cut.start)) continue;
    const beat = beatAt(beats, cut.start);
    const where = beat ? whereOf(beat.index, beats.length, beat.title) : COPY.take;
    add('restart', 'delivery', cut.start, beat, fill(COPY.startedAgain, { where }), {
      stream: 'delivery',
      kind: 'pause',
      text: wordingOf(t.delivery, 'pause'),
    });
  }

  const order = (m) => [m.time, m.beatIndex === null ? Infinity : m.beatIndex, SOURCE_ORDER[m.source]];
  return found
    .map((m, i) => ({ m, i, key: order(m) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.i - b.i)
    .map(({ m }, i) => ({ id: `m${i + 1}`, ...m }));
}

function checkDecision(decision) {
  if (!DECISIONS.includes(decision)) {
    throw namedError('UnknownDecisionError', `a moment is ${DECISIONS.join(' or ')} (got "${String(decision)}")`);
  }
}

/**
 * Record the person's choice about a moment (D-52): add it as a cue
 * ('accepted') or dismiss it ('dismissed'). Returns a new list; the list given
 * is left as it was.
 *
 * `decideMoment(moment, decision)` decides one moment given on its own and
 * returns the new moment.
 *
 * Throws UnknownMomentError when no moment has that id, UnknownDecisionError
 * for any other decision.
 *
 * @param {Moment[] | Moment} moments
 * @param {string} id
 * @param {Decision} [decision]
 * @returns {Moment[] | Moment}
 */
export function decideMoment(moments, id, decision) {
  if (!Array.isArray(moments)) {
    if (!moments || typeof moments !== 'object') throw namedError('UnknownMomentError', 'decideMoment: no moment was given');
    checkDecision(id);
    return { ...copyMoment(moments), decision: /** @type {Decision} */ (id) };
  }
  if (!moments.some((m) => m && m.id === id)) {
    throw namedError('UnknownMomentError', `no moment with id "${String(id)}" in this review`);
  }
  checkDecision(decision);
  return moments.map((m) => (m.id === id ? { ...copyMoment(m), decision } : copyMoment(m)));
}
