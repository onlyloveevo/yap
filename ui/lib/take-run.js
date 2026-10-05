// The screen shares the engine's take, cut and episode models. No model/network adapters.
import { createPointFollower } from '../../src/engine/follow.js';
import { createLiveTake } from '../../src/engine/loop.js';
import { createReplaySource } from '../../src/engine/replay.js';
import { createManualClock } from '../../src/engine/clock.js';
import { createEpisode, progress, tickBeat, goToBeat, addTake, chooseTake, COPY as EPISODE_COPY } from '../../src/engine/episode.js';
import { finishTake } from '../../src/engine/session.js';
import { recordingBeats } from '../../src/engine/recording.js';
import { createCutList } from '../../src/engine/cutlist.js';
import { pointCoverage } from '../../src/engine/coverage.js';
import { firstCue } from '../../src/engine/memory.js';
import { applyWordingTrials } from '../../src/engine/experiments.js';
import { countableTrials, textsUseTrial, mergeById } from '../../src/engine/trial-scope.js';

// Accepted wording trials of this idea (`scope`) change the words shown and followed; recording.beats is never rewritten.
export function briefForRecording(recording,trials=[],scope=null) {
 const w=text=>applyWordingTrials(text,trials,scope);
 const beats=recording.beats?.length?recording.beats:[{id:'b1',title:'Just talk',points:[recording.idea || 'Say what is on your mind.']}];
 return {version:1,idea:recording.idea || recording.title || '',greeting:'',points:beats.map((b,i)=>({id:b.pointId || `p${i+1}`,title:b.label || b.title || `Beat ${i+1}`,active:`a${i+1}`,angles:[
  {id:`a${i+1}`,label:'outline',text:w((b.points || [b.title]).join(' ')),keywords:[],reply:'Your original talking points.'},
  {id:`a${i+1}-story`,label:'story',text:w(b.preparedAngles?.story) ?? `Tell the story behind: ${(b.points?.join(' ') || recording.idea || b.title || 'this point').slice(0,140)}`,keywords:['example','happened'],reply:b.preparedAngles?.story?'Your prepared story is on screen.':'Try a real example from your experience.'},
  {id:`a${i+1}-tips`,label:'tips',text:w(b.preparedAngles?.tips) ?? `One practical step for: ${(b.points?.join(' ') || recording.idea || b.title || 'this point').slice(0,140)}`,keywords:['practical','step'],reply:b.preparedAngles?.tips?'Your prepared practical tips are on screen.':'Turn this point into a practical step.'},
 ]}))};
}
export function runPageTake({takeId,brief,clock=createManualClock(),words=null,memory=null,accepted=[],deliveryCues=[],scope=null,onEvent=()=>{}}) {
 // A trial accepted in this take is stamped with the idea it was accepted in, so a later take of another idea never shows it.
 const stamp=e=>e&&scope&&!e.scope?{...e,scope}:e;
 // Kept preferences change the prepared points, as well as the reminder cue.
 // Memory is already scoped to this idea/recording chain by the caller. A kept
 // preference stands on its own: its historical comparator is not a required
 // starting state. Otherwise a newer tips-over-story choice loses to an older
 // story-over-outline choice whenever a fresh take starts from outline.
 // Match only available labels; a saved lesson cannot invent an angle.
 brief=structuredClone(brief);
 // Startup trials are already in `brief` (briefForRecording); only trials accepted in this take are laid over it, once.
 const liveTrials=()=>live?live.state().experiments.map(stamp):[];
 const overlay=b=>{const next=structuredClone(b);for(const p of next.points)for(const a of p.angles)a.text=applyWordingTrials(a.text,liveTrials(),scope);return next;};
 for(const point of brief.points){
  const note=[...(memory?.notes || [])].reverse().find(n=>n.prefer && point.angles.some(a=>a.label===n.prefer));
  if(note)point.active=point.angles.find(a=>a.label===note.prefer).id;
 }
 // The follower starts from the brief after kept preferences were applied.
 const inner=createPointFollower(brief,{});
 const follower={onWord:(...a)=>inner.onWord(...a),onStableWords:w=>inner.onStableWords(w),current:()=>inner.current(),setIndex:i=>inner.setIndex(i),setBrief:b=>inner.setBrief(overlay(b))};
 let ep={...createEpisode(brief),captureSpans:true}, source=null, ended=false, live;
 const transcript=[], timeline=[{at:0,brief}], delivered=[];
 let segmentStart=clock.now(), segmentOpen=true;
 function closeSegment(at, manual=false) {
  const beat=ep.beats.find(b=>b.id===ep.currentBeatId);
  if(!beat || !segmentOpen)return;
  if(!manual && at<=segmentStart){segmentOpen=false;return;}
  const point=live?.state().brief.points.find(p=>p.id===beat.pointId) || brief.points.find(p=>p.id===beat.pointId);
  const angle=point?.angles.find(a=>a.id===point.active);
  const spoken=transcript.filter(w=>w.start>=segmentStart && w.end<=at);
  const seconds=spoken.length?spoken.at(-1).end-spoken[0].start:0;
  // This live hint is provisional; final cut analysis owns restart/word-edge decisions.
  const summary=spoken.length?{uncutRestarts:0,coverage:pointCoverage(applyWordingTrials(angle?.text || '',liveTrials(),scope),spoken),paceWpm:seconds>0?spoken.length/seconds*60:null}:null;
  ep=addTake(ep,beat.id,{recordingId:takeId,start:segmentStart,end:Math.max(segmentStart,at),summary});
  if(manual){const latest=ep.beats.find(b=>b.id===beat.id).takes.at(-1);ep=chooseTake(ep,beat.id,latest.id);ep=tickBeat(ep,beat.id,true);}
  segmentOpen=false;
 }

 const delivery={beatIds:ep.beats.map(b=>b.id),cues:deliveryCues};
 function event(e) {
  if(e.type==='word'&&!e.word.typed) transcript.push(e.word);
  if(e.type==='swap' && live) timeline.push({at:e.swap.at,brief:live.state().brief});
  if(e.type==='revision' && live) timeline.push({at:e.revision.at,brief:live.state().brief,revision:{pointId:e.revision.pointId,angleId:e.revision.angleId}});
  if(e.type==='point') {
   const index=brief.points.findIndex(p=>p.id===e.pointId);
   if(index>=0) {
    if(ep.currentBeatId!==ep.beats[index].id){
     closeSegment(e.at);
     ep=goToBeat(ep,ep.beats[index].id);
     segmentStart=e.at;segmentOpen=true;
    }
   }
  }
  if(e.type==='experiment-answered'&&e.experiment){e={...e,experiment:stamp(e.experiment)};/* followed and counted from the new wording at once; the lit point, clock and transcript stay */ follower.setBrief(live.state().brief);}
  delivered.push(e); onEvent(e);
 }
 // A sample has no idea scope: a trial scoped to an own idea never reaches its greeting.
 live=createLiveTake({brief,clock,follow:follower,pace:{memory},firstCue:firstCue(memory),delivery,experiments:{accepted:scope?accepted:accepted.filter(e=>!e?.scope)},onEvent:event});
 function push(e) { if(!ended) live.push(e); }
 if(Array.isArray(words)) {
  source=createReplaySource(words,{clock});
  source.start(e=>{if(e.type==='end') onEvent({type:'replay-complete',at:e.at}); else push(e);});
 }
 return {
  clock,push,state:()=>live.state(),words:()=>transcript.slice(),episode:()=>ep,progress:()=>progress(ep),events:()=>delivered.slice(),
  // Live refinement: new wording for one existing beat, from now. Earlier timeline entries keep their original words.
  reviseBeat:(pointId,text)=>live.reviseWording({pointId,text}),
  answerExperiment:(...args)=>{const r=live.answerExperiment(...args);return r?.experiment?{...r,experiment:stamp(r.experiment)}:r;},
  // wording: a saved beat's text (every trial of this scope, once). briefWording: text read from the live brief, which already holds the startup trials.
  wording:text=>applyWordingTrials(text,[...accepted,...liveTrials().filter(t=>!accepted.some(a=>a.id===t.id))],scope),
  briefWording:text=>applyWordingTrials(text,liveTrials(),scope),
  tick() { if(ended)return; closeSegment(clock.now(),true); ep=tickBeat(ep,ep.currentBeatId,true); const i=ep.beats.findIndex(b=>b.id===ep.currentBeatId); if(i<ep.beats.length-1) this.select(i+1); },
  select(index) { const beat=ep.beats[index]; if(!beat || ended || beat.id===ep.currentBeatId&&segmentOpen) return; closeSegment(clock.now()); ep=goToBeat(ep,beat.id); ep={...ep,beats:ep.beats.map(b=>b.id===beat.id?{...b,tick:{ticked:false,by:null,reason:null}}:b)}; segmentStart=clock.now();segmentOpen=true;live.setCurrentPointIndex(index); },
  async stop(at=clock.now()) {
   if(!ended) { source?.stop(); live.end(at); closeSegment(at); ended=true; }
   await live.settled(); const st=live.state();
   // A typed request is instantaneous; it has no spoken interval to remove.
   // Trials saved before this take that it carried: same idea or Just-talk chain, still being counted, shown in this take's
   // own prompt (old or new wording). The server counts each finished recording once, however often its save is retried.
   const promptTexts=brief.points.flatMap(p=>p.angles.map(a=>a.text));
   const carriedTrials=countableTrials(accepted,scope).filter(t=>textsUseTrial(promptTexts,t,scope));
   return {takeId,carriedTrials,exchanges:st.exchanges.filter(e=>e.end>e.start),swaps:st.swaps,notes:st.notes,replies:st.replies,cues:st.cues,pointTimeline:st.pointTimeline,briefBefore:brief,briefAfter:st.brief,briefTimeline:timeline,greeting:st.greeting,proposals:st.proposals,experiments:st.experiments.map(stamp),heard:st.heard,delivery:{cues:deliveryCues,spans:st.delivery.spans}};
  }
 };
}
// No verified word timing: live-recognition summaries hardcode uncutRestarts:0, which nothing has checked, so an automatic
// good-take tick built on them is unverified. Clear those ticks and the summaries; a tick the person made by hand stays.
function withoutUnverifiedSummaries(episode) {
 const next = structuredClone(episode);
 for (const beat of next.beats) {
  beat.takes = beat.takes.map(take => ({ ...take, summary: null }));
  if (beat.tick?.by === 'auto') beat.tick = { ticked: false, by: null, reason: EPISODE_COPY.leftNoSummary };
 }
 return next;
}
export function finishPageTake({live,pcm=null,words=[],episode,duration=null,storyBeats=[]}) {
 const seconds=Number.isFinite(duration)?duration:pcm?pcm.samples.length/pcm.sampleRate:0;
 if(!words.length) return {beats:recordingBeats(storyBeats,withoutUnverifiedSummaries(episode)),transcript:[],duration:seconds,cuts:createCutList(),reviewMoments:[],trials:mergeById(live.experiments || [],live.carriedTrials || []),experiments:[],notes:structuredClone(live.notes || [])};
 if(!pcm) throw new Error('Audio could not be decoded. Your video is kept; retry saving this take.');
 const r=finishTake({live,pcm,words,episode});
 return {beats:recordingBeats(storyBeats,r.episode),transcript:words,duration:seconds,cuts:r.cutList,reviewMoments:r.moments,trials:mergeById(live.experiments || [],live.carriedTrials || []),experiments:[],notes:structuredClone(live.notes || [])};
}
export async function decodeTakeAudio(blob,scope=globalThis) {
 const Audio=scope.AudioContext || scope.webkitAudioContext;
 if(!Audio) throw new Error('This browser cannot decode recorded audio. Try Chrome.');
 const context=new Audio();
 try { const decoded=await context.decodeAudioData(await blob.arrayBuffer()); const samples=new Float32Array(decoded.length);
  for(let c=0;c<decoded.numberOfChannels;c++){const channel=decoded.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]+=channel[i]*32768/decoded.numberOfChannels;}
  return {samples,sampleRate:decoded.sampleRate};
 } finally {await context.close();}
}

// Real capture timestamps are aligned locally after recording. A missing model
// must not turn rough live-recognition timestamps into destructive cuts.
export async function alignCapturedWords(pcm,liveWords,loader,{timeoutMs=90000}={}) {
 if(!liveWords.length)return {words:[],note:null};
 let timer;
 try {
  return await Promise.race([(async()=>{
  const loaded=await loader();if(!loaded.ok)return {words:[],note:'Speech timing was unavailable. This take is saved uncut.'};
  const {realTakeWords}=await import('../../src/engine/real-take.js');
  const result=await realTakeWords({...pcm,transcriber:loaded.transcriber});
  return {words:result.words,note:result.words.length?null:'No speech timing was found. This take is saved uncut.'};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Speech timing timed out')),timeoutMs);})]);
 }catch{return {words:[],note:'Speech timing failed or took too long. This take is saved uncut.'};}finally{clearTimeout(timer);}
}
