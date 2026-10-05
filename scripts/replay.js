#!/usr/bin/env node
// The one replay command (D-02). Replays a labelled sample through the whole
// loop, headless: the live take with its Hey YAP exchange, the lit talking
// point and cues, the rough cut, the beats, Return, YAP's bet, take 2, and the
// bet checked against take 2's real restart count.
//
// The bundled sample in sample/ is the coffee loop (D-58, D-64, D-95): the tea
// greeting, "Hey YAP, let's try 'Grab a coffee' instead of 'Grab a tea.'",
// YAP's proposal in under 1 s, the spoken yes, the trial saved, the delivery
// cue of each beat, the rough cut with dead air, the review moments, the
// opening question of the next recording, and take 2 on the coffee greeting.
//
//   node scripts/replay.js [--fast | --speed N] [--data-dir DIR] [--sample-dir DIR] [--realtime]
//   node scripts/replay.js [--fast] --transcript <words.json> --brief <brief.json>   (tracer form: live part only)
//
// --sample-dir names the sample folder to play, inside the app folder; the
// default is the bundled sample in sample/. The Phase 1 takes (the swap from
// tips to story in under 1 s, the kept note, take 2's first cue) are kept in
// test/fixtures/angle-sample:
//   node scripts/replay.js --fast --sample-dir test/fixtures/angle-sample
//
// Phase 1.1 (D-95): a sample folder may hold a setup.json, which names the
// delivery cue of each beat: { "deliveryCues": [{ "kind": "slow-down", "beat": 1 }] }.
// The replay then also prints the delivery cues, the review moments with its
// stated answers, and what take 1 carries into take 2. The trials the person
// said yes to (experiments.json) and one recording per take (recordings/) are
// kept in the data folder beside memory.json. Every run starts fresh: it clears
// what it writes, inside the data folder only. A sample with no setup.json
// prints what it printed in Phase 1.
//
// Real speed is the default. Without --realtime the network is never touched
// and OPENAI_API_KEY is never read; with it, the key stays in this process and
// only a short-lived secret travels (D-13, Q5).

import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createManualClock, createRealClock } from '../src/engine/clock.js';
import { createReplaySource } from '../src/engine/replay.js';
import { createLiveTake } from '../src/engine/loop.js';
import { COPY as SWAP_COPY } from '../src/engine/swap.js';
import { parseBrief } from '../src/engine/brief.js';
import { createEpisode } from '../src/engine/episode.js';
import { emptyMemory } from '../src/engine/memory.js';
import { runSampleLoop, deliveryFromSetup } from '../src/engine/session.js';
import { createBrowserConnect } from '../src/engine/realtime.js';
import { loadSample, resolveSampleDir } from '../src/node/sample-files.js';
import { resolveDataDir, writeJsonAtomic, appendJsonl } from '../src/node/store.js';
import { createTrialStore } from '../src/node/trial-store.js';
import { createRecordingStore } from '../src/node/recording-store.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every user-facing string this command prints. */
export const COPY = Object.freeze({
  usage:
    'Usage: node scripts/replay.js [--fast | --speed N] [--data-dir DIR] [--sample-dir DIR] [--realtime]\n' +
    '       node scripts/replay.js [--fast] --transcript <words.json> --brief <brief.json>',
  // The seconds in these three lines are worked out from the loaded takes (see replayTimes), never written here.
  realSpeed: 'Replaying the sample loop at real speed: about {seconds} s (take 1 is {take1} s, take 2 is {take2} s). Pass --fast to skip the waiting.',
  otherSpeed: 'Replaying the sample loop at {speed}x speed: about {seconds} s. Pass --fast to skip the waiting.',
  fastSpeed: 'Replaying the sample loop with no waiting (--fast). Leave out --fast to watch it at real speed (about {seconds} s).',
  realtimeOff: 'Realtime: off (pass --realtime to try it with your own OPENAI_API_KEY)',
  realtimeOn: 'Realtime: on; a short-lived secret is minted from your OPENAI_API_KEY, which is never printed or stored',
  realtimeNoWs: 'Realtime: needs Node 22 or Chrome here; prepared reply kept',
  saved: 'Saved: {memory} (kept notes only) and {log} (YAP\'s bets and their results)',
  savedCarry: 'Saved: {memory} (kept notes and the cues you kept) and {log} (YAP\'s bets and their results)',
  savedRecordings: 'Saved: {files} (one recording for each take)',
  savedTrials: '{line} and {file} (the trials you said yes to)',
  exchange: 'Hey YAP at {start} s: "{remark}"',
  swap: 'Swap: {from} -> {to} in {latency} s ({verdict})',
  underOne: 'under 1 s',
  overOne: 'over 1 s',
  reply: SWAP_COPY.preparedReplyLabel + ': {reply}',
  error: 'replay: {message}',
});

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => String(values[k]));

/**
 * @param {string[]} argv
 * @returns {{ fast: boolean, speed: number, dataDir: string, sampleDir: string, realtime: boolean, transcript: string, brief: string }}
 */
export function parseArgs(argv) {
  const args = { fast: false, speed: 1, dataDir: 'data/replay', sampleDir: 'sample', realtime: false, transcript: '', brief: '' };
  let sampleDirGiven = false;
  const value = (a, i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value. ${COPY.usage.split('\n')[0]}`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fast') args.fast = true;
    else if (a === '--realtime') args.realtime = true;
    else if (a === '--speed') {
      const n = Number(value(a, i));
      if (!Number.isFinite(n) || n <= 0) throw new Error('--speed needs a number above 0');
      args.speed = n;
      i += 1;
    } else if (a === '--data-dir') {
      args.dataDir = value(a, i);
      i += 1;
    } else if (a === '--sample-dir') {
      args.sampleDir = value(a, i);
      sampleDirGiven = true;
      i += 1;
    } else if (a === '--transcript' || a === '--brief') {
      args[a.slice(2)] = value(a, i);
      i += 1;
    } else throw new Error(`unknown option ${a}. ${COPY.usage.split('\n')[0]}`);
  }
  if (Boolean(args.transcript) !== Boolean(args.brief)) {
    throw new Error(`--transcript and --brief go together. ${COPY.usage.split('\n')[1].trim()}`);
  }
  if (sampleDirGiven && args.transcript) {
    throw new Error(`--sample-dir plays a sample folder and does not go with --transcript and --brief. ${COPY.usage.split('\n')[0]}`);
  }
  return args;
}

function readJsonFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${file} (${err.code || err.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message})`);
  }
}

function loadTranscript(file) {
  const t = readJsonFile(file);
  if (!t || !Array.isArray(t.words)) throw new Error(`${file} has no words array`);
  for (const [i, w] of t.words.entries()) {
    if (!w || typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      throw new Error(`${file}: word ${i} needs text, start and end`);
    }
  }
  return t;
}

function loadBrief(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${file} (${err.code || err.message})`);
  }
  return parseBrief(text, file);
}

/**
 * The tracer form: replay one transcript through the live take only.
 * @param {{ fast: boolean, transcript: string, brief: string }} args
 * @param {(line: string) => void} print
 */
export function runReplay(args, print) {
  const transcript = loadTranscript(args.transcript);
  const brief = loadBrief(args.brief);
  const clock = args.fast ? createManualClock() : createRealClock();
  const pendingReplies = new Map();

  return new Promise((resolve) => {
    const take = createLiveTake({
      brief,
      clock,
      onEvent(event) {
        if (event.type === 'exchange-close') {
          print(fill(COPY.exchange, { start: event.exchange.start.toFixed(2), remark: event.exchange.remark }));
        } else if (event.type === 'swap') {
          const s = event.swap;
          print(fill(COPY.swap, {
            from: s.from.label,
            to: s.to.label,
            latency: s.latencySec.toFixed(2),
            verdict: s.latencySec < 1 ? COPY.underOne : COPY.overOne,
          }));
          pendingReplies.set(s.exchangeId, s.reply.text);
        } else if (event.type === 'note') {
          print(event.note.text);
          if (pendingReplies.has(event.note.exchangeId)) {
            print(fill(COPY.reply, { reply: pendingReplies.get(event.note.exchangeId) }));
            pendingReplies.delete(event.note.exchangeId);
          }
        }
      },
    });
    const source = createReplaySource(transcript.words, { clock });
    source.start((event) => {
      take.push(event);
      if (event.type === 'end') {
        source.stop();
        resolve(take.state());
      }
    });
    if (clock.isManual) clock.runUntilIdle();
  });
}

/**
 * The Realtime hook, only when asked for. The key is read by mintClientSecret
 * inside this process and never leaves it; the page-style connect gets a
 * short-lived secret.
 * @param {(line: string) => void} print
 */
async function realtimeHook(print) {
  if (typeof globalThis.WebSocket !== 'function') {
    print(COPY.realtimeNoWs);
    return null;
  }
  const { mintClientSecret } = await import('../server/realtime-secret.js');
  print(COPY.realtimeOn);
  return {
    getSecret: ({ instructions }) => mintClientSecret({ instructions }),
    connect: createBrowserConnect(globalThis.WebSocket),
  };
}

/**
 * Check a sample's setup.json before a line is printed or a file is written.
 * A setup the loop cannot use throws one plain line that names the file and
 * the problem (an unknown cue, more than three cues, a beat that is not there).
 * @param {{ brief: any, setup: Record<string, any> | null }} sample
 * @param {string} [sampleDir]
 */
function checkSetup(sample, sampleDir) {
  if (!sample.setup) return;
  try {
    deliveryFromSetup(sample.setup, createEpisode(sample.brief).beats);
  } catch (err) {
    const file = path.relative(appRoot, path.join(resolveSampleDir(appRoot, sampleDir), 'setup.json'));
    throw new Error(`${file}: ${String(err && err.message).split('\n')[0]}`);
  }
}

/**
 * How long a replay of these two takes lasts, in whole seconds, for the first
 * line the command prints. The takes play one after the other with no wait
 * between them, so the replay lasts as long as the two together.
 *   take1, take2  each take, to the nearest second
 *   total         the two together: the sum of the two numbers above, so the line adds up
 *   rough         the same to the nearest ten seconds, for the --fast line, which only
 *                 points at the real-speed replay
 * @param {{ duration: number }} take1
 * @param {{ duration: number }} take2
 */
export function replayTimes(take1, take2) {
  const seconds = (take) => (take && Number.isFinite(take.duration) && take.duration > 0 ? take.duration : 0);
  const [a, b] = [seconds(take1), seconds(take2)];
  return { take1: Math.round(a), take2: Math.round(b), total: Math.round(a) + Math.round(b), rough: Math.round((a + b) / 10) * 10, exact: a + b };
}

/**
 * The whole sample loop, writing memory.json and predictions.jsonl in the data
 * dir, and beside them the trials the person said yes to (experiments.json,
 * written only after a yes) and one recording per take (recordings/).
 * The sample folder (args.sampleDir, default the bundled sample/) must be inside the app folder.
 * @param {{ fast: boolean, speed: number, dataDir: string, sampleDir?: string, realtime: boolean }} args
 * @param {(line: string) => void} print
 */
export async function runSample(args, print) {
  const dir = resolveDataDir(appRoot, args.dataDir);
  const sample = loadSample(appRoot, args.sampleDir);
  checkSetup(sample, args.sampleDir);
  const memoryFile = path.join(dir, 'memory.json');
  const logFile = path.join(dir, 'predictions.jsonl');
  const trialFile = path.join(dir, 'experiments.json');
  const recordingFile = (id) => path.join(dir, 'recordings', `${id}.json`);

  // The first line says how long the replay takes, from the takes just loaded: it holds for any sample folder.
  const times = replayTimes(sample.take1, sample.take2);
  if (args.fast) print(fill(COPY.fastSpeed, { seconds: times.rough }));
  else if (args.speed === 1) print(fill(COPY.realSpeed, { seconds: times.total, take1: times.take1, take2: times.take2 }));
  else print(fill(COPY.otherSpeed, { speed: args.speed, seconds: Math.round(times.exact / args.speed) }));
  const realtime = args.realtime ? await realtimeHook(print) : null;
  if (!args.realtime) print(COPY.realtimeOff);

  // Start fresh so every run is repeatable: the bet log, the trials and this
  // run's two recordings are cleared, inside the data folder and nowhere else.
  // A trial left by an earlier run would be counted again, so its file goes.
  mkdirSync(dir, { recursive: true });
  rmSync(logFile, { force: true });
  rmSync(trialFile, { force: true });
  for (const take of [sample.take1, sample.take2]) rmSync(recordingFile(take.takeId), { force: true });
  const memory = emptyMemory();
  writeJsonAtomic(memoryFile, memory);

  const report = await runSampleLoop({
    brief: sample.brief,
    take1: sample.take1,
    take2: sample.take2,
    memory,
    log: [],
    makeClock: args.fast ? () => createManualClock() : () => createRealClock(),
    settings: args.fast ? {} : { speed: args.speed },
    realtime,
    setup: sample.setup,
    trials: createTrialStore(dir, { appRoot }),
    recordings: createRecordingStore(dir, { appRoot }),
    onLine: print,
    onMemory: (m) => writeJsonAtomic(memoryFile, m),
    onLog: (entry) => appendJsonl(logFile, entry),
  });

  const inApp = (file) => path.relative(appRoot, file);
  const withSetup = sample.setup !== null;
  print(fill(withSetup ? COPY.savedCarry : COPY.saved, { memory: inApp(memoryFile), log: inApp(logFile) }));
  // The recordings are saved on every run; they are named when the sample has a
  // setup or a trial was saved, so a Phase 1 sample ends on its Phase 1 line (D-37).
  const trialSaved = existsSync(trialFile);
  if (withSetup || trialSaved) {
    const line = fill(COPY.savedRecordings, { files: report.recordings.map((r) => inApp(recordingFile(r.id))).join(' and ') });
    print(trialSaved ? fill(COPY.savedTrials, { line, file: inApp(trialFile) }) : line);
  }
  return report;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const print = (line) => process.stdout.write(line + '\n');
    if (args.transcript) await runReplay(args, print);
    else await runSample(args, print);
  } catch (err) {
    process.stderr.write(fill(COPY.error, { message: String(err && err.message).split('\n')[0] }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
