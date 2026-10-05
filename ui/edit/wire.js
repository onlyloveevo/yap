import {mountLiveUiDownloads} from '../lib/live-ui-controls.js';
import {applyLaptopEditorLayout} from '../lib/laptop-layout.js';
import {parseWav} from '../../src/engine/wav.js';
import {waveformPeaks} from '../lib/waveform.js';
import { createClipPreviews, attachClipPreviews } from '../lib/clip-previews.js';
import { isShellMode, comingSoon, sayQuietly, go } from '../lib/app.js';
import { getRecording, restoreCut, exportRecording, trimRecording } from '../lib/api.js';
import { createTrimEditor, currentTrim, labelTrimClips } from '../lib/trim-editor.js';
import { createEditorRail } from '../lib/editor-rail.js';
import { createBrollPreview } from '../lib/broll-preview.js';
import { brollState } from '../../src/engine/broll-plan.js';
import { matchRoute, routeFor } from '../lib/routes.js';
import { clipsFromCuts, lengths, skipTarget, cutTime, mediaFor, formatTime } from '../lib/edit-model.js';
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
 words: '<path d="M4 6h16M4 12h10M4 18h16"/>'
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
function render() {
 const total = lengths(clips);
 get('view-original').querySelector('small').textContent = `Full recording (${formatTime(total.original)})`;
 get('view-yapcut').querySelector('small').textContent = total.yapCut === total.original ? `No cuts applied (${formatTime(total.yapCut)})` : `A cleaner, tighter version (${formatTime(total.yapCut)})`;
 for (const name of ['original','yapcut']) get('view-' + name).setAttribute('aria-pressed', String(view === name));
 get('clips').replaceChildren();
 for (const [index, clip] of clips.entries()) {
  const active = selected === index, tile = el('button', 'clip');
  const trimEdge = !shellMode && recording?.cuts?.cuts?.some(c => c.id === clip.cutId && c.kind === 'trim');
  const durationLabel = clip.seconds > 0 && clip.seconds < 1 ? `${clip.seconds.toFixed(1)}s` : formatTime(clip.seconds);
  Object.assign(tile.dataset, { testid: 'clip', state: clip.state, duration: String(clip.seconds), selected: String(active), index: String(index), cutId: clip.cutId || '', reviewState: clip.reviewState || '', certainty: clip.certainty || '' });
  tile.style.flexGrow = String(clip.seconds);
  if (!shellMode && clipPreviews) attachClipPreviews(tile, clip, clipPreviews);
  if (clip.reviewState === 'pending') { tile.style.borderColor = 'var(--amber)'; tile.setAttribute('title', 'Suggested cut. Audio is kept until you click Apply.'); }
  tile.setAttribute('aria-label', `Clip ${index + 1}, ${clipDuration(clip.seconds)}, ${clip.state}${clip.cutId ? ', click to ' + (clip.state === 'removed' ? 'restore' : clip.reviewState === 'pending' ? 'apply suggested cut' : 'remove again') : ''}`);
  tile.setAttribute('aria-pressed', String(active));
  if (clip.label) {
   const label = el('span', 'clip-label' + (clip.label === 'Best take' ? ' best' : ''));
   label.dataset.testid = 'clip-label';
   if (clip.reviewState === 'pending') { label.style.color = 'var(--amber)'; label.style.border = '1px solid var(--amber)'; }
   if (clip.state === 'removed') label.append(icon('trash'));
   label.append(document.createTextNode(clip.label + (trimEdge ? ` · ${durationLabel}` : '')));
   if (clip.label === 'Best take') label.append(icon('sparkle'));
   tile.append(label);
  }
  if (!trimEdge) tile.append(el('span', 'duration', durationLabel));
  if (active) {
   tile.append(el('span','clip-handle start'), el('span','clip-handle end'));
   if (clip.state === 'kept') { const b = el('span', 'kept-bubble', shellMode ? "kept, that's you" : total.yapCut === total.original ? 'Original retained' : 'Clip kept'); b.dataset.testid = 'kept-bubble'; tile.append(b); }
  }
  get('clips').append(tile);
 }
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
  status.hidden=Boolean(peaks.length);status.textContent=waveformLoading?'Preparing audio waveform…':'Audio waveform unavailable. You can still play the original video.';
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
  const on = rail.captionsEnabled(), cc = get('cc');
  cc.setAttribute('aria-pressed', String(on)); cc.setAttribute('aria-label', on ? 'Captions on: turn off' : 'Captions off: turn on'); cc.title = on ? 'Captions are on for this recording' : 'Turn captions on for this recording';
  cc.disabled = busy; cc.style.opacity = on ? '1' : '.7';
 }
}
function updateTime() {
 const total = lengths(clips), time = player?.currentTime || 0;
 brollPreview?.sync();
 get('time').textContent = `${formatTime(view === 'yapcut' ? cutTime(clips, time) : time)} / ${formatTime(view === 'yapcut' ? total.yapCut : total.original)}`;
 get('playhead').style.left = `${total.original ? time / total.original * 100 : 0}%`;
 if(!shellMode){const wave=get('waveform');wave.setAttribute('aria-valuemax',String(total.original));wave.setAttribute('aria-valuenow',String(Math.round(time*1000)/1000));wave.setAttribute('aria-valuetext',`Original recording ${formatTime(time)} of ${formatTime(total.original)}${view==='yapcut'?'; YAP cut '+formatTime(cutTime(clips,time)):''}`);wave.setAttribute('aria-disabled',String(!player||!total.original));}
 get('player').dataset.playing = String(Boolean(player && !player.paused));
 if (!shellMode && rail) rail.tick();
 get('play').setAttribute('aria-label', player && !player.paused ? 'Pause preview' : 'Play preview');
 get('play').setAttribute('aria-pressed', String(Boolean(player && !player.paused)));
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
 wave.tabIndex=0;wave.setAttribute('role','slider');wave.setAttribute('aria-label','Seek in original recording');wave.setAttribute('aria-valuemin','0');wave.setAttribute('aria-orientation','horizontal');wave.title='Seek in original time. Arrow keys move 1 second; Home and End reach the ends. YAP cut skips removed spans.';
 wave.style.cursor='pointer';wave.style.touchAction='none';
 const hint=el('p','','Seek recording · drag or use ← →');hint.dataset.testid='seek-hint';hint.style.cssText='font-size:12px;color:var(--muted,#aaa);margin:6px 0 0';wave.after(hint);
 wave.addEventListener('focus',()=>{wave.style.outline='2px solid var(--amber)';wave.style.outlineOffset='3px';});wave.addEventListener('blur',()=>{wave.style.outline='';wave.style.outlineOffset='';});
 const seek=(time,direction=1)=>{if(!player||busy)return;const end=lengths(clips).original;let target=Math.max(0,Math.min(end,time));if(view==='yapcut'){if(direction<0){for(const clip of [...clips].reverse())if(clip.state==='removed'&&target>=clip.start&&target<clip.end)target=Math.max(0,clip.start-.001);}else target=skipTarget(clips,target)??target;}player.currentTime=target;if(target>=end)player.pause();updateTime();};
 const pointerSeek=event=>{const box=wave.getBoundingClientRect();if(box.width)seek((event.clientX-box.left)/box.width*lengths(clips).original);};
 wave.addEventListener('pointerdown',event=>{if(event.button!==0||!player||busy)return;event.preventDefault();dragging=true;wave.focus({preventScroll:true});wave.setPointerCapture(event.pointerId);pointerSeek(event);});
 wave.addEventListener('pointermove',event=>{if(dragging)pointerSeek(event);});
 wave.addEventListener('pointerup',event=>{if(!dragging)return;pointerSeek(event);dragging=false;if(wave.hasPointerCapture(event.pointerId))wave.releasePointerCapture(event.pointerId);});
 wave.addEventListener('pointercancel',()=>{dragging=false;});
 wave.addEventListener('keydown',event=>{if(!player)return;const steps={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10};if(event.key==='Home'||event.key==='End'||Object.hasOwn(steps,event.key)){event.preventDefault();seek(event.key==='Home'?0:event.key==='End'?lengths(clips).original:player.currentTime+steps[event.key],steps[event.key]<0?-1:1);}});
 {const button=get('help');button.disabled=true;button.setAttribute('aria-label','Help, unavailable');button.title='Help is not available in this demo';button.hidden=true;}
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
    if (get('export-download') || get('export-cuts-download')) { dropStaleExport(); toast('Cut changed. Export again to download the updated YAP cut.'); }
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
get('cc').addEventListener('click', () => { if (shellMode) comingSoon(document, 'Captions'); else if (rail && recording && !busy) rail.toggleCaptions(); });
if (shellMode) for (const [name, label] of [['broll','B-roll'],['help','Help']]) get(name).addEventListener('click', () => comingSoon(document, label));
else {
 get('edit-words').hidden = false;
 for (const name of ['edit-words', 'broll']) {
  get(name).setAttribute('aria-controls', 'editor-rail-panel');
  get(name).addEventListener('click', () => { if (rail && recording && !busy) rail.open(get(name).dataset.railEntry, { from: get(name) }); });
 }
}
if (shellMode) get('shorten').addEventListener('click', () => comingSoon(document, 'Shorten'));
get('keep').addEventListener('click', () => {
 const clip = clips[selected];
 if (!clip || busy) return;
 if (clip.state === 'removed') get('clips').children[selected]?.click();
 else toast('This clip is already kept.');
});
get('retry').addEventListener('click', () => { if (shellMode) comingSoon(document, 'Retry'); else if (recording) go(routeFor('return', { id })); });
if (!shellMode) { get('retry').lastChild.textContent = 'Next take'; get('retry').setAttribute('aria-label', 'Prepare the next take') }
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
  if(!response.ok){if(response.status===409||response.status===400){reviewRequired=true;get('export').disabled=true;}const failure=await response.json().catch(()=>null);throw new Error(failure?.error||'Download could not finish. Reload to review the current cut and export again.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),download=el('a');
  download.href=url;download.download=link.download;download.hidden=true;document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){
  exportReviewNotice(error.message);
 }finally{downloading=false;}
});
get('export').addEventListener('click', async () => {
 if (shellMode) return toast(`Export: YAP cut (${formatTime(lengths(clips).yapCut)})`);
 if (!recording || busy || reviewRequired) return;
 busy = true; get('export').disabled = true;
 const captioned = Boolean(rail && rail.captionsEnabled());
 toast(captioned ? 'Drawing captions and writing your YAP cut…' : 'Writing your YAP cut…')?.setAttribute('role','status');
 try {
  const made = rail ? await rail.exportExtras() : { extra: {}, cueCount: 0 };
  const result = await exportRecording(id,globalThis,{duration:recording.duration,cuts:recording.cuts.cuts.map(({id,start,end,applied})=>({id,start,end,applied}))},made.extra);
  const path = result.outputs?.video || result.outputs?.audio;
  const note = typeof result.video === 'string' ? result.video : result.video?.note;
  const laid = result.broll?.applied ? ` B-roll is laid over the picture${result.broll.windows?.length > 1 ? ` in ${result.broll.windows.length} parts` : ''}; your original voice plays throughout.` : '';
  const burned = result.captions?.burned ? ` ${result.captions.cueCount} ${result.captions.cueCount === 1 ? 'caption is' : 'captions are'} burned in.` : result.captions ? ` No captions were burned in: ${result.captions.note || 'there was nothing to caption.'}` : '';
  const box = toast(path ? (result.outputs?.video ? `Your MP4 is ready.${laid}${burned}` : `Your audio is ready.${note ? ' '+note : ''}`) : 'Export completed without a downloadable media file.');
  if (box && result.downloadUrl && /^\/(?![/\\])/.test(result.downloadUrl)) {
   const link = el('a', '', result.outputs?.video ? ' Download video' : ' Download audio');
   link.href = result.downloadUrl; link.download = `YAP-${id}.mp4`; link.dataset.testid = 'export-download'; link.style.color = 'var(--amber)'; box.append(link);
  }
  if (box && result.cutsDownloadUrl && /^\/(?![/\\])/.test(result.cutsDownloadUrl)) {
   const link = el('a', '', 'Download cut list');link.href=result.cutsDownloadUrl;link.download=`YAP-${id}.cuts.json`;link.dataset.testid='export-cuts-download';Object.assign(link.style,{color:'var(--amber)',marginLeft:'18px'});box.append(link);
  }
  // Keep a completed export visible until the next action; the user needs its download link.
  if (box) { const copy = box.cloneNode(true); Object.assign(copy.style,{bottom:'auto',top:'96px',pointerEvents:'none'}); for(const link of copy.querySelectorAll('a'))link.style.pointerEvents='auto'; box.replaceWith(copy); }
 } catch (err) {
  if(err.status===409||err.status===400){reviewRequired=true;exportReviewNotice(err.message);}
  else {
   // A long export can fail after the operator looked away: keep the failure up (like the success notice) until the next action.
   const box=toast(`Export failed: ${err.message}`);
   if(box){const copy=box.cloneNode(true);Object.assign(copy.style,{bottom:'auto',top:'96px',pointerEvents:'none'});copy.setAttribute('role','alert');box.replaceWith(copy);}
  }
 }
 finally { busy = false; get('export').disabled = reviewRequired; }
});
// Trim recording (Shorten): the engine's trimStart/trimEnd, saved by the server against the cut this page is showing.
function dropStaleExport() { for (const name of ['export-download', 'export-cuts-download']) document.querySelectorAll(`[data-testid="${name}"]`).forEach(link => link.remove()); }
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
  Object.assign(player.style, { position:'absolute', inset:'0', width:'100%', height:'100%', objectFit:'contain', background:'#130f0e' });
  player.src = mediaFor(recording, answer.meta);
  clipPreviews = createClipPreviews(player.src, recording.duration);
  window.addEventListener('pagehide', event => { if (!event.persisted) clipPreviews?.dispose(); });
  get('player').prepend(player);
  ambientBackdrop(player);
  get('story-overlay').hidden = true; get('story-overlay').style.display = 'none';
  // The camera preview never contains the on-screen prompts or decorative copy.
  document.querySelector('.player-note').hidden = true;
  player.addEventListener('loadedmetadata', skipRemoved);
  for (const event of ['timeupdate','seeked']) player.addEventListener(event, () => { if (!player.paused) skipRemoved(); updateTime(); });
  for (const event of ['play','pause','ended','loadedmetadata']) player.addEventListener(event, updateTime);
  player.addEventListener('error', () => toast('This recording could not be loaded. The saved take and its cuts are still here.'));
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
