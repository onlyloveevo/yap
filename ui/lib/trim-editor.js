// "Trim recording": choose where the kept part of the original starts and ends. It asks the engine's own trimStart and
// trimEnd (through the server) to cut everything outside; nothing is deleted and the original stays whole. This file
// holds the pure helpers and the dialog; edit/wire.js owns the saving and the re-render.

const round2 = n => Math.round(n * 100) / 100;
export const seconds2 = n => (Math.round(n * 100) / 100).toFixed(2);

/** "1.25", " 1,25 " or "1.25 s" -> 1.25, rounded to two decimals; anything else -> NaN. */
export function parseSeconds(text) {
  const t = String(text ?? '').trim().replace(',', '.').replace(/\s*s(ec(onds?)?)?$/i, '');
  return /^\d+(\.\d*)?$|^\.\d+$/.test(t) ? round2(Number(t)) : NaN;
}

/** The start and end of the trim now saved: applied trim cuts only. */
export function currentTrim(cutList, duration) {
  const cuts = cutList?.cuts || [];
  const edge = which => cuts.find(c => c.kind === 'trim' && c.edge === which && c.applied);
  const s = edge('start'), e = edge('end');
  return { start: s ? s.end : 0, end: e ? e.start : duration };
}

/** Plain-words check of a start/end pair; null when fine. */
export function boundsProblem(start, end, duration) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter the start and the end as a number of seconds, such as 1.25.';
  if (start < 0) return 'The start cannot be before 0 seconds.';
  if (end > duration) return `The end cannot be after ${seconds2(duration)} seconds, the length of the recording.`;
  if (!(start < end)) return 'The start must be before the end.';
  return null;
}

/** Name the trimmed ends on the timeline; every other clip keeps the label edit-model gave it. */
export function labelTrimClips(clips, cutList) {
  for (const clip of clips) {
    const cut = clip.cutId && (cutList?.cuts || []).find(c => c.id === clip.cutId);
    if (cut?.kind === 'trim' && clip.state === 'removed') clip.label = cut.edge === 'start' ? 'Trimmed start' : 'Trimmed end';
  }
  return clips;
}

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/**
 * @param {{document:Document, trigger:HTMLElement, getDuration:()=>number, getPlayhead:()=>number, getTrim:()=>{start:number,end:number},
 *   apply:(patch:{start:number,end:number})=>Promise<void>, reset:()=>Promise<void>}} options
 * apply/reset resolve when saved; they reject with an Error that may carry `status`.
 */
export function createTrimEditor({ document: doc, trigger, getDuration, getPlayhead, getTrim, apply, reset }) {
  const dialog = el(doc, 'dialog', 'trim-dialog glass');
  dialog.dataset.testid = 'trim-dialog';
  dialog.setAttribute('aria-labelledby', 'trim-title');
  dialog.setAttribute('aria-describedby', 'trim-help');
  const form = el(doc, 'form'); form.noValidate = true;
  const title = el(doc, 'h2', '', 'Trim recording'); title.id = 'trim-title';
  const help = el(doc, 'p', 'trim-help', 'Choose what to keep, in seconds of the original recording. Nothing is deleted: the original stays whole and you can trim again.');
  help.id = 'trim-help';
  const fields = {};
  const rows = [];
  for (const [key, label] of [['start', 'Start'], ['end', 'End']]) {
    const row = el(doc, 'div', 'trim-row');
    const id = `trim-${key}-input`;
    const lab = el(doc, 'label', '', `${label} (seconds)`); lab.htmlFor = id;
    const input = el(doc, 'input'); input.id = id; input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.spellcheck = false;
    input.dataset.testid = `trim-${key}`;
    const use = el(doc, 'button', 'trim-use', 'Use playhead'); use.type = 'button'; use.dataset.testid = `trim-${key}-playhead`;
    use.setAttribute('aria-label', `Set the ${key} to the playhead`);
    row.append(lab, input, use); rows.push(row); fields[key] = { input, use };
  }
  const kept = el(doc, 'p', 'trim-kept'); kept.dataset.testid = 'trim-kept'; kept.setAttribute('role', 'status'); kept.setAttribute('aria-live', 'polite');
  const error = el(doc, 'p', 'trim-error'); error.dataset.testid = 'trim-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const reload = el(doc, 'button', 'trim-reload', 'Reload to review'); reload.type = 'button'; reload.dataset.testid = 'trim-reload'; reload.hidden = true;
  reload.addEventListener('click', () => doc.defaultView.location.reload());
  const actions = el(doc, 'div', 'trim-actions');
  const resetButton = el(doc, 'button', 'trim-reset', 'Reset trim'); resetButton.type = 'button'; resetButton.dataset.testid = 'trim-reset';
  resetButton.title = 'Remove the start and end trim. Other cuts stay.';
  const cancel = el(doc, 'button', 'trim-cancel', 'Cancel'); cancel.type = 'button'; cancel.dataset.testid = 'trim-cancel';
  const go = el(doc, 'button', 'trim-apply', 'Apply trim'); go.type = 'submit'; go.dataset.testid = 'trim-apply';
  actions.append(resetButton, cancel, go);
  form.append(title, help, ...rows, kept, error, reload, actions);
  dialog.append(form);
  doc.body.append(dialog);

  let exact = { start: 0, end: 0 }, busy = false, blocked = false;
  const readField = key => {
    const f = fields[key].input;
    // An untouched field keeps its exact value (the default end is the recording's real length, not its 2-decimal display).
    return f.value === seconds2(exact[key]) ? exact[key] : parseSeconds(f.value);
  };
  const setField = (key, value) => { exact[key] = value; fields[key].input.value = seconds2(value); refresh(); };
  const say = (text, { stop = false } = {}) => { error.textContent = text || ''; error.hidden = !text; reload.hidden = !stop; };
  function refresh() {
    const duration = getDuration(), s = readField('start'), e = readField('end');
    kept.textContent = Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0 && e <= duration
      ? `Kept: ${seconds2(e - s)} seconds of ${seconds2(duration)}` : `Kept: — of ${seconds2(duration)} seconds`;
    for (const key of ['start', 'end']) fields[key].use.disabled = busy || !Number.isFinite(getPlayhead());
    go.disabled = busy || blocked; resetButton.disabled = busy || blocked; cancel.disabled = busy;
    for (const key of ['start', 'end']) fields[key].input.readOnly = busy;
    dialog.setAttribute('aria-busy', String(busy));
    go.textContent = busy ? 'Saving…' : 'Apply trim';
  }
  const failure = err => {
    // Anything but a clear refusal may or may not have been saved: do not promise either.
    const uncertain = !Number.isInteger(err?.status) || err.status >= 500;
    if (uncertain) { blocked = true; say('We could not confirm whether the trim was saved. Reload this page to see the saved cut before trying again.', { stop: true }); }
    else if (err.status === 409) { blocked = true; say(`${err.message}`, { stop: true }); }
    else say(err.message || 'The trim was not saved.');
    refresh();
  };
  async function run(task) {
    if (busy) return;
    busy = true; say(''); refresh();
    try { await task(); close(); } catch (err) { failure(err); } finally { busy = false; refresh(); }
  }
  function close() { if (dialog.open) dialog.close(); trigger.focus({ preventScroll: true }); }
  function open() {
    if (dialog.open) return;
    const t = getTrim(); blocked = false; say('');
    exact = { start: t.start, end: t.end };
    fields.start.input.value = seconds2(t.start); fields.end.input.value = seconds2(t.end);
    refresh(); dialog.showModal(); fields.start.input.focus(); fields.start.input.select();
  }
  for (const key of ['start', 'end']) {
    fields[key].input.addEventListener('input', () => { say(''); refresh(); });
    fields[key].use.addEventListener('click', () => {
      const duration = getDuration(), t = getPlayhead();
      if (!Number.isFinite(t)) return;
      say(''); setField(key, Math.min(duration, Math.max(0, round2(t))));
    });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || blocked) return;
    const start = readField('start'), end = readField('end'), problem = boundsProblem(start, end, getDuration());
    if (problem) { say(problem); (Number.isFinite(start) ? fields.end : fields.start).input.focus(); return; }
    run(() => apply({ start, end }));
  });
  resetButton.addEventListener('click', () => { if (!busy && !blocked) run(() => reset()); });
  cancel.addEventListener('click', () => { if (!busy) close(); });
  // Escape (the dialog's own cancel event) closes without a change, and is ignored while a save is running.
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) close(); });
  // Native modal focus can move into browser chrome at the last control. Keep keyboard navigation inside this task.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const targets = [...dialog.querySelectorAll('input, button, [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = targets[0], last = targets.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog && !busy) close(); });
  return { open, dialog, isOpen: () => dialog.open };
}
