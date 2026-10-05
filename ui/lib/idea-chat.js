// The idea conversation on the idea screens: YAP answers in the thread, and a suggested outline joins the
// idea only when the person presses "Use these beats". Every answer shown here came from /api/model
// (task 'ideate', Claude Code only); nothing is simulated. History lives in the idea's own sidecar
// (server/idea-chat-api.js). Text is always set with textContent, never as HTML.
//
// One deliberate send makes one question. A question is claimed on the server before it is asked, so a
// reload, a second tab or a double click cannot ask it twice, and a page that loads with an unanswered
// question asks it at most once. A failed question is asked again only when the person presses Try again.
import {editableRows} from './beats-model.js';
import {IDEA_CHAT_LIMITS,FAILURE_COPY,REPLY_FAILURES,contextTurns,lastUserTurn,outlineToKept} from '../../src/engine/idea-chat.js';

const API='/api/app/ideas/';
const ASK_TIMEOUT_MS=35000;
const POLL_MS=3000;
const POLL_TRIES=16;
const FROM={'claude-code':'Claude Code on this computer'};
const fit=(text,n)=>{const t=String(text??'').replace(/\s+/g,' ').trim();return t.length<=n?t:`${t.slice(0,n-1).trimEnd()}…`;};
const newClientId=()=>`c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

async function call(fetchImpl,id,data){
 const init={mode:'same-origin',credentials:'same-origin',cache:'no-store'};
 if(data){init.method='POST';init.headers={'Content-Type':'application/json'};init.body=JSON.stringify(data);}
 const res=await fetchImpl(`${API}${id}/chat`,init);
 const body=await res.json().catch(()=>({}));
 return {status:res.status,ok:res.ok,body};
}

/** Keep the first thought's conversation going from the Ideas opening: one saved message, nothing asked here. Never throws. */
export async function startIdeaChat(id,text,fetchImpl=globalThis.fetch){
 try{const r=await call(fetchImpl,id,{op:'send',origin:'thought',text:String(text||'').trim().slice(0,IDEA_CHAT_LIMITS.messageChars),clientId:newClientId()});return r.ok?r.body.record:null;}catch{return null;}
}

/**
 * @param {{id:string,fetchImpl?:Function,doc?:Document,getIdea:()=>any,writeBeats:(rows:any[])=>Promise<boolean>,openBeats?:()=>void,timeoutMs?:number}} o
 */
export function createIdeaChat({id,fetchImpl=globalThis.fetch.bind(globalThis),doc=document,getIdea,writeBeats,openBeats=()=>{},timeoutMs=ASK_TIMEOUT_MS}){
 let record=null,box=null,token=0,asking=false,sending=false,applying=false,status='',loadFailed='',destroyed=false,pollTimer=null,pollsLeft=0;
 const hook=(name,el)=>{el.dataset.testid=name;return el;};
 const el=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const button=(label,name,onClick,cls='',disabled=false)=>{const b=hook(name,el('button',`ic-btn ${cls}`.trim(),label));b.type='button';b.disabled=disabled;b.addEventListener('click',onClick);return b;};
 if(!doc.querySelector('link[data-idea-chat-css]')){const l=doc.createElement('link');l.rel='stylesheet';l.href=new URL('./idea-chat.css',import.meta.url).href;l.dataset.ideaChatCss='true';doc.head.append(l);}

 const thoughtText=()=>{const i=getIdea()||{};return (i.thought||i.title||'').trim();};
 /** The conversation the request carries: bounded, fitted whole, nothing the person never said. */
 function context(turn){
  const idea=getIdea()||{},L=IDEA_CHAT_LIMITS,thought=thoughtText();
  const others=(Array.isArray(idea.words)?idea.words:[]).filter(w=>typeof w==='string'&&w.trim()&&w.trim()!==thought).map(w=>fit(w,L.wordChars));
  const body={task:'ideate',idea:{title:fit(idea.title,L.titleChars),thought:fit(thought,L.thoughtChars),format:fit(idea.format,L.formatChars)},words:others.slice(-4),
   beats:editableRows(idea).slice(0,L.maxBeats).map(r=>({title:fit(r.title,L.beatTitleChars),line:fit(r.line,L.beatLineChars)})),
   turns:contextTurns(record,turn.id),message:fit(turn.text,L.messageChars)};
  // Fit the whole request: older turns go first, then longer lines are shortened with a visible ellipsis.
  while(new TextEncoder().encode(JSON.stringify(body)).length>L.bodyBytes-600){
   if(body.turns.length>2)body.turns.shift();
   else if(body.beats.some(b=>b.line.length>160))body.beats=body.beats.map(b=>({...b,line:fit(b.line,160)}));
   else if(body.words.length)body.words.shift();
   else if(body.beats.length)body.beats.pop();
   else break;
  }
  return body;
 }
 const adopt=(next)=>{if(next&&Array.isArray(next.turns)&&(!record||next.revision>=record.revision))record=next;};

 // ---------- drawing ----------
 const sourceLabel=(s)=>`From ${FROM[s]||String(s||'a model').slice(0,40)}. Suggestions only, nothing is applied until you say so.`;
 function outlineCard(turn,isLast){
  const o=turn.outline,wrap=hook('idea-chat-outline',el('div','ic-outline'));
  wrap.append(el('h4','','Suggested beats, from your words'));
  const ol=el('ol','');for(const b of o.beats){const li=el('li','');li.append(el('strong','',b.title),el('span','',b.body));ol.append(li);}
  wrap.append(ol);
  const accepted=record.accepted&&record.accepted.turnId===turn.id&&!record.accepted.undone&&o.status==='applied';
  if(o.status==='open'||o.status==='undone'){
   const row=el('div','ic-actions');
   row.append(button('Use these beats','idea-chat-use',()=>accept(turn),'ic-gold',applying),button('Not now','idea-chat-dismiss',()=>dismiss(turn),'',applying));
   wrap.append(row);
   wrap.append(el('p','ic-closed',o.status==='undone'?'Undone. Your earlier outline is back. You can use these again.':'Using these replaces your current outline. You can undo it, and edit every beat afterwards.'));
  }else if(accepted){
   wrap.append(hook('idea-chat-applied',el('p','ic-closed','In use as your outline. Your earlier outline was kept and can be restored.')));
   const row=el('div','ic-actions');row.append(button('Edit beats','idea-chat-edit',openBeats,'ic-gold'),button('Undo','idea-chat-undo',()=>undo(),'',applying));wrap.append(row);
  }else if(o.status==='applied'){wrap.append(el('p','ic-closed','This was used, then changed. Edit your beats any time.'));wrap.append(el('div','ic-actions')).append(button('Edit beats','idea-chat-edit',openBeats));}
  else wrap.append(el('p','ic-closed','Not used.'));
  return wrap;
 }
 function paint(){
  if(!box||destroyed)return;
  box.replaceChildren();
  if(loadFailed){box.append(hook('idea-chat-error',el('p','ic-fail',loadFailed)));return;}
  if(!record)return;
  const last=lastUserTurn(record);
  for(const turn of record.turns){
   if(turn.role==='user'){
    if(turn.origin==='thought')continue; // already shown as the first message of the idea
    const m=hook('idea-chat-you',el('div','ic-msg ic-you'));m.append(el('p','ic-who','You'),el('p','ic-text',turn.text));box.append(m);
   }else{
    const m=hook('idea-chat-yap',el('div','ic-msg ic-yap'));m.append(el('p','ic-who','YAP'),el('p','ic-text',turn.text),el('p','ic-from',sourceLabel(turn.source)));
    if(turn.outline)m.append(outlineCard(turn));
    box.append(m);
   }
  }
  if(asking||(last&&last.status==='asking'&&pollTimer)||sending)box.append(hook('idea-chat-status',Object.assign(el('p','ic-status',status||'YAP is thinking…'),{role:'status'})));
  else if(last&&last.status==='failed'&&last.failure!=='superseded'){
   const f=hook('idea-chat-failure',el('div','ic-fail'));f.setAttribute('role','alert');
   f.append(el('span','',FAILURE_COPY[last.failure]||FAILURE_COPY.error));
   const row=el('div','ic-actions');row.append(button('Try again','idea-chat-retry',()=>ask(last,true),'ic-gold'));f.append(row);box.append(f);
  }else if(last&&last.status==='asking'){
   const f=hook('idea-chat-failure',el('div','ic-fail'));f.setAttribute('role','alert');
   f.append(el('span','','This one did not finish. Your words are saved.'));const row=el('div','ic-actions');row.append(button('Try again','idea-chat-retry',()=>ask(last,true),'ic-gold'));f.append(row);box.append(f);
  }
  if(status&&!asking&&!sending&&!(last&&last.status==='failed'))box.append(hook('idea-chat-note',Object.assign(el('p','ic-note',status),{role:'status'})));
  const scroller=box.parentElement;if(scroller&&scroller.scrollHeight>scroller.clientHeight)scroller.scrollTop=scroller.scrollHeight;
 }

 // ---------- the steps ----------
 async function step(data){
  const r=await call(fetchImpl,id,data);
  if(r.ok||r.status===409)adopt(r.body.record);
  return r;
 }
 async function ask(turn,retry=false){
  if(asking||destroyed)return;
  asking=true;const mine=++token;status='';paint();
  let claim;
  try{claim=await step({op:'claim',turnId:turn.id,retry});}catch{claim=null;}
  if(!claim||!claim.ok||!claim.body.result?.claimed){
   asking=false;
   if(claim&&claim.ok&&claim.body.result?.turn?.status==='asking')startPolling();
   else if(claim&&claim.status===409)status=claim.body.error||'';
   paint();return;
  }
  if(destroyed||mine!==token){asking=false;return;}
  const fresh=claim.body.result.turn;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let reason=null,answer=null,source='';
  try{
   const response=await fetchImpl('/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context(fresh)),signal:controller.signal});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)reason=response.status===400||response.status===413?'refused':'error';
   else if(data.source==='none'||!data.ideate)reason='unavailable';
   else if(!data.ideate.ok)reason='unreadable';
   else{answer=data.ideate;source=data.source;}
  }catch(e){reason=e&&e.name==='AbortError'?'timeout':'unavailable';}
  finally{clearTimeout(timer);}
  // A reply that arrives after the person moved on is not shown: only the newest question may write.
  if(destroyed||mine!==token){asking=false;return;}
  try{
   if(answer)await step({op:'reply',turnId:fresh.id,source,answer:answer.answer,outline:answer.outline});
   else await step({op:'fail',turnId:fresh.id,reason});
  }catch{/* the record is read again on the next load */}
  asking=false;paint();
 }
 function startPolling(){
  stopPolling();pollsLeft=POLL_TRIES;
  pollTimer=setInterval(async()=>{
   if(destroyed||asking||--pollsLeft<0){stopPolling();paint();return;}
   try{const r=await call(fetchImpl,id);if(r.ok){adopt(r.body.record);const last=lastUserTurn(record);if(!last||last.status!=='asking'){stopPolling();}}}catch{/* try again next beat */}
   paint();
  },POLL_MS);
 }
 function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}

 async function load(){
  try{
   const r=await call(fetchImpl,id);
   if(destroyed)return record;
   if(!r.ok){loadFailed=r.body?.error?`Your conversation could not be opened: ${r.body.error} Your idea is unchanged.`:'Your conversation could not be opened. Your idea is unchanged.';paint();return null;}
   loadFailed='';adopt(r.body.record);paint();
  }catch{loadFailed='Your conversation could not be opened. Your idea is unchanged.';paint();return null;}
  const last=lastUserTurn(record);
  if(last&&last.status==='pending')ask(last);          // the one question a deliberate send left waiting
  else if(last&&last.status==='asking')startPolling(); // another page is asking it
  return record;
 }
 /** Save one message and, unless `ask` is false, ask YAP about it. Resolves to the saved turn or null. */
 async function send(text,{ask:doAsk=true}={}){
  const words=String(text||'').trim();
  if(!words||sending||asking||destroyed)return null;
  if(words.length>IDEA_CHAT_LIMITS.messageChars){status=`Keep it under ${IDEA_CHAT_LIMITS.messageChars} characters.`;paint();return null;}
  sending=true;status='Saving…';paint();
  let r;
  try{r=await step({op:'send',text:words,clientId:newClientId(),baseRevision:record?record.revision:undefined});}catch{r=null;}
  sending=false;
  if(!r||!r.ok){status=!r?'YAP could not save that: its own server did not answer. Your words are still in the box.':(r.body.error||'That was not saved.');paint();return null;}
  status='';paint();
  const turn=r.body.result.turn;
  if(doAsk)ask(turn);
  return turn;
 }
 async function accept(turn){
  if(applying||destroyed)return;
  applying=true;status='';paint();
  const previous=editableRows(getIdea()||{}).slice(0,IDEA_CHAT_LIMITS.maxBeats).map(r=>({id:r.id,title:r.title,line:r.line,...(r.preparedAngles?{preparedAngles:r.preparedAngles}:{})}));
  try{
   const r=await step({op:'accept',turnId:turn.id,previous});
   if(!r.ok){status=r.body.error||'That could not be used.';return;}
   const rows=outlineToKept(record.accepted.beats);
   if(!(await writeBeats(rows))){status='YAP could not confirm the saved outline. Reload to check it before trying again.';await step({op:'undo'}).catch(()=>{});return;}
   status='Your outline now uses these beats.';
  }catch{status='The server did not answer. Reload to check your saved outline before trying again.';}
  finally{applying=false;paint();}
 }
 async function undo(){
  if(applying||!record?.accepted||record.accepted.undone)return;
  applying=true;status='';paint();
  try{
   const before=record.accepted.previous;
   if(!(await writeBeats(before))){status='YAP could not confirm the restored outline. Reload to check it before trying again.';return;}
   await step({op:'undo'});status='Your earlier outline is back.';
  }catch{status='That could not be undone: the server did not answer.';}
  finally{applying=false;paint();}
 }
 async function dismiss(turn){
  if(applying)return;applying=true;paint();
  try{await step({op:'dismiss',turnId:turn.id});}catch{status='That could not be saved.';}
  finally{applying=false;paint();}
 }

 return {
  load,send,
  /** Put the conversation at the end of the thread; call after the thread is redrawn. */
  attach(thread){if(!box||box.parentElement!==thread||!thread.contains(box)){box=hook('idea-chat',el('div','ic'));box.setAttribute('aria-live','polite');}thread.append(box);paint();},
  askLatest(){const last=record&&lastUserTurn(record);if(last&&last.status==='pending')ask(last);},
  busy:()=>asking||sending||applying,
  record:()=>record,
  destroy(){destroyed=true;token++;stopPolling();},
 };
}
