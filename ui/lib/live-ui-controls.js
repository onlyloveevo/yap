import {createLiveUiRecorder} from './live-ui-recorder.js';
const style=(node,values)=>Object.assign(node.style,values);
const button=(doc,label,id)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.dataset.testid=id;style(b,{border:'1px solid #66583e',borderRadius:'16px',padding:'10px 14px',background:'#211b15',color:'#f4d08a',font:'inherit',cursor:'pointer'});return b;};
export function mountLiveUiControls({document:doc,primary,id}) {
 const box=doc.createElement('section');box.dataset.testid='live-ui-controls';style(box,{position:'fixed',top:'94px',left:'20px',zIndex:'5',maxWidth:'230px',padding:'8px',borderRadius:'16px',background:'rgba(18,15,12,.84)',font:'13px system-ui',color:'#eee'});
 const start=button(doc,'Record Live UI too','live-ui-start');const status=doc.createElement('p');status.dataset.testid='live-ui-status';status.textContent='Optional second file. Choose this YAP tab.';style(status,{margin:'7px 4px 0',lineHeight:'1.35'});box.append(start,status);doc.body.append(box);
 let began=false,finished=null;
 const recorder=createLiveUiRecorder({primary,onState(state){status.textContent=({recording:'Live UI recording · separate file',paused:'Live UI paused with clean recording',stopped:'Live UI stopped · not saved yet',saving:'Saving Live UI…',saved:'Live UI saved', 'save-failed':'Live UI save failed · backup retained'})[state]||state;}});
 start.onclick=()=>{start.disabled=true;status.textContent='Choose the YAP Live tab in the picker.';const request=recorder.start();request.then(()=>{began=true;start.textContent='Live UI recording';},e=>{start.disabled=false;status.textContent=e.message;});};
 function finish(){
  if(finished)return finished;
  finished=(async()=>{
   const result=await recorder.stop();if(!result)return null;
   try{return await recorder.save(id);}catch(error){
    return new Promise(resolve=>{
     const shade=doc.createElement('div');shade.dataset.testid='live-ui-save-recovery';shade.setAttribute('role','alertdialog');shade.setAttribute('aria-label','Live UI save needs attention');style(shade,{position:'fixed',inset:'0',zIndex:'1000',display:'grid',placeItems:'center',background:'rgba(0,0,0,.85)',padding:'20px'});
     const card=doc.createElement('section');style(card,{maxWidth:'560px',padding:'24px',background:'#211b15',border:'1px solid #a08245',borderRadius:'20px',color:'#fff',font:'16px system-ui'});
     const title=doc.createElement('h2');title.textContent='Clean recording saved. Live UI needs attention.';
     const message=doc.createElement('p');message.textContent=error.message;
     const urls=recorder.backupUrls();
     for(const [key,label,name] of [['video','Download Live UI backup',`YAP-${id}-Live-UI.webm`],['timing','Download timing backup',`YAP-${id}-Live-UI.timing.json`]]){const a=doc.createElement('a');a.href=urls[key];a.download=name;a.textContent=label;a.dataset.testid=`live-ui-backup-${key}`;style(a,{display:'block',color:'#f4d08a',margin:'14px 0'});card.append(a);}
     const retry=button(doc,'Retry Live UI save','live-ui-retry');const leave=button(doc,'Continue without UI save','live-ui-continue');const warning=doc.createElement('p');warning.textContent='Keep the backups before continuing. Leaving discards the unsaved copy on this page.';
     const done=value=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);shade.remove();resolve(value);};
     retry.onclick=async()=>{retry.disabled=true;leave.disabled=true;try{done(await recorder.save(id));}catch(e){message.textContent=e.message;retry.disabled=false;leave.disabled=false;}};
     leave.onclick=()=>{recorder.acknowledgeBackup();done(null);};
     card.prepend(title,message);card.append(warning,retry,leave);shade.append(card);doc.body.append(shade);retry.focus();
    });
   }
  })();return finished;
 }
 return {pause:()=>recorder.pause(),resume:()=>recorder.resume(),refine:p=>recorder.refine(p),uiSeconds:()=>recorder.uiSeconds(),stopCapture:()=>{start.disabled=true;return recorder.stop();},finish,recorder,get began(){return began;}};
}

// Called by the editor after its recording is loaded; no UI claim until server confirmation.
export async function mountLiveUiDownloads({document:doc,id,container}) {
 const response=await fetch(`/api/app/recordings/${id}/live-ui`);if(response.status===404)return null;if(!response.ok)throw new Error('Live UI download status unavailable. Reload to retry.');const saved=await response.json();
 const box=doc.createElement('div');box.dataset.testid='live-ui-downloads';style(box,{display:'flex',gap:'14px',flexWrap:'wrap',padding:'10px 14px',background:'#211b15',borderRadius:'12px',font:'14px system-ui'});
 for(const [field,label,name] of [['downloadUrl','Download Live UI',`YAP-${id}-Live-UI.webm`],['timingUrl','Download alignment timing',`YAP-${id}-Live-UI.timing.json`]]){if(!/^\/api\/app\//.test(saved[field]||''))continue;const a=doc.createElement('a');a.textContent=label;a.href=saved[field];a.download=name;a.dataset.testid=field==='downloadUrl'?'live-ui-download':'live-ui-timing';a.style.color='#f4d08a';box.append(a);}
 const hint=doc.createElement('span');hint.textContent=`Separate UI file · starts about ${saved.timing.startOffsetSeconds.toFixed(1)}s into the clean take`;
 // A refinement discussion pauses the clean take while this file keeps running: the offset above only holds before the first one.
 try{const r=await fetch(`/api/app/recordings/${id}/live-refine`);const kept=r.ok?await r.json():null;const n=kept?.intervals?.length||0;if(n){const secs=kept.intervals.reduce((t,i)=>t+Math.max(0,(i.uiEndSeconds??0)-(i.uiStartSeconds??0)),0);hint.textContent=`Separate UI file · includes ${n} refinement discussion${n===1?'':'s'} (${secs.toFixed(0)}s) that the clean take paused for. The start offset only holds before the first one; see the saved refinement notes.`;}}catch{}hint.style.color='#bbb';box.append(hint);container.append(box);return box;
}
