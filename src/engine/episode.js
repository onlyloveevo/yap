// Episode of beats: each beat holds its takes as a group with the chosen take
// marked, ticks itself by a rule or by the person, and reports done / current /
// ahead for the timeline (BEAT-01, BEAT-02, BEAT-03; D-15, D-16, D-17).
//
// Pure and browser-safe: imports nothing, never mutates its inputs, and every
// function returns a new episode object.

/**
 * @typedef {{ uncutRestarts: number, coverage: number, paceWpm: number | null }} TakeSummary
 * @typedef {{ id: string, n: number, recordingId: string, start: number, end: number, summary: TakeSummary | null }} Take
 * @typedef {{ ticked: boolean, by: 'auto' | 'person' | null, reason: string | null }} Tick
 * @typedef {{ id: string, pointId: string, title: string, takes: Take[], chosenTakeId: string | null, tick: Tick }} Beat
 * @typedef {{ beats: Beat[], currentBeatId: string }} Episode
 * @typedef {{ coverageMin?: number, paceBand?: [number, number] }} EpisodeSettings
 */

/** Seat defaults, one setting each (D-35). The band's top equals the default pace threshold. */
export const EPISODE_DEFAULTS = Object.freeze({
  coverageMin: 0.5,
  paceBand: Object.freeze([90, 170]),
});

/** Every word the person sees about a beat. About the take, never a grade of the person. */
export const COPY = Object.freeze({
  tickedAuto: 'ticked (auto)',
  tickedByYou: 'ticked by you',
  untickedByYou: 'unticked by you',
  leftRestart: 'left for you to tick (a restart is still uncut)',
  leftCoverage: 'left for you to tick (a talking point was not covered)',
  leftPaceHigh: 'left for you to tick (pace ran above your range)',
  leftPaceLow: 'left for you to tick (pace ran below your range)',
  leftPaceUnknown: 'left for you to tick (pace was not measured)',
  leftNoSummary: 'left for you to tick',
  done: 'done',
  current: 'current',
  ahead: 'ahead',
});

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

function settingsOf(settings) {
  return { ...EPISODE_DEFAULTS, ...(settings || {}) };
}

function findBeatIndex(ep, beatId) {
  const i = ep.beats.findIndex((b) => b.id === beatId);
  if (i === -1) throw namedError('UnknownBeatError', `No beat with id "${beatId}" in this episode`);
  return i;
}

function replaceBeat(ep, index, beat) {
  return { ...ep, beats: ep.beats.map((b, i) => (i === index ? beat : b)) };
}

/**
 * Make one beat per talking point of the brief. The first beat is current.
 * @param {{ points?: { id: string, title?: string }[] }} brief
 * @returns {Episode}
 */
export function createEpisode(brief) {
  const points = brief && Array.isArray(brief.points) ? brief.points : [];
  if (points.length === 0) {
    throw namedError('EmptyBriefError', 'createEpisode: the brief has no talking points, so there are no beats to record');
  }
  const beats = points.map((point, i) => ({
    id: `b${i + 1}`,
    pointId: point.id,
    title: point.title || point.id,
    takes: [],
    chosenTakeId: null,
    tick: { ticked: false, by: null, reason: null },
  }));
  return { beats, currentBeatId: beats[0].id };
}

/**
 * The auto-tick rule (D-16): no uncut restart, coverage at least coverageMin,
 * pace inside the inclusive band.
 * @param {TakeSummary | null} summary
 * @param {EpisodeSettings} [settings]
 * @returns {{ ticks: boolean, reason: string }}
 */
export function evaluateTake(summary, settings) {
  const s = settingsOf(settings);
  if (!summary) return { ticks: false, reason: COPY.leftNoSummary };
  if (summary.uncutRestarts > 0) return { ticks: false, reason: COPY.leftRestart };
  if (!(summary.coverage >= s.coverageMin)) return { ticks: false, reason: COPY.leftCoverage };
  const pace = summary.paceWpm;
  if (typeof pace !== 'number' || !Number.isFinite(pace)) return { ticks: false, reason: COPY.leftPaceUnknown };
  const [low, high] = s.paceBand;
  if (pace > high) return { ticks: false, reason: COPY.leftPaceHigh };
  if (pace < low) return { ticks: false, reason: COPY.leftPaceLow };
  return { ticks: true, reason: COPY.tickedAuto };
}

function autoTick(take, settings) {
  const r = evaluateTake(take.summary, settings);
  return { ticked: r.ticks, by: 'auto', reason: r.reason };
}

/**
 * Add a take to a beat and keep every earlier take. The new take becomes the
 * chosen one when it ticks, or when the beat has no chosen take that ticks;
 * then the beat's tick is re-evaluated from it. Otherwise the earlier chosen
 * take and its tick (including a person's tick or untick) stay as they are.
 * @param {Episode} ep
 * @param {string} beatId
 * @param {{ recordingId: string, start: number, end: number, summary?: TakeSummary | null }} takeInput
 * @param {EpisodeSettings} [settings]
 * @returns {Episode}
 */
export function addTake(ep, beatId, takeInput, settings) {
  const index = findBeatIndex(ep, beatId);
  const beat = ep.beats[index];
  const n = beat.takes.length + 1;
  const summary = takeInput.summary ? { ...takeInput.summary } : null;
  /** @type {Take} */
  const take = {
    id: `${beatId}-t${n}`,
    n,
    recordingId: takeInput.recordingId,
    start: takeInput.start,
    end: takeInput.end,
    summary,
  };
  const takes = [...beat.takes, take];
  const chosen = beat.takes.find((t) => t.id === beat.chosenTakeId);
  const chosenTicks = chosen ? evaluateTake(chosen.summary, settings).ticks : false;
  const newTicks = evaluateTake(summary, settings).ticks;
  if (newTicks || !chosenTicks) {
    return replaceBeat(ep, index, { ...beat, takes, chosenTakeId: take.id, tick: autoTick(take, settings) });
  }
  return replaceBeat(ep, index, { ...beat, takes });
}

/**
 * The person ticks or unticks a beat by hand. It holds until another take
 * becomes the chosen one.
 * @param {Episode} ep
 * @param {string} beatId
 * @param {boolean} ticked
 * @returns {Episode}
 */
export function tickBeat(ep, beatId, ticked) {
  const index = findBeatIndex(ep, beatId);
  const beat = ep.beats[index];
  if (ticked && beat.takes.length === 0) {
    throw namedError('NoTakeError', `Beat "${beatId}" has no take yet, so there is nothing to tick`);
  }
  const tick = { ticked: Boolean(ticked), by: 'person', reason: ticked ? COPY.tickedByYou : COPY.untickedByYou };
  return replaceBeat(ep, index, { ...beat, tick: /** @type {Tick} */ (tick) });
}

/**
 * Mark a take as the chosen one. Choosing the take already chosen changes
 * nothing (a person's tick holds); choosing another take re-evaluates the beat.
 * @param {Episode} ep
 * @param {string} beatId
 * @param {string} takeId
 * @param {EpisodeSettings} [settings]
 * @returns {Episode}
 */
export function chooseTake(ep, beatId, takeId, settings) {
  const index = findBeatIndex(ep, beatId);
  const beat = ep.beats[index];
  const take = beat.takes.find((t) => t.id === takeId);
  if (!take) throw namedError('UnknownTakeError', `Beat "${beatId}" has no take with id "${takeId}"`);
  if (beat.chosenTakeId === takeId) return replaceBeat(ep, index, { ...beat });
  return replaceBeat(ep, index, { ...beat, chosenTakeId: takeId, tick: autoTick(take, settings) });
}

/**
 * Make a beat the current one, for example to go back and record it again.
 * @param {Episode} ep
 * @param {string} beatId
 * @returns {Episode}
 */
export function goToBeat(ep, beatId) {
  findBeatIndex(ep, beatId);
  return { ...ep, currentBeatId: beatId };
}

/**
 * Timeline states: the current beat is 'current' (even when ticked), a ticked
 * beat is 'done', every other beat is still 'ahead' (to do).
 * @param {Episode} ep
 * @returns {{ beatId: string, title: string, state: 'done' | 'current' | 'ahead' }[]}
 */
export function progress(ep) {
  return ep.beats.map((beat) => {
    let state = COPY.ahead;
    if (beat.id === ep.currentBeatId) state = COPY.current;
    else if (beat.tick.ticked) state = COPY.done;
    return { beatId: beat.id, title: beat.title, state: /** @type {'done' | 'current' | 'ahead'} */ (state) };
  });
}
