// YAP's engine debug page (D-01): temporary, unstyled, thrown away when the
// Phase 2 screens land. It drives the same engine the replay command drives:
//   "Run the sample take"  the whole loop on the bundled, labelled sample
//                          (real clock, or the manual clock with Fast ticked)
//   "Use the microphone"   a live take from Chrome's Web Speech on the sample brief
// The microphone take also shows (Phase 1.1; D-92, D-82, D-88):
//   Chrome's early text, marked as early, in one line that is replaced as it changes
//   the hearing line, when YAP cannot hear, with "Listen again" when it is offered
//   for each swap, the delay from the last remark word to the swap
//   Heard "<remark>". Nothing changed. when a request changes nothing
// The wording of every line is in ./lines.js. This page has no store, so the
// microphone take is given no trial and no delivery cues (D-60).
// The sample run plays the loop the replay command plays (D-95): it reads the
// sample's setup.json, and the trial the sample take says yes to is held in
// this page for that run only. The page writes nothing to disk, and its
// closing line says so. A setup.json that is missing or cannot be used gets
// one plain line, and the sample runs without a setup.
// Every line goes onto the page with textContent, never as HTML (T-01-19, T-01.1-30).
// No sound is ever played (D-09): the sample WAVs are only decoded for the
// silence and restart detectors.
// The page never sees the OpenAI key. For the Realtime upgrade it asks the
// localhost server (Plan 01-08) for a short-lived secret; without a key there
// the prepared reply stays. Only engine modules and sample files are loaded,
// no third-party script (01-04 threat note: the short-lived secret is
// readable by scripts on this page).

import { runSampleLoop, deliveryFromSetup } from '../src/engine/session.js';
import { createEpisode } from '../src/engine/episode.js';
import { createManualClock, createRealClock } from '../src/engine/clock.js';
import { parseWav, toMonoFloat } from '../src/engine/wav.js';
import { parseBrief } from '../src/engine/brief.js';
import { emptyMemory, firstCue } from '../src/engine/memory.js';
import { createLiveTake } from '../src/engine/loop.js';
import { createWebSpeechSource } from '../src/engine/webspeech.js';
import { createBrowserConnect, secretRequestBody } from '../src/engine/realtime.js';
import { lineForEvent, earlyLine, hearingLine } from './lines.js';

const logEl = /** @type {HTMLElement} */ (document.getElementById('log'));
const runButton = /** @type {HTMLButtonElement} */ (document.getElementById('run-sample'));
const fastBox = /** @type {HTMLInputElement} */ (document.getElementById('fast'));
const micButton = /** @type {HTMLButtonElement} */ (document.getElementById('use-mic'));
const stopButton = /** @type {HTMLButtonElement} */ (document.getElementById('stop-mic'));
// The microphone take's own places on the page. Only the microphone take uses them.
const hearingEl = /** @type {HTMLElement} */ (document.getElementById('hearing'));
const earlyEl = /** @type {HTMLElement} */ (document.getElementById('early'));
const listenAgainButton = /** @type {HTMLButtonElement} */ (document.getElementById('listen-again'));

const REALTIME_OFF = 'Realtime: off (no key on this machine); prepared reply kept';
const SECRET_ROUTE_FAILED = 'Realtime: off (the localhost server did not answer); prepared reply kept';

/** Memory and YAP's bet log live in this page only; nothing is written to disk from here. */
let memory = emptyMemory();
/** @type {any[]} */
const predictionLog = [];
let busy = false;

/** @param {string} line */
function log(line) {
  logEl.textContent += `${line}\n`;
}

/** The hearing line last put in the log, so a status that only begins to offer Listen again is not printed twice. */
let loggedHearing = '';

/**
 * Show how well YAP can hear (D-88): the status's line in its own place, once
 * in the log, and Listen again enabled only while the status offers it.
 * @param {{ status?: string, line?: string | null, listenAgain?: boolean } | null} hearing
 */
function showHearing(hearing) {
  const line = hearingLine(hearing);
  hearingEl.textContent = line;
  if (line && line !== loggedHearing) log(line);
  loggedHearing = line;
  listenAgainButton.disabled = !(hearing && hearing.listenAgain === true);
}

/**
 * Chrome's early text, marked as early (D-92). It replaces what was there.
 * @param {string} text  the early text, or '' to clear the line
 */
function showEarly(text) {
  earlyEl.textContent = earlyLine(text);
}

function setBusy(on) {
  busy = on;
  runButton.disabled = on;
  micButton.disabled = on;
}

/** @param {Response} r */
function okResponse(r) {
  if (!r.ok) throw new Error(`could not load ${r.url} (HTTP ${r.status})`);
  return r;
}

const asText = (r) => okResponse(r).text();
const asJson = (r) => okResponse(r).json();
const asBytes = (r) => okResponse(r).arrayBuffer().then((b) => new Uint8Array(b));

async function loadSampleFromServer() {
  const [briefText, words1, wav1, words2, wav2] = await Promise.all([
    fetch('../sample/brief.json').then(asText),
    fetch('../sample/take1.words.json').then(asJson),
    fetch('../sample/take1.wav').then(asBytes),
    fetch('../sample/take2.words.json').then(asJson),
    fetch('../sample/take2.wav').then(asBytes),
  ]);
  const take = (takeId, transcript, bytes) => {
    const wav = parseWav(bytes);
    return {
      takeId,
      label: typeof transcript.label === 'string' ? transcript.label : null,
      source: typeof transcript.source === 'string' ? transcript.source : null,
      words: transcript.words,
      pcm: { samples: toMonoFloat(wav), sampleRate: wav.sampleRate },
    };
  };
  return {
    brief: parseBrief(briefText, 'sample/brief.json'),
    take1: take('take1', words1, wav1),
    take2: take('take2', words2, wav2),
  };
}

/**
 * The sample's setup.json, checked the way the loop checks it. Never throws:
 * a setup that is missing, is not JSON or that the loop cannot use comes back
 * as no setup, with the reason in plain words.
 * @param {any} brief  the sample brief, whose beats the setup's cues are for
 * @returns {Promise<{ setup: any, problem: string | null }>}
 */
async function loadSetup(brief) {
  let setup;
  try {
    const r = await fetch('../sample/setup.json');
    if (!r.ok) return { setup: null, problem: r.status === 404 ? 'the file is not there' : `HTTP ${r.status}` };
    setup = JSON.parse(await r.text());
  } catch (err) {
    return { setup: null, problem: err instanceof SyntaxError ? 'it is not valid JSON' : 'it could not be loaded' };
  }
  try {
    deliveryFromSetup(setup, createEpisode(brief).beats);
  } catch (err) {
    return { setup: null, problem: String(err && err.message ? err.message : err).split('\n')[0] };
  }
  return { setup, problem: null };
}

/**
 * A holder for the trials of one sample run, in this page's memory only: the
 * loop reads it before each take and puts a spoken yes into it. Nothing is
 * written anywhere, and each sample run starts with an empty one.
 */
function pageTrials() {
  /** @type {any[]} */
  const held = [];
  return {
    list: () => structuredClone(held),
    save(trial) {
      const copy = structuredClone(trial);
      const at = held.findIndex((t) => t.id === copy.id);
      if (at === -1) held.push(copy);
      else held[at] = copy;
    },
  };
}

/**
 * Ask the localhost server for a short-lived Realtime secret. The body holds
 * facts only (the idea, the talking-point titles, the chosen angle's label and
 * its text); the server writes the instructions itself.
 */
async function postSecret(req) {
  const r = await fetch('/api/realtime/secret', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(secretRequestBody(req)),
  });
  if (!r.ok) return { available: false, routeFailed: true };
  const body = await r.json();
  return body && body.available === true && typeof body.value === 'string' ? body : { available: false };
}

/**
 * The Realtime hook, or null. The first request only tells whether a key is
 * set where the server runs; each swap then gets its own fresh secret, minted
 * for that swap's chosen angle, so it cannot have expired.
 */
async function realtimeHook() {
  if (typeof WebSocket !== 'function') {
    log('Realtime: needs Chrome here; prepared reply kept');
    return null;
  }
  let probe;
  try {
    probe = await postSecret();
  } catch {
    probe = { available: false, routeFailed: true };
  }
  if (!probe.available) {
    log(probe.routeFailed ? SECRET_ROUTE_FAILED : REALTIME_OFF);
    return null;
  }
  log('Realtime: on (a short-lived secret from the localhost server; the key stays on the server)');
  return {
    getSecret: (req) => postSecret(req).catch(() => ({ available: false })),
    connect: createBrowserConnect(WebSocket),
  };
}

async function runSample() {
  if (busy) return;
  setBusy(true);
  logEl.textContent = '';
  try {
    const fast = fastBox.checked;
    log(fast ? 'Sample loop, Fast: no waiting.' : 'Sample loop at real speed: about 50 s. Tick Fast to skip the waiting.');
    log(`Memory in this page: ${memory.notes.length} kept note(s).`);
    const sample = await loadSampleFromServer();
    const found = await loadSetup(sample.brief);
    if (found.problem) log(`Setup: sample/setup.json cannot be used (${found.problem}). Running the sample without a setup.`);
    const realtime = await realtimeHook();
    const report = await runSampleLoop({
      brief: sample.brief,
      take1: sample.take1,
      take2: sample.take2,
      memory,
      log: predictionLog,
      makeClock: fast ? () => createManualClock() : () => createRealClock(),
      realtime,
      setup: found.setup,
      trials: pageTrials(),
      onLine: log,
    });
    memory = report.ret.memory;
    predictionLog.push(...report.logEntries);
    log('Done. Memory and YAP\'s bets stay in this page until it is reloaded. A trial lasts for one sample run: the next run starts without it. This page wrote nothing to disk.');
  } catch (err) {
    log(`Error: ${err && err.message ? err.message : String(err)}`);
  } finally {
    setBusy(false);
  }
}

/** @type {null | { stop: () => void }} */
let micSession = null;

async function useMicrophone() {
  if (busy) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const clock = createRealClock();
  // The page is where the browser's `online` event is heard, for the retry after a lost connection (D-88).
  const source = createWebSpeechSource({ SpeechRecognition: Recognition, clock, onlineTarget: window });
  if (!source.supported) {
    // No speech recognition here: the source says so itself, in its one hearing event (D-88).
    loggedHearing = '';
    source.start((event) => {
      if (event.type === 'hearing') showHearing(event.hearing);
    });
    return;
  }
  setBusy(true);
  logEl.textContent = '';
  loggedHearing = '';
  showHearing(null);
  showEarly('');
  try {
    const briefText = await fetch('../sample/brief.json').then(asText);
    const brief = parseBrief(briefText, 'sample/brief.json');
    const titles = new Map(brief.points.map((p) => [p.id, p.title || p.id]));
    const realtime = await realtimeHook();
    const cue = firstCue(memory);
    log('Listening. Say "Hey YAP, ..." to talk to YAP; press Stop when the take is over.');
    const take = createLiveTake({
      brief,
      clock,
      follow: true,
      pace: { memory },
      firstCue: cue,
      realtime,
      onEvent(event) {
        if (event.type === 'interim') {
          showEarly(event.text);
          return;
        }
        if (event.type === 'hearing') {
          showHearing(event.hearing);
          return;
        }
        // A final word has arrived: the early text it came from is over.
        if (event.type === 'word') showEarly('');
        const line = lineForEvent(event, { titles });
        if (line !== null) log(line);
      },
    });
    // Every source event but `error` goes to the take, early text included: the
    // take is the one place that reads Chrome's words.
    source.start((event) => {
      if (event.type === 'error') {
        log(`Speech recognition: ${event.error}`);
        return;
      }
      take.push(event);
    });
    // Listen again belongs to this take's source, so its handler lives as long as the take does.
    const onListenAgain = () => source.listenAgain();
    listenAgainButton.addEventListener('click', onListenAgain);
    micSession = {
      stop() {
        source.stop();
        take.end();
        listenAgainButton.removeEventListener('click', onListenAgain);
        listenAgainButton.disabled = true;
        showEarly('');
        const st = take.state();
        log(`Take over: ${st.swaps.length} swap(s), ${st.notes.length} note(s) pending until Return.`);
      },
    };
    stopButton.disabled = false;
  } catch (err) {
    log(`Error: ${err && err.message ? err.message : String(err)}`);
    setBusy(false);
  }
}

function stopMicrophone() {
  if (!micSession) return;
  micSession.stop();
  micSession = null;
  stopButton.disabled = true;
  setBusy(false);
}

runButton.addEventListener('click', () => {
  runSample();
});
micButton.addEventListener('click', () => {
  useMicrophone();
});
stopButton.addEventListener('click', stopMicrophone);
