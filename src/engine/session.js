// The whole loop, browser-safe (Plan 01-07): one take runs live (transcript,
// Hey YAP, instant swap, lit talking point, one cue at a time, the optional
// Realtime reply), then its rough cut and its beats are worked out from the
// take's own audio and words.
//
// Phase 1.1 joins its additions here, beside Phase 1 and on Phase 1's own
// beats, takes and cut list (D-37, Plan 01.1-12). The take runs the delivery
// stream and the trial proposal when the caller passes them. The rough cut
// also holds the take's dead air, in the same list with the same undo (D-47).
// The beat boundaries are marked, and the take's review moments are built
// from what the engine already holds (D-52): no score, grade or colour (D-54).
//
// The two-take loop carries the additions from take 1 to take 2 when the
// caller passes them (D-95): a `setup` turns on the delivery cues, the review
// moments with the replay's stated answers and the opening questions; a
// `trials` store turns on the trial lines and the greeting; a `recordings`
// store gets one Recording per take. With none of the three the loop runs and
// prints exactly as Phase 1's did.
//
// Imports only relative engine files: the debug page loads this module in
// Chrome as it is, and the replay command loads it in Node. No disk, no
// network of its own; the Realtime upgrade runs only through a hook the
// caller passes in, and the stores are passed in too.

import { createLiveTake } from './loop.js';
import { createReplaySource } from './replay.js';
import { createManualClock } from './clock.js';
import { findSilences } from './silences.js';
import { detectRestarts } from './restarts.js';
import { protectWordEdges, createCutList, addExchangeCut, addRestartCuts, addDeadAirCuts, keptRanges, listCuts, COPY as CUT_COPY } from './cutlist.js';
import { deadAirCuts } from './dead-air.js';
import { beatMarks } from './beat-marks.js';
import { reviewMoments, decideMoment } from './review.js';
import { chooseDeliveryCues, DELIVERY_CUES, DELIVERY_DEFAULTS } from './delivery.js';
import { carryForward, openingQuestions, answerOpening, carriedCues } from './carry.js';
import { countRecording, checkInQuestions, statusLine } from './experiments.js';
import { createRecording, recordingBeats, setStatus, isRecordingId } from './recording.js';
import { addTake, chooseTake, tickBeat, createEpisode, goToBeat, progress } from './episode.js';
import { pointCoverage } from './coverage.js';
import { segmentPace } from './pace.js';
import { emptyMemory, returnQuestions, applyReturn, firstCue } from './memory.js';
import { makeBet, checkBet, logLine } from './prediction.js';
import { COPY as SWAP_COPY } from './swap.js';

/**
 * The replay's own answers at Return. They are printed as "(replay answer)",
 * so a scripted choice never reads as the person's.
 */
export const REPLAY_ANSWERS = Object.freeze({ notes: 'keep', pace: 'keep' });

/**
 * The replay's own answers about Phase 1.1's additions, printed as
 * "(replay answer)" too: a delivery moment is added as a cue, a story moment
 * is dismissed, and an opening question is answered keep. A trial's check-in
 * has no replay answer: it is printed and left for the person.
 */
export const REPLAY_MOMENT_ANSWERS = Object.freeze({ delivery: 'accepted', story: 'dismissed', opening: 'keep' });

/** Every line the sample loop prints. About the take and YAP's bet, never a grade of the person. */
export const COPY = Object.freeze({
  header: 'Replaying the {label} take: "{idea}" ({source})',
  labelled: 'labelled sample',
  unlabelled: 'recorded',
  take: 'Take {n} ({takeId}, {seconds} s)',
  point: 'Point lit at {at} s: {title}',
  exchange: 'Hey YAP at {start} s: "{remark}"',
  swap: 'Swap: {from} -> {to} in {latency} s ({verdict})',
  underOne: 'under 1 s',
  overOne: 'over 1 s',
  preparedReply: `${SWAP_COPY.preparedReplyLabel}: {reply}`,
  fullerReply: "YAP's reply (on screen, fuller): {reply}",
  cue: 'Cue at {at} s: {text}',
  roughCut: 'Rough cut, take {n} (YAP proposes, you decide):',
  cutLine: '  - {start} to {end} s: {reason} ({certainty}, {state}) | {undo}',
  sure: 'sure',
  amber: 'amber',
  applied: 'applied',
  notApplied: 'not applied',
  kept: '  Kept {kept} s of {duration} s; the original recording is unchanged.',
  beats: 'Beats after take {n}:',
  beatLine: '  {title}: {reason}',
  progress: 'Progress: {items}',
  returnHead: 'Return (after take 1):',
  noteQuestion: '  "{text}" {ask} -> {answer} (replay answer)',
  paceQuestion: '  {ask} -> {answer} (replay answer)',
  keptNote: 'Kept note: {note}',
  noKeptNote: 'Kept note: none',
  firstCue: 'First cue: {text}',
  noFirstCue: 'First cue: none',
  noAnswer: '(no answer)',
  none: '  none',
  // Phase 1.1: what the person chose, accepted or tried, one line per step (D-95).
  openingHead: 'Opening questions (before take {n}):',
  openingLine: '  {ask} -> {answer} (replay answer)',
  checkIn: 'Check-in before take {n}: {ask} (left for you to answer)',
  deliveryHead: 'Delivery cues, take {n} (one shows at a time):',
  deliveryLine: '  {title}: {cue}',
  deliveryKept: '{text} (kept from last time)',
  noCue: 'none',
  noBeat: 'No beat',
  deliveryNow: 'Delivery cue at {at} s: {text} ({why})',
  deliveryOff: 'Delivery cue at {at} s: none',
  chosenFor: 'chosen for {title}',
  paceOver: 'your pace went over your level',
  greeting: 'Greeting: {text}',
  proposal: 'YAP proposes: {ask} ("{to}" instead of "{from}") in {latency} s ({verdict})',
  saidYes: 'You said yes. On screen: {line}',
  keptOld: 'You kept the old wording. Nothing is saved.',
  withdrawn: 'YAP took back the trial it proposed.',
  trial: 'Trial "{to}" instead of "{from}": {status}',
  beatMarks: 'Beat marks, take {n}: {marks}',
  beatMark: '{title} {start} to {end} s',
  momentsHead: 'Review moments, take {n} (YAP points, you decide):',
  momentLine: '  - {time} s, {type}: {observation} | suggested cue: {cue} -> {answer} (replay answer)',
  momentAccepted: 'added as a cue',
  momentDismissed: 'dismissed',
  momentOpen: 'left for you',
});

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Fill {name} slots literally (a function replacer, so `$` in a text is kept as typed). */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (slot, name) => (name in values ? String(values[name]) : slot));
}

const sec = (t) => (Number.isFinite(t) ? t.toFixed(2) : '?');

/**
 * @typedef {import('./replay.js').Word} Word
 * @typedef {{ samples: Float32Array, sampleRate: number }} Pcm
 * @typedef {{ pointId: string, at: number }} PointLit
 * @typedef {{ at: number, brief: any }} BriefAt
 *
 * @typedef {object} LiveResult
 * @property {string} takeId
 * @property {any[]} exchanges
 * @property {any[]} swaps
 * @property {any[]} notes
 * @property {{ exchangeId: string, text: string, source: string, at: number }[]} replies
 * @property {{ kind: string, text: string, from: number, to: number }[]} cues
 * @property {PointLit[]} pointTimeline
 * @property {any} briefBefore
 * @property {any} briefAfter
 * @property {BriefAt[]} briefTimeline
 * @property {string | null} greeting           the greeting the take ended on; null when experiments were not passed
 * @property {import('./loop.js').TakeProposal[]} proposals   each trial YAP proposed, with its status now
 * @property {import('./experiments.js').Experiment[]} experiments  the trials the person accepted in this take (never saved here)
 * @property {import('./loop.js').Heard[]} heard  each exchange that changed nothing
 * @property {{ cues: import('./delivery.js').DeliveryCue[], spans: import('./delivery.js').DeliverySpan[] }} delivery
 *   the delivery cues the person chose for this take, and which cue showed from when to when
 *
 * @typedef {object} BeatResult
 * @property {string} beatId
 * @property {string} pointId
 * @property {string} title
 * @property {number} start
 * @property {number} end
 * @property {import('./episode.js').TakeSummary} summary
 * @property {import('./episode.js').Tick} tick   the beat's tick after this take was added
 *
 * @typedef {LiveResult & {
 *   cutList: import('./cutlist.js').CutList,
 *   repeats: any[], reported: any[], restartCount: number,
 *   beats: BeatResult[], episode: import('./episode.js').Episode, duration: number,
 *   beatMarks: import('./beat-marks.js').BeatMark[],
 *   moments: import('./review.js').Moment[] }} TakeResult
 */

/**
 * Run one take live: the word-timed transcript replays on the take clock into
 * the live take with the point follower, pace cue, memory cue and (only when
 * given) the Realtime hook. Resolves once the end event has been handled and
 * every fuller-reply request has finished.
 *
 * `delivery` and `experiments` are passed to the take as they are, and both
 * are off unless given: a take given neither runs exactly as Phase 1's did.
 *
 * @param {object} args
 * @param {string} args.takeId
 * @param {any} args.brief                       the brief as the take starts
 * @param {Word[]} args.words                    the take's word-timed transcript
 * @param {import('./clock.js').Clock} args.clock  manual for tests and --fast, real otherwise
 * @param {any} [args.memory]                    the person's memory (pace cue on/off, threshold)
 * @param {{ kind: 'memory', text: string } | null} [args.firstCue]
 * @param {{ exchange?: object, follow?: object, cues?: object, speed?: number }} [args.settings]
 * @param {import('./loop.js').RealtimeHook | null} [args.realtime]
 * @param {import('./loop.js').DeliveryOption | null} [args.delivery]  the person's delivery cues and the beat of each point (DELIV-01)
 * @param {import('./loop.js').ExperimentsOption | null} [args.experiments]  the trials accepted before, and a model to ask (EXP-01)
 * @param {(event: import('./loop.js').TakeEvent) => void} [args.onEvent]
 * @returns {Promise<LiveResult>}
 */
export function runTake({
  takeId,
  brief,
  words,
  clock,
  memory = null,
  firstCue = null,
  settings = {},
  realtime = null,
  delivery = null,
  experiments = null,
  onEvent = () => {},
}) {
  if (!Array.isArray(words)) return Promise.reject(new TypeError('runTake needs the take\'s words'));
  const s = settings || {};
  // At another speed the clock is scaled, so every time in the take (points,
  // cues, pace, beats) stays in the transcript's own seconds.
  const takeClock = scaledClock(clock, Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 1);
  /** @type {BriefAt[]} */
  const briefTimeline = [{ at: takeClock.now(), brief }];

  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof createLiveTake>} */
    let take;
    let finished = false;
    const fail = (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    };
    take = createLiveTake({
      brief,
      clock: takeClock,
      settings: s.exchange || {},
      follow: s.follow || true,
      pace: { memory },
      firstCue,
      cueSettings: s.cues || {},
      realtime,
      delivery,
      experiments,
      onEvent(event) {
        if (event.type === 'swap' && take) briefTimeline.push({ at: event.swap.at, brief: take.state().brief });
        onEvent(event);
      },
    });
    const source = createReplaySource(words, { clock: takeClock });
    source.start((event) => {
      if (finished) return;
      try {
        take.push(event);
      } catch (err) {
        source.stop();
        fail(err);
        return;
      }
      if (event.type !== 'end') return;
      source.stop();
      take.settled().then(() => {
        if (finished) return;
        finished = true;
        const st = take.state();
        resolve({
          takeId,
          exchanges: st.exchanges,
          swaps: st.swaps,
          notes: st.notes,
          replies: st.replies,
          cues: st.cues,
          pointTimeline: st.pointTimeline.map(({ pointId, at }) => ({ pointId, at })),
          briefBefore: brief,
          briefAfter: st.brief,
          briefTimeline,
          greeting: st.greeting,
          proposals: st.proposals,
          experiments: st.experiments,
          heard: st.heard,
          // The delivery stream's own place, never mixed into the story lists above (D-38).
          delivery: {
            cues: delivery && Array.isArray(delivery.cues) ? delivery.cues.map((c) => ({ ...c })) : [],
            spans: st.delivery.spans,
          },
        });
      }, fail);
    });
    if (clock.isManual && typeof clock.runUntilIdle === 'function') clock.runUntilIdle();
  });
}

/**
 * After the take: find its silences and restarts, build its rough cut (the
 * talk with YAP from its live timestamps, the detector's restart proposals),
 * split it into beats at the lit talking points, and add one take per beat to
 * the episode (auto-tick by the episode's rule).
 *
 * Phase 1.1 (D-37, D-47, D-52): once the talk with YAP and the restarts are on
 * the list, the take's dead air is proposed and added to that same list, so
 * there is one rough cut and one undo. The beat boundaries are marked. The
 * review moments are built from the beat results, each beat's talking point,
 * the cut list, the delivery cues the person chose and their pace level: only
 * data the engine already holds, and never a score, a grade or a colour (D-54).
 *
 * @param {object} args
 * @param {LiveResult} args.live
 * @param {Pcm} args.pcm                       the take's mono audio (int16-scale floats)
 * @param {Word[]} args.words                  the take's words (all of them)
 * @param {import('./episode.js').Episode} args.episode
 * @param {{ episode?: object, restarts?: object, silences?: object, deadAir?: import('./dead-air.js').DeadAirSettings,
 *   transcribeWindow?: (s: number, e: number) => string[] }} [args.settings]
 * @param {any} [args.memory]                  the person's memory: their pace level for the review moments (Phase 1's default without it)
 * @returns {TakeResult}
 */
export function finishTake({ live, pcm, words, episode, settings = {}, memory = null }) {
  const s = settings || {};
  const { silences, duration } = findSilences(pcm.samples, pcm.sampleRate, s.silences || {});
  const detected = detectRestarts({ silences, duration, words, transcribeWindow: s.transcribeWindow, settings: s.restarts || {} });
  // Words said to YAP are not a false start: the spoken answer to a proposal sits
  // between two pauses, and the talk with YAP it belongs to is already cut whole.
  const restarts = detected.cuts.filter((p) => !saidToYap(p, live.exchanges));

  let cutList = createCutList();
  for (const exchange of live.exchanges) cutList = addExchangeCut(cutList, exchange, words);
  cutList = addRestartCuts(cutList, restarts);
  // YAP's bet counts every restart the detector proposes, sure and amber alike (Q11).
  const restartCount = restarts.length;
  // Dead air joins the same list after the cuts above, so a pause they already take out is not proposed twice (D-47).
  cutList = addDeadAirCuts(cutList, deadAirCuts({ silences, duration, words, cuts: cutList.cuts, settings: s.deadAir }));

  cutList = protectWordEdges(cutList, words);
  const applied = cutList.cuts.filter((c) => c.applied);
  const kept = keptRanges(cutList, duration);
  const spans = beatSpans(episode.beats, live.pointTimeline, duration);

  let ep = episode;
  /** @type {Omit<BeatResult, 'tick'>[]} */
  const partial = [];
  /** @type {Record<string, string>} each beat's talking point as it stood when the beat ended */
  const pointTexts = {};
  episode.beats.forEach((beat, k) => {
    const captured = beat.takes.filter(t => t.recordingId === live.takeId);
    const ranges = captured.length ? captured : episode.captureSpans ? [] : [{start:spans[k][0],end:spans[k][1]}];
    if(captured.length){
      const older=beat.takes.filter(t=>t.recordingId!==live.takeId);
      ep={...ep,beats:ep.beats.map(b=>b.id===beat.id?{...b,takes:older,chosenTakeId:older.some(t=>t.id===b.chosenTakeId)?b.chosenTakeId:null,tick:{ticked:false,by:null,reason:null}}:b)};
    }
    for(const range of ranges){
      const start=Math.max(0,Math.min(duration,range.start)),end=Math.max(start,Math.min(duration,range.end));
      const beatWords=words.filter(w=>{
        const mid=(w.start+w.end)/2;
        return mid>=start && (end===duration?mid<=end:mid<end) && !applied.some(c=>mid>=c.start&&mid<=c.end);
      });
      const uncutRestarts=cutList.cuts.filter(c=>c.kind==='restart'&&!c.applied&&Math.min(c.end,end)-Math.max(c.start,start)>0).length;
      const angle=activeAngle(briefAt(live,end),beat.pointId);
      const keptInBeat=kept.map(([a,b])=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>b>a);
      const summary={uncutRestarts,coverage:pointCoverage(angle?angle.text:'',beatWords),paceWpm:segmentPace(words,keptInBeat)};
      ep=addTake(ep,beat.id,{recordingId:live.takeId,start,end,summary},s.episode);
    }
    // Only explicit completion is a person override. Navigation is not an untick vote.
    if(captured.length && beat.tick.by==='person' && beat.tick.ticked){
      const chosen=ep.beats.find(b=>b.id===beat.id).takes.find(t=>t.id===beat.chosenTakeId);
      if(chosen)ep=chooseTake(ep,beat.id,chosen.id,s.episode);
      ep=tickBeat(ep,beat.id,true);
    }
    const analysed=ep.beats.find(b=>b.id===beat.id);
    if(!ranges.length){
      partial.push({beatId:beat.id,pointId:beat.pointId,title:beat.title,start:spans[k][0],end:spans[k][0],summary:{uncutRestarts:0,coverage:0,paceWpm:null}});
      return;
    }
    const chosen=analysed.takes.find(t=>t.id===analysed.chosenTakeId) || analysed.takes.at(-1);
    const angle=activeAngle(briefAt(live,chosen.end),beat.pointId);
    if(angle&&typeof angle.text==='string')pointTexts[beat.id]=angle.text;
    partial.push({beatId:beat.id,pointId:beat.pointId,title:beat.title,start:chosen.start,end:chosen.end,summary:chosen.summary});
  });
  const beats = partial.map((b) => ({ ...b, tick: { ...ep.beats.find((x) => x.id === b.beatId).tick } }));

  // Moments worth a second look, from what the take already holds (D-52, D-53). YAP points; the person decides.
  const level = memory && memory.settings && Number.isFinite(memory.settings.paceThreshold) ? memory.settings.paceThreshold : undefined;
  const moments = reviewMoments({
    beats,
    pointTexts,
    cuts: cutList.cuts,
    delivery: { cues: live.delivery && Array.isArray(live.delivery.cues) ? live.delivery.cues : [] },
    threshold: level,
    coverageMin: s.episode && Number.isFinite(s.episode.coverageMin) ? s.episode.coverageMin : undefined,
  });

  return {
    ...live,
    cutList,
    repeats: detected.repeats,
    reported: detected.reported,
    restartCount,
    beats,
    episode: ep,
    duration,
    beatMarks: beatMarks(ep, live.takeId),
    moments,
  };
}

/**
 * Was this restart proposal read from words said to YAP? Its fragment (the
 * words it takes for a false start) then lies inside a talk with YAP.
 * @param {{ start: number, end: number, fragment?: { start: number, end: number } }} proposal
 * @param {{ start: number, end: number }[]} exchanges
 */
function saidToYap(proposal, exchanges) {
  const piece = proposal.fragment || proposal;
  const mid = (piece.start + piece.end) / 2;
  return (exchanges || []).some((x) => mid >= x.start && mid <= x.end);
}

/** A view of `clock` that runs `speed` times faster, in take seconds. */
function scaledClock(clock, speed) {
  if (speed === 1) return clock;
  return {
    isManual: clock.isManual,
    now: () => clock.now() * speed,
    setTimeout: (fn, seconds) => clock.setTimeout(fn, seconds / speed),
    clearTimeout: (handle) => clock.clearTimeout(handle),
    runUntilIdle: () => clock.runUntilIdle && clock.runUntilIdle(),
  };
}

/**
 * Beat k runs from the first time its point was lit to the next beat's start;
 * the first beat starts at 0 and the last ends at the end of the take. A point
 * that was never lit gets an empty span where the next lit point begins.
 * @returns {[number, number][]}
 */
function beatSpans(beats, pointTimeline, duration) {
  const firstLit = new Map();
  for (const p of pointTimeline || []) if (!firstLit.has(p.pointId)) firstLit.set(p.pointId, p.at);
  const starts = beats.map((b, k) => (k === 0 ? 0 : firstLit.get(b.pointId)));
  let next = duration;
  for (let k = starts.length - 1; k >= 0; k -= 1) {
    const v = starts[k];
    starts[k] = Number.isFinite(v) ? Math.min(Math.max(0, v), next) : next;
    next = starts[k];
  }
  return starts.map((start, k) => [start, k + 1 < starts.length ? starts[k + 1] : duration]);
}

/** The brief as it stood at time `t` of the take. */
function briefAt(live, t) {
  const timeline = live.briefTimeline && live.briefTimeline.length ? live.briefTimeline : [{ at: 0, brief: live.briefAfter }];
  let current = timeline[0].brief;
  for (const entry of timeline) if (entry.at <= t) current = entry.brief;
  return current;
}

function activeAngle(brief, pointId) {
  const point = brief && Array.isArray(brief.points) ? brief.points.find((p) => p.id === pointId) : null;
  if (!point || !Array.isArray(point.angles)) return null;
  return point.angles.find((a) => a.id === point.active) || point.angles[0] || null;
}

/**
 * The delivery cues of a recording (D-44): the cues a sample's setup chose,
 * then the delivery cues the person kept from last time (D-56).
 *
 * `setup.deliveryCues` lists 1 to 3 cues, each `{ kind, text?, beat? }`: `beat`
 * is the beat's number from 1 (`beatId` names it by id instead), and a cue with
 * neither is dealt to the free beats in order. A setup with no `deliveryCues`
 * chooses none. The setup's cues keep their beats. A kept cue is then added on
 * its own beat, unless its kind is already chosen, its beat already has a cue
 * (one cue shows at a time), its beat is not in this recording, or three cues
 * are chosen. `kept` names the kinds that were added this way.
 *
 * Throws SetupError for a setup that is not an object, a `deliveryCues` that
 * is not a list, or a `beat` that is not a beat of this recording, and the
 * errors of `chooseDeliveryCues` for an unknown kind, a kind chosen twice, a
 * beat named twice, or a count outside 1 to 3.
 *
 * @param {{ deliveryCues?: { kind: string, text?: string, beat?: number, beatId?: string }[] } | null | undefined} setup
 * @param {{ id: string, title?: string }[]} beats   the beats of the recording, in order
 * @param {import('./carry.js').CarriedCue[]} [kept]  `carriedCues(memory, beats)`; the story cues among them are passed over
 * @returns {{ cues: import('./delivery.js').DeliveryCue[], kept: string[] } | null}  null when no cue is chosen
 */
export function deliveryFromSetup(setup, beats, kept = []) {
  const list = Array.isArray(beats) ? beats : [];
  /** @type {import('./delivery.js').DeliveryCue[]} */
  let cues = [];
  if (setup !== null && setup !== undefined) {
    if (typeof setup !== 'object' || Array.isArray(setup)) throw namedError('SetupError', 'the setup must be an object');
    const raw = setup.deliveryCues;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw)) {
        throw namedError('SetupError', 'deliveryCues must be a list of 1 to 3 cues, each { kind, text, beat }');
      }
      const picks = raw.map((pick) => {
        const p = pick && typeof pick === 'object' ? pick : {};
        /** @type {{ kind: any, text?: string, beatId?: string }} */
        const out = { kind: p.kind };
        if (typeof p.text === 'string') out.text = p.text;
        if (p.beat !== undefined && p.beat !== null) {
          const beat = Number.isInteger(p.beat) ? list[p.beat - 1] : undefined;
          if (!beat) {
            throw namedError(
              'SetupError',
              `delivery cue "${String(p.kind)}" names beat ${JSON.stringify(p.beat)}; this recording has beats 1 to ${list.length}`,
            );
          }
          out.beatId = beat.id;
        } else if (typeof p.beatId === 'string') {
          out.beatId = p.beatId;
        }
        return out;
      });
      cues = chooseDeliveryCues(/** @type {any} */ (picks), list).cues;
    }
  }

  /** @type {string[]} */
  const keptKinds = [];
  for (const cue of Array.isArray(kept) ? kept : []) {
    if (!cue || cue.stream !== 'delivery') continue;
    if (cues.length >= DELIVERY_DEFAULTS.max) break;
    if (!DELIVERY_CUES.some((c) => c.kind === cue.kind)) continue;
    if (cues.some((c) => c.kind === cue.kind)) continue;
    const beatId = typeof cue.beatId === 'string' && list.some((b) => b.id === cue.beatId) ? cue.beatId : null;
    if (beatId === null || cues.some((c) => c.beatId === beatId)) continue;
    const picks = [...cues.map((c) => ({ kind: c.kind, text: c.text, beatId: c.beatId })), { kind: cue.kind, text: cue.text, beatId }];
    cues = chooseDeliveryCues(/** @type {any} */ (picks), list).cues;
    keptKinds.push(cue.kind);
  }
  return cues.length === 0 ? null : { cues, kept: keptKinds };
}

/**
 * The first cue of a take: Phase 1's, built from the newest kept note, unless
 * the person answered that note's opening question "Not this time" (D-57).
 * The note itself stays in memory.
 */
function openingCue(memory) {
  const notes = memory && Array.isArray(memory.notes) ? memory.notes : [];
  const newest = notes[notes.length - 1];
  const dismissed = memory && Array.isArray(memory.dismissed) ? memory.dismissed : [];
  // The key carry.js gives a kept note's opening question: note|<id>|<keptAt>.
  if (newest && dismissed.includes(['note', String(newest.id), String(newest.keptAt)].join('|'))) return null;
  return firstCue(memory);
}

/**
 * The whole loop on two takes: take 1 live, its rough cut and beats, Return
 * (the stated answers), YAP's bet, take 2 from the brief as it stood after
 * take 1 with the kept note as its first cue, the bet checked against take
 * 2's detector count, take 2's beats added to the same episode. Each line is
 * passed to onLine as it happens and collected in report.lines.
 *
 * Phase 1.1's additions are each optional, and with none of them the loop
 * prints exactly Phase 1's lines (D-37):
 *
 *   setup       the sample's setup (`{ deliveryCues }`, see deliveryFromSetup).
 *               Each take then opens with its opening questions (D-56) and its
 *               delivery cue per beat (D-44), prints the delivery cue now
 *               showing (D-45), and ends with its beat marks and its review
 *               moments, each with the replay's stated answer (D-52). The
 *               answers are carried into memory (`carried`, `dismissed`), so a
 *               cue accepted in take 1 is asked about before take 2 and a
 *               dismissed one is not (D-57). A setup the loop cannot use throws
 *               before a line is printed.
 *   trials      a trial store (`list()`, `save(experiment)`). Each take then
 *               knows the trials accepted before it, prints the greeting and
 *               YAP's proposal with its delay, and a trial is saved only after
 *               the person's yes (D-60). Each finished take counts once for
 *               every trial in use and prints "video k of n" (D-62). A trial
 *               that has run its length prints its check-in before the next
 *               take; the replay leaves it unanswered.
 *   recordings  a recording store (`save(recording)`): one Recording per take,
 *               status 'ready' (D-71).
 *
 * @param {object} args
 * @param {any} args.brief
 * @param {{ takeId: string, label?: string | null, source?: string | null, words: Word[], pcm: Pcm }} args.take1
 * @param {{ takeId: string, label?: string | null, source?: string | null, words: Word[], pcm: Pcm }} args.take2
 * @param {any} [args.memory]                   memory before take 1 (default: empty)
 * @param {any[]} [args.log]                    the prediction log so far
 * @param {() => import('./clock.js').Clock} [args.makeClock]  one fresh clock per take (default manual)
 * @param {{ notes?: string | Record<string, string>, pace?: string }} [args.answers]  Return answers (default REPLAY_ANSWERS)
 * @param {object} [args.settings]              passed to runTake and finishTake; settings.memory and settings.prediction too
 * @param {import('./loop.js').RealtimeHook | null} [args.realtime]
 * @param {{ deliveryCues?: { kind: string, text?: string, beat?: number, beatId?: string }[] } | null} [args.setup]
 *   the sample's setup; turns on delivery cues, review moments and opening questions
 * @param {{ list(): import('./experiments.js').Experiment[], save(e: import('./experiments.js').Experiment): any } | null} [args.trials]
 * @param {{ save(recording: import('./recording.js').Recording): any } | null} [args.recordings]
 * @param {{ delivery?: string, story?: string, opening?: string }} [args.momentAnswers]
 *   the stated answers about review moments and opening questions (default REPLAY_MOMENT_ANSWERS)
 * @param {(line: string) => void} [args.onLine]
 * @param {(event: import('./loop.js').TakeEvent, takeId: string) => void} [args.onEvent]
 * @param {(memory: any) => void} [args.onMemory]  called with memory after Return; with a setup, also each time a moment or an opening answer changes it
 * @param {(entry: any) => void} [args.onLog]      called with each prediction-log line
 * @param {() => string} [args.now]               ISO time for log lines, kept notes, saved trials and recordings
 */
export async function runSampleLoop({
  brief,
  take1,
  take2,
  memory = emptyMemory(),
  log = [],
  makeClock = () => createManualClock(),
  answers = REPLAY_ANSWERS,
  settings = {},
  realtime = null,
  setup = null,
  trials = null,
  recordings = null,
  momentAnswers = REPLAY_MOMENT_ANSWERS,
  onLine = () => {},
  onEvent = () => {},
  onMemory = () => {},
  onLog = () => {},
  now = () => new Date().toISOString(),
}) {
  const s = settings || {};
  const additions = setup !== null && setup !== undefined;
  const stated = momentAnswers || REPLAY_MOMENT_ANSWERS;
  /** @type {string[]} */
  const lines = [];
  const say = (line) => {
    lines.push(line);
    onLine(line);
  };
  const logEntries = [];
  const record = (entry) => {
    logEntries.push(entry);
    onLog(entry);
  };
  /** @type {{ key: string, ask: string, answer: string | null, beforeTake: number }[]} */
  const opening = [];
  /** @type {import('./recording.js').Recording[]} */
  const saved = [];

  let episode = createEpisode(brief);
  // A setup the loop cannot use is refused here, before a line is printed or a take is played.
  if (additions) deliveryFromSetup(setup, episode.beats);

  say(fill(COPY.header, {
    label: take1.label === 'sample' ? COPY.labelled : COPY.unlabelled,
    idea: brief.idea || '',
    source: take1.source || take1.takeId,
  }));

  // Take 1, live.
  const memoryBefore = openTake(1, memory || emptyMemory());
  const delivery1 = additions ? chooseDelivery(1, memoryBefore) : null;
  const r1 = await playTake({ n: 1, take: take1, brief, memory: memoryBefore, firstCue: openingCue(memoryBefore), episode, delivery: delivery1 });
  episode = moveToNextUnticked(r1.episode);
  reportCut(1, r1);
  reportBeats(1, r1);
  say(progressLine(episode, progress(episode)));
  const close1 = closeTake(1, take1, r1, memoryBefore, delivery1);

  // Return: the replay's stated answers, labelled as such.
  const pendingNotes = r1.notes.filter((n) => !n.status || n.status === 'pending');
  const questions = returnQuestions(pendingNotes, { settings: s.memory });
  const given = answersFor(answers, pendingNotes);
  say(COPY.returnHead);
  for (const q of questions) {
    if (q.kind === 'note') {
      const answer = q.options.find((o) => o.value === given.notes[q.noteId]);
      say(fill(COPY.noteQuestion, { text: q.text, ask: q.ask, answer: answer ? answer.label : COPY.noAnswer }));
    } else {
      const answer = q.options.find((o) => o.value === given.pace);
      say(fill(COPY.paceQuestion, { ask: q.ask, answer: answer ? answer.label : COPY.noAnswer }));
    }
  }
  const memoryAfter = applyReturn(close1.memory, given, { pendingNotes, now: now(), settings: s.memory });
  onMemory(memoryAfter);
  if (memoryAfter.notes.length === 0) say(COPY.noKeptNote);
  for (const note of memoryAfter.notes) {
    say(fill(COPY.keptNote, { note: note.prefer && note.over ? `${note.prefer} over ${note.over}` : note.text }));
  }

  // YAP's bet before take 2, from take 1's real count.
  const bet = makeBet(log, { forTake: 'take 2', previousActual: r1.restartCount, settings: s.prediction });
  if (bet) {
    say(bet.text);
    record(logLine(bet, null, now()));
  }
  // What take 1 left for take 2: the opening questions, then the first cue the answers leave standing.
  const memoryOpen = openTake(2, memoryAfter);
  const cue = openingCue(memoryOpen);
  say(cue ? fill(COPY.firstCue, { text: cue.text }) : COPY.noFirstCue);
  const delivery2 = additions ? chooseDelivery(2, memoryOpen) : null;

  // Take 2, from the brief as it stood after take 1.
  const r2 = await playTake({ n: 2, take: take2, brief: r1.briefAfter, memory: memoryOpen, firstCue: cue, episode, delivery: delivery2 });
  episode = moveToNextUnticked(r2.episode);
  reportCut(2, r2);
  const result = bet ? checkBet(bet, r2.restartCount) : null;
  if (result) {
    say(result.text);
    record(logLine(bet, result, now()));
  }
  reportBeats(2, r2);
  const prog = progress(episode);
  say(progressLine(episode, prog));
  const close2 = closeTake(2, take2, r2, memoryOpen, delivery2);

  return {
    take1: r1,
    ret: { questions, answers: given, memory: memoryAfter },
    bet,
    take2: r2,
    result,
    episode,
    progress: prog,
    logEntries,
    lines,
    // Phase 1.1: the memory as the loop left it, each take's moments with their decisions,
    // the opening questions that were asked, and the trials as the store now holds them.
    memory: close2.memory,
    moments: { take1: close1.moments, take2: close2.moments },
    opening,
    experiments: trials ? trials.list() : [],
    ...(recordings ? { recordings: saved } : {}),
  };

  /**
   * Before a take: the opening questions about what was kept last time, each
   * with the stated answer (D-56), then the check-in of every trial that has
   * run its length, which the replay leaves for the person (D-62).
   */
  function openTake(n, mem) {
    let out = mem;
    if (additions) {
      const asked = openingQuestions(out);
      say(fill(COPY.openingHead, { n }));
      if (asked.length === 0) say(COPY.none);
      /** @type {Record<string, 'keep' | 'drop'>} */
      const picked = {};
      for (const q of asked) {
        const option = q.options.find((o) => o.value === stated.opening);
        say(fill(COPY.openingLine, { ask: q.ask, answer: option ? option.label : COPY.noAnswer }));
        if (option) picked[q.key] = option.value;
        opening.push({ key: q.key, ask: q.ask, answer: option ? option.value : null, beforeTake: n });
      }
      if (Object.keys(picked).length > 0) {
        out = answerOpening(out, picked);
        onMemory(out);
      }
    }
    if (trials) {
      for (const q of checkInQuestions(trials.list())) say(fill(COPY.checkIn, { n, ask: q.ask }));
    }
    return out;
  }

  /** The delivery cue of each beat for the coming take: the setup's, then the cues kept from last time. */
  function chooseDelivery(n, mem) {
    const chosen = deliveryFromSetup(setup, episode.beats, carriedCues(mem, episode.beats));
    const cues = chosen ? chosen.cues : [];
    const name = (c) => (c ? (chosen.kept.includes(c.kind) ? fill(COPY.deliveryKept, { text: c.text }) : c.text) : COPY.noCue);
    say(fill(COPY.deliveryHead, { n }));
    for (const beat of episode.beats) {
      say(fill(COPY.deliveryLine, { title: beat.title || beat.id, cue: name(cues.find((c) => c.beatId === beat.id)) }));
    }
    for (const c of cues.filter((x) => x.beatId === null)) say(fill(COPY.deliveryLine, { title: COPY.noBeat, cue: name(c) }));
    return chosen ? { cues: chosen.cues, beatIds: episode.beats.map((b) => b.id) } : null;
  }

  /**
   * After a take's rough cut, beats and progress: its beat marks, the count of
   * each trial in use, its review moments with the stated answers carried into
   * memory, and its Recording.
   */
  function closeTake(n, take, r, mem, delivery) {
    const recordingId = isRecordingId(take.takeId) ? take.takeId : `take${n}`;
    let out = mem;
    let moments = r.moments;
    /** @type {{ id: string, line: string }[]} the trials that ran in this recording */
    const ran = [];

    if (additions) {
      const marks = r.beatMarks.map((m) => fill(COPY.beatMark, { title: m.title, start: sec(m.start), end: sec(m.end) }));
      say(fill(COPY.beatMarks, { n, marks: marks.join(', ') }));
    }
    if (trials) {
      for (const trial of trials.list()) {
        const next = countRecording(trial, recordingId);
        if (next.recordings.length === trial.recordings.length) continue;
        trials.save(next);
        const status = statusLine(next);
        ran.push({ id: next.id, line: status });
        say(fill(COPY.trial, { to: next.change.to, from: next.change.from, status }));
      }
    }
    if (additions) {
      moments = r.moments.map((m) => {
        const decision = stated[m.type];
        return decision === 'accepted' || decision === 'dismissed' ? decideMoment(m, decision) : m;
      });
      say(fill(COPY.momentsHead, { n }));
      if (moments.length === 0) say(COPY.none);
      for (const m of moments) {
        say(fill(COPY.momentLine, {
          time: sec(m.time),
          type: m.type,
          observation: m.observation,
          cue: m.suggestedCue ? m.suggestedCue.text : COPY.noCue,
          answer: m.decision === 'accepted' ? COPY.momentAccepted : m.decision === 'dismissed' ? COPY.momentDismissed : COPY.momentOpen,
        }));
      }
      out = carryForward(out, { moments });
      onMemory(out);
    }
    if (recordings) {
      const storyBeats = r.episode.beats.map((beat) => {
        const angle = activeAngle(r.briefAfter, beat.pointId);
        return { id: beat.id, label: beat.title || beat.id, points: angle && typeof angle.text === 'string' ? [angle.text] : [] };
      });
      const draft = createRecording({
        id: recordingId,
        title: brief.idea || '',
        idea: brief.idea || '',
        beats: recordingBeats(storyBeats, r.episode),
        deliveryCues: delivery ? delivery.cues : [],
        now: now(),
      });
      const done = setStatus({
        ...draft,
        duration: r.duration,
        transcript: take.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
        cuts: r.cutList,
        reviewMoments: moments,
        experiments: ran,
      }, 'ready');
      recordings.save(done);
      saved.push(done);
    }
    return { memory: out, moments };
  }

  async function playTake({ n, take, brief: startBrief, memory: mem, firstCue: first, episode: ep, delivery = null }) {
    const seconds = take.pcm && take.pcm.sampleRate ? take.pcm.samples.length / take.pcm.sampleRate : NaN;
    say(fill(COPY.take, { n, takeId: take.takeId, seconds: sec(seconds) }));
    const titles = new Map(startBrief.points.map((p) => [p.id, p.title || p.id]));
    const beatTitles = new Map(ep.beats.map((b) => [b.id, b.title || b.id]));
    const prepared = new Map();
    const live = await runTake({
      takeId: take.takeId,
      brief: startBrief,
      words: take.words,
      clock: makeClock(),
      memory: mem,
      firstCue: first,
      settings: s,
      realtime,
      delivery,
      // The trials accepted before this take: each take reads them fresh, so a yes in take 1 is there in take 2 (D-62).
      experiments: trials ? { accepted: trials.list() } : null,
      onEvent(event) {
        onEvent(event, take.takeId);
        if (event.type === 'point') {
          say(fill(COPY.point, { at: sec(event.at), title: titles.get(event.pointId) || event.pointId }));
        } else if (event.type === 'exchange-close') {
          say(fill(COPY.exchange, { start: sec(event.exchange.start), remark: event.exchange.remark }));
        } else if (event.type === 'swap') {
          const sw = event.swap;
          say(fill(COPY.swap, {
            from: sw.from.label,
            to: sw.to.label,
            latency: sec(sw.latencySec),
            verdict: sw.latencySec < 1 ? COPY.underOne : COPY.overOne,
          }));
          prepared.set(sw.exchangeId, sw.reply.text);
        } else if (event.type === 'note') {
          say(event.note.text);
          if (prepared.has(event.note.exchangeId)) {
            say(fill(COPY.preparedReply, { reply: prepared.get(event.note.exchangeId) }));
            prepared.delete(event.note.exchangeId);
          }
        } else if (event.type === 'cue' && event.cue) {
          say(fill(COPY.cue, { at: sec(event.at), text: event.cue.text }));
        } else if (event.type === 'reply') {
          say(fill(COPY.fullerReply, { reply: event.reply.text }));
        } else if (event.type === 'reply-status' && event.status !== 'replied') {
          say(event.message);
        } else if (event.type === 'delivery') {
          // The delivery stream's own line, never one of the story cue lines (D-38).
          if (!event.cue) {
            say(fill(COPY.deliveryOff, { at: sec(event.at) }));
          } else {
            const why = event.reason === 'pace'
              ? COPY.paceOver
              : fill(COPY.chosenFor, { title: beatTitles.get(event.beatId) || event.beatId || COPY.noBeat });
            say(fill(COPY.deliveryNow, { at: sec(event.at), text: event.cue.text, why }));
          }
        } else if (event.type === 'greeting') {
          say(fill(COPY.greeting, { text: event.text }));
        } else if (event.type === 'experiment-proposed') {
          const p = event.proposal;
          say(fill(COPY.proposal, {
            ask: p.ask,
            to: p.to,
            from: p.from,
            latency: sec(event.latencySec),
            verdict: event.latencySec < 1 ? COPY.underOne : COPY.overOne,
          }));
        } else if (event.type === 'experiment-answered') {
          if (event.answer === 'accepted' && event.experiment) {
            // The yes is the first moment a trial may be saved (D-60); the take itself saves nothing.
            if (trials) trials.save({ ...event.experiment, acceptedAt: now() });
            say(fill(COPY.saidYes, { line: event.line || '' }));
          } else {
            say(COPY.keptOld);
          }
        } else if (event.type === 'experiment-withdrawn') {
          say(COPY.withdrawn);
        }
      },
    });
    return finishTake({ live, pcm: take.pcm, words: take.words, episode: ep, settings: s, memory: mem });
  }

  function reportCut(n, r) {
    say(fill(COPY.roughCut, { n }));
    for (const c of listCuts(r.cutList)) {
      say(fill(COPY.cutLine, {
        start: sec(c.start),
        end: sec(c.end),
        reason: c.reason,
        certainty: c.certainty === 'sure' ? COPY.sure : COPY.amber,
        state: c.applied ? COPY.applied : COPY.notApplied,
        undo: CUT_COPY.undo,
      }));
    }
    const kept = keptRanges(r.cutList, r.duration).reduce((sum, [a, b]) => sum + (b - a), 0);
    say(fill(COPY.kept, { kept: sec(kept), duration: sec(r.duration) }));
  }

  function reportBeats(n, r) {
    say(fill(COPY.beats, { n }));
    for (const b of r.beats) say(fill(COPY.beatLine, { title: b.title, reason: b.tick.reason || '' }));
  }
}

/** Return answers keyed by note id: one answer string applies to every pending note. */
function answersFor(answers, pendingNotes) {
  const a = answers || {};
  const notes = {};
  for (const n of pendingNotes) {
    const v = typeof a.notes === 'string' ? a.notes : a.notes && a.notes[n.id];
    if (v === 'keep' || v === 'once') notes[n.id] = v;
  }
  const out = { notes };
  if (a.pace === 'keep' || a.pace === 'off') out.pace = a.pace;
  return out;
}

/** After a take, the current beat is the first beat still to tick (it stays put when all are ticked). */
function moveToNextUnticked(ep) {
  const next = ep.beats.find((b) => !b.tick.ticked);
  return next ? goToBeat(ep, next.id) : ep;
}

/** A ticked beat reads "done" even when it is the beat the person is on. */
function progressLine(ep, prog) {
  const items = prog.map((p) => {
    const beat = ep.beats.find((b) => b.id === p.beatId);
    return `${p.title} ${beat && beat.tick.ticked ? 'done' : p.state}`;
  });
  return fill(COPY.progress, { items: items.join(', ') });
}
