// The timeline describes the original; it never edits its media or transcript.
import { listCuts, keptRanges, END_SLIVER } from '../../src/engine/cutlist.js';
export const CLIP_LABELS = Object.freeze({ exchange: 'Aside removed', restart: 'Retake removed', 'dead-air': 'Pause removed', filler: 'Filler removed', restored: 'Restored', best: 'Best take' });
const round = n => Math.round(n * 1000) / 1000;

/** Stable cut ids survive restore/remove. Split overlaps at their real boundaries,
 * assigning shared time to the first applied cut; no second is counted twice.
 * Restored cuts remain visible unless another applied cut owns all their time. */
export function clipsFromCuts(cutList, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const cuts = listCuts(cutList || { cuts: [], undoStack: [] }).map(c => ({ ...c, start: Math.max(0, c.start), end: Math.min(duration, c.end) })).filter(c => c.end > c.start);
  const boundaries = [...new Set([0, duration, ...cuts.flatMap(c => [c.start, c.end])])].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1];
    const covers = cuts.filter(c => c.start <= start && c.end >= end);
    const owner = covers.find(c => c.applied) || covers[0];
    const cutId = owner?.id || null;
    const state = owner?.applied ? 'removed' : 'kept';
    const restored = owner && cutList?.undoStack?.some(a => a.type === 'set-applied' && a.id === owner.id && a.to === false);
    const reviewState = !owner ? null : owner.applied ? 'applied' : owner.certainty === 'unsure' && !restored ? 'pending' : 'restored';
    const previous = result.at(-1);
    if (previous && previous.cutId === cutId && previous.state === state) {
      previous.end = end;
      previous.seconds = round(end - previous.start);
    } else {
      result.push({ index: result.length, id: cutId ? `${cutId}:${start}` : `kept:${start}`, cutId, kind: owner?.kind || null, start, end, seconds: round(end - start), state, certainty: owner?.certainty || null, reviewState, label: owner ? (owner.applied ? CLIP_LABELS[owner.kind] || '' : reviewState === 'pending' ? 'Review cut · Apply' : CLIP_LABELS.restored) : '' });
    }
  }
  // A sliver of picture after the last cut goes with that cut (keptRanges leaves it out of every export too).
  const tail = result.at(-1), beforeTail = result.at(-2);
  if (tail && beforeTail && tail.state === 'kept' && !tail.cutId && beforeTail.state === 'removed' && tail.seconds < END_SLIVER && result.some((c) => c !== tail && c.state === 'kept')) {
    beforeTail.end = tail.end;
    beforeTail.seconds = round(tail.end - beforeTail.start);
    result.pop();
  }
  // The take YAP kept after a retake it removed: the next clip that plays is the best take.
  result.forEach((clip, i) => {
    if (clip.state !== 'removed' || clip.kind !== 'restart') return;
    const kept = result.slice(i + 1).find((c) => c.state === 'kept');
    if (kept && !kept.cutId) kept.label = CLIP_LABELS.best;
  });
  return result;
}

export function lengths(clips) {
  return { original: round(clips.reduce((sum, c) => sum + c.seconds, 0)), yapCut: round(clips.filter(c => c.state === 'kept').reduce((sum, c) => sum + c.seconds, 0)) };
}

/** Walk touching removed clips too: never seek into the next removed range. */
export function skipTarget(clips, time) {
  let target = time;
  for (const clip of clips) if (clip.state === 'removed' && target >= clip.start && target < clip.end) target = clip.end;
  return target === time ? null : target;
}

export function cutTime(clips, sourceTime) {
  return round(clips.filter(c => c.state === 'kept').reduce((sum, c) => sum + Math.max(0, Math.min(sourceTime, c.end) - c.start), 0));
}
export function mediaFor(recording, meta) {
  return meta?.sample && meta.sampleTake !== 2 ? '/sample/take1.mp4' : `/api/app/recordings/${recording.id}/media`;
}
export function exactKeptRanges(recording) { return keptRanges(recording.cuts, recording.duration); }
export function formatTime(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Which tag gives way first when the strip is crowded: the higher the number, the sooner. Unknown words rank with the pause. */
const TAG_RANK = Object.freeze({ 'Best take': 0, 'Retake removed': 1, 'Filler removed': 2, 'B-roll added': 3, "kept, that's you": 4, 'Aside removed': 5, Restored: 6, 'Pause removed': 8 });
export const tagRank = (text) => { const key = Object.keys(TAG_RANK).find((k) => String(text).startsWith(k)); return key ? TAG_RANK[key] : 7; };

/**
 * Lay the strip's tags on one line so that none touches another. Each tag starts where the page drew it, over its
 * clip; a tag that would touch its left neighbour moves right, and the row is then pulled back inside the strip.
 * A tag that would have to leave its own clip (by more than `reach`) to fit makes the least telling tag near it
 * give way: that one is hidden and stays readable on the clip's own label.
 * @param {{ left: number, width: number, rank: number, clipLeft: number, clipRight: number }[]} tags measured, in pixels
 * @param {{ left: number, right: number }} bounds the strip
 * @returns {{ dx: number, hidden: boolean }[]} for each tag, how far to move it, or that it gives way
 */
export function placeTags(tags, bounds, { gap = 8, reach = 28 } = {}) {
  const all = tags.map((t, i) => ({ ...t, i, x: t.left, hidden: false }));
  for (;;) {
    const shown = all.filter((t) => !t.hidden).sort((a, b) => a.left - b.left || a.i - b.i);
    if (!shown.length) break;
    let edge = bounds.left;
    for (const t of shown) { t.x = Math.max(t.left, edge); edge = t.x + t.width + gap; }
    edge = bounds.right;
    for (const t of [...shown].reverse()) { t.x = Math.min(t.x, edge - t.width); edge = t.x - gap; }
    const at = shown.findIndex((t) => t.x < bounds.left - 0.5 || t.x + t.width < t.clipLeft - reach || t.x > t.clipRight + reach);
    if (at < 0) break;
    // The tags packed against this one are the crowd: the least telling of them gives way, the narrowest clip first.
    const packed = (a, b) => b.x - (a.x + a.width) <= gap + 0.5;
    let from = at, to = at;
    while (from > 0 && packed(shown[from - 1], shown[from])) from -= 1;
    while (to < shown.length - 1 && packed(shown[to], shown[to + 1])) to += 1;
    const crowd = shown.slice(from, to + 1);
    crowd.sort((a, b) => b.rank - a.rank || (a.clipRight - a.clipLeft) - (b.clipRight - b.clipLeft));
    crowd[0].hidden = true;
  }
  return all.map((t) => ({ dx: t.hidden ? 0 : Math.round(t.x - t.left), hidden: t.hidden }));
}
