// Runtime-only states; the reference shell is never presented as a real take.
export function recordingAvailability(doc, ready) {
 const by=id=>doc.querySelector(`[data-testid="${id}"]`);
 by('help').querySelector('span').textContent='Type a change';
 by('help').setAttribute('aria-label','Type a change to your talking point');
 by('tick').title='Mark this point done and continue';
 if(!by('tick').querySelector('[data-point-action]')){const label=doc.createElement('span');label.dataset.pointAction='true';label.textContent='Mark point done';label.style.cssText='font-size:11px;line-height:1.2';by('tick').append(label);Object.assign(by('tick').style,{width:'104px',display:'flex',flexDirection:'column',justifyContent:'center',gap:'1px'});by('tick').querySelector('svg').style.width='22px';by('tick').querySelector('svg').style.height='22px';}
 doc.documentElement.dataset.recordingReady=String(ready);
 for(const id of ['stop','pause','tick','help','export','edit'])if(by(id)){by(id).disabled=!ready;by(id).style.opacity=ready?'':'.35';}
 doc.querySelector('.controls').hidden=!ready;
 by('beats').hidden=!ready;
 by('brand').lastElementChild.textContent=ready?'Live mode':'Not recording';
 if(!ready){
  by('timer').textContent='00:00';
  by('story-label').textContent='Not recording';
  by('beat-title').textContent='Preparing your take…';
  by('delivery-cue').hidden=true;
  doc.querySelectorAll('[data-testid="point"]').forEach(p=>{p.hidden=true;p.lastElementChild.textContent='';});
 }
}

export function recordingStartFailure(doc, error, {stage='camera'} = {}) {
 recordingAvailability(doc,false);
 const by=id=>doc.querySelector(`[data-testid="${id}"]`);
 const camera=stage==='camera';
 const message=String(error.message || error).trim();
 by('beat-title').textContent=camera?'Your take could not start':'Could not open your take';
 const container=doc.querySelector('.story-content');
 const detail=doc.createElement('p');detail.dataset.testid='start-error';
 detail.textContent=camera?message.replace(/then reload this page\.$/, 'then select Retry camera and microphone.'):`${message}${/[.!?]$/.test(message)?'':'.'} Reload this take to check its saved state.`;
 Object.assign(detail.style,{fontSize:'16px',lineHeight:'1.5',margin:'12px 0'});
 const actions=doc.createElement('div');Object.assign(actions.style,{display:'flex',gap:'12px',flexWrap:'wrap',marginTop:'18px'});
 const retry=doc.createElement('button');retry.type='button';retry.dataset.testid='retry-start';retry.textContent=camera?'Retry camera and microphone':'Reload this take';
 Object.assign(retry.style,{border:'1px solid #d6b968',borderRadius:'8px',padding:'10px 14px',background:'#ebc773',color:'#17130d'});
 retry.onclick=()=>doc.defaultView.location.reload();
 const back=doc.createElement('a');back.href='/create';back.textContent='Back to saved ideas';
 Object.assign(back.style,{color:'#ebc773',padding:'10px 0'});
 actions.append(retry,back);container.append(detail,actions);
}

export function recordingNotice(doc, message, heading='Speech needs attention · Type a change') {
 let box=doc.querySelector('[data-testid="recording-status"]');
 if(!message){if(box)box.hidden=true;return;}
 if(!box){
  box=doc.createElement('aside');box.dataset.testid='recording-status';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  Object.assign(box.style,{position:'absolute',right:'var(--page-pad, 40px)',top:'110px',width:'min(360px, calc(100vw - 80px))',maxHeight:'220px',overflowY:'auto',zIndex:'2',padding:'12px 16px',border:'1px solid #655436',borderRadius:'12px',background:'rgba(24,22,17,.95)',color:'#f1d89d',fontSize:'14px',lineHeight:'1.45'});
  const details=doc.createElement('details'),summary=doc.createElement('summary'),p=doc.createElement('p');
  summary.style.cursor='pointer';p.style.margin='10px 0 0';details.append(summary,p);box.append(details);doc.querySelector('.live-shell').append(box);
 }
 box.querySelector('summary').textContent=heading;
 box.querySelector('p').textContent=message;
 box.hidden=false;
}
