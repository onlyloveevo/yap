import {comingSoon,go,isShellMode,sayQuietly,wireNav} from '../lib/app.js';
import {getIdea,patchIdea} from '../lib/api.js';
import {editableRows,keptBeats,refinedRows} from '../lib/beats-model.js';
import {ideaWords} from '../lib/idea-model.js';
import {dictateInto} from '../lib/dictate.js';
import {matchRoute,routeFor} from '../lib/routes.js';
import {writeBeats} from '../../src/engine/setup-beats.js';
const $=id=>document.querySelector(`[data-testid="${id}"]`),shell=isShellMode(location),ideaId=matchRoute(location.pathname,location.search)?.params.id;
wireNav(document);
document.addEventListener('yap:idea-back',()=>go('/create'));
document.addEventListener('yap:talk',()=>dictateInto($('refine-input'),{control:$('talk-to-yap')}));
if(shell){
 document.addEventListener('yap:beats-ready',async e=>{await patchIdea(ideaId,{keptBeats:keptBeats(e.detail?.beats)});go(routeFor('prepare',{id:ideaId}));});
// Not built (D-121, D-148): Edit idea, the pencils, the three-dot menus, Add
// beat and Thumbnail & experiment. Each says coming soon and changes nothing.
// A label is the control's own, read here before the first press adds to it.
const soonLabels = new Map();
for (const control of document.querySelectorAll('.beat .icon-btn')) soonLabels.set(control, control.getAttribute('aria-label') || '');
soonLabels.set($('edit-idea'), $('edit-idea').textContent);
soonLabels.set($('add-beat'), $('add-beat').textContent);
soonLabels.set($('extras'), $('extras-title').textContent);
const soon = (control) => {
  if (control && soonLabels.has(control)) comingSoon(document, soonLabels.get(control), control);
};

document.addEventListener('yap:idea-edit', () => soon($('edit-idea')));
document.addEventListener('yap:beat-add', () => soon($('add-beat')));
document.addEventListener('yap:beat-edit', (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  soon($(`beat-${detail && detail.id}-edit`));
});
// The three-dot menus and Thumbnail & experiment fire no event of their own.
document.addEventListener('click', (event) => {
  const target = /** @type {any} */ (event.target);
  if (!target || typeof target.closest !== 'function') return;
  soon(target.closest('.beat .icon-btn.dots') || target.closest('[data-testid="extras"]'));
});

}else{
 const list=$('beat-list'),template=list.querySelector('.beat').cloneNode(true),acceptTemplate=list.querySelector('.accept').cloneNode(true),cacheKey=`yap-beat-draft:${ideaId}`;
 let idea=null,rows=[],saveQueue=Promise.resolve(),writing=false,loaded=false,dragId=null;
 const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const tell=text=>{sayQuietly(document,text);$('refine-message').textContent=text;};
 const cache=()=>{try{sessionStorage.setItem(cacheKey,JSON.stringify(rows));}catch{}};
 function persist(message){
  cache();const patch={keptBeats:keptBeats(rows),ticks:{'outline-edited':true},...(message?{message}:{})};
  const task=saveQueue.catch(()=>{}).then(async()=>{const saved=await patchIdea(ideaId,patch);if(!saved)throw new Error('Idea not found.');idea=saved;});saveQueue=task;
  task.catch(e=>tell(`Edits are still on this page. Could not save: ${e.message}`));return task;
 }
 const refineTarget=el('select','',undefined);refineTarget.dataset.testid='refine-target';refineTarget.setAttribute('aria-label','Point to refine');Object.assign(refineTarget.style,{width:'100%',background:'var(--row-bg)',color:'var(--white)',padding:'10px',border:'1px solid var(--row-border)',borderRadius:'var(--radius-btn)',marginBottom:'12px'});
 $('refine-input').before(refineTarget);
 const apply=el('button','gold','Apply your words');apply.dataset.testid='refine-apply';apply.type='button';apply.style.marginTop='10px';$('refine-input').after(apply);
 const suggest=el('button','outline','Ask YAP for suggestions');suggest.dataset.testid='suggest-beats';suggest.type='button';suggest.style.marginTop='12px';$('talk-to-yap').after(suggest);
 const modelStatus=el('p','', 'Your outline uses your words. Suggestions only run when you ask.');modelStatus.dataset.testid='beats-provenance';Object.assign(modelStatus.style,{fontSize:'13px',lineHeight:'1.4',color:'var(--ink-soft)'});suggest.after(modelStatus);
 $('refine-title').textContent='Refine your points';$('refine-note').textContent='Choose a point, then write the words you want. Enter applies; Shift+Enter adds a line.';
 $('refine-input').placeholder='Write the revised point…';
 $('extras').disabled=true;$('extras').setAttribute('aria-disabled','true');$('extras').style.opacity='.55';$('extras-title').textContent='Thumbnail & experiment · coming soon';
 document.querySelector('[data-testid="beats-panel"]').style.overflowY='auto';
 $('refine-panel').style.overflowY='auto';
 for(const hook of ['nav-home','nav-grow']){const item=$(hook);item.append(document.createTextNode(' · soon'));item.setAttribute('aria-disabled','true');}
 $('prepare-recording').disabled=true;list.style.visibility='hidden';
 const prepareHint=el('p','', 'Add a point to prepare your recording.');prepareHint.dataset.testid='prepare-hint';prepareHint.hidden=true;$('prepare-recording').after(prepareHint);
 function move(id,delta){const index=rows.findIndex(r=>r.id===id),target=index+delta;if(index<0||target<0||target>=rows.length)return;const next=rows.slice();[next[index],next[target]]=[next[target],next[index]];rows=next;render();persist();$(`beat-${id}-handle`)?.focus();}
 function render(){
  list.replaceChildren();const selected=refineTarget.value;refineTarget.replaceChildren(new Option(rows.length>=12?'Add a new point (12-point limit reached)':'Add a new point',''));
  rows.forEach((beat,index)=>{
   const row=template.cloneNode(true);row.dataset.id=beat.id;row.dataset.testid=`beat-${beat.id}`;row.dataset.state=beat.state;
   for(const item of row.querySelectorAll('[data-testid]'))item.dataset.testid=item.dataset.testid.replace(/^beat-hours/,`beat-${beat.id}`);
   row.querySelector('.num').textContent=String(index+1).padStart(2,'0');row.querySelector('.beat-title').textContent=beat.title;row.querySelector('.beat-line').textContent=beat.line;row.querySelector('.beat-line').title=beat.line;row.querySelector('.tag').textContent=beat.source==='idea'?(idea?.keptBeats?.some(b=>b.id===beat.id&&b.line===beat.line)?'Kept point':'Your words'):beat.state==='accepted'?'Accepted':'YAP suggestion';
   const handle=row.querySelector('.handle');handle.onkeydown=e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();move(beat.id,e.key==='ArrowUp'?-1:1);}};
   handle.draggable=true;handle.ondragstart=e=>{dragId=beat.id;e.dataTransfer.setData('text/plain',beat.id);};row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();const from=rows.findIndex(r=>r.id===dragId),to=rows.findIndex(r=>r.id===beat.id);if(from<0||to<0||from===to)return;const next=rows.slice(),[moving]=next.splice(from,1);next.splice(to,0,moving);rows=next;render();persist();};
   row.querySelector('.icon-btn:not(.dots)').onclick=()=>edit(beat.id);
   const remove=row.querySelector('.dots');remove.textContent='×';remove.setAttribute('aria-label',`Remove ${beat.title}`);remove.title='Remove this point';remove.onclick=()=>{rows=rows.filter(r=>r.id!==beat.id);render();persist();};
   if(beat.source==='suggestion'){const accept=acceptTemplate.cloneNode(true);accept.dataset.testid=`beat-${beat.id}-accept`;accept.setAttribute('aria-pressed',String(beat.state==='accepted'));accept.textContent=beat.state==='accepted'?'Accepted':'Accept';accept.disabled=beat.state==='accepted';accept.onclick=()=>{beat.state='accepted';render();persist();};row.append(accept);}
   list.append(row);refineTarget.append(new Option(beat.title,beat.id));
  });
  if([...refineTarget.options].some(o=>o.value===selected))refineTarget.value=selected;
  $('prepare-recording').disabled=!loaded||keptBeats(rows).length===0;$('add-beat').disabled=rows.length>=12;
  prepareHint.hidden=!loaded||keptBeats(rows).length>0;
  if(!rows.length)list.append(el('p','', 'No points kept. Add your own point below.'));
  cache();
 }
 function edit(id=null){
  const beat=rows.find(r=>r.id===id),dialog=el('dialog','panel','');dialog.dataset.testid='beat-editor';Object.assign(dialog.style,{background:'var(--panel, #201c17)',color:'var(--white)',border:'1px solid var(--row-border)',borderRadius:'var(--radius-row)',padding:'28px',width:'min(620px,90vw)',maxHeight:'88dvh',overflowY:'auto',boxShadow:'var(--shadow)'});
  const heading=el('h2','',beat?'Edit your point':'Add your point');const title=el('input','');title.dataset.testid='beat-editor-title';title.setAttribute('aria-label','Point title');title.maxLength=120;title.value=beat?.title||'';
  const text=el('textarea','');text.dataset.testid='beat-editor-text';text.setAttribute('aria-label','Talking point');text.maxLength=500;text.rows=5;text.value=beat?.line||'';
  const alternatives=el('details','prepared-angles-editor');alternatives.dataset.testid='prepared-angles-editor';Object.assign(alternatives.style,{margin:'16px 0 22px',borderTop:'1px solid var(--row-border)',paddingTop:'14px'});alternatives.append(el('summary','','Prepare another angle'),el('p','','Optional. Write the exact words to show when you ask for a story or practical tips.'));
  Object.assign(alternatives.querySelector('summary').style,{cursor:'pointer',color:'var(--gold, #f2c86b)'});Object.assign(alternatives.querySelector('p').style,{color:'var(--ink-soft)',fontSize:'14px',lineHeight:'1.5'});
  const angleInputs={};for(const [key,label] of [['story','Story'],['tips','Practical tips']]){const field=el('textarea','');field.dataset.testid=`beat-angle-${key}`;field.id=`beat-angle-${key}`;field.setAttribute('aria-label',label);field.maxLength=500;field.rows=3;field.value=beat?.preparedAngles?.[key]||'';const labelEl=el('label','',label);labelEl.htmlFor=field.id;alternatives.append(labelEl,field);angleInputs[key]=field;}
  for(const input of [title,text,...Object.values(angleInputs)])Object.assign(input.style,{display:'block',width:'100%',margin:'12px 0',padding:'12px',background:'var(--row-bg)',color:'var(--white)',border:'1px solid var(--row-border)',borderRadius:'var(--radius-btn)',font:'inherit'});
  const save=el('button','gold','Save point'),cancel=el('button','outline','Cancel');save.dataset.testid='beat-editor-save';cancel.style.marginLeft='14px';cancel.onclick=()=>dialog.close();
  save.onclick=async()=>{if(!text.value.trim()){text.focus();return;}save.disabled=true;const old=rows;let next=refinedRows(rows,id,text.value);const target=id || next.at(-1).id;const angles=Object.fromEntries(Object.entries(angleInputs).map(([key,input])=>[key,input.value.trim()]).filter(([,value])=>value));next=next.map(r=>{if(r.id!==target)return r;const {preparedAngles:previous,...base}=r;return{...base,title:title.value.trim()||text.value.trim().split(/\s+/).slice(0,7).join(' '),...(Object.keys(angles).length?{preparedAngles:angles}:{})};});rows=next;try{await persist();render();dialog.close();tell('Your point is saved.');}catch{rows=old;save.disabled=false;}};
  dialog.append(heading,el('label','','Title'),title,el('label','','Words to remember'),text,alternatives,save,cancel);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();text.focus();
 }
 async function refine(message){if(!loaded||!message.trim())return;if(rows.length>=12&&!rows.some(row=>row.id===refineTarget.value)){tell('You can keep up to 12 points. Edit an existing point or remove one before adding another. Your words are still here.');$('refine-input').focus();return;}rows=refinedRows(rows,refineTarget.value,message);await persist(message);$('refine-input').value='';render();tell('Your words are saved in the selected point.');}
 apply.onclick=()=>refine($('refine-input').value).catch(()=>{});
 // Own Enter in runtime mode: the reference script clears immediately after
 // dispatch, before a rejected limit or failed save can preserve the draft.
 $('refine-input').addEventListener('keydown',event=>{if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;event.preventDefault();event.stopImmediatePropagation();refine($('refine-input').value).catch(()=>{});},true);
 document.addEventListener('yap:idea-message',e=>refine(String(e.detail?.text||'')).catch(()=>{}));
 document.addEventListener('yap:beat-add',()=>edit());
 document.addEventListener('yap:beat-edit',e=>edit(e.detail?.id));
 document.addEventListener('yap:idea-edit',async()=>{await saveQueue.catch(()=>{});await patchIdea(ideaId,{state:'shaping'});go(routeFor('idea',{id:ideaId}));});
 document.addEventListener('yap:beats-ready',async()=>{if(!loaded||!keptBeats(rows).length)return tell('Keep or write at least one point before recording.');$('prepare-recording').disabled=true;try{await persist();go(routeFor('prepare',{id:ideaId}));}catch{$('prepare-recording').disabled=false;}});
 suggest.onclick=async()=>{
  if(writing||!loaded)return;writing=true;suggest.disabled=true;modelStatus.textContent='Asking YAP once. Your editable points stay available.';
  try{const written=await writeBeats({start:'idea',text:[...ideaWords(idea),...rows.map(r=>r.line)].join('\n'),ask:async request=>{const r=await fetch('/api/model',{method:'POST',mode:'same-origin',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});if(!r.ok)throw new Error('Model unavailable');return r.json();}});
   if(written.source==='default'){modelStatus.textContent='YAP was unavailable. Your own editable points are unchanged.';return;}
   const kept=rows.filter(r=>r.source==='idea'||r.state==='accepted');let n=1;const used=new Set(kept.map(r=>r.id));const proposed=written.beats.filter(b=>b.source==='model'&&b.points?.length).map(b=>{while(used.has(`suggestion-${n}`))n++;const id=`suggestion-${n++}`;used.add(id);return{id,title:b.label,line:b.points.join('. '),source:'suggestion',state:'suggested'};});
   rows=[...kept,...proposed].slice(0,12);render();modelStatus.textContent=`YAP suggestions from ${written.source}. Nothing is kept until you Accept or edit it.`;
  }catch(e){modelStatus.textContent='YAP was unavailable. Your own editable points are unchanged.';}finally{writing=false;suggest.disabled=false;}
 };
 getIdea(ideaId).then(saved=>{
  if(!saved)throw new Error('This idea was not found.');idea=saved;rows=editableRows(saved);try{const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(Array.isArray(cached)&&cached.every(r=>r&&typeof r.id==='string'&&typeof r.line==='string'&&typeof r.title==='string'))rows=cached;}catch{}
  $('idea-title').textContent=saved.title;$('idea-kind').textContent=`YouTube · ${saved.format||'Talking head'}`;
  const bankImage=/^idea-([2-6])$/.exec(saved.id);if(bankImage){$('idea-thumb').src=`/ui/gallery/assets/t${bankImage[1]}.png`;$('idea-thumb').alt=saved.title;}else if(saved.id!=='sample')$('idea-thumb').parentElement.remove();
  $('refine-message').textContent='These are your words. Edit a point, add one, or ask for optional suggestions.';loaded=true;render();list.style.visibility='';document.documentElement.dataset.beatsReady='true';
 }).catch(e=>tell(e.message));
}
