// The autocut panel: the automatic cuts YAP proposed for this recording, one
// card each with its reason, how sure YAP was, the words inside it, and the
// operator's own Apply / Restore. Nothing here applies a cut by itself, and an
// unsure cut waits until the operator applies it. With no proposals the panel
// says why, in plain words. No accuracy figure is shown: there is none to show.

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const secs = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} s`;

const STATE_WORDS = { applied: 'Applied', pending: 'Waiting for you', restored: 'Restored' };
const SURE_WORDS = { sure: 'YAP was sure', unsure: 'YAP was unsure: your call' };

/**
 * @param {{ document: Document, onJump: (t: number) => void, onChange: (change: { op: string, ids?: string[] }) => void }} hooks
 */
export function createAutocutPanel({ document: doc, onJump, onChange }) {
  const root = el(doc, 'section', 'ac');
  root.dataset.testid = 'panel-autocut';
  const summary = el(doc, 'p', 'ac-summary');
  summary.dataset.testid = 'autocut-summary';
  const waiting = el(doc, 'p', 'ac-waiting');
  waiting.dataset.testid = 'autocut-waiting';
  const bulk = el(doc, 'div', 'ac-bulk');
  const list = el(doc, 'ul', 'ac-list');
  list.dataset.testid = 'autocut-list';
  const empty = el(doc, 'div', 'ac-empty');
  empty.dataset.testid = 'autocut-empty';
  root.append(summary, waiting, bulk, empty, list);
  let busy = false;

  list.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest('[data-testid="autocut-item"]');
    if (!item) return;
    const button = target.closest('button');
    if (!button) return;
    if (button.dataset.testid === 'autocut-jump') onJump(Math.max(0, Number(item.dataset.start) - 1));
    else if (!busy && button.dataset.testid === 'autocut-apply') onChange({ op: 'apply', ids: [item.dataset.id] });
    else if (!busy && button.dataset.testid === 'autocut-restore') onChange({ op: 'restore', ids: [item.dataset.id] });
  });

  return {
    element: root,
    /** `review` is autocutReview(); `busy` disables the buttons while a change is being saved. */
    render(review, isBusy) {
      busy = isBusy;
      const c = review.counts;
      summary.textContent = c.total
        ? `${c.total} proposed · ${c.applied} applied · ${c.pending} waiting for you · ${c.restored} restored · ${secs(review.removedSeconds)} removed`
        : 'No automatic cuts';
      waiting.hidden = !c.pending;
      waiting.textContent = c.pending
        ? `${c.pending} cut${c.pending === 1 ? ' is' : 's are'} unsure. YAP has not applied ${c.pending === 1 ? 'it' : 'them'} and will not: apply each one you agree with.`
        : '';
      empty.hidden = c.total > 0;
      empty.replaceChildren();
      if (!c.total) empty.append(el(doc, 'p', '', review.message));

      bulk.replaceChildren();
      const sureOff = review.items.filter((i) => i.certainty === 'sure' && !i.applied).length;
      if (sureOff) {
        const b = el(doc, 'button', '', `Apply the ${sureOff} sure ${sureOff === 1 ? 'cut' : 'cuts'}`);
        b.type = 'button'; b.dataset.testid = 'autocut-apply-sure'; b.disabled = busy;
        b.addEventListener('click', () => onChange({ op: 'apply-sure' }));
        bulk.append(b);
      }
      if (c.applied) {
        const b = el(doc, 'button', '', 'Restore all automatic cuts');
        b.type = 'button'; b.dataset.testid = 'autocut-restore-all'; b.disabled = busy;
        b.addEventListener('click', () => onChange({ op: 'restore-all' }));
        bulk.append(b);
      }

      list.replaceChildren();
      for (const item of review.items) {
        const li = el(doc, 'li', `ac-item ${item.state}`);
        li.dataset.testid = 'autocut-item';
        Object.assign(li.dataset, { id: item.id, kind: item.kind, state: item.state, certainty: item.certainty, start: String(item.start) });
        const top = el(doc, 'div', 'ac-top');
        top.append(el(doc, 'strong', '', item.label), el(doc, 'span', 'ac-state', STATE_WORDS[item.state]));
        const when = el(doc, 'p', 'ac-when', `${clock(item.start)}–${clock(item.end)} · ${secs(item.seconds)}${item.wordCount ? ` · ${item.wordCount} ${item.wordCount === 1 ? 'word' : 'words'}` : ''}`);
        const why = el(doc, 'p', 'ac-why', item.reason);
        const sure = el(doc, 'p', `ac-sure ${item.certainty}`, SURE_WORDS[item.certainty] || '');
        li.append(top, when, why, sure);
        if (item.excerpt) li.append(el(doc, 'p', 'ac-excerpt', `“${item.excerpt}”`));
        const actions = el(doc, 'div', 'ac-actions');
        const jump = el(doc, 'button', '', 'Hear it');
        jump.type = 'button'; jump.dataset.testid = 'autocut-jump';
        jump.title = 'Move the player to just before this cut';
        actions.append(jump);
        if (item.state === 'applied') {
          const b = el(doc, 'button', '', 'Restore');
          b.type = 'button'; b.dataset.testid = 'autocut-restore'; b.disabled = busy;
          actions.append(b);
        } else {
          const b = el(doc, 'button', 'primary', 'Apply');
          b.type = 'button'; b.dataset.testid = 'autocut-apply'; b.disabled = busy;
          actions.append(b);
        }
        li.append(actions);
        list.append(li);
      }
    },
  };
}
