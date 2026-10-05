// Live refinement panel: talk with YAP about the beat you are presenting, then Apply, Undo, Continue.
// DOM + conversation only. wire.js owns capture and gives this module hooks; nothing here touches a
// recorder, a stream or the engine directly. No fake replies: an answer shown here came from /api/model.
import {createRefinement,appendTurn,applyRevision,undoRevision,canUndo,effectiveText,recentTurns,COACH_LIMITS} from '../../src/engine/live-refine.js';

export const COPY={
 unavailable:"YAP's coach isn't available right now (it needs your own Claude Code). Nothing was changed. Your words are kept — edit them and try again.",
 conflict:'These notes changed in another tab. Reload the saved notes; yours were not saved.',
 notSaved:'Not saved. Nothing was applied — try again.',
 noVoice:'Voice is not available in this browser. Type instead.',
 voiceDenied:'The browser did not allow voice input. Type instead.',
 slides:'YAP only changes its own beat wording — never your Google Slides.',
};
const bad=(m)=>Object.assign(new Error(m),{});
const el=(doc,tag,props={},...kids)=>{const n=doc.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='text')n.textContent=v;else if(k==='testid')n.dataset.testid=v;else if(k in n&&k!=='role')n[k]=v;else n.setAttribute(k,v);}n.append(...kids);return n;};

/** Browser speech adapters: real ones by default, replaceable in tests. Nothing is started here. */
export function browserSpeech(scope=globalThis){
 const Recognition=scope.SpeechRecognition||scope.webkitSpeechRecognition;
 return {
  recognitionSupported:typeof Recognition==='function',
  createRecognizer:()=>new Recognition(),
  ttsSupported:Boolean(scope.speechSynthesis&&scope.SpeechSynthesisUtterance),
  speak(text,{onend,onerror}){const u=new scope.SpeechSynthesisUtterance(text);u.onend=onend;u.onerror=onerror;scope.speechSynthesis.cancel();scope.speechSynthesis.speak(u);},
  cancelSpeech(){scope.speechSynthesis?.cancel();},
 };
}

/**
 * @param {object} o
 * hooks (from wire.js): context() -> {beat:{id,title,text},beats:[{id,title,summary}],spoken}, enter(), leave(), apply(beatId,text) -> {from,to,at}|null,
 *  status() -> string, elapsed(), intervalInfo() -> {uiSeconds}|null
 */
export function mountLiveRefine({document:doc,recordingId,hooks,speech=browserSpeech(),fetchImpl=globalThis.fetch.bind(globalThis),host=doc.body,headerActions=doc.querySelector('.header-actions'),now=()=>Date.now(),requestTimeoutMs=15000}){
 // epoch = the operation/session token: it moves on enter, leave and dispose, so any await that finishes under an older epoch is stale.
 let rec=createRefinement(recordingId),baseRevision=0,refining=false,pending=null,seq=0,proposal=null,speakOn=false,speaking=false,recognizer=null,queue=Promise.resolve(),conflict=false,openInterval=null,destroyed=false,epoch=0,transition=null,dirty=false,loading=false;
 const open=el(doc,'button',{type:'button',className:'help glass coach-open',testid:'coach-open','aria-expanded':'false','aria-controls':'coach-panel','aria-label':'Talk to YAP'},el(doc,'span',{text:'Talk to YAP'}));
 headerActions?.prepend(open);
 const status=el(doc,'p',{className:'coach-status',testid:'coach-status',role:'status'});
 const log=el(doc,'div',{className:'coach-log',testid:'coach-log',role:'log','aria-live':'polite',tabIndex:0,'aria-label':'Conversation with YAP'});
 const note=el(doc,'p',{className:'coach-note',testid:'coach-note',role:'status'});
 const beatWords=el(doc,'p',{className:'coach-beat-words',testid:'coach-beat-words'});
 const beatTitle=el(doc,'strong',{testid:'coach-beat-title'});
 const propBox=el(doc,'section',{className:'coach-proposal',testid:'coach-proposal','aria-label':'Suggested wording',hidden:true});
 const propOrig=el(doc,'p',{className:'coach-original',testid:'coach-original'});
 const propText=el(doc,'textarea',{rows:3,testid:'coach-proposal-text','aria-label':'Suggested wording, editable'});
 const apply=el(doc,'button',{type:'button',className:'coach-primary',testid:'coach-apply',text:'Apply change'});
 const dismiss=el(doc,'button',{type:'button',testid:'coach-dismiss',text:'Dismiss'});
 propBox.append(el(doc,'span',{className:'coach-kicker',text:'SUGGESTED WORDING — edit if you like'}),propText,el(doc,'span',{className:'coach-kicker',text:'ORIGINAL (kept until you apply)'}),propOrig,el(doc,'div',{className:'coach-row'},apply,dismiss));
 const undo=el(doc,'button',{type:'button',testid:'coach-undo',text:'Undo last change',hidden:true});
 const input=el(doc,'textarea',{rows:2,testid:'coach-input','aria-label':'Tell YAP what to change or ask a question',placeholder:'Ask, or say what to change…'});
 const send=el(doc,'button',{type:'submit',className:'coach-primary',testid:'coach-send',text:'Send'});
 const mic=el(doc,'button',{type:'button',testid:'coach-mic','aria-pressed':'false','aria-label':'Speak your turn',text:'🎙 Speak'});
 const cancel=el(doc,'button',{type:'button',testid:'coach-cancel',text:'Cancel',hidden:true});
 const speak=el(doc,'button',{type:'button',testid:'coach-speak','aria-pressed':'false',text:'Read answers aloud: off'});
 const readNow=el(doc,'button',{type:'button',testid:'coach-read',text:'Read last answer',hidden:true});
 const cont=el(doc,'button',{type:'button',className:'coach-primary coach-continue',testid:'coach-continue',text:'Continue presentation'});
 const form=el(doc,'form',{className:'coach-form',autocomplete:'off'},input,el(doc,'div',{className:'coach-row'},mic,send,cancel));
 const panel=el(doc,'aside',{className:'coach-panel glass',id:'coach-panel',testid:'coach-panel','aria-label':'Talk to YAP',hidden:true},
  el(doc,'div',{className:'coach-head'},el(doc,'strong',{text:'Talk to YAP'}),el(doc,'span',{className:'coach-beat'},'Beat: ',beatTitle)),
  status,beatWords,log,note,propBox,undo,form,el(doc,'div',{className:'coach-row coach-tools'},speak,readNow),el(doc,'p',{className:'coach-slides',text:COPY.slides}),cont);
 host.append(panel);
 const say=(t)=>{note.textContent=t||'';note.hidden=!t;};
 const refresh=()=>{const c=hooks.context();beatTitle.textContent=c.beat.title;beatWords.textContent=c.beat.text;propOrig.textContent=proposal?proposal.original:'';status.textContent=hooks.status();undo.hidden=!(refining&&canUndo(rec,c.beat.id));
  mic.disabled=!speech.recognitionSupported||speaking||Boolean(pending);mic.title=speech.recognitionSupported?'':COPY.noVoice;speak.disabled=!speech.ttsSupported;speak.title=speech.ttsSupported?'':'Spoken replies are not available in this browser.';send.disabled=Boolean(pending);cancel.hidden=!pending;apply.disabled=!proposal||Boolean(transition);apply.textContent=transition==='apply'?'Saving…':'Apply change';dismiss.disabled=Boolean(transition);undo.disabled=Boolean(transition);undo.textContent=transition==='undo'?'Saving…':'Undo last change';cont.disabled=Boolean(transition);cont.textContent=transition?'Saving… then you can continue':'Continue presentation';};
 const bubble=(turn)=>{const b=el(doc,'div',{className:`coach-msg coach-${turn.role}`,testid:`coach-msg-${turn.role}`},el(doc,'span',{className:'coach-who',text:turn.role==='user'?'You':'YAP'}),el(doc,'span',{text:turn.text}));log.append(b);log.scrollTop=log.scrollHeight;};
 const renderLog=()=>{log.replaceChildren();for(const t of rec.conversation)bubble(t);};
 function stopVoice(){if(recognizer){const r=recognizer;recognizer=null;r.onresult=r.onerror=r.onend=null;try{r.abort();}catch{}}mic.setAttribute('aria-pressed','false');}
 function stopSpeaking(){if(speaking){speaking=false;speech.cancelSpeech();}}
 function say_aloud(text){if(!speakOn||!speech.ttsSupported||!text)return;stopVoice();speaking=true;refresh();speech.speak(text,{onend:()=>{speaking=false;refresh();},onerror:()=>{speaking=false;refresh();}});}
 // ----- saving: ONE queue of state transitions. `build(latest)` runs inside the queue against the latest committed
 // record, so a queued save can never send a snapshot that predates an earlier one (serialising only the HTTP would).
 // A failed save of conversation/interval entries stays in the local record (dirty) and rides on the next save;
 // a failed Apply/Undo (keep:false) commits nothing, so the original wording stays intact.
 const timed=async(url,init)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),requestTimeoutMs);try{return await fetchImpl(url,{...init,signal:c.signal});}finally{clearTimeout(t);}};
 const putRecord=async(candidate)=>{
  let response;try{response=await timed(`/api/app/recordings/${recordingId}/live-refine`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision,conversation:candidate.conversation,revisions:candidate.revisions,intervals:candidate.intervals})});}catch{throw bad(COPY.notSaved);}
  const body=await response.json().catch(()=>({}));
  if(response.status===409){conflict=true;throw bad(body.error||COPY.conflict);}
  if(!response.ok)throw bad(body.error||COPY.notSaved);
  return body;
 };
 function mutate(build,{keep=false,persist=true,guard=null}={}){
  const run=queue.then(async()=>{
   if(guard&&!guard())return {skipped:true};
   const next=build(rec);if(!next)return {skipped:true};
   if(!persist){rec=next;dirty=true;return {next};}
   try{
    if(conflict)throw bad(COPY.conflict);
    const body=await putRecord(next);
    baseRevision=body.revision;rec=next;dirty=false;return {next,body};
   }catch(error){if(keep){rec=next;dirty=true;}throw error;}
  });
  queue=run.catch(()=>{});return run;
 }
 const save=()=>mutate(r=>r);
 // The first GET (and an explicit reload) sit on the same queue as every save. A load that finishes after the user changed
 // anything locally keeps the local record; only a clean record adopts the server's. `force` is the explicit reload.
 function load({force=false}={}){
  loading=true;
  const run=queue.then(async()=>{
   try{
    const response=await timed(`/api/app/recordings/${recordingId}/live-refine`);if(!response.ok)return null;
    const body=await response.json();
    if(force||!dirty){rec={...createRefinement(recordingId),conversation:body.conversation||[],revisions:body.revisions||[],intervals:body.intervals||[]};baseRevision=body.revision||0;conflict=false;dirty=false;renderLog();}
    return rec;
   }catch{return null;}finally{loading=false;}
  });
  queue=run.catch(()=>{});return run;
 }
 // ----- one turn
 async function submit(text){
  text=String(text||'').trim();if(!text||pending||!refining||destroyed)return;
  stopVoice();stopSpeaking();say('');
  const ctx=hooks.context(),id=++seq,controller=new AbortController(),ep=epoch;
  const mine=()=>!destroyed&&refining&&epoch===ep&&pending&&pending.id===id;
  pending={id,beatId:ctx.beat.id,controller};refresh();
  const body={task:'coach',beat:ctx.beat,beats:ctx.beats,spoken:ctx.spoken||'',turns:recentTurns(rec,COACH_LIMITS.maxTurns),instruction:text};
  let answer=null,failure=null;
  try{
   const response=await fetchImpl('/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)failure=data.error||COPY.unavailable;
   else if(!data.coach||data.source==='none')failure=COPY.unavailable;
   else if(!data.coach.ok)failure=(await import('../../src/engine/live-refine.js')).REPLY_FAILURES[data.coach.reason]||COPY.unavailable;
   else answer={...data.coach,source:data.source};
  }catch(error){failure=error?.name==='AbortError'?null:COPY.unavailable;}
  // A late or cancelled answer never lands: the turn must still be the current one, in this same open session, on the same beat.
  if(!mine())return;
  if(hooks.context().beat.id!==pending.beatId){pending=null;say('You moved to another beat, so that answer was dropped.');refresh();return;}
  if(failure){pending=null;input.value=text;say(failure);refresh();input.focus();return;}
  const prop=answer.proposal&&answer.proposal.beatId===ctx.beat.id?answer.proposal:null;
  // pending stays set through the save: no second turn can start, and Cancel/Continue/beat switch still invalidate this one.
  let failed=null;
  try{await mutate(r=>{let n=appendTurn(r,{role:'user',text,beatId:ctx.beat.id});return appendTurn(n,{role:'assistant',text:answer.answer,beatId:ctx.beat.id,source:answer.source,proposal:prop});},{keep:true});}catch(error){failed=error;}
  renderLog();
  // The reply is in the saved record either way. Whether it SPEAKS or offers a proposal depends on the session still being the one it was asked in.
  if(!mine()){refresh();return;}
  pending=null;
  if(hooks.context().beat.id!==ctx.beat.id){say('You moved to another beat, so that suggestion was dropped.');refresh();return;}
  input.value='';
  if(failed)say(`${failed.message} (this turn is shown but not saved; it will be kept for the next save)`);
  proposal=prop?{beatId:prop.beatId,text:prop.text,original:ctx.beat.text}:null;propText.value=prop?prop.text:'';propBox.hidden=!prop;
  readNow.hidden=!speech.ttsSupported;refresh();say_aloud(answer.answer);
 }
 form.onsubmit=e=>{e.preventDefault();submit(input.value);};
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit(input.value);}});
 cancel.onclick=()=>{if(pending){const p=pending;pending=null;p.controller.abort();say('Cancelled. Nothing changed. Your words are kept.');refresh();}};
 mic.onclick=()=>{
  if(recognizer){stopVoice();say('');return;}
  if(!speech.recognitionSupported||speaking||pending){say(COPY.noVoice);return;}
  say('');let r;try{r=speech.createRecognizer();}catch{say(COPY.noVoice);return;}
  r.lang='en-US';r.continuous=false;r.interimResults=true;recognizer=r;mic.setAttribute('aria-pressed','true');
  r.onresult=e=>{let t='';for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;input.value=t.trim();};
  r.onerror=e=>{stopVoice();say(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)?COPY.voiceDenied:`Voice stopped (${e.error||'error'}). Type instead.`);};
  r.onend=()=>{if(recognizer===r){recognizer=null;mic.setAttribute('aria-pressed','false');if(input.value.trim())say('Check the words, edit them if needed, then Send.');}};
  try{r.start();}catch{stopVoice();say(COPY.noVoice);}
 };
 speak.onclick=()=>{speakOn=!speakOn;speak.setAttribute('aria-pressed',String(speakOn));speak.textContent=`Read answers aloud: ${speakOn?'on':'off'}`;if(!speakOn)stopSpeaking();refresh();};
 readNow.onclick=()=>{const last=[...rec.conversation].reverse().find(t=>t.role==='assistant');if(last){const was=speakOn;speakOn=true;say_aloud(last.text);speakOn=was;}};
 // ----- apply / dismiss / undo
 dismiss.onclick=()=>{proposal=null;propBox.hidden=true;propText.value='';say('Dismissed. Your original wording is unchanged.');refresh();};
 // Apply and Undo are explicit transitions: one at a time (`transition`), Continue is held until they settle, and the engine
 // is only changed after the save landed, inside the same open session.
 async function runTransition(kind,build,{beatId,guard,onDone}){
  if(transition||destroyed)return;
  const ep=epoch;transition=kind;say(kind==='apply'?'Saving the change…':'Saving the undo…');refresh();
  try{
   const result=await mutate(build,{guard:()=>!destroyed&&epoch===ep&&guard()});
   if(result.skipped){say('That change no longer fits, so nothing was saved.');}
   else if(!destroyed&&refining&&epoch===ep)onDone(result);
  }catch(error){if(!destroyed&&epoch===ep)say(`${error.message||COPY.notSaved} ${kind==='apply'?'Not applied — the suggestion is kept so you can retry.':'Not undone.'}`);}
  finally{transition=null;refresh();}
 }
 apply.onclick=()=>{
  if(!proposal||transition)return;const prop=proposal,text=propText.value.trim();if(!text){say('The wording is empty. Edit it or dismiss.');return;}
  const ctx=hooks.context();if(ctx.beat.id!==prop.beatId){say('You moved to another beat. This suggestion no longer fits and was dropped.');proposal=null;propBox.hidden=true;refresh();return;}
  if(text.length>COACH_LIMITS.proposalChars){say(`Keep the wording under ${COACH_LIMITS.proposalChars} characters; it is not cut for you.`);return;}
  const from=ctx.beat.text,at=hooks.elapsed(),wallMs=now();
  void runTransition('apply',r=>applyRevision(r,{beatId:prop.beatId,from,to:text,at,wallMs}).next,{beatId:prop.beatId,guard:()=>proposal===prop,onDone:()=>{
   const done=hooks.apply(prop.beatId,text);
   if(!done)say('Saved, but the engine already had these words.');else say('Applied. The new wording is used from when you continue. Earlier footage keeps its original words.');
   if(proposal===prop){proposal=null;propBox.hidden=true;propText.value='';}
  }});
 };
 undo.onclick=()=>{
  if(transition)return;const ctx=hooks.context(),beatId=ctx.beat.id,at=hooks.elapsed(),wallMs=now();let restored=null;
  if(!undoRevision(rec,{beatId,at,wallMs}))return;
  void runTransition('undo',r=>{const u=undoRevision(r,{beatId,at,wallMs});restored=u?u.revision.to:null;return u?u.next:null;},{beatId,guard:()=>hooks.context().beat.id===beatId,onDone:()=>{hooks.apply(beatId,restored);say('Restored the previous wording.');}});
 };
 // ----- entering and leaving
 function invalidate(why){if(pending){pending.controller.abort();pending=null;}if(proposal){proposal=null;propBox.hidden=true;}if(why)say(why);refresh();}
 function enter(){
  if(refining||destroyed)return;
  const info=hooks.enter();if(info===null||info===undefined)return;// the capture refused (stopped, or already held): no interval, no panel
  epoch++;refining=true;panel.hidden=false;open.setAttribute('aria-expanded','true');openInterval={cleanSeconds:hooks.elapsed(),uiStartSeconds:info?.uiSeconds??null,uiEndSeconds:null,wallStartMs:now(),wallEndMs:0};
  renderLog();say('');refresh();input.focus();
 }
 // Continue / stop. Capture resumes at once (hooks.leave) and never waits on a save; the epoch moves so nothing still in flight
 // can speak or offer a proposal in the resumed take. The interval is appended to the LATEST record inside the queue.
 async function leave({silent=false}={}){
  if(!refining)return;
  stopVoice();stopSpeaking();if(pending){pending.controller.abort();pending=null;}proposal=null;propBox.hidden=true;
  refining=false;epoch++;panel.hidden=true;open.setAttribute('aria-expanded','false');
  const info=hooks.leave();
  if(openInterval){const iv={...openInterval,uiEndSeconds:info?.uiSeconds??null,wallEndMs:now()};openInterval=null;await mutate(r=>({...r,intervals:[...r.intervals,iv]}),{keep:true,persist:!silent}).catch(()=>{});}
  refresh();
 }
 open.onclick=()=>{if(refining){input.focus();}else enter();};
 cont.onclick=()=>{if(!transition)leave();};
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(pending)cancel.click();else{stopVoice();stopSpeaking();refresh();}}});
 return {
  load,enter,leave,refresh,invalidate,save,panel,open,
  get saving(){return transition;},get loading(){return loading;},get epoch(){return epoch;},
  get refining(){return refining;},get record(){return rec;},get proposal(){return proposal;},
  revisedText:(beatId,original)=>rec.revisions.some(r=>r.beatId===beatId)?effectiveText(rec,beatId,original):null,
  hasRevisions:(beatId)=>rec.revisions.some(r=>r.beatId===beatId),
  edited:(beatId)=>canUndo(rec,beatId),
  reloadSaved:()=>load({force:true}),
  // cleanup for stop / pagehide: recognition and speech never outlive the page or the take
  dispose(){destroyed=true;epoch++;stopVoice();stopSpeaking();if(pending){pending.controller.abort();pending=null;}},
  onBeatChange(){if(refining&&(pending||proposal)){const c=hooks.context();if((pending&&pending.beatId!==c.beat.id)||(proposal&&proposal.beatId!==c.beat.id))invalidate(`Now discussing “${c.beat.title}”. The earlier suggestion was dropped.`);else refresh();}else if(refining)refresh();},
 };
}
