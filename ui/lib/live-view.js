export const FIRST_CUT_WORDS = 'Your first cut is ready';
export function railModel(progress = []) {
 const current = Math.max(0, progress.findIndex(p => p.state === 'current'));
 const nodes = progress.map((p,i) => ({id:p.beatId || p.id, name:p.title || p.name || '',state:i===current?'current':p.state==='done'?'done':'ahead',caption:p.caption || ''}));
 return {nodes,current,doneTo:Math.max(0,...nodes.map((n,i)=>n.state==='done'&&i<current?i:0)),step:nodes.length>1?100/(nodes.length-1):0};
}
export function storyModel(state = {}) {
 const points=(state.points?.length?state.points:[state.title || 'Take your time.']).slice(0,3);
 return {label:state.label || 'Story', title:state.title || '',points:points.map((p,i)=>({text:typeof p==='string'?p:p.text,active:i===(state.active || 0)})),cue:state.cue || ''};
}
export function panelModel(exchange = {}) {
 const p=exchange.proposal;
 return {you:exchange.remark || '',yap:exchange.reply || p?.ask || '',card:p?{tag:p.category || 'Greeting',line:exchange.greeting || p.to || p.change?.to || '',trialLength:p.trialLength || 3}:null,saved:exchange.saved || ''};
}
// The line the person would say with the change in it: "Grab a tea. Let's get into it." with tea for coffee.
export function changedLine(current = '', from = '', to = '') {
 if(from && to && current.includes(from))return current.replace(from, to);
 return to && current.includes(to) ? current : to;
}
// What the old wording is known by: against "Grab a coffee", "Grab a tea" is "tea".
export function keptWords(from = '', to = '') {
 const a=from.split(/\s+/).filter(Boolean), b=to.split(/\s+/).filter(Boolean);
 let i=0;
 while(i<a.length-1 && i<b.length && a[i].toLowerCase()===b[i].toLowerCase())i++;
 return a.slice(i).join(' ').replace(/[.!?]+$/,'');
}
