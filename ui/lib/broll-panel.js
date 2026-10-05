// The B-roll panel of the editor: a small library the app ships, the person's own media (added, tagged, searched),
// clips suggested for a moment of the take, and the one insert the recording keeps.
//
// Nothing here claims success before the server has answered: a clip is "added" only after the server has decoded
// it, a choice is "saved" only after the server has kept it. The saved choice is in the recording the page hands in.
// This file holds only a draft (what the person is still changing) and tells the page what to preview.

import { changeBroll, brollMediaUrl } from './api.js';
import { brollState, checkBrollRange, brollWindows, suggestBrollMoments, rankBrollClips, searchBrollClips, BROLL_LIMITS, BROLL_COPY } from '../../src/engine/broll-plan.js';
import { keptRanges } from '../../src/engine/cutlist.js';
import { formatTime } from './edit-model.js';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const seconds = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} s`;
const round3 = (x) => Math.round(x * 1000) / 1000;
const LIBRARY = '/api/app/media-library';
/** How long a clip shows when the take has no suggested moment at the playhead. */
const PLAYHEAD_SECONDS = 5;

async function call(scope, url, options = {}) {
  let res;
  try { res = await scope.fetch(url, { mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', ...options }); }
  catch { throw new Error('YAP could not be reached. Nothing was changed.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'That did not work. Nothing was changed.');
  return data;
}

/**
 * @param {{ document: Document, id: string, hooks: {
 *   getRecording: () => any, getPlayhead: () => number, isBusy: () => boolean, setBusy: (busy: boolean) => void,
 *   toast: (text: string) => void, apply: (recording: any) => void, invalidateExport: () => void, seek?: (t: number) => void,
 *   preview: (draft: { url: string, start: number, end: number, inPoint: number } | null) => void } }} options
 */
export function createBrollPanel({ document: doc, id, hooks }) {
  const scope = doc.defaultView || globalThis;
  const root = el(doc, 'section', 'bp');
  root.dataset.testid = 'panel-broll';

  // Shelves
  const shelves = el(doc, 'div', 'bp-shelves');
  shelves.setAttribute('role', 'group');
  shelves.setAttribute('aria-label', 'Where the clips come from');
  const shelfButtons = {};
  for (const [key, label] of [['library', 'Stock library'], ['mine', 'My media']]) {
    const b = el(doc, 'button', 'bp-shelf', label);
    b.type = 'button';
    b.dataset.testid = `broll-shelf-${key}`;
    b.addEventListener('click', () => { shelf = key; draw(); });
    shelves.append(b);
    shelfButtons[key] = b;
  }

  const search = el(doc, 'input', 'bp-search');
  search.type = 'search';
  search.placeholder = 'Search or describe what you need…';
  search.dataset.testid = 'broll-search';
  search.setAttribute('aria-label', 'Search clips by name or tag');
  const tagRow = el(doc, 'div', 'bp-tagrow');
  tagRow.dataset.testid = 'broll-tag-chips';

  const headRow = el(doc, 'div', 'bp-headrow');
  const heading = el(doc, 'h3', 'bp-h', 'Suggested for this moment');
  heading.dataset.testid = 'broll-heading';
  const momentPick = el(doc, 'div', 'bp-moments');
  headRow.append(heading, momentPick);
  const momentLine = el(doc, 'p', 'bp-moment');
  momentLine.dataset.testid = 'broll-moment';
  const grid = el(doc, 'div', 'bp-tiles');
  grid.dataset.testid = 'broll-tiles';
  const empty = el(doc, 'p', 'bp-empty');
  empty.dataset.testid = 'broll-empty';

  // Upload
  const uploadHead = el(doc, 'h3', 'bp-h', 'Upload your own');
  const drop = el(doc, 'div', 'bp-drop');
  drop.dataset.testid = 'broll-drop';
  const choose = el(doc, 'button', 'bp-choose');
  choose.type = 'button';
  choose.dataset.testid = 'broll-choose';
  choose.append(el(doc, 'strong', '', 'Drag and drop or browse'), el(doc, 'span', '', 'MP4, MOV, WebM, PNG or JPG'));
  const file = el(doc, 'input');
  file.type = 'file';
  file.accept = 'video/mp4,video/webm,video/quicktime,video/x-m4v,image/png,image/jpeg,.mp4,.webm,.mov,.m4v,.png,.jpg,.jpeg';
  file.dataset.testid = 'broll-file';
  file.className = 'sr-only';
  file.tabIndex = -1;
  file.setAttribute('aria-label', 'A video or picture from this computer');
  drop.append(choose, file);

  const status = el(doc, 'p', 'bp-status');
  status.dataset.testid = 'broll-status';
  status.setAttribute('role', 'status');

  // The clip on the picture
  const clipCard = el(doc, 'div', 'bp-card');
  clipCard.dataset.testid = 'broll-asset';
  const clipName = el(doc, 'strong', 'bp-name');
  const clipMeta = el(doc, 'span', 'bp-meta');
  clipCard.append(clipName, clipMeta);
  const field = (label, testid, hint) => {
    const wrap = el(doc, 'label', 'bp-field');
    const input = el(doc, 'input', 'bp-input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.inputMode = 'decimal';
    input.dataset.testid = testid;
    wrap.append(el(doc, 'span', 'bp-label', label), input);
    wrap.title = hint;
    return { wrap, input };
  };
  const fStart = field('Starts at (s)', 'broll-start', 'Where in the original recording the B-roll starts');
  const fEnd = field('Ends at (s)', 'broll-end', 'Where in the original recording the B-roll ends');
  const fIn = field('Skip into clip (s)', 'broll-inpoint', 'Which moment of the clip is shown first');
  const useStart = el(doc, 'button', 'bp-use', 'Start here');
  useStart.type = 'button';
  useStart.dataset.testid = 'broll-use-start';
  useStart.setAttribute('aria-label', 'Start the B-roll at the playhead');
  const useEnd = el(doc, 'button', 'bp-use', 'End here');
  useEnd.type = 'button';
  useEnd.dataset.testid = 'broll-use-end';
  useEnd.setAttribute('aria-label', 'End the B-roll at the playhead');
  // What a creator reads: where the clip starts and how long it shows. The exact numbers sit behind one click.
  const timing = el(doc, 'p', 'bp-timing');
  timing.dataset.testid = 'broll-timing';
  const fields = el(doc, 'details', 'bp-exact');
  fields.dataset.testid = 'broll-exact';
  const fieldRow = el(doc, 'div', 'bp-grid');
  fieldRow.append(fStart.wrap, fEnd.wrap, fIn.wrap);
  fields.append(el(doc, 'summary', 'bp-exact-open', 'Set exact times'), fieldRow);
  const uses = el(doc, 'div', 'bp-uses');
  uses.append(useStart, useEnd);
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
  fields.addEventListener('toggle', () => draw());
  const form = el(doc, 'div', 'bp-form');
  form.append(el(doc, 'h3', 'bp-h', 'On the picture'), clipCard, timing, uses, fields, check, actions);
  const saved = el(doc, 'p', 'bp-saved');
  saved.dataset.testid = 'broll-saved';

  const recentHead = el(doc, 'h3', 'bp-h', 'Recently used');
  const recent = el(doc, 'div', 'bp-recent');
  recent.dataset.testid = 'broll-recent';

  root.append(shelves, search, tagRow, headRow, momentLine, grid, empty, uploadHead, drop, status, form, saved, recentHead, recent);

  /** What the person is working on. `asset` is a clip the server has kept; `url` plays it before it is in the recording. */
  let draft = null; // { asset, start, end, inPoint, url? }
  let dirty = false;
  let shelf = 'library';
  let clips = [];
  let loaded = false;
  let momentAt = 0;

  const recording = () => hooks.getRecording();
  const kept = () => { const r = recording(); return r ? keptRanges(r.cuts, r.duration) : []; };
  const moments = () => { const r = recording(); return r ? suggestBrollMoments(r) : []; };
  /** The stretch a clip is added to: the chosen suggestion, or five seconds from the playhead when the take has none. */
  function moment() {
    const all = moments();
    if (all.length) return { ...all[Math.min(momentAt, all.length - 1)], suggested: true };
    const r = recording();
    const start = Math.max(0, Math.min(r.duration - BROLL_LIMITS.minSeconds, Math.round((hooks.getPlayhead() || 0) * 10) / 10));
    return { start, end: round3(Math.min(r.duration, start + PLAYHEAD_SECONDS)), text: '', suggested: false };
  }

  async function loadLibrary() {
    try { clips = (await call(scope, LIBRARY)).clips || []; } catch { clips = []; }
    loaded = true;
    draw();
  }

  function verdict() {
    if (!draft) return null;
    return checkBrollRange({ start: fStart.input.valueAsNumber, end: fEnd.input.valueAsNumber, inPoint: fIn.input.valueAsNumber }, draft.asset, recording().duration, kept());
  }
  function readInputs() {
    if (!draft) return;
    draft.start = fStart.input.valueAsNumber;
    draft.end = fEnd.input.valueAsNumber;
    draft.inPoint = fIn.input.valueAsNumber;
  }
  function showPreview() {
    if (!draft) { hooks.preview(null); return; }
    hooks.preview({ url: draft.url || brollMediaUrl(id, draft.asset.id), start: draft.start, end: draft.end, inPoint: draft.inPoint });
  }

  function tile(clip, at, small = false) {
    const m = moment();
    const b = el(doc, 'button', `bp-tile${small ? ' small' : ''}`);
    b.type = 'button';
    b.dataset.testid = small ? 'broll-recent-tile' : 'broll-tile';
    b.dataset.id = clip.id;
    b.dataset.source = clip.source;
    b.disabled = hooks.isBusy();
    b.setAttribute('aria-label', `Add ${clip.name} at ${formatTime(m.start)}`);
    b.title = clip.name;
    const img = el(doc, 'img');
    img.src = clip.poster;
    img.alt = '';
    img.loading = 'lazy';
    b.append(img, el(doc, 'span', 'bp-tile-name', clip.name), el(doc, 'span', 'bp-add', 'Add'));
    if (!small && at === 0) b.dataset.first = 'true';
    b.addEventListener('click', () => add(clip));
    return b;
  }

  function tagEditor(clip) {
    const wrap = el(doc, 'div', 'bp-mine');
    const input = el(doc, 'input', 'bp-tags');
    input.type = 'text';
    input.value = clip.tags.join(', ');
    input.placeholder = 'Add tags, with commas';
    input.dataset.testid = 'broll-tags';
    input.dataset.id = clip.id;
    input.setAttribute('aria-label', `Tags for ${clip.name}`);
    const commit = async () => {
      if (input.value.trim() === clip.tags.join(', ')) return;
      try {
        const answer = await call(scope, `${LIBRARY}/${clip.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: input.value }) });
        clips = clips.map((c) => (c.id === clip.id ? answer.clip : c));
        status.dataset.state = 'ok';
        status.textContent = answer.clip.tags.length ? `Tagged “${clip.name}”: ${answer.clip.tags.join(', ')}.` : `Tags cleared on “${clip.name}”.`;
      } catch (error) { status.dataset.state = 'problem'; status.textContent = error.message; }
      draw();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    const gone = el(doc, 'button', 'bp-forget', '×');
    gone.type = 'button';
    gone.dataset.testid = 'broll-forget';
    gone.setAttribute('aria-label', `Remove ${clip.name} from your media`);
    gone.title = 'Remove from your media';
    gone.addEventListener('click', async () => {
      try { clips = (await call(scope, `${LIBRARY}/${clip.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true }) })).clips; status.dataset.state = 'ok'; status.textContent = `Removed “${clip.name}” from your media.`; }
      catch (error) { status.dataset.state = 'problem'; status.textContent = error.message; }
      draw();
    });
    wrap.append(input, gone);
    return wrap;
  }

  function drawLibrary() {
    const m = moment();
    const all = moments();
    for (const [key, b] of Object.entries(shelfButtons)) b.setAttribute('aria-pressed', String(shelf === key));
    const onShelf = clips.filter((c) => c.source === shelf);
    const query = search.value.trim();
    const shown = query ? searchBrollClips(query, onShelf) : rankBrollClips(m.text, onShelf);
    heading.textContent = query ? (shown.length === 1 ? '1 result' : `${shown.length} results`) : shelf === 'mine' ? 'My media' : m.suggested ? 'Suggested for this moment' : 'Add at the playhead';
    momentPick.replaceChildren();
    if (all.length > 1) {
      all.forEach((x, i) => {
        const b = el(doc, 'button', 'bp-moment-pick', formatTime(x.start));
        b.type = 'button';
        b.dataset.testid = 'broll-moment-pick';
        b.setAttribute('aria-pressed', String(i === Math.min(momentAt, all.length - 1)));
        b.setAttribute('aria-label', `Suggested moment at ${formatTime(x.start)}`);
        b.addEventListener('click', () => chooseMoment(i));
        momentPick.append(b);
      });
    }
    const quote = m.text.length > 64 ? `${m.text.slice(0, 61).trimEnd()}…` : m.text;
    momentLine.textContent = `${formatTime(m.start)} to ${formatTime(m.end)}${quote ? ` · “${quote}”` : ''}`;
    // Tags worth trying: the ones on this shelf, most used first.
    const counts = new Map();
    for (const c of onShelf) for (const t of c.tags) counts.set(t, (counts.get(t) || 0) + 1);
    tagRow.replaceChildren(...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => {
      const chip = el(doc, 'button', 'bp-chip', t);
      chip.type = 'button';
      chip.dataset.testid = 'broll-tag-chip';
      chip.setAttribute('aria-pressed', String(query.toLowerCase() === t));
      chip.addEventListener('click', () => { search.value = query.toLowerCase() === t ? '' : t; draw(); });
      return chip;
    }));
    grid.replaceChildren();
    shown.forEach((clip, at) => {
      if (shelf !== 'mine') { grid.append(tile(clip, at)); return; }
      const cell = el(doc, 'div', 'bp-cell');
      cell.append(tile(clip, at), tagEditor(clip));
      grid.append(cell);
    });
    grid.dataset.shelf = shelf;
    empty.hidden = !loaded || shown.length > 0;
    empty.textContent = query ? `Nothing matches “${query}”.` : shelf === 'mine' ? 'Videos and pictures you add are kept here for every take.' : '';
    const used = clips.filter((c) => c.usedAt).sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt))).slice(0, 4);
    recentHead.hidden = recent.hidden = !used.length;
    recent.replaceChildren(...used.map((clip) => tile(clip, -1, true)));
  }

  function draw() {
    const r = recording();
    if (!r) return;
    if (!loaded && !draw.asked) { draw.asked = true; loadLibrary(); }
    const state = brollState(r);
    const busy = hooks.isBusy();
    if (!dirty) draft = state.asset ? { asset: state.asset, start: state.start, end: state.end, inPoint: state.inPoint } : null;
    drawLibrary();
    form.hidden = !draft;
    choose.disabled = busy;
    if (draft) {
      clipName.textContent = draft.asset.name;
      clipMeta.textContent = `${seconds(draft.asset.duration)} · ${draft.asset.width}×${draft.asset.height}`;
      for (const [f, v] of [[fStart, draft.start], [fEnd, draft.end], [fIn, draft.inPoint]]) {
        if (doc.activeElement !== f.input) f.input.value = Number.isFinite(v) ? String(round3(v)) : '';
        f.input.disabled = busy;
        f.input.max = f === fIn ? String(draft.asset.duration) : String(r.duration);
      }
      timing.textContent = Number.isFinite(draft.start) && Number.isFinite(draft.end) && draft.end > draft.start
        ? `Starts at ${formatTime(draft.start)} · ${seconds(draft.end - draft.start)}`
        : 'Move the player to where it should start, then press Start here.';
      const v = verdict();
      const bad = v && !v.ok;
      check.dataset.state = bad ? 'problem' : 'ok';
      // The plain line above says where the clip sits; the detail shows with the exact times, or when something is wrong.
      check.hidden = !bad && !fields.open;
      if (bad) check.textContent = v.error.replace(' Nothing was changed.', '');
      else {
        const win = brollWindows(kept(), v);
        const total = win.reduce((n, w) => n + (w.cutEnd - w.cutStart), 0);
        const removed = (v.end - v.start) - total;
        check.textContent = `Covers ${seconds(v.end - v.start)} of the recording${removed > 0.05 ? `, ${seconds(total)} of it in the part you keep` : ''}. The clip has ${seconds(draft.asset.duration - v.inPoint)} from here.`;
      }
      save.disabled = busy || bad || !dirty;
      save.setAttribute('aria-disabled', String(save.disabled));
      save.title = bad ? v.error : !dirty ? 'Nothing has changed since the last save' : 'Save this B-roll to the recording';
      reset.hidden = !dirty;
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
    saved.hidden = !state.asset && !draft;
    showPreview();
  }

  const touched = () => { readInputs(); dirty = true; draw(); };
  for (const f of [fStart, fEnd, fIn]) f.input.addEventListener('input', touched);
  const fromPlayhead = (input) => () => { input.value = String(round3(Math.max(0, hooks.getPlayhead() || 0))); touched(); };
  useStart.addEventListener('click', fromPlayhead(fStart.input));
  useEnd.addEventListener('click', fromPlayhead(fEnd.input));
  search.addEventListener('input', () => draw());

  function chooseMoment(index) {
    momentAt = Math.max(0, index);
    const m = moments()[momentAt];
    if (m && hooks.seek) hooks.seek(m.start);
    draw();
  }

  /** The range a clip takes when it is added: the moment, or as much of it as the clip can cover. */
  function rangeFor(asset) {
    const m = moment();
    const r = recording();
    const length = Math.max(BROLL_LIMITS.minSeconds, Math.min(asset.duration, m.end - m.start, r.duration - m.start));
    return { start: m.start, end: round3(m.start + length), inPoint: 0 };
  }

  async function upload(picked) {
    if (!picked || hooks.isBusy()) return;
    hooks.setBusy(true);
    status.dataset.state = 'working';
    status.textContent = `Checking “${picked.name}”…`;
    try {
      const result = await call(scope, LIBRARY, { method: 'PUT', headers: { 'Content-Type': picked.type || 'application/octet-stream', 'X-Yap-File-Name': encodeURIComponent(String(picked.name || '').slice(0, 200)) }, body: picked });
      const clip = result.clip;
      clips = [...clips.filter((c) => c.id !== clip.id), clip];
      shelf = clip.source;
      search.value = '';
      draft = { asset: clip, url: clip.url, ...rangeFor(clip) };
      dirty = true;
      status.dataset.state = 'ok';
      status.textContent = `${result.reused ? 'Already added to your media' : 'Added to your media'}: “${clip.name}”, ${seconds(clip.duration)}. Choose where it shows, then save.`;
    } catch (error) {
      status.dataset.state = 'problem';
      status.textContent = error.message || 'The file could not be added. Nothing was saved.';
    } finally {
      hooks.setBusy(false);
      draw();
    }
  }
  choose.addEventListener('click', () => { if (!choose.disabled) file.click(); });
  file.addEventListener('change', () => { const picked = file.files && file.files[0]; file.value = ''; upload(picked); });
  for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, (event) => { event.preventDefault(); drop.dataset.over = 'true'; });
  for (const name of ['dragleave', 'drop']) drop.addEventListener(name, () => { delete drop.dataset.over; });
  drop.addEventListener('drop', (event) => { event.preventDefault(); upload(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]); });

  async function change(patch, say) {
    if (hooks.isBusy()) return;
    hooks.setBusy(true);
    try {
      const answer = await changeBroll(id, { ...patch, expectedRevision: brollState(recording()).revision });
      dirty = false;
      if (answer.changed) hooks.invalidateExport();
      if (answer.recording) hooks.apply(answer.recording);
      // Said here, in the panel the person is looking at; nothing drops over the buttons under the picture.
      status.dataset.state = 'ok';
      status.textContent = say(answer);
      if (patch.op === 'set') loadLibrary();
    } catch (error) {
      status.dataset.state = 'problem';
      status.textContent = error.message || 'That could not be saved. Nothing was changed.';
      hooks.toast(status.textContent);
    } finally {
      hooks.setBusy(false);
      draw();
    }
  }

  /** One press: the clip goes on the moment and is saved. */
  function add(clip) {
    if (hooks.isBusy()) return;
    const range = rangeFor(clip);
    change({ op: 'set', assetId: clip.id, ...range },
      (a) => (a.changed ? `“${clip.name}” is on the picture from ${formatTime(range.start)}. Play the cut to see it.` : 'That clip is already there.'));
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
    /** The suggested moments of this take and the one a clip would be added to. */
    moments,
    momentIndex: () => Math.min(momentAt, Math.max(0, moments().length - 1)),
    chooseMoment,
  };
}
