// A take recorded in YAP, opened in Review. Everything on the page is measured from the take itself
// (src/engine/review.js): its length, what the cut removed and why, restarts, pace, the beats covered,
// and one experiment drawn from that. A typed question goes to the model on this machine with the
// take's words and those facts, and is answered from the facts alone when no model replies.
import { getRecording, getMemory, saveMemory } from '../lib/api.js';
import { mediaPath } from '../lib/return-preview.js';
import { lessonStore } from '../lib/return-model.js';
import { answerQuestion } from '../lib/review-own.js';
import { takeReview } from '../../src/engine/review.js';
import { mountReview } from '../reviewsample/page.js';

const ICON = { length: 'clock', cut: 'scissors', restarts: 'redo', pace: 'gauge', beats: 'check' };
const dayOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The chart of a take: words a minute through it, the person's own limit, and what the cut removed. */
function paceChart(review) {
  if (!review.pace?.points) return null;
  const top = Math.max(300, Math.ceil(Math.max(...review.pace.points.map((p) => p[1])) / 100) * 100);
  const every = top > 500 ? 200 : 100;
  const ticks = [];
  for (let v = top; v >= 0; v -= every) ticks.push(v);
  return {
    heading: 'Pace through the take',
    label: `Words a minute through the take. The dashed line is your limit of ${review.pace.limit}. The shaded parts are what YAP removed.`,
    legend: [{ tone: 'purple', label: 'Words a minute' }, { tone: 'limit', label: 'Your limit' }, ...(review.removedRanges.length ? [{ tone: 'band', label: 'Removed by YAP' }] : [])],
    yTicks: ticks.map((v) => ({ at: v / top, label: String(v) })),
    you: review.pace.points.map(([t, wpm]) => [t, wpm / top]),
    limit: review.pace.limit / top,
    bands: review.removedRanges,
  };
}

/**
 * Open the review of the take saved under `id`.
 * @returns {Promise<boolean>} false when no take is saved under that id
 */
export async function openTake(id) {
  const saved = await getRecording(id);
  if (!saved?.recording || !(saved.recording.duration > 0)) return false;
  const { recording, meta } = saved;
  const sample = Boolean(meta?.sample);
  const before = meta?.returnFrom ? await getRecording(meta.returnFrom).catch(() => null) : null;
  const review = takeReview(recording, { previous: before?.recording || null });
  const fact = (key) => review.facts.find((f) => f.id === key)?.text || review.summary;
  const day = dayOf(recording.createdAt);
  const exp = review.experiment;
  mountReview({
    id,
    sample,
    title: review.title,
    published: [day && `Recorded ${day}`, before && 'Take 2'].filter(Boolean).join(' · '),
    range: 'This take',
    duration: review.duration,
    media: { src: mediaPath(id), sampleFootage: sample },
    numbers: review.numbers.map((n) => ({ ...n, icon: ICON[n.id], reply: fact(n.id) })),
    selectedNumber: -1,
    chart: paceChart(review),
    moments: review.moments.map((m) => ({ time: Math.min(m.time, Math.max(review.duration - 0.3, 0)), clock: m.clock, label: m.label, tip: m.label, reading: m.text })),
    selectedMoment: Math.max(review.moments.findIndex((m) => m.kind === 'restart'), 0),
    experiment: exp ? { text: exp.text, more: exp.why, current: { text: exp.now }, proposed: { text: exp.next } } : null,
    // A lesson from the sample take stays with the sample; a person's own goes with them.
    source: { id: sample ? `sample-${id}` : id, title: review.title },
    store: lessonStore({ sample, getMemory, saveMemory, storage: localStorage }),
    answer: (question) => answerQuestion({ question, evidence: review.evidence, review }),
    placeholder: exp ? 'What should I change next time?' : 'How long is this take?',
  });
  document.querySelector('[data-testid="take-review"]').dataset.state = 'ready';
  return true;
}
