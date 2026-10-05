import {isShellMode,go,sayQuietly} from '../lib/app.js';
import {getRecording,getMemory,getTrials,saveTrial,saveTake,uploadMedia} from '../lib/api.js';
import {railModel,storyModel,panelModel,changedLine,keptWords,FIRST_CUT_WORDS} from '../lib/live-view.js';
import {DRAWN} from '../lib/drawn.js';
import {captureSavePlan,LARGE_CAPTURE_NOTE,uploadUncertain as isUploadUncertain,saveFailureView} from '../lib/capture-save-policy.js';
import {runPageTake,spokenAngles,finishPageTake,briefForRecording,decodeTakeAudio,alignCapturedWords} from '../lib/take-run.js';
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
import {summarize} from '../../src/engine/live-refine.js';
import {mountCarriedLesson} from '../lib/carried-lesson.js';
import {createWakeRewriter,readWakeWord,DEFAULT_WAKE_WORD} from '../../src/engine/wake-settings.js';

const $=id=>document.querySelector(`[data-testid="${id}"]`);
const params=new URLSearchParams(location.search), shellMode=isShellMode(location), id=location.pathname.split('/')[2];
const video=$('camera'), shell=document.querySelector('.live-shell'), panel=$('help-panel');
let run, recording, meta, recorder, speech, interval, pcm, sampleDuration=0, sample=false, paused=false, stopped=false, busy=false, trialLength=3, proposal=null, selectedTrial=null, capture=null, saved=false, panelHold=false, elapsed=0, ownCue='', ownMemoryCaption=null, pendingSave=null, mediaAcked=false, uploadUncertain=false;
let completedHeldExchange=null;
// The saved experiment (the Loom's card), the beat it changed, and the remark it came from.
let savedTrial=null, changedUntil=0, lastRemark='', faceCoach=null, faceSmile=null;
// The face coach ships beside this screen and is loaded only when it is there, so its address is not a fixed import.
const FACE_COACH='../lib/face-coach.js';
const WAKE_KEY='yap-wake-word';
let wakeWord=DEFAULT_WAKE_WORD;try{wakeWord=readWakeWord(localStorage.getItem(WAKE_KEY)) || DEFAULT_WAKE_WORD;}catch{}
const wakeName=()=>wakeWord===DEFAULT_WAKE_WORD?'YAP':wakeWord[0].toUpperCase()+wakeWord.slice(1);
let speechOn=false;
// Screen presentation (?presentation=1) only: the explicit Start card, the view switch, the recovery card.
let presentBar=null, recoverCard=null, presentationEnd=null, liveUi=null;
const editorPath=()=>params.has('returnFrom')?`/record/${params.get('returnFrom')}?take=2&completed=${id}`:`/video/${id}/edit`;
let drawn=structuredClone(params.get('shell')==='live'?DRAWN.live:DRAWN.heyyap);
const fail=error=>{sayQuietly(document,error.message || String(error),86400000);};
function userMessage(text){const message=$('msg-you');message.textContent=text;message.hidden=!text;}
function fitRequest(){const input=$('say-input');input.style.height='auto';input.style.height=`${Math.min(116,Math.max(44,input.scrollHeight))}px`;}
$('say-input').addEventListener('input',fitRequest);
$('say-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();document.querySelector('.say-row').requestSubmit();}});
function setPanel(open){panel.hidden=!open;$('dim').hidden=!open;shell.classList.toggle('is-help-open',open);$('help').setAttribute('aria-expanded',String(open));if(!open){panelHold=false;render();$('help').focus();}syncVideo();}
// The sample take plays on by itself through YAP's own exchange. It waits only while a person has opened the panel to type.
function holdSample(hold){if(sample)panelHold=hold;}
// The sample presenter's cues, one a beat: Smile on the opening beat as the Loom's Live frame has it, then the take's own two.
// Smile here is the cue they pinned to that beat before recording. On a person's own take it is read from the camera.
function sampleCues(cues=[],beats=[]){const opening=cues.find(c=>c.beatId===beats[0]?.id);if(!opening||beats.length<2||cues.some(c=>c.kind==='smile'||c.beatId===beats[1].id))return cues;return [{id:'d0',kind:'smile',text:'Smile',beatId:beats[0].id},...cues.map(c=>c===opening?{...c,beatId:beats[1].id}:c)];}
// Silence is not a fault. "YAP isn't hearing words" waits until the microphone has carried a voice for a few seconds with no words back.
const VOICE_SEC=3,VOICE_LEVEL=0.02;
let voiceMeter=null,voiceSec=0,heldHearing=null;
function startVoiceMeter(stream){
 try{const Ctx=window.AudioContext || window.webkitAudioContext,ctx=new Ctx(),node=ctx.createAnalyser(),buf=new Float32Array(1024);node.fftSize=1024;ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(node);
  voiceMeter={loud(){node.getFloatTimeDomainData(buf);let sum=0;for(const v of buf)sum+=v*v;return Math.sqrt(sum/buf.length)>VOICE_LEVEL;},close(){ctx.close().catch(()=>{});}};}
 catch{voiceMeter=null;}
}
function syncVideo(){if(!sample)return;if(paused || panelHold || stopped)video.pause();else video.play().catch(()=>{});}
function stepper(){$('trial-value').textContent=`${trialLength} ${trialLength===1?'video':'videos'}`;$('try').textContent=`Try for ${trialLength} ${trialLength===1?'video':'videos'}`;$('trial-minus').disabled=trialLength===1;$('trial-plus').disabled=trialLength===10;}
function renderRail(items){
 const model=railModel(items),rail=$('beats'),template=rail.querySelector('[data-testid="beat-node"]');
 while(rail.querySelectorAll('[data-testid="beat-node"]').length<model.nodes.length)rail.append(template.cloneNode(true));
 [...rail.querySelectorAll('[data-testid="beat-node"]')].forEach((node,i)=>{
  const n=model.nodes[i];node.hidden=!n;if(!n)return;
  node.style.width=`${100/model.nodes.length}%`;node.dataset.state=n.state;node.querySelector('.beat-name').textContent=n.name;const complete=!shellMode&&(run?.episode().beats[i]?.tick.ticked || n.state==='current'&&run?.covered());node.querySelector('.node').textContent=n.state==='done'||complete?'✓':'';node.setAttribute('aria-label',`${n.name}, ${n.state}${complete&&n.state==='current'?', done':''}`);
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
function renderStory(state){const m=storyModel(state);$('story-card').classList.toggle('is-changed',Boolean(state.changed));$('story-label').textContent=m.label;$('beat-title').textContent=m.title;const points=[...document.querySelectorAll('[data-testid="point"]')];points.forEach((li,i)=>{const p=m.points[i];li.hidden=!p;if(p){li.lastElementChild.textContent=p.text;li.classList.toggle('is-active',p.active);}});$('delivery-cue').lastElementChild.textContent=m.cue;$('delivery-cue').firstElementChild.hidden=!/^smile$/i.test(m.cue);$('delivery-cue').hidden=!m.cue;}
function render(){
 if(stopped)return;
 if(shellMode){renderRail(drawn.rail);renderStory(performance.now()<changedUntil?{label:'Greeting',title:drawn.story.points[0],changed:true}:drawn.story);return;}
 if(!run)return;
 const state=run.state(),point=state.brief.points[state.currentPointIndex] || state.brief.points[0],angle=point?.angles.find(a=>a.id===point.active);
 const beat=recording.beats[state.currentPointIndex];
 const changedAngle=angle && angle.id!==`a${state.currentPointIndex+1}`;
 const points=sample||changedAngle?[...(state.greeting&&state.currentPointIndex===0?[state.greeting]:[]),run.briefWording(angle?.text || point?.title)]:(beat?.points?.length?beat.points:[angle?.text || point?.title]).map(run.wording);
 // A change to the whole beat (a shorter line, a coach's wording) reads as the one line it now is.
 if(!sample&&!changedAngle&&points.join(' ')!==run.briefWording(angle?.text || '')&&run.briefWording(angle?.text || '')!==angle?.text)points.splice(0,points.length,run.briefWording(angle.text));
 renderRail(run.progress());const liveCue=state.delivery.current?.text || state.cues.at(-1)?.text || '';
 // With the face coach running, Smile shows only while it sees no smile; without it the cue keeps its own timing.
 const cue=(elapsed<8?ownCue:'') || (faceCoach&&/^smile$/i.test(liveCue)?'':liveCue) || (faceSmile?'Smile':'');
 const changed=savedTrial&&performance.now()<changedUntil?changedBeat():null;
 renderStory(changed || {label:sample?'Story':({outline:'Story',story:'Story',tips:'Practical tips'}[angle?.label] || 'Talking point'),title:point?.title,points,cue});
 const currentBeat=run.episode().beats[state.currentPointIndex];
 // On the last beat, once its tick shows, there is nothing left to mark: the button rests.
 const doneLast=state.currentPointIndex===run.episode().beats.length-1&&(currentBeat?.tick.ticked || run.covered());
 const tick=$('tick');tick.disabled=Boolean(doneLast);tick.setAttribute('aria-label',doneLast?'Current point is done':'Mark point done');const tickText=tick.querySelector('span');if(tickText)tickText.textContent=doneLast?'Point done':'Mark point done';
 const badge=$('delivery-cue');
 const showingMemory=!sample && ownMemoryCaption && !badge.hidden && (badge.lastElementChild.textContent===ownCue || badge.lastElementChild.textContent===ownMemoryCaption.text);
 if(showingMemory){badge.lastElementChild.textContent=ownMemoryCaption.text;badge.title=ownMemoryCaption.description;badge.setAttribute('aria-description',ownMemoryCaption.description);badge.tabIndex=0;}
 else {badge.removeAttribute('title');badge.removeAttribute('aria-description');badge.removeAttribute('tabindex');}

}
// The line the person will say with the change in it: the greeting, or the beat's own line that holds the old words.
function lineWith(from,to,pointId){
 const greeting=run?.state().greeting || '';
 if(greeting&&!pointId)return changedLine(greeting,from,to);
 const beats=run?.beats() || [],text=(beats.find(b=>b.id===pointId) || beats.find(b=>b.text.includes(to)) || beats.find(b=>b.text.includes(from)))?.text || '';
 // Already in the line: an added greeting holds the old words too, and a shortened line is still found inside the long one.
 const applied=to.includes(from)?text.includes(to):!text.includes(from)&&text.includes(to);
 return applied?text:changedLine(text,from,to);
}
function offerCard(saved){const card=$('experiment-card');card.classList.toggle('is-saved',saved);card.querySelector('.experiment-kicker').textContent=saved?'EXPERIMENT':'NEW EXPERIMENT';$('keep').hidden=saved;$('experiment-progress').hidden=!saved;card.hidden=false;}
function showOffer(offer,remark){proposal=offer;trialLength=offer.trialLength || 3;selectedTrial=null;lastRemark=remark;const to=offer.to || offer.change?.to || '',model=panelModel({remark,proposal:offer,greeting:lineWith(offer.from,to,offer.pointId)});userMessage(model.you);$('msg-yap').textContent=model.yap;$('experiment-tag').textContent=offer.tag || model.card.tag;$('experiment-line').textContent=model.card.line;offerCard(false);$('experiment-saved').hidden=true;const kept=keptWords(offer.from,to);$('keep').textContent=kept&&kept.split(' ').length<=2?`Keep ${kept}`:'Keep my words';stepper();setPanel(true);}
const videos=n=>`${n} ${n===1?'video':'videos'}`;
// The saved experiment as the Loom shows it: the card top right, and the changed beat as one line for a moment.
function showSaved(trial,line){
 savedTrial={trial,line,tag:trial.tag || proposal?.tag || trial.category || 'Greeting',pointId:proposal?.pointId || null};
 $('saved-tag').textContent=savedTrial.tag;
 $('trial-saved').textContent=`${trial.recordings?.length || 0}/${videos(trial.trialLength)} · Check-in after video ${trial.trialLength}`;
 $('experiment-saved').hidden=false;changedUntil=performance.now()+7000;
 proposal=null;setPanel(false);render();
}
function changedBeat(){return {label:savedTrial.tag,title:savedTrial.line,changed:true,cue:''};}
function event(e){
 if(e.type==='exchange-open'){completedHeldExchange=null;if(!proposal){$('experiment-card').hidden=true;userMessage('');$('msg-yap').textContent='Listening… Say what you want to change.';}setPanel(true);}
 if(e.type==='swap'&&e.swap?.reply?.text){$('msg-yap').textContent=e.swap.reply.text;if(e.swap.exchangeId===completedHeldExchange){completedHeldExchange=null;setPanel(false);}}
 if(e.type==='swap-undone'){$('msg-yap').textContent='The final transcript changed. Your original point is restored.';setPanel(true);}
 if(e.type==='reply'&&e.reply?.text)$('msg-yap').textContent=e.reply.text;
 if(e.type==='exchange-close'||e.type==='exchange-revised'){userMessage(e.exchange.remark);if(e.exchange.trigger==='key'&&(e.recognitionPending||e.exchange.words?.some(w=>!w.typed)))completedHeldExchange=e.exchange.id;}
 if(e.type==='experiment-proposed')showOffer(e.proposal,e.remark || run.state().exchanges.find(x=>x.id===e.exchangeId)?.remark || $('msg-you').textContent);
 if(e.type==='heard'){userMessage(e.remark || '');$('experiment-card').hidden=true;setPanel(true);
  // What YAP's own reading cannot act on goes to the coach: Thinking shows until the reply that is given is ready.
  if(e.reading?.kind==='none'&&e.reading.reason!=='same'&&!sample){$('msg-yap').textContent='Thinking…';askCoach(e);}else $('msg-yap').textContent=e.line;}
 if(e.type==='hearing'){if(e.hearing?.status==='no-words'&&voiceMeter&&voiceSec<VOICE_SEC)heldHearing=e.hearing;else{heldHearing=null;recordingNotice(document,e.hearing?.line);}}
 if(e.type==='error')recordingNotice(document,'YAP stopped hearing you. Your take is still recording.');
 if(e.type==='experiment-answered'&&e.answer==='accepted'&&e.by==='voice'){selectedTrial=e.experiment;persistTrial().catch(fail);}
 render();
}
async function persistTrial(){
 await saveTrial(selectedTrial);
 showSaved(selectedTrial,lineWith(selectedTrial.change.from,selectedTrial.change.to,proposal?.pointId));
}
// A remark YAP could not act on by itself goes to the person's own coach when one answers; its wording is offered like any other change.
async function askCoach(e){
 const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),20000);let answered=false;
 try{
  const ctx=refineContext(),named=run.beats().find(b=>b.id===e.reading?.beatId);
  // The beat the person named is the one the coach is asked about, wherever the take is.
  if(named)ctx.beat={id:named.id,title:summarize(named.title,80),text:named.text};
  const response=await fetch('/api/model',{method:'POST',mode:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'coach',beat:ctx.beat,beats:ctx.beats,spoken:ctx.spoken,turns:[],instruction:e.remark}),signal:stop.signal});
  const data=response.ok?await response.json():null,coach=data?.source&&data.source!=='none'&&data.coach?.ok?data.coach:null;
  if(stopped || $('msg-you').textContent!==e.remark)return;
  answered=true;$('msg-yap').textContent=coach?coach.answer:e.line;
  if(!coach)return;
  const beat=coach.proposal&&run.beats().find(b=>b.id===coach.proposal.beatId);
  if(beat&&beat.text!==coach.proposal.text)run.offerChange({beatId:beat.id,title:beat.title,from:beat.text,to:coach.proposal.text},{remark:e.remark,exchangeId:e.exchangeId});
 }catch{}finally{clearTimeout(timer);if(!answered&&!stopped&&$('msg-you').textContent===e.remark&&$('msg-yap').textContent==='Thinking…')$('msg-yap').textContent=e.line;}
}
$('view-experiment').onclick=()=>{if(!savedTrial)return;const t=savedTrial.trial;userMessage(lastRemark);$('msg-yap').textContent=`Saved. I'll ask after video ${t.trialLength} whether to keep it.`;$('experiment-tag').textContent=savedTrial.tag;$('experiment-line').textContent=savedTrial.line;$('experiment-progress').textContent=`${t.recordings?.length || 0}/${videos(t.trialLength)} · was “${t.change.from}”`;offerCard(true);setPanel(true);};
$('dismiss-experiment').onclick=()=>{$('experiment-saved').hidden=true;changedUntil=0;render();};
$('wake-row').onsubmit=e=>{e.preventDefault();const word=readWakeWord($('wake-input').value);if(!word){$('msg-yap').textContent='Pick one word, letters only.';return;}wakeWord=word;try{localStorage.setItem(WAKE_KEY,word);}catch{}$('wake-input').value=wakeName();$('experiment-card').hidden=true;userMessage('');$('msg-yap').textContent=`Say “${wakeName()}” and what to change.`;};
$('help').onclick=()=>{if(!stopped){if(shellMode)setPanel(panel.hidden);else{if(panel.hidden){if(!proposal){userMessage('');$('msg-yap').textContent=speech?.supported?`Say “${wakeName()}” and what to change, or type it.`:'What would you like to change?';$('experiment-card').hidden=true;}}holdSample(panel.hidden);setPanel(panel.hidden);}}};
$('back').onclick=()=>setPanel(false);panel.querySelectorAll('[data-action="close"]').forEach(b=>b.onclick=()=>setPanel(false));
$('trial-minus').onclick=()=>{trialLength=Math.max(1,trialLength-1);stepper();};$('trial-plus').onclick=()=>{trialLength=Math.min(10,trialLength+1);stepper();};
$('try').onclick=async()=>{
 if(busy)return;busy=true;$('try').disabled=true;
 try{if(shellMode){drawn.story.points[0]="Grab a coffee. Let's get into it.";lastRemark=$('msg-you').textContent;showSaved({category:'Greeting',change:{from:'Grab a tea',to:'Grab a coffee'},trialLength,recordings:[]},drawn.story.points[0]);}
 else{if(!selectedTrial){const answer=run.answerExperiment(proposal.id,'accept',{trialLength});if(!answer?.experiment)throw new Error('This proposal is no longer available. Type the request again.');selectedTrial=answer.experiment;}await persistTrial();}}
 catch(error){fail(error);}finally{busy=false;$('try').disabled=false;}
};
$('keep').onclick=()=>{if(!shellMode && proposal)run.answerExperiment(proposal.id,'keep-old');proposal=null;$('experiment-card').hidden=true;$('msg-yap').textContent='Kept your wording.';};
// One transition for the capture: only the person's own pause holds the recorder and the speech follower. Talking to YAP never does.
function applyCapture(){
 if(stopped)return;
 if(paused){recorder?.pause();if(speech&&speechOn){speech.stop();speechOn=false;}liveUi?.pause();}
 else{recorder?.resume();if(!sample&&run&&!speechOn)startSpeech();liveUi?.resume();}
}
function syncPauseUi(){shell.classList.toggle('is-paused',paused);$('pause').classList.toggle('is-paused',paused);$('pause').setAttribute('aria-pressed',String(paused));$('pause').setAttribute('aria-label',paused?'Resume recording':'Pause recording');syncVideo();}
function togglePause(){if(stopped || !run&&!shellMode)return;if(paused&&recorder?.needsScreen?.()){recoverCard?.focus();return;}paused=!paused;applyCapture();syncPauseUi();}
$('pause').onclick=togglePause;
$('tick').onclick=()=>{if(stopped)return;if(shellMode){let i=drawn.rail.findIndex(b=>b.state==='current');drawn.rail[i].state='done';if(i<drawn.rail.length-1)drawn.rail[i+1].state='current';}else run?.tick();render();};
let keyHeld=false;
document.addEventListener('keydown',e=>{
 if(!shellMode&&!run)return;
 if(e.key==='Escape'&&!panel.hidden){e.preventDefault();setPanel(false);return;}
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable||e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;
 // Native buttons own Space when focused. The global pause shortcut belongs
 // to the recording background, otherwise it steals Stop/Help/point actions.
 if(e.code==='Space'&&!document.activeElement.closest('button,a,[role="button"]')){e.preventDefault();togglePause();}
 if(e.key.toLowerCase()==='h'){e.preventDefault();if(!shellMode&&!speech?.supported){$('help').click();$('say-input').focus();return;}keyHeld=true;if(!shellMode)run?.push({type:'key',down:true,at:run.clock.now()});holdSample(true);setPanel(true);}
});
document.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='h'&&keyHeld){keyHeld=false;if(!shellMode){run?.push({type:'key',down:false,at:run.clock.now()});speech?.finishHeldUtterance();}}});
document.querySelector('.say-row').onsubmit=e=>{
 e.preventDefault();const message=$('say-input').value.trim();if(!message || stopped || !shellMode&&!run)return;$('say-input').value='';fitRequest();
 if(shellMode){const bubble=document.createElement('div');bubble.className='message-you';bubble.textContent=message;document.querySelector('.say-row').before(bubble);return;}
 // A typed request traverses the same held-key exchange path as speech.
 const at=run.clock.now();run.push({type:'key',down:true,at});message.split(/\s+/).forEach(text=>run.push({type:'word',word:{text,start:at,end:at,final:true,typed:true}}));run.push({type:'key',down:false,at});userMessage(message);
};
$('mic').onclick=()=>{if(shellMode){$('say-input').focus();return;}if(!speech?.supported){$('say-input').focus();sayQuietly(document,'Live speech is unavailable. Type your request below.');return;}speech.listenAgain();sayQuietly(document,'Hold H while speaking to YAP, then release. You can also type your request.');};
if(!shellMode)document.querySelector('.menu').hidden=true;
$('export').onclick=()=>saved?go(editorPath()):stop();
function firstCut(){saved=true;shell.classList.replace('is-saving','is-saved');$('story-label').textContent='Saved';$('beat-title').textContent=FIRST_CUT_WORDS;$('story-card').dataset.testid='first-cut';document.querySelector('.talking-points').hidden=true;$('delivery-cue').hidden=true;setPanel(false);$('edit').textContent='Open editor';setTimeout(()=>go(editorPath()),2200);}
async function stop(){
 if(shellMode){go(`/video/${id}/edit`);return;}if(busy || saved || !run)return;busy=true;$('stop').disabled=true;
 try{
  if(!stopped){stopped=true;clearInterval(interval);video.pause();speech?.stop();voiceMeter?.close();heldHearing=null;recordingNotice(document,null);faceCoach?.stop?.();recoverCard?.destroy();recoverCard=null;presentBar?.destroy();presentBar=null;const uiStop=liveUi?.stopCapture();capture=recorder?await recorder.stop():null;await uiStop;elapsed=capture?.duration ?? Math.min(elapsed,sampleDuration);}
  $('story-label').textContent='Saving';shell.classList.add('is-saving');setPanel(false);
  if(!pendingSave){
   if(capture&&!mediaAcked){$('beat-title').textContent='Uploading recording…';uploadUncertain=false;try{await uploadMedia(id,capture.blob);}catch(error){uploadUncertain=isUploadUncertain(error);throw error;}mediaAcked=true;}
   $('beat-title').textContent='Finding your cuts…';
   const live=await run.stop(elapsed);let words=run.words().filter(w=>w.end<=elapsed+0.05);
   const plan=captureSavePlan({capture,words}),spoke=words.length>0;
   let audio=pcm,processingNote=null;
   // A large capture is never decoded or aligned: it is saved complete and uncut, and the take keeps its beats, notes and trials.
   if(plan==='uncut-large'){words=[];audio=null;processingNote=LARGE_CAPTURE_NOTE;}
   else if(plan==='align')audio=await decodeTakeAudio(capture.blob);
   if(audio)audio={...audio,samples:audio.samples.slice(0,Math.round(elapsed*audio.sampleRate))};
   if(plan==='align'){$('beat-title').textContent='Lining up your words…';const aligned=await alignCapturedWords(audio,words,()=>loadWhisper({importer:url=>import(url)}));words=aligned.words;processingNote=aligned.note;}
   pendingSave=finishPageTake({live,pcm:audio,words,spoke,episode:run.episode(),duration:elapsed,storyBeats:recording.beats});
   if(processingNote)pendingSave.processingNote=processingNote;
  }
  $('beat-title').textContent='Saving your take…';
  await saveTake(id,pendingSave);await liveUi?.finish();firstCut();
 }catch(error){const view=saveFailureView({mediaAcked,uploadUncertain});fail(Object.assign(new Error((error.message||String(error))+view.tail),{status:error.status}));
  if(capture&&!document.querySelector('[data-testid="capture-backup"]')){const backup=document.createElement('a');backup.dataset.testid='capture-backup';backup.href=URL.createObjectURL(capture.blob);backup.download=`${id}-original.webm`;backup.textContent='Save original recording';Object.assign(backup.style,{position:'fixed',top:'76px',left:'24px',zIndex:'300',color:'#f2c86b',background:'#171717',padding:'12px',borderRadius:'8px'});document.body.append(backup);}
  shell.classList.remove('is-saving');$('story-label').textContent=view.label;$('beat-title').textContent='Press Stop to retry saving';}
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
function startSpeech(){speechOn=true;const clock=run.clock;speech=createWebSpeechSource({SpeechRecognition:window.SpeechRecognition || window.webkitSpeechRecognition,clock,audioTrack:recorder.stream.getAudioTracks()[0],onlineTarget:window,rewrite:createWakeRewriter(()=>wakeWord)});if(speech.supported){try{speech.start(e=>{if(paused||stopped)return;if(e.type==='input-fallback')recordingNotice(document,'YAP follows your beats through the default microphone.','Listening on your default microphone');clock.advanceTo(recorder.elapsed());run.push(e);});}catch(error){recordingNotice(document,'YAP cannot hear you right now. Your take is still recording.');}}else recordingNotice(document,'Your take still records, without suggested cuts. Tap a beat to move on.','YAP cannot hear you in this browser');}
// What YAP's coach is told about the take when a remark needs it: the beat on screen, the other beats, the last words said.
function refineContext(){
 const st=run.state(),i=st.currentPointIndex,pt=st.brief.points[i],angle=pt.angles.find(a=>a.id===pt.active);
 const beats=st.brief.points.map(p=>({id:p.id,title:summarize(p.title,80),summary:summarize(p.angles.find(a=>a.id===p.active)?.text)}));
 const spoken=run.words().slice(-60).map(w=>w.text).join(' ').slice(-800);
 return {beat:{id:pt.id,title:summarize(pt.title,80),text:angle?.text||pt.title},beats,spoken};
}
let startupStage='data', presenting=false;
// The sample's first take is the one where its presenter asks for the change: it opens on the wording they say, however often it is watched.
let firstAsk=false;
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
 if(sample){video.style.transform='none';video.classList.add('is-sample');const tag=document.createElement('span');tag.className='sample-tag';tag.dataset.testid='sample-tag';tag.textContent='Sample';$('brand').append(tag);$('tick').hidden=true;const name=(meta.sampleTake===2||params.has('returnFrom'))?'take2':'take1';firstAsk=name==='take1';const assets=await Promise.all([readAsset('/sample/brief.json'),readAsset(`/sample/${name}.words.json`),readAsset(`/sample/${name}.wav`,false)]);words=assets[1].words;brief=spokenAngles(assets[0],words);const wav=parseWav(new Uint8Array(assets[2]));pcm={samples:toMonoFloat(wav),sampleRate:wav.sampleRate};sampleDuration=pcm.samples.length/pcm.sampleRate;video.src=`/sample/${name}.mp4`;video.muted=true;video.playbackRate=params.has('fast')?4:1;video.addEventListener('loadeddata',()=>video.classList.add('is-ready'),{once:true});}
 else if(presenting){startupStage='camera';recorder=await beginPresentation();video.style.transform='none';video.srcObject=recorder.preview;await video.play();video.classList.add('is-ready');presentBar=mountPresentationBar({doc:document,recorder});brief=briefForRecording(recording,accepted,scope);}
 else{startupStage='camera';recorder=await startCameraRecorder({onError:fail});video.srcObject=recorder.stream;await video.play();video.classList.add('is-ready');brief=briefForRecording(recording,accepted,scope);}
 startupStage='setup';
 run=runPageTake({takeId:id,brief,clock,words,memory,accepted,firstAsk,deliveryCues:sample?sampleCues(recording.deliveryCues,recording.beats):recording.deliveryCues,scope,onEvent:event});
 if(!sample){if(presenting)liveUi=mountLiveUiControls({document,primary:recorder,id});startVoiceMeter(recorder.stream);startSpeech();}
 if(presentationEnd){const reason=presentationEnd;presentationEnd=null;presentationEnded({reason});}
 if(!speech?.supported){$('mic').hidden=true;$('say-input').placeholder='Type it…';$('say-input').setAttribute('aria-label','Type what to change');}
 else{$('wake-input').value=wakeName();$('wake-row').hidden=false;}
 mountCarriedLesson(document.querySelector('.identity'),{sample}).catch(()=>{});
 // The face coach is another part of YAP: when it is here and Smile was left on in Ready, the Smile chip is its reading of the camera.
 if(!sample&&recording.deliveryCues?.some(c=>c.kind==='smile')){try{const {startFaceCoach}=await import(FACE_COACH);faceCoach=await startFaceCoach(video,{onCue:c=>{if(c?.id==='smile'){faceSmile=Boolean(c.show);render();}}});}catch{faceCoach=null;}}
 let last=performance.now();interval=setInterval(()=>{const now=performance.now(),delta=(now-last)/1000;last=now;if(stopped || paused || sample&&panelHold)return;elapsed=sample?Math.min(sampleDuration,elapsed+delta*(params.has('fast')?4:1)):recorder.elapsed();
  if(voiceMeter?.loud())voiceSec+=delta;if(heldHearing&&voiceSec>=VOICE_SEC){recordingNotice(document,heldHearing.line);heldHearing=null;}clock.advanceTo(elapsed);$('timer').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`;render();
  // The sample take ends where its footage ends, and goes on to the editor as a stopped take does.
  if(sample&&elapsed>=sampleDuration)stop();},50);
 userMessage('');recordingAvailability(document,true);$('timer').textContent='00:00';render();syncVideo();takeReady(document);
}
// Until the server confirms the save, leaving discards the only in-memory
// capture (including a stopped take waiting for a retry). Use the browser's
// native warning; confirmed saves and sample playback can navigate normally.
window.addEventListener('beforeunload',event=>{if(!shellMode&&recorder&&!saved){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{clearInterval(interval);speech?.stop();voiceMeter?.close();faceCoach?.stop?.();liveUi?.stopCapture();recorder?.release();});
boot().catch(error=>{recordingStartFailure(document,error,{stage:startupStage});recorder?.release();recorder=null;takeReady(document);});
