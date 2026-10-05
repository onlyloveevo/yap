// Review evidence and creator choices. Pure/browser-safe; audience observations never use restart prediction slack.
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if(value && typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);} return value; };
export const METRICS = freeze({
 ctr:{label:'Impressions CTR',unit:'%',definition:'Views from registered thumbnail impressions divided by those impressions',source:'sample/import only',caveat:'Title, topic, traffic and audience may differ. Public views cannot supply private impressions CTR.'},
 retention:{label:'Segment watch ratio',unit:'ratio',definition:'Aggregate views of a source segment relative to video views; includes replay',source:'YouTube video-filtered retention report definition; fixture values',caveat:'Not unique viewers or a count of people who exited. Traffic segmentation is not assumed.'},
 subscribers:{label:'Subscribers gained on video watch page',unit:'subscriptions',definition:'Subscriptions attributed to this video watch page',source:'sample fixture',caveat:'Does not include every eventual subscriber influenced by this video.'}
});
const sampleAsset=(id,version,title,color)=>{const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="${color}"/><text x="24" y="100" font-size="32">${title}</text><text x="24" y="150" font-size="18">Illustrative sample</text></svg>`;return {id,version,url:`data:image/svg+xml,${encodeURIComponent(svg)}`,content:svg,provenance:'illustrative sample asset, not creator approved'};};
export function fixtureSnapshot(){return {
 id:'sample-review-v1',sourceType:'sample',sourceRef:'bundled illustrative metric fixture (not measured from sample video)',fetchedAt:'2026-10-03T09:00:00Z',
 video:{id:'sample-video',title:'Bundled sample take',platform:'youtube',format:'long',duration:31,media:'/sample/take1.mp4',analyticsAssociation:'illustrative demo, not an actual platform report'},
 scope:{window:'first-seven-days',from:'2026-09-26',to:'2026-10-03',ageDays:7,traffic:'sample Browse cohort'},
 metrics:{ctr:{value:2.4,denominator:10000,unit:'%'},retention:{buckets:[{id:'r1',start:0,end:4,ratio:0.62},{id:'r2',start:4,end:8,ratio:1.12},{id:'r3',start:8,end:12,ratio:0.51}]},subscribers:{value:12,unit:'subscriptions'}},
 comparison:{id:'demo-matched-10',platform:'youtube',format:'long',window:'first-seven-days',traffic:'sample Browse cohort',count:10,lengthRule:'within twenty percent',ctr:4.1,rule:'Demo rule; not a validated statistical threshold'},
 assets:[sampleAsset('current-thumb','sample-current-v1','Ideas for a video','#e2e8f0'),sampleAsset('proposed-thumb','sample-proposed-v1','One clear promise','#d1fae5')],
 transcript:{status:'unavailable',reason:'No timestamped content transcript attached to this review fixture'},vision:{status:'unavailable',reason:'No video analysis service configured'}
 };}
function fact(id,value,unit,source,rule='source value'){return {id,value,unit,display:value===null?'unavailable':`${value}${unit==='%'?'%':unit==='percentage points'?' percentage points':unit==='ratio'?'×':unit==='seconds'?' seconds':''}`,source,rule};}
export function selectContext(snapshot,metricId,bucketId){
 if(!METRICS[metricId])throw Error('Unknown metric');
 const s=copy(snapshot),m=s.metrics?.[metricId];if(!m)throw Error('Metric unavailable: private analytics were not imported for this video');
 const f={};let bucket=null,seek=null;let comparison=null;const evidence=[`${s.id}:video`,`${s.id}:scope`,`${s.id}:${metricId}`];
 if(metricId==='ctr'){
 f.ctr=fact('ctr',m.value??null,'%',`${s.id}:ctr`);f.impressions=fact('impressions',m.denominator??null,'impressions',`${s.id}:ctr`);
 const c=s.comparison;const compatible=c && ['platform','format'].every(k=>c[k]===s.video[k]) && c.window===s.scope.window && c.traffic===s.scope.traffic;
 comparison=c?{...c,status:compatible?'eligible-demo':'incompatible'}:{status:'unavailable'};
 if(compatible && Number.isFinite(m.value)&&Number.isFinite(c.ctr)){
 f['cohort-ctr']=fact('cohort-ctr',c.ctr,'%',c.id);f['ctr-gap']=fact('ctr-gap',Math.round((m.value-c.ctr)*10)/10,'percentage points',`${s.id}:ctr + ${c.id}`,'round(current CTR minus cohort CTR, one decimal)');f['cohort-count']=fact('cohort-count',c.count,'videos',c.id);evidence.push(c.id);
 }
 evidence.push(...(s.assets??[]).map(a=>`${a.id}@${a.version}`));
 }else if(metricId==='retention'){
 bucket=copy(m.buckets.find(b=>b.id===(bucketId??m.buckets[0]?.id)));if(!bucket)throw Error('Unknown source bucket');seek=bucket.start;
 f.ratio=fact('ratio',bucket.ratio,'ratio',`${s.id}:${bucket.id}`);f.start=fact('start',bucket.start,'seconds',`${s.id}:${bucket.id}`);f.end=fact('end',bucket.end,'seconds',`${s.id}:${bucket.id}`);evidence.push(`${s.id}:${bucket.id}`);
 }else{f.subscribers=fact('subscribers',m.value??null,'subscriptions',`${s.id}:subscribers`);}
 return freeze({videoId:s.video.id,snapshotId:s.id,metricId,bucket,seek,comparison,evidence,facts:f,snapshot:s});
}
function prepared(context,intent='explain'){
 const c=context;let text,alternatives,decision;
 if(c.metricId==='ctr'){
 text='Sample impressions CTR: {{ctr}} from {{impressions}} impressions.';
 if(c.facts['ctr-gap'])text+=' Matched demo cohort: {{cohort-ctr}}; difference: {{ctr-gap}}. The demo cohort rule is not a confidence threshold.';
 else text+=' Comparison unavailable or incompatible; no matched difference can be inferred.';
 text+=' CTR concerns packaging and reach. We cannot tell whether the thumbnail, title, topic or traffic caused it.';
 alternatives=[{kind:'hypothesis',text:'The title or image may not communicate the video promise.',evidence:c.evidence.filter(x=>x.includes('thumb'))},{kind:'hypothesis',text:'The traffic audience may differ from the intended audience.',evidence:[`${c.snapshotId}:scope`]}];
 decision='Compare the current/proposed title and thumbnail message, or retain it. A native thumbnail test uses watch-time share as its primary outcome; CTR is secondary.';
 }else if(c.metricId==='retention'){
 text='Sample source bucket interval {{start}} to {{end}}: {{ratio}} aggregate segment watch ratio. This ratio includes replays and can exceed one. It does not count unique viewers who left.';
 alternatives=[{kind:'hypothesis',text:'The interval may contain a transition the creator wants to inspect.',evidence:[`${c.snapshotId}:${c.bucket.id}`]},{kind:'hypothesis',text:'Replays or viewing patterns may affect the aggregate ratio.',evidence:[`${c.snapshotId}:retention`]}];
 decision='Play this interval and supply your interpretation. Transcript and visual analysis are unavailable, so a content-specific edit remains unproven; this context does not propose a thumbnail fix.';
 }else{
 text='Sample subscriptions on this video watch page: {{subscribers}}. This attribution excludes other eventual subscriptions influenced by the video.';
 alternatives=[{kind:'hypothesis',text:'The video promise may attract viewers interested in future videos.',evidence:[`${c.snapshotId}:video`]},{kind:'hypothesis',text:'Audience reach may differ from the creator goal.',evidence:[`${c.snapshotId}:scope`]}];
 decision='Discuss the creator goal and watch-page attribution. No evidence here establishes why people subscribed.';
 }
 const factIds=[...text.matchAll(/\{\{([^}]+)\}\}/g)].map(m=>m[1]);
 return {mode:intent==='explain'?'deterministic-explainer':'prepared-offline',text:renderFacts(c,text),factIds,evidence:[...c.evidence],alternatives,decision,sourceType:c.snapshot.sourceType,modelAvailable:false,limitation:'No configured general model service; these are prepared factual replies, not freeform intelligence.'};
}
export function renderFacts(context,text){return text.replace(/\{\{([^}]+)\}\}/g,(_,id)=>{if(!context.facts[id])throw Error('Unknown fact reference');return context.facts[id].display;});}
export const explain=c=>prepared(c);
export const discuss=(c,question)=>({...prepared(c,'discuss'),question:String(question).slice(0,2000)});
// Fail closed on unsupported numeric strings and actions; model output is not wired in this offline proof.
export function validateReply(context,reply){
 const ids=reply.factIds??[],text=String(reply.text??'');if(ids.some(id=>!context.facts[id]))return {valid:false,reason:'unknown fact reference'};
 if(/\b(saved|saving|published|uploaded|remembered|accepted|applied)\b|\b(caused|guaranteed|certainly|proved)\b/i.test(text))return {valid:false,reason:'unsupported action or causal claim'};
 const substituted=text.replace(/\{\{([^}]+)\}\}/g,(_,id)=>ids.includes(id)?context.facts[id].display:'INVALID_REFERENCE');if(substituted.includes('INVALID_REFERENCE')||substituted.includes('{{'))return {valid:false,reason:'unlisted reference'};
 const allowed=new Set(ids.flatMap(id=>context.facts[id].display.match(/-?\d+(?:\.\d+)?/g)??[]));
 for(const n of substituted.match(/-?\d+(?:\.\d+)?/g)??[])if(!allowed.has(n))return {valid:false,reason:'unprovided number'};
 return {valid:true,text:substituted};
}
export const emptyReview=()=>({version:1,turns:[],trials:[],dismissed:[],forgotten:[]});
export function appendTurn(state,context,question){return {...state,turns:[...state.turns,{id:`turn-${state.turns.length+1}`,question,context:copy(context),reply:discuss(context,question)}]};}
function stableId(value){let n=2166136261;for(const char of JSON.stringify(value)){n^=char.charCodeAt(0);n=Math.imul(n,16777619);}return (n>>>0).toString(16);}
export function proposeTrial(context){
 const kind=context.metricId==='ctr'?'thumbnail-message':context.metricId==='retention'?'interval-review':'subscriber-goal';
 const change=kind==='thumbnail-message'?'Test a clearer thumbnail promise':kind==='interval-review'?'Inspect selected interval before proposing a content change':'Clarify the watch-page subscription promise';
 const p={context:copy(context),kind,change,goal:'Learn whether the chosen change supports the creator goal',prediction:'Directional hypothesis only; no numeric uplift forecast',primaryMeasure:kind==='thumbnail-message'?'native-watchtime-share':context.metricId,secondaryMeasure:kind==='thumbnail-message'?'ctr':null,baseline:copy(context.snapshot),assets:copy(context.snapshot.assets??[]),scope:copy(context.snapshot.scope),checkIn:'Review on next visit after the creator supplies an eligible report; no scheduler',status:'proposed',sourceType:context.snapshot.sourceType};
 p.id=`proposal-${stableId([p.context.snapshotId,p.context.metricId,p.context.bucket?.id,p.change,p.assets])}`;return p;
}
export function adjustProposal(proposal,change,reason=''){const p=copy(proposal);p.change=String(change).trim().slice(0,1000);if(!p.change)throw Error('Describe the proposed change');p.reason=String(reason).slice(0,1000);p.id=`proposal-${stableId([proposal.id,p.change,p.reason])}`;return p;}
export function dismissProposal(state,p){return {...state,dismissed:[...new Set([...state.dismissed,p.id])]};}
export function acceptTrial(state,p){
 if(state.trials.some(t=>t.proposalId===p.id))return state;
 const overlap=t=>t.context.videoId===p.context.videoId&&t.primaryMeasure===p.primaryMeasure&&t.scope.window===p.scope.window;
 const confounded=state.trials.some(overlap);
 const trial={...copy(p),id:`trial-${p.id}`,proposalId:p.id,status:'ready-to-try',acceptedAt:new Date().toISOString(),application:null,outcome:null,confounded};
 return {...state,trials:[...state.trials.map(t=>overlap(t)?{...t,confounded:true}:t),trial]};
}
export function recordApplication(state,id,event){if(!['user-report','sample','import','live'].includes(event.sourceType)||typeof event.applied!=='boolean')throw Error('Explicit application event and source required');return {...state,trials:state.trials.map(t=>t.id===id?{...t,application:copy(event),status:event.applied?'awaiting-evidence':'not-applied',outcome:null}:t)};}
export function reviewOutcome(state,id,evidence){
 return {...state,trials:state.trials.map(t=>{if(t.id!==id)return t;const applied=t.application?.applied===true;
 const compatible=evidence.comparable===true&&evidence.snapshot?.video?.id===t.context.videoId&&evidence.snapshot?.video?.platform===t.baseline.video.platform&&evidence.snapshot?.video?.format===t.baseline.video.format&&evidence.measure===t.primaryMeasure&&evidence.snapshot?.sourceType===evidence.sourceType&&Number.isFinite(evidence.value)&&Number.isFinite(evidence.baselineValue);
 const permitted=['improved','no-clear-change','mixed','insufficient-evidence'];const status=!applied?'not-applied':compatible&&permitted.includes(evidence.status)?evidence.status:'insufficient-evidence';
 return {...t,status:'reviewed',outcome:{...copy(evidence),status,eligible:applied&&compatible&&!t.confounded,sourceType:evidence.sourceType??'unknown',interpretation:'Scoped observation only, not causal or universal advice',numericPredictionError:null}};})};
}
export function nextCreation(state,video){return state.trials.filter(t=>t.baseline.video.platform===video.platform&&t.baseline.video.format===video.format).map(t=>({...copy(t),retrievalLabel:`Accepted ${t.sourceType} trial; ${t.application?.applied?'application reported':'not yet applied'}; effectiveness ${t.outcome?.status??'unknown'}`}));}
export function performanceMemory(state){return state.trials.filter(t=>t.application?.applied===true&&t.baseline.sourceType!=='sample'&&t.outcome?.eligible&&['live','import'].includes(t.outcome.sourceType)).map(t=>({trialId:t.id,kind:'scoped-provisional-observation',outcome:copy(t.outcome)}));}
export function forgetTrial(state,id){const t=state.trials.find(t=>t.id===id);return t?{...state,trials:state.trials.filter(t=>t.id!==id),forgotten:[...state.forgotten,t]}:state;}
export function undoForget(state,id){const t=state.forgotten.find(t=>t.id===id);return t?{...state,trials:[...state.trials,t],forgotten:state.forgotten.filter(t=>t.id!==id)}:state;}
