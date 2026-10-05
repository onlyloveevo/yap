import {wireNav,comingSoon,go,sayQuietly,isShellMode} from './app.js';
import {getIdea,patchIdea} from './api.js';
import {dictateInto} from './dictate.js';
import {matchRoute,routeFor} from './routes.js';
import {ideaView} from './idea-model.js';
import {installOwnIdeaStyle} from './own-idea-style.js';
import {editableRows,refinedRows,keptBeats} from './beats-model.js';
import {createIdeaChat} from './idea-chat.js';

export function wireIdea(stage){
 wireNav(document);const $=id=>document.querySelector(`[data-testid="${id}"]`),shell=isShellMode(location);
 const id=matchRoute(location.pathname,location.search)?.params.id;let busy=false,idea=null,ready=shell;
 const self=()=>routeFor('idea',{id});
 const chat=shell?null:createIdeaChat({id,getIdea:()=>idea,openBeats:()=>go(routeFor('beats',{id})),writeBeats:async rows=>{try{const next=await patchIdea(id,{keptBeats:rows});if(!next)return false;idea=next;render();return true;}catch{return false;}}});
 const element=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 function unavailable(control,label){if(!control||shell)return;control.setAttribute('aria-disabled','true');control.title=`${label} is not available in this demo`;control.style.opacity='.55';if(control.tagName==='BUTTON')control.disabled=true;else control.addEventListener('click',e=>e.preventDefault());if(!control.textContent.includes('coming soon'))control.append(document.createTextNode(' · coming soon'));}
 function render(){
  if(shell||!idea)return;const view=ideaView(idea,{conversation:true}),thread=document.querySelector('.thread');thread.replaceChildren();thread.style.overflowY='auto';
  for(const words of view.messages){const message=element('div',stage==='conversation'?'msg-you':'msg you','');message.append(element('p',stage==='conversation'?'label':'who','You'),element('p',stage==='conversation'?'text':'',words));thread.append(message);}
  const notice=element('p','quiet',view.notice);notice.dataset.testid='idea-provenance';notice.style.fontSize='14px';thread.append(notice);chat?.attach(thread);
  if($('starting-thought'))$('starting-thought').textContent=idea.thought||idea.title;
  if($('idea-kind'))$('idea-kind').textContent=`YouTube video · ${view.format}`;
  if($('idea-summary')){$('idea-summary').textContent=view.summary;$('idea-summary').style.whiteSpace='pre-line';}
  if($('idea-thumb')){$('idea-thumb').style.display='none';$('idea-thumb').alt='No thumbnail chosen';}
  const thumbs=document.querySelector('.thumbs');if(thumbs){thumbs.replaceChildren(element('p','eyebrow','Thumbnail'),element('p','cap','No thumbnail chosen. Thumbnail generation is not included in this demo.'));}
  for(const [index,key] of ['opening','story','closing'].entries()){
   const row=view.rows[index];if($(`beat-${key}`)){$(`beat-${key}`).textContent=row?.line||'';$(`beat-${key}-label`).textContent=row?.title||'';$(`beat-${key}`).hidden=!row;$(`beat-${key}-label`).hidden=!row;}
   const point=$(`point-${key}`);if(point){point.hidden=!row;point.style.display=row?'':'none';if(row){$(`point-${key}-title`).textContent=row.title;$(`point-${key}-text`).textContent=row.line;point.setAttribute('aria-checked',String(idea.ticks?.[key]===true));}}
  }
  for(const [name,format] of [['format-vlog','Vlog'],['format-talking-head','Talking head']])$(name)?.setAttribute('aria-pressed',String(view.format===format));
  if($('idea-input')){$('idea-input').placeholder='Reply to YAP, or add a thought…';$('idea-input').maxLength=600;}
 }
 async function change(patch,destination){if(busy||!ready)return false;busy=true;try{const next={...patch};if(!shell&&idea&&!idea.format&&!next.format)next.format='Talking head';idea=await patchIdea(id,next);if(!idea)throw new Error('Idea not found.');if(destination)go(destination);else render();return true;}catch(e){sayQuietly(document,e.message);return false;}finally{busy=false;}}
 document.addEventListener('yap:talk',()=>ready&&dictateInto($('idea-input'),{control:$('talk-to-yap')}));
 document.addEventListener('yap:idea-message',async e=>{const text=e.detail?.text?.trim();if(!text)return;
  if(chat){
   // The conversation: the message is saved as theirs and YAP answers it. It never becomes an outline beat by itself.
   if(busy||!ready||chat.busy())return;
   const turn=await chat.send(text,{ask:stage!=='conversation'});if(!turn)return;
   $('idea-input').value='';$('send').disabled=true;
   if(stage==='conversation'&&!(await change({state:'shaping'},self())))chat.askLatest();
   return;
  }
  const patch={message:text,...(!shell&&idea?{keptBeats:keptBeats(refinedRows(editableRows(idea),'',text))}:{}),...(stage==='conversation'?{state:'shaping'}:{})};if(await change(patch,stage==='conversation'?self():null)){$('idea-input').value='';$('send').disabled=true;}});
 document.addEventListener('yap:idea-keep-exploring',()=>stage==='conversation'||stage==='confirm'?change({state:'shaping'},self()):$('idea-input').focus());
 document.addEventListener('yap:idea-save-thought',()=>change({state:'thought'},'/create'));
 document.addEventListener('yap:idea-save',()=>change({state:'confirming'},self()));
 document.addEventListener('yap:idea-confirm',e=>change({state:'saved',ticks:e.detail?.points||{}},'/create'));
 document.addEventListener('yap:idea-change-format',()=>shell?comingSoon(document,'Change format'):change({state:'exploring'},self()));
 for(const event of ['yap:idea-edit-story','yap:idea-edit'])document.addEventListener(event,()=>shell?comingSoon(document,'Edit story'):ready&&go(routeFor('beats',{id})));
 for(const [name,label] of [['yap:formats-more','More formats'],['yap:experiment-bring','Bring an experiment']])document.addEventListener(name,()=>comingSoon(document,label));
 $('template-select')?.addEventListener('click',()=>comingSoon(document,'Templates'));
 for(const [name,format] of [['format-vlog','Vlog'],['format-talking-head','Talking head']])$(name)?.addEventListener('click',()=>change({format}));
 for(const name of ['thumb-a','thumb-b'])$(name)?.addEventListener('click',()=>{if(shell)change({thumb:name});});
 if(shell)return;
 document.documentElement.dataset.ownIdea='true';
 addEventListener('pagehide',()=>chat.destroy());
 installOwnIdeaStyle(document);

 for(const hook of ['nav-home','nav-grow']){const item=$(hook);if(item){item.append(document.createTextNode(' · soon'));item.setAttribute('aria-disabled','true');}}
 for(const [name,label] of [['more-formats','More formats'],['template-select','Templates'],['bring-experiment','Bring an experiment'],['experiment','Thumbnail experiments']])unavailable($(name),label);
 // Static module execution precedes DOMContentLoaded. Waiting also covers the
 // unchanged deferred shell script that emits the idea events.
 const handlersReady=document.readyState==='complete'?Promise.resolve():new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
 getIdea(id).then(async saved=>{
  if(!saved)throw new Error('This idea was not found.');idea=saved;render();await handlersReady;
  ready=true;document.documentElement.dataset.ideaReady='true';chat?.load();
  const surface=document.querySelector('[data-idea-surface]');if(surface){surface.inert=false;surface.setAttribute('aria-busy','false');surface.style.removeProperty('visibility');}
  $('idea-loading')?.remove();
 }).catch(e=>{
  ready=false;document.documentElement.dataset.ideaReady='error';
  const gate=$('idea-loading');
  if(gate){gate.setAttribute('role','alert');$('idea-loading-title').textContent='Could not open your idea';$('idea-loading-detail').textContent=`${e.message} Your saved idea has not been changed. Return Home to try again.`;}
  else sayQuietly(document,e.message);
 });
}
