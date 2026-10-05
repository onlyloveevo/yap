import {isShellMode,go,sayQuietly,comingSoon} from '../lib/app.js';
import {getRecording,getMemory,getTrials,saveTrial,saveTake,uploadMedia} from '../lib/api.js';
import {railModel,storyModel,panelModel,FIRST_CUT_WORDS} from '../lib/live-view.js';
import {DRAWN} from '../lib/drawn.js';
import {captureSavePlan,LARGE_CAPTURE_NOTE,uploadUncertain as isUploadUncertain,saveFailureView} from '../lib/capture-save-policy.js';
import {runPageTake,finishPageTake,briefForRecording,decodeTakeAudio,alignCapturedWords} from '../lib/take-run.js';
import {mountLiveUiControls} from '../lib/live-ui-controls.js';
import {startCameraRecorder} from '../lib/recorder.js';
import {startScreenPresentationRecorder} from '../lib/screen-recorder.js';
import {COPY as PRESENT_COPY,presentationRequested,cameraOnlyHref,waitForPresentationStart,mountPresentationBar,showRecoverCard} from '../lib/screen-presentation.js';
import {createManualClock} from '../../src/engine/clock.js';
import {createWebSpeechSource} from '../../src/engine/webspeech.js';
import {parseWav,toMonoFloat} from '../../src/engine/wav.js';
import {loadWhisper} from '../../src/engine/whisper-loader.js';
import {firstCue} from '../../src/engine/memory.js';
import {trialScope} from '../../src/engine/experiments.js';
import {memoryForTake,memoryMetaForTake,keptCueView} from '../lib/return-model.js';
import {recordingAvailability,recordingStartFailure,recordingNotice} from '../lib/record-status.js';
import {takeReady} from '../lib/take-loading.js';
import {containBeatLabel} from '../lib/laptop-layout.js';
import {mountLiveRefine} from '../lib/live-refine.js';
import {summarize} from '../../src/engine/live-refine.js';
import {mountLiveFocus} from '../lib/review-memory.js';

const $=id=>document.querySelector(`[data-testid="${id}"]`);
const params=new URLSearchParams(location.search), shellMode=isShellMode(location), id=location.pathname.split('/')[2];
const video=$('camera'), shell=document.querySelector('.live-shell'), panel=$('help-panel');
let run, recording, meta, recorder, speech, interval, pcm, sampleDuration=0, sample=false, paused=false, stopped=false, busy=false, trialLength=3, proposal=null, selectedTrial=null, capture=null, saved=false, panelHold=false, elapsed=0, ownCue='', ownMemoryCaption=null, pendingSave=null, mediaAcked=false, uploadUncertain=false;
let completedHeldExchange=null;
// Live refinement: one hold on the take's capture. refining pauses the clean recorder and the primary speech follower; the optional Live UI recorder keeps running.
let refine=null, refining=false, speechOn=false, screenLostInRefine=false;
// Screen presentation (?presentation=1) only: the explicit Start card, the view switch, the recovery card.
let presentBar=null, recoverCard=null, presentationEnd=null, liveUi=null;
const editorPath=()=>params.has('returnFrom')?`/record/${params.get('returnFrom')}?take=2&completed=${id}`:`/video/${id}/edit`;
let drawn=structuredClone(params.get('shell')==='live'?DRAWN.live:DRAWN.heyyap);
const fail=error=>{sayQuietly(document,error.message || String(error),86400000);};
function userMessage(text){const message=$('msg-you');message.textContent=text;message.hidden=!text;}
function fitRequest(){const input=$('say-input');input.style.height='auto';input.style.height=`${Math.min(116,Math.max(44,input.scrollHeight))}px`;}
$('say-input').addEventListener('input',fitRequest);
$('say-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();document.querySelector('.say-row').requestSubmit();}});
function setPanel(open){panel.hidden=!open;$('dim').hidden=!open;shell.classList.toggle('is-help-open',open);$('help').setAttribute('aria-expanded',String(open));if(open && sample)panelHold=true;if(!open){panelHold=false;render();$('help').focus();}syncVideo();}
function syncVideo(){if(!sample)return;if(paused || panelHold || stopped)video.pause();else video.play().catch(()=>{});}
function stepper(){$('trial-value').textContent=`${trialLength} ${trialLength===1?'video':'videos'}`;$('try').textContent=`Try for ${trialLength} ${trialLength===1?'video':'videos'}`;$('trial-minus').disabled=trialLength===1;$('trial-plus').disabled=trialLength===10;}
function renderRail(items){
 const model=railModel(items),rail=$('beats'),template=rail.querySelector('[data-testid="beat-node"]');
 while(rail.querySelectorAll('[data-testid="beat-node"]').length<model.nodes.length)rail.append(template.cloneNode(true));
 [...rail.querySelectorAll('[data-testid="beat-node"]')].forEach((node,i)=>{
  const n=model.nodes[i];node.hidden=!n;if(!n)return;
  node.style.width=`${100/model.nodes.length}%`;node.dataset.state=n.state;node.querySelector('.beat-name').textContent=n.name;const complete=!shellMode&&run?.episode().beats[i]?.tick.ticked;node.querySelector('.node').textContent=n.state==='done'||complete?'✓':'';node.setAttribute('aria-label',`${n.name}, ${n.state}${complete&&n.state==='current'?', done':''}`);
  if(!shellMode)containBeatLabel(node,n.name);
  if(n.state==='current')node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');
  let caption=node.querySelector('.beat-caption');if(n.caption&&!caption){caption=document.createElement('span');caption.className='beat-caption';node.append(caption);}if(caption){caption.textContent=n.caption;caption.hidden=!n.caption;}node.classList.toggle('has-caption',!!n.caption);
  node.onclick=()=>{if(stopped)return;if(shellMode){drawn.rail.forEach((b,j)=>b.state=j===i?'current':b.state==='current'?'ahead':b.state);}else run?.select(i);render();};
 });
 rail.querySelector('.beat-track').style.left=`${50/model.nodes.length}%`;rail.querySelector('.beat-track').style.right=`${50/model.nodes.length}%`;
 rail.querySelector('.track-done').style.width=`${model.doneTo*model.step}%`;
 rail.querySelector('.track-current').style.left=`${model.doneTo*model.step}%`;
 rail.querySelector('.track-current').style.width=`${Math.max(0,model.current-model.doneTo)*model.step}%`;
}
function renderStory(state){const m=storyModel(state);$('story-label').textContent=m.label;$('beat-title').textContent=m.title;const points=[...document.querySelectorAll('[data-testid="point"]')];points.forEach((li,i)=>{const p=m.points[i];li.hidden=!p;if(p){li.lastElementChild.textContent=p.text;li.classList.toggle('is-active',p.active);}});$('delivery-cue').lastElementChild.textContent=m.cue;$('delivery-cue').hidden=!m.cue;}
function render(){
 if(stopped)return;
 refine?.onBeatChange();
 if(shellMode){renderRail(drawn.rail);renderStory(drawn.story);return;}
 if(!run)return;
 const state=run.state(),point=state.brief.points[state.currentPointIndex] || state.brief.points[0],angle=point?.angles.find(a=>a.id===point.active);
 const beat=recording.beats[state.currentPointIndex];
 const changedAngle=angle && angle.id!==`a${state.currentPointIndex+1}`;
 const points=sample||changedAngle?[...(state.greeting?[state.greeting]:[]),run.briefWording(angle?.text || point?.title)]:(beat?.points?.length?beat.points:[angle?.text || point?.title]).map(run.wording);
 if(refine?.hasRevisions(point?.id))points.splice(0,points.length,run.briefWording(angle?.text || point?.title));
 renderRail(run.progress());[...document.querySelectorAll('[data-testid="beat-node"]')].forEach((n,i)=>{const edited=Boolean(refine?.edited(state.brief.points[i]?.id));n.classList.toggle('rail-revised',edited);if(edited)n.dataset.revised='true';else delete n.dataset.revised;});renderStory({label:sample?'Story':({outline:'Outline',story:'Story',tips:'Practical tips'}[angle?.label] || 'Talking point'),title:point?.title,points,cue:(elapsed<8?ownCue:'') || state.delivery.current?.text || state.cues.at(-1)?.text || ''});
 const currentBeat=run.episode().beats[state.currentPointIndex];
 const doneLast=state.currentPointIndex===run.episode().beats.length-1&&currentBeat?.tick.ticked;
 const tick=$('tick');tick.disabled=Boolean(doneLast);tick.setAttribute('aria-label',doneLast?'Current point is done':'Mark point done');const tickText=tick.querySelector('span');if(tickText)tickText.textContent=doneLast?'Point done':'Mark point done';
 const badge=$('delivery-cue');
 const showingMemory=!sample && ownMemoryCaption && !badge.hidden && (badge.lastElementChild.textContent===ownCue || badge.lastElementChild.textContent===ownMemoryCaption.text);
 if(showingMemory){badge.lastElementChild.textContent=ownMemoryCaption.text;badge.title=ownMemoryCaption.description;badge.setAttribute('aria-description',ownMemoryCaption.description);badge.tabIndex=0;}
 else {badge.removeAttribute('title');badge.removeAttribute('aria-description');badge.removeAttribute('tabindex');}

}
function showOffer(offer,remark){proposal=offer;trialLength=offer.trialLength || 3;selectedTrial=null;const model=panelModel({remark,proposal:offer});userMessage(model.you);$('msg-yap').textContent=model.yap;$('experiment-tag').textContent=model.card.tag;$('experiment-line').textContent=model.card.line;$('experiment-card').hidden=false;$('trial-saved').hidden=true;$('keep').textContent=`Keep ${offer.from || 'current wording'}`;stepper();setPanel(true);}
function event(e){
 if(e.type==='exchange-open'){completedHeldExchange=null;if(!proposal){$('experiment-card').hidden=true;userMessage('');$('msg-yap').textContent='Listening… Say what you want to change.';}setPanel(true);if(sample){panelHold=false;syncVideo();}}
 if(e.type==='swap'&&e.swap?.reply?.text){$('msg-yap').textContent=e.swap.reply.text;if(e.swap.exchangeId===completedHeldExchange){completedHeldExchange=null;setPanel(false);}}
 if(e.type==='swap-undone'){$('msg-yap').textContent='The final transcript changed. Your original point is restored.';setPanel(true);}
 if(e.type==='reply'&&e.reply?.text)$('msg-yap').textContent=e.reply.text;
 if(e.type==='exchange-close'||e.type==='exchange-revised'){userMessage(e.exchange.remark);if(e.exchange.trigger==='key'&&(e.recognitionPending||e.exchange.words?.some(w=>!w.typed)))completedHeldExchange=e.exchange.id;}
 if(e.type==='experiment-proposed')showOffer(e.proposal,e.proposal.source?.join(' ') || "Let's try 'Grab a coffee' instead of 'Grab a tea.'");
 if(e.type==='heard'){$('msg-yap').textContent=e.line || e.text || 'Heard you. Nothing changed.';}
 if(e.type==='hearing')recordingNotice(document,e.hearing?.line);
 if(e.type==='error')recordingNotice(document,'Speech recognition is unavailable. Recording continues; your take will be saved.');
 if(e.type==='experiment-answered'&&e.answer==='accepted'&&e.by==='voice'){selectedTrial=e.experiment;persistTrial().catch(fail);}
 render();
}
async function persistTrial(){
 await saveTrial(selectedTrial);
 $('experiment-card').hidden=true;$('trial-saved').textContent=`Trial saved · Check-in after ${selectedTrial.trialLength} ${selectedTrial.trialLength===1?'video':'videos'}`;$('trial-saved').hidden=false;render();
}
$('help').onclick=()=>{if(!stopped){if(shellMode)setPanel(panel.hidden);else{if(panel.hidden){if(!proposal){userMessage('');$('msg-yap').textContent=speech?.supported?'What would you like to change? Type a request, or hold H while you speak.':'What would you like to change? Type your request below.';$('experiment-card').hidden=true;}}setPanel(panel.hidden);}}};
$('back').onclick=()=>setPanel(false);panel.querySelectorAll('[data-action="close"]').forEach(b=>b.onclick=()=>setPanel(false));
$('trial-minus').onclick=()=>{trialLength=Math.max(1,trialLength-1);stepper();};$('trial-plus').onclick=()=>{trialLength=Math.min(10,trialLength+1);stepper();};
$('try').onclick=async()=>{
 if(busy)return;busy=true;$('try').disabled=true;
 try{if(shellMode){drawn.story.points[0]="Grab a coffee. Let's get into it.";$('experiment-card').hidden=true;$('trial-saved').textContent=`Trial saved · Check-in after ${trialLength} videos`;$('trial-saved').hidden=false;}
 else{if(!selectedTrial){const answer=run.answerExperiment(proposal.id,'accept',{trialLength});if(!answer?.experiment)throw new Error('This proposal is no longer available. Type the request again.');selectedTrial=answer.experiment;}await persistTrial();}}
 catch(error){fail(error);}finally{busy=false;$('try').disabled=false;}
};
$('keep').onclick=()=>{if(!shellMode && proposal)run.answerExperiment(proposal.id,'keep-old');$('experiment-card').hidden=true;$('trial-saved').textContent=shellMode?"Kept 'Grab a tea'":'Kept the current wording';$('trial-saved').hidden=false;};
// One transition for every capture state: ordinary pause and the refinement hold both go through here, never as separate toggles.
// Clean recorder + primary speech are paused when paused OR refining; the Live UI recorder is paused only by an ordinary pause, so the discussion stays on it.
function applyCapture(){
 if(stopped)return;
 if(paused||refining){recorder?.pause();if(speech&&speechOn){speech.stop();speechOn=false;}}
 else{recorder?.resume();if(!sample&&run&&!speechOn)startSpeech();}
 if(paused&&!refining)liveUi?.pause();else liveUi?.resume();
}
function syncPauseUi(){$('pause').classList.toggle('is-paused',paused);$('pause').setAttribute('aria-pressed',String(paused));$('pause').setAttribute('aria-label',paused?'Resume recording':'Pause recording');$('pause').setAttribute('aria-disabled',String(refining));$('pause').title=refining?'Continue the presentation first':'';syncVideo();}
function togglePause(){if(stopped || !run&&!shellMode)return;if(refining){sayQuietly(document,'Continue the presentation first, then pause.');return;}if(paused&&recorder?.needsScreen?.()){recoverCard?.focus();return;}paused=!paused;applyCapture();syncPauseUi();}
$('pause').onclick=togglePause;
$('tick').onclick=()=>{if(stopped)return;if(shellMode){let i=drawn.rail.findIndex(b=>b.state==='current');drawn.rail[i].state='done';if(i<drawn.rail.length-1)drawn.rail[i+1].state='current';}else run?.tick();render();};
let keyHeld=false;
document.addEventListener('keydown',e=>{
 if(!shellMode&&!run)return;
 if(e.key==='Escape'&&!panel.hidden){e.preventDefault();setPanel(false);return;}
 if(refining)return;
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable||e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;
 // Native buttons own Space when focused. The global pause shortcut belongs
 // to the recording background, otherwise it steals Stop/Help/point actions.
 if(e.code==='Space'&&!document.activeElement.closest('button,a,[role="button"]')){e.preventDefault();togglePause();}
 if(e.key.toLowerCase()==='h'){e.preventDefault();if(!shellMode&&!speech?.supported){$('help').click();$('say-input').focus();return;}keyHeld=true;if(!shellMode)run?.push({type:'key',down:true,at:run.clock.now()});setPanel(true);}
});
document.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='h'&&keyHeld){keyHeld=false;if(!shellMode){run?.push({type:'key',down:false,at:run.clock.now()});speech?.finishHeldUtterance();}}});
document.querySelector('.say-row').onsubmit=e=>{
 e.preventDefault();const message=$('say-input').value.trim();if(!message || stopped || !shellMode&&!run)return;$('say-input').value='';fitRequest();
 if(shellMode){const bubble=document.createElement('div');bubble.className='message-you';bubble.textContent=message;document.querySelector('.say-row').before(bubble);return;}
 // A typed request traverses the same held-key exchange path as speech.
 const at=run.clock.now();run.push({type:'key',down:true,at});message.split(/\s+/).forEach(text=>run.push({type:'word',word:{text,start:at,end:at,final:true,typed:true}}));run.push({type:'key',down:false,at});userMessage(message);
};
$('mic').onclick=()=>{if(shellMode){$('say-input').focus();return;}if(!speech?.supported){$('say-input').focus();sayQuietly(document,'Live speech is unavailable. Type your request below.');return;}speech.listenAgain();sayQuietly(document,'Hold H while speaking to YAP, then release. You can also type your request.');};
document.querySelector('.menu').onclick=e=>comingSoon(document,'More options',e.currentTarget);
if(!shellMode){const menu=document.querySelector('.menu');menu.disabled=true;menu.title='More options is not available in this demo';menu.setAttribute('aria-label','More options, unavailable');menu.style.opacity='.4';}
$('export').onclick=()=>{if(saved)go(editorPath());else sayQuietly(document,'Stop and save your take, then export from the editor.');};
function firstCut(){saved=true;$('story-label').textContent='Saved';$('beat-title').textContent=FIRST_CUT_WORDS;$('story-card').dataset.testid='first-cut';document.querySelector('.talking-points').hidden=true;$('delivery-cue').hidden=true;setPanel(false);$('edit').textContent='Open editor';setTimeout(()=>go(editorPath()),2200);}
async function stop(){
 if(shellMode){go(`/video/${id}/edit`);return;}if(busy || saved || !run)return;busy=true;$('stop').disabled=true;
 try{
  if(!stopped){stopped=true;clearInterval(interval);video.pause();speech?.stop();await refine?.leave();refine?.dispose();recoverCard?.destroy();recoverCard=null;presentBar?.destroy();presentBar=null;const uiStop=liveUi?.stopCapture();capture=recorder?await recorder.stop():null;await uiStop;elapsed=capture?.duration ?? Math.min(elapsed,sampleDuration);}
  $('story-label').textContent='Saving';setPanel(false);
  if(!pendingSave){
   if(capture&&!mediaAcked){$('beat-title').textContent='Uploading recording…';uploadUncertain=false;try{await uploadMedia(id,capture.blob);}catch(error){uploadUncertain=isUploadUncertain(error);throw error;}mediaAcked=true;}
   $('beat-title').textContent='Preparing your take…';
   const live=await run.stop(elapsed);let words=run.words().filter(w=>w.end<=elapsed+0.05);
   const plan=captureSavePlan({capture,words});
   let audio=pcm,processingNote=null;
   // A large capture is never decoded or aligned: it is saved complete and uncut, and the take keeps its beats, notes and trials.
   if(plan==='uncut-large'){words=[];audio=null;processingNote=LARGE_CAPTURE_NOTE;}
   else if(plan==='align')audio=await decodeTakeAudio(capture.blob);
   if(audio)audio={...audio,samples:audio.samples.slice(0,Math.round(elapsed*audio.sampleRate))};
   if(plan==='align'){$('beat-title').textContent='Aligning speech on this device…';const aligned=await alignCapturedWords(audio,words,()=>loadWhisper({importer:url=>import(url)}));words=aligned.words;processingNote=aligned.note;}
   pendingSave=finishPageTake({live,pcm:audio,words,episode:run.episode(),duration:elapsed,storyBeats:recording.beats});
   if(processingNote)pendingSave.processingNote=processingNote;
  }
  $('beat-title').textContent='Saving your take…';
  await saveTake(id,pendingSave);await liveUi?.finish();firstCut();
 }catch(error){const view=saveFailureView({mediaAcked,uploadUncertain});fail(Object.assign(new Error((error.message||String(error))+view.tail),{status:error.status}));
  if(capture&&!document.querySelector('[data-testid="capture-backup"]')){const backup=document.createElement('a');backup.dataset.testid='capture-backup';backup.href=URL.createObjectURL(capture.blob);backup.download=`${id}-original.webm`;backup.textContent='Save original recording';Object.assign(backup.style,{position:'fixed',top:'76px',left:'24px',zIndex:'300',color:'#f2c86b',background:'#171717',padding:'12px',borderRadius:'8px'});document.body.append(backup);}
  $('story-label').textContent=view.label;$('beat-title').textContent='Press Stop to retry saving';}
 finally{busy=false;$('stop').disabled=false;}
}
$('stop').onclick=stop;$('edit').onclick=()=>saved?go(`/video/${id}/edit`):stop();
async function readAsset(path,json=true){const r=await fetch(path,{mode:'same-origin'});if(!r.ok)throw new Error(`Could not load the sample (${r.status}). Reload to try again.`);return json?r.json():r.arrayBuffer();}
// The Start button's click runs startScreenPresentationRecorder directly, so the browser's own picker sees the gesture.
function beginPresentation(){
 $('story-label').textContent='Screen presentation';$('beat-title').textContent='Ready when you are';
 video.setAttribute('aria-label','Presentation preview, screen and camera');
 takeReady(document);
 return waitForPresentationStart({doc:document,cameraHref:cameraOnlyHref(location),start:()=>startScreenPresentationRecorder({onError:fail,onEnded:presentationEnded})});
}
function presentationEnded({reason}){
 if(stopped||saved)return;
 if(!run){presentationEnd=reason;return;}
 if(reason==='screen'){
  // While refining the hold already keeps the take paused: say so, and show the recover card when the person continues.
  if(refining){screenLostInRefine=true;sayQuietly(document,'The screen share ended. Continue the presentation to pick a screen again.');return;}
  // The recorder has already paused: nothing frozen is recorded. Carry on only through an explicit pick, or stop and save once.
  if(!paused)togglePause();
  recoverCard?.destroy();
  recoverCard=showRecoverCard({doc:document,onChoose:async()=>{await recorder.replaceScreen();presentBar?.sync();recoverCard=null;if(paused)togglePause();},onStop:()=>{recoverCard=null;stop();}});
  return;
 }
 recordingNotice(document,PRESENT_COPY.deviceLost(reason));stop();
}
document.addEventListener('keydown',e=>{
 if(e.key.toLowerCase()!=='v'||e.repeat||e.altKey||e.ctrlKey||e.metaKey||stopped||!presentBar||recoverCard)return;
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable)return;
 e.preventDefault();presentBar.toggle();
});
function startSpeech(){speechOn=true;const clock=run.clock;speech=createWebSpeechSource({SpeechRecognition:window.SpeechRecognition || window.webkitSpeechRecognition,clock,audioTrack:recorder.stream.getAudioTracks()[0],onlineTarget:window});if(speech.supported){try{speech.start(e=>{if(paused||stopped)return;if(e.type==='input-fallback')recordingNotice(document,'This browser cannot use the recording microphone track for speech recognition. Using its default microphone instead.','Speech uses the default microphone');clock.advanceTo(recorder.elapsed());run.push(e);});}catch(error){recordingNotice(document,'Speech recognition could not start. Camera and microphone recording continues.');}}else recordingNotice(document,'Speech recognition is unavailable. Camera and microphone recording still works; no automatic cuts will be proposed.','Speech unavailable · Type a change');}
// Talk to YAP: the one entry to refinement. Hooks are the only way the panel reaches capture or the engine.
function refineContext(){
 const st=run.state(),i=st.currentPointIndex,pt=st.brief.points[i],angle=pt.angles.find(a=>a.id===pt.active);
 const beats=st.brief.points.map(p=>({id:p.id,title:summarize(p.title,80),summary:summarize(p.angles.find(a=>a.id===p.active)?.text)}));
 const spoken=run.words().slice(-60).map(w=>w.text).join(' ').slice(-800);
 return {beat:{id:pt.id,title:summarize(pt.title,80),text:angle?.text||pt.title},beats,spoken};
}
function mountRefinement(){
 refine=mountLiveRefine({document,recordingId:id,hooks:{
  context:refineContext,elapsed:()=>recorder?.elapsed?.()??0,
  status:()=>`Clean take paused${paused?' (it was already paused and stays paused when you continue)':''}. ${liveUi?.began?'Live UI recording continues.':'Live UI recording is not active.'}`,
  enter(){if(stopped||refining)return null;refining=true;shell.classList.add('is-refining');setPanel(false);liveUi?.refine?.('start');applyCapture();syncPauseUi();return {uiSeconds:liveUi?.began?liveUi.uiSeconds():null};},
  leave(){
   if(!refining)return null;refining=false;shell.classList.remove('is-refining');
   const info={uiSeconds:liveUi?.began?liveUi.uiSeconds():null};liveUi?.refine?.('end');
   if(screenLostInRefine||recorder?.needsScreen?.()){screenLostInRefine=false;presentationEnded({reason:'screen'});}
   else applyCapture();
   syncPauseUi();render();return info;
  },
  apply(beatId,text){const r=run.reviseBeat(beatId,text);render();return r;},
 }});
 refine.load().then(saved=>{
  if(!saved)return;const ids=new Set(saved.revisions.map(r=>r.beatId));
  for(const beatId of ids){const text=refine.revisedText(beatId,null);if(text)run.reviseBeat(beatId,text);}
  if(saved.conversation.length||saved.revisions.length){recordingNotice(document,'Restored your saved Talk to YAP notes and wording. This is a new capture: the earlier video was not resumed.');}
  render();
 }).catch(()=>{});
}
let startupStage='data', presenting=false;
async function boot(){
 if(shellMode){proposal=DRAWN.heyyap.panel.proposal;stepper();render();return;}
 recordingAvailability(document,false);
 const data=await getRecording(id);if(!data)throw new Error('This recording was not found. Go back to Create and prepare a new take.');({recording,meta}=data);
 if(recording.status==='ready'){go(editorPath());return;}
 if(recording.video&&!meta.sample){
  $('beat-title').textContent='Recovering your saved camera take…';
  video.src=`/api/app/recordings/${id}/media`;
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('The saved capture could not be opened.'));});
  await saveTake(id,{duration:video.duration,transcript:[],cuts:{cuts:[],undoStack:[]},reviewMoments:[],processingNote:'Your original capture was recovered after an interrupted save. It is kept uncut.'});
  go(editorPath());return;
 }
 meta=await memoryMetaForTake(meta,getRecording);
 sample=meta.sample;presenting=presentationRequested(location.search,{sample,shell:shellMode});const [memoryResponse,trialResponse]=await Promise.all([getMemory(),getTrials()]);const memory=memoryForTake(memoryResponse.memory || memoryResponse,meta),accepted=trialResponse.trials || trialResponse || [];
 ownCue=firstCue(memory)?.text || '';ownMemoryCaption=keptCueView(memory,meta);
 const clock=createManualClock();let brief,words=null;const scope=sample?null:trialScope(meta,id);
 if(sample){video.style.transform='none';const name=(meta.sampleTake===2||params.has('returnFrom'))?'take2':'take1';const assets=await Promise.all([readAsset('/sample/brief.json'),readAsset(`/sample/${name}.words.json`),readAsset(`/sample/${name}.wav`,false)]);brief=assets[0];words=assets[1].words;const wav=parseWav(new Uint8Array(assets[2]));pcm={samples:toMonoFloat(wav),sampleRate:wav.sampleRate};sampleDuration=pcm.samples.length/pcm.sampleRate;video.src=`/sample/${name}.mp4`;video.muted=true;video.playbackRate=params.has('fast')?4:1;video.addEventListener('loadeddata',()=>video.classList.add('is-ready'),{once:true});}
 else if(presenting){startupStage='camera';recorder=await beginPresentation();video.style.transform='none';video.srcObject=recorder.preview;await video.play();video.classList.add('is-ready');presentBar=mountPresentationBar({doc:document,recorder});brief=briefForRecording(recording,accepted,scope);}
 else{startupStage='camera';recorder=await startCameraRecorder({onError:fail});video.srcObject=recorder.stream;await video.play();video.classList.add('is-ready');brief=briefForRecording(recording,accepted,scope);}
 startupStage='setup';
 run=runPageTake({takeId:id,brief,clock,words,memory,accepted,deliveryCues:recording.deliveryCues,scope,onEvent:event});
 if(!sample){liveUi=mountLiveUiControls({document,primary:recorder,id});startSpeech();mountRefinement();}
 if(!sample)mountLiveFocus({document,recordingId:id});
 if(presentationEnd){const reason=presentationEnd;presentationEnd=null;presentationEnded({reason});}
 if(!speech?.supported){$('mic').disabled=true;$('mic').title='Live speech is unavailable; type your request';$('mic').setAttribute('aria-label','Live speech unavailable');$('mic').style.opacity='.4';$('say-input').placeholder='Type your request…';$('say-input').setAttribute('aria-label','Type your request');}
 let last=performance.now();interval=setInterval(()=>{const now=performance.now(),delta=(now-last)/1000;last=now;if(stopped || paused || refining || sample&&panelHold)return;elapsed=sample?Math.min(sampleDuration,elapsed+delta*(params.has('fast')?4:1)):recorder.elapsed();clock.advanceTo(elapsed);$('timer').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`;render();},50);
 recordingAvailability(document,true);$('timer').textContent='00:00';render();syncVideo();takeReady(document);
}
// Until the server confirms the save, leaving discards the only in-memory
// capture (including a stopped take waiting for a retry). Use the browser's
// native warning; confirmed saves and sample playback can navigate normally.
window.addEventListener('beforeunload',event=>{if(!shellMode&&recorder&&!saved){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{clearInterval(interval);refine?.dispose();speech?.stop();liveUi?.stopCapture();recorder?.release();});
boot().catch(error=>{recordingStartFailure(document,error,{stage:startupStage});recorder?.release();recorder=null;takeReady(document);});
