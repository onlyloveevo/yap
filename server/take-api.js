// Recording lifecycle API. Called only after app-api's same-origin checks.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateRecording} from '../src/engine/recording.js';
import {setApplied,keptRanges} from '../src/engine/cutlist.js';
import {trimStart,trimEnd} from '../src/engine/transcript-edit.js';
import {countRecording,answerCheckIn,statusLine,EXPERIMENT_STATUSES} from '../src/engine/experiments.js';
import {trialInScope,recordingUsesTrial} from '../src/engine/trial-scope.js';
import {emptyMemory} from '../src/engine/memory.js';
import {createTrialStore} from '../src/node/trial-store.js';
import {readJson,writeJsonAtomic,resolveDataDir} from '../src/node/store.js';
import {exportTake,resolveFfmpeg} from '../src/node/export-file.js';
import {ExportRefusedError} from '../src/engine/export.js';
import {mp4VideoDuration} from '../src/node/mp4-info.js';
import {CaptionExportError} from '../src/node/caption-export.js';
import {captionState} from '../src/engine/caption-model.js';
import {EDITOR_ACTIONS,runEditorAction} from './editor-api.js';
import {handleBrollApi,BROLL_ACTIONS,assetForExport} from './broll-api.js';
import {brollState,brollWindows,checkBrollRange} from '../src/engine/broll-plan.js';
import {BrollClipError} from '../src/node/broll-probe.js';
// Upload budget: 16 times the former 128 MiB cap, enough for the observed 218 MB hour. It is an engineering bound on
// bytes, not a duration limit; the body is streamed to disk so memory does not grow with it. Raising it further needs
// a separate disk-capacity check. `mediaLimits` is exported so tests can lower the bound, the deadlines, or inject a fault.
export const MAX_MEDIA_BYTES=2*1024*1024*1024;
export const mediaLimits={maxBytes:MAX_MEDIA_BYTES,normalizeMs:15*60*1000,audioMs:10*60*1000,afterChunk:null};
const WEBM_MAGIC='1a45dfa3';
const uploading=new Set();
// Prevent this running server from serving a pair whose exception rollback failed.
// This is not crash recovery; raw originals and unrestored backups remain on disk.
const uncertainPublications=new Set();
class UploadError extends Error{constructor(status,message){super(message);this.status=status;}}
const sizeWords=n=>n>=1024**3?`${+(n/1024**3).toFixed(2)} GB`:n>=1024**2?`${+(n/1024**2).toFixed(1)} MB`:`${n} bytes`;
// The video track may end this much before the kept timeline. 0.25 s follows the current acceptance policy
// (the same slack invalidCuts allows a cut past the end of a take) and covers the cases observed so far; it is
// not a proven bound on frame rounding across any number of concat joins.
const VIDEO_TOLERANCE_SECONDS=0.25;
const CAPTION_EXPORT_BODY_BYTES=48*1024*1024;
const MAX_MOOV=64*1024*1024;
// Read only the moov box of a (possibly hours-long) MP4, not the whole file.
function readMoov(file){
 const fd=fs.openSync(file,'r');
 try{
  const size=fs.fstatSync(fd).size,head=Buffer.alloc(16);
  for(let at=0;at+8<=size;){
   fs.readSync(fd,head,0,16,at);
   let len=head.readUInt32BE(0),header=8;
   if(len===1){len=Number(head.readBigUInt64BE(8));header=16;}else if(len===0)len=size-at;
   if(len<header||at+len>size)throw new Error('truncated box');
   if(head.toString('latin1',4,8)==='moov'){
    if(len>MAX_MOOV)throw new Error('moov too large');
    const moov=Buffer.alloc(len);fs.readSync(fd,moov,0,len,at);return moov;
   }
   at+=len;
  }
  throw new Error('no moov box');
 }finally{fs.closeSync(fd);}
}
// Refuse a video that ends before the take it should cover (an hour of audio under 15 minutes of video).
// Judges the video track itself: the movie header reports the longest track, audio included.
function assertVideoCoversTimeline(file,keptRanges){
 const expected=keptRanges.reduce((n,[s,e])=>n+(e-s),0);
 let actual;
 try{actual=mp4VideoDuration(readMoov(file));}
 catch{throw new ExportRefusedError('The exported video could not be checked, so it was not published. The original take and any earlier download are safe.');}
 if(!(actual>=expected-VIDEO_TOLERANCE_SECONDS))throw new ExportRefusedError(`The exported video ends early: its picture runs ${actual.toFixed(1)} s but the kept take is ${expected.toFixed(1)} s. It was not published; the original take and any earlier download are safe.`);
}
const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
// One identity binds the published video and cut list, without retaining a history.
// Synchronous validation and fileReply's open happen before another request can
// publish replacements; the opened descriptor then retains those exact bytes.
function exportIdentity(dir,id){
 const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(64*1024);
 for(const suffix of ['.cut.mp4','.cuts.json']){
  const file=path.join(dir,`${id}${suffix}`);if(!fs.existsSync(file))return null;
  const fd=fs.openSync(file,'r');
  try{hash.update(suffix);let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
 }
 return hash.digest('hex');
}
function cutSnapshot(recording){
 return JSON.stringify({duration:recording.duration,cuts:recording.cuts.cuts.map(({id,start,end,applied})=>({id,start,end,applied})).sort((a,b)=>a.id.localeCompare(b.id))});
}
function invalidCuts(cuts,duration){
 if(!cuts||!Array.isArray(cuts.cuts)||!Array.isArray(cuts.undoStack))return true;
 const ids=new Set();
 return cuts.cuts.some(c=>!c||typeof c.id!=='string'||ids.has(c.id)||!ids.add(c.id)||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration+0.25||typeof c.applied!=='boolean');
}
function fileReply(req,res,file,mime){
 if(!fs.existsSync(file)){res.writeHead(404);res.end('Media unavailable.');return;}
 const fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size;
 let start=0,end=size-1,status=200;
 const range=req.headers.range;
 if(range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!m||(!m[1]&&!m[2])){fs.closeSync(fd);res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
  if(!m[1])start=Math.max(0,size-Number(m[2]));
  else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
  if(start> end||start>=size){fs.closeSync(fd);res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
  status=206;
 }
 res.writeHead(status,{'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
 if(req.method==='HEAD'){fs.closeSync(fd);res.end();}else fs.createReadStream(file,{fd,autoClose:true,start,end}).on('error',()=>res.destroy()).pipe(res);
}
// ffmpeg without a shell and without blocking the event loop; the deadline is explicit and truthful.
function runFfmpeg(ffmpeg,args,ms){
 return new Promise(resolve=>{
  let timedOut=false,done=false,child;
  const finish=result=>{if(!done){done=true;clearTimeout(timer);resolve({...result,timedOut});}};
  const timer=setTimeout(()=>{timedOut=true;child?.kill('SIGKILL');},ms);
  try{child=spawn(ffmpeg,args,{stdio:'ignore'});}catch{finish({ok:false});return;}
  child.once('error',()=>finish({ok:false}));
  child.once('close',code=>finish({ok:code===0&&!timedOut}));
 });
}
const extracting=new Map();
function ensureAudio(root,video,wav){
 if(fs.existsSync(wav))return Promise.resolve(true);
 const running=extracting.get(wav);if(running)return running;
 const ffmpeg=resolveFfmpeg({appRoot:root});if(!ffmpeg||!fs.existsSync(video))return Promise.resolve(false);
 const temporary=`${wav}.${randomBytes(4).toString('hex')}.extract`;
 const job=(async()=>{
  const result=await runFfmpeg(ffmpeg,['-y','-i',video,'-vn','-ac','1','-ar','16000','-acodec','pcm_s16le','-f','wav',temporary],mediaLimits.audioMs);
  if(!result.ok){fs.rmSync(temporary,{force:true});return false;}
  fs.renameSync(temporary,wav);return true;
 })().finally(()=>extracting.delete(wav));
 extracting.set(wav,job);return job;
}
// Stream the body to a unique staging file, counting real bytes and hashing as they arrive. Only a complete,
// WebM-headed body is returned; anything else removes this attempt's own staging file and nothing else.
async function receiveUpload(req,mediaDir,id,declared){
 const staging=path.join(mediaDir,`${id}.${randomBytes(6).toString('hex')}.upload`);
 const handle=await fs.promises.open(staging,'wx');
 const hash=createHash('sha256');let bytes=0,head=Buffer.alloc(0),closed=false;
 try{
  // destroyOnReturn:false so an early refusal can still be answered; leaving a plain for-await would destroy the socket.
  for await(const chunk of req.iterator({destroyOnReturn:false})){
   bytes+=chunk.length;
   if(bytes>mediaLimits.maxBytes)throw new UploadError(413,`Recording is larger than ${sizeWords(mediaLimits.maxBytes)}.`);
   if(head.length<4){
    head=Buffer.concat([head,chunk.subarray(0,4-head.length)]);
    if(head.length===4&&head.toString('hex')!==WEBM_MAGIC)throw new UploadError(400,'Recording is not a WebM video.');
   }
   hash.update(chunk);await handle.writeFile(chunk);
   mediaLimits.afterChunk?.(bytes);
  }
  if(!req.complete||(Number.isFinite(declared)&&bytes!==declared))throw new UploadError(400,'The recording upload was cut short, so nothing was saved.');
  if(bytes<16||head.toString('hex')!==WEBM_MAGIC)throw new UploadError(400,'Recording is not a WebM video.');
  await handle.sync();await handle.close();closed=true;
  return {staging,bytes,sha256:hash.digest('hex')};
 }catch(error){
  if(!closed)await handle.close().catch(()=>{});
  await fs.promises.rm(staging,{force:true});throw error;
 }
}
// A complete received original is kept under a name made from its own hash: never overwritten, never deleted by a retry.
function adoptOriginal(mediaDir,id,received){
 const file=`${id}.raw-${received.sha256.slice(0,32)}.webm`,final=path.join(mediaDir,file);
 if(fs.existsSync(final)){
  if(fs.statSync(final).size!==received.bytes)throw new Error('original name collision');
  fs.rmSync(received.staging,{force:true});
 }else fs.renameSync(received.staging,final);
 return {file,path:final,sha256:received.sha256,bytes:received.bytes};
}
function writeUploadManifest(mediaDir,id,change){
 const file=path.join(mediaDir,`${id}.upload.json`);
 const manifest=readJson(file,{originals:[]});
 if(change.original&&!manifest.originals.some(o=>o.sha256===change.original.sha256))manifest.originals.push({file:change.original.file,sha256:change.original.sha256,bytes:change.original.bytes});
 if(change.published)manifest.published=change.published;
 writeJsonAtomic(file,manifest);
}
async function saveUpload({req,res,refuse,answer,store,id,root,mediaDir}){
 const declared=Number(req.headers['content-length']);
 fs.mkdirSync(mediaDir,{recursive:true});
 let received;
 try{received=await receiveUpload(req,mediaDir,id,declared);}
 catch(error){
  if(error instanceof UploadError){
   refuse(error.status,error.message);
   req.resume();
   if(error.status===413)res.once('finish',()=>setTimeout(()=>req.destroy(),1000).unref());
   return;
  }
  // The client went away mid-body (its socket is gone): there is nobody to answer and nothing was kept.
  if(req.aborted||!res.writable||res.socket?.destroyed)return;
  req.resume();
  if(error?.code==='ENOSPC'){refuse(507,'There is not enough disk space to save this recording.');return;}
  refuse(500,'Recording could not be received. Please retry.');return;
 }
 const original=adoptOriginal(mediaDir,id,received);
 writeUploadManifest(mediaDir,id,{original});
 const kept=`Your complete original recording (${sizeWords(original.bytes)}, sha256 ${original.sha256.slice(0,12)}) is kept on this computer.`;
 const ffmpeg=resolveFfmpeg({appRoot:root});
 if(!ffmpeg){refuse(503,`Run npm run setup from this app folder to restore the video runtime, then retry saving. ${kept}`);return;}
 const file=path.join(mediaDir,`${id}.webm`),fixed=path.join(mediaDir,`${id}.${randomBytes(6).toString('hex')}.fixed`);
 const normalized=await runFfmpeg(ffmpeg,['-y','-i',original.path,'-map','0:v:0','-map','0:a:0','-c','copy','-f','webm',fixed],mediaLimits.normalizeMs);
 if(!normalized.ok||!fs.existsSync(fixed)||fs.statSync(fixed).size===0){
  fs.rmSync(fixed,{force:true});
  if(normalized.timedOut)refuse(504,`Preparing the recording took longer than ${Math.round(mediaLimits.normalizeMs/60000)} minutes and was stopped. ${kept} Any earlier saved video is unchanged.`);
  else refuse(422,`Recording needs a playable camera picture and microphone track. Please retry. ${kept} Any earlier saved video is unchanged.`);
  return;
 }
 const current=store.load(id);
 if(!current||current.status==='ready'){fs.rmSync(fixed,{force:true});refuse(409,`This take is already saved. ${kept}`);return;}
 const wav=path.join(mediaDir,`${id}.wav`);
 await extracting.get(wav);
 // Previous published pair is held by hard link (copy fallback) so any late failure can put it back unchanged.
 const tag=randomBytes(6).toString('hex'),held=[];
 const hold=target=>{if(!fs.existsSync(target))return {target,backup:null};const backup=`${target}.${tag}.prev`;try{fs.linkSync(target,backup);}catch{fs.copyFileSync(target,backup);}held.push(backup);return {target,backup};};
 const previous=[hold(file),hold(wav)],manifestFile=path.join(mediaDir,`${id}.upload.json`),manifestBefore=fs.existsSync(manifestFile)?fs.readFileSync(manifestFile):null;
 const rollback=()=>{
  const failed=[];
  for(const {target,backup} of previous){try{if(backup)fs.renameSync(backup,target);else fs.rmSync(target,{force:true});}catch{failed.push(target);}}
  try{if(manifestBefore)fs.writeFileSync(manifestFile,manifestBefore);}catch{failed.push(manifestFile);}
  return failed;
 };
 // Cleanup is not publication: a failed backup removal must never undo a committed record.
 const cleanup=()=>{for(const backup of held){try{fs.rmSync(backup,{force:true});}catch{}}};
 let video;
 try{
  fs.renameSync(fixed,file);
  try{fs.unlinkSync(wav);}catch{}
  const audioReady=await ensureAudio(root,file,wav);
  // A previous pair existed: the new video must come with its matching audio, or the old pair is restored.
  if(!audioReady&&previous[1].backup)throw new UploadError(422,'Audio for the new recording could not be prepared.');
  video={file:`${id}.webm`,mime:'video/webm',bytes:fs.statSync(file).size};
  writeUploadManifest(mediaDir,id,{published:{original:original.file,sha256:original.sha256,normalizedBytes:video.bytes}});
  store.save({...current,video});
 }catch(error){
  try{fs.rmSync(fixed,{force:true});}catch{}
  const failed=rollback();
  // An unrestored backup is recovery evidence. Never delete it or promise the old pair survived.
  if(failed.length){
   uncertainPublications.add(file);
   refuse(500,`Saving and restoring the earlier recording could not be confirmed. Retained backups need recovery before using this take. ${kept}`);
   return;
  }
  cleanup();
  const status=error instanceof UploadError?error.status:error?.code==='ENOSPC'?507:500;
  refuse(status,`The new recording could not be published, so the earlier saved video and its details are unchanged. ${kept}`);
  return;
 }
 uncertainPublications.delete(file);
 cleanup();
 answer(200,{video,original:{file:original.file,sha256:original.sha256,bytes:original.bytes}});
}
// The scope a recording's trials belong to: its idea, else the first recording of its Just-talk chain.
function recordingScope(meta,id){
 const info=meta.load(id);if(info?.ideaId)return {ideaId:info.ideaId};
 const seen=new Set([id]);let root=id,current=info;
 while(current?.returnFrom&&!seen.has(current.returnFrom)){seen.add(current.returnFrom);root=current.returnFrom;current=meta.load(current.returnFrom);}
 return {recordingId:root};
}
export async function handleTakeApi(ctx){
 const {req,res,rest,method,answer,refuse,readJsonBody,recordings,root,dataDir}=ctx;
 const dir=resolveDataDir(root,dataDir);
 const memoryFile=path.join(dir,'memory.json');
 const checkIn=/^trials\/([A-Za-z0-9_-]{1,64})\/check-in$/.exec(rest||'');
 if(checkIn){
  if(method!=='POST'){req.resume();refuse(405,'Method not allowed.');return true;}
  const body=await readJsonBody(4*1024);if(!body)return true;
  if(body.answer!=='keep'&&body.answer!=='revert'){refuse(400,'A check-in is answered keep or revert.');return true;}
  // The decision is made on the saved trial as it is now, not on what the page last saw. No await from here to the save.
  const trials=createTrialStore(dir,{appRoot:root});const current=trials.list().find(t=>t.id===checkIn[1]);
  if(!current){refuse(404,'No trial has that id.');return true;}
  const decided={keep:'kept',revert:'reverted'}[body.answer];
  if(current.status==='kept'||current.status==='reverted'){
   if(current.status===decided){answer(200,{trial:current,unchanged:true});return true;}
   refuse(409,`This trial was already answered (${current.status}). Your answer was not changed.`);return true;
  }
  if(current.status!=='check-in due'||current.recordings.length<current.trialLength){refuse(409,'This trial is not ready for its check-in yet.');return true;}
  answer(200,{trial:trials.save(answerCheckIn(current,body.answer))});return true;
 }
 if(rest==='memory'||rest==='trials'){
  if(method==='GET'){answer(200,rest==='memory'?readJson(memoryFile,emptyMemory()):createTrialStore(dir,{appRoot:root}).list());return true;}
  if(rest==='trials'&&method==='POST'){
   const body=await readJsonBody();if(!body)return true;
   try{
    const trials=createTrialStore(dir,{appRoot:root});
    // Reads and writes below have no await between them: a stale page can neither replace a different trial that has the
    // same id nor push a counter backwards. Saving the same acceptance again keeps the counted trial as it is.
    const existing=trials.list().find(t=>t.id===body?.id);
    if(existing){
     if(existing.acceptedAt!==body.acceptedAt){refuse(409,'Another trial already uses that id. Reload and try again; nothing was replaced.');return true;}
     answer(200,existing);return true;
    }
    answer(200,trials.save(body));
   }catch{refuse(400,'Only an accepted, complete trial can be saved.');}return true;
  }
  if(rest==='memory'&&method==='POST'){
   const body=await readJsonBody();if(!body)return true;
   if(!Array.isArray(body.notes)|| (body.carried!==undefined&&!Array.isArray(body.carried))){refuse(400,'Memory needs its notes and carried cues.');return true;}
   writeJsonAtomic(memoryFile,body);answer(200,body);return true;
  }
  refuse(405,'Method not allowed.');return true;
 }
 const m=/^recordings\/([^/]+)\/(take|cuts|export|trim|words|autocut|captions|broll|broll-asset|broll-media|media|audio|download|download-cuts)$/.exec(rest||'');
 if(!m)return false;
 const [,id,action]=m;
 if(!ID.test(id)){refuse(400,'Invalid recording id.');return true;}
 const {store,meta}=recordings();const recording=store.load(id);
 if(!recording){req.resume();refuse(404,'No recording has that id.');return true;}
 const info=meta.load(id);
 const sampleStem=info.sampleTake===2?'take2':'take1';
 const mediaDir=resolveDataDir(root,path.join(dir,'media'));
 if(uncertainPublications.has(path.join(mediaDir,`${id}.webm`))&&!(action==='media'&&method==='PUT')&&!['download','download-cuts'].includes(action)){
  req.resume();refuse(409,'The previous save needs recovery. Retry saving the recording before previewing or finishing this take.');return true;
 }
 if((action==='media'||action==='audio'||action==='download'||action==='download-cuts')&&['GET','HEAD'].includes(method)){
  if(action==='download'||action==='download-cuts'){
   const identities=new URL(req.url,'http://localhost').searchParams.getAll('export');
   // Legacy clients without a token intentionally request the latest published
   // output. Newly returned UI links always pin both files to one export.
   if(identities.length){
    if(identities.length!==1||!/^[a-f0-9]{64}$/.test(identities[0])){refuse(400,'Invalid export identity. Reload to review the current cut and export again.');return true;}
    if(exportIdentity(path.join(dir,'exports'),id)!==identities[0]){refuse(409,'This export was replaced. Reload to review the current cut and export again.');return true;}
   }
   const video=action==='download';fileReply(req,res,path.join(dir,'exports',`${id}${video?'.cut.mp4':'.cuts.json'}`),video?'video/mp4':'application/json');return true;
  }
  const file=info.sample?path.join(root,'sample',action==='audio'?sampleStem+'.wav':sampleStem+'.mp4'):path.join(mediaDir,`${id}.${action==='audio'?'wav':'webm'}`);
  if(action==='audio'&&!info.sample&&!await ensureAudio(root,path.join(mediaDir,`${id}.webm`),file)){refuse(422,'Audio preview could not be prepared. The original recording is safe.');return true;}
  fileReply(req,res,file,action==='audio'?'audio/wav':info.sample?'video/mp4':'video/webm');return true;
 }
 if(BROLL_ACTIONS.includes(action)){
  if(uncertainPublications.has(path.join(mediaDir,`${id}.webm`))){req.resume();refuse(409,'The previous save needs recovery. Retry saving the recording before editing this take.');return true;}
  return handleBrollApi({req,res,id,action,method,store,info,mediaDir,root,answer,refuse,readJsonBody,uploading,fileReply});
 }
 if(action==='media'&&method==='PUT'){
  if(info.sample){req.resume();refuse(409,'The bundled sample cannot be replaced.');return true;}
  if(recording.status==='ready'){req.resume();refuse(409,'This take is already saved.');return true;}
  const type=String(req.headers['content-type']||'');
  if(!type.startsWith('video/webm')){req.resume();refuse(415,'Record a WebM camera and microphone take.');return true;}
  if(Number(req.headers['content-length'])>mediaLimits.maxBytes){req.resume();refuse(413,`Recording is larger than ${sizeWords(mediaLimits.maxBytes)}.`);return true;}
  // Claimed before any await: a second save of the same recording is refused, never interleaved or silently replaced.
  if(uploading.has(id)){req.resume();refuse(409,'Another save of this recording is still running. Wait for it to finish; nothing was overwritten.');return true;}
  uploading.add(id);
  try{await saveUpload({req,res,refuse,answer,store,id,root,mediaDir});}finally{uploading.delete(id);}
  return true;
 }
 if(method!=='POST'||!['take','cuts','export','trim',...EDITOR_ACTIONS].includes(action)){req.resume();refuse(405,'Method not allowed.');return true;}
 // An export may carry the caption pictures the editor drew (one small PNG per caption), so its bound is larger.
 const body=await readJsonBody(action==='take'?1024*1024:action==='export'?CAPTION_EXPORT_BODY_BYTES:16*1024);if(!body)return true;
 if(EDITOR_ACTIONS.includes(action)){runEditorAction({id,action,body,store,info,uploading,answer,refuse});return true;}
 if(action==='take'){
  if(uploading.has(id)){refuse(409,'The recording is still being saved. Wait for it to finish, then try again.');return true;}
  const next={...recording};
  for(const key of ['beats','transcript','duration','cuts','reviewMoments','experiments','deliveryCues','processingNote','notes'])if(Object.hasOwn(body,key))next[key]=body[key];
  if(!Number.isFinite(next.duration)||next.duration<=0||invalidCuts(next.cuts,next.duration)){refuse(400,'The take needs a positive duration and valid cut ranges.');return true;}
  if(!info.sample&&!next.video){refuse(409,'Save the camera recording before finishing this take.');return true;}
  if(info.sample){const file=path.join(root,'sample',sampleStem+'.mp4');next.video={file:sampleStem+'.mp4',mime:'video/mp4',bytes:fs.statSync(file).size};}
  next.status='ready';const checked=validateRecording(next);if(!checked.ok){refuse(400,checked.errors[0]);return true;}
  const trials=createTrialStore(dir,{appRoot:root});const prior=trials.list();const incoming=Array.isArray(body.trials)?body.trials:[];
  const counted=[];
  // A trial counts this recording once (the engine's unit is each distinct finished recording) only when it belongs to the
  // recording's own scope and the recording really carried its wording; a retry or a stale page cannot count it twice.
  const recScope=info.sample?null:recordingScope(meta,id);
  for(const trial of incoming){
   if(!trial||!EXPERIMENT_STATUSES.includes(trial.status)||!trial.change?.from||!trial.change?.to||!Array.isArray(trial.recordings)||!Number.isInteger(trial.trialLength)){refuse(400,'Only an accepted, complete trial can be saved.');return true;}
   const old=prior.find(t=>t.id===trial.id);
   if(!old&&!(trial.status==='accepted'&&trial.recordings.length===0))continue;
   const current=old||(recScope&&!trial.scope?{...trial,scope:recScope}:trial);
   if(!(info.sample?!current.scope:trialInScope(current,recScope)))continue;
   const first=current.status==='accepted'&&current.recordings.length===0;
   if(!info.sample&&!first&&!current.recordings.includes(id)&&!recordingUsesTrial(recording,current,recScope))continue;
   counted.push(countRecording(current,id));
  }
  if(body.memory&&(!Array.isArray(body.memory.notes)|| (body.memory.carried&&!Array.isArray(body.memory.carried)))){refuse(400,'Invalid memory.');return true;}
  for(const trial of counted)trials.save(trial);
  const counting=counted.filter(t=>t.recordings.includes(id));
  if(counting.length)next.experiments=counting.map(t=>({id:t.id,line:statusLine(t)}));
  if(body.memory)writeJsonAtomic(memoryFile,body.memory);
  store.save(next);answer(200,{recording:next,meta:info});return true;
 }
 if(action==='cuts'){
  // Re-read after the body await: a trim saved meanwhile must not be overwritten by this older copy.
  const live=store.load(id)||recording;
  const cut=live.cuts.cuts.find(c=>c.id===body.cutId);if(!cut){refuse(404,'No cut has that id.');return true;}
  const next={...live,cuts:setApplied(live.cuts,cut.id,!cut.applied)};store.save(next);answer(200,{recording:next,meta:info});return true;
 }
 if(action==='trim'){
  // Everything from this re-read to store.save is synchronous, so two trims cannot interleave and none is last-write-wins.
  const current=store.load(id);
  if(!current||current.status!=='ready'||!current.video){refuse(409,'Finish and save the take before trimming it.');return true;}
  if(uploading.has(id)){refuse(409,'The recording is still being saved. Wait for it to finish, then try again.');return true;}
  const mediaFile=info.sample?path.join(root,'sample',sampleStem+'.mp4'):path.join(mediaDir,`${id}.webm`);
  if(!fs.existsSync(mediaFile)){refuse(409,'The original recording file is missing, so it cannot be trimmed. Nothing was changed.');return true;}
  const expected=body.expectedCutSnapshot;
  if(!expected||!Number.isFinite(expected.duration)||expected.duration<=0||invalidCuts({cuts:expected.cuts,undoStack:[]},expected.duration)){refuse(400,'Invalid cut snapshot. Reload to review the current cut and trim again.');return true;}
  if(cutSnapshot({duration:expected.duration,cuts:{cuts:expected.cuts}})!==cutSnapshot(current)){refuse(409,'The saved cut changed in another page. Nothing was trimmed. Reload to review it, then trim again.');return true;}
  const duration=current.duration;
  const reset=body.reset===true;
  const start=reset?0:body.start,end=reset?duration:body.end;
  const num=x=>typeof x==='number'&&Number.isFinite(x);
  if(!num(start)||!num(end)){refuse(400,'Start and end must be numbers of seconds. Nothing was changed.');return true;}
  if(start<0||end>duration||!(start<end)){refuse(400,`Start must be at least 0 and before the end, and the end at most ${+duration.toFixed(2)} seconds (the recording's length). Nothing was changed.`);return true;}
  const words=(Array.isArray(current.transcript)?current.transcript:[]).filter(w=>w&&num(w.start)&&num(w.end)&&w.end>w.start);
  const inside=t=>words.find(w=>t>w.start+1e-6&&t<w.end-1e-6);
  // Safe neighbours: the nearest 2-decimal time before the word starts and after it ends, unless that lands inside another word.
  const safe=(w,side)=>{const raw=side==='before'?w.start:w.end;const rounded=side==='before'?Math.floor(raw*100)/100:Math.ceil(raw*100)/100;return inside(rounded)?raw:Math.min(duration,Math.max(0,rounded));};
  for(const [label,t,trimmed] of [['start',start,start>0],['end',end,end<duration]]){
   if(!trimmed)continue;
   const w=inside(t);
   if(w){
    const before=safe(w,'before'),after=safe(w,'after');
    const e=new Error(`The ${label} at ${t} s falls inside the spoken word "${w.text}" (${+w.start.toFixed(2)}–${+w.end.toFixed(2)} s). YAP will not cut through speech. Use ${before} s to keep the word or ${after} s to drop it. Nothing was changed.`);
    answer(422,{error:e.message,word:w.text,wordStart:w.start,wordEnd:w.end,boundary:label,safeBefore:before,safeAfter:after});return true;
   }
  }
  let list=trimStart(current.cuts,start,duration);list=trimEnd(list,end,duration);
  if(!keptRanges(list,duration).length){refuse(422,'That trim, together with the other cuts, would leave nothing in the YAP cut. Nothing was changed.');return true;}
  const changed=list.cuts.length!==current.cuts.cuts.length||list.undoStack.length!==current.cuts.undoStack.length;
  const next=changed?{...current,cuts:list}:current;
  if(changed)store.save(next);
  answer(200,{recording:next,meta:info,changed});return true;
 }
 // readJsonBody awaited above: another request may have saved cuts meanwhile.
 const currentRecording=store.load(id);
 if(!currentRecording||currentRecording.status!=='ready'||!currentRecording.video){refuse(409,'Finish and save the take before exporting.');return true;}
 // The shipping editor states which cut the operator has actually reviewed.
 // Older API clients may omit the condition and intentionally export latest.
 if(Object.hasOwn(body,'expectedCutSnapshot')){
  const expected=body.expectedCutSnapshot;
  if(!expected||!Number.isFinite(expected.duration)||expected.duration<=0||invalidCuts({cuts:expected.cuts,undoStack:[]},expected.duration)){refuse(400,'Invalid cut snapshot. Reload to review the current cut and export again.');return true;}
  if(cutSnapshot({duration:expected.duration,cuts:{cuts:expected.cuts}})!==cutSnapshot(currentRecording)){refuse(409,'The saved cut changed in another page. Reload to review it before exporting.');return true;}
 }
 // The editor says which caption state it showed; export refuses if the saved state has moved on.
 const savedCaptions=captionState(currentRecording);
 if(Object.hasOwn(body,'expectedCaptions')){
  const seen=body.expectedCaptions;
  if(!seen||typeof seen.enabled!=='boolean'||seen.revision!==savedCaptions.revision||seen.enabled!==savedCaptions.enabled){refuse(409,'The captions changed in another page. Reload to review them before exporting.');return true;}
 }
 // The editor likewise says which B-roll choice it showed.
 const savedBroll=brollState(currentRecording);
 if(Object.hasOwn(body,'expectedBroll')){
  const seen=body.expectedBroll;
  if(!seen||seen.revision!==savedBroll.revision){refuse(409,'The B-roll changed in another page. Reload to review it before exporting.');return true;}
 }
 const ffmpeg=resolveFfmpeg({appRoot:root});if(!ffmpeg){refuse(503,'Run npm run setup from this app folder to restore video export. The original take is safe.');return true;}
 const inputVideo=info.sample?path.join(root,'sample',sampleStem+'.mp4'):path.join(mediaDir,`${id}.webm`);
 let inputWav=info.sample?path.join(root,'sample',sampleStem+'.wav'):path.join(mediaDir,`${id}.wav`);
 if(!info.sample&&!await ensureAudio(root,inputVideo,inputWav)){
  refuse(422,'Could not read audio from this take. The original is safe.');return true;
 }

 // B-roll is checked before anything is rendered: the clip must still be the same bytes, long enough, and inside the kept part.
 let broll;
 if(savedBroll.asset){
  try{
   const file=assetForExport(mediaDir,id,savedBroll.asset);
   const kept=keptRanges(currentRecording.cuts,currentRecording.duration);
   const checked=checkBrollRange(savedBroll,savedBroll.asset,currentRecording.duration,kept);
   if(!checked.ok){refuse(422,checked.error.replace(' Nothing was changed.',' Nothing was exported.'));return true;}
   broll={file,asset:savedBroll.asset,start:savedBroll.start,end:savedBroll.end,inPoint:savedBroll.inPoint,windows:brollWindows(kept,savedBroll)};
  }catch(error){
   if(error instanceof BrollClipError){refuse(error.status===409?409:422,error.message);return true;}
   throw error;
  }
 }
 const exportDir=path.join(dir,'exports');let staging;
 try{
  fs.mkdirSync(exportDir,{recursive:true});staging=fs.mkdtempSync(path.join(exportDir,`.${id}-`));
  const out=exportTake({inputWav,inputVideo,words:currentRecording.transcript,cuts:currentRecording.cuts.cuts,name:id,outDir:staging,appRoot:root,ffmpegPath:ffmpeg,
   ...(savedCaptions.enabled?{captions:{enabled:true,corrections:savedCaptions.corrections,tiles:body.captionTiles}}:{}),
   ...(broll?{broll}:{})});
  if(!out.outputs.video){refuse(422,'Video export failed. The original take is safe.');return true;}
  assertVideoCoversTimeline(out.outputs.video,out.keptRanges);
  // Failed rendering never replaces an already downloadable video/JSON pair.
  const published=Object.fromEntries(Object.entries(out.outputs).map(([k,v])=>[k,path.join(exportDir,path.basename(v))]));
  for(const [key,file] of Object.entries(out.outputs))fs.renameSync(file,published[key]);
  const identity=exportIdentity(exportDir,id);
  const outputs=Object.fromEntries(Object.entries(published).map(([k,v])=>[k,path.relative(root,v)]));
  answer(200,{...out,outputs,...(broll?{broll:{applied:true,windows:broll.windows}}:{}),exportIdentity:identity,downloadUrl:`/api/app/recordings/${id}/download?export=${identity}`,cutsDownloadUrl:`/api/app/recordings/${id}/download-cuts?export=${identity}`});
 }catch(error){refuse(422,error.name==='ExportRefusedError'||error instanceof CaptionExportError||error instanceof BrollClipError?error.message:'Could not export this take. The original is safe.');}
 finally{if(staging)fs.rmSync(staging,{recursive:true,force:true});}
 return true;
}
