// Runtime-only states; the reference shell is never presented as a real take.
// Until a take is ready the screen is one calm card in a warm room (ui/record/styles.css, data-recording-ready="false").
export function recordingAvailability(doc, ready) {
 const by=id=>doc.querySelector(`[data-testid="${id}"]`);
 by('tick').title='Mark this beat done';
 doc.documentElement.dataset.recordingReady=String(ready);
 for(const id of ['stop','pause','tick','help','export','edit'])if(by(id))by(id).disabled=!ready;
 doc.querySelector('.controls').hidden=!ready;
 by('beats').hidden=!ready;
 if(!ready){
  by('timer').textContent='00:00';
  by('story-label').textContent='Live mode';
  by('beat-title').textContent='Getting ready…';
  by('delivery-cue').hidden=true;
  doc.querySelectorAll('[data-testid="point"]').forEach(p=>{p.hidden=true;p.lastElementChild.textContent='';});
 }
}

const CAMERA_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm13 2.5 5-3v9l-5-3"/></svg>';

// The camera is off or refused, or the take did not open: one line, the reason, one button.
export function recordingStartFailure(doc, error, {stage='camera'} = {}) {
 recordingAvailability(doc,false);
 const by=id=>doc.querySelector(`[data-testid="${id}"]`);
 const camera=stage==='camera';
 const message=String(error.message || error).trim();
 by('story-label').textContent=camera?'Camera off':'Live mode';
 by('beat-title').textContent=camera?'Turn your camera on to start':'This take did not open';
 const container=doc.querySelector('.story-content');
 if(camera){const icon=doc.createElement('div');icon.className='start-icon';icon.innerHTML=CAMERA_ICON;container.prepend(icon);}
 const detail=doc.createElement('p');detail.dataset.testid='start-error';detail.className='start-detail';
 detail.textContent=message;
 const actions=doc.createElement('div');actions.className='start-actions';
 const retry=doc.createElement('button');retry.type='button';retry.dataset.testid='retry-start';retry.className='start-button';retry.textContent=camera?'Turn on camera':'Reload this take';
 retry.onclick=()=>doc.defaultView.location.reload();
 const back=doc.createElement('a');back.href='/create';back.className='start-back';back.textContent='Back to saved ideas';
 actions.append(retry,back);container.append(detail,actions);
}

export function recordingNotice(doc, message, heading='YAP is having trouble hearing you') {
 let box=doc.querySelector('[data-testid="recording-status"]');
 if(!message){if(box)box.hidden=true;return;}
 if(!box){
  box=doc.createElement('aside');box.dataset.testid='recording-status';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  Object.assign(box.style,{position:'absolute',right:'var(--page-pad, 40px)',top:'110px',width:'min(340px, calc(100vw - 80px))',maxHeight:'220px',overflowY:'auto',zIndex:'2',padding:'12px 16px',border:'1px solid rgba(255,255,255,.16)',borderRadius:'16px',background:'rgba(14,12,11,.66)',backdropFilter:'blur(22px)',color:'rgba(255,255,255,.78)',fontSize:'14px',lineHeight:'1.45'});
  const details=doc.createElement('details'),summary=doc.createElement('summary'),p=doc.createElement('p');
  summary.style.cursor='pointer';p.style.margin='10px 0 0';details.append(summary,p);box.append(details);doc.querySelector('.live-shell').append(box);
 }
 box.querySelector('summary').textContent=heading;
 box.querySelector('p').textContent=message;
 box.hidden=false;
}
