// The screen shares the engine's take, cut and episode models. No model/network adapters.
import { createPointFollower } from '../../src/engine/follow.js';
import { createLiveTake } from '../../src/engine/loop.js';
import { createReplaySource } from '../../src/engine/replay.js';
import { createManualClock } from '../../src/engine/clock.js';
import { createEpisode, progress, tickBeat, goToBeat, addTake, chooseTake, COPY as EPISODE_COPY, EPISODE_DEFAULTS } from '../../src/engine/episode.js';
import { finishTake } from '../../src/engine/session.js';
import { recordingBeats } from '../../src/engine/recording.js';
import { createCutList, addRestartCuts, protectWordEdges } from '../../src/engine/cutlist.js';
import { pointCoverage } from '../../src/engine/coverage.js';
import { firstCue } from '../../src/engine/memory.js';
import { applyWordingTrials, acceptExperiment, proposeChange, swapWording } from '../../src/engine/experiments.js';
import { readSpokenChange, readSpokenAnswer, plainAnswer } from '../../src/engine/live-refine.js';
import { countableTrials, textsUseTrial, mergeById } from '../../src/engine/trial-scope.js';

// The tick YAP gives by itself while the person talks: the beat's words were covered. Pace is the person's to judge
// (they go back and say it again); the editor's own check after Stop still reads pace and restarts.
const LIVE_TICK=Object.freeze({coverageMin:EPISODE_DEFAULTS.coverageMin,paceBand:Object.freeze([0,Infinity])});
// A spoken yes or no to an offer the page made is listened for this long.
const ANSWER_WINDOW_SEC=10;
const MAX_WORD_SEC=1.2;
const RETAKE_REASON='you went back and said this beat again';

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
// A replayed take starts each beat on the angle its presenter speaks: the one the take's words cover best.
// A beat no other angle covers better keeps the brief's own.
export function spokenAngles(brief,words=[]) {
 const next=structuredClone(brief);
 for(const point of next.points){
  const own=point.angles.find(a=>a.id===point.active) || point.angles[0];
  point.active=point.angles.reduce((best,a)=>pointCoverage(a.text,words)>pointCoverage(best.text,words)?a:best,own).id;
 }
 return next;
}
export function runPageTake({takeId,brief,clock=createManualClock(),words=null,memory=null,accepted=[],deliveryCues=[],scope=null,firstAsk=false,onEvent=()=>{}}) {
 // The trials this take starts from. A sample has no idea scope: a trial scoped to an own idea never reaches its greeting.
 // `firstAsk` is the sample take in which the presenter asks for the change: it starts from the wording they say.
 const given=firstAsk?[]:scope?accepted:accepted.filter(e=>!e?.scope);
 // A trial made in this take never takes the id of a saved trial the take was not given.
 const kept=new Set(accepted.filter(t=>!given.includes(t)).map(t=>t.id)),renamed=new Map();
 const freeId=id=>{if(!kept.has(id))return id;if(!renamed.has(id)){let n=accepted.length+1;while(accepted.some(t=>t.id===`e${n}`)||[...renamed.values()].includes(`e${n}`))n++;renamed.set(id,`e${n}`);}return renamed.get(id);};
 // A trial accepted in this take is stamped with the idea it was accepted in, so a later take of another idea never shows it.
 const stamp=e=>e?{...e,id:freeId(e.id),...(scope&&!e.scope?{scope}:{})}:e;
 // Kept preferences change the prepared points, as well as the reminder cue.
 // Memory is already scoped to this idea/recording chain by the caller. A kept
 // preference stands on its own: its historical comparator is not a required
 // starting state. Otherwise a newer tips-over-story choice loses to an older
 // story-over-outline choice whenever a fresh take starts from outline.
 // Match only available labels; a saved lesson cannot invent an angle.
 brief=structuredClone(brief);
 // Startup trials are already in `brief` (briefForRecording); only trials accepted in this take are laid over it, once.
 const localTrials=[];
 const liveTrials=()=>live?[...live.state().experiments,...localTrials].map(stamp):[];
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
  const summary=spoken.length?{uncutRestarts:0,coverage:pointCoverage(applyWordingTrials(angle?.text || '',liveTrials(),scope),spoken),paceWpm:seconds>0?spoken.length/seconds*60:0}:null;
  ep=addTake(ep,beat.id,{recordingId:takeId,start:segmentStart,end:Math.max(segmentStart,at),summary},LIVE_TICK);
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
  if(e.type==='heard')e=readHeard(e);
  if(e.type==='experiment-answered'&&e.experiment){e={...e,experiment:stamp(e.experiment)};/* followed and counted from the new wording at once; the lit point, clock and transcript stay */ follower.setBrief(live.state().brief);}
  delivered.push(e); onEvent(e);
 }
 live=createLiveTake({brief,clock,follow:follower,pace:{memory},firstCue:firstCue(memory),delivery,experiments:{accepted:given},onEvent:event});
 // ----- Changes the take's own reader made nothing of, read against the beats on screen (src/engine/live-refine.js).
 // On a person's own take a change is offered as a trial, like the take's own proposals; the sample has no saved
 // trials of its own, so its beat changes at once.
 const offers=[];
 const beatsNow=()=>live.state().brief.points.map(p=>({id:p.id,title:p.title,text:applyWordingTrials(p.angles.find(a=>a.id===p.active)?.text || p.title,liveTrials(),scope)}));
 function offerChange(change,{remark='',exchangeId=null}={}) {
  const proposal={...proposeChange({from:change.from,to:change.to},remark,{brief:live.state().brief,id:`l${offers.length+1}`,exchangeId}),tag:change.title,pointId:change.beatId};
  offers.push({proposal,at:clock.now(),said:[],closed:false});
  return {type:'experiment-proposed',proposal:{...proposal},exchangeId,remark,at:clock.now()};
 }
 function readHeard(e) {
  const reading=readSpokenChange(e.remark,{beats:beatsNow(),current:live.state().currentPointIndex});
  if(reading.kind==='none')return {...e,reading,line:plainAnswer(reading)};
  if(scope)return offerChange(reading,e);
  const text=reading.kind==='shorten'?reading.to:swapWording(beatsNow().find(b=>b.id===reading.beatId).text,reading.from,reading.to);
  live.reviseWording({pointId:reading.beatId,text});
  return {...e,reading,line:`${reading.title} now reads “${text}”`};
 }
 function answerLocal(offer,answer,by,trialLength,endAt=null) {
  if(ended || offer.proposal.status!=='proposed')return null;
  offer.closed=true;
  let answered;
  if(answer==='accept'){
   const made=acceptExperiment(offer.proposal,{trialLength,existing:[...accepted,...liveTrials()]});
   const experiment=stamp({...made.experiment,tag:offer.proposal.tag});
   offer.proposal={...offer.proposal,status:'accepted'};localTrials.push(experiment);follower.setBrief(live.state().brief);
   answered={type:'experiment-answered',proposalId:offer.proposal.id,exchangeId:offer.proposal.exchangeId,answer:'accepted',by,experiment,line:made.line,at:clock.now()};
  }else{
   offer.proposal={...offer.proposal,status:'kept-old'};
   answered={type:'experiment-answered',proposalId:offer.proposal.id,exchangeId:offer.proposal.exchangeId,answer:'kept-old',by,at:clock.now()};
  }
  // A spoken answer is part of the same talk with YAP: the talk's cut reaches to its last word.
  if(endAt!==null)offer.answerEnd=endAt;
  delivered.push(answered);onEvent(answered);
  return answered;
 }
 // Only the words said next can answer, and only inside the window: anything else is ordinary speech.
 function hearAnswer(e) {
  const offer=offers.find(o=>!o.closed&&o.proposal.status==='proposed');
  if(!offer)return;
  if(clock.now()-offer.at>ANSWER_WINDOW_SEC){offer.closed=true;return;}
  if(e.type==='word'&&!e.word.typed&&e.word.start>=offer.at-0.5)offer.said.push(e.word);
  if(e.type==='pause'&&offer.said.length){
   const answer=readSpokenAnswer(offer.said.map(w=>w.text));
   if(answer)answerLocal(offer,answer,'voice',undefined,offer.said.at(-1).end);else offer.closed=true;
  }
 }
 function push(e) { if(ended)return; live.push(e); hearAnswer(e); }
 if(Array.isArray(words)) {
  source=createReplaySource(words,{clock});
  source.start(e=>{if(e.type==='end') onEvent({type:'replay-complete',at:e.at}); else push(e);});
 }
 return {
  clock,push,state:()=>live.state(),words:()=>transcript.slice(),episode:()=>ep,progress:()=>progress(ep),events:()=>delivered.slice(),
  // Live refinement: new wording for one existing beat, from now. Earlier timeline entries keep their original words.
  reviseBeat:(pointId,text)=>live.reviseWording({pointId,text}),
  answerExperiment:(id,answer,options={})=>{
   const offer=offers.find(o=>o.proposal.id===id);
   if(offer)return answerLocal(offer,answer==='accept'?'accept':'keep-old','call',options.trialLength);
   const r=live.answerExperiment(id,answer,options);return r?.experiment?{...r,experiment:stamp(r.experiment)}:r;
  },
  // A change YAP's coach suggested for a beat, offered the same way as one the person said.
  offerChange:(change,from={})=>{if(ended || !scope)return null;const e=offerChange(change,from);delivered.push(e);onEvent(e);return e;},
  beats:beatsNow,
  // The beat on screen has had its words covered: its tick shows before the person moves on.
  covered() {
   if(ended || !segmentOpen)return false;
   const beat=ep.beats.find(b=>b.id===ep.currentBeatId),text=beatsNow().find(b=>b.id===beat?.pointId)?.text;
   const spoken=transcript.filter(w=>w.start>=segmentStart);
   return Boolean(text)&&spoken.length>0&&pointCoverage(text,spoken)>=LIVE_TICK.coverageMin;
  },
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
   const carriedTrials=countableTrials(given,scope).filter(t=>textsUseTrial(promptTexts,t,scope));
   const answerEnd=id=>Math.max(0,...offers.filter(o=>o.proposal.exchangeId===id&&o.answerEnd).map(o=>o.answerEnd));
   const exchanges=st.exchanges.map(x=>({...x,end:Math.max(x.end,Math.min(at,answerEnd(x.id)))}));
   return {takeId,carriedTrials,exchanges:exchanges.filter(e=>e.end>e.start),swaps:st.swaps,notes:st.notes,replies:st.replies,cues:st.cues,pointTimeline:st.pointTimeline,briefBefore:brief,briefAfter:st.brief,briefTimeline:timeline,greeting:st.greeting,proposals:[...st.proposals,...offers.map(o=>({...o.proposal}))],experiments:liveTrials(),heard:st.heard,delivery:{cues:deliveryCues,spans:st.delivery.spans}};
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
// A beat the follower moved on from ends a moment late: the next beat's first words were already said when it was
// heard. So the boundary is moved back to the longest pause that ended in the 2.5 s before it. A boundary the person
// made by pressing a beat sits in a pause of its own and stays where it is.
function snapToPause(words,t) {
 let best=t,gap=0.25;
 for(let i=1;i<words.length;i++){const a=words[i-1].end,b=words[i].start;if(b>t+0.05 || b<t-2.5)continue;if(b-a>gap){gap=b-a;best=(a+b)/2;}}
 return t<=0.05?0:best;
}
// A beat said again after going back: the last attempt is the one kept, and each earlier one is cut as a retake.
// A restart the detector already found there becomes that cut; otherwise the earlier attempt's own span is cut.
export function retakeCuts(cutList,episode,takeId,words=[]) {
 const list=structuredClone(cutList),proposals=[];
 let ep=episode;
 for(const beat of episode.beats){
  const mine=beat.takes.filter(t=>t.recordingId===takeId);
  if(mine.length<2)continue;
  ep=chooseTake(ep,beat.id,mine.at(-1).id,LIVE_TICK);
  for(const take of mine.slice(0,-1)){
   const start=snapToPause(words,take.start),end=snapToPause(words,take.end);
   if(end-start<0.3)continue;
   const found=list.cuts.filter(c=>c.kind==='restart'&&Math.min(c.end,end)-Math.max(c.start,start)>0);
   if(found.length){
    const [first,...rest]=found;
    Object.assign(first,{start:Math.min(start,...found.map(c=>c.start)),end:Math.max(end,...found.map(c=>c.end)),certainty:'sure',applied:true,reason:`Restart: ${RETAKE_REASON}`});
    list.cuts=list.cuts.filter(c=>!rest.includes(c));
   }else proposals.push({start,end,certainty:'sure',reason:RETAKE_REASON});
  }
  // The attempt the person went back for is theirs to keep: a restart the detector only suspects inside it is not offered.
  const kept=mine.at(-1),from=snapToPause(words,kept.start);
  list.cuts=list.cuts.filter(c=>!(c.kind==='restart'&&!c.applied&&Math.min(c.end,kept.end)-Math.max(c.start,from)>(c.end-c.start)/2));
 }
 return {cutList:protectWordEdges(addRestartCuts(list,proposals),words),episode:ep};
}
export function finishPageTake({live,pcm=null,words=[],spoke=words.length>0,episode,duration=null,storyBeats=[]}) {
 const seconds=Number.isFinite(duration)?duration:pcm?pcm.samples.length/pcm.sampleRate:0;
 // A take with no speech in it keeps a trial accepted in it and adds nothing to the count of one it carried.
 // `spoke` says speech was heard when the words themselves are not handed over (a large capture is saved uncut).
 if(!words.length) return {beats:recordingBeats(storyBeats,withoutUnverifiedSummaries(episode)),transcript:[],duration:seconds,cuts:createCutList(),reviewMoments:[],trials:mergeById(live.experiments || [],spoke?live.carriedTrials || []:[]),experiments:[],notes:structuredClone(live.notes || [])};
 if(!pcm) throw new Error('Audio could not be decoded. Your video is kept; retry saving this take.');
 // The saved tick is the one the person saw: the beat's words were covered and no restart is left in it.
 const r=finishTake({live,pcm,words,episode,settings:{episode:LIVE_TICK}});
 const retakes=retakeCuts(r.cutList,r.episode,live.takeId,words);
 return {beats:recordingBeats(storyBeats,retakes.episode),transcript:words,duration:seconds,cuts:retakes.cutList,reviewMoments:r.moments,trials:mergeById(live.experiments || [],live.carriedTrials || []),experiments:[],notes:structuredClone(live.notes || [])};
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
  // A word the timing stretched across a pause is not a word that long: left as it is, a cut that ends in the pause
  // would be pulled back to the word's start. It is held to a spoken length.
  const words=result.words.map(w=>w.end-w.start>MAX_WORD_SEC?{...w,end:w.start+MAX_WORD_SEC}:w);
  return {words,note:words.length?null:'No speech timing was found. This take is saved uncut.'};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Speech timing timed out')),timeoutMs);})]);
 }catch{return {words:[],note:'Speech timing failed or took too long. This take is saved uncut.'};}finally{clearTimeout(timer);}
}
