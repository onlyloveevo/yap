// Private local-file ingestion. Analytics require a separate explicit import; media is never sent anywhere.
export async function inspectMediaFile(file){
 if(!file?.size)throw Error('Video is empty');if(file.size>1024*1024*1024)throw Error('This local proof supports files up to one GiB');
 const ext=String(file.name??'').toLowerCase().split('.').pop();if(!['mp4','webm','mov','m4v'].includes(ext))throw Error('Choose a supported MP4, WebM, MOV or M4V container; codec playback must still pass');
 const bytes=new Uint8Array(await file.slice(0,64).arrayBuffer());
 const mp4=bytes.length>=12&&String.fromCharCode(...bytes.slice(4,8))==='ftyp';const webm=bytes.length>=4&&[0x1a,0x45,0xdf,0xa3].every((n,i)=>n===bytes[i]);
 if((ext==='webm'&&!webm)||(ext!=='webm'&&!mp4))throw Error('File signature does not match the selected video container');
 return {container:webm?'webm':'mp4',mime:webm?'video/webm':'video/mp4',size:file.size,name:file.name};
}
export async function probeBrowserVideo(file,{timeout=8000}={}){
 const url=URL.createObjectURL(file);const video=document.createElement('video');video.preload='metadata';video.muted=true;
 try{return await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{clean();reject(Error('Browser video metadata timed out; codec may be unsupported'));},timeout);
 const clean=()=>{clearTimeout(timer);video.onloadedmetadata=null;video.onerror=null;};
 video.onloadedmetadata=()=>{clean();resolve({duration:video.duration,width:video.videoWidth,height:video.videoHeight});};
 video.onerror=()=>{clean();reject(Error('Browser cannot decode this video; unsupported codec or corrupt media'));};video.src=url;
 });}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
export async function importVideo(file,{probe=probeBrowserVideo,cryptoImpl=globalThis.crypto,now=new Date().toISOString()}={}){
 const info=await inspectMediaFile(file);const metadata=await probe(file);
 if(!Number.isFinite(metadata.duration)||metadata.duration<=0)throw Error('No valid finite video duration; import refused');
 const hash=Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
 return {id:`upload-${hash}`,title:info.name,name:info.name,sourceType:'local-file',importedAt:now,platform:'local',format:'unclassified',duration:metadata.duration,width:metadata.width,height:metadata.height,container:info.container,mime:info.mime,size:info.size,metrics:{},analytics:{status:'unavailable',reason:'A video file does not contain private CTR, retention reports or watch-page subscriber attribution'},transcript:{status:'unavailable',reason:'No configured transcription service. No transcript was inferred from the file.'},vision:{status:'unavailable',reason:'No configured video analysis service. No visual content claims were inferred from the file.'}};
}
export function openMediaStore(indexedDBImpl=globalThis.indexedDB){return new Promise((resolve,reject)=>{
 if(!indexedDBImpl)return reject(Error('Local media persistence unavailable'));
 const request=indexedDBImpl.open('yap-review-media-proof',1);request.onupgradeneeded=()=>request.result.createObjectStore('videos',{keyPath:'id'});
 request.onerror=()=>reject(Error('Local media persistence unavailable'));
 request.onsuccess=()=>{const db=request.result;
 const transaction=(mode,action)=>new Promise((done,fail)=>{const tx=db.transaction('videos',mode);const req=action(tx.objectStore('videos'));let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>done(result);tx.onabort=tx.onerror=()=>fail(Error('Local media persistence failed; not saved'));});
 // update(): read the latest record and write the change in ONE transaction, so a change made from stale
 // screen state (a model reply, a second tab) is merged into what is stored now and never replaces it.
 // The mutator is synchronous, gets the stored record and returns the whole next record; throwing aborts all.
 const update=(id,mutator)=>new Promise((done,fail)=>{
 let tx;let committed;let failure=null;
 try{tx=db.transaction('videos','readwrite');}catch{fail(Error('Local media persistence failed; not saved'));return;}
 const store=tx.objectStore('videos');const read=store.get(id);
 read.onsuccess=()=>{try{
 const current=read.result;if(!current||!current.file)throw Error('This video is no longer kept in this browser. Nothing was saved.');
 const next=mutator(current);
 if(!next||next.id!==id||!next.file)throw Error('The change did not keep the video. Nothing was saved.');
 if(next===current){committed=current;return;}
 store.put(next).onsuccess=()=>{committed=next;};
 }catch(e){failure=e&&e.name==='Error'?e:Error('Local media persistence failed; not saved');try{tx.abort();}catch{/* already finished */}}};
 tx.oncomplete=()=>done(committed);tx.onabort=tx.onerror=()=>fail(failure||Error('Local media persistence failed; not saved'));
 });
 resolve({put:record=>transaction('readwrite',store=>store.put(record)),update,get:id=>transaction('readonly',store=>store.get(id)),list:()=>transaction('readonly',store=>store.getAll()),close:()=>db.close()});};
});}

// Creator-supplied words are evidence, not instructions; no ASR or semantic service is implied.
export function attachCreatorEvidence(video,{transcript='',note='',time=0}={}){
 if(typeof transcript!=='string'||typeof note!=='string'||transcript.length>100000||note.length>5000)throw Error('Creator text exceeds the bounded local evidence limit');
 const result=JSON.parse(JSON.stringify(video));
 if(transcript.trim())result.transcript={status:'available',sourceType:'creator-supplied',text:transcript.trim(),timing:'unverified plain text',analysis:'unavailable; no configured semantic model'};
 if(note.trim()){
 if(!Number.isFinite(time)||time<0||time>video.duration)throw Error('Creator note timestamp must lie within this video');
 result.notes=[...(result.notes??[]),{text:note.trim(),time,sourceType:'creator-report',interpretation:'Creator interpretation; not independently confirmed'}];
 }
 return result;
}
