// The live take: source events in; exchange, swap, note, word, point, cue and
// reply events out. Everything on the live path is local (D-11): no fetch, no
// WebSocket, no model. The one exception is opt-in: when the caller passes a
// `realtime` hook (a getSecret and a connect it built), each swap also asks
// for a fuller reply through it (LIVE-05, D-12); without it nothing here can
// reach the network.
//
// Optional hooks (Plan 01-07), each off unless asked for:
//   follow    the current talking point (D-07): fed only words outside a talk
//             with YAP, re-pointed at the swapped brief after every swap
//   pace      the pace cue (LIVE-06) over words outside a talk with YAP,
//             offered to and withdrawn from the one-cue controller; off when
//             memory says the person turned it off
//   firstCue  take 2's memory cue (MEM-02), offered at the start of the take
//   realtime  the fuller reply upgrade (LIVE-05)
// Without hooks the take behaves exactly as the tracer form did.
//
// Two ways to hear "Hey YAP" (Phase 1.1, WAKE-02):
//   the word path     timed final words (the sample replay) and the held key,
//                     through the detector in hey-yap.js; an exchange closes
//                     on the silence timer and the angle is chosen then.
//   the results path  Chrome's results, early and final, through the tracker
//                     in wake-tracker.js. The take is on this path from its
//                     first `session` or `results` event: word events no
//                     longer open a wake exchange (the key still does), the
//                     angle is chosen when the remark has settled, and the
//                     final words a talk with YAP owns are not counted.
// Both read one wake rule (wake-settings.js) and share one id counter. A take
// that never gets a `session` or `results` event behaves exactly as Phase 1's.
//
// Late correction on the results path (D-79): after it has chosen, an exchange
// stays correctable until its remark has gone 2 s unchanged. A changed remark
// is chosen again from the state as it was before this exchange's own swap.
// The same choice changes nothing. Another angle gives one `swap` and one
// `note` with `corrected: true` that replace the first ones. A choice that is
// now nothing gives `swap-undone`, and the swap and its note are taken back.
// Only the exchange that chose last can be corrected: a late result for an
// older exchange never touches a newer one.
//
// An exchange that changes nothing says so (REMARK-02, D-82): when an exchange
// closes with no swap standing, the take emits one `heard` event with the
// remark as heard, the reason from the matcher (explainNoSwap) and the line
//   Heard "<remark>". Nothing changed.
// No note is saved and nothing is cut differently. On the word path that is
// when the silence timer, the key release or the end of the take closes the
// exchange; on the results path it is when the correction time is over, because
// until then a late correction can still turn the remark into a swap. An
// exchange with no remark word, and one that was dropped, says nothing. One
// function decides this (nothingChanged), with one caller per path at the
// close. It is also where a remark is read as a request for a trial (below),
// so on the results path it runs once more when the remark is complete.
//
// A remark that may hold narration (readRequest below): Chrome delivers a
// remark a word at a time, and a person often carries on talking straight after
// a request. So a remark that was cut off while the person kept talking
// (D-80), and one that changed after it was first complete, are read whole
// first and, when the whole asks for nothing, by their longest leading stretch
// that does ask for something. A remark that settled is read whole when it
// first acts, as the matcher's own table has it (REMARK-01).
//
// Experiments (EXP-01; D-58 to D-63), on only when the caller passes
// `experiments`. The matcher is asked first, exactly as above. Only a remark it
// makes no swap from is read as a request for a trial ("let's try grab a coffee
// instead of grab a tea"), by the local reader of experiments.js: no network,
// so YAP's proposal shows in under a second (`experiment-proposed`). On the
// word path that is when the exchange closes; on the results path it is when
// the remark has settled, and an exchange that has a proposal emits no `heard`
// at its close. A model is asked only when the caller passed `experiments.ask`,
// the reader read nothing and the remark holds a trial word, once per exchange.
//
// Nothing is accepted until the person accepts (D-60). A yes or a no is given
// by voice or by the call `answerExperiment`. By voice: while a proposal has no
// answer and is inside ANSWER_DEFAULTS.windowSec, final words that no talk with
// YAP owns are held until a `pause` event or exchangeEndPause with no further
// word. Exactly one phrase of the closed yes list accepts, exactly one of the
// closed no list keeps the old wording, and anything else is ordinary speech,
// released to the follower in its order. Only the words said next can answer:
// once they were something else, a later yes is ordinary speech too (the call
// still answers), so no cut ever reaches over words that stay in the video. On
// the results path the words Chrome puts after the request inside the
// still-open exchange are read the same way.
// The answer is part of the same talk with YAP: the exchange's `end` moves to
// the answer's last word, so the request and the answer are one cut. The take
// writes nothing to disk; the caller saves an accepted experiment.
//
// The greeting (D-58, D-62): at take start, and when an accepted Greeting trial
// changes it, the take emits `greeting` with the text of greetingFor. Every
// line about a trial comes from the COPY of experiments.js (D-63).
//
// Two cue streams that never merge (DELIV-01; D-38, D-45), the second on only
// when the caller passes `delivery`. STORY says what to talk about next: the
// point, cue, swap and note events above. DELIVERY says how the person wanted
// to say it: one stream object from delivery.js beside the story side, with its
// own `delivery` events and its own place in state(). Nothing is added to a
// story event and no function returns a mixed list. The stream is told the beat
// of each point as it is lit, and is fed the counted words (never the words of
// a talk with YAP). Live, one delivery cue shows at a time: the cue chosen for
// the current beat. Pace raises Slow down only when the person chose that cue,
// so with `delivery` given the take does not offer Phase 1's own pace line; the
// kept-note first cue is untouched. A take with no `delivery` keeps Phase 1's
// pace cue exactly as it is.

import { createExchangeDetector, HEY_YAP_DEFAULTS } from './hey-yap.js';
import { createWakeTracker } from './wake-tracker.js';
import { WAKE_SETTINGS, isWakeFirst, isYapLike, isNever } from './wake-settings.js';
import { matchAngle, applySwap, explainNoSwap } from './swap.js';
import { normalizeToken } from './text.js';
import { createPointFollower } from './follow.js';
import { paceCue } from './pace.js';
import { createCueController, CUE_DEFAULTS } from './cues.js';
import { requestFullerReply, applyFullerReply } from './realtime.js';
import { proposeExperiment, readExperimentRequest, acceptExperiment, keepOld, greetingFor, EXPERIMENT_DEFAULTS } from './experiments.js';
import { createDeliveryStream } from './delivery.js';

/**
 * While pace has raised Slow down the take looks again this often, in seconds:
 * the delivery stream has no clock, and the person may have gone quiet.
 */
const DELIVERY_TICK_SEC = 1;

/**
 * How a spoken answer to a proposal is read (seat default, D-58, D-60): the
 * words said next, up to the next pause, must be exactly one phrase of a closed
 * list, inside `windowSec` of the proposal. One setting each; phrases are
 * compared after normalizeToken, apostrophes aside.
 */
export const ANSWER_DEFAULTS = Object.freeze({
  /** seconds after the proposal in which a spoken answer counts */
  windowSec: 6,
  /** the most words an answer may have */
  maxWords: 6,
  /** saying exactly one of these accepts the trial */
  yes: Object.freeze([
    "yeah let's do that", "yes let's do that", 'yeah', 'yes', 'yep', 'ok', 'okay', 'sure', 'do it', "let's do that", "let's do it", 'sounds good',
  ]),
  /** saying exactly one of these keeps the old wording */
  no: Object.freeze(['no', 'nope', 'no thanks', 'keep the old one', 'no keep the old one', 'leave it', 'never mind']),
});

/**
 * @typedef {object} Note
 * @property {string} id
 * @property {string} exchangeId
 * @property {string} text      "Noted: story over tips"
 * @property {string} rawCorrection the final exact remark retained with this preference
 * @property {string} [appliedFrom] actual UI source when different from the stated comparison
 * @property {string} prefer    "story"
 * @property {string} over      "tips"
 * @property {'pending'|'kept'|'dropped'} status
 * @property {true} [corrected]  it replaces an earlier note of the same exchange (D-79)
 */

/**
 * @typedef {import('./swap.js').Swap & { corrected?: true }} TakeSwap  a swap as the take emits it;
 *   `corrected` is set when it replaces an earlier swap of the same exchange (D-79)
 */

/**
 * @typedef {object} Choice  what an open results-path exchange chose, kept until it closes
 * @property {object} base        the brief as it was before this exchange's own swap
 * @property {number} baseIndex   the point showing when it first chose
 * @property {number} least       the fewest leading words of a changed remark that may be read as the request
 * @property {TakeSwap | null} swap  its standing swap
 * @property {Note | null} note      and that swap's note
 */

/**
 * @typedef {{ kind: 'memory' | 'pace', text: string, since: number }} Cue
 * @typedef {{ kind: 'memory' | 'pace', text: string, from: number, to: number }} CueSpan
 * @typedef {{ exchangeId: string, text: string, source: 'prepared' | 'realtime', at: number }} ShownReply
 */

/**
 * @typedef {Omit<import('./experiments.js').Proposal, 'status'> & { status: 'proposed' | 'accepted' | 'kept-old' | 'withdrawn' }} TakeProposal
 *   a proposal as the take holds it: proposed, then accepted or kept-old by the person's answer, or withdrawn
 *   when Chrome rewrote the remark it was read from into something else (D-79)
 */

/**
 * @typedef {object} Offer  the trial YAP proposed for one exchange (EXP-01)
 * @property {TakeProposal} proposal
 * @property {string} exchangeId
 * @property {number} at         take time it was proposed, or last corrected: the time to answer counts from here
 * @property {string[]} source   the words of the remark it was read from
 * @property {boolean} said      the words said next were heard and were no answer: only a call can answer it now
 */

/**
 * @typedef {object} ExperimentsOption  (EXP-01)
 * @property {import('./experiments.js').Experiment[]} [accepted]  the trials accepted in earlier recordings (D-62)
 * @property {(request: { task: 'experiment', text: string }) => Promise<{ source: string, text: string | null }>} [ask]
 *   a model, asked only for a remark the local reader cannot read (D-61)
 */

/**
 * @typedef {{type: 'experiment-proposed', proposal: TakeProposal, exchangeId: string, at: number, latencySec: number, corrected?: true}
 *   | {type: 'experiment-answered', proposalId: string, answer: 'accepted' | 'kept-old', by: 'voice' | 'call',
 *       experiment: import('./experiments.js').Experiment | null, line: string | null, at: number}
 *   | {type: 'experiment-withdrawn', proposalId: string, exchangeId: string, at: number}
 *   | {type: 'greeting', text: string, from: string | null, experimentId: string | null, at: number}} ExperimentEvent
 */

/**
 * @typedef {object} DeliveryOption  (DELIV-01)
 * @property {import('./delivery.js').DeliveryCue[]} cues  the person's 1 to 3 delivery cues, each with the beat it was chosen for
 * @property {string[]} [beatIds]  beatIds[k] is the beat of point k
 */

/**
 * @typedef {{type: 'delivery', cue: import('./delivery.js').DeliveryCue | null, beatId: string | null,
 *   reason: 'beat' | 'pace', at: number}} DeliveryEvent  the one delivery cue now showing changed (D-45)
 */

/**
 * @typedef {{type: 'exchange-open', exchange: import('./hey-yap.js').Exchange}
 *   | {type: 'exchange-close', exchange: import('./hey-yap.js').Exchange}
 *   | {type: 'swap', swap: TakeSwap}
 *   | {type: 'swap-undone', exchangeId: string}
 *   | Heard
 *   | {type: 'note', note: Note}
 *   | {type: 'word', word: import('./replay.js').Word, inExchange: boolean}
 *   | {type: 'counted', word: import('./replay.js').Word}
 *   | {type: 'point', pointId: string, index: number, at: number}
 *   | {type: 'cue', cue: Cue | null, at: number}
 *   | {type: 'reply', exchangeId: string, reply: { text: string, source: 'realtime' }}
 *   | {type: 'reply-status', exchangeId: string, status: string, message: string}
 *   | {type: 'interim', text: string, at: number}
 *   | {type: 'exchange-drop', exchangeId: string, reason: 'retracted' | 'wake-only' | 'stopped'}
 *   | {type: 'hearing', hearing: Hearing}
 *   | ExperimentEvent
 *   | DeliveryEvent} TakeEvent
 */

/**
 * @typedef {object} Heard  an exchange closed and nothing changed (REMARK-02, D-82)
 * @property {'heard'} type
 * @property {string} exchangeId
 * @property {string} remark   the remark as heard
 * @property {'nothing-prepared' | 'not-understood'} reason
 * @property {string} line     Heard "<remark>". Nothing changed.
 */

/**
 * @typedef {{ status: string, line: string | null, listenAgain: boolean }} Hearing  how well YAP can hear (WAKE-05), as the
 *   source reports it; the line is null when there is nothing to say (ok, stopped)
 */

/**
 * @typedef {object} RealtimeHook
 * @property {(req: { instructions: string }) => any} getSecret   asks the localhost server (or a fake) for a short-lived secret
 * @property {(opts: { url: string, protocols: string[] }) => any} connect  opens the Realtime transport
 * @property {{ setTimeout(cb: () => void, ms: number): any, clearTimeout(h: any): void }} [clock]  timers in milliseconds; default the global timers
 * @property {number} [timeoutSec]
 */

const GLOBAL_TIMERS = Object.freeze({
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
});

/**
 * @param {object} options
 * @param {object} options.brief                 a validated brief
 * @param {import('./clock.js').Clock} options.clock   the take clock
 * @param {object} [options.settings]            exchange detector settings; currentPointIndex (default 0)
 * @param {(event: TakeEvent) => void} [options.onEvent]
 * @param {boolean | object} [options.follow]    true, follower options, or a follower ({ onWord, setBrief, current })
 * @param {boolean | { memory?: any, threshold?: number }} [options.pace]  true, or the person's memory settings
 * @param {{ kind: 'memory', text: string } | null} [options.firstCue]
 * @param {{ memoryCueSec?: number, minCueSec?: number }} [options.cueSettings]
 * @param {RealtimeHook | null} [options.realtime]
 * @param {ExperimentsOption | null} [options.experiments]  turns the trial proposal, its answer and the greeting on (EXP-01)
 * @param {DeliveryOption | null} [options.delivery]  turns the delivery stream on, in place of Phase 1's pace cue (DELIV-01)
 */
export function createLiveTake({
  brief,
  clock,
  settings = {},
  onEvent = () => {},
  follow = false,
  pace = false,
  firstCue = null,
  cueSettings = {},
  realtime = null,
  experiments = null,
  delivery = null,
}) {
  if (!brief || !Array.isArray(brief.points)) throw new TypeError('createLiveTake needs a brief');
  if (!clock) throw new TypeError('createLiveTake needs a clock');
  const { currentPointIndex: startIndex = 0, ...detectorSettings } = settings;
  const wakeFirst = new Set((detectorSettings.wakeFirst || HEY_YAP_DEFAULTS.wakeFirst).map(normalizeToken));
  /** Silence that ends a stretch of speech: an exchange on the word path, and a spoken answer. */
  const pauseSec = Number.isFinite(detectorSettings.exchangeEndPause) ? detectorSettings.exchangeEndPause : HEY_YAP_DEFAULTS.exchangeEndPause;
  const maxRemarkWords = Number.isFinite(detectorSettings.maxRemarkWords) ? detectorSettings.maxRemarkWords : WAKE_SETTINGS.maxRemarkWords;

  /** @type {ExperimentsOption | null} null when experiments are off: the take then behaves as it did without them */
  const trials = experiments ? (typeof experiments === 'object' ? experiments : {}) : null;
  /** @type {import('./experiments.js').Experiment[]} the trials accepted in earlier recordings */
  const acceptedBefore = trials && Array.isArray(trials.accepted) ? trials.accepted.map((e) => structuredClone(e)) : [];
  const askModel = trials && typeof trials.ask === 'function' ? trials.ask : null;
  const yesKeys = new Set(ANSWER_DEFAULTS.yes.map(answerKey));
  const noKeys = new Set(ANSWER_DEFAULTS.no.map(answerKey));
  const answerKeys = [...yesKeys, ...noKeys];
  /** Could these words still become an answer: are they a phrase of the lists, or the start of one? */
  const couldAnswer = (said) => answerKeys.some((key) => key === said || key.startsWith(`${said} `));
  /** @type {Offer[]} every proposal of the take, in order: one for each exchange that asked for a trial */
  const offers = [];
  /** @type {import('./experiments.js').Experiment[]} the trials accepted in this take */
  const acceptedNow = [];
  /** @type {string | null} the greeting the take shows now */
  let greeting = null;
  /** @type {Set<string>} the exchanges a model was asked about: once each (T-01.1-26) */
  const askedModel = new Set();
  /**
   * @type {Map<string, { source: string[], stale: boolean, closed: null | { remark: string, brief: object, pointIndex: number } }>}
   * the exchanges waiting for a model's answer; `closed` is set when the exchange closed meanwhile
   */
  const waiting = new Map();
  /** @type {Map<string, string[]>} the final words Chrome gave for each results-path exchange, in order */
  const ownedFinals = new Map();
  /** @type {Map<string, number>} where a spoken answer ended, by exchange id: the end of that talk with YAP */
  const answerEnds = new Map();
  /**
   * @type {null | { offer: Offer, words: { word: import('./replay.js').Word, free: boolean }[], passing: boolean, timer: unknown }}
   * the words held as a possible answer; `passing` once they cannot be one, until the next pause
   */
  let hold = null;
  /** true while the take's `end` event is being handled: no model is asked for an answer that could not be used */
  let ending = false;

  let currentBrief = brief;
  let currentPointIndex = startIndex;
  /** @type {import('./hey-yap.js').Exchange[]} */
  const exchanges = [];
  /** @type {import('./swap.js').Swap[]} */
  const swaps = [];
  /** @type {Note[]} */
  const notes = [];
  /** @type {ShownReply[]} */
  const replies = [];
  /** @type {{ pointId: string, index: number, at: number }[]} */
  const pointTimeline = [];
  /** @type {CueSpan[]} */
  const cueSpans = [];
  /** @type {import('./replay.js').Word[]} words outside every talk with YAP, in order */
  const counted = [];
  /** @type {Promise<unknown>[]} */
  const pending = [];
  /** @type {unknown[]} */
  const timers = [];
  let ended = false;
  /** @type {{ start: number } | null} */
  let openExchange = null;
  /** @type {import('./replay.js').Word | null} a possible first wake word, held until the next word shows whether it opened a talk with YAP */
  let held = null;
  /** true from the first `session` or `results` event: Chrome's results decide the wake pairs */
  let resultsPath = false;
  // A held key targets text observed after the press. Final results may repeat
  // earlier interim narration, and their estimated word times cannot separate
  // it. Snapshot the exact observed prefix; if Chrome rewrites that boundary,
  // preserve the words as narration instead of guessing a request.
  let resultSession = null;
  const resultText = new Map();
  const resultFinal = new Map();
  // A released key owns only the recognition span already observed while held.
  // Chrome can finalize that span later. Never extend custody into a new result
  // or into additional words spoken after release; never cross a session.
  let releasedKey = null;
  let releasedWordOwner = null;
  function resultWords() {
    return [...resultText.keys()].sort((a,b)=>a-b).flatMap(index=>
      resultText.get(index).split(/\s+/).filter(Boolean).map((text,pos)=>
        ({text,index,pos,session:resultSession,final:resultFinal.get(index)===true})));
  }
  function keyWords(boundary=keyBoundary) {
    if (!boundary || boundary.session !== resultSession) return [];
    const words=resultWords();
    if (!boundary.tokens.every((token,i)=>normalizeToken(words[i]?.text || '')===token)) return [];
    return words.slice(boundary.tokens.length);
  }
  function releasedWords(custody) {
    const observed=keyWords(custody.boundary);
    // A native stop boundary admits the final's complete corrected wording,
    // including insertions/merged results. Unsealed adapters retain only the
    // previously observed span; they cannot claim later unseen words.
    const words=custody.sealed ? observed : observed.filter(w=>custody.indices.has(w.index)).slice(0,custody.length);
    return words.map(w=>({...w,start:custody.exchange.start,end:custody.exchange.end}));
  }
  function ownsReleased(word) {
    return releasedWordOwner && word.session===releasedWordOwner.session &&
      releasedWordOwner.words.some(w=>w.index===word.index && w.pos===word.pos);
  }
  function reconcileReleased(event) {
    releasedWordOwner=null;
    const custody=releasedKey;
    if (!custody) return;
    if (event.session!==custody.boundary.session || clock.now()>custody.expires) {
      choices.delete(custody.exchange.id); releasedKey=null; return;
    }
    if (!custody.sealed && !event.results.some(r=>custody.indices.has(r.index))) return;
    const words=releasedWords(custody);
    releasedWordOwner={session:event.session,words};
    const next={...custody.exchange,words,remark:words.map(w=>w.text).join(' ')};
    const changed=next.remark!==custody.exchange.remark;
    const savedIndex=exchanges.findIndex(x=>x.id===next.id);
    if(savedIndex>=0)exchanges[savedIndex]=next;
    if (changed) {
      // Reconcile one exchange, not a second request. A final negation or an
      // unrecognised correction retracts a provisional swap through correct().
      correct(next);
      custody.exchange=next;
      onEvent({type:'exchange-revised',exchange:next});
    }
    if(words.length && words.every(w=>w.final) && (!custody.finalized || changed)) {
      custody.finalized=true;
      if(!choices.get(next.id)?.swap) {
        for(let i=heard.length-1;i>=0;i--)if(heard[i].exchangeId===next.id)heard.splice(i,1);
        nothingChanged(next,choices.get(next.id)?.base || currentBrief,currentPointIndex);
      }
    }
    // Keep this bounded span until expiry/new press even after finalization:
    // repeated final events must not become a second exchange or narration.
  }
  let keyBoundary = null;
  const resultTokens = () => [...resultText.keys()].sort((a, b) => a - b)
    .flatMap(index => resultText.get(index).split(/\s+/).filter(Boolean).map(normalizeToken));
  function keyOwns(word) {
    if (word.typed || !keyBoundary) return true;
    if (word.session !== keyBoundary.session || !Number.isInteger(word.index) || !Number.isInteger(word.pos)) return false;
    const tokens = resultTokens();
    if (!keyBoundary.tokens.every((token, i) => tokens[i] === token)) return false;
    const before = [...resultText.keys()].filter(index => index < word.index)
      .reduce((n, index) => n + resultText.get(index).split(/\s+/).filter(Boolean).length, 0);
    return before + word.pos >= keyBoundary.tokens.length;
  }

  /** @type {Hearing | null} the latest hearing status the source sent */
  let hearing = null;
  let exchangeCount = 0;
  /** One id counter for every exchange of the take, whichever path opened it. */
  const nextExchangeId = () => `x${++exchangeCount}`;
  /** @type {(import('./wake-tracker.js').TrackerExchange & { reason: string })[]} exchanges that never were (D-81) */
  const dropped = [];
  /** @type {Map<string, import('./replay.js').Word[]>} the final words of each open results-path exchange, by exchange id */
  const ownedWords = new Map();
  /** @type {Heard[]} the exchanges that closed with nothing changed, in order (REMARK-02) */
  const heard = [];
  /** @type {Map<string, Choice>} what each open results-path exchange chose, by exchange id */
  const choices = new Map();
  /** @type {string | null} the exchange that chose last, on either path: the only one a late correction may change (D-79) */
  let lastChooser = null;
  /** @type {Map<string, number>} counts the fuller-reply requests of each exchange, so a reply to a replaced swap is never shown */
  const replyAsk = new Map();

  const follower = makeFollower(follow, brief);
  const paceOn = Boolean(pace);
  const paceOptions = paceOptionsOf(pace);
  const cueCfg = { ...CUE_DEFAULTS, ...(cueSettings || {}) };
  const cues = paceOn || firstCue ? createCueController(cueCfg) : null;
  /** @type {{ kind: string, text: string, since: number } | null} */
  let shownCue = null;
  let paceOffered = false;

  // The delivery stream (DELIV-01): a second object beside the story side, never merged with it (D-38).
  /** @type {DeliveryOption | null} null when delivery cues are off: Phase 1's pace cue is then as it was */
  const deliveryCfg = delivery && typeof delivery === 'object' && Array.isArray(delivery.cues) ? delivery : null;
  /** @type {string[]} the beat of each point, by point index */
  const beatIds = deliveryCfg && Array.isArray(deliveryCfg.beatIds) ? deliveryCfg.beatIds : [];
  /** @type {import('./delivery.js').DeliveryCue | null} the one delivery cue showing now */
  let deliveryShown = null;
  /** true while pace has raised Slow down */
  let deliveryRaised = false;
  /** true while a tick is waiting to look at the pace again */
  let deliveryTick = false;
  /** @type {number | null} take time the take ended */
  let endedAt = null;
  const deliveryStream = deliveryCfg
    ? createDeliveryStream({
      delivery: { cues: deliveryCfg.cues },
      // The person's pace level: the same threshold Phase 1's pace cue uses.
      threshold: paceOptions.cue.threshold,
      minCueSec: cueCfg.minCueSec,
      onChange: (change) => {
        deliveryShown = change.cue;
        deliveryRaised = change.reason === 'pace';
        onEvent({ type: 'delivery', cue: change.cue, beatId: change.beatId, reason: change.reason, at: change.at });
      },
    })
    : null;

  /** While a raised Slow down shows, look again on a tick: the stream reports its going on the next call. */
  function watchDelivery() {
    if (!deliveryRaised || deliveryTick) return;
    deliveryTick = true;
    later(() => {
      deliveryTick = false;
      feedDelivery(clock.now());
    }, DELIVERY_TICK_SEC);
  }

  /** The point now lit, as its beat: the delivery stream shows the cue chosen for it (D-45). */
  function lightBeat(index, at) {
    if (!deliveryStream) return;
    const id = beatIds[index];
    deliveryStream.onBeat(typeof id === 'string' ? id : null, at);
    watchDelivery();
  }

  /** The counted words so far: pace raises Slow down only when the person chose it (D-45). */
  function feedDelivery(at) {
    if (!deliveryStream) return;
    deliveryStream.onWords(counted, at);
    watchDelivery();
  }

  function emitPoint(at) {
    const { pointId, index } = follower.current();
    currentPointIndex = index;
    pointTimeline.push({ pointId, index, at });
    onEvent({ type: 'point', pointId, index, at });
    lightBeat(index, at);
  }

  function later(fn, seconds) {
    timers.push(clock.setTimeout(() => {
      if (!ended) fn();
    }, seconds));
  }

  function checkCue(at) {
    if (!cues) return;
    const cue = cues.current(at);
    const same = cue && shownCue && cue.kind === shownCue.kind && cue.text === shownCue.text && cue.since === shownCue.since;
    if (same || (!cue && !shownCue)) return;
    const open = cueSpans[cueSpans.length - 1];
    if (shownCue && open && open.to === null) open.to = at;
    shownCue = cue ? { kind: cue.kind, text: cue.text, since: cue.since } : null;
    if (cue) cueSpans.push({ kind: cue.kind, text: cue.text, from: at, to: /** @type {any} */ (null) });
    onEvent({ type: 'cue', cue: cue ? { kind: cue.kind, text: cue.text, since: cue.since } : null, at });
  }

  function updatePace(at) {
    // With delivery cues chosen, Phase 1's own pace line is not shown: the delivery stream decides (D-45).
    if (!cues || !paceOn || !paceOptions.enabled || deliveryStream) return;
    const c = paceCue(counted, at, paceOptions.cue);
    if (c.show && c.text) {
      cues.offer({ kind: 'pace', text: c.text }, at);
      paceOffered = true;
    } else if (paceOffered) {
      // A shown pace cue stays its minimum time; look again when that is up.
      cues.withdraw('pace', at);
      paceOffered = false;
      later(() => checkCue(clock.now()), cueCfg.minCueSec);
    }
  }

  // Live follow on Chrome's early results. The light may move on interim text,
  // but only through the follower's own forward-only rule, and only on words
  // that were identical at the same place in two results events in a row and are
  // not the newest word (Chrome rewrites the tail of early text). Places are
  // counted over all kept results, as the wake tracker does: Chrome moves words
  // between early results freely. Nothing else reads interim text: no command,
  // note, answer, tick or transcript word comes from it. When words already
  // followed are rewritten, early follow stops until the final words cover them;
  // a stretch is followed only up to a wake word; nothing is followed while a
  // key is held, a talk with YAP is open or a proposal waits for its answer.
  // Words followed early are remembered by place, so the same final word is not
  // counted for the follower twice.
  let interimPrev = [];
  let interimFed = [];
  let interimFrozen = false;
  const followedAt = new Map();
  function resetInterim() { interimPrev = []; interimFed = []; interimFrozen = false; followedAt.clear(); }
  /** the place of a final word over all kept results of its session, or -1 */
  function flatPlace(word) {
    if (word.session !== resultSession || !Number.isInteger(word.index) || !Number.isInteger(word.pos)) return -1;
    let before = 0;
    for (const [index, text] of resultText) if (index < word.index) before += text.split(/\s+/).filter(Boolean).length;
    return before + word.pos;
  }
  function feedInterim() {
    if (!follower || typeof follower.onStableWords !== 'function') return;
    const words = resultWords();
    const raw = words.map((w) => w.text);
    const tokens = raw.map(normalizeToken);
    const prev = interimPrev;
    interimPrev = tokens;
    let early = words.findIndex((w) => !w.final);
    if (early < 0) early = words.length;
    const blocked = detector.isOpen() || keyBoundary !== null || releasedKey !== null || tracker.isOpen() || Boolean(trials && openOffer());
    if (interimFrozen && early >= interimFed.length) { interimFrozen = false; interimFed = tokens.slice(0, early); }
    if (interimFrozen || blocked) return;
    const rewritten = interimFed.findIndex((t, i) => i >= early && tokens[i] !== t);
    if (rewritten >= 0) { interimFrozen = true; return; }
    let stable = 0;
    while (stable < tokens.length && stable < prev.length && tokens[stable] === prev[stable]) stable += 1;
    stable = Math.min(stable, tokens.length - 1); // the newest word is still being written (add -> adding)
    const wake = tokens.findIndex((t) => wakeFirst.has(t));
    if (wake >= 0) stable = Math.min(stable, wake);
    const from = Math.max(interimFed.length, early);
    if (stable <= from) return;
    interimFed = tokens.slice(0, stable);
    for (let at = from; at < stable; at += 1) followedAt.set(at, tokens[at]);
    const moved = follower.onStableWords(raw.slice(from, stable));
    if (moved && moved.changed) emitPoint(clock.now());
  }

  /** A word outside every talk with YAP: it feeds the follower and pace. */
  function count(word) {
    counted.push(word);
    onEvent({ type: 'counted', word });
    if (!follower) return;
    const place = flatPlace(word);
    if (place >= 0 && followedAt.get(place) === normalizeToken(word.text)) return;
    const r = follower.onWord(word);
    if (r && r.changed) emitPoint(clock.now());
  }

  /** A final word outside every talk with YAP: a possible answer to an open proposal, else ordinary speech. */
  function spoken(word) {
    if (!mayAnswer(word, true)) count(word);
  }

  function releaseHeld() {
    if (!held) return;
    const w = held;
    held = null;
    spoken(w);
  }

  // ---- experiments: the answer by voice (D-58, D-60) ----

  /**
   * The proposal a spoken answer would answer: the latest one with no answer
   * yet, unless the words said after it have already been heard. Only the
   * words said next can answer by voice: a later yes would move the cut over
   * speech that stays in the video.
   */
  function openOffer() {
    for (let i = offers.length - 1; i >= 0; i -= 1) {
      if (offers[i].proposal.status === 'proposed') return offers[i].said ? null : offers[i];
    }
    return null;
  }

  /** @param {string} exchangeId @returns {Offer | null} */
  const offerOf = (exchangeId) => offers.find((o) => o.exchangeId === exchangeId) ?? null;

  /** Is the proposal still unanswered and inside the time a spoken answer counts? */
  const answerable = (offer) => offer.proposal.status === 'proposed' && clock.now() - offer.at <= ANSWER_DEFAULTS.windowSec + 1e-9;

  /** Held words that answered nothing are ordinary speech again, in their order. */
  function release(words) {
    for (const h of words) if (h.free) count(h.word);
  }

  /** The held words end at a pause event, or at pauseSec with no further word. */
  function armHold() {
    const mine = /** @type {NonNullable<typeof hold>} */ (hold);
    if (mine.timer !== null) clock.clearTimeout(mine.timer);
    mine.timer = clock.setTimeout(() => {
      mine.timer = null;
      if (hold === mine && !ended) settleAnswer();
    }, pauseSec);
  }

  /**
   * A final word that may be the person's answer to an open proposal: it is
   * held until the next pause. As soon as the held words can no longer become
   * a phrase of the lists they are released, and the rest of that stretch of
   * speech passes straight through (T-01.1-25: a yes phrase inside narration
   * answers nothing).
   * @param {import('./replay.js').Word} word
   * @param {boolean} free  no talk with YAP owns the word: it is ordinary speech when it answers nothing
   * @returns {boolean} true when the word was taken: held, or released with the words held before it
   */
  function mayAnswer(word, free) {
    if (!trials) return false;
    if (!hold) {
      const offer = openOffer();
      if (!offer || !answerable(offer)) return false;
      hold = { offer, words: [], passing: false, timer: null };
    }
    armHold();
    if (hold.passing) return false;
    hold.words.push({ word, free });
    const said = hold.words.map((h) => answerToken(h.word.text)).filter(Boolean).join(' ');
    if (answerable(hold.offer) && hold.words.length <= ANSWER_DEFAULTS.maxWords && couldAnswer(said)) return true;
    const words = hold.words;
    hold.words = [];
    hold.passing = true;
    hold.offer.said = true;
    release(words);
    return true;
  }

  /** The pause after the held words: a yes, a no, or ordinary speech. */
  function settleAnswer() {
    if (!hold) return;
    const { offer, words, timer } = hold;
    if (timer !== null) clock.clearTimeout(timer);
    hold = null;
    if (words.length === 0) return;
    const said = words.map((h) => answerToken(h.word.text)).filter(Boolean).join(' ');
    const answer = offer.proposal.status !== 'proposed' ? null : yesKeys.has(said) ? 'accept' : noKeys.has(said) ? 'keep-old' : null;
    if (!answer) {
      offer.said = true;
      release(words);
      return;
    }
    answerOffer(offer, answer, 'voice', undefined, words[words.length - 1].word.end);
  }

  /**
   * The answer is part of the same talk with YAP: the exchange, and so its cut,
   * ends at the answer's last word.
   * @param {string} exchangeId
   * @param {number} endAt
   */
  function moveEnd(exchangeId, endAt) {
    answerEnds.set(exchangeId, Math.max(endAt, answerEnds.get(exchangeId) ?? -Infinity));
    const i = exchanges.findIndex((x) => x.id === exchangeId);
    if (i >= 0) exchanges[i] = withAnswerEnd(exchanges[i]);
  }

  /** An exchange with its end moved to the end of the answer that followed it, when there was one. */
  function withAnswerEnd(exchange) {
    const endAt = answerEnds.get(exchange.id);
    return endAt !== undefined && !(exchange.end >= endAt) ? { ...exchange, end: endAt } : exchange;
  }

  /** The greeting changed: one `greeting` event with the text it now reads (D-58). */
  function showGreeting(experimentId, at) {
    const next = greetingFor(brief, [...acceptedBefore, ...acceptedNow]);
    if (next === null || next === greeting) return;
    const from = greeting;
    greeting = next;
    onEvent({ type: 'greeting', text: next, from, experimentId, at });
  }

  /**
   * The person answered a proposal, by voice or by call. This is the only place
   * a proposal becomes an experiment (D-60); the take saves nothing itself.
   * @param {Offer} offer            a proposal with no answer yet
   * @param {'accept' | 'keep-old'} answer
   * @param {'voice' | 'call'} by
   * @param {number} [trialLength]   another trial length than the one proposed
   * @param {number} [endAt]         where a spoken answer ended
   */
  function answerOffer(offer, answer, by, trialLength, endAt) {
    const at = clock.now();
    const proposalId = offer.proposal.id;
    /** @type {import('./experiments.js').Experiment | null} */
    let experiment = null;
    /** @type {string | null} */
    let line = null;
    if (answer === 'accept') {
      const proposal = /** @type {import('./experiments.js').Proposal} */ (offer.proposal);
      ({ experiment, line } = acceptExperiment(proposal, { trialLength, existing: [...acceptedBefore, ...acceptedNow] }));
      acceptedNow.push(experiment);
      offer.proposal = { ...offer.proposal, status: 'accepted' };
    } else {
      offer.proposal = keepOld(/** @type {import('./experiments.js').Proposal} */ (offer.proposal));
    }
    if (Number.isFinite(endAt)) moveEnd(offer.exchangeId, /** @type {number} */ (endAt));
    /** @type {ExperimentEvent} */
    const event = {
      type: 'experiment-answered',
      proposalId,
      answer: experiment ? 'accepted' : 'kept-old',
      by,
      experiment: experiment ? structuredClone(experiment) : null,
      line,
      at,
    };
    onEvent(event);
    if (experiment && experiment.category === 'Greeting') showGreeting(experiment.id, at);
    return event;
  }

  function requestReply(exchange, swap) {
    if (!realtime || typeof realtime.getSecret !== 'function') return;
    const exchangeId = exchange.id;
    const ask = (replyAsk.get(exchangeId) ?? 0) + 1;
    replyAsk.set(exchangeId, ask);
    const request = requestFullerReply({
      swap,
      brief: currentBrief,
      remark: exchange.remark,
      getSecret: realtime.getSecret,
      connect: realtime.connect,
      clock: realtime.clock || GLOBAL_TIMERS,
      timeoutSec: realtime.timeoutSec,
      isCurrent: (id) => replyAsk.get(id) === ask && swaps.length > 0 && swaps[swaps.length - 1].exchangeId === id,
      onReply: (reply) => {
        // The swap this reply was asked for has been replaced or taken back (D-79): the reply is not shown.
        if (replyAsk.get(exchangeId) !== ask) return;
        const next = applyFullerReply({ swaps, notes }, exchangeId, reply);
        swaps.splice(0, swaps.length, ...next.swaps);
        notes.splice(0, notes.length, ...next.notes);
        const shown = swaps.find((s) => s.exchangeId === exchangeId);
        if (shown && shown.reply && shown.reply.source === 'realtime') {
          replies.push({ exchangeId, text: shown.reply.text, source: 'realtime', at: clock.now() });
          onEvent({ type: 'reply', exchangeId, reply: { text: shown.reply.text, source: 'realtime' } });
        }
      },
    }).then((outcome) => {
      onEvent({ type: 'reply-status', exchangeId, status: outcome.status, message: STATUS_LINE[outcome.status] || outcome.status });
      return outcome;
    });
    pending.push(request);
  }

  /**
   * Make the swap a match asks for, with its note: one `swap` and one `note` event.
   * @param {{ id: string, remark: string }} exchange
   * @param {import('./swap.js').Match} match  read against the brief now showing
   * @param {number} since      take time the remark ended: its last word (word path) or its last change (results path)
   * @param {number} t0         performance.now() when the reading started
   * @param {boolean} [corrected]  it replaces an earlier swap of this exchange (D-79)
   * @returns {{ swap: TakeSwap, note: Note }}
   */
  function makeSwap(exchange, match, since, t0, corrected = false) {
    const { brief: nextBrief, swap } = /** @type {{ brief: object, swap: TakeSwap }} */ (applySwap(currentBrief, match, { exchangeId: exchange.id }));
    const computeMs = performance.now() - t0;
    swap.computeMs = computeMs;
    swap.at = clock.now();
    swap.latencySec = (clock.now() - since) + (clock.isManual ? computeMs / 1000 : 0);
    if (corrected) swap.corrected = true;
    currentBrief = nextBrief;
    if (follower) follower.setBrief(nextBrief);
    swaps.push(swap);
    replies.push({ exchangeId: exchange.id, text: swap.reply.text, source: swap.reply.source, at: swap.at });
    onEvent({ type: 'swap', swap });

    /** @type {Note} */
    const note = {
      id: `n${notes.length + 1}`,
      exchangeId: exchange.id,
      text: swap.note,
      rawCorrection: exchange.remark,
      prefer: swap.to.label,
      over: swap.requestedOver ?? swap.from.label,
      ...(swap.requestedOver && swap.requestedOver !== swap.from.label ? { appliedFrom: swap.from.label } : {}),
      status: /** @type {'pending'} */ ('pending'),
    };
    if (corrected) note.corrected = true;
    notes.push(note);
    onEvent({ type: 'note', note });
    requestReply(exchange, swap);
    return { swap, note };
  }

  // Preserve the raw key remark and exact correction. Only matching treats
  // an optional familiar wake pair as addressing YAP, using the frozen rule.
  function requestRemark(exchange) {
    const words = String(exchange.remark ?? '').split(/\s+/).filter(Boolean);
    if (exchange.trigger === 'key' && words.length >= 2 && isWakeFirst(words[0], detectorSettings)
      && isYapLike(words[1], detectorSettings) && !isNever(words[1], detectorSettings)) return words.slice(2).join(' ');
    return exchange.remark;
  }


  /**
   * Choose an angle for the exchange's remark; when there is one, swap and note.
   * @param {{ id: string, remark: string }} exchange
   * @param {number} since    take time the remark ended
   * @param {number} [least]  see readRequest; by default the remark is read whole
   * @returns {{ swap: TakeSwap, note: Note } | null}
   */
  function choose(exchange, since, least = Infinity) {
    lastChooser = exchange.id;
    const t0 = performance.now();
    const match = readRequest(requestRemark(exchange), currentBrief, currentPointIndex, least);
    return match ? makeSwap(exchange, match, since, t0) : null;
  }

  /**
   * Take an exchange's swap, its note and its shown reply back: the brief is
   * again as it was before that swap (D-79).
   * @param {string} exchangeId
   * @param {Choice} choice
   */
  function takeBack(exchangeId, choice) {
    const drop = (list) => {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].exchangeId === exchangeId) list.splice(i, 1);
    };
    drop(swaps);
    drop(notes);
    drop(replies);
    replyAsk.set(exchangeId, (replyAsk.get(exchangeId) ?? 0) + 1);
    currentBrief = choice.base;
    if (follower) follower.setBrief(choice.base);
    choice.swap = null;
    choice.note = null;
  }

  /**
   * Late correction (D-79): the remark of an exchange that has chosen changed
   * inside its correction time. Choose again from the state as it was before
   * this exchange's own swap.
   * @param {import('./wake-tracker.js').TrackerExchange} exchange
   * @returns {boolean} true when the choice changed
   */
  function correct(exchange) {
    const choice = choices.get(exchange.id);
    // A newer exchange has chosen since: a late result for an older one never touches it.
    if (!choice || lastChooser !== exchange.id) return false;
    // Once the person has answered the proposal, a rewrite changes nothing.
    const answered = offerOf(exchange.id);
    if (answered && (answered.proposal.status === 'accepted' || answered.proposal.status === 'kept-old')) return false;
    const t0 = performance.now();
    const match = readRequest(requestRemark(exchange), choice.base, choice.baseIndex, choice.least);
    const standing = choice.swap;
    if (!match && !standing) return trialChanged(exchange, choice);
    if (match && standing && match.label === standing.to.label) {
      // Same intent, corrected spelling/punctuation: exact quote must still
      // become final, without another swap, note or reply.
      const reconciled=applySwap(choice.base,match,{exchangeId:exchange.id}).swap;
      standing.note=reconciled.note;
      if(reconciled.requestedOver)standing.requestedOver=reconciled.requestedOver;
      else delete standing.requestedOver;
      if(choice.note){
        choice.note.rawCorrection=exchange.remark;
        choice.note.text=reconciled.note;
        choice.note.over=reconciled.requestedOver ?? standing.from.label;
        if(reconciled.requestedOver && reconciled.requestedOver!==standing.from.label)choice.note.appliedFrom=standing.from.label;
        else delete choice.note.appliedFrom;
      }
      return false;
    }
    if (standing) takeBack(exchange.id, choice);
    if (!match) {
      onEvent({ type: 'swap-undone', exchangeId: exchange.id });
      // The rewritten remark may ask for a trial instead.
      nothingChanged(exchange, choice.base, choice.baseIndex, clock.now(), false);
      return true;
    }
    // The remark now asks for an angle: a proposal read from its earlier words is taken back.
    withdraw(exchange.id);
    Object.assign(choice, makeSwap(exchange, match, clock.now(), t0, Boolean(standing)));
    return true;
  }

  // ---- experiments: the proposal (D-58, D-61) ----

  /**
   * YAP offers a trial for an exchange's remark: one `experiment-proposed`
   * event. Nothing is accepted or saved by it (D-60). A proposal that replaces
   * an unanswered one of the same exchange keeps its id and carries
   * `corrected: true` (D-79).
   * @param {{ id: string, remark: string }} exchange
   * @param {import('./experiments.js').Proposal} proposal
   * @param {number} since  take time the remark ended
   * @param {number} t0     performance.now() when the reading started
   */
  function propose(exchange, proposal, since, t0) {
    const at = clock.now();
    const latencySec = (at - since) + (clock.isManual ? (performance.now() - t0) / 1000 : 0);
    const source = tokensOf(exchange.remark);
    let offer = offerOf(exchange.id);
    const corrected = offer !== null && offer.proposal.status === 'proposed';
    if (offer) {
      Object.assign(offer, { proposal, at, source, said: false });
    } else {
      offer = { proposal, exchangeId: exchange.id, at, source, said: false };
      offers.push(offer);
    }
    onEvent({ type: 'experiment-proposed', proposal: { ...proposal }, exchangeId: exchange.id, at, latencySec, ...(corrected ? { corrected: /** @type {true} */ (true) } : {}) });
  }

  /**
   * An unanswered proposal is taken back: Chrome rewrote the remark it was read
   * from into something that asks for no trial. It can no longer be answered.
   * @param {string} exchangeId
   */
  function withdraw(exchangeId) {
    const offer = offerOf(exchangeId);
    if (!offer || offer.proposal.status !== 'proposed') return;
    offer.proposal = { ...offer.proposal, status: 'withdrawn' };
    onEvent({ type: 'experiment-withdrawn', proposalId: offer.proposal.id, exchangeId, at: clock.now() });
  }

  /** One `heard` event: what was heard and why nothing changed. */
  function sayHeard(exchangeId, remark, brief, pointIndex) {
    const reason = explainNoSwap(remark, brief, { currentPointIndex: pointIndex }) ?? 'not-understood';
    /** @type {Heard} */
    const event = { type: 'heard', exchangeId, remark, reason, line: heardLine(remark) };
    heard.push(event);
    onEvent(event);
  }

  /**
   * Read a remark the matcher made no swap from as a request for a trial
   * (D-61). The local reader first: no network, so the proposal shows at once.
   * A model is asked only when the caller passed `ask`, the reader read nothing,
   * the remark holds a trial word and is no longer than a remark may be, once
   * per exchange (T-01.1-26); the take then waits for its answer, and a take
   * that has ended ignores it.
   * @param {{ id: string, remark: string }} exchange
   * @param {string} remark
   * @param {object} brief
   * @param {number} since  take time the remark ended
   * @returns {'proposed' | 'waiting' | null}
   */
  function offerTrial(exchange, remark, brief, since) {
    if (!trials) return null;
    const t0 = performance.now();
    const id = offerOf(exchange.id)?.proposal.id ?? `p${offers.length + 1}`;
    const local = proposeExperiment(remark, { brief, id, exchangeId: exchange.id });
    if (local) {
      propose(exchange, local, since, t0);
      return 'proposed';
    }
    if (waiting.has(exchange.id)) return 'waiting';
    if (!askModel || ending || askedModel.has(exchange.id) || !mayAsk(remark, maxRemarkWords)) return null;
    askedModel.add(exchange.id);
    waiting.set(exchange.id, { source: tokensOf(remark), stale: false, closed: null });
    const request = readExperimentRequest(remark, { brief, ask: askModel, id, exchangeId: exchange.id }).then((proposal) => {
      const wait = waiting.get(exchange.id);
      waiting.delete(exchange.id);
      if (ended || !wait) return;
      // Chrome rewrote the remark meanwhile and it gave a swap or a proposal: this answer is for words no longer there.
      const now = offerOf(exchange.id);
      if (swaps.some((s) => s.exchangeId === exchange.id) || (now && now.proposal.status !== 'withdrawn')) return;
      if (proposal && !wait.stale) propose({ id: exchange.id, remark }, proposal, since, t0);
      else if (wait.closed) sayHeard(exchange.id, wait.closed.remark, wait.closed.brief, wait.closed.pointIndex);
    });
    pending.push(request);
    return 'waiting';
  }

  /**
   * A changed remark the matcher makes no swap from, with no swap standing
   * (D-79): does it ask for another trial? Words added after the remark a
   * proposal was read from are an answer or narration, never a rewrite of the
   * request, so the proposal stands.
   * @param {import('./wake-tracker.js').TrackerExchange} exchange
   * @param {Choice} choice
   * @returns {boolean} true when the proposal changed
   */
  function trialChanged(exchange, choice) {
    if (!trials) return false;
    const tokens = tokensOf(exchange.remark);
    const wait = waiting.get(exchange.id);
    if (wait && !startsWith(tokens, wait.source)) wait.stale = true;
    const offer = offerOf(exchange.id);
    if (!offer || offer.proposal.status === 'withdrawn') {
      return offerTrial(exchange, String(exchange.remark ?? '').trim(), choice.base, clock.now()) === 'proposed';
    }
    if (startsWith(tokens, offer.source)) return false;
    const t0 = performance.now();
    const next = proposeExperiment(exchange.remark, { brief: choice.base, id: offer.proposal.id, exchangeId: exchange.id });
    if (!next) {
      withdraw(exchange.id);
      return true;
    }
    if (next.from === offer.proposal.from && next.to === offer.proposal.to && next.category === offer.proposal.category) {
      offer.source = tokens;
      return false;
    }
    propose(exchange, next, clock.now(), t0);
    return true;
  }

  /**
   * An exchange has no swap standing (REMARK-02, D-82; EXP-01). This is the one
   * place that decides what such an exchange emits, with one caller per path at
   * the close (and, on the results path, one when the remark is complete, so a
   * proposal shows in under a second, D-61):
   *   - a remark that reads as a request for a trial gives YAP's proposal;
   *   - an exchange that has a proposal says nothing more;
   *   - otherwise, at the close, one `heard` event says what was heard and why
   *     nothing changed. No note is saved and no cut changes.
   * An exchange with no remark word says nothing.
   * @param {{ id: string, remark: string }} exchange
   * @param {object} brief        the brief the remark was read against
   * @param {number} pointIndex   and the point that was showing
   * @param {number} [since]      take time the remark ended
   * @param {boolean} [closing]   the exchange is closing; false while it can still be corrected
   */
  function nothingChanged(exchange, brief, pointIndex, since = clock.now(), closing = true) {
    const remark = String(exchange.remark ?? '').trim();
    if (!remark) return;
    const offer = offerOf(exchange.id);
    if (offer && offer.proposal.status !== 'withdrawn') return;
    const trial = offerTrial(exchange, remark, brief, since);
    if (trial === 'proposed') return;
    if (trial === 'waiting') {
      const wait = /** @type {NonNullable<ReturnType<typeof waiting.get>>} */ (waiting.get(exchange.id));
      if (!ending) {
        if (closing) wait.closed = { remark, brief, pointIndex };
        return;
      }
      // The take is ending: the model's answer could not be used.
      waiting.delete(exchange.id);
    }
    if (closing) sayHeard(exchange.id, remark, brief, pointIndex);
  }

  /** The word path and the held key: the exchange is over, choose from its remark. */
  function onClose(exchange) {
    openExchange = null;
    let custody=null;
    if (exchange.trigger==='key' && keyBoundary && !exchange.words.some(w=>w.typed)) {
      const words=keyWords().map(w=>({...w,start:exchange.start,end:exchange.end}));
      exchange={...exchange,words,remark:words.map(w=>w.text).join(' ')};
      if(!words.length || words.some(w=>!w.final)) custody={exchange,boundary:keyBoundary,
        indices:new Set(words.map(w=>w.index)),length:words.length,expires:clock.now()+3};
    }
    exchanges.push(exchange);
    onEvent({ type: 'exchange-close', exchange, ...(custody ? {recognitionPending:true} : {}) });
    const lastWordEnd = exchange.words.length ? exchange.words[exchange.words.length - 1].end : exchange.end;
    const choice={base:currentBrief,baseIndex:currentPointIndex,least:Infinity,swap:null,note:null};
    const selected=choose(exchange,lastWordEnd);
    if(selected)Object.assign(choice,selected);
    else nothingChanged(exchange,currentBrief,currentPointIndex,lastWordEnd,!custody);
    if(custody){releasedKey=custody;choices.set(exchange.id,choice);}
  }

  /** @type {Map<string, string>} the detector's own exchange ids, mapped to the take's */
  const detectorIds = new Map();
  const detector = createExchangeDetector(detectorSettings, {
    onOpen: (x) => {
      const id = nextExchangeId();
      detectorIds.set(x.id, id);
      const exchange = { ...x, id };
      openExchange = { start: exchange.start };
      onEvent({ type: 'exchange-open', exchange });
    },
    onClose: (x) => {
      const id = detectorIds.get(x.id) ?? x.id;
      detectorIds.delete(x.id);
      onClose({ ...x, id });
    },
  });

  // The results path (WAKE-02): the angle is chosen when the remark is complete
  // (onAct), against the angle showing at that moment, measured from the
  // remark's last change; a changed remark is chosen again (onRevise, D-79);
  // the exchange closes later. An exchange Chrome takes back, or one with no
  // remark, is dropped (D-81): no swap, no note, no cut mark, and its final
  // words are ordinary speech again.
  const tracker = createWakeTracker({
    clock,
    settings: detectorSettings,
    nextId: nextExchangeId,
    blocked: () => detector.isOpen(),
    handlers: {
      onOpen: (exchange) => onEvent({ type: 'exchange-open', exchange }),
      onAct: (exchange) => {
        // A remark cut off while the person kept talking may end in narration: any leading stretch may be the request.
        const least = exchange.keptTalking ? 1 : exchange.words.length;
        /** @type {Choice} */
        const choice = { base: currentBrief, baseIndex: currentPointIndex, least, swap: null, note: null };
        choices.set(exchange.id, choice);
        const since = exchange.end ?? clock.now();
        Object.assign(choice, choose(exchange, since, exchange.keptTalking ? 1 : Infinity));
        // No swap: the remark may ask for a trial, and that proposal shows now, not at the close (D-61).
        if (!choice.swap) nothingChanged(exchange, choice.base, choice.baseIndex, since, false);
      },
      onRevise: correct,
      onClose: (x) => {
        // A spoken answer that came before the close is part of this talk with YAP.
        const exchange = withAnswerEnd(x);
        const choice = choices.get(exchange.id);
        ownedWords.delete(exchange.id);
        choices.delete(exchange.id);
        exchanges.push(exchange);
        onEvent({ type: 'exchange-close', exchange });
        if (!choice || !choice.swap) {
          nothingChanged(exchange, choice ? choice.base : currentBrief, choice ? choice.baseIndex : currentPointIndex, exchange.end ?? clock.now());
        }
      },
      onDrop: (exchange, reason) => {
        dropped.push({ ...exchange, reason });
        onEvent({ type: 'exchange-drop', exchangeId: exchange.id, reason });
        const words = ownedWords.get(exchange.id) || [];
        ownedWords.delete(exchange.id);
        choices.delete(exchange.id);
        for (const word of words) count(word);
      },
    },
  });

  function useResultsPath() {
    if (resultsPath) return;
    resultsPath = true;
    releaseHeld();
  }

  /** @param {any} event  a source event: replay.js SourceEvent, or the Web Speech source's session, results, stopped and hearing */
  /**
   * Chrome's results: is this final word, which a talk with YAP owns, said
   * after the remark that exchange's unanswered proposal was read from? Then
   * it may be the answer: the person answered before the exchange had closed,
   * and Chrome put the words into the same stretch of text.
   * @param {string} owner  the exchange that owns the word
   * @param {import('./replay.js').Word} word
   */
  function afterRequest(owner, word) {
    if (!trials) return false;
    let finals = ownedFinals.get(owner);
    if (!finals) {
      finals = [];
      ownedFinals.set(owner, finals);
    }
    const offer = offerOf(owner);
    const after = offer !== null && offer.proposal.status === 'proposed' && holdsRun(finals, offer.source);
    const token = normalizeToken(word.text);
    if (token) finals.push(token);
    return after;
  }

  function push(event) {
    if (ended) return;
    let inExchange = false;
    /** an owned final word said after the request a proposal was read from: a possible answer */
    let tail = false;
    if (event.type === 'end') ending = true;
    if (event.type === 'key' && event.down && !detector.isOpen()) {
      if(releasedKey)choices.delete(releasedKey.exchange.id);
      releasedKey=null;releasedWordOwner=null;
      keyBoundary = resultsPath ? { session: resultSession, tokens: resultTokens() } : null;
    }
    if (event.type === 'held-audio-end') {
      if(releasedKey && releasedKey.boundary.session===event.session)releasedKey.sealed=true;
    } else if (event.type === 'session') {
      useResultsPath();
      resultSession = event.session;
      resultText.clear();resultFinal.clear();resetInterim();
      if(releasedKey)choices.delete(releasedKey.exchange.id);
      releasedKey=null;releasedWordOwner=null;
      tracker.session(event.session, event.at);
    } else if (event.type === 'results') {
      useResultsPath();
      if (resultSession !== event.session) { resultSession = event.session; resultText.clear();resultFinal.clear();resetInterim(); }
      for (const index of resultText.keys()) if (index >= event.resultIndex) {resultText.delete(index);resultFinal.delete(index);}
      for (const result of event.results) {resultText.set(result.index, result.text);resultFinal.set(result.index,result.final);}
      reconcileReleased(event);
      tracker.results(event);
      feedInterim();
    } else if (event.type === 'stopped') {
      tracker.stop(event.at);
    } else if (event.type === 'interim') {
      onEvent({ type: 'interim', text: event.text, at: clock.now() });
    } else if (event.type === 'hearing') {
      hearing = event.hearing ?? null;
      onEvent({ type: 'hearing', hearing: event.hearing });
    } else if (resultsPath && event.type === 'word' && !detector.isOpen()) {
      // On Chrome's results a word never opens a wake exchange; the tracker says whose it is.
      // A word of an exchange still open is kept, in case that exchange is dropped.
      const owner = tracker.ownerOf(event.word);
      inExchange = owner !== null || Boolean(ownsReleased(event.word));
      if (owner !== null) tail = afterRequest(owner, event.word);
      if (owner !== null && tracker.isOpen(owner)) {
        if (!ownedWords.has(owner)) ownedWords.set(owner, []);
        /** @type {import('./replay.js').Word[]} */ (ownedWords.get(owner)).push(event.word);
      }
    } else if (!(resultsPath && event.type === 'word' && detector.isOpen() && !keyOwns(event.word))) {
      ({ inExchange } = detector.push(event, clock));
    }
    if ((event.type === 'key' && !event.down) || event.type === 'end') keyBoundary = null;
    if (event.type === 'word') {
      onEvent({ type: 'word', word: event.word, inExchange });
      if (resultsPath) {
        if (!inExchange) spoken(event.word);
        else if (tail) mayAnswer(event.word, false);
      } else {
        if (held && !(inExchange && openExchange && openExchange.start <= held.start + 1e-9)) releaseHeld();
        held = null;
        if (!inExchange) {
          if (wakeFirst.has(normalizeToken(event.word.text))) held = event.word;
          else spoken(event.word);
        }
      }
    } else if (event.type === 'key' || event.type === 'end') {
      if (held && !(inExchange && openExchange && openExchange.start <= held.start + 1e-9)) releaseHeld();
      held = null;
    }
    // A pause ends the words held as a possible answer: a yes, a no, or ordinary speech.
    if (event.type === 'pause') settleAnswer();
    const at = clock.now();
    if (event.type === 'word' || event.type === 'pause') {
      updatePace(at);
      feedDelivery(at);
    }
    if (event.type === 'end') {
      const endAt = Number.isFinite(event.at) ? Math.max(event.at, at) : at;
      tracker.end(endAt);
      // The end of the take is a pause too; an exchange still waiting for a model says what it heard.
      settleAnswer();
      for (const [id, wait] of waiting) {
        if (wait.closed) sayHeard(id, wait.closed.remark, wait.closed.brief, wait.closed.pointIndex);
      }
      waiting.clear();
      checkCue(endAt);
      const open = cueSpans[cueSpans.length - 1];
      if (open && open.to === null) open.to = endAt;
      // A delivery change that came due before the end is reported; the cue still showing ends with the take.
      if (deliveryStream) deliveryStream.current(endAt);
      endedAt = endAt;
      ended = true;
      for (const t of timers) clock.clearTimeout(t);
      return;
    }
    checkCue(at);
  }

  // The greeting this recording opens on (D-62): the brief's own, with every accepted trial applied.
  if (trials) {
    greeting = greetingFor(brief, []);
    /** @type {string | null} the trial that last changed it */
    let changedBy = null;
    acceptedBefore.forEach((experiment, i) => {
      const next = greetingFor(brief, acceptedBefore.slice(0, i + 1));
      if (next === greeting) return;
      greeting = next;
      changedBy = experiment.id ?? null;
    });
    if (greeting !== null) onEvent({ type: 'greeting', text: greeting, from: null, experimentId: changedBy, at: clock.now() });
  }
  if (follower) emitPoint(clock.now());
  else lightBeat(currentPointIndex, clock.now());
  if (cues && firstCue && typeof firstCue.text === 'string' && firstCue.text) {
    const at = clock.now();
    cues.offer({ kind: 'memory', text: firstCue.text }, at);
    checkCue(at);
    later(() => checkCue(clock.now()), cueCfg.memoryCueSec);
  }

  return {
    push,
    /** @param {number} [at] */
    end(at = clock.now()) {
      push({ type: 'end', at });
    },
    /** @param {number} index */
    setCurrentPointIndex(index) {
      if (ended || !Number.isInteger(index) || index < 0 || index >= currentBrief.points.length) return;
      currentPointIndex = index;
      follower?.setIndex?.(index);
      const at = clock.now(), pointId = currentBrief.points[index].id;
      pointTimeline.push({ pointId, index, at });
      onEvent({ type: 'point', pointId, index, at });
      lightBeat(index, at);
    },
    /**
     * Live refinement: change the words of ONE existing point's showing angle, from now on. The brief is replaced,
     * never edited in place, so every earlier brief (and the take's briefTimeline entry for it) keeps its original
     * words. Point ids, order, other points and every captured span are untouched. Returns the revision, or null
     * when nothing changed (unknown point, empty or identical words, take ended).
     * @param {{ pointId: string, text: string }} change
     */
    reviseWording({ pointId, text }) {
      if (ended || typeof text !== 'string' || !text.trim()) return null;
      const index = currentBrief.points.findIndex((p) => p.id === pointId);
      if (index < 0) return null;
      const point = currentBrief.points[index];
      const angle = point.angles.find((a) => a.id === point.active);
      if (!angle || angle.text === text) return null;
      const next = structuredClone(currentBrief);
      next.points[index].angles.find((a) => a.id === point.active).text = text;
      const revision = { pointId, index, angleId: angle.id, from: angle.text, to: text, at: clock.now() };
      currentBrief = next;
      if (follower) follower.setBrief(next);
      onEvent({ type: 'revision', revision });
      return revision;
    },
    /** Resolves when every fuller-reply request and every question to a model this take started has finished. */
    settled() {
      return Promise.all(pending.slice()).then(() => undefined);
    },
    /**
     * The person's answer to a proposal, given by call (a screen's button): the
     * same as the answer by voice. A proposal that already has an answer, or was
     * withdrawn, is left as it is, and so is every proposal once the take has
     * ended: null is returned and nothing is emitted. An id that is not a
     * proposal of this take throws UnknownProposalError.
     * @param {string} proposalId
     * @param {'accept' | 'keep-old'} answer
     * @param {{ trialLength?: number }} [options]  another trial length than the one proposed (1 to 10)
     * @returns {ExperimentEvent | null}  the `experiment-answered` event, or null when nothing changed
     */
    answerExperiment(proposalId, answer, { trialLength } = {}) {
      if (answer !== 'accept' && answer !== 'keep-old') {
        throw new TypeError(`answerExperiment takes "accept" or "keep-old" (got ${JSON.stringify(answer)})`);
      }
      const offer = offers.find((o) => o.proposal.id === proposalId);
      if (!offer) {
        const err = new Error(`No proposal ${JSON.stringify(proposalId)} in this take`);
        err.name = 'UnknownProposalError';
        throw err;
      }
      if (ended || offer.proposal.status !== 'proposed') return null;
      return answerOffer(offer, answer, 'call', trialLength);
    },
    state() {
      return {
        brief: currentBrief,
        currentPointIndex,
        exchanges: exchanges.slice(),
        dropped: dropped.slice(),
        swaps: swaps.slice(),
        activeSwap: swaps[swaps.length - 1] ?? null,
        notes: notes.slice(),
        heard: heard.slice(),
        proposals: offers.map((o) => ({ ...o.proposal })),
        experiments: acceptedNow.map((e) => structuredClone(e)),
        greeting,
        // The delivery stream's own place: never mixed into the story lists above and below (D-38).
        delivery: {
          current: deliveryShown ? { ...deliveryShown } : null,
          spans: deliveryStream
            ? deliveryStream.spans().map((s) => (s.to === null && endedAt !== null ? { ...s, to: endedAt } : s))
            : [],
        },
        replies: replies.slice(),
        pointTimeline: pointTimeline.slice(),
        cues: cueSpans.map((c) => ({ ...c })),
        hearing,
        ended,
      };
    },
  };
}

/**
 * The line for an exchange that changed nothing (REMARK-02, D-82). The remark
 * is plain text from the recogniser: print it as text, never as markup.
 * @param {string} remark  the remark as heard
 * @returns {string}  Heard "<remark>". Nothing changed.
 */
export function heardLine(remark) {
  return `Heard "${String(remark ?? '')}". Nothing changed.`;
}

/** One line per way a fuller-reply request can end (reply-status events). */
export const STATUS_LINE = Object.freeze({
  replied: 'Realtime: fuller reply in',
  unavailable: 'Realtime: off (no key on this machine); prepared reply kept',
  error: 'Realtime: the fuller reply did not come through; prepared reply kept',
  empty: 'Realtime: the fuller reply was empty; prepared reply kept',
  timeout: 'Realtime: the fuller reply took too long; prepared reply kept',
  closed: 'Realtime: the connection closed early; prepared reply kept',
});

/**
 * The angle a remark asks for. A remark is read whole. One that may hold
 * narration after the request (the person kept talking, D-80; or words came
 * after it was first complete, D-79) is read whole first and then, when the
 * whole asks for nothing, by its longest leading stretch that does, never
 * shorter than `least` words. Pure.
 * @param {string} remark
 * @param {object} brief
 * @param {number} pointIndex  the point showing
 * @param {number} least       the fewest leading words that may be read as the request; at or above the
 *   remark's length (the default for a settled remark) only the whole remark is read
 * @returns {import('./swap.js').Match | null}
 */
function readRequest(remark, brief, pointIndex, least) {
  const whole = matchAngle(remark, brief, { currentPointIndex: pointIndex });
  if (whole) return whole;
  const words = String(remark ?? '').split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= Math.max(1, least); n -= 1) {
    const match = matchAngle(words.slice(0, n).join(' '), brief, { currentPointIndex: pointIndex });
    if (match) return match;
  }
  return null;
}

/** A word as a spoken answer is compared: normalizeToken, apostrophes aside, so "lets" is "let's". */
const answerToken = (text) => normalizeToken(text).replace(/'/g, '');

/** A phrase of the answer lists, or the words said, as they are compared. */
const answerKey = (phrase) => String(phrase).split(/\s+/).map(answerToken).filter(Boolean).join(' ');

/** The words of a remark as they are compared, empties dropped. */
const tokensOf = (remark) => String(remark ?? '').split(/\s+/).map(normalizeToken).filter(Boolean);

/** Does `words` begin with every word of `lead`, in order? */
const startsWith = (words, lead) => lead.length > 0 && lead.length <= words.length && lead.every((w, i) => words[i] === w);

/** Do the words of `run` stand together, in order, somewhere in `words`? */
function holdsRun(words, run) {
  if (run.length === 0) return false;
  for (let i = 0; i + run.length <= words.length; i += 1) {
    if (run.every((w, k) => words[i + k] === w)) return true;
  }
  return false;
}

/**
 * May a model be asked about this remark (T-01.1-26)? Only when it holds one
 * of the trial words and is no longer than a remark may be.
 * @param {string} remark
 * @param {number} maxWords
 */
function mayAsk(remark, maxWords) {
  const words = tokensOf(remark).map((w) => w.replace(/^'+|'+$/g, ''));
  return words.length <= maxWords && words.some((w) => EXPERIMENT_DEFAULTS.trialWords.includes(w));
}

function makeFollower(follow, brief) {
  if (!follow) return null;
  if (typeof follow === 'object' && typeof follow.onWord === 'function') return follow;
  return createPointFollower(brief, typeof follow === 'object' ? follow : {});
}

/** Pace settings from `true`, explicit options, or the person's memory. */
function paceOptionsOf(pace) {
  if (!pace) return { enabled: false, cue: {} };
  const opts = typeof pace === 'object' ? pace : {};
  const memory = opts.memory || null;
  const enabled = !(memory && memory.paceCue === 'off') && opts.enabled !== false;
  const cue = {};
  if (Number.isFinite(opts.threshold)) cue.threshold = opts.threshold;
  else if (memory && memory.settings && Number.isFinite(memory.settings.paceThreshold)) cue.threshold = memory.settings.paceThreshold;
  return { enabled, cue };
}
