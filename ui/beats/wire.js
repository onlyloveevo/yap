import {go,isShellMode,sayQuietly,wireNav} from '../lib/app.js';
import {APP_API,getIdea,patchIdea} from '../lib/api.js';
import {editableRows,keptBeats,offeredBeats,refinedRows} from '../lib/beats-model.js';
import {ideaWords} from '../lib/idea-model.js';
import {talkInto} from '../lib/idea-wire.js';
import {GALLERY_CSS,injectStyles,openRenameDialog} from '../lib/gallery-controls.js';
import {formatNamed,formatOf,keyElementOf,templateOf} from '../../src/engine/formats.js';
import {matchRoute,routeFor} from '../lib/routes.js';
import {PLAIN_WRITE,applyRequest,asksRemoval,listRequestText,momentRows,namedRows,offeredFromWords,onlyShortens,plainAnswer,readListReply,readRequest,saidBy,shortTitle,withoutRepeats} from '../../src/engine/beat-list.js';
import {COACH_BY} from '../../src/engine/idea-coach.js';
const $=id=>document.querySelector(`[data-testid="${id}"]`),shell=isShellMode(location),ideaId=matchRoute(location.pathname,location.search)?.params.id;
wireNav(document);
// "Back to idea" opens the idea while its conversation is still open. A saved idea's screen sends the
// person straight back to these beats (ui/lib/idea-wire.js), so from a saved idea the way back is Create.
let backTo='/create';
document.addEventListener('yap:idea-back',()=>go(backTo));
document.addEventListener('yap:talk',()=>talkInto($('refine-input'),$('talk-to-yap')));
if(shell){
 document.addEventListener('yap:beats-ready',async e=>{await patchIdea(ideaId,{keptBeats:keptBeats(e.detail?.beats)});go(routeFor('prepare',{id:ideaId}));});
}else{
 // The beat list of a person's idea. Rows come from the idea (their own beats) and from YAP (its
 // suggestions, written for this idea by src/engine/beat-list.js). A suggestion is kept only once
 // Accept is pressed. Every change is saved at once: kept beats as the idea's keptBeats, the
 // suggestions still waiting as its offeredBeats, so a reload shows the list as it was left.
 const list=$('beat-list'),template=list.querySelector('.beat').cloneNode(true),acceptTemplate=list.querySelector('.accept').cloneNode(true),cacheKey=`yap-beat-draft:${ideaId}`;
 let idea=null,rows=[],saveQueue=Promise.resolve(),turn=Promise.resolve(),loaded=false,dragId=null,coaching=null;
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const look=el('style','');look.textContent=[
  '.beat-menu{position:absolute;z-index:20;display:flex;flex-direction:column;min-width:170px;padding:6px;border:1px solid var(--row-border);border-radius:14px;background:rgba(24,20,16,.97);box-shadow:0 18px 40px rgba(0,0,0,.5);}',
  '.beat-menu button{padding:9px 14px;border:0;border-radius:9px;background:transparent;color:var(--white);font:inherit;font-size:15.5px;text-align:left;}',
  '.beat-menu button:hover,.beat-menu button:focus-visible{background:rgba(255,255,255,.08);outline:none;}',
  '.beat-menu button:disabled{opacity:.4;}',
  '.accept[aria-pressed="true"]{border-color:var(--amber);color:var(--amber);background:var(--amber-tint);}',
  '.thumb-words{display:flex;align-items:flex-end;width:100%;height:100%;padding:10px 12px 28px;border-radius:inherit;background:radial-gradient(120% 150% at 0% 0%,rgba(244,198,107,.28),transparent 58%),radial-gradient(90% 130% at 100% 100%,rgba(190,110,30,.36),transparent 62%),rgba(255,255,255,.05);font-size:11.5px;font-weight:800;line-height:1.16;letter-spacing:.01em;text-transform:uppercase;overflow:hidden;}',
  '.thumb-words span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}',
  '[data-testid="beats-panel"]>*{flex-shrink:0;}',
  // A long list scrolls inside itself, so Add beat, the idea's extras and Prepare recording stay in reach.
  '[data-testid="beats-panel"]>[data-testid="beat-list"]{flex:0 1 auto;min-height:calc(160 * var(--u));overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--row-border) transparent;}',
  '[data-testid="beat-list"]>.beat{flex:none;}',
  '[data-testid="beat-list"][data-more="true"]{-webkit-mask-image:linear-gradient(#000 calc(100% - 40px),transparent);mask-image:linear-gradient(#000 calc(100% - 40px),transparent);}',
  '.refine-by{margin:calc(10 * var(--u)) 0 0 calc(5 * var(--u));font-size:max(12px,calc(13.5 * var(--u)));color:var(--white-soft);}',
  '.beat-editor{background:rgb(24,21,19);color:var(--white);border:1px solid var(--glass-border);border-radius:var(--radius-panel);padding:var(--space-6);width:min(560px,calc(100vw - 32px));box-shadow:var(--shadow);font-family:var(--font);}',
  '.beat-editor::backdrop{background:rgba(0,0,0,.55);}',
  '.beat-editor h2{margin:0 0 var(--space-4);font-size:24px;font-weight:600;}',
  '.beat-editor label{display:block;font-size:14px;color:var(--white-soft);}',
  '.beat-editor input,.beat-editor textarea{display:block;width:100%;margin:8px 0 var(--space-4);padding:12px var(--space-4);background:var(--field);color:var(--white);border:1px solid var(--field-border);border-radius:var(--radius-field);font:inherit;font-size:17px;resize:none;}',
  '.beat-editor input:focus,.beat-editor textarea:focus{outline:none;border-color:var(--amber);}',
  '.beat-editor .rename-actions{margin-top:var(--space-2);}',
  '.extras{display:flex;align-items:center;gap:14px;width:100%;margin-top:12px;padding:calc(13 * var(--u)) calc(20 * var(--u));border:1px solid var(--row-border);border-radius:var(--radius-row);background:var(--row-bg);color:var(--white);font:inherit;font-size:max(15px,calc(17 * var(--u)));font-weight:600;text-align:left;}',
  '.extras svg{width:24px;height:24px;}.extras .chev{margin-left:auto;}.extras[aria-expanded="true"] .chev{transform:rotate(180deg);}',
  '.extras .chip{padding:3px 10px;border:1px solid var(--row-border);border-radius:8px;font-size:max(12px,calc(13 * var(--u)));font-weight:400;color:var(--white-soft);}',
  '.extras-body{margin:6px 0 0;padding:14px 20px;border:1px solid var(--row-border);border-radius:var(--radius-row);display:flex;flex-direction:column;gap:8px;}',
  '.extras-body p{display:flex;gap:14px;margin:0;font-size:max(14px,calc(15 * var(--u)));line-height:1.4;color:var(--white-soft);}.extras-body .k{flex:none;min-width:9em;font-size:max(11px,calc(12 * var(--u)));letter-spacing:.16em;text-transform:uppercase;color:var(--amber);padding-top:2px;}',
  '[hidden]{display:none !important;}',
 ].join('\n');document.head.append(look);
 // YAP's line sits beside its mark: only the words change.
 const say=text=>{$('refine-message').querySelector('p').textContent=text;};
 const tell=text=>{sayQuietly(document,text);say(text);};
 const cache=()=>{try{sessionStorage.setItem(cacheKey,JSON.stringify(rows));}catch{}};
 /** True for the sample idea and the five drawn ones: their suggestions are bundled, not written here. */
 const bundled=()=>Boolean(idea?.beats?.length);
 function persist(message,ticks={}){
  cache();const patch={keptBeats:keptBeats(rows),ticks:{'outline-edited':true,...ticks},...(bundled()?{}:{offeredBeats:offeredBeats(rows)}),...(message?{message}:{})};
  const task=saveQueue.catch(()=>{}).then(async()=>{const saved=await patchIdea(ideaId,patch);if(!saved)throw new Error('Idea not found.');idea=saved;});saveQueue=task;
  task.catch(e=>tell(`Edits are still on this page. Could not save: ${e.message}`));return task;
 }
 document.querySelector('[data-testid="beats-panel"]').style.overflowY='auto';
 $('refine-panel').style.overflowY='auto';
 $('prepare-recording').disabled=true;list.style.visibility='hidden';
 const prepareHint=el('p','', 'Add a beat to prepare your recording.');prepareHint.dataset.testid='prepare-hint';prepareHint.hidden=true;$('prepare-recording').after(prepareHint);
 function reorder(id,delta){const index=rows.findIndex(r=>r.id===id),target=index+delta;if(index<0||target<0||target>=rows.length)return;const next=rows.slice();[next[index],next[target]]=[next[target],next[index]];rows=next;render();persist();$(`beat-${id}-handle`)?.focus();}
 /** A bundled suggestion that leaves the list is not offered again: its tick says so. */
 const skips=gone=>Object.fromEntries(gone.filter(r=>r.source==='suggestion'&&bundled()).map(r=>[`skip-${r.id}`,true]));
 function remove(beat){rows=rows.filter(r=>r.id!==beat.id);render();persist('',skips([beat]));}
 const closeMenu=()=>{const open=document.querySelector('.beat-menu');if(!open)return false;open.remove();document.querySelector('.dots[aria-expanded="true"]')?.setAttribute('aria-expanded','false');return true;};
 /** The three-dot menu of one beat: move it up or down, or remove it. */
 function openMenu(beat,button){
  if(button.getAttribute('aria-expanded')==='true'&&closeMenu())return;closeMenu();
  const menu=el('div','beat-menu');menu.dataset.testid='beat-menu';menu.setAttribute('role','menu');const at=rows.findIndex(r=>r.id===beat.id);
  for(const [label,act,off] of [['Move up',()=>reorder(beat.id,-1),at===0],['Move down',()=>reorder(beat.id,1),at===rows.length-1],['Remove',()=>remove(beat),false]]){const item=el('button','',label);item.type='button';item.setAttribute('role','menuitem');item.disabled=off;item.onclick=()=>{closeMenu();act();};menu.append(item);}
  const box=button.getBoundingClientRect();Object.assign(menu.style,{top:`${box.bottom+window.scrollY+6}px`,left:`${Math.max(12,box.right+window.scrollX-170)}px`});
  document.body.append(menu);button.setAttribute('aria-expanded','true');(menu.querySelector('button:not(:disabled)')||menu).focus();
 }
 document.addEventListener('click',e=>{if(!e.target.closest('.beat-menu')&&!e.target.closest('.dots'))closeMenu();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 /** A list longer than its room fades at the foot until it is scrolled to the end. */
 const more=()=>{list.dataset.more=String(list.scrollHeight-list.clientHeight-list.scrollTop>4);};
 list.addEventListener('scroll',more,{passive:true});addEventListener('resize',more);
 function render(focusId){
  closeMenu();list.replaceChildren();
  rows.forEach((beat,index)=>{
   const row=template.cloneNode(true);row.dataset.id=beat.id;row.dataset.testid=`beat-${beat.id}`;row.dataset.state=beat.state;
   for(const item of row.querySelectorAll('[data-testid]'))item.dataset.testid=item.dataset.testid.replace(/^beat-hours/,`beat-${beat.id}`);
   row.querySelector('.num').textContent=String(index+1).padStart(2,'0');row.querySelector('.beat-title').textContent=beat.title;row.querySelector('.beat-line').textContent=beat.line;row.querySelector('.beat-line').title=beat.line;row.querySelector('.tag').textContent=beat.source==='suggestion'?'YAP suggestion':'From your idea';
   const handle=row.querySelector('.handle');handle.onkeydown=e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();reorder(beat.id,e.key==='ArrowUp'?-1:1);}};
   handle.draggable=true;handle.ondragstart=e=>{dragId=beat.id;e.dataTransfer.setData('text/plain',beat.id);};row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();const from=rows.findIndex(r=>r.id===dragId),to=rows.findIndex(r=>r.id===beat.id);if(from<0||to<0||from===to)return;const next=rows.slice(),[moving]=next.splice(from,1);next.splice(to,0,moving);rows=next;render();persist();};
   row.querySelector('.icon-btn:not(.dots)').onclick=()=>edit(beat.id);
   const dots=row.querySelector('.dots');dots.setAttribute('aria-label',`More for ${beat.title}`);dots.setAttribute('aria-haspopup','menu');dots.setAttribute('aria-expanded','false');dots.onclick=()=>openMenu(beat,dots);
   if(beat.source==='suggestion'){const accept=acceptTemplate.cloneNode(true),done=beat.state==='accepted';accept.dataset.testid=`beat-${beat.id}-accept`;accept.setAttribute('aria-pressed',String(done));accept.textContent=done?'Accepted':'Accept';accept.disabled=done;accept.onclick=()=>{beat.state='accepted';render();persist();say(`Beat ${String(index+1).padStart(2,'0')} is in. ${rows.some(r=>r.state==='suggested')?'Accept what fits, skip the rest.':'That is every suggestion.'}`);};row.append(accept);}
   list.append(row);
  });
  $('prepare-recording').disabled=!loaded||keptBeats(rows).length===0;$('add-beat').disabled=rows.length>=12;
  prepareHint.hidden=!loaded||keptBeats(rows).length>0;
  if(!rows.length)list.append(el('p','', 'No beats yet. Add your own below.'));
  cache();
  more();
  if(focusId)list.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({block:'nearest'});
 }
 /** The rename dialog's own look, as Create draws it: one styled dialog for both screens. */
 const dialogLook=()=>injectStyles(document,'rename-dialog',GALLERY_CSS.split('\n').filter(line=>line.startsWith('.rename-')).join('\n'));
 function edit(id=null){
  dialogLook();
  const beat=rows.find(r=>r.id===id),dialog=el('dialog','beat-editor','');dialog.dataset.testid='beat-editor';dialog.setAttribute('aria-labelledby','beat-editor-heading');
  const heading=el('h2','',beat?'Edit beat':'Add a beat');heading.id='beat-editor-heading';
  const title=el('input','');title.id='beat-editor-title';title.dataset.testid='beat-editor-title';title.maxLength=120;title.value=beat?.title||'';
  const text=el('textarea','');text.id='beat-editor-text';text.dataset.testid='beat-editor-text';text.maxLength=500;text.rows=4;text.value=beat?.line||'';
  const titleLabel=el('label','','Title'),textLabel=el('label','','Words to remember');titleLabel.htmlFor=title.id;textLabel.htmlFor=text.id;
  const actions=el('div','rename-actions'),cancel=el('button','rename-cancel','Cancel'),save=el('button','rename-save','Save beat');cancel.type='button';save.type='button';save.dataset.testid='beat-editor-save';cancel.dataset.testid='beat-editor-cancel';cancel.onclick=()=>dialog.close();actions.append(cancel,save);
  // A beat's other fields (an angle prepared earlier) stay as they were: only its title and words change here.
  save.onclick=async()=>{if(!text.value.trim()){text.focus();return;}save.disabled=true;const old=rows;let next=refinedRows(rows,id,text.value);const target=id || next.find(r=>!rows.some(o=>o.id===r.id)).id;next=withoutRepeats(next.map(r=>r.id===target?{...r,title:title.value.trim()||shortTitle(text.value)}:r));rows=next;try{await persist();render(target);dialog.close();tell('Saved.');}catch{rows=old;save.disabled=false;}};
  dialog.append(heading,titleLabel,title,textLabel,text,actions);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();text.focus();
 }
 /** Everything the person told YAP about this idea: their thought, what they typed and what they answered the coach. */
 const said=()=>[...new Set([...ideaWords(idea),...(coaching?.turns||[]).filter(t=>t.who==='you').map(t=>String(t.text||'').trim())].filter(Boolean))];
 /** Who answered, as one quiet line under YAP's words: Claude on this Mac, or YAP's built-in coach. */
 const byLine=el('p','refine-by','');byLine.dataset.testid='refine-by';byLine.hidden=true;$('refine-message').after(byLine);
 const by=who=>{byLine.hidden=!who;byLine.textContent=COACH_BY[who]||'';};
 /** Put the beat list to a model (prompts/beat-list.md). Null when none answers or the answer cannot be used. */
 async function askModel(send,typed='',shown=rows,named=-1){
  try{
   const r=await fetch('/api/model',{method:'POST',mode:'same-origin',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'beat-list',text:listRequestText({send,title:idea.title,formatName:idea.format,said:said(),rows:shown,typed,named})})});
   if(!r.ok)return null;const answer=await r.json();if(typeof answer.text!=='string'||answer.source==='none')return null;
   return {shown,reply:readListReply(answer.text,shown,{mayRemove:send==='request'&&asksRemoval(typed)})};
  }catch{return null;}
 }
 /** The list as a request leaves it. A suggestion that left is not offered again. */
 function setRows(next,focusId){const kept=new Set(next.map(r=>r.id)),gone=rows.filter(r=>!kept.has(r.id));rows=next.slice(0,12);render(focusId);return persist('',skips(gone)).catch(()=>{});}
 /** A thought is the person's own words: it becomes the next beat, titled from those words. */
 async function keepThought(words){
  if(rows.length>=12){tell('A video holds up to 12 beats. Remove one to add another. Your words are still here.');$('refine-input').value=words;$('refine-input').focus();return;}
  const already=saidBy(words,rows);if(already>=0){by('');say(`Beat ${String(already+1).padStart(2,'0')} already says that.`);return;}
  const before=rows;rows=withoutRepeats(refinedRows(rows,null,words).map(r=>before.includes(r)?r:{...r,title:shortTitle(words)}));const at=rows.findIndex(r=>!before.includes(r));
  // A save that fails takes the beat back off the list: the words go back in the box to send again.
  try{await persist(words);}catch{rows=before;render();$('refine-input').value=words;return;}
  render(rows[at].id);by('');say(`Kept your thought as beat ${String(at+1).padStart(2,'0')}, "${rows[at].title}".`);
 }
 /**
  * Words typed in the panel. A request changes the beat it names, a question is answered, and only
  * a thought becomes a beat. Swap, move and remove are done here at once. Wording and questions go
  * to the model, and with none YAP does what it can by cutting and counting and says so plainly.
  */
 async function refine(message){
  const typed=message.trim();if(!loaded||!typed)return;$('refine-input').value='';
  const request=readRequest(typed,rows);
  if(request.kind==='thought')return keepThought(typed);
  if(['swap','move','remove'].includes(request.kind)){const done=applyRequest(request,rows);if(done.changed)await setRows(done.rows,request.kind==='move'?rows[request.from].id:undefined);by('');say(done.say);return;}
  say('Thinking it through.');by('');
  const named=request.kind==='shorten'?request.at:namedRows(typed,rows)[0]??-1;
  const asked=await askModel('request',typed,rows,named),reply=asked&&asked.shown===rows?asked.reply:null;
  if(reply?.kind==='thought')return keepThought(typed);
  if(reply?.kind==='answer'){by('claude');say(reply.say);return;}
  // A model that says it changed the list and changed nothing is not repeated: YAP answers for itself below.
  // Asked to shorten one beat, a model that touched another is not followed either.
  if(reply?.kind==='change'&&reply.changed&&(request.kind!=='shorten'||onlyShortens(reply.rows,rows,request.at))){await setRows(reply.rows);by('claude');say(reply.say);return;}
  // No model answered. YAP cuts a line it was asked to shorten, counts what the list holds, and says where wording is changed.
  by('built-in');
  if(request.kind==='shorten'){const done=applyRequest(request,rows);if(done.changed)await setRows(done.rows,rows[request.at].id);say(done.say);return;}
  if(request.kind==='ask'){const format=formatNamed(idea.format)||formatOf(idea.format);say(plainAnswer({rows,formatName:format.name,slots:format.slots.map(slot=>slot.label)}));return;}
  say(PLAIN_WRITE);
 }
 /** One thing at a time: what is typed while YAP is busy waits its turn. */
 const inTurn=job=>{const run=turn.then(job,job);turn=run.catch(()=>{});return run;};
 /** The words YAP is working on now: sent again before it answers, they are not asked twice. */
 let pending='';
 const send=typed=>{const words=typed.trim();if(!words||words===pending)return;pending=words;$('refine-input').value='';inTurn(()=>refine(words)).catch(()=>{}).finally(()=>{if(pending===words)pending='';});};
 // Own Enter in runtime mode: the reference script clears immediately after
 // dispatch, before a rejected limit or failed save can preserve the draft.
 $('refine-input').addEventListener('keydown',event=>{if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;event.preventDefault();event.stopImmediatePropagation();send($('refine-input').value);},true);
 document.addEventListener('yap:idea-message',e=>send(String(e.detail?.text||'')));
 document.addEventListener('yap:beat-add',()=>edit());
 document.addEventListener('yap:beat-edit',e=>edit(e.detail?.id));
 document.addEventListener('yap:idea-edit',async()=>{
  await saveQueue.catch(()=>{});
  // A coached idea's conversation is closed once accepted: the button renames it, and says so.
  if(coaching?.state==='accepted'){dialogLook();openRenameDialog(document,{title:idea.title,returnFocus:$('edit-idea'),onSave:async value=>{const saved=await patchIdea(ideaId,{rename:value});if(!saved)throw new Error('This idea was not found.');idea=saved;$('idea-title').textContent=saved.title;drawThumb();}});return;}
  await patchIdea(ideaId,{state:'shaping'});go(routeFor('idea',{id:ideaId}));
 });
 document.addEventListener('yap:beats-ready',async()=>{if(!loaded||!keptBeats(rows).length)return tell('Keep or write at least one beat before recording.');$('prepare-recording').disabled=true;try{await persist();go(routeFor('prepare',{id:ideaId}));}catch{$('prepare-recording').disabled=false;}});
 /** The words of the direction picked while the idea was coached, or ''. */
 const picked=()=>coaching?.state==='accepted'?idea.thumb:'';
 /** A person's own idea has no photograph: its picture is its picked direction, or its title, set as a thumbnail would set it. */
 function drawThumb(){
  const thumb=document.querySelector('.idea-card .thumb');if(!thumb||idea.id==='sample'||/^idea-[2-6]$/.test(idea.id))return;
  const words=el('div','thumb-words');words.append(el('span','',picked()||idea.title));words.dataset.testid='idea-thumb';thumb.querySelector('[data-testid="idea-thumb"]').replaceWith(words);
  $('idea-thumb-chip').hidden=!picked();if(picked())$('idea-thumb-chip').textContent=keyElementOf(coaching?.template).chip;
 }
 /** What the idea carries besides its beats, under the list: the picked direction and the experiments from Review. */
 function drawExtras(){
  const chosen=picked()?[[keyElementOf(coaching?.template).name,picked()]]:[],carried=[...chosen,...(coaching?.experiments||[]).map(each=>['experiment',each.title])];
  if(!carried.length)return;
  const part=keyElementOf(coaching?.template).name,name=[chosen.length?part[0].toUpperCase()+part.slice(1):'',coaching.experiments.length?'experiment':''].filter(Boolean).join(' & ');
  const row=el('button','extras');row.type='button';row.dataset.testid='idea-extras';row.setAttribute('aria-expanded','false');
  // An experiment the person added while shaping the idea reads "Added" here too. A direction alone is still proposed.
  row.innerHTML='<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m4 16 4.5-4.5 4 4 3-3 4.5 4.5M15 9.5h.01"/></svg><span></span><span class="chip" data-testid="idea-extras-chip"></span><svg viewBox="0 0 24 24" class="chev"><path d="m6 9 6 6 6-6"/></svg>';
  row.querySelector('.chip').textContent=coaching.experiments.length?'Added':'Proposed';
  row.querySelector('span').textContent=name[0].toUpperCase()+name.slice(1);
  const body=el('div','extras-body');body.dataset.testid='idea-extras-body';body.hidden=true;
  for(const [key,value] of carried){const line=el('p','');line.append(el('span','k',key),el('span','',value));body.append(line);}
  row.onclick=()=>{body.hidden=!body.hidden;row.setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)body.scrollIntoView({block:'nearest'});};
  $('add-beat').after(row,body);
 }
 const coachOf=async id=>{try{const r=await fetch(`${APP_API}idea-coach/${id}`,{mode:'same-origin',credentials:'same-origin',cache:'no-store'});return r.ok?(await r.json()).coaching:null;}catch{return null;}};
 const OPENING='I split your idea into moments. Keep what fits; change the rest.';
 /**
  * The first time a person's idea is opened here, YAP writes it as beats: a short title in their
  * words and one line each, with their unused sentences offered back. That is on the list at once.
  * Then a model is asked for better titles and written suggestions, which land only on rows the
  * person has not touched meanwhile.
  */
 async function writeBeats(){
  // The model is shown the beats as the idea brought them, the person's full words: YAP's own short titles would only be echoed back.
  const brought=rows;rows=momentRows(rows);rows=[...rows,...offeredFromWords({said:said(),rows})].slice(0,12);render();await persist().catch(()=>{});
  const first=new Map(rows.map(r=>[r.id,r]));say('Writing suggestions for this idea.');
  const asked=await askModel('write','',brought),reply=asked?.reply;
  if(reply?.kind==='write'){
   const written=new Map(reply.rows.map(r=>[r.id,r])),same=r=>first.get(r.id)?.title===r.title&&first.get(r.id)?.line===r.line;
   let next=rows.map(r=>same(r)&&r.state!=='suggested'&&written.has(r.id)?{...r,title:written.get(r.id).title,line:written.get(r.id).line}:r);
   if(reply.offered.length)next=[...next.filter(r=>!(r.state==='suggested'&&same(r))),...reply.offered];
   rows=next.slice(0,12);render();await persist().catch(()=>{});by('claude');
  }else by('built-in');
  say(OPENING);
 }
 Promise.all([getIdea(ideaId),coachOf(ideaId)]).then(([saved,kept])=>{
  if(!saved)throw new Error('This idea was not found.');idea=saved;coaching=kept;rows=editableRows(saved);let cached=null;try{cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(Array.isArray(cached)&&cached.every(r=>r&&typeof r.id==='string'&&typeof r.line==='string'&&typeof r.title==='string'))rows=cached;else cached=null;}catch{cached=null;}
  $('idea-title').textContent=saved.title;$('idea-kind').textContent=`${templateOf(kept?.template).platform} · ${saved.format||'Talking head'}`;
  if(kept?.state==='accepted')$('edit-idea').querySelector('span').textContent='Rename idea';
  if(saved.state!=='saved'&&kept?.state!=='accepted')backTo=routeFor('idea',{id:ideaId});
  const bankImage=/^idea-([2-6])$/.exec(saved.id);if(bankImage){$('idea-thumb').src=`/ui/gallery/assets/t${bankImage[1]}.png`;$('idea-thumb').alt=saved.title;}
  drawThumb();drawExtras();
  say(OPENING);loaded=true;render();list.style.visibility='';document.documentElement.dataset.beatsReady='true';
  // YAP writes for an idea the person made, once: after that the idea carries offeredBeats, an empty list included.
  if(saved.createdAt&&!bundled()&&!Array.isArray(saved.offeredBeats)&&!cached&&rows.length)inTurn(writeBeats).catch(()=>{});
 }).catch(e=>tell(e.message));
}
