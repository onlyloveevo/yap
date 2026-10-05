// The editor's side panel: Transcript, Autocut, Captions and B-roll tabs. It stays closed until the person asks for it
// (the "Edit words", Captions and B-roll buttons under the picture), so the camera picture and timeline come first. It
// builds the panels, asks the server for every change (src/server/editor-api.js
// through ui/lib/api.js), and tells the page (edit/wire.js) when the saved
// recording changed. It claims success only after the server has saved the
// change, and says so plainly when nothing changed.
//
// There is one saved recording: this file keeps no copy of the cut or the
// captions, it reads them from the recording the page hands it each time.

import { editWords, changeAutocuts, changeCaptions } from './api.js';
import { exactKeptRanges, formatTime } from './edit-model.js';
import { createTranscriptPanel } from './editor-transcript.js';
import { createAutocutPanel } from './editor-autocut.js';
import { createCaptionOverlay, captionTilesFor } from './editor-captions.js';
import { createBrollPanel } from './broll-panel.js';
import { brollState } from '../../src/engine/broll-plan.js';
import { transcriptStatus, timedWords, wordStates, removedRuns, describeUndo, autocutReview } from '../../src/engine/editor-words.js';
import { captionState, buildCaptionCues, cueAt, sourceToCut, cutToSource, CAPTION_COPY } from '../../src/engine/caption-model.js';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const snapshot = (r) => ({ duration: r.duration, cuts: r.cuts.cuts.map(({ id, start, end, applied }) => ({ id, start, end, applied })) });

/**
 * @param {{ document: Document, stage: HTMLElement, id: string, hooks: {
 *   getRecording: () => any, apply: (recording: any) => void, getPlayer: () => HTMLVideoElement | null, getView: () => string,
 *   seek: (t: number) => void, toast: (text: string) => void, invalidateExport: () => void, openTrim: () => void,
 *   nextTake: () => void, isBusy: () => boolean, setBusy: (busy: boolean) => void,
 *   previewBroll: (draft: { url: string, start: number, end: number, inPoint: number } | null) => void } }} options
 */
export function createEditorRail({ document: doc, stage, id, hooks }) {
  const rail = el(doc, 'aside', 'editor-rail');
  rail.dataset.testid = 'editor-rail';
  rail.id = 'editor-rail-panel';
  rail.setAttribute('aria-label', 'Edit the recording');
  const head = el(doc, 'div', 'rail-head');
  const tabs = el(doc, 'div', 'rail-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = {};
  const panels = {};

  const transcript = createTranscriptPanel({
    document: doc,
    onSeek: (t) => hooks.seek(t),
    onRemove: ({ from, to, count }) => removeWords(from, to, count),
    onRestore: (cutId) => restoreRun(cutId),
    onUndo: () => undo(),
    onCorrect: (i, text) => correct(i, text),
    onRecover: (action) => (action === 'shorten' ? hooks.openTrim() : hooks.nextTake()),
  });
  const autocut = createAutocutPanel({ document: doc, onJump: (t) => hooks.seek(t), onChange: (change) => changeAuto(change) });

  // Captions tab
  const captionsPanel = el(doc, 'section', 'cp');
  captionsPanel.dataset.testid = 'panel-captions';
  const toggle = el(doc, 'button', 'cp-switch');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.dataset.testid = 'captions-toggle';
  const toggleLabel = el(doc, 'span', 'cp-switch-label', 'Burn captions into the export');
  const toggleKnob = el(doc, 'i', 'cp-knob');
  toggleKnob.setAttribute('aria-hidden', 'true');
  toggle.append(toggleLabel, toggleKnob);
  const capStatus = el(doc, 'p', 'cp-status');
  capStatus.dataset.testid = 'captions-status';
  const capNote = el(doc, 'p', 'cp-note', 'Captions use the saved timed words only. To correct a word, select it in Transcript and edit its caption text. The saved transcript stays as it is.');
  const capList = el(doc, 'ul', 'cp-list');
  capList.dataset.testid = 'caption-list';
  captionsPanel.append(toggle, capStatus, capNote, capList);

  const broll = createBrollPanel({ document: doc, id, hooks: {
    getRecording: hooks.getRecording,
    getPlayhead: () => { const p = hooks.getPlayer(); return p ? p.currentTime || 0 : 0; },
    isBusy: hooks.isBusy,
    setBusy: hooks.setBusy,
    toast: hooks.toast,
    apply: hooks.apply,
    invalidateExport: hooks.invalidateExport,
    preview: hooks.previewBroll,
  } });

  const defs = [['transcript', 'Transcript', transcript.element], ['autocut', 'Autocut', autocut.element], ['captions', 'Captions', captionsPanel], ['broll', 'B-roll', broll.element]];
  let active = 'transcript';
  for (const [key, label, panel] of defs) {
    const b = el(doc, 'button', 'rail-tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.testid = `rail-tab-${key}`;
    b.id = `rail-tab-${key}`;
    b.setAttribute('aria-controls', `rail-panel-${key}`);
    b.append(el(doc, 'span', 'rail-tab-name', label), el(doc, 'span', 'rail-badge'));
    b.addEventListener('click', () => select(key));
    b.addEventListener('keydown', (event) => {
      const at = defs.findIndex(([k]) => k === key);
      const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!move) return;
      event.preventDefault();
      const next = defs[(at + move + defs.length) % defs.length][0];
      select(next);
      tabButtons[next].focus();
    });
    tabs.append(b);
    tabButtons[key] = b;
    panel.id = `rail-panel-${key}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `rail-tab-${key}`);
    panels[key] = panel;
  }
  const closeButton = el(doc, 'button', 'rail-close');
  closeButton.type = 'button';
  closeButton.dataset.testid = 'rail-close';
  closeButton.setAttribute('aria-label', 'Close the editing panel');
  closeButton.title = 'Close the editing panel';
  closeButton.textContent = '×';
  head.append(tabs, closeButton);
  rail.append(head, ...defs.map(([, , p]) => p));
  stage.append(rail);

  // The panel is closed until asked for; the choice is kept for this browser tab so a reload does not shut it.
  const KEY = 'yap-edit-panel';
  let opener = null;
  const remembered = () => { try { return doc.defaultView.sessionStorage.getItem(KEY); } catch { return null; } };
  const remember = (value) => { try { if (value) doc.defaultView.sessionStorage.setItem(KEY, value); else doc.defaultView.sessionStorage.removeItem(KEY); } catch { /* storage may be off */ } };
  function setOpen(on) {
    rail.hidden = !on;
    stage.dataset.rail = on ? 'open' : 'closed';
    for (const button of doc.querySelectorAll('[data-rail-entry]')) button.setAttribute('aria-expanded', String(on && button.dataset.railEntry === active));
  }
  /** Open the panel on a tab. Focus moves to that tab, so the keyboard lands where the action was asked for. */
  function open(key, { focus = true, from = null } = {}) {
    if (!panels[key]) key = 'transcript';
    if (from) opener = from;
    select(key);
    setOpen(true);
    remember(key);
    if (focus) {
      tabButtons[key].focus({ preventScroll: true });
      if (stage.getBoundingClientRect().width < 1001) rail.scrollIntoView({ block: 'nearest' });
    }
  }
  function close() {
    setOpen(false);
    remember(null);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  closeButton.addEventListener('click', close);
  rail.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close(); } });

  function select(key) {
    active = key;
    for (const [k] of defs) {
      tabButtons[k].setAttribute('aria-selected', String(k === key));
      tabButtons[k].tabIndex = k === key ? 0 : -1;
      panels[k].hidden = k !== key;
    }
    for (const button of doc.querySelectorAll('[data-rail-entry]')) button.setAttribute('aria-expanded', String(!rail.hidden && button.dataset.railEntry === key));
  }
  select('transcript');

  { const was = remembered(); if (was && panels[was]) { select(was); setOpen(true); } else setOpen(false); }

  let overlay = null;
  let cueCache = { key: '', cues: [], ranges: null };

  function cuesNow() {
    const rec = hooks.getRecording();
    const view = hooks.getView();
    const caps = captionState(rec);
    const key = `${view}|${caps.revision}|${JSON.stringify(rec.cuts.cuts.map((c) => [c.id, c.start, c.end, c.applied]))}`;
    if (cueCache.key !== key) {
      const ranges = view === 'yapcut' ? exactKeptRanges(rec) : null;
      cueCache = { key, ranges, cues: buildCaptionCues(rec.transcript, { corrections: caps.corrections, duration: rec.duration, ranges }) };
    }
    return cueCache;
  }

  // ---- saving: one path for every change; success is claimed only from the server's answer ----
  async function run(call, say) {
    if (hooks.isBusy()) return;
    hooks.setBusy(true);
    try {
      const saved = await call();
      if (saved.changed) { hooks.invalidateExport(); }
      if (saved.recording) hooks.apply(saved.recording);
      hooks.toast(say(saved, saved.recording));
    } catch (error) {
      hooks.toast(error.message || 'That could not be saved. Nothing was changed.');
    } finally {
      hooks.setBusy(false);
    }
  }
  const cutLine = (rec) => `The YAP cut is now ${formatTime(exactKeptRanges(rec).reduce((n, [s, e]) => n + (e - s), 0))}.`;

  const removeWords = (from, to, count) => run(
    () => editWords(id, { op: 'delete', from, to, expectedCutSnapshot: snapshot(hooks.getRecording()) }),
    (saved, rec) => (saved.changed
      ? `Removed ${count} ${count === 1 ? 'word' : 'words'} from the YAP cut. ${cutLine(rec)} The original is untouched; Restore or Undo brings them back. Export again to download this edit.${saved.note ? ` ${saved.note}` : ''}`
      : saved.note || 'Nothing changed.'),
  );
  const restoreRun = (cutId) => run(
    () => editWords(id, { op: 'restore', cutId, expectedCutSnapshot: snapshot(hooks.getRecording()) }),
    (saved, rec) => (saved.changed ? `Restored. ${cutLine(rec)} Export again to download this edit.` : saved.note || 'Nothing changed.'),
  );
  const undo = () => run(
    () => editWords(id, { op: 'undo', expectedCutSnapshot: snapshot(hooks.getRecording()) }),
    (saved, rec) => (saved.changed ? `Undone. ${cutLine(rec)} Export again to download this edit.` : saved.note || 'Nothing to undo.'),
  );
  const changeAuto = (change) => run(
    () => changeAutocuts(id, { ...change, expectedCutSnapshot: snapshot(hooks.getRecording()) }),
    (saved, rec) => {
      if (!saved.changed) return saved.note || 'Nothing changed.';
      const n = saved.count;
      const what = change.op === 'restore' || change.op === 'restore-all' ? 'Restored' : 'Applied';
      return `${what} ${n} automatic ${n === 1 ? 'cut' : 'cuts'}. ${cutLine(rec)} Export again to download this edit.`;
    },
  );
  const setCaptions = (patch, say) => run(
    () => changeCaptions(id, { ...patch, expectedRevision: captionState(hooks.getRecording()).revision }),
    (saved) => (saved.changed ? say(saved) : 'Nothing changed.'),
  );
  const correct = (i, text) => setCaptions({ op: 'correct', i, text }, () => (text.trim() ? 'Caption text saved. Export again to burn it in.' : 'Caption text reset to the saved word.'));
  const toggleCaptions = () => {
    const rec = hooks.getRecording();
    const on = !captionState(rec).enabled;
    return setCaptions({ op: 'enable', enabled: on }, () => (on ? 'Captions on. They show in the preview and are burned into the next export.' : 'Captions off. The next export has none.'));
  };
  toggle.addEventListener('click', () => { if (!toggle.disabled) toggleCaptions(); });

  // ---- drawing ----
  function renderCaptionsPanel(rec, status) {
    const caps = captionState(rec);
    const { cues } = cuesNow();
    const view = hooks.getView();
    toggle.setAttribute('aria-checked', String(caps.enabled));
    toggle.dataset.state = caps.enabled ? 'on' : 'off';
    toggle.disabled = hooks.isBusy() || !status.usable;
    capStatus.dataset.state = !status.usable ? 'unavailable' : caps.enabled ? 'on' : 'off';
    capStatus.textContent = !status.usable
      ? CAPTION_COPY.noWords
      : !caps.enabled
        ? CAPTION_COPY.off
        : cues.length
          ? `Captions are on. ${cues.length} ${cues.length === 1 ? 'caption' : 'captions'} ${view === 'yapcut' ? 'in the YAP cut' : 'on the original'}${cues.some((c) => c.corrected) ? `, ${cues.filter((c) => c.corrected).length} with corrected text` : ''}. The preview follows the view you are watching.`
          : CAPTION_COPY.noneInCut;
    capList.replaceChildren();
    capList.hidden = !caps.enabled || !cues.length;
    if (!capList.hidden) {
      for (const cue of cues) {
        const li = el(doc, 'li', 'cp-item');
        li.dataset.testid = 'caption-item';
        li.dataset.id = cue.id;
        li.dataset.start = String(cue.shownFrom);
        const b = el(doc, 'button', 'cp-cue');
        b.type = 'button';
        b.append(el(doc, 'span', 'cp-time', formatTime(cue.shownFrom)), el(doc, 'span', 'cp-text', cue.text));
        if (cue.corrected) b.append(el(doc, 'span', 'cp-edited', 'edited'));
        b.addEventListener('click', () => hooks.seek(view === 'yapcut' ? cutToSource(cue.shownFrom, cueCache.ranges || []) : cue.shownFrom));
        li.append(b);
        capList.append(li);
      }
    }
  }

  function refresh() {
    const rec = hooks.getRecording();
    if (!rec) return;
    const status = transcriptStatus(rec.transcript, rec.duration);
    const timed = timedWords(rec.transcript, rec.duration);
    const states = wordStates(timed, rec.cuts, rec.duration);
    const caps = captionState(rec);
    const corrections = new Map();
    for (const x of caps.corrections) if (rec.transcript[x.i] && rec.transcript[x.i].text === x.was) corrections.set(x.i, x.text);
    const busy = hooks.isBusy();
    transcript.render({
      status, all: Array.isArray(rec.transcript) ? rec.transcript : [], states, runs: removedRuns(states), corrections,
      undoLabel: describeUndo(rec.cuts), busy, removedCount: states.filter((w) => w.removed).length,
    });
    const review = autocutReview(rec.cuts, rec.transcript, rec.duration);
    autocut.render(review, busy);
    tabButtons.autocut.querySelector('.rail-badge').textContent = review.counts.pending ? String(review.counts.pending) : '';
    tabButtons.autocut.querySelector('.rail-badge').hidden = !review.counts.pending;
    tabButtons.autocut.setAttribute('aria-label', review.counts.pending ? `Autocut, ${review.counts.pending} waiting for you` : 'Autocut');
    tabButtons.captions.querySelector('.rail-badge').textContent = caps.enabled ? 'on' : '';
    tabButtons.captions.querySelector('.rail-badge').hidden = !caps.enabled;
    renderCaptionsPanel(rec, status);
    broll.refresh();
    const bs = brollState(rec);
    tabButtons.broll.querySelector('.rail-badge').textContent = bs.asset ? 'on' : '';
    tabButtons.broll.querySelector('.rail-badge').hidden = !bs.asset;
    tick();
  }

  /** Called as the player moves: the caption for this moment and the word being spoken. */
  function tick() {
    const rec = hooks.getRecording();
    const player = hooks.getPlayer();
    if (!rec || !player) return;
    const t = player.currentTime || 0;
    const timed = timedWords(rec.transcript, rec.duration);
    const word = timed.find((w) => t >= w.start && t < w.end);
    transcript.setCurrent(word ? word.i : null);
    if (!overlay) overlay = createCaptionOverlay({ document: doc, player: player.parentElement, video: player });
    const caps = captionState(rec);
    if (!caps.enabled) { overlay.show(null); return; }
    const { cues, ranges } = cuesNow();
    const at = ranges ? sourceToCut(t, ranges) : t;
    overlay.show(at === null ? null : cueAt(cues, at));
  }

  return {
    refresh,
    tick,
    toggleCaptions,
    captionsEnabled: () => captionState(hooks.getRecording()).enabled,
    brollRevision: () => brollState(hooks.getRecording()).revision,
    select,
    open,
    close,
    isOpen: () => !rail.hidden,
    /** The tab the panel was left on in this browser tab, or null when it was closed. */
    remembered,
    pendingAutocut: () => { const rec = hooks.getRecording(); return rec ? autocutReview(rec.cuts, rec.transcript, rec.duration).counts.pending : 0; },
    element: rail,
    /** What Export sends besides the cut: the caption and B-roll state shown and, when captions are on, one drawing per cue. */
    async exportExtras() {
      const rec = hooks.getRecording();
      const caps = captionState(rec);
      const expectedBroll = { revision: brollState(rec).revision };
      if (!caps.enabled) return { extra: { expectedCaptions: { enabled: false, revision: caps.revision }, expectedBroll }, cueCount: 0 };
      const cues = buildCaptionCues(rec.transcript, { corrections: caps.corrections, duration: rec.duration, ranges: exactKeptRanges(rec) });
      return { extra: { expectedCaptions: { enabled: true, revision: caps.revision }, expectedBroll, captionTiles: await captionTilesFor(doc, cues) }, cueCount: cues.length };
    },
    activeTab: () => active,
  };
}
