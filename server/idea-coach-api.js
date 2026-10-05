// The idea coach's routes: the saved conversation of one idea.
//
//   GET  /api/app/idea-coach        { ideas: { <id>: { template, format, pick, thumb, experiments, screen } } }
//   GET  /api/app/idea-coach/<id>   { coaching }
//   POST /api/app/idea-coach/<id>   one event of src/engine/idea-coach.js's step()  ->  { coaching }
//   POST /api/app/idea-coach/<id>   { type: 'place', screen }  keeps the idea in Create, to open on that screen
//
// The conversation is kept beside the ideas, in idea-coach.json in the data
// folder, by idea id. An idea nobody has coached yet has no record: its
// coaching is made from its first thought on every read, and nothing is
// written until the first event.
//
// The engine decides what an event may change. This file adds what the idea
// itself must follow: the first answer moves the idea on to shaping, a proposed
// outline opens it on its draft, and accept writes the kept beats, the title,
// the format and the picked direction's words onto the idea.
//
// An idea in progress is kept in Create from its first answer on. Create lists
// the ideas whose state is 'thought' or 'saved', so an idea in progress is a
// 'thought', and the screen it opens on is kept here beside its conversation
// (`screen`: 'shaping', 'confirming', or '' for the first conversation).
// openStateOf() is what the page server reads to pick that screen. The first route
// is what the gallery and the beat list read: where each coached idea is
// headed, its format, and what the person picked and added. Beats are written by accept and by nothing
// else here, and never over beats the idea already has.
//
// Security notes: handleAppApi has already checked who asks. The id is checked
// against the id rule and is never part of a file name. A body is read through
// handleAppApi's reader, so it is a JSON object of at most 16 KB. Every text
// is made plain and capped by the engine before it is kept.

import path from 'node:path';

import { formatOf, keptBeatsOf, pickedWords, readCoaching, startCoaching, step } from '../src/engine/idea-coach.js';
import { isIdeaId } from '../src/node/idea-store.js';
import { readJson, resolveDataDir, writeJsonAtomic } from '../src/node/store.js';

/** The route's name under /api/app/. */
const ROUTE = 'idea-coach';
/** The one file conversations are kept in, inside the data folder. */
export const COACH_FILE = 'idea-coach.json';
/** The names of the confirm screen's first three points, as the idea keeps its ticks. */
const TICK_NAMES = Object.freeze(['opening', 'story', 'closing']);
const HAS_BEATS = 'This idea already has its beats.';
/** The screens an idea in progress can open on, by the state that names each; '' is the first conversation. */
const SCREENS = Object.freeze(['', 'shaping', 'confirming']);

/** Every saved conversation, by idea id. A file that cannot be read is no conversations, and the next event writes a whole one. */
function readAll(file) {
  let data;
  try {
    data = readJson(file, null);
  } catch {
    data = null;
  }
  const kept = data !== null && typeof data === 'object' && data.coaching !== null && typeof data.coaching === 'object' ? data.coaching : {};
  return { ...kept };
}

const screenOf = (kept) => (kept !== null && typeof kept === 'object' && SCREENS.includes(kept.screen) ? kept.screen : '');

/**
 * The state that picks an idea's screen. An idea kept in Create while it is in
 * progress opens where its conversation stands; any other idea opens by its own state.
 * @param {{ id: string, state: string }} idea
 */
export function openStateOf(idea, root, dataDir) {
  if (!idea || idea.state !== 'thought') return idea ? idea.state : '';
  return screenOf(readAll(path.join(resolveDataDir(root, dataDir), COACH_FILE))[idea.id]) || 'thought';
}

/**
 * The idea coach's routes. Gives false when the path is not one of them.
 * `ideas` opens the idea store and `now` is the clock a turn's time is read from.
 */
export async function handleIdeaCoachApi({ req, rest, method, answer, refuse, readJsonBody, ideas, root, dataDir, now }) {
  if (rest === ROUTE) {
    req.resume();
    if (method !== 'GET') {
      refuse(405, 'Method not allowed.', { Allow: 'GET' });
      return true;
    }
    const ideasById = {};
    for (const [id, kept] of Object.entries(readAll(path.join(resolveDataDir(root, dataDir), COACH_FILE)))) {
      const coaching = isIdeaId(id) ? readCoaching(kept) : null;
      if (coaching) ideasById[id] = { template: coaching.template, format: coaching.format, pick: coaching.pick, thumb: pickedWords(coaching), experiments: coaching.experiments, screen: screenOf(kept) };
    }
    answer(200, { ideas: ideasById });
    return true;
  }
  if (typeof rest !== 'string' || !rest.startsWith(`${ROUTE}/`)) return false;
  const id = rest.slice(ROUTE.length + 1);
  if (id.includes('/')) return false;
  if (method !== 'GET' && method !== 'POST') {
    req.resume();
    refuse(405, 'Method not allowed.', { Allow: 'GET, POST' });
    return true;
  }
  if (!isIdeaId(id)) {
    req.resume();
    refuse(400, 'An idea id is 1 to 64 lower-case letters, digits and hyphens.');
    return true;
  }
  const store = ideas();
  const idea = store.load(id);
  if (!idea) {
    req.resume();
    refuse(404, 'No idea has that id.');
    return true;
  }
  const file = path.join(resolveDataDir(root, dataDir), COACH_FILE);
  const all = readAll(file);
  const coaching = readCoaching(all[id]) || startCoaching(idea);

  if (method === 'GET') {
    answer(200, { coaching });
    return true;
  }

  const body = await readJsonBody();
  if (body === null) return true; // already refused
  const at = (typeof now === 'function' ? now() : new Date()).toISOString();
  const event = { ...body, at };
  let current = coaching;
  /** Keep the idea in Create, to open on `screen`. Beats made already are never touched. */
  const keep = (screen, kept) => {
    if (idea.state !== 'saved' && idea.state !== 'thought') store.patch(id, { state: 'thought' });
    writeJsonAtomic(file, { version: 1, coaching: { ...all, [id]: { ...kept, screen } } });
  };

  if (event.type === 'place') {
    if (!SCREENS.includes(body.screen)) {
      refuse(400, 'That is not a screen of an idea.');
      return true;
    }
    if (idea.state === 'saved') {
      answer(409, { error: HAS_BEATS, beats: true, coaching });
      return true;
    }
    keep(body.screen, coaching);
    answer(200, { coaching });
    return true;
  }

  if (event.type === 'accept') {
    // Beats made anywhere else are the person's: accept never writes over them.
    if (idea.keptBeats.length > 0 || idea.state === 'saved') {
      answer(409, { error: HAS_BEATS, beats: true, coaching });
      return true;
    }
    // The outline as the person last saw it is taken with the accept, in the same step.
    if (body.outline !== undefined) {
      const edited = step(current, { type: 'edit', rev: body.rev, outline: body.outline, at });
      if (!edited.ok) {
        answer(edited.status, { error: edited.error, coaching });
        return true;
      }
      current = edited.coaching;
      event.rev = current.rev;
    }
  }

  const result = step(current, event);
  if (!result.ok) {
    answer(result.status, { error: result.error, coaching });
    return true;
  }
  const next = result.coaching;

  let screen = screenOf(all[id]);
  try {
    if (next.state === 'accepted') {
      const ticks = { 'outline-edited': true };
      next.outline.beats.slice(0, TICK_NAMES.length).forEach((beat, i) => { ticks[TICK_NAMES[i]] = beat.keep !== false; });
      store.patch(id, { state: 'saved', format: formatOf(next.outline.format).name, keptBeats: keptBeatsOf(next.outline), thumb: pickedWords(next), ticks, ...(next.outline.title ? { rename: next.outline.title } : {}) });
    } else if (idea.state !== 'saved') {
      // Where the idea opens now, then where this change leaves it: a draft has its own screen, and the first answer moves on to shaping.
      const at = idea.state === 'thought' ? screen : SCREENS.includes(idea.state) ? idea.state : '';
      screen = next.state === 'proposed' && coaching.state === 'asking' ? 'confirming' : event.type === 'say' && at === '' ? 'shaping' : at;
      // Past its first conversation an idea is kept in Create, so it can always be found again.
      if (screen !== '' && idea.state !== 'thought') store.patch(id, { state: 'thought' });
    }
  } catch (err) {
    if (!err || err.name !== 'InvalidIdeaError') throw err;
    answer(400, { error: err.message, coaching });
    return true;
  }
  writeJsonAtomic(file, { version: 1, coaching: { ...all, [id]: { ...next, ...(screen ? { screen } : {}) } } });
  answer(200, { coaching: next });
  return true;
}
