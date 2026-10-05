// Restart detector: a JavaScript port of detect() in the seat's spike
// (spikes/s3_loop/detect_retakes.round1_clean.py), extended with the text-similarity rule and
// restart-phrase islands from retake-text.js. Browser-safe: no `node:` imports.
// The spike's isolated re-transcription is replaced by an injectable transcribeWindow.

import {
  normToken, isStartOf, restartsSentence, repeatsItself, isRestartPhrase, onlyFillers, findSpokenRestarts, sharedOpening, talksAboutSpeech, hasSpeechRestartVerb, OPENERS,
} from './retake-text.js';

export { normToken };

/** The spike's SETTINGS, keys and values unchanged. */
export const SETTINGS = Object.freeze({
  rms_window: 0.02, rms_floor: 1e-12,
  quiet_db: -38, min_silence: 0.12,
  min_gap: 0.50, min_fragment: 0.35, max_fragment: 1.8,
  length_ratio: 1.08, min_full: 1.1,
  token_slack: 0.06, match_min_words: 2, match_errors: 1,
  prefix_head: 2, allowed_skips: Object.freeze([0, 1]),
  continuation_extra_words: 1,
  fallback_gap: 0.56, fallback_fragment_words: 5,
  fallback_full_words: 3, edge_pad: 0.04,
  gap_weight: 1.0, fragment_penalty: 0.12, match_bonus: 0.3,
  phrase_break: 0.25, time_round_digits: 4,
});

/**
 * Settings of the text rule added on top of the spike (not in the spike's SETTINGS).
 * text_span: islands of continuation the text rule may read ahead (the original skill's span).
 * glued_letters / glued_gap: a fragment of at most this many letters that follows speech after a gap
 * shorter than glued_gap is not enough on its own (the original skill's guard).
 * repeat_overlap: a cut may overlap a deliberate repeat by at most this many seconds (the scorer's bar).
 */
export const TEXT_SETTINGS = Object.freeze({ text_span: 6, glued_letters: 4, glued_gap: 0.6, repeat_overlap: 0.15 });

/**
 * Settings of the spoken-restart rule (a restart phrase said inside continuous speech, no pause around it).
 * open_words / open_letters: the abandoned attempt and the retake must open with at least this many identical
 * words / letters (sure); unsure_words / unsure_letters is the weaker bar that is only ever a suggestion.
 * max_tail: abandoned words after the shared opening that a sure cut may remove. max_attempt: words / seconds
 * looked back for the start of the abandoned attempt. edge_slack: how far a silence may sit past a word
 * boundary of the transcript (Whisper's word times drift from the audio by up to about half a second).
 */
export const SPOKEN_SETTINGS = Object.freeze({
  open_words: 4, open_letters: 14, unsure_words: 3, unsure_letters: 10,
  max_tail: 8, max_attempt_words: 30, max_attempt_seconds: 15, edge_slack: 0.15, edge_reach: 0.9,
});

/** Reason given when speech has no silence a cut could be placed in. */
export const NO_SILENCE = 'no silence to cut in';

/**
 * @typedef {{ text: string, start: number, end: number }} Word
 * @typedef {[number, number]} Span
 * @typedef {{ start: number, end: number, text: string }} Piece
 * @typedef {{ start: number, end: number, certainty: 'sure' | 'unsure', reason: string,
 *   fragment: Piece, continuation: Piece }} Proposal
 * @typedef {{ first: Span, second: Span, text: string }} RepeatGroup
 * @typedef {{ start: number, end: number, text: string, reason: string }} Reported
 */

/**
 * Accept Word objects or the spike's [token, start, end] triples; drop empty tokens.
 * @param {Array<Word | [string, number, number]>} words
 * @returns {Array<[string, number, number]>}
 */
export function toTriples(words = []) {
  const out = [];
  for (const w of words) {
    const [text, start, end] = Array.isArray(w) ? w : [w.text, w.start, w.end];
    const token = normToken(text);
    if (token) out.push([token, Number(start), Number(end)]);
  }
  return out;
}

/**
 * Tokens whose midpoint lies inside the window (with token_slack), the spike's tokens_in.
 * @param {Array<[string, number, number]>} items
 * @param {number} start
 * @param {number} end
 * @param {typeof SETTINGS} [S]
 */
export function tokensIn(items, start, end, S = SETTINGS) {
  return items.filter((w) => start - S.token_slack <= (w[1] + w[2]) / 2 && (w[1] + w[2]) / 2 <= end + S.token_slack).map((w) => w[0]);
}

/**
 * The spike's same_prefix: the fragment's opening words begin the continuation, allowing one skipped
 * first word and one error.
 * @param {string[]} a
 * @param {string[]} b
 * @param {typeof SETTINGS} [S]
 */
export function samePrefix(a, b, S = SETTINGS) {
  if (a.length < S.match_min_words || b.length < a.length + S.continuation_extra_words) return false;
  return S.allowed_skips.some((skip) => {
    if (a.length - skip < S.match_min_words) return false;
    const head = a.slice(skip, skip + S.prefix_head);
    const bHead = b.slice(0, S.prefix_head);
    if (head.length !== bHead.length || head.some((t, k) => t !== bHead[k])) return false;
    const rest = a.slice(skip);
    let same = 0;
    for (let k = 0; k < Math.min(rest.length, b.length); k++) if (rest[k] === b[k]) same += 1;
    return same >= Math.max(S.match_min_words, a.length - skip - S.match_errors);
  });
}

/** @param {number} x @param {number} digits */
function roundTo(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** @param {Span} a @param {Span} b */
function overlap(a, b) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/**
 * Propose restart cuts for one take, keep deliberate repeats as groups, and report what cannot be cut.
 * Every cut edge lies inside a silence.
 * @param {{ silences: Span[], duration: number, words?: Array<Word | [string, number, number]>,
 *   transcribeWindow?: (start: number, end: number) => string[], settings?: Partial<typeof SETTINGS & typeof TEXT_SETTINGS> }} input
 * @returns {{ cuts: Proposal[], repeats: RepeatGroup[], reported: Reported[] }}
 */
export function detectRestarts({ silences, duration, words = [], transcribeWindow, settings = {} }) {
  const S = /** @type {typeof SETTINGS & typeof TEXT_SETTINGS} */ ({ ...SETTINGS, ...TEXT_SETTINGS, ...settings });
  const transcript = toTriples(words);
  const hear = (s, e) => tokensIn(transcript, s, e, S);
  const retry = transcribeWindow ? (s, e) => transcribeWindow(s, e).map(normToken).filter(Boolean) : hear;
  const sil = (silences || []).filter((p) => p[1] > p[0]).map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]);

  // Islands of speech between silences.
  /** @type {Span[]} */
  const islands = [];
  let prevEnd = 0;
  for (const p of sil) {
    if (p[0] > prevEnd) islands.push([prevEnd, p[0]]);
    prevEnd = Math.max(prevEnd, p[1]);
  }
  if (duration > prevEnd) islands.push([prevEnd, duration]);

  /** @type {Reported[]} */
  const reported = [];
  if (!sil.length || islands.length <= 1) {
    const [start, end] = islands.length ? islands[0] : [0, duration];
    reported.push({ start, end, text: hear(start, end).join(' '), reason: NO_SILENCE });
    return { cuts: [], repeats: [], reported };
  }
  for (const [start, end] of islands) {
    const t = hear(start, end);
    if (repeatsItself(t)) reported.push({ start, end, text: t.join(' '), reason: NO_SILENCE });
  }

  /** @type {RepeatGroup[]} */
  const repeats = [];
  /**
   * Two neighbouring pieces of speech that say the same sentence at the same length are a deliberate repeat.
   * @param {Span} p @param {Span} q @param {string[]} tp @param {string[]} tq
   */
  const isRepeat = (p, q, tp, tq) => {
    if (!tp.length || !tq.length) return false;
    const dp = p[1] - p[0];
    const dq = q[1] - q[0];
    const sameLength = Math.max(dp, dq) <= Math.min(dp, dq) * S.length_ratio;
    const sameWords = tp.length >= 4 && tp.length === tq.length && tp.every((x, k) => x === tq[k]);
    // Like the spike's allowed_skips: Whisper sometimes drops the first word of one copy.
    const sameSentence = restartsSentence(tp, tq) || restartsSentence(tp.slice(1), tq) || restartsSentence(tp, tq.slice(1));
    return (sameLength && sameSentence) || sameWords;
  };
  // Phrases: islands joined across silences shorter than phrase_break, so a sentence with a
  // breath inside it is compared whole when looking for repeats.
  /** @type {Span[]} */
  const phrases = [];
  islands.forEach(([s, e], k) => {
    if (k && s - phrases[phrases.length - 1][1] < S.phrase_break) phrases[phrases.length - 1][1] = e;
    else phrases.push([s, e]);
  });
  for (let k = 0; k + 1 < phrases.length; k++) {
    const p = phrases[k];
    const q = phrases[k + 1];
    const tq = hear(q[0], q[1]);
    if (isRepeat(p, q, hear(p[0], p[1]), tq)) repeats.push({ first: [p[0], p[1]], second: [q[0], q[1]], text: tq.join(' ') });
  }
  const knownRepeat = (p, q) => repeats.some((r) => overlap(r.first, p) > 0 && overlap(r.second, q) > 0);
  /** @type {Array<{ score: number, proposal: Proposal }>} */
  const candidates = [];
  const islandAfter = (c) => (c + 1 < sil.length ? [sil[c][1], sil[c + 1][0]] : [sil[c][1], duration]);

  for (let i = 0; i < sil.length; i++) {
    const after = sil[i];
    const gap = after[1] - after[0];
    const before = i ? sil[i - 1] : [0, 0];
    const fragStart = before[1];
    const fragEnd = after[0];
    const fragDur = fragEnd - fragStart;
    if (fragDur <= 0) continue;
    const cutStart = i ? Math.max(before[0], before[1] - S.edge_pad) : 0;

    // Restart-phrase and filler-only islands right after the fragment join the cut.
    let c = i;
    while (c + 1 < sil.length) {
      const [s, e] = islandAfter(c);
      const t = hear(s, e);
      if (t.length && (isRestartPhrase(t) || onlyFillers(t))) c += 1;
      else break;
    }
    const contStart = sil[c][1];
    const phraseEnd = (sil.slice(c + 1).find((p) => p[1] - p[0] >= S.phrase_break) || [duration])[0];
    const reachEnd = Math.max(phraseEnd, c + S.text_span < sil.length ? sil[c + S.text_span][0] : duration);
    const contTokens = hear(contStart, phraseEnd);
    const reachTokens = hear(contStart, reachEnd);
    let fragTokens = hear(fragStart, fragEnd);
    if (!fragTokens.length && transcribeWindow) fragTokens = retry(fragStart, fragEnd);

    // A sentence said twice at the same length is a deliberate repeat: grouped, never cut.
    if (c === i && isRepeat([fragStart, fragEnd], [contStart, phraseEnd], fragTokens, contTokens)) {
      if (!knownRepeat([fragStart, fragEnd], [contStart, phraseEnd])) {
        repeats.push({ first: [fragStart, fragEnd], second: [contStart, phraseEnd], text: contTokens.join(' ') });
      }
      continue;
    }

    // Text rule (any silence): the fragment is the start of what follows.
    const letters = fragTokens.join('').length;
    const glued = i > 0 && letters <= S.glued_letters && (before[1] - before[0]) < S.glued_gap;
    const textMatch = fragTokens.length > 0 && !glued && (reachEnd - contStart) >= fragDur * S.length_ratio &&
      (isStartOf(fragTokens, reachTokens) || restartsSentence(fragTokens, reachTokens, c === i));
    if (textMatch) {
      const joined = c > i ? hear(sil[i][1], sil[c][0]).join(' ') : '';
      const cutEnd = Math.max(sil[c][0], sil[c][1] - S.edge_pad);
      candidates.push({
        score: S.gap_weight * gap - S.fragment_penalty * fragDur + S.match_bonus,
        proposal: {
          start: roundTo(cutStart, S.time_round_digits),
          end: roundTo(cutEnd, S.time_round_digits),
          certainty: 'sure',
          reason: joined ? `fragment and the restart phrase "${joined}" before the retake` : 'fragment is the start of the next sentence',
          fragment: { start: fragStart, end: fragEnd, text: fragTokens.join(' ') },
          continuation: { start: contStart, end: phraseEnd, text: contTokens.join(' ') },
        },
      });
      continue;
    }

    // The spike's rule: a long gap, duration checks and a word-prefix match, with the gap-only fallback.
    if (gap < S.min_gap) continue;
    const later = sil.slice(i + 1).find((span) => span[1] - span[0] >= S.phrase_break) || [duration, duration];
    const fullStart = after[1];
    const fullEnd = later[0];
    const fullDur = fullEnd - fullStart;
    if (!(S.min_fragment <= fragDur && fragDur <= S.max_fragment && fullDur >= fragDur * S.length_ratio && fullDur >= S.min_full)) continue;
    let a = hear(fragStart, fragEnd);
    const b = hear(fullStart, fullEnd);
    let matches = samePrefix(a, b, S);
    if (!matches && a.length < S.match_min_words) a = retry(fragStart, fragEnd);
    if (!matches && a.length >= S.match_min_words) matches = samePrefix(a, retry(fullStart, fullEnd), S);
    if (!matches && (gap < S.fallback_gap || a.length > S.fallback_fragment_words || b.length < S.fallback_full_words)) continue;
    const cutEnd = Math.max(after[0], after[1] - S.edge_pad);
    candidates.push({
      score: S.gap_weight * gap - S.fragment_penalty * fragDur + (matches ? S.match_bonus : 0),
      proposal: {
        start: roundTo(cutStart, S.time_round_digits),
        end: roundTo(cutEnd, S.time_round_digits),
        certainty: matches ? 'sure' : 'unsure',
        reason: matches ? 'fragment repeats the opening words of the next phrase' : 'long pause after a short phrase (no word match)',
        fragment: { start: fragStart, end: fragEnd, text: a.join(' ') },
        continuation: { start: fullStart, end: fullEnd, text: b.join(' ') },
      },
    });
  }

  // Sure before unsure, higher score first; drop overlaps and anything over a deliberate repeat.
  const rank = (x) => (x.proposal.certainty === 'sure' ? 1 : 0);
  candidates.sort((x, y) => rank(y) - rank(x) || y.score - x.score);
  /** @type {Proposal[]} */
  const cuts = [];
  for (const { proposal } of candidates) {
    const span = /** @type {Span} */ ([proposal.start, proposal.end]);
    if (cuts.some((c) => overlap(span, [c.start, c.end]) > 0)) continue;
    if (repeats.some((r) => overlap(span, r.first) + overlap(span, r.second) > S.repeat_overlap)) continue;
    cuts.push(proposal);
  }
  // A restart phrase said inside continuous speech has no island of its own; read it from the word stream.
  for (const proposal of spokenRestartCuts({ words, silences: sil, S })) {
    const span = /** @type {Span} */ ([proposal.start, proposal.end]);
    const clash = cuts.filter((c) => overlap(span, [c.start, c.end]) > 0);
    if (clash.length) {
      // "Let me start that again" with its repeated opening is stronger evidence than a pause with no word match:
      // a sure spoken retake that takes in every unsure suggestion it touches replaces them. Anything else stands.
      const replaces = proposal.certainty === 'sure' && clash.every((c) => c.certainty === 'unsure' && c.start >= proposal.start - 1e-6 && c.end <= proposal.end + 1e-6);
      if (!replaces) continue;
      for (const c of clash) cuts.splice(cuts.indexOf(c), 1);
    }
    if (repeats.some((g) => overlap(span, g.first) + overlap(span, g.second) > S.repeat_overlap)) continue;
    cuts.push(proposal);
  }
  cuts.sort((x, y) => x.start - y.start);
  return { cuts, repeats, reported };
}

const SENTENCE_END = /[.!?…]["')\]]*$/;

/**
 * Cuts for an explicit spoken restart ("..., sorry, let me start that again. <same opening> ...") read from
 * the word stream, for the case where no pause sets the phrase off. The abandoned attempt (from its sentence
 * start to the end of the phrase) is cut; the retake is never touched. Every edge is placed in a silence
 * (the transcript's word times drift from the audio), and a cut is 'sure' only when both edges found one
 * and the evidence is complete; otherwise it is an 'unsure' suggestion. No phrase, no repeated opening,
 * a phrase that is talked about or negated, or a different topic after it: no cut at all.
 * @param {{ words: Array<Word | [string, number, number]>, silences: Span[], S: typeof SETTINGS & typeof TEXT_SETTINGS }} input
 * @returns {Proposal[]}
 */
export function spokenRestartCuts({ words, silences, S }) {
  const P = { ...SPOKEN_SETTINGS, ...S };
  const seq = [];
  for (const w of words || []) {
    const isArr = Array.isArray(w);
    const text = isArr ? w[0] : w.text;
    const token = normToken(text);
    if (!token) continue;
    const start = Number(isArr ? w[1] : w.start);
    const end = Number(isArr ? w[2] : w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    seq.push({ token, start, end, quoted: /["“”«»]/.test(String(text)), stop: SENTENCE_END.test(String(text).trim()), speaker: isArr ? undefined : w.speaker });
  }
  const t = seq.map((w) => w.token);
  /** @type {Proposal[]} */
  const out = [];
  // The latest silence that ends no later than `at` (plus slack), within reach before it, and ends after `after`.
  const silenceBefore = (at, after, notBefore) => {
    let best = null;
    for (const p of silences) {
      if (p[1] > at + P.edge_slack || p[1] < at - P.edge_reach || p[1] <= after || p[0] < notBefore) continue;
      if (!best || p[1] > best[1]) best = p;
    }
    return best;
  };

  for (const run of findSpokenRestarts(t)) {
    const kept = run.end;
    if (kept >= seq.length) continue; // nothing is said after it: nothing to retake
    const rest = t.slice(kept, kept + P.max_attempt_words);
    let pick = null;
    for (let s = run.start - 1; s >= 0 && run.start - s <= P.max_attempt_words; s--) {
      if (seq[run.start - 1].end - seq[s].start > P.max_attempt_seconds) break;
      const open = sharedOpening(t.slice(s, run.start), rest);
      if (open.words < P.unsure_words || open.letters < P.unsure_letters) continue;
      if (rest.length - open.skipB <= open.words) continue; // the retake must go on past the shared opening
      const boundary = s === 0 || seq[s - 1].stop;
      if (!boundary && (open.words < P.open_words || open.letters < P.open_letters)) continue;
      const sa = silenceBefore(seq[s].start, s ? seq[s - 1].start : -Infinity, s ? seq[s - 1].start : 0);
      if (boundary || sa) {
        pick = { s, open, boundary, sa };
        break; // the nearest sentence start that repeats the retake's opening
      }
      pick ||= { s, open, boundary, sa };
    }
    if (!pick) continue;
    // A retake often drops the word the sentence opened with ("The first habit is ... sorry, let me start that again.
    // First habit is ..."), and the recogniser drops it too. The attempt then starts at that opener, at its sentence start.
    if (!pick.boundary && pick.s > 0 && OPENERS.has(t[pick.s - 1]) && (pick.s === 1 || seq[pick.s - 2].stop)) {
      const p = pick.s - 1;
      pick = { s: p, open: { ...pick.open, skipA: pick.open.skipA + 1 }, boundary: true, sa: silenceBefore(seq[p].start, p ? seq[p - 1].start : -Infinity, p ? seq[p - 1].start : 0) };
    }
    const { s, open } = pick;
    const first = seq[s];
    const lastPhrase = seq[run.end - 1];
    const retake = seq[kept];
    const speakers = new Set([...seq.slice(s, run.end), ...seq.slice(kept, kept + open.skipB + open.words)].map((w) => w.speaker).filter((x) => x !== undefined && x !== null));
    if (speakers.size > 1) continue;

    // A silence edge is only trusted when the cut it makes stays out of the words around it: the start must not
    // fall inside the previous (kept) word, the end must reach past the last word of the phrase.
    const prev = s ? seq[s - 1] : null;
    const edgeStart = (sp) => Math.min(Math.max(sp[0], sp[1] - P.edge_pad), first.start);
    const edgeEnd = (sp) => Math.min(Math.max(sp[0], sp[1] - P.edge_pad), retake.start);
    let sa = pick.sa || silenceBefore(first.start, s ? seq[s - 1].start : -Infinity, s ? seq[s - 1].start : 0);
    if (sa && prev && edgeStart(sa) < prev.end) sa = null;
    let sb = silenceBefore(retake.start, seq[run.start].start, 0);
    // An end silence that stops before the last phrase word ends may be word-time drift or a pause inside the
    // phrase (leftover words): it still places the cut, but the cut is only a suggestion.
    const endCovers = Boolean(sb && edgeEnd(sb) >= lastPhrase.end);
    const tail = (run.start - s) - open.skipA - open.words;
    // A full stop the recogniser put inside the words both attempts share ("habit. I almost skipped") ends no sentence:
    // the retake says those words straight through. Only a stop from the last shared word on means a second sentence.
    const inner = seq.slice(s + Math.max(0, open.skipA + open.words - 1), run.start - 1).some((w) => w.stop);
    // A finished sentence right before the phrase counts as abandoned only if the phrase names a speech restart.
    const finished = seq[run.start - 1].stop && !hasSpeechRestartVerb(t.slice(run.start, run.end));
    // Talk about speech, reporting verbs or quote marks anywhere in the abandoned stretch or the phrase: suggestion only.
    const doubtful = talksAboutSpeech(t.slice(s + open.skipA + open.words, run.start)) || seq.slice(run.start, run.end).some((w) => w.quoted);
    const strong = open.words >= P.open_words && open.letters >= P.open_letters;
    const sure = Boolean(sa && sb && pick.boundary && strong && !inner && endCovers && !finished && !doubtful && tail <= P.max_tail);
    // Edges sit in the silences, and never past the transcript's own word edges: the retake's first word stays whole.
    const start = sa ? edgeStart(sa) : first.start;
    // A silence that stops inside the phrase's last word (a pause before "again") would leave that word audible
    // once applied: the cut then runs to the phrase's own last word edge, still never into the retake's first word.
    const end = sb ? Math.max(edgeEnd(sb), Math.min(lastPhrase.end, retake.start)) : retake.start;
    if (!(end > start)) continue;
    const phrase = t.slice(run.start, run.end).join(' ');
    out.push({
      start: roundTo(start, P.time_round_digits),
      // A word edge is kept exact: rounding it up would nick the retake's first word, rounding down would leave a sliver of the phrase.
      end: end === lastPhrase.end || end === retake.start ? end : roundTo(end, P.time_round_digits),
      certainty: sure ? 'sure' : 'unsure',
      reason: `spoken restart "${phrase}" after an abandoned start of the same sentence`,
      fragment: { start: first.start, end: lastPhrase.end, text: t.slice(s, run.end).join(' ') },
      continuation: { start: retake.start, end: seq[Math.min(seq.length, kept + open.skipB + open.words) - 1].end, text: t.slice(kept, kept + open.skipB + open.words).join(' ') },
    });
  }
  return out;
}
