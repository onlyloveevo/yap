// The autocut panel: the automatic cuts YAP proposed for this recording, one
// card each with one plain sentence about it, the words inside it, and the
// person's own Cut it / Put back. Nothing here applies a cut by itself, and an
// unsure cut waits until the operator applies it. With no proposals the panel
// says why, in plain words. No accuracy figure is shown: there is none to show.

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const secs = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} s`;

const STATE_WORDS = { applied: 'Cut', pending: 'Your call', restored: 'Put back' };
const plainSeconds = (n) => { const v = Math.round(n * 10) / 10; return `${v} ${v === 1 ? 'second' : 'seconds'}`; };

/**
 * The one sentence a card says about its cut, in the words a creator would use. It is built from what the cut is and
 * where it stands, never from the detector's own note.
 * @param {{ kind: string, state: string, seconds: number }} item
 */
export function cardSentence(item) {
  const back = item.state === 'restored';
  const ask = item.state === 'pending';
  if (item.kind === 'restart') return back ? 'You put your first go back in.' : ask ? 'This sounds like a false start, so cut it if you agree.' : 'You started this again, so YAP kept your second go.';
  if (item.kind === 'filler') return back ? 'You put this filler back in.' : ask ? 'This sounds like filler, so cut it if you agree.' : 'A filler between your sentences.';
  if (item.kind === 'exchange') return back ? 'You put your talk with YAP back in.' : 'You were talking to YAP here, not to your viewers.';
  return back ? 'You put this pause back in.' : ask ? `A pause of ${plainSeconds(item.seconds)} you may want out.` : `Nothing is said here for ${plainSeconds(item.seconds)}.`;
}

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
      const cutCount = `${c.applied} ${c.applied === 1 ? 'cut' : 'cuts'}`;
      summary.textContent = c.total
        ? `${cutCount} · ${secs(review.removedSeconds)} shorter${c.restored ? ` · ${c.restored} put back` : ''}`
        : 'No cuts';
      waiting.hidden = !c.pending;
      waiting.textContent = c.pending
        ? `YAP is not sure about ${c.pending === 1 ? '1 more' : `${c.pending} more`}. ${c.pending === 1 ? 'It stays' : 'They stay'} in until you cut ${c.pending === 1 ? 'it' : 'them'}.`
        : '';
      empty.hidden = c.total > 0;
      empty.replaceChildren();
      if (!c.total) empty.append(el(doc, 'p', '', review.message));

      bulk.replaceChildren();
      const sureOff = review.items.filter((i) => i.certainty === 'sure' && !i.applied).length;
      if (sureOff) {
        const b = el(doc, 'button', '', `Cut ${sureOff === 1 ? 'it' : `all ${sureOff}`} again`);
        b.type = 'button'; b.dataset.testid = 'autocut-apply-sure'; b.disabled = busy;
        b.addEventListener('click', () => onChange({ op: 'apply-sure' }));
        bulk.append(b);
      }
      if (c.applied) {
        const b = el(doc, 'button', '', 'Put every cut back');
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
        const why = el(doc, 'p', `ac-why ${item.state}`, cardSentence(item));
        li.append(top, when, why);
        if (item.excerpt) li.append(el(doc, 'p', 'ac-excerpt', `“${item.excerpt}”`));
        const actions = el(doc, 'div', 'ac-actions');
        const jump = el(doc, 'button', '', 'Hear it');
        jump.type = 'button'; jump.dataset.testid = 'autocut-jump';
        jump.title = 'Move the player to just before this cut';
        actions.append(jump);
        if (item.state === 'applied') {
          const b = el(doc, 'button', '', 'Put back');
          b.type = 'button'; b.dataset.testid = 'autocut-restore'; b.disabled = busy;
          actions.append(b);
        } else {
          const b = el(doc, 'button', 'primary', 'Cut it');
          b.type = 'button'; b.dataset.testid = 'autocut-apply'; b.disabled = busy;
          actions.append(b);
        }
        li.append(actions);
        list.append(li);
      }
    },
  };
}
