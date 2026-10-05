// The page's one way to ask YAP's model about an imported video (POST /api/model, task 'review').
//
// Only what src/engine/review-own.js built is sent: the question, the saved transcript and notes. The
// video is never read here. One question at a time. A slow or failed call ends in a plain, recoverable
// result and never throws, so the creator's own words keep working beside it.

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
