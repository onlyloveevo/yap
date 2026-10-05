import {mountLiveUiDownloads} from '../lib/live-ui-controls.js';
import {applyLaptopEditorLayout} from '../lib/laptop-layout.js';
import {parseWav} from '../../src/engine/wav.js';
import {waveformPeaks} from '../lib/waveform.js';
import { createClipPreviews, attachClipPreviews } from '../lib/clip-previews.js';
import { isShellMode, sayQuietly, go } from '../lib/app.js';
import { getRecording, restoreCut, exportRecording, trimRecording } from '../lib/api.js';
import { createTrimEditor, currentTrim, labelTrimClips } from '../lib/trim-editor.js';
import { createEditorRail } from '../lib/editor-rail.js';
import { createBrollPreview } from '../lib/broll-preview.js';
import { brollState, brollWindows } from '../../src/engine/broll-plan.js';
import { edlDocument, fcp7XmlDocument } from '../../src/engine/export.js';
import { matchRoute, routeFor } from '../lib/routes.js';
import { clipsFromCuts, lengths, skipTarget, cutTime, mediaFor, formatTime, exactKeptRanges, placeTags, tagRank } from '../lib/edit-model.js';
const shellMode = isShellMode(location);
if (!shellMode) applyLaptopEditorLayout(document);
const id = matchRoute(location.pathname, location.search)?.params.id;
const get = id => document.querySelector(`[data-testid="${id}"]`);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const paths = {
 play: '<path d="m7 4 14 8-14 8Z" fill="currentColor" stroke="none"/>',
 cc: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M10 9H7v6h3m9-6h-3v6h3"/>',
 volume: '<path d="M3 9h4l5-4v14l-5-4H3Zm13-1c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/>',
 fullscreen: '<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6m5-7h8v8H8Z"/>',
 export: '<path d="M12 16V2m-5 5 5-5 5 5M5 12H3v9h18v-9h-2"/>',
 scissors: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m4 3 13 13M20 3 7 16m5-6v1"/>',
 crop: '<path d="M7 2v15h15M2 7h15v15M3 3l2 2m14 14 2 2"/>',
 retry: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
 image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
 trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
 sparkle: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
 words: '<path d="M4 6h16M4 12h10M4 18h16"/>',
 download: '<path d="M12 3v13m-5-5 5 5 5-5M4 21h16"/>',
 chevron: '<path d="m6 9 6 6 6-6"/>',
 chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>'
};
const icon = name => { const e = el('span'); e.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`; return e.firstChild; };
document.querySelectorAll('[data-icon]').forEach(e => e.replaceChildren(icon(e.dataset.icon)));
let recording = null, clips = [], selected = 0, view = 'yapcut', busy = false, player = null, peaks = [], waveformLoading = true, clipPreviews = null, trimEditor = null, rail = null, brollPreview = null;
// The rail (Transcript, Autocut, Captions) is built here, beside the player, so the frozen shell page and its stylesheet stay as they were.
if (!shellMode) {
 const link = el('link'); link.rel = 'stylesheet'; link.href = '../lib/editor-panel.css'; document.head.append(link);
 const stage = el('div', 'editor-stage'); stage.dataset.testid = 'editor-stage';
 get('player').before(stage); stage.append(get('player'));
 rail = createEditorRail({ document, stage, id, hooks: {
  getRecording: () => recording,
  getPlayer: () => player,
  getView: () => view,
  isBusy: () => busy,
  setBusy: value => { busy = value; render(); },
  toast: text => toast(text),
  seek: time => { if (player) { player.currentTime = Math.max(0, time); updateTime(); } },
  invalidateExport: () => dropStaleExport(),
  previewBroll: draft => brollPreview?.set(draft),
  openTrim: () => { if (recording && player && !busy) trimEditor.open(); },
  nextTake: () => go(routeFor('return', { id })),
  // A saved change from the rail: take the recording the server answered with, re-cut the timeline, keep the playhead's clip.
  apply: saved => {
   recording = saved;
   clips = labelTrimClips(clipsFromCuts(recording.cuts, recording.duration), recording.cuts);
   const heldAt = player?.currentTime || 0, here = clips.findIndex(c => heldAt >= c.start && heldAt < c.end);
   selected = here >= 0 ? here : Math.max(0, clips.findIndex(c => c.state === 'kept'));
   skipRemoved();
   render();
  }
 } });
}
if (shellMode) {
 let at = 0;
 clips = [[18,'kept',''],[7,'removed','Aside removed'],[22,'kept','Best take'],[9,'removed',''],[22,'kept',''],[16,'removed','Filler removed'],[28,'kept',''],[14,'kept','B-roll added'],[20,'kept','']].map(([seconds,state,label], index) => { const c = { index, id: `drawn-${index}`, cutId: state === 'removed' ? `c${index}` : null, start: at, end: at + seconds, seconds, state, label }; at += seconds; return c; });
 selected = 4;
}
const clipDuration=seconds=>seconds>0&&seconds<1?`${seconds.toFixed(1)} seconds`:formatTime(seconds);
function toast(text) { return sayQuietly(document, text); }
// The tags above the strip share one line: after each draw they are measured and moved apart so none touches another.
// A tag with no room gives way (the pause first) and its words stay on the clip's own label and tooltip.
function spreadTags() {
 const strip = get('clips'), box = strip.getBoundingClientRect();
 if (!box.width) return;
 const tags = [...strip.querySelectorAll('.clip-label, .kept-bubble')];
 for (const tag of tags) { tag.style.translate = ''; tag.hidden = false; }
 const shown = tags.filter(tag => getComputedStyle(tag).display !== 'none');
 const measured = shown.map(tag => { const r = tag.getBoundingClientRect(), c = tag.parentElement.getBoundingClientRect(); return { left: r.left, width: r.width, rank: tagRank(tag.textContent), clipLeft: c.left, clipRight: c.right }; });
 placeTags(measured, { left: box.left, right: box.right }).forEach((place, i) => {
  const tag = shown[i];
  tag.hidden = place.hidden;
  if (place.dx) tag.style.translate = `${place.dx}px 0`;
  if (place.hidden) tag.parentElement.title = tag.textContent;
 });
}
function render() {
 const total = lengths(clips);
 const laid = !shellMode && recording ? brollState(recording) : { asset: null };
 get('view-original').querySelector('small').textContent = `Full recording (${formatTime(total.original)})`;
 get('view-yapcut').querySelector('small').textContent = total.yapCut === total.original ? `No cuts applied (${formatTime(total.yapCut)})` : `A cleaner, tighter version (${formatTime(total.yapCut)})`;
 for (const name of ['original','yapcut']) get('view-' + name).setAttribute('aria-pressed', String(view === name));
 get('clips').replaceChildren();
 for (const [index, clip] of clips.entries()) {
  const active = selected === index, tile = el('button', 'clip');
  const trimEdge = !shellMode && recording?.cuts?.cuts?.some(c => c.id === clip.cutId && c.kind === 'trim');
  const durationLabel = clip.seconds > 0 && clip.seconds < 1 ? `${clip.seconds.toFixed(1)}s` : formatTime(clip.seconds);
  // The clip the saved B-roll starts on says so, as the strip says what was removed.
  const text = clip.state === 'kept' && (!clip.label || clip.label === 'Best take') && laid.asset && laid.start >= clip.start && laid.start < clip.end ? 'B-roll added' : clip.label;
  Object.assign(tile.dataset, { testid: 'clip', state: clip.state, duration: String(clip.seconds), selected: String(active), index: String(index), cutId: clip.cutId || '', reviewState: clip.reviewState || '', certainty: clip.certainty || '' });
  tile.style.flexGrow = String(clip.seconds);
  if (!shellMode && clipPreviews) attachClipPreviews(tile, clip, clipPreviews);
  if (clip.reviewState === 'pending') { tile.style.borderColor = 'var(--amber)'; tile.setAttribute('title', 'Suggested cut. Audio is kept until you click Apply.'); }
  tile.setAttribute('aria-label', `Clip ${index + 1}, ${clipDuration(clip.seconds)}, ${clip.state}${clip.cutId ? ', click to ' + (clip.state === 'removed' ? 'restore' : clip.reviewState === 'pending' ? 'apply suggested cut' : 'remove again') : ''}`);
  tile.setAttribute('aria-pressed', String(active));
  if (text) {
   const label = el('span', 'clip-label' + (text === 'Best take' ? ' best' : ''));
   label.dataset.testid = 'clip-label';
   if (clip.reviewState === 'pending') { label.style.color = 'var(--amber)'; label.style.border = '1px solid var(--amber)'; }
   if (clip.state === 'removed') label.append(icon('trash'));
   if (text === 'B-roll added') label.append(icon('image'));
   label.append(document.createTextNode(text + (trimEdge ? ` · ${durationLabel}` : '')));
   if (text === 'Best take') label.append(icon('sparkle'));
   tile.append(label);
  }
  if (!trimEdge) tile.append(el('span', 'duration', durationLabel));
  if (active) {
   tile.append(el('span','clip-handle start'), el('span','clip-handle end'));
   // A kept clip that already carries a tag of its own (Best take, B-roll added) says it is kept: one tag per clip.
   if (clip.state === 'kept' && !text && (shellMode || total.yapCut !== total.original)) { const b = el('span', 'kept-bubble', "kept, that's you"); b.dataset.testid = 'kept-bubble'; tile.append(b); }
  }
  get('clips').append(tile);
 }
 spreadTags();
 const current = clips[selected];
 if (!shellMode) {
  get('shorten').disabled = busy || !recording || !player;
  get('keep').disabled = busy || !current || current.state === 'kept';
  get('keep').hidden = !current || current.state === 'kept';
  get('keep').lastChild.textContent = current?.state === 'removed' ? 'Keep clip' : 'Clip kept';
  get('keep').dataset.status = current?.state === 'removed' ? 'restore' : 'kept';
  get('keep').setAttribute('aria-label', current?.state === 'removed' ? 'Restore and keep selected clip' : 'Selected clip is already kept');
  get('keep').title = current?.state === 'removed' ? 'Restore the selected interval in the YAP cut.' : 'This interval is already included in the YAP cut.';
 }
 const start = current?.start || 0, end = current?.end || 0;
 get('wave-selection').hidden = !current;
 get('wave-selection').style.left = `${total.original ? start / total.original * 100 : 0}%`;
 get('wave-selection').style.width = `${total.original ? (end - start) / total.original * 100 : 0}%`;
 // The frozen design reference retains its drawn waveform; live takes use PCM.
 const bars=shellMode?Array.from({length:420},(_,i)=>(5+((i*17+i*i*7)%25))/30):peaks;
 const wave=document.querySelector('.wave-bars');
 wave.dataset.waveformState=shellMode?'reference':peaks.length?'audio':'unavailable';
 wave.setAttribute('aria-label',shellMode?'Reference waveform':peaks.length?'Waveform of the original recording':'Audio waveform unavailable');
 if(!shellMode){
  let status=document.querySelector('[data-testid="waveform-status"]');
  if(!status){status=el('p','waveform-status');status.dataset.testid='waveform-status';status.style.cssText='font-size:12px;color:var(--muted,#777);margin:6px 0 0';get('waveform').after(status);}
  status.hidden=Boolean(peaks.length);status.textContent=waveformLoading?'Drawing your audio…':'This take has no audio to draw.';
 }

 wave.innerHTML=bars.map((level,i)=>{
  const x=i*1400/bars.length+1,h=Math.max(1,Math.sqrt(level)*28);
  const active=total.original && i/bars.length>=start/total.original && i/bars.length<end/total.original;
  return `<path d="M${x} ${28-h/2}v${h}"${active?' style="stroke:var(--wave-bright)"':''}/>`;
 }).join('');
 updateTime();
 if (!shellMode && rail && recording) {
  rail.refresh();
  const pending = rail.pendingAutocut(), badge = get('edit-words-badge');
  badge.hidden = !pending; badge.textContent = pending ? String(pending) : '';
  get('edit-words').setAttribute('aria-label', pending ? `Edit words, ${pending} automatic ${pending === 1 ? 'cut' : 'cuts'} waiting for you` : 'Edit words: open the transcript');
  get('edit-words').disabled = busy;
  const b = brollState(recording), bb = get('broll');
  bb.lastChild.textContent = b.asset ? 'B-roll' : 'Add B-roll';
  bb.setAttribute('aria-label', b.asset ? `B-roll: ${b.asset.name} is on the picture, open to change` : 'Add B-roll: lay a video from this computer over the picture');
  bb.dataset.state = b.asset ? 'on' : 'off';
  bb.disabled = busy;
  let band = document.querySelector('[data-testid="broll-band"]');
  if (!band) { band = el('div', 'broll-band'); band.dataset.testid = 'broll-band'; band.setAttribute('aria-hidden', 'true'); get('waveform').prepend(band); }
  band.hidden = !b.asset || !total.original;
  if (b.asset && total.original) { band.style.left = `${b.start / total.original * 100}%`; band.style.width = `${(b.end - b.start) / total.original * 100}%`; band.title = `B-roll: ${b.asset.name}`; }
  // Where YAP suggests B-roll: a dashed stretch on the waveform. A press opens the clips for that moment.
  document.querySelectorAll('[data-testid="broll-suggestion"]').forEach(mark => mark.remove());
  if (total.original) rail.brollMoments().forEach((m, i) => {
   if (b.asset && m.start < b.end && m.end > b.start) return;
   const mark = el('button', 'broll-suggestion'); mark.type = 'button';
   Object.assign(mark.dataset, { testid: 'broll-suggestion', index: String(i), start: String(m.start), end: String(m.end) });
   mark.style.left = `${m.start / total.original * 100}%`; mark.style.width = `${(m.end - m.start) / total.original * 100}%`;
   mark.setAttribute('aria-label', `B-roll would fit at ${formatTime(m.start)}. Open clips for this moment`);
   mark.setAttribute('aria-pressed', String(rail.isOpen() && rail.activeTab() === 'broll' && rail.brollMomentIndex() === i));
   mark.append(icon('image'), el('span', '', 'B-roll'));
   mark.disabled = busy;
   mark.addEventListener('pointerdown', event => event.stopPropagation());
   mark.addEventListener('click', event => { event.stopPropagation(); rail.open('broll', { from: get('broll') }); rail.chooseBrollMoment(i); render(); });
   get('waveform').append(mark);
  });
  const on = rail.captionsEnabled(), cc = get('cc');
  cc.setAttribute('aria-pressed', String(on)); cc.setAttribute('aria-label', on ? 'Captions on: turn off' : 'Captions off: turn on'); cc.title = on ? 'Captions are on for this recording' : 'Turn captions on for this recording';
  cc.disabled = busy; cc.style.opacity = on ? '1' : '.7';
 }
}
function updateTime() {
 const total = lengths(clips), time = player?.currentTime || 0;
 if (!shellMode) showBeat(time);
 brollPreview?.sync();
 get('time').textContent = `${formatTime(view === 'yapcut' ? cutTime(clips, time) : time)} / ${formatTime(view === 'yapcut' ? total.yapCut : total.original)}`;
 get('playhead').style.left = `${total.original ? time / total.original * 100 : 0}%`;
 if(!shellMode){const wave=get('waveform');wave.setAttribute('aria-valuemax',String(total.original));wave.setAttribute('aria-valuenow',String(Math.round(time*1000)/1000));wave.setAttribute('aria-valuetext',`Original recording ${formatTime(time)} of ${formatTime(total.original)}${view==='yapcut'?'; YAP cut '+formatTime(cutTime(clips,time)):''}`);wave.setAttribute('aria-disabled',String(!player||!total.original));}
 get('player').dataset.playing = String(Boolean(player && !player.paused));
 if (!shellMode && rail) rail.tick();
 get('play').setAttribute('aria-label', player && !player.paused ? 'Pause preview' : 'Play preview');
 get('play').setAttribute('aria-pressed', String(Boolean(player && !player.paused)));
}
// The beat being spoken at the playhead, from the take's own beat times. A take with no beat times shows no card.
function showBeat(time) {
 const spoken = (recording?.beats || []).filter(b => { const take = b.takes?.find(t => t.id === b.chosenTakeId) || b.takes?.[0]; return take && time >= take.start; }).at(-1);
 const overlay = get('story-overlay');
 overlay.style.display = spoken ? '' : 'none';
 if (spoken) overlay.querySelector('h1').textContent = spoken.title;
}
function skipRemoved() {
 if (!player || view !== 'yapcut') return;
 const target = skipTarget(clips, player.currentTime);
 if (target != null) {
  if (target >= lengths(clips).original - 0.02) {
   const lastKept = [...clips].reverse().find(clip => clip.state === 'kept');
   player.currentTime = lastKept ? Math.max(lastKept.start, lastKept.end - .001) : 0;
   player.pause();
  } else player.currentTime = target;
 }
}
if(!shellMode){
 const wave=get('waveform');let dragging=false;
 wave.tabIndex=0;wave.setAttribute('role','slider');wave.setAttribute('aria-label','Seek in original recording');wave.setAttribute('aria-valuemin','0');wave.setAttribute('aria-orientation','horizontal');
 wave.style.cursor='pointer';wave.style.touchAction='none';
 wave.addEventListener('focus',()=>{wave.style.outline='2px solid var(--amber)';wave.style.outlineOffset='3px';});wave.addEventListener('blur',()=>{wave.style.outline='';wave.style.outlineOffset='';});
 const seek=(time,direction=1)=>{if(!player||busy)return;const end=lengths(clips).original;let target=Math.max(0,Math.min(end,time));if(view==='yapcut'){if(direction<0){for(const clip of [...clips].reverse())if(clip.state==='removed'&&target>=clip.start&&target<clip.end)target=Math.max(0,clip.start-.001);}else target=skipTarget(clips,target)??target;}player.currentTime=target;if(target>=end)player.pause();updateTime();};
 const pointerSeek=event=>{const box=wave.getBoundingClientRect();if(box.width)seek((event.clientX-box.left)/box.width*lengths(clips).original);};
 wave.addEventListener('pointerdown',event=>{if(event.button!==0||!player||busy)return;event.preventDefault();dragging=true;wave.focus({preventScroll:true});wave.setPointerCapture(event.pointerId);pointerSeek(event);});
 wave.addEventListener('pointermove',event=>{if(dragging)pointerSeek(event);});
 wave.addEventListener('pointerup',event=>{if(!dragging)return;pointerSeek(event);dragging=false;if(wave.hasPointerCapture(event.pointerId))wave.releasePointerCapture(event.pointerId);});
 wave.addEventListener('pointercancel',()=>{dragging=false;});
 wave.addEventListener('keydown',event=>{if(!player)return;const steps={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10};if(event.key==='Home'||event.key==='End'||Object.hasOwn(steps,event.key)){event.preventDefault();seek(event.key==='Home'?0:event.key==='End'?lengths(clips).original:player.currentTime+steps[event.key],steps[event.key]<0?-1:1);}});
 get('help').hidden=true;document.querySelector('.menu').hidden=true;
 get('cc').disabled=true;get('cc').setAttribute('aria-label','Captions, loading');
}
get('clips').addEventListener('click', async event => {
 const tile = event.target.closest('[data-testid="clip"]');
 if (!tile || busy) return;
 const index = Number(tile.dataset.index), clip = clips[index];
 if (!clip) return;
 if (clip.cutId) {
  if (shellMode) {
   clip.state = clip.state === 'removed' ? 'kept' : 'removed';
   if (clip.state === 'kept') { clip.priorLabel = clip.label; clip.label = 'Restored'; }
   else clip.label = clip.priorLabel || '';
  } else {
   busy = true;
   try {
    const saved = await restoreCut(id, clip.cutId);
    recording = saved.recording || saved;
    clips = labelTrimClips(clipsFromCuts(recording.cuts, recording.duration), recording.cuts);
    selected = Math.max(0, clips.findIndex(c => c.cutId === clip.cutId));
    skipRemoved();
    // Export links describe a saved snapshot, not the newly changed timeline.
    // Replace both links only once this cut decision has reached disk.
    if (get('export-download')) { dropStaleExport(); toast('Cut changed. Export again to download the updated YAP cut.'); }
   } catch (err) { toast(`Could not change the cut: ${err.message}`); }
   finally { busy = false; }
  }
 } else { selected = index; if (player) player.currentTime = clip.start; }
 render();
 const focus = [...get('clips').children].find(c => c.dataset.cutId === clip.cutId) || get('clips').children[selected];
 focus?.focus({ preventScroll: true });
});
for (const name of ['original','yapcut']) get('view-' + name).addEventListener('click', () => { view = name; skipRemoved(); render(); });
get('play').addEventListener('click', async () => {
 if (!player) return;
 try {
  if (player.paused) {
   if (view === 'yapcut' && !lengths(clips).yapCut) return toast('Every clip is removed. Restore a clip to play the YAP cut.');
   const playbackEnd = view === 'yapcut' ? [...clips].reverse().find(clip => clip.state === 'kept')?.end ?? 0 : lengths(clips).original;
   if (player.ended || player.currentTime >= playbackEnd - .02) player.currentTime = 0;
   skipRemoved(); await player.play();
  } else player.pause();
  updateTime();
 } catch (err) { toast(`Preview could not play: ${err.message}`); }
});
get('volume').addEventListener('click', () => { if (player) { player.muted = !player.muted; get('volume').setAttribute('aria-pressed', String(player.muted)); } });
const syncFullscreen = () => { const on = document.fullscreenElement === get('player'), button = get('fullscreen'), label = on ? 'Exit fullscreen' : 'Fullscreen'; button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', label); button.title = label; };
get('fullscreen').addEventListener('click', async () => {
 const stage = get('player');
 try {
  if (document.fullscreenElement === stage) await document.exitFullscreen();
  else if (typeof stage.requestFullscreen !== 'function' || document.fullscreenEnabled === false) toast('Fullscreen is not available in this browser.');
  else await stage.requestFullscreen();
 } catch (err) { toast(`Fullscreen failed: ${err.message || 'the browser refused'}`); }
 syncFullscreen();
});
document.addEventListener('fullscreenchange', syncFullscreen);
syncFullscreen();
get('cc').addEventListener('click', () => { if (!shellMode && rail && recording && !busy) rail.toggleCaptions(); });
if (shellMode) {
 // The drawn reference: Add B-roll goes to the clip that carries B-roll.
 get('broll').addEventListener('click', () => { const at = clips.findIndex(c => c.label === 'B-roll added'); if (at >= 0) { selected = at; render(); } });
}
else {
 get('edit-words').hidden = false;
 for (const name of ['edit-words', 'broll']) {
  get(name).setAttribute('aria-controls', 'editor-rail-panel');
  get(name).addEventListener('click', () => { if (rail && recording && !busy) rail.open(get(name).dataset.railEntry, { from: get(name) }); });
 }
}
get('keep').addEventListener('click', () => {
 const clip = clips[selected];
 if (!clip || busy) return;
 if (clip.state === 'removed') get('clips').children[selected]?.click();
 else toast('This clip is already kept.');
});
get('retry').addEventListener('click', () => { if (!shellMode && recording) go(routeFor('return', { id })); });
if (!shellMode) {
 get('retry').lastChild.textContent = 'Next take'; get('retry').setAttribute('aria-label', 'Prepare the next take');
 // Review for this take: what worked, and what to try next.
 if (id) { const review = el('a', 'glass review-link'); review.href = `/review/${id}`; review.dataset.testid = 'open-review'; review.append(icon('chart'), document.createTextNode('Review this take')); document.querySelector('.header-actions').prepend(review); }
}
// Fetch the pinned response before initiating a browser download. A rejected
// identity is an operator message, never a JSON error saved as an MP4.
let downloading=false,reviewRequired=false;
function exportReviewNotice(message){
 const box=toast(message);if(box){const review=el('a','','Reload to review');review.href=location.href;review.dataset.testid='export-review';Object.assign(review.style,{color:'var(--amber)',marginLeft:'18px',pointerEvents:'auto',whiteSpace:'nowrap'});box.append(review);const copy=box.cloneNode(true);Object.assign(copy.style,{bottom:'auto',top:'96px',pointerEvents:'none'});box.replaceWith(copy);}
}
document.addEventListener('click',async event=>{
 const link=event.target.closest('[data-testid="export-download"],[data-testid="export-cuts-download"]');
 if(!link||shellMode)return;
 event.preventDefault();if(downloading)return;downloading=true;
 try{
  const response=await fetch(link.href,{mode:'same-origin',credentials:'same-origin',cache:'no-store'});
  if(!response.ok){if(response.status===409||response.status===400){reviewRequired=true;dropStaleExport();get('export').disabled=true;}const failure=await response.json().catch(()=>null);throw new Error(failure?.error||'Download could not finish. Reload to review the current cut and export again.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),download=el('a');
  download.href=url;download.download=link.download;download.hidden=true;document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){
  exportReviewNotice(error.message);
 }finally{downloading=false;}
});
// Export works in the Export button's own place, then that place becomes one Download control with the other formats behind it.
function setExporting(on) {
 const button = get('export');
 button.dataset.state = on ? 'working' : 'idle'; button.setAttribute('aria-busy', String(on));
 button.lastChild.textContent = on ? 'Exporting…' : 'Export';
}
function exportStatus(text) {
 let line = get('export-status');
 if (!line) { line = el('p', 'sr-only'); line.dataset.testid = 'export-status'; line.setAttribute('role', 'status'); document.querySelector('.view-row').append(line); }
 line.textContent = text;
}
function showDownloads(result, notes) {
 dropStaleExport();
 const box = el('div', 'export-ready'); box.dataset.testid = 'export-ready';
 const main = el('a', 'export-main'); main.href = result.downloadUrl; main.download = `YAP-${id}.mp4`; main.dataset.testid = 'export-download';
 main.append(icon('download'), document.createTextNode(result.outputs?.video ? 'Download' : 'Download audio'));
 const more = el('button', 'export-more'); more.type = 'button'; more.dataset.testid = 'export-more';
 more.setAttribute('aria-label', 'More formats'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.append(icon('chevron'));
 const menu = el('div', 'export-menu glass'); menu.dataset.testid = 'export-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
 const item = (label, hint, href, name, testid) => { const a = el('a', 'export-item'); a.setAttribute('role', 'menuitem'); a.href = href; a.download = name; a.dataset.testid = testid; a.append(el('strong', '', label), el('small', '', hint)); menu.append(a); };
 if (result.outputs?.video) {
  // The same cut as timelines other editors open, written from the clips on this strip. They point at the original recording by the name its MP4 download carries.
  const kept = exactKeptRanges(recording), over = brollState(recording), clipName = `YAP-${id}-original.mp4`, title = `YAP cut ${recording.title || id}`;
  const broll = over.asset ? { name: over.asset.name, duration: over.asset.duration, windows: brollWindows(kept, over) } : null;
  const blob = (text, type) => { const url = URL.createObjectURL(new Blob([text], { type })); exportBlobs.push(url); return url; };
  item('Premiere Pro', 'XML timeline', blob(fcp7XmlDocument({ title, clipName, duration: recording.duration, keptRanges: kept, width: player?.videoWidth || 1920, height: player?.videoHeight || 1080, broll }), 'application/xml'), `YAP-${id}.xml`, 'export-xml-download');
  item('DaVinci Resolve', 'EDL timeline', blob(edlDocument({ title, clipName, keptRanges: kept, broll }), 'text/plain'), `YAP-${id}.edl`, 'export-edl-download');
  item('Original recording', 'MP4 for the timelines', `/api/app/originals/${id}`, clipName, 'export-original-download');
 }
 if (result.cutsDownloadUrl && /^\/(?![/\\])/.test(result.cutsDownloadUrl)) item('Cut list', 'JSON', result.cutsDownloadUrl, `YAP-${id}.cuts.json`, 'export-cuts-download');
 if (notes) { const note = el('p', 'export-note', notes); note.dataset.testid = 'export-note'; menu.append(note); }
 const setMenu = open => { menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); };
 more.addEventListener('click', event => { event.stopPropagation(); setMenu(menu.hidden); });
 box.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { setMenu(false); more.focus(); } });
 // A press elsewhere closes the menu. The page's own click on a finished download is not a press.
 document.addEventListener('click', event => { if (event.isTrusted && !box.contains(event.target)) setMenu(false); });
 box.append(main, more, menu);
 get('export').hidden = true; get('export').after(box);
}
get('export').addEventListener('click', async () => {
 if (shellMode) return toast(`Export: YAP cut (${formatTime(lengths(clips).yapCut)})`);
 if (!recording || busy || reviewRequired) return;
 busy = true; get('export').disabled = true; setExporting(true);
 // An earlier failure notice has had its answer: this export.
 document.querySelectorAll('[data-testid="toast"]').forEach(note => { note.hidden = true; });
 const captioned = Boolean(rail && rail.captionsEnabled());
 exportStatus(captioned ? 'Drawing captions and writing your YAP cut…' : 'Writing your YAP cut…');
 try {
  const made = rail ? await rail.exportExtras() : { extra: {}, cueCount: 0 };
  const result = await exportRecording(id,globalThis,{duration:recording.duration,cuts:recording.cuts.cuts.map(({id,start,end,applied})=>({id,start,end,applied}))},made.extra);
  const path = result.outputs?.video || result.outputs?.audio;
  const note = typeof result.video === 'string' ? result.video : result.video?.note;
  const laid = result.broll?.applied ? `B-roll is laid over the picture${result.broll.windows?.length > 1 ? ` in ${result.broll.windows.length} parts` : ''}; your original voice plays throughout.` : '';
  const burned = result.captions?.burned ? `${result.captions.cueCount} ${result.captions.cueCount === 1 ? 'caption is' : 'captions are'} burned in.` : result.captions ? `No captions were burned in: ${result.captions.note || 'there was nothing to caption.'}` : '';
  const notes = [laid, burned].filter(Boolean).join(' ');
  if (path && result.downloadUrl && /^\/(?![/\\])/.test(result.downloadUrl)) {
   showDownloads(result, notes);
   exportStatus(result.outputs?.video ? `Your MP4 is ready.${notes ? ' ' + notes : ''}` : `Your audio is ready.${note ? ' ' + note : ''}`);
  } else { exportStatus(''); toast('Export completed without a downloadable media file.'); }
 } catch (err) {
  exportStatus('');
  if(err.status===409||err.status===400){reviewRequired=true;exportReviewNotice(err.message);}
  else {
   // A long export can fail after the operator looked away: keep the failure up until the next action.
   const box=toast(`Export failed: ${err.message}`);
   if(box){const copy=box.cloneNode(true);Object.assign(copy.style,{bottom:'auto',top:'96px',pointerEvents:'none'});copy.setAttribute('role','alert');box.replaceWith(copy);}
  }
 }
 finally { busy = false; setExporting(false); get('export').disabled = reviewRequired; }
});
// Trim recording (Shorten): the engine's trimStart/trimEnd, saved by the server against the cut this page is showing.
const exportBlobs = [];
function dropStaleExport() {
 document.querySelectorAll('[data-testid="export-ready"]').forEach(box => box.remove());
 for (const url of exportBlobs.splice(0)) URL.revokeObjectURL(url);
 get('export').hidden = false; exportStatus('');
}
const cutSnapshot = r => ({ duration: r.duration, cuts: r.cuts.cuts.map(({ id, start, end, applied }) => ({ id, start, end, applied })) });
async function saveTrim(patch, describe) {
 busy = true; render();
 try {
  const heldAt = player?.currentTime || 0;
  const saved = await trimRecording(id, { ...patch, expectedCutSnapshot: cutSnapshot(recording) });
  recording = saved.recording;
  clips = labelTrimClips(clipsFromCuts(recording.cuts, recording.duration), recording.cuts);
  // Stay on the clip under the playhead; a playhead now inside a removed span moves on to the next kept time in YAP cut.
  const here = clips.findIndex(c => heldAt >= c.start && heldAt < c.end);
  selected = here >= 0 ? here : Math.max(0, clips.findIndex(c => c.state === 'kept'));
  skipRemoved();
  if (saved.changed) { dropStaleExport(); toast(describe(recording)); }
  else toast('Trim unchanged. Nothing new was saved.');
 } finally { busy = false; render(); }
}
if (!shellMode) {
 trimEditor = createTrimEditor({
  document, trigger: get('shorten'),
  getDuration: () => recording?.duration || 0,
  getPlayhead: () => player ? player.currentTime : NaN,
  getTrim: () => currentTrim(recording.cuts, recording.duration),
  apply: ({ start, end }) => saveTrim({ start, end }, r => {
   const t = currentTrim(r.cuts, r.duration);
   return `Trim saved: keeping ${t.start.toFixed(2)}–${t.end.toFixed(2)} s of the original (${(t.end - t.start).toFixed(2)} s). Export again to download this edit.`;
  }),
  reset: () => saveTrim({ reset: true }, () => 'Trim removed. Other cuts are unchanged. Export again to download this edit.')
 });
 get('shorten').addEventListener('click', () => { if (recording && player && !busy) trimEditor.open(); });
 get('shorten').setAttribute('aria-label', 'Shorten: trim the start or end of the recording');
 get('shorten').title = 'Trim the start or end of the recording. The original stays whole.';
}
async function open() {
 if (shellMode) { render(); return; }
 get('export').disabled = true;
 try {
  const answer = await getRecording(id);
  if (!answer) throw new Error('There is no recording at this address.');
  recording = answer.recording;
  if (recording.status !== 'ready') throw new Error('This take has not finished saving. Return to the recording and stop it first.');
  clips = labelTrimClips(clipsFromCuts(recording.cuts, recording.duration), recording.cuts);
  selected = Math.max(0, clips.findIndex(c => c.state === 'kept'));
  player = document.createElement('video'); player.dataset.testid = 'preview-video'; player.preload = 'metadata'; player.playsInline = true;
  if (answer.meta?.sample) { player.classList.add('is-sample'); const tag = el('span', 'sample-tag', 'Sample'); tag.dataset.testid = 'sample-tag'; get('player').append(tag); }
  player.src = mediaFor(recording, answer.meta);
  clipPreviews = createClipPreviews(player.src, recording.duration);
  window.addEventListener('pagehide', event => { if (!event.persisted) clipPreviews?.dispose(); });
  get('player').prepend(player);
  ambientBackdrop(player);
  player.addEventListener('loadedmetadata', skipRemoved);
  for (const event of ['timeupdate','seeked']) player.addEventListener(event, () => { if (!player.paused) skipRemoved(); updateTime(); });
  for (const event of ['play','pause','ended','loadedmetadata']) player.addEventListener(event, updateTime);
  player.addEventListener('error', () => toast('This take did not load. It is still saved, with its cuts.'));
  get('export').disabled = false;
  get('cc').disabled = false;
  brollPreview = createBrollPreview({ document, player });
  render();
  fetch(`/api/app/recordings/${id}/audio`,{signal:AbortSignal.timeout(65000)})
   .then(r=>{if(!r.ok)throw new Error('audio unavailable');return r.arrayBuffer();})
   .then(buffer=>{peaks=waveformPeaks(parseWav(new Uint8Array(buffer)).samples);waveformLoading=false;render();})
   .catch(()=>{peaks=[];waveformLoading=false;render();});
  mountLiveUiDownloads({document,id,container:document.querySelector('.edit-shell')}).catch(error=>toast(error.message));
  if(recording.processingNote)toast(recording.processingNote);
 } catch (err) { render(); toast(err.message); }
}
// A tiny blurred, dimmed copy of the frame already on screen fills the dark sides of the 16:9 player. Nothing new is decoded: it is drawn from the visible player, or from a timeline frame that is already decoded until the player has one.
function ambientBackdrop(video) {
 const canvas = el('canvas', 'ambient'); canvas.width = 64; canvas.height = 36; canvas.setAttribute('aria-hidden', 'true'); canvas.dataset.testid = 'ambient-backdrop';
 document.querySelector('.edit-shell').prepend(canvas);
 const ctx = canvas.getContext('2d'); let last = 0, fromVideo = false;
 const draw = source => { try { ctx.save(); ctx.globalAlpha = 1; ctx.drawImage(source, 0, 0, canvas.width, canvas.height); ctx.globalAlpha = .5; ctx.translate(canvas.width, 0); ctx.scale(-1, 1); ctx.drawImage(source, 0, 0, canvas.width, canvas.height); ctx.restore(); canvas.dataset.ready = 'true'; } catch {} };
 const fromPlayer = () => { if (video.readyState >= 2 && video.videoWidth) { fromVideo = true; draw(video); } };
 for (const event of ['loadeddata','seeked','pause']) video.addEventListener(event, fromPlayer);
 video.addEventListener('timeupdate', () => { const now = Date.now(); if (now - last > 500) { last = now; fromPlayer(); } });
 new MutationObserver(() => { if (fromVideo) return; const img = get('clips').querySelector('img'); if (img?.complete && img.naturalWidth) draw(img); }).observe(get('clips'), { childList:true, subtree:true });
}
open();
// The strip changes width when the side panel opens or the window is resized: the tags are laid out again.
if (typeof ResizeObserver === 'function') new ResizeObserver(() => spreadTags()).observe(get('clips'));
