// The page's one way to ask YAP's model about an imported video (POST /api/model, task 'review').
//
// Only what src/engine/review-own.js built is sent: the question, the saved transcript and notes. The
// video is never read here. One question at a time. A slow or failed call ends in a plain, recoverable
// result and never throws, so the creator's own words keep working beside it.

import { buildReviewRequest, checkReviewReply, saysWhatItLacks } from '../../src/engine/review-own.js';
import { answerFromFacts } from '../../src/engine/review.js';

export const ASK_TIMEOUT_MS = 50000;

let asking = false;

/** True while a question is out. A second press does nothing. */
export const isAsking = () => asking;

const REFUSALS = {
  400: 'YAP could not read that question. Nothing was answered.',
  403: 'This page cannot ask the model from here. Open YAP from its own address and try again.',
  405: 'The model route did not accept that. Nothing was answered.',
  413: 'The saved words are too long to send in one question. Nothing was answered.',
};

/**
 * @param {object} payload from buildReviewRequest
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, source: string, text: string } | { ok: false, kind: string, message: string }>}
 */
export async function askModel(payload, { fetchImpl = globalThis.fetch, timeoutMs = ASK_TIMEOUT_MS } = {}) {
  if (asking) return { ok: false, kind: 'busy', message: 'A question is already being answered. Wait for it to finish.' };
  if (typeof fetchImpl !== 'function') return { ok: false, kind: 'offline', message: 'This browser cannot reach YAP\'s model route.' };
  asking = true;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, kind: 'refused', message: REFUSALS[res.status] || 'YAP\'s model route had a problem. Nothing was answered.' };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, kind: 'unreadable', message: 'The model route sent back something YAP could not read. Nothing was saved.' };
    }
    if (!data || typeof data.text !== 'string' || !data.text.trim()) {
      return {
        ok: false,
        kind: 'unavailable',
        message: 'No model answered. Either none is set up on this machine (Claude Code signed in, or an OpenAI key), or it failed or ran out of time. Your transcript and notes are safe. Try again.',
      };
    }
    return { ok: true, source: typeof data.source === 'string' ? data.source : '', text: data.text };
  } catch {
    return timedOut
      ? { ok: false, kind: 'timeout', message: 'The model took too long, so the question was stopped. Your transcript and notes are safe. Try again.' }
      : { ok: false, kind: 'offline', message: 'YAP could not reach its model route. Your transcript and notes are safe. Try again.' };
  } finally {
    clearTimeout(timer);
    asking = false;
  }
}

const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  flask: svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.800 3h10.400a2 2 0 0 0 1.800-3l-5-9V3"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  cross: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

/**
 * What a person can do with an experiment in Review. Try this saves it as the lesson carried into
 * their next video. When another lesson is already carried it asks before replacing it, and once
 * this one is carried it says so. Adjust and Dismiss show when the page gives them something to do.
 *
 * @param {Element} container
 * @param {{ store: ReturnType<import('./return-model.js').lessonStore>, lesson: { text: string, source: { id: string, title: string } }, carries: (kept: object | null, lesson: object) => boolean, onChange?: () => void, onAdjust?: () => void, onDismiss?: () => void }} options
 */
export async function mountLessonAction(container, { store, lesson, carries, onChange = () => {}, onAdjust, onDismiss }) {
  const document = container.ownerDocument;
  const make = (tag, className, text, hook) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    node.dataset.testid = hook;
    if (tag === 'button') node.type = 'button';
    return node;
  };
  async function accept() {
    try {
      await store.accept(lesson);
      onChange();
      await draw();
    } catch (e) {
      await draw(false, `That was not saved: ${e && e.message ? e.message : 'try again'}.`);
    }
  }
  async function draw(asking = false, trouble = '') {
    const kept = await store.read().catch(() => null);
    container.replaceChildren();
    container.classList.add('lesson-action');
    if (carries(kept, lesson)) {
      container.append(make('p', 'lesson-on', 'Trying this in your next video', 'lesson-accepted'));
    } else if (asking && kept) {
      const replace = make('button', 'lesson-use', 'Replace it', 'lesson-replace');
      const keep = make('button', 'lesson-keep', 'Keep the first', 'lesson-keep');
      replace.addEventListener('click', accept);
      keep.addEventListener('click', () => draw());
      const row = document.createElement('div');
      row.className = 'lesson-row';
      row.append(replace, keep);
      container.append(make('p', 'lesson-ask', `Your next video already carries “${kept.text}”. Replace it?`, 'lesson-replace-ask'), row);
    } else {
      const use = make('button', 'lesson-use', 'Try this', 'use-lesson');
      use.insertAdjacentHTML('afterbegin', ICON.flask);
      use.addEventListener('click', () => (kept ? draw(true) : accept()));
      const row = document.createElement('div');
      row.className = 'lesson-row';
      row.append(use);
      for (const [label, hook, icon, action] of [['Adjust', 'adjust-lesson', ICON.sliders, onAdjust], ['Dismiss', 'dismiss-lesson', ICON.cross, onDismiss]]) {
        if (typeof action !== 'function') continue;
        const button = make('button', 'lesson-keep', label, hook);
        button.insertAdjacentHTML('afterbegin', icon);
        button.addEventListener('click', action);
        row.append(button);
      }
      container.append(row);
    }
    if (trouble) {
      const line = make('p', 'lesson-trouble', trouble, 'lesson-trouble');
      line.setAttribute('role', 'alert');
      container.append(line);
    }
  }
  await draw();
}

/**
 * Answer a typed question about a review YAP measured itself: the sample review, or a take recorded in
 * YAP. The model on this machine is asked first (task 'review-measured'), with the video's numbers, its
 * words and what YAP measured, and nothing else. Its reply is shown only when it states no number the
 * review does not hold and answers with what it has. When no model answers, or its reply talks about
 * what it was not given, the answer is read from the measured facts themselves.
 *
 * @param {{ question: string, evidence: { transcript: string, notes: { time: number, text: string }[] }, review: object, askImpl?: typeof askModel }} input
 * @returns {Promise<{ text: string, suggestion: string, from: 'model' | 'facts' }>}
 */
export async function answerQuestion({ question, evidence, review, askImpl = askModel }) {
  const fromFacts = () => ({ text: answerFromFacts(review, question), suggestion: '', from: /** @type {const} */ ('facts') });
  const built = buildReviewRequest({ transcript: { sourceType: 'creator-supplied', text: evidence?.transcript || '' }, notes: evidence?.notes || [] }, question);
  if (!built.ok) return fromFacts();
  const payload = { ...built.payload, task: 'review-measured' };
  const result = await askImpl(payload);
  if (!result.ok) return fromFacts();
  const checked = checkReviewReply(result.text, { transcript: payload.transcript, notes: payload.notes, question: payload.question });
  if (!checked.ok || saysWhatItLacks(`${checked.answer.text} ${checked.answer.suggestion}`)) return fromFacts();
  const plain = (text) => text.replace(/\s+[\u2014\u2013]\s+/g, ', ');
  return { text: plain(checked.answer.text), suggestion: plain(checked.answer.suggestion), from: 'model' };
}
