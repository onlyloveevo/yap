// Beat marks: where each beat sits in a recording, at the times the beat was
// recorded (CUT-05, EDIT-01; D-47, D-50).
//
// It reads the takes Phase 1's episode already holds (D-15) and builds no
// second model of beats (D-37). A mark describes the original recording, as a
// cut does: trimming or cutting never moves it.
//
// Pure and browser-safe: imports nothing, never mutates its input, and returns
// new objects.

/**
 * @typedef {import('./episode.js').Episode} Episode
 * @typedef {{ beatId: string, title: string, start: number, end: number }} BeatMark
 */

/**
 * One mark per beat that has a take from this recording, in beat order. Where a
 * beat holds more than one take from the recording, the chosen take gives the
 * times; when the chosen take is from another recording, the last take recorded
 * from this one does.
 * @param {Episode | null | undefined} episode
 * @param {string} recordingId
 * @returns {BeatMark[]}
 */
export function beatMarks(episode, recordingId) {
  const beats = episode && Array.isArray(episode.beats) ? episode.beats : [];
  /** @type {BeatMark[]} */
  const marks = [];
  for (const beat of beats) {
    const takes = (Array.isArray(beat.takes) ? beat.takes : []).filter((t) => t && t.recordingId === recordingId);
    if (takes.length === 0) continue;
    const take = takes.find((t) => t.id === beat.chosenTakeId) || takes[takes.length - 1];
    marks.push({ beatId: beat.id, title: beat.title, start: take.start, end: take.end });
  }
  return marks;
}
