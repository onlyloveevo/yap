// The timeline describes the original; it never edits its media or transcript.
import { listCuts, keptRanges } from '../../src/engine/cutlist.js';
export const CLIP_LABELS = Object.freeze({ exchange: 'Aside removed', 'dead-air': 'Filler removed', filler: 'Filler removed', restored: 'Restored', best: 'Best take' });
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
      result.push({ index: result.length, id: cutId ? `${cutId}:${start}` : `kept:${start}`, cutId, start, end, seconds: round(end - start), state, certainty: owner?.certainty || null, reviewState, label: owner ? (owner.applied ? CLIP_LABELS[owner.kind] || '' : reviewState === 'pending' ? 'Review cut · Apply' : CLIP_LABELS.restored) : '' });
    }
  }
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
