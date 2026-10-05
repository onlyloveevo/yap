// The carried lesson as a small accepted cue: what the person picked in Review, shown where they
// are about to record. One function, and it stands alone: it reads the lesson itself, brings its own
// styles, and draws nothing when no lesson is carried.
//
//   import { mountCarriedLesson } from '../lib/carried-lesson.js';
//   await mountCarriedLesson(document.querySelector('.somewhere'), { sample: meta.sample });
//
// `sample` says which lesson to read. A sample take shows the lesson picked in the sample review. A
// person's own screen shows their own lesson, and the one picked in the sample review when they have none.
//
// `mountTrying` draws the same lesson with the wording experiments started in a take ("Try for 3
// videos") under one heading, What YAP is trying with you, each with its check-in when it is due.
import { getMemory, saveMemory, getTrials, answerTrialCheckIn } from './api.js';
import { lessonInUse, tryingItems, isSampleReview } from './return-model.js';

const STYLE_ID = 'carried-lesson-style';
const CSS = `
.carried-lesson{display:flex;align-items:flex-start;gap:12px;max-width:100%;padding:12px 16px;border-radius:16px;border:1px solid rgba(255,255,255,.16);background:rgba(14,12,11,.5);backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;text-align:left}
.carried-lesson .cl-mark{flex:0 0 22px;height:22px;margin-top:1px;border-radius:50%;display:grid;place-items:center;background:#f4c66b;color:#1c1408}
.carried-lesson .cl-mark svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.carried-lesson .cl-body{min-width:0;flex:1 1 auto;display:grid;gap:3px}
.carried-lesson p{margin:0;overflow-wrap:anywhere}
.carried-lesson .cl-heading{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.58)}
.carried-lesson .cl-text{font-size:16px;font-weight:500;line-height:1.35}
.carried-lesson .cl-source{font-size:13px;line-height:1.4;color:rgba(255,255,255,.62);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.carried-lesson .cl-sample{margin-left:8px;padding:1px 8px;border-radius:999px;border:1px solid rgba(244,198,107,.35);font-size:11px;color:rgba(255,255,255,.72);white-space:nowrap}
.carried-lesson .cl-remove{flex:0 0 auto;align-self:center;min-height:32px;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:transparent;color:rgba(255,255,255,.78);font:inherit;font-size:13px;cursor:pointer}
.carried-lesson .cl-remove:hover{background:rgba(255,255,255,.12);color:#fff}
.carried-lesson .cl-remove:focus-visible{outline:2px solid #f4c66b;outline-offset:3px}
.carried-lesson .cl-remove:disabled{opacity:.6;cursor:progress}
.trying{display:grid;gap:8px;max-width:100%;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;text-align:left}
.trying .ty-heading{margin:0;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#f4c66b}
.trying .carried-lesson{flex-wrap:wrap}
.trying .cl-body{flex:1 1 0}
.trying .cl-mark.ty-running{background:transparent;border:2px solid #f4c66b;color:#f4c66b}
.trying .cl-mark.ty-running::after{content:"";width:8px;height:8px;border-radius:50%;background:#f4c66b}
.trying .ty-ask{flex:1 1 calc(100% - 34px);min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 0 34px;font-size:14px;line-height:1.4;color:#fff}
.trying .ty-ask span{flex:1 1 100%}
.trying .ty-keep{min-height:32px;padding:4px 14px;border-radius:999px;border:1px solid #f4c66b;background:#f4c66b;color:#1c1408;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.trying .ty-note{flex:1 0 100%;margin:0 0 0 34px;font-size:13px;color:rgba(255,255,255,.72)}
`;
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';

function addStyles(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/**
 * Draw the carried lesson inside `container`, replacing one drawn there before.
 *
 * @param {Element} container
 * @param {{ sample?: boolean, removable?: boolean, heading?: string, onRemove?: (lesson: import('./return-model.js').CarriedLesson) => void }} [options]
 *   `sample`: read the sample's lesson instead of the person's own. `removable`: add a Remove button,
 *   which clears the lesson and then calls `onRemove`.
 * @returns {Promise<HTMLElement | undefined>} the cue, or nothing when no lesson is carried
 */
export async function mountCarriedLesson(container, { sample = false, removable = false, heading = 'From your last review', onRemove } = {}) {
  const document = container.ownerDocument;
  const { lesson, store } = await lessonInUse({ sample, getMemory, saveMemory, storage: document.defaultView.localStorage });
  container.querySelector(':scope > [data-testid="carried-lesson"]')?.remove();
  if (!lesson) return undefined;
  addStyles(document);
  const cue = lessonCue(document, lesson, store, { removable, heading, onRemove });
  container.append(cue);
  return cue;
}

const maker = (document) => (tag, className, text, hook) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  if (hook) node.dataset.testid = hook;
  return node;
};

/** The lesson as one cue: its words, the review it came from, and Remove when asked for. */
function lessonCue(document, lesson, store, { removable, heading, onRemove, quiet = false }) {
  const make = maker(document);
  const cue = make('aside', 'carried-lesson', '', 'carried-lesson');
  cue.setAttribute('aria-label', heading || 'From your review');
  const mark = make('span', 'cl-mark');
  mark.innerHTML = CHECK;
  const body = make('div', 'cl-body');
  const source = make('p', 'cl-source', heading ? lesson.source.title : `From your review of ${lesson.source.title}`, 'carried-lesson-source');
  if (isSampleReview(lesson.source.id) && !quiet) source.append(make('span', 'cl-sample', 'Sample'));
  body.append(...(heading ? [make('p', 'cl-heading', heading)] : []), make('p', 'cl-text', lesson.text, 'carried-lesson-text'), source);
  cue.append(mark, body);
  if (removable) {
    const remove = make('button', 'cl-remove', 'Remove', 'carried-lesson-remove');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await store.remove();
        cue.remove();
        if (onRemove) onRemove(lesson);
      } catch {
        remove.disabled = false;
        remove.textContent = 'Try again';
      }
    });
    cue.append(remove);
  }
  return cue;
}

/**
 * Draw everything YAP is trying with the person inside `container`: the lesson they picked in Review
 * and each wording experiment started in a take, under one heading. An experiment that has run its
 * videos asks its question here, with its two answers. Draws nothing when there is nothing.
 *
 * @param {Element} container
 * @param {{ sample?: boolean, heading?: string, onChange?: () => void }} [options]
 * @returns {Promise<HTMLElement | undefined>} the list, or nothing when YAP is trying nothing
 */
export async function mountTrying(container, { sample = false, heading = 'What YAP is trying with you', onChange = () => {} } = {}) {
  const document = container.ownerDocument;
  const make = maker(document);
  const { lesson, store } = await lessonInUse({ sample, getMemory, saveMemory, storage: document.defaultView.localStorage });
  const trials = await Promise.resolve().then(() => getTrials()).catch(() => []);
  const items = tryingItems({ lesson, trials: trials || [] });
  container.querySelector(':scope > [data-testid="trying"]')?.remove();
  if (!items.length) return undefined;
  addStyles(document);
  const again = () => mountTrying(container, { sample, heading, onChange }).then(onChange, onChange);
  const list = make('section', 'trying', '', 'trying');
  list.setAttribute('aria-label', heading);
  list.append(make('p', 'ty-heading', heading));
  for (const item of items) {
    if (item.kind === 'lesson') { list.append(lessonCue(document, lesson, store, { removable: true, heading: '', onRemove: again, quiet: sample })); continue; }
    const row = make('aside', 'carried-lesson', '', 'trying-experiment');
    row.dataset.trial = item.id;
    const mark = make('span', `cl-mark${item.checkIn || /^Video/.test(item.detail) ? ' ty-running' : ''}`);
    if (!mark.classList.contains('ty-running')) mark.innerHTML = CHECK;
    const body = make('div', 'cl-body');
    body.append(make('p', 'cl-text', item.name, 'trying-name'), make('p', 'cl-source', item.detail, 'trying-detail'));
    row.append(mark, body);
    if (item.checkIn) {
      const ask = make('div', 'ty-ask', '', 'trying-check-in');
      ask.append(make('span', '', item.checkIn.ask, 'trying-ask'));
      for (const [answer, label, cls] of [['keep', item.checkIn.keepLabel, 'ty-keep'], ['revert', item.checkIn.revertLabel, 'cl-remove']]) {
        const button = make('button', cls, label, `trying-${answer}`);
        button.type = 'button';
        button.addEventListener('click', async () => {
          ask.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          try { await answerTrialCheckIn(item.checkIn.trialId, answer); await again(); } catch (e) {
            ask.querySelectorAll('button').forEach((b) => { b.disabled = false; });
            row.querySelector('.ty-note')?.remove();
            const note = make('p', 'ty-note', `That answer was not saved: ${e && e.message ? e.message : 'try again'}.`);
            note.setAttribute('role', 'alert');
            row.append(note);
          }
        });
        ask.append(button);
      }
      row.append(ask);
    }
    list.append(row);
  }
  container.append(list);
  return list;
}
