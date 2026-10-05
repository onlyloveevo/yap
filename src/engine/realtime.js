// The optional OpenAI Realtime upgrade (LIVE-05, D-12, D-13). Browser-safe:
// imports nothing from `node:`. The page never sees the person's API key: it
// gets a short-lived client secret from the localhost server
// (server/realtime-secret.js) through the injected getSecret(), and opens the
// Realtime socket through the injected connect(). Text output only: YAP never
// speaks, because audio would land in the recording (D-09). Every failure
// keeps the prepared reply; nothing here throws to its caller.

/**
 * @typedef {{ text: string, source: 'prepared' | 'realtime' }} Reply
 * @typedef {{ exchangeId: string, to: { label: string }, reply: Reply, note?: any,
 *             changed?: { pointId: string, fromAngleId: string, toAngleId: string }[] }} Swap
 * @typedef {{ idea: string, angleLabel: string, angleText: string, pointTitles: string[] }} SecretFields
 *   The bounded facts a secret request carries. Strings are never undefined or
 *   null; pointTitles holds at most 6 entries, in brief order.
 * @typedef {SecretFields & { instructions: string }} SecretRequest
 *   What getSecret is handed: the facts, and the instructions built from them.
 * @typedef {{ available: boolean, value?: string, expiresAt?: number, model?: string, error?: string }} SecretResult
 * @typedef {{ send(obj: object): void, close(): void, onMessage(h: (ev: any) => void): void,
 *             onClose(h: (info?: any) => void): void }} Transport
 * @typedef {{ setTimeout(cb: () => void, ms: number): any, clearTimeout(id: any): void }} Clock
 * @typedef {{ done: boolean, text: string, error: string | null }} AssemblerState
 */

/** D-12: the Realtime model. */
export const REALTIME_MODEL = 'gpt-realtime-2.1-mini';
/** The browser Realtime socket; the model goes in the query string. */
export const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

const SECRET_SECONDS = 120; // T-01-10: a minted secret expires after 2 minutes
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The one cut the engine and the localhost server both make. A non-string
 * gives an empty string; a string of at most `max` UTF-16 code units comes
 * back unchanged; a longer one comes back as its first `max` code units, minus
 * the last kept unit when that unit is a high surrogate. So a cut never ends
 * in half a surrogate pair (half an emoji). It does not repair a broken pair
 * that was already in the text.
 * @param {any} value
 * @param {number} max
 * @returns {string}
 */
export function safeCut(value, max) {
  if (typeof value !== 'string') return '';
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  if (value.length <= limit) return value;
  let end = limit;
  if (end > 0) {
    const last = value.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return value.slice(0, end);
}

function oneLine(value, max = 200) {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${safeCut(s, max - 1)}…` : s;
}

/**
 * Instructions for the Realtime session. The reply is a question or nudge for
 * the creator's chosen angle, in at most two short sentences, and never a grade.
 * @param {{ brief?: any, angle?: { label?: string, text?: string } | null }} [args]
 * @returns {string}
 */
export function buildInstructions({ brief, angle } = {}) {
  const lines = [
    "You are YAP, a quiet on-screen helper for a creator who is recording a video right now.",
    'The creator has just told you, mid-take, what they want to change. Your reply is shown silently on screen; it is never spoken.',
    "Reply in text only, in at most two short sentences: a question or nudge that helps the creator talk about their chosen angle in their own words.",
    'Never grade, score or rate the creator, their delivery or their idea, and never judge how they are doing.',
    'Do not repeat their remark back, and do not add lists, markdown or emoji.',
  ];
  const idea = oneLine(brief && brief.idea);
  if (idea) lines.push(`The video idea: ${idea}.`);
  const points = brief && Array.isArray(brief.points) ? brief.points : [];
  const titles = points.map((p) => oneLine(p && p.title, 120)).filter(Boolean);
  if (titles.length) lines.push(`The talking points: ${titles.join('; ')}.`);
  const label = oneLine(angle && angle.label, 120);
  if (label) lines.push(`The creator's chosen angle: ${label}.`);
  const text = oneLine(angle && angle.text, 200);
  if (text) lines.push(`That angle in their words: ${text}.`);
  return lines.join('\n');
}

/** A secret request names at most this many talking points. */
const MAX_POINT_TITLES = 6;

/**
 * The angle a swap chose: the one the swap's first changed point switched to
 * when the brief still holds it; else the first angle, in brief order, that
 * carries the swap's label; else none.
 * @param {any[]} points
 * @param {any} swap
 */
function chosenAngle(points, swap) {
  const anglesOf = (point) => (point && Array.isArray(point.angles) ? point.angles.filter((a) => a && typeof a === 'object') : []);
  const all = points.flatMap(anglesOf);
  const first = swap && Array.isArray(swap.changed) ? swap.changed[0] : null;
  const toId = first && first.toAngleId;
  if (toId !== undefined && toId !== null) {
    const point = points.find((p) => p && p.id === first.pointId);
    const byId = anglesOf(point).find((a) => a.id === toId) || all.find((a) => a.id === toId);
    if (byId) return byId;
  }
  const label = swap && swap.to && typeof swap.to.label === 'string' ? swap.to.label : '';
  if (label === '') return null;
  return all.find((a) => a.label === label) || null;
}

/**
 * The facts a secret request carries for one swap (LIVE-05, D-12): the idea,
 * the talking-point titles, the chosen angle's label and its text. Missing
 * input gives empty strings and an empty list.
 * @param {{ brief?: any, swap?: Swap | null }} [args]
 * @returns {SecretFields}
 */
export function secretRequestFields(args) {
  const { brief, swap } = args || {};
  const points = brief && Array.isArray(brief.points) ? brief.points : [];
  const angle = chosenAngle(points, swap);
  return {
    idea: oneLine(brief && brief.idea, 200),
    angleLabel: oneLine(swap && swap.to && swap.to.label, 120),
    angleText: oneLine(angle && angle.text, 200),
    pointTitles: points.map((p) => oneLine(p && p.title, 120)).filter(Boolean).slice(0, MAX_POINT_TITLES),
  };
}

/**
 * The body a page posts to the localhost server when it asks for a secret:
 * exactly the four facts, each bounded. Anything else in `req`, including
 * `instructions`, is left out: the server writes the instructions itself, so
 * a page cannot write, drop or reword YAP's rules (D-13).
 * @param {any} [req]
 * @returns {SecretFields}
 */
export function secretRequestBody(req) {
  const source = req && typeof req === 'object' ? req : {};
  const titles = Array.isArray(source.pointTitles) ? source.pointTitles : [];
  return {
    idea: oneLine(source.idea, 200),
    angleLabel: oneLine(source.angleLabel, 120),
    angleText: oneLine(source.angleText, 200),
    pointTitles: titles.map((t) => oneLine(t, 120)).filter(Boolean).slice(0, MAX_POINT_TITLES),
  };
}

/**
 * The instructions for a set of secret facts. The engine and the localhost
 * server both build them here, so the page path and the replay path mint the
 * same text. Missing or wrongly typed fields count as empty.
 * @param {any} [fields]
 * @returns {string}
 */
export function instructionsFromSecretFields(fields) {
  const f = secretRequestBody(fields);
  return buildInstructions({
    brief: { idea: f.idea, points: f.pointTitles.map((title) => ({ title })) },
    angle: { label: f.angleLabel, text: f.angleText },
  });
}

/**
 * The body of POST /v1/realtime/client_secrets: a text-only realtime session.
 * @param {{ instructions?: string, model?: string, seconds?: number }} [args]
 */
export function buildClientSecretRequest({ instructions, model = REALTIME_MODEL, seconds = SECRET_SECONDS } = {}) {
  return {
    expires_after: { anchor: 'created_at', seconds },
    session: {
      type: 'realtime',
      model,
      output_modalities: ['text'], // D-09: never audio
      instructions: typeof instructions === 'string' ? instructions : buildInstructions(),
    },
  };
}

/**
 * The two client events that send the person's remark and ask for a reply.
 * @param {string} remark
 */
export function remarkEvents(remark) {
  return [
    {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: String(remark ?? '') }] },
    },
    { type: 'response.create' },
  ];
}

const DELTA_TYPES = new Set(['response.output_text.delta', 'response.text.delta']);
const TEXT_DONE_TYPES = new Set(['response.output_text.done', 'response.text.done']);

/**
 * Assembles a reply from server events. Text is the deltas joined in arrival
 * order, NFC-normalised and trimmed only after joining (so a character split
 * across deltas comes out whole). A done event that carries full text wins;
 * anything after completion is ignored.
 */
export function createReplyAssembler() {
  let raw = '';
  let finalText = null;
  let done = false;
  let error = null;

  const state = () => ({
    done,
    text: (finalText !== null ? finalText : raw).normalize('NFC').trim(),
    error,
  });

  return {
    /** @param {any} event  @returns {AssemblerState} */
    feed(event) {
      if (done || !event || typeof event !== 'object') return state();
      const type = event.type;
      if (DELTA_TYPES.has(type)) {
        if (typeof event.delta === 'string') raw += event.delta;
      } else if (TEXT_DONE_TYPES.has(type)) {
        if (typeof event.text === 'string' && event.text.trim() !== '') finalText = event.text;
        done = true;
      } else if (type === 'response.done') {
        done = true;
      } else if (type === 'error') {
        const msg = event.error && typeof event.error.message === 'string' ? event.error.message : '';
        error = oneLine(msg) || 'Realtime error';
        done = true;
      }
      return state();
    },
  };
}

function safeCall(f, ...args) {
  if (typeof f !== 'function') return;
  try {
    f(...args);
  } catch {
    // a UI callback must never break the engine
  }
}

const STATUS = Object.freeze({
  unavailable: 'No fuller reply: no OpenAI key on this machine, so the prepared reply stays.',
  error: 'The fuller reply did not come through, so the prepared reply stays.',
  empty: 'The fuller reply was empty, so the prepared reply stays.',
  timeout: 'The fuller reply took too long, so the prepared reply stays.',
  closed: 'The Realtime connection closed early, so the prepared reply stays.',
  replied: 'Fuller reply in.',
});

/**
 * Ask OpenAI Realtime for a fuller text reply to a remark. Never throws.
 * onReply(reply, { exchangeId, current }) is called once with the fuller reply;
 * the caller applies it with applyFullerReply (which keeps it on its note when a
 * newer swap exists). Every other ending keeps the prepared reply.
 *
 * getSecret is handed the instructions and the four facts they were built
 * from. A caller that mints in-process uses the instructions; a page posts the
 * facts (secretRequestBody) and the server builds the same instructions.
 *
 * @param {{ swap: Swap, brief?: any, remark: string,
 *           getSecret: (req: SecretRequest) => Promise<SecretResult> | SecretResult,
 *           connect?: (opts: { url: string, protocols: string[] }) => Transport | Promise<Transport>,
 *           isCurrent?: (exchangeId: string) => boolean,
 *           onReply?: (reply: Reply, info: { exchangeId: string, current: boolean }) => void,
 *           onStatus?: (message: string) => void,
 *           clock?: Clock, timeoutSec?: number }} args
 * @returns {Promise<{ status: 'replied' | 'unavailable' | 'error' | 'empty' | 'timeout' | 'closed', reply?: Reply }>}
 */
export function requestFullerReply(args) {
  return new Promise((resolve) => {
    const {
      swap,
      brief,
      remark,
      getSecret,
      connect,
      isCurrent,
      onReply,
      onStatus,
      clock = globalThis,
      timeoutSec = 8,
    } = args || {};
    const exchangeId = swap && swap.exchangeId;
    let finished = false;
    let transport = null;
    let timer = null;

    const finish = (status, reply) => {
      if (finished) return;
      finished = true;
      try {
        if (timer !== null && clock && typeof clock.clearTimeout === 'function') clock.clearTimeout(timer);
      } catch {
        // ignore
      }
      if (transport) {
        try {
          transport.close();
        } catch {
          // ignore
        }
      }
      if (status === 'replied') {
        let current = true;
        try {
          current = typeof isCurrent === 'function' ? Boolean(isCurrent(exchangeId)) : true;
        } catch {
          current = false;
        }
        safeCall(onReply, reply, { exchangeId, current });
      }
      safeCall(onStatus, STATUS[status]);
      resolve(reply ? { status, reply } : { status });
    };

    try {
      const ms = Math.max(0, Number(timeoutSec) || 0) * 1000;
      timer = clock.setTimeout(() => finish('timeout'), ms);
    } catch {
      timer = null;
    }

    (async () => {
      const fields = secretRequestFields({ brief, swap });
      const instructions = instructionsFromSecretFields(fields);
      let secret;
      try {
        secret = typeof getSecret === 'function' ? await getSecret({ instructions, ...fields }) : null;
      } catch {
        secret = null;
      }
      if (finished) return;
      if (!secret || secret.available !== true || typeof secret.value !== 'string' || secret.value === '') {
        finish('unavailable');
        return;
      }
      if (typeof connect !== 'function') {
        finish('error');
        return;
      }
      const model = typeof secret.model === 'string' && MODEL_PATTERN.test(secret.model) ? secret.model : REALTIME_MODEL;
      const assembler = createReplyAssembler();
      const t = await connect({
        url: `${REALTIME_URL}?model=${encodeURIComponent(model)}`,
        protocols: ['realtime', `openai-insecure-api-key.${secret.value}`],
      });
      transport = t;
      if (finished) {
        // the timeout fired while connecting: close the socket we just opened
        try {
          t.close();
        } catch {
          // ignore
        }
        return;
      }
      t.onMessage((event) => {
        if (finished) return;
        const r = assembler.feed(event);
        if (!r.done) return;
        if (r.error) finish('error');
        else if (r.text === '') finish('empty');
        else finish('replied', { text: r.text, source: 'realtime' });
      });
      t.onClose(() => finish('closed'));
      for (const ev of remarkEvents(remark)) t.send(ev);
    })().catch(() => finish('error'));
  });
}

/**
 * connect() for Chrome: wraps a WebSocket in the transport shape. Sends are
 * JSON-encoded and queued until the socket opens; incoming messages are parsed
 * (unparseable ones are dropped); an error is reported as a close.
 * @param {any} [WebSocketCtor]
 */
export function createBrowserConnect(WebSocketCtor = globalThis.WebSocket) {
  return function connect({ url, protocols }) {
    if (typeof WebSocketCtor !== 'function') throw new Error('WebSocket is not available');
    const ws = new WebSocketCtor(url, protocols);
    const queue = [];
    let open = false;
    const messageHandlers = [];
    const closeHandlers = [];
    let closedOnce = false;
    const on = (type, h) => {
      if (typeof ws.addEventListener === 'function') ws.addEventListener(type, h);
      else ws[`on${type}`] = h;
    };
    const fireClose = (info) => {
      if (closedOnce) return;
      closedOnce = true;
      for (const h of closeHandlers) safeCall(h, info);
    };
    on('open', () => {
      open = true;
      while (queue.length) ws.send(queue.shift());
    });
    on('message', (ev) => {
      let data;
      try {
        data = JSON.parse(ev && typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      for (const h of messageHandlers) safeCall(h, data);
    });
    on('close', (ev) => fireClose({ code: ev && ev.code }));
    on('error', () => fireClose({ error: true }));
    return {
      send(obj) {
        const data = JSON.stringify(obj);
        if (open) ws.send(data);
        else queue.push(data);
      },
      close() {
        try {
          ws.close();
        } catch {
          // ignore
        }
      },
      onMessage(h) {
        messageHandlers.push(h);
      },
      onClose(h) {
        closeHandlers.push(h);
      },
    };
  };
}

function withFullerReply(note, exchangeId, reply) {
  if (note && typeof note === 'object' && (note.exchangeId === undefined || note.exchangeId === exchangeId)) {
    return { ...note, fullerReply: reply };
  }
  return note;
}

/**
 * Apply a fuller reply to the session state. Pure: returns a new state.
 * The reply replaces the shown reply only while its exchange's swap is the
 * latest swap; otherwise it is only recorded on that exchange's note.
 * @param {{ swaps: Swap[], notes?: any[] }} state
 * @param {string} exchangeId
 * @param {Reply} reply
 */
export function applyFullerReply(state, exchangeId, reply) {
  if (!state || !Array.isArray(state.swaps) || state.swaps.length === 0) return state;
  if (!reply || typeof reply.text !== 'string' || reply.text.trim() === '') return state;
  const index = state.swaps.findIndex((s) => s && s.exchangeId === exchangeId);
  if (index === -1) return state;
  const clean = { text: reply.text, source: 'realtime' };
  const isLatest = index === state.swaps.length - 1;
  const swaps = state.swaps.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, note: withFullerReply(s.note, exchangeId, clean) };
    if (isLatest) next.reply = clean;
    return next;
  });
  const notes = Array.isArray(state.notes)
    ? state.notes.map((n) => (n && n.exchangeId === exchangeId ? { ...n, fullerReply: clean } : n))
    : state.notes;
  return { ...state, swaps, notes };
}
