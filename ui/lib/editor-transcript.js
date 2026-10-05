// The transcript panel: the take's saved timed words, selected as one
// contiguous range, removed through the one cut list and restored from the same
// panel. Words the cut list has taken out stay visible, struck through, with
// the reason and a Restore button; words with no usable timing are shown dimmed
// and cannot be selected. Nothing is drawn from text that was not saved.
//
// The panel holds only the selection. Every change is asked of the caller
// (editor-rail.js), which saves it and calls render() with the new state.

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const secs = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} s`;
const RUN_LABEL = { edit: 'Removed by you', restart: 'Restart', 'dead-air': 'Long pause', exchange: 'Talk with YAP', trim: 'Trimmed' };

/**
 * @param {{ document: Document, onSeek: (t: number) => void, onRemove: (r: { from: number, to: number, count: number }) => void,
 *   onRestore: (cutId: string) => void, onUndo: () => void, onCorrect: (i: number, text: string) => void,
 *   onRecover: (id: string) => void }} hooks
 */
export function createTranscriptPanel({ document: doc, onSeek, onRemove, onRestore, onUndo, onCorrect, onRecover }) {
  const root = el(doc, 'section', 'tx');
  root.dataset.testid = 'panel-transcript';
  const head = el(doc, 'div', 'tx-head');
  const summary = el(doc, 'p', 'tx-summary');
  summary.dataset.testid = 'transcript-summary';
  const undoButton = el(doc, 'button', 'tx-undo', 'Undo');
  undoButton.type = 'button';
  undoButton.dataset.testid = 'undo-edit';
  head.append(summary, undoButton);
  const notice = el(doc, 'div', 'tx-notice');
  const body = el(doc, 'div', 'tx-words');
  body.dataset.testid = 'transcript-words';
  body.setAttribute('role', 'group');
  body.setAttribute('aria-label', 'Transcript words');
  const bar = el(doc, 'div', 'tx-selection');
  bar.dataset.testid = 'selection-bar';
  bar.hidden = true;
  root.append(head, notice, body, bar);

  /** @type {any} */
  let model = null;
  let anchor = null;
  let focus = null;
  let dragging = false;
  let current = null;

  const wordButtons = () => [...body.querySelectorAll('[data-testid="word"]')];
  const keptWords = () => (model ? model.states.filter((w) => !w.removed) : []);
  const range = () => (anchor === null ? null : [Math.min(anchor, focus), Math.max(anchor, focus)]);
  const selected = () => { const r = range(); return r ? keptWords().filter((w) => w.i >= r[0] && w.i <= r[1]) : []; };

  function paintSelection() {
    const r = range();
    const picked = selected();
    for (const b of wordButtons()) {
      const i = Number(b.dataset.i);
      const on = Boolean(r && picked.some((w) => w.i === i));
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    bar.replaceChildren();
    bar.hidden = !picked.length;
    if (!picked.length) return;
    const first = picked[0];
    const last = picked[picked.length - 1];
    const row = el(doc, 'div', 'tx-sel-row');
    const text = el(doc, 'span', 'tx-sel-text', `${picked.length} ${picked.length === 1 ? 'word' : 'words'} selected · ${secs(last.end - first.start)}`);
    text.dataset.testid = 'selection-summary';
    const remove = el(doc, 'button', 'tx-remove', `Remove ${picked.length === 1 ? 'word' : `${picked.length} words`}`);
    remove.type = 'button';
    remove.dataset.testid = 'remove-selection';
    remove.disabled = model.busy;
    remove.addEventListener('click', () => onRemove({ from: first.i, to: last.i, count: picked.length }));
    const clear = el(doc, 'button', 'tx-clear', 'Clear');
    clear.type = 'button';
    clear.dataset.testid = 'clear-selection';
    clear.addEventListener('click', () => { anchor = focus = null; paintSelection(); });
    row.append(text, remove, clear);
    bar.append(row);
    if (picked.length === 1) {
      const fix = el(doc, 'form', 'tx-fix');
      fix.noValidate = true;
      const label = el(doc, 'label', 'tx-fix-label', 'Caption text');
      const input = el(doc, 'input', 'tx-fix-input');
      input.type = 'text';
      input.maxLength = 40;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.id = `caption-fix-${first.i}`;
      label.htmlFor = input.id;
      input.dataset.testid = 'caption-correct-input';
      const shown = model.corrections.get(first.i);
      input.value = shown !== undefined ? shown : first.text.trim();
      const save = el(doc, 'button', 'tx-fix-save', 'Save');
      save.type = 'submit';
      save.dataset.testid = 'caption-correct-save';
      save.disabled = model.busy;
      fix.append(label, input, save);
      if (shown !== undefined) {
        const reset = el(doc, 'button', 'tx-fix-reset', 'Reset');
        reset.type = 'button';
        reset.dataset.testid = 'caption-correct-reset';
        reset.addEventListener('click', () => onCorrect(first.i, ''));
        fix.append(reset);
      }
      fix.addEventListener('submit', (event) => { event.preventDefault(); onCorrect(first.i, input.value); });
      const hint = el(doc, 'p', 'tx-fix-hint', 'Changes only the caption. The saved transcript and the audio stay as they are.');
      bar.append(fix, hint);
    }
  }

  function moveFocus(from, step, extend) {
    const list = keptWords();
    const at = list.findIndex((w) => w.i === from);
    const next = list[Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))];
    if (!next) return;
    if (extend && anchor !== null) focus = next.i; else { anchor = focus = next.i; }
    paintSelection();
    body.querySelector(`[data-testid="word"][data-i="${next.i}"]`)?.focus({ preventScroll: false });
  }

  body.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest('[data-testid="word"]');
    if (button && !button.dataset.untimed) {
      const i = Number(button.dataset.i);
      if (event.shiftKey && anchor !== null) focus = i; else { anchor = focus = i; onSeek(Number(button.dataset.start)); }
      paintSelection();
      return;
    }
    const restore = target.closest('[data-testid="run-restore"]');
    if (restore && !model.busy) onRestore(restore.dataset.cutId);
    const removedWord = target.closest('.tx-word.removed');
    if (removedWord && !restore) onSeek(Number(removedWord.dataset.start));
  });
  body.addEventListener('pointerdown', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-testid="word"]');
    if (!button || button.dataset.untimed || event.button !== 0 || event.shiftKey) return;
    anchor = focus = Number(button.dataset.i);
    dragging = true;
    paintSelection();
  });
  body.addEventListener('pointerover', (event) => {
    if (!dragging || !(event.buttons & 1)) { dragging = false; return; }
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-testid="word"]');
    if (button && !button.dataset.untimed) { focus = Number(button.dataset.i); paintSelection(); }
  });
  doc.addEventListener('pointerup', () => { dragging = false; });
  body.addEventListener('keydown', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-testid="word"]');
    if (!button) return;
    const i = Number(button.dataset.i);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveFocus(i, 1, event.shiftKey); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveFocus(i, -1, event.shiftKey); }
    else if (event.key === 'Escape') { anchor = focus = null; paintSelection(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selected().length && !model.busy) {
      event.preventDefault();
      const picked = selected();
      onRemove({ from: picked[0].i, to: picked[picked.length - 1].i, count: picked.length });
    }
  });
  undoButton.addEventListener('click', () => { if (!undoButton.disabled) onUndo(); });

  function renderNotice() {
    notice.replaceChildren();
    notice.hidden = !model.status.message;
    notice.dataset.testid = model.status.state === 'ok' ? 'transcript-ok' : model.status.state === 'partial' ? 'transcript-partial' : 'transcript-unavailable';
    if (!model.status.message) return;
    notice.className = `tx-notice ${model.status.state}`;
    notice.append(el(doc, 'p', '', model.status.message));
    if (model.status.recovery.length) {
      const row = el(doc, 'div', 'tx-recover');
      for (const action of model.status.recovery) {
        const b = el(doc, 'button', '', action.label);
        b.type = 'button';
        b.dataset.testid = `recover-${action.id}`;
        b.addEventListener('click', () => onRecover(action.id));
        row.append(b);
      }
      notice.append(row);
    }
  }

  function renderWords() {
    body.replaceChildren();
    const timedAt = new Map(model.states.map((w) => [w.i, w]));
    const runs = new Map(model.runs.map((r) => [r.first, r]));
    let skipUntil = -1;
    model.all.forEach((raw, i) => {
      if (i <= skipUntil) return;
      const w = timedAt.get(i);
      if (!w) {
        const b = el(doc, 'span', 'tx-word untimed', String(raw && raw.text || '').trim() || '·');
        b.dataset.testid = 'word';
        b.dataset.i = String(i);
        b.dataset.untimed = 'true';
        b.dataset.state = 'untimed';
        b.title = 'No usable timing: not editable and not captioned';
        body.append(b, doc.createTextNode(' '));
        return;
      }
      if (w.removed) {
        const run = runs.get(i);
        const group = el(doc, 'span', 'tx-run');
        group.dataset.testid = 'removed-run';
        group.dataset.cutId = run ? run.cutId || '' : '';
        group.dataset.kind = run ? run.kind || '' : '';
        const upTo = run ? run.last : i;
        model.all.forEach((_, j) => {
          if (j < i || j > upTo) return;
          const rw = timedAt.get(j);
          if (!rw) return;
          const b = el(doc, 'span', 'tx-word removed', rw.text.trim());
          b.dataset.testid = 'word';
          b.dataset.i = String(j);
          b.dataset.start = String(rw.start);
          b.dataset.state = 'removed';
          b.title = `${RUN_LABEL[w.kind] || 'Removed'} · ${secs(rw.end - rw.start)}`;
          group.append(b, doc.createTextNode(' '));
        });
        skipUntil = upTo;
        const why = el(doc, 'span', 'tx-run-why', RUN_LABEL[w.kind] || 'Removed');
        group.append(why, doc.createTextNode(' '));
        if (w.kind !== 'trim' && w.cutId) {
          const restore = el(doc, 'button', 'tx-run-restore', 'Restore');
          restore.type = 'button';
          restore.dataset.testid = 'run-restore';
          restore.dataset.cutId = w.cutId;
          restore.disabled = model.busy;
          restore.setAttribute('aria-label', `Restore ${run ? run.count : 1} removed ${run && run.count === 1 ? 'word' : 'words'}`);
          group.append(restore);
        }
        body.append(group, doc.createTextNode(' '));
        return;
      }
      const b = el(doc, 'button', 'tx-word');
      b.type = 'button';
      b.dataset.testid = 'word';
      b.dataset.i = String(i);
      b.dataset.start = String(w.start);
      b.dataset.state = 'kept';
      b.setAttribute('aria-pressed', 'false');
      const fixed = model.corrections.get(i);
      b.textContent = w.text.trim();
      b.title = `${w.start.toFixed(2)}–${w.end.toFixed(2)} s`;
      if (fixed !== undefined) { b.classList.add('corrected'); b.title += ` · caption reads “${fixed}”`; b.dataset.corrected = 'true'; }
      body.append(b, doc.createTextNode(' '));
    });
    setCurrent(current);
  }

  function setCurrent(i) {
    current = i;
    for (const b of wordButtons()) b.classList.toggle('now', i !== null && Number(b.dataset.i) === i);
  }

  return {
    element: root,
    /** Show the model: `{ status, all, states, runs, corrections: Map, undoLabel, busy, removedCount }`. */
    render(next) {
      model = next;
      const keep = range();
      if (keep) {
        const ok = keptWords().some((w) => w.i >= keep[0] && w.i <= keep[1]);
        if (!ok) anchor = focus = null;
      }
      const usable = model.status.usable;
      summary.textContent = usable
        ? `${model.states.length} timed ${model.states.length === 1 ? 'word' : 'words'} · ${model.removedCount} removed`
        : 'Transcript';
      undoButton.disabled = !model.undoLabel || model.busy;
      undoButton.title = model.undoLabel || 'Nothing to undo';
      undoButton.setAttribute('aria-label', model.undoLabel || 'Nothing to undo');
      renderNotice();
      renderWords();
      paintSelection();
    },
    /** Mark the word being spoken at `i` (a transcript index) or none. */
    setCurrent,
    clearSelection() { anchor = focus = null; paintSelection(); },
    selection() { return selected().map((w) => w.i); },
  };
}
