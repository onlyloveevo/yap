// The B-roll tab of the editor's side panel: choose a local video, choose which stretch of the recording it covers,
// see it in the player, save. Nothing here claims success before the server has answered:
// a clip is "added" only after the server has decoded it, a choice is "saved" only after the server has kept it.
//
// The saved choice is in the recording the page hands in. This file holds only a draft (what the person is
// still changing), and tells the page what to preview through `hooks.preview`.

import { changeBroll, uploadBroll, brollMediaUrl } from './api.js';
import { brollState, checkBrollRange, brollWindows, BROLL_COPY } from '../../src/engine/broll-plan.js';
import { keptRanges } from '../../src/engine/cutlist.js';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const seconds = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} s`;
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * @param {{ document: Document, id: string, hooks: {
 *   getRecording: () => any, getPlayhead: () => number, isBusy: () => boolean, setBusy: (busy: boolean) => void,
 *   toast: (text: string) => void, apply: (recording: any) => void, invalidateExport: () => void,
 *   preview: (draft: { url: string, start: number, end: number, inPoint: number } | null) => void } }} options
 */
export function createBrollPanel({ document: doc, id, hooks }) {
  const root = el(doc, 'section', 'bp');
  root.dataset.testid = 'panel-broll';

  const intro = el(doc, 'p', 'bp-intro', 'Lay a video from this computer over the picture while your recording keeps playing. Your own voice stays; the clip’s sound is not used.');
  const chooseRow = el(doc, 'div', 'bp-row');
  const choose = el(doc, 'button', 'primary bp-choose', 'Choose video…');
  choose.type = 'button';
  choose.dataset.testid = 'broll-choose';
  const file = el(doc, 'input');
  file.type = 'file';
  file.accept = 'video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v';
  file.dataset.testid = 'broll-file';
  file.className = 'sr-only';
  file.tabIndex = -1;
  file.setAttribute('aria-label', 'B-roll video file from this computer');
  chooseRow.append(choose, file);

  const status = el(doc, 'p', 'bp-status');
  status.dataset.testid = 'broll-status';
  status.setAttribute('role', 'status');

  const clipCard = el(doc, 'div', 'bp-card');
  clipCard.dataset.testid = 'broll-asset';
  const clipName = el(doc, 'strong', 'bp-name');
  const clipMeta = el(doc, 'span', 'bp-meta');
  clipCard.append(clipName, clipMeta);

  const field = (label, testid, hint) => {
    const wrap = el(doc, 'label', 'bp-field');
    const name = el(doc, 'span', 'bp-label', label);
    const input = el(doc, 'input', 'bp-input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.inputMode = 'decimal';
    input.dataset.testid = testid;
    wrap.append(name, input);
    if (hint) wrap.title = hint;
    return { wrap, input };
  };
  const fStart = field('Start (s)', 'broll-start', 'Where in the original recording the B-roll starts');
  const fEnd = field('End (s)', 'broll-end', 'Where in the original recording the B-roll ends');
  const fIn = field('Clip from (s)', 'broll-inpoint', 'Which moment of the clip is shown first');
  const useStart = el(doc, 'button', 'bp-use', 'Start at playhead');
  useStart.type = 'button';
  useStart.dataset.testid = 'broll-use-start';
  useStart.setAttribute('aria-label', 'Start the B-roll at the playhead');
  const useEnd = el(doc, 'button', 'bp-use', 'End at playhead');
  useEnd.type = 'button';
  useEnd.dataset.testid = 'broll-use-end';
  useEnd.setAttribute('aria-label', 'End the B-roll at the playhead');
  const rows = el(doc, 'div', 'bp-fields');
  const grid = el(doc, 'div', 'bp-grid');
  grid.append(fStart.wrap, fEnd.wrap, fIn.wrap);
  const uses = el(doc, 'div', 'bp-uses');
  uses.append(useStart, useEnd);
  rows.append(grid, uses);

  const check = el(doc, 'p', 'bp-check');
  check.dataset.testid = 'broll-check';
  check.id = 'broll-check';
  for (const f of [fStart, fEnd, fIn]) f.input.setAttribute('aria-describedby', 'broll-check');

  const actions = el(doc, 'div', 'bp-actions');
  const save = el(doc, 'button', 'primary bp-save', 'Save B-roll');
  save.type = 'button';
  save.dataset.testid = 'broll-save';
  const reset = el(doc, 'button', 'bp-reset', 'Undo changes');
  reset.type = 'button';
  reset.dataset.testid = 'broll-reset';
  const remove = el(doc, 'button', 'bp-remove', 'Remove B-roll');
  remove.type = 'button';
  remove.dataset.testid = 'broll-remove';
  actions.append(save, reset, remove);

  const saved = el(doc, 'p', 'bp-saved');
  saved.dataset.testid = 'broll-saved';
  const form = el(doc, 'div', 'bp-form');
  form.append(clipCard, rows, check, actions);
  root.append(intro, chooseRow, status, form, saved);

  /** What the person is working on. `asset` is a clip the server has kept. */
  let draft = null; // { asset, start, end, inPoint }
  let dirty = false;

  const recording = () => hooks.getRecording();
  const kept = () => { const r = recording(); return r ? keptRanges(r.cuts, r.duration) : []; };

  function verdict() {
    if (!draft) return null;
    const r = recording();
    const start = fStart.input.valueAsNumber;
    const end = fEnd.input.valueAsNumber;
    const inPoint = fIn.input.valueAsNumber;
    return checkBrollRange({ start, end, inPoint }, draft.asset, r.duration, kept());
  }

  function readInputs() {
    if (!draft) return;
    draft.start = fStart.input.valueAsNumber;
    draft.end = fEnd.input.valueAsNumber;
    draft.inPoint = fIn.input.valueAsNumber;
  }

  function showPreview() {
    if (!draft) { hooks.preview(null); return; }
    hooks.preview({ url: brollMediaUrl(id, draft.asset.id), start: draft.start, end: draft.end, inPoint: draft.inPoint });
  }

  function draw() {
    const r = recording();
    if (!r) return;
    const state = brollState(r);
    const busy = hooks.isBusy();
    if (!dirty) {
      draft = state.asset ? { asset: state.asset, start: state.start, end: state.end, inPoint: state.inPoint } : null;
    }
    form.hidden = !draft;
    intro.hidden = Boolean(draft);
    choose.disabled = busy;
    choose.textContent = draft ? 'Choose another video…' : 'Choose video…';
    if (draft) {
      clipName.textContent = draft.asset.name;
      clipMeta.textContent = `${seconds(draft.asset.duration)} · ${draft.asset.width}×${draft.asset.height}`;
      for (const [f, v] of [[fStart, draft.start], [fEnd, draft.end], [fIn, draft.inPoint]]) {
        if (doc.activeElement !== f.input) f.input.value = Number.isFinite(v) ? String(round3(v)) : '';
        f.input.disabled = busy;
        f.input.max = f === fIn ? String(draft.asset.duration) : String(r.duration);
      }
      const v = verdict();
      const bad = v && !v.ok;
      check.dataset.state = bad ? 'problem' : 'ok';
      if (bad) check.textContent = v.error.replace(' Nothing was changed.', '');
      else {
        const win = brollWindows(kept(), v);
        const total = win.reduce((n, w) => n + (w.cutEnd - w.cutStart), 0);
        const removed = (v.end - v.start) - total;
        check.textContent = `Covers ${seconds(v.end - v.start)} of the recording${removed > 0.05 ? `, ${seconds(total)} of it in the part you keep` : ''}. The clip has ${seconds(draft.asset.duration - v.inPoint)} from here.`;
      }
      const changed = dirty;
      save.disabled = busy || bad || !changed;
      save.setAttribute('aria-disabled', String(save.disabled));
      save.title = bad ? v.error : !changed ? 'Nothing has changed since the last save' : 'Save this B-roll to the recording';
      reset.hidden = !changed;
      reset.disabled = busy;
      remove.hidden = !state.asset;
      remove.disabled = busy;
      useStart.disabled = busy;
      useEnd.disabled = busy;
    }
    saved.textContent = state.asset
      ? `Saved: “${state.asset.name}” over ${seconds(state.start)} to ${seconds(state.end)} of the recording${dirty ? '. You have unsaved changes.' : '. It shows in the preview and in the next export.'}`
      : BROLL_COPY.none;
    saved.dataset.state = state.asset ? 'saved' : 'none';
    showPreview();
  }

  const touched = () => { readInputs(); dirty = true; draw(); };
  for (const f of [fStart, fEnd, fIn]) f.input.addEventListener('input', touched);
  const fromPlayhead = (input) => () => { input.value = String(round3(Math.max(0, hooks.getPlayhead() || 0))); touched(); };
  useStart.addEventListener('click', fromPlayhead(fStart.input));
  useEnd.addEventListener('click', fromPlayhead(fEnd.input));

  choose.addEventListener('click', () => { if (!choose.disabled) file.click(); });
  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    file.value = '';
    if (!picked || hooks.isBusy()) return;
    hooks.setBusy(true);
    status.dataset.state = 'working';
    status.textContent = `Checking “${picked.name}”: reading and decoding it…`;
    try {
      const result = await uploadBroll(id, picked);
      const asset = result.asset;
      const r = recording();
      const at = Math.max(0, Math.min(r.duration - 0.5, Math.round((hooks.getPlayhead() || 0) * 10) / 10));
      const length = Math.min(asset.duration, 5, r.duration - at);
      draft = { asset, start: at, end: round3(at + length), inPoint: 0 };
      dirty = true;
      status.dataset.state = 'ok';
      status.textContent = `${result.reused ? 'This clip was already added, so it was reused' : 'Added'}: “${asset.name}”, ${seconds(asset.duration)}, ${asset.width}×${asset.height}. Choose where it shows, then save.`;
    } catch (error) {
      status.dataset.state = 'problem';
      status.textContent = error.message || 'The clip could not be added. Nothing was saved.';
    } finally {
      hooks.setBusy(false);
      draw();
    }
  });

  async function change(patch, say) {
    if (hooks.isBusy()) return;
    hooks.setBusy(true);
    try {
      const answer = await changeBroll(id, { ...patch, expectedRevision: brollState(recording()).revision });
      dirty = false;
      if (answer.changed) hooks.invalidateExport();
      if (answer.recording) hooks.apply(answer.recording);
      status.dataset.state = 'ok';
      status.textContent = say(answer);
      hooks.toast(status.textContent);
    } catch (error) {
      status.dataset.state = 'problem';
      status.textContent = error.message || 'That could not be saved. Nothing was changed.';
      hooks.toast(status.textContent);
    } finally {
      hooks.setBusy(false);
      draw();
    }
  }

  save.addEventListener('click', () => {
    if (save.disabled || !draft) return;
    readInputs();
    change({ op: 'set', assetId: draft.asset.id, start: draft.start, end: draft.end, inPoint: draft.inPoint },
      (a) => (a.changed ? 'B-roll saved. It shows in the preview. Export again to download it.' : 'Nothing changed.'));
  });
  remove.addEventListener('click', () => {
    if (remove.disabled) return;
    change({ op: 'clear' }, (a) => (a.changed ? 'B-roll removed. The camera picture shows all the way through. Export again to download this edit.' : 'There was no B-roll to remove.'));
  });
  reset.addEventListener('click', () => { dirty = false; status.textContent = ''; draw(); });

  return {
    element: root,
    refresh: draw,
    /** The draft the preview is showing, for the page and for tests. */
    draft: () => (draft ? { ...draft, dirty } : null),
  };
}
