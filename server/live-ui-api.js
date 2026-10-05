// Separate native Live UI capture, behind app-api's own-origin checks.
// Immutable media + timing version, atomically selected by one index. Failed
// uploads never replace the previous version; incomplete files stay private.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolveDataDir,readJson,writeJsonAtomic} from '../src/node/store.js';
import {resolveFfmpeg} from '../src/node/export-file.js';
export const liveUiLimits = {maxBytes: 2 * 1024 ** 3, decodeMs: 10 * 60 * 1000};
const locks = new Set();
const bad = (status,message) => Object.assign(new Error(message),{status});
export function validateLiveUiTiming(value) {
 const valid = n => Number.isFinite(n) && n >= 0 && n <= 86400;
 if (!value || value.version !== 1 || value.source !== 'native-live-ui-display' || value.sync !== 'approximate-clean-timeline' || !valid(value.startOffsetSeconds) || !valid(value.durationSeconds) || value.durationSeconds <= 0 || !Array.isArray(value.events) || value.events.length > 1000) throw bad(400,'Invalid Live UI timing.');
 let previous = -1;
 const events = value.events.map(e => {
  if (!e || !['pause','resume'].includes(e.type) || !valid(e.cleanSeconds) || !valid(e.uiSeconds) || e.cleanSeconds < previous || e.uiSeconds > value.durationSeconds + .25) throw bad(400,'Invalid Live UI pause timing.');
  previous = e.cleanSeconds;return {type:e.type,cleanSeconds:e.cleanSeconds,uiSeconds:e.uiSeconds};
 });
 const refinements = value.refinements ?? [];
 if (!Array.isArray(refinements) || refinements.length > 1000) throw bad(400,'Invalid Live UI refinement timing.');
 let lastClean = -1, lastUi = -1;
 const marks = refinements.map(e => {
  if (!e || !['refine-start','refine-end'].includes(e.type) || !valid(e.cleanSeconds) || !valid(e.uiSeconds) || e.cleanSeconds < lastClean || e.uiSeconds < lastUi || e.uiSeconds > value.durationSeconds + .25) throw bad(400,'Invalid Live UI refinement timing.');
  lastClean = e.cleanSeconds; lastUi = e.uiSeconds;
  return {type:e.type,cleanSeconds:e.cleanSeconds,uiSeconds:e.uiSeconds};
 });
 return {version:1,source:value.source,sync:value.sync,startOffsetSeconds:value.startOffsetSeconds,durationSeconds:value.durationSeconds,events,...(value.refinements === undefined ? {} : {refinements:marks})};
}
function decode(ffmpeg,file) {
 return new Promise(resolve => {
  let finished = false, log = '';
  const child = spawn(ffmpeg,['-v','info','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe','-f','matroska','-i',file,'-map','0:v:0','-map','0:a:0','-f','null','-'],{stdio:['ignore','ignore','pipe']});
  const timer = setTimeout(()=>child.kill('SIGKILL'),liveUiLimits.decodeMs);
  child.stderr.on('data',b=>{log=(log+b.toString()).slice(-65536);});
  const done = code=>{if(finished)return;finished=true;clearTimeout(timer);resolve(code===0 && /frame=\s*[1-9]/.test(log));};
  child.once('error',()=>done(-1));child.once('close',done);
 });
}
function sendFile(req,res,file,mime,name) {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),size=fs.fstatSync(fd).size;
 let start=0,end=size-1,status=200;
 if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){fs.closeSync(fd);res.writeHead(416);res.end();return;}
  if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
  if(start>end||start>=size){fs.closeSync(fd);res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}status=206;}
 res.writeHead(status,{'Content-Type':mime,'Content-Length':end-start+1,'Content-Disposition':`attachment; filename="${name}"`,'Accept-Ranges':'bytes','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
 if(req.method==='HEAD'){fs.closeSync(fd);res.end();}else fs.createReadStream(file,{fd,autoClose:true,start,end}).on('error',()=>res.destroy()).pipe(res);
}
export async function handleLiveUiApi({req,res,rest,method,answer,refuse,recordings,root,dataDir}) {
 const m=/^recordings\/([^/]+)\/live-ui(?:\/(media|timing))?$/.exec(rest||'');if(!m)return false;
 const [,id,part]=m;if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)){req.resume();refuse(400,'Invalid recording id.');return true;}
 const {store,meta}=recordings();if(!store.load(id)){req.resume();refuse(404,'No recording has that id.');return true;}
 if(meta.load(id).sample){req.resume();if(['GET','HEAD'].includes(method)&&!part){answer(200,{saved:false});return true;}refuse(409,'Live UI capture belongs to your own recording.');return true;}
 const dir=resolveDataDir(root,path.join(resolveDataDir(root,dataDir),'live-ui',id));
 fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(path.dirname(dir)).isSymbolicLink()||fs.lstatSync(dir).isSymbolicLink())throw bad(400,'Invalid Live UI storage.');
 const index=path.join(dir,'current.json');
 const urlsFor=version=>({downloadUrl:`/api/app/recordings/${id}/live-ui/media?version=${version}`,timingUrl:`/api/app/recordings/${id}/live-ui/timing?version=${version}`});
 if(['GET','HEAD'].includes(method)) {
  if(fs.existsSync(index)&&fs.lstatSync(index).isSymbolicLink())throw bad(400,'Invalid Live UI storage.');
  const current=readJson(index,null);if(!current){if(!part){answer(200,{saved:false});return true;}refuse(404,'No Live UI recording has been saved.');return true;}
  if(!/^[a-f0-9]{24}$/.test(current.version))throw bad(500,'Invalid Live UI version.');
  if(!part){answer(200,{...urlsFor(current.version),...current});return true;}
  const versions=new URL(req.url,'http://localhost').searchParams.getAll('version');
  if(versions.length>1||(versions.length===1&&!/^[a-f0-9]{24}$/.test(versions[0]))){refuse(400,'Invalid Live UI version.');return true;}
  if(versions.length&&versions[0]!==current.version){refuse(409,'Live UI recording was replaced. Reload both download links.');return true;}
  const file=path.join(dir,current.version+(part==='media'?'.webm':'.json'));
  sendFile(req,res,file,part==='media'?'video/webm':'application/json',`YAP-${id}-Live-UI.${part==='media'?'webm':'timing.json'}`);return true;
 }
 if(method!=='PUT'||part){req.resume();refuse(405,'Method not allowed.');return true;}
 if(locks.has(dir)){req.resume();refuse(409,'Live UI save is already running.');return true;}
 locks.add(dir);
 try{
  if(!/^video\/webm(?:;|$)/i.test(req.headers['content-type']||''))throw bad(415,'Live UI recording must be WebM.');
  const raw=req.headers['x-yap-live-ui-timing'];let timing;try{timing=validateLiveUiTiming(JSON.parse(raw||''));}catch{throw bad(400,'Invalid Live UI timing.');}
  const declared=Number(req.headers['content-length']);if(Number.isFinite(declared)&&declared>liveUiLimits.maxBytes)throw bad(413,'Live UI recording exceeds the upload limit. Keep your local backup.');
  req.setTimeout?.(120000,()=>req.destroy());
  const version=randomBytes(12).toString('hex'),file=path.join(dir,version+'.part');
  const handle=await fs.promises.open(file,'wx');let size=0,head=Buffer.alloc(0);const hash=createHash('sha256');
  try{for await(const chunk of req.iterator({destroyOnReturn:false})){
   size+=chunk.length;if(size>liveUiLimits.maxBytes)throw bad(413,'Live UI recording exceeds the upload limit. Keep your local backup.');
   if(head.length<4)head=Buffer.concat([head,chunk.subarray(0,4-head.length)]);
   if(head.length===4&&head.toString('hex')!=='1a45dfa3')throw bad(400,'Live UI recording is not WebM.');
   hash.update(chunk);await handle.writeFile(chunk);
  }await handle.sync();}finally{await handle.close();}
  if(!req.complete||size<16||(Number.isFinite(declared)&&size!==declared))throw bad(400,'Live UI upload was incomplete. Keep your local backup.');
  const ffmpeg=resolveFfmpeg({appRoot:root});if(!ffmpeg||!await decode(ffmpeg,file))throw bad(422,'Live UI video and microphone could not be decoded. Previous saved video is unchanged. Keep your local backup.');
  fs.renameSync(file,path.join(dir,version+'.webm'));
  const current={version,bytes:size,sha256:hash.digest('hex'),timing};
  writeJsonAtomic(path.join(dir,version+'.json'),timing);writeJsonAtomic(index,current);
  answer(200,{...urlsFor(version),...current});
 }catch(error){req.resume();refuse(error.status||500,error.status?error.message:'Live UI save failed. Previous saved video is unchanged. Keep your local backup.');}finally{locks.delete(dir);}
 return true;
}
