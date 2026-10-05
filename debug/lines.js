// The lines YAP's debug page prints (D-92, D-82, D-88), as pure functions:
//   lineForEvent(event, { titles })  the line to add to the log for one take
//                                    event, or null for an event that prints
//                                    nothing there
//   earlyLine(text)                  Chrome's early text, marked as early
//   hearingLine(hearing)             the line of the hearing status, or ''
//
// This module only makes strings. It builds no markup and touches nothing of
// the browser, so words from the recogniser can only ever be text
// (T-01.1-30). The page puts each string on the page with textContent.
//
// The page has no store, so no line here says a trial was saved (D-60).

/**
 * Every wording the page prints for a take event. A name in braces is filled
 * in once, by `fill`; what is filled in is never read again for braces.
 */
export const COPY = Object.freeze({
  word: 'Word at {t} s: {text}',
  inExchange: ' (talking to YAP)',
  point: 'Point lit at {t} s: {title}',
  exchangeClose: 'Hey YAP at {t} s: "{remark}"',
  swap: 'Swap: {from} -> {to}, {delay} s after your last word',
  swapCorrected: 'Swap corrected: {from} -> {to}. This replaces the swap before it.',
  swapUndone: 'Swap taken back: the words changed and no longer ask for a swap.',
  preparedReply: "YAP's reply (on screen, prepared): {text}",
  fullerReply: "YAP's reply (on screen, fuller): {text}",
  cueOn: 'Cue at {t} s: {text}',
  cueOff: 'Cue off at {t} s',
  drop: Object.freeze({
    retracted: 'Hey YAP dropped: Chrome changed the words, so nothing was done.',
    'wake-only': 'Hey YAP dropped: YAP heard its name and no request.',
    stopped: 'Hey YAP dropped: the take stopped first.',
    other: 'Hey YAP dropped.',
  }),
  early: 'Early (may still change): {text}',
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object';
const text = (value) => String(value ?? '');

/** Seconds with two decimals, or ? when the time is not a number. */
const sec = (t) => (Number.isFinite(t) ? t.toFixed(2) : '?');

/**
 * Fill a wording's braces from `values`, in one pass over the wording.
 * @param {string} wording
 * @param {Record<string, string>} values
 */
function fill(wording, values) {
  return wording.replace(/\{(\w+)\}/g, (whole, name) => (hasOwn(values, name) ? values[name] : whole));
}

/** The title of a point, or its id when no title is known. */
function titleOf(titles, pointId) {
  const title = titles && typeof titles.get === 'function' ? titles.get(pointId) : undefined;
  return text(title || pointId);
}

/**
 * One function per kind of take event. Each returns the line, or null when the
 * event holds nothing to print.
 * @type {Readonly<Record<string, (event: any, titles: any) => string | null>>}
 */
const PRINTERS = Object.freeze({
  word: (event) => {
    if (!isObject(event.word)) return null;
    return fill(COPY.word, { t: sec(event.word.end), text: text(event.word.text) }) + (event.inExchange ? COPY.inExchange : '');
  },

  point: (event, titles) => fill(COPY.point, { t: sec(event.at), title: titleOf(titles, event.pointId) }),

  'exchange-close': (event) => {
    if (!isObject(event.exchange)) return null;
    return fill(COPY.exchangeClose, { t: sec(event.exchange.start), remark: text(event.exchange.remark) });
  },

  // The delay is the take's own: from the remark's last word, or its last
  // change on Chrome's results, to the swap (D-92). A corrected swap replaces an
  // earlier one that was already timed, so it carries no delay of its own.
  swap: (event) => {
    const swap = event.swap;
    if (!isObject(swap) || !isObject(swap.from) || !isObject(swap.to)) return null;
    const angles = { from: text(swap.from.label), to: text(swap.to.label) };
    const first = event.corrected === true || swap.corrected === true
      ? fill(COPY.swapCorrected, angles)
      : fill(COPY.swap, { ...angles, delay: sec(swap.latencySec) });
    if (!isObject(swap.reply)) return first;
    return `${first}\n${fill(COPY.preparedReply, { text: text(swap.reply.text) })}`;
  },

  'swap-undone': () => COPY.swapUndone,

  // The take builds this line (Heard "<remark>". Nothing changed.); it is printed as it came.
  heard: (event) => (typeof event.line === 'string' ? event.line : null),

  note: (event) => (isObject(event.note) ? text(event.note.text) : null),

  cue: (event) => (isObject(event.cue)
    ? fill(COPY.cueOn, { t: sec(event.at), text: text(event.cue.text) })
    : fill(COPY.cueOff, { t: sec(event.at) })),

  reply: (event) => (isObject(event.reply) ? fill(COPY.fullerReply, { text: text(event.reply.text) }) : null),

  'reply-status': (event) => (event.status !== 'replied' && typeof event.message === 'string' ? event.message : null),

  'exchange-drop': (event) => (typeof event.reason === 'string' && event.reason !== 'other' && hasOwn(COPY.drop, event.reason)
    ? COPY.drop[event.reason]
    : COPY.drop.other),
});

/**
 * The line the debug page adds to its log for one take event.
 *
 * `interim` and `hearing` give null: early text and the hearing line have
 * their own places on the page (earlyLine, hearingLine). So do `exchange-open`
 * and `counted`, which the page has never printed, and any kind this page does
 * not know. A swap gives two lines in one string, joined by a line break.
 *
 * @param {any} event  a take event (loop.js TakeEvent)
 * @param {{ titles?: { get: (pointId: string) => string | undefined } }} [options]  the point titles by id
 * @returns {string | null}
 */
export function lineForEvent(event, { titles } = {}) {
  if (!isObject(event) || typeof event.type !== 'string' || !hasOwn(PRINTERS, event.type)) return null;
  return PRINTERS[event.type](event, titles);
}

/**
 * Chrome's early text, marked as early (D-92). It may still change, so the
 * page shows it in one line that is replaced, never in the log.
 * @param {unknown} early  the early text
 * @returns {string}  the line, or '' when there is no early text
 */
export function earlyLine(early) {
  const shown = text(early);
  return shown.trim() === '' ? '' : fill(COPY.early, { text: shown });
}

/**
 * The hearing line (D-88): the status's own line, as the source wrote it. ok
 * and stopped show nothing.
 * @param {{ status?: string, line?: string | null, listenAgain?: boolean } | null | undefined} hearing
 * @returns {string}  the line, or ''
 */
export function hearingLine(hearing) {
  if (!isObject(hearing) || hearing.status === 'ok' || hearing.status === 'stopped') return '';
  return typeof hearing.line === 'string' ? hearing.line : '';
}
