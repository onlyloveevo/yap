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

// ---- A finished take, read for the Review screen ----
//
// Everything here is measured from the take itself: its length, what the cut removed and why, where
// the person started again, how fast they spoke, which beats they covered. No platform number is
// made up and no model is called. `answerFromFacts` answers a typed question from the same facts.

const CUT_NAMES = Object.freeze({ restart: ['retake', 'retakes'], exchange: ['talk with YAP', 'talks with YAP'], 'dead-air': ['pause', 'pauses'], filler: ['filler word', 'filler words'], trim: ['trim', 'trims'] });
const MOMENT_LIMIT = 6;
/** The width, in seconds, of the stretch a pace reading is taken over. */
const PACE_WINDOW = 4;

/** m:ss for a number of seconds. */
export function takeClock(seconds) {
  const s = Math.max(0, Math.floor((Number(seconds) || 0) + 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const secondsOf = (n) => { const r = Math.round(n * 10) / 10; return `${Number.isInteger(r) ? r : r.toFixed(1)} second${r === 1 ? '' : 's'}`; };
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const listOf = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The applied cuts of a recording, as ranges inside the take, in time order. */
function appliedCuts(recording) {
  const list = Array.isArray(recording?.cuts?.cuts) ? recording.cuts.cuts : [];
  return list
    .filter((c) => c && c.applied !== false && isFiniteNumber(c.start) && isFiniteNumber(c.end) && c.end > c.start)
    .map((c) => ({ kind: String(c.kind || 'trim'), start: c.start, end: c.end }))
    .sort((a, b) => a.start - b.start);
}

/** The stretches the cut keeps, given the removed ranges (which may touch or overlap). */
function keptRangesOf(cuts, duration) {
  const kept = [];
  let at = 0;
  for (const c of cuts) {
    if (c.start > at) kept.push([at, Math.min(c.start, duration)]);
    at = Math.max(at, c.end);
  }
  if (at < duration) kept.push([at, duration]);
  return kept.filter(([a, b]) => b - a > 0.05);
}

const wordsIn = (words, from, to) => words.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to);
const quoteOf = (words, max = 9) => {
  const text = words.slice(0, max).map((w) => w.text).join(' ').replace(/[.,;:!?]+$/, '');
  return text ? `“${text}${words.length > max ? '…' : ''}”` : '';
};

/** Each beat of a recording as Review reads it: its name, where it ran, its pace and whether it was covered. */
function beatsRead(recording, coverageMin) {
  const beats = Array.isArray(recording?.beats) ? recording.beats : [];
  return beats.map((b, index) => {
    const takes = Array.isArray(b?.takes) ? b.takes : [];
    const take = takes.find((t) => t.id === b.chosenTakeId) || takes[takes.length - 1] || null;
    const coverage = take?.summary?.coverage;
    return {
      index,
      id: b?.id || null,
      name: plain(b?.label) || plain(b?.title) || `Beat ${index + 1}`,
      where: whereOf(index, beats.length, plain(b?.label) || plain(b?.title)),
      start: take && isFiniteNumber(take.start) ? take.start : null,
      end: take && isFiniteNumber(take.end) ? take.end : null,
      pace: isFiniteNumber(take?.summary?.paceWpm) ? Math.round(take.summary.paceWpm) : null,
      covered: Boolean(b?.tick?.ticked) || (Boolean(take) && (!isFiniteNumber(coverage) || coverage >= coverageMin)),
    };
  });
}

/** Words a minute through the take, one reading a step, each over the PACE_WINDOW around it. */
function paceSeries(words, duration) {
  if (words.length < 4 || !(duration > 0)) return null;
  const step = Math.max(0.5, duration / 72);
  const points = [];
  for (let t = 0; t <= duration + 1e-6; t += step) {
    const from = Math.max(0, t - PACE_WINDOW / 2), to = Math.min(duration, t + PACE_WINDOW / 2);
    points.push([Math.min(t, duration), Math.round(wordsIn(words, from, to + 1e-6).length / ((to - from) / 60))]);
  }
  return points;
}

/**
 * What YAP knows about one finished take, laid out for the Review screen.
 * @param {object} recording  the saved recording
 * @param {{ previous?: object | null, threshold?: number, coverageMin?: number }} [options]  `previous`: the take this one followed
 */
export function takeReview(recording, { previous = null, threshold = PACE_DEFAULTS.threshold, coverageMin = EPISODE_DEFAULTS.coverageMin } = {}) {
  const duration = isFiniteNumber(recording?.duration) && recording.duration > 0 ? recording.duration : 0;
  const words = (Array.isArray(recording?.transcript) ? recording.transcript : []).filter((w) => w && typeof w.text === 'string' && w.text.trim() && isFiniteNumber(w.start) && isFiniteNumber(w.end));
  const heard = words.length > 0;
  const cuts = appliedCuts(recording);
  const keptRanges = keptRangesOf(cuts, duration);
  const kept = keptRanges.reduce((sum, [a, b]) => sum + (b - a), 0);
  const removed = Math.max(0, duration - kept);
  const beats = beatsRead(recording, coverageMin);
  const restarts = cuts.filter((c) => c.kind === 'restart');
  const pauses = cuts.filter((c) => c.kind === 'dead-air');
  const exchanges = cuts.filter((c) => c.kind === 'exchange');
  const missing = beats.filter((b) => !b.covered);
  const covered = beats.filter((b) => b.covered);
  const wpm = heard && duration > 0 ? Math.round(words.length / (duration / 60)) : null;
  const fast = heard ? beats.filter((b) => b.pace !== null && b.pace > threshold).sort((a, b) => b.pace - a.pace)[0] || null : null;
  const beatAt = (t) => beats.find((b) => b.start !== null && t >= b.start - 1e-6 && t < b.end) || null;
  const clean = keptRanges.map(([a, b]) => ({ start: a, end: b, length: b - a })).sort((a, b) => b.length - a.length)[0] || null;

  // Why the cut removed what it removed, by kind: "2 retakes (7.6 seconds)".
  const byKind = new Map();
  for (const c of cuts) {
    const k = byKind.get(c.kind) || { count: 0, seconds: 0 };
    byKind.set(c.kind, { count: k.count + 1, seconds: k.seconds + (c.end - c.start) });
  }
  const reasons = [...byKind].map(([kind, k]) => {
    const [one, many] = CUT_NAMES[kind] || CUT_NAMES.trim;
    return `${k.count} ${k.count === 1 ? one : many} (${secondsOf(k.seconds)})`;
  });
  const cutLine = cuts.length ? `YAP removed ${secondsOf(removed)}: ${listOf(reasons)}.` : 'YAP removed nothing from this take.';

  // ---- the numbers ----
  const before = previous && isFiniteNumber(previous.duration) ? previous : null;
  const beforeRestarts = before && Array.isArray(before.transcript) && before.transcript.length ? appliedCuts(before).filter((c) => c.kind === 'restart').length : null;
  const numbers = [
    { id: 'length', label: 'Length', value: takeClock(duration), note: before ? `Last take ${takeClock(before.duration)}` : heard ? `${words.length} words` : '' },
    { id: 'cut', label: 'After the cut', value: takeClock(kept), note: removed >= 0.5 ? `${Math.round(removed)} s removed` : 'Nothing removed' },
  ];
  if (heard) {
    numbers.push({ id: 'restarts', label: 'Restarts', value: String(restarts.length), note: beforeRestarts !== null ? `Last take ${beforeRestarts}` : restarts.length ? (restarts.length === 1 ? 'Cut out' : 'All cut out') : 'None' });
    numbers.push({ id: 'pace', label: 'Pace', value: String(wpm), unit: ' wpm', note: fast ? `${fast.index === 0 ? 'Opening' : 'Peak'} ${fast.pace}` : 'Steady' });
  }
  if (beats.length) numbers.push({ id: 'beats', label: 'Beats covered', value: `${covered.length} of ${beats.length}`, note: missing.length ? `${missing.length} not reached` : 'Every beat' });

  // ---- the key moments ----
  const found = [];
  const add = (rank, time, kind, label, text) => found.push({ rank, time: Math.min(Math.max(time, 0), duration), kind, label, text });
  if (heard) {
    const first = beats[0];
    const said = quoteOf(wordsIn(words, 0, Math.min(duration, 6)));
    add(0, 0, 'opening', 'Opening', first && first.pace !== null && first.pace > threshold
      ? `You opened at ${first.pace} words a minute. The whole take ran at ${wpm}, so the opening is where you rushed.`
      : `You opened with ${said}.`);
  }
  for (const c of restarts) {
    const said = quoteOf(wordsIn(words, c.start, c.end));
    add(1, c.start, 'restart', 'Retake', `At ${takeClock(c.start)} you ${said ? `said ${said} and ` : ''}started again. YAP cut that attempt, ${secondsOf(c.end - c.start)}, and kept the next one.`);
  }
  const lastOnly = missing.length === 1 && missing[0].index === beats.length - 1;
  if (missing.length) add(2, duration, 'uncovered', 'Not reached', lastOnly ? `The take stopped before '${missing[0].name}'. The video has no ending yet.` : `The take stopped before ${listOf(missing.map((b) => `'${b.name}'`))}.`);
  for (const c of exchanges) {
    const said = quoteOf(wordsIn(words, c.start, c.end), 12);
    add(3, c.start, 'exchange', 'Talk with YAP', `At ${takeClock(c.start)} you stopped to talk with YAP${said ? `: ${said}` : ''}. Those ${secondsOf(c.end - c.start)} are out of the cut.`);
  }
  if (heard && clean && clean.length >= 3 && cuts.length && clean.start >= 1) {
    add(4, clean.start, 'clean', 'Clean run', `From ${takeClock(clean.start)} you spoke for ${secondsOf(clean.length)} without a stop. It is your longest clean stretch: ${quoteOf(wordsIn(words, clean.start, clean.end))}.`);
  }
  for (const b of beats) {
    if (heard && b.index > 0 && b.pace !== null && b.pace > threshold && b.start !== null) add(5, b.start, 'pace', 'Fast', `You sped up during ${b.where}: ${b.pace} words a minute against ${wpm} for the whole take.`);
  }
  for (const c of pauses) add(6, c.start, 'pause', 'Pause', `A pause of ${secondsOf(c.end - c.start)} at ${takeClock(c.start)}. YAP removed it.`);
  if (!heard) for (const b of covered) if (b.start !== null) add(7, b.start, 'beat', b.name, `'${b.name}' ran from ${takeClock(b.start)} to ${takeClock(b.end)}.`);
  const moments = found.sort((a, b) => a.rank - b.rank).slice(0, MOMENT_LIMIT).sort((a, b) => a.time - b.time || a.rank - b.rank)
    .map(({ rank: _rank, ...m }) => ({ ...m, clock: takeClock(m.time) }));

  // ---- the one experiment, drawn from what cost this take the most ----
  let experiment = null;
  if (lastOnly) {
    const b = missing[0];
    experiment = { category: 'Story', text: `End on '${b.name}'. Say its one line before you stop.`, why: `This take stopped before '${b.name}', so the video has no ending yet.`, now: `Stops before '${b.name}'`, next: `Ends on '${b.name}'` };
  } else if (missing.length) {
    const b = missing[0], stayed = covered[covered.length - 1];
    experiment = { category: 'Story', text: `Move on to '${b.name}'${stayed ? ` as soon as '${stayed.name}' is said` : ''}. One line for each beat is enough.`, why: `This take reached ${covered.length} of its ${beats.length} beats${stayed ? ` and stayed on '${stayed.name}'` : ''}.`, now: `${covered.length} of ${beats.length} beats`, next: `All ${beats.length} beats` };
  } else if (restarts.length) {
    const counts = new Map();
    for (const c of restarts) { const b = beatAt(c.start); if (b) counts.set(b, (counts.get(b) || 0) + 1); }
    const worst = [...counts].sort((a, b) => b[1] - a[1])[0];
    const where = worst ? worst[0].where : 'the take';
    experiment = { category: 'Delivery', text: `Say the first line of ${where} out loud once before you press record.`, why: `You started again ${times(restarts.length)}. YAP cut ${secondsOf(restarts.reduce((s, c) => s + c.end - c.start, 0))} of first attempts.`, now: `${restarts.length} restart${restarts.length === 1 ? '' : 's'}`, next: 'One clean start' };
  } else if (fast) {
    experiment = { category: 'Delivery', text: `Slow ${fast.where} down. Take one breath after your first sentence.`, why: `${capital(fast.where)} ran at ${fast.pace} words a minute. The whole take ran at ${wpm}.`, now: `${fast.pace} wpm`, next: `Under ${threshold} wpm` };
  } else if (pauses.length >= 2) {
    experiment = { category: 'Delivery', text: 'Know your next line before you finish the one you are on.', why: `YAP removed ${pauses.length} pauses, ${secondsOf(pauses.reduce((s, c) => s + c.end - c.start, 0))} in all.`, now: `${pauses.length} long pauses`, next: 'No gaps' };
  } else if (heard) {
    experiment = { category: 'Delivery', text: `Keep these beats and say them in fewer words. Aim for ${takeClock(kept * 0.9)}.`, why: 'No restarts and every beat covered.', now: takeClock(kept), next: takeClock(kept * 0.9) };
  }

  // ---- the same facts, as sentences a typed question is answered from ----
  const facts = [
    { id: 'length', keys: ['long', 'length', 'duration', 'short', 'minutes', 'seconds'], text: `This take runs ${takeClock(duration)}. After the cut it is ${takeClock(kept)}.` },
    { id: 'cut', keys: ['cut', 'removed', 'remove', 'edit', 'trim', 'took out', 'kept', 'keep'], text: cutLine },
  ];
  if (heard) {
    facts.push({ id: 'restarts', keys: ['restart', 'retake', 'again', 'mistake', 'stumble', 'mess', 'flub'], text: restarts.length ? `You started again ${times(restarts.length)}, at ${listOf(restarts.map((c) => takeClock(c.start)))}. YAP kept the later attempt each time.` : 'You never started a line again in this take.' });
    facts.push({ id: 'pace', keys: ['pace', 'fast', 'slow', 'speed', 'rush', 'quick', 'wpm', 'words a minute', 'talk'], text: `You spoke at ${wpm} words a minute over the whole take.${fast ? ` ${capital(fast.where)} ran at ${fast.pace}, above the ${threshold} you set as your limit.` : ' No beat ran above your limit.'}` });
    facts.push({ id: 'said', keys: ['say', 'said', 'open', 'opening', 'hook', 'start', 'begin', 'first', 'intro'], text: `You opened with ${quoteOf(wordsIn(words, 0, Math.min(duration, 6)), 14)}.` });
    if (clean && clean.length >= 3) facts.push({ id: 'best', keys: ['best', 'strongest', 'worked', 'clean'], text: `Your longest clean stretch starts at ${takeClock(clean.start)}: ${secondsOf(clean.length)} without a stop.` });
  }
  if (beats.length) facts.push({ id: 'beats', keys: ['beat', 'cover', 'miss', 'skip', 'structure', 'point', 'ending', 'finish', 'end', ...beats.map((b) => b.name.toLowerCase())], text: `You covered ${listOf(covered.map((b) => `'${b.name}'`)) || 'no beat'}${missing.length ? `. You did not reach ${listOf(missing.map((b) => `'${b.name}'`))}` : ', every beat you planned'}.` });
  if (pauses.length) facts.push({ id: 'pauses', keys: ['pause', 'silence', 'gap', 'quiet', 'dead'], text: `YAP removed ${pauses.length} long pause${pauses.length === 1 ? '' : 's'}, ${secondsOf(pauses.reduce((s, c) => s + c.end - c.start, 0))} in all.` });
  if (experiment) facts.push({ id: 'next', keys: ['next', 'try', 'improve', 'better', 'change', 'fix', 'should', 'advice', 'experiment', 'work on'], text: `${experiment.why} Next take: ${experiment.text}` });

  const summary = `${cutLine}${experiment ? ` ${experiment.why}` : ''}`;
  const notes = [
    ...numbers.map((n) => ({ time: 0, text: `Measured by YAP. ${n.label}: ${n.value}${n.unit || ''}${n.note ? ` (${n.note})` : ''}.` })),
    { time: 0, text: `Measured by YAP. ${cutLine}` },
    ...moments.map((m) => ({ time: Math.round(m.time * 100) / 100, text: `${m.label}. ${m.text}` })),
    ...(experiment ? [{ time: 0, text: `YAP's experiment for the next take: ${experiment.text} ${experiment.why}` }] : []),
  ].map((n) => ({ time: n.time, text: n.text.slice(0, 280) }));
  return {
    title: plain(recording?.title) || 'Your take',
    duration, kept, removed, heard,
    numbers, moments, experiment, facts, summary,
    pace: heard ? { points: paceSeries(words, duration), limit: threshold, overall: wpm } : null,
    removedRanges: cuts.map((c) => ({ start: c.start, end: c.end, kind: c.kind })),
    evidence: { transcript: words.map((w) => w.text).join(' '), notes },
  };
}

/**
 * Answer a typed question from the facts of a review, with no model: the facts whose subject the
 * question names, the moment at a time it names, or the summary when it names neither.
 * @param {{ facts: { id: string, keys: string[], text: string }[], moments?: { time: number, text: string }[], summary?: string, experiment?: { text: string } | null }} review
 * @param {string} question
 * @returns {string}
 */
export function answerFromFacts(review, question) {
  const q = ` ${plain(question).toLowerCase().replace(/[^a-z0-9:%' ]+/g, ' ')} `;
  const out = [];
  const at = /(\d{1,2}):(\d{2})/.exec(q);
  const moments = Array.isArray(review?.moments) ? review.moments : [];
  if (at && moments.length) {
    const t = Number(at[1]) * 60 + Number(at[2]);
    out.push([...moments].sort((a, b) => Math.abs(a.time - t) - Math.abs(b.time - t))[0].text);
  }
  const scored = (review?.facts || [])
    .map((f, order) => ({ f, order, score: f.keys.filter((k) => new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es|ed|ing)?[^a-z0-9]`).test(q)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  for (const { f } of scored.slice(0, at ? 1 : 2)) if (!out.includes(f.text)) out.push(f.text);
  if (!out.length) {
    if (review?.summary) out.push(review.summary);
    if (review?.experiment?.text) out.push(`Next take: ${review.experiment.text}`);
  }
  return out.join(' ');
}
