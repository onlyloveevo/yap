// Capture originates here, directly from physical camera/microphone device tracks.
// There is intentionally no API accepting an arbitrary stream (page/canvas capture).
const deviceStreams = new WeakSet();
export function assertDeviceStream(stream) {
 if(!deviceStreams.has(stream)) throw new Error('Only streams acquired here from camera and microphone devices can be recorded.');
 const video=stream?.getVideoTracks?.() || [], audio=stream?.getAudioTracks?.() || [];
 if(!video.length || !audio.length) throw new Error('A camera and microphone are both required to record.');
 for(const track of [...video,...audio]) {
  const s=track.getSettings?.() || {};
  if(s.displaySurface || !s.deviceId) throw new Error('Only camera and microphone device tracks can be recorded.');
 }
 return stream;
}
export async function startCameraRecorder(options={}) {
 if('stream' in options) throw new Error('The recorder must request the camera and microphone itself.');
 const scope=options.scope || globalThis, devices=scope.navigator?.mediaDevices, Recorder=scope.MediaRecorder;
 if(!devices?.getUserMedia || !Recorder) throw new Error('Camera recording needs Chrome on localhost or HTTPS.');
 let stream;
 try {
  stream=await devices.getUserMedia({video:true,audio:true}); deviceStreams.add(stream); assertDeviceStream(stream);
  const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>Recorder.isTypeSupported(t));
  if(!mime) throw new Error('This browser does not support camera recording. Try Chrome.');
  const recorder=new Recorder(stream,{mimeType:mime});const chunks=[];
  let started=0, pausedAt=null, pausedMs=0, stopped=null, failure=null, stopPromise=null;
  const now=()=>scope.performance.now();
  const elapsed=()=>Math.max(0,((stopped ?? pausedAt ?? now())-started-pausedMs)/1000);
  recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
  recorder.onerror=e=>{failure=new Error(e.error?.message || 'The camera recorder stopped unexpectedly.');options.onError?.(failure);};
  recorder.start(250); started=now();
  return {stream,recorder,elapsed,
   pause(){if(recorder.state==='recording'){recorder.pause();pausedAt=now();}},
   resume(){if(recorder.state==='paused'){pausedMs+=now()-pausedAt;pausedAt=null;recorder.resume();}},
   release(){stream.getTracks().forEach(t=>t.stop());},
   stop(){
    if(stopPromise)return stopPromise;
    stopPromise=new Promise((resolve,reject)=>{
     stopped=pausedAt ?? now();
     recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const blob=new scope.Blob(chunks,{type:mime.split(';')[0]});if(failure)reject(failure);else if(!blob.size)reject(new Error('The camera returned no recording. Please try another take.'));else resolve({blob,duration:elapsed()});};
     if(recorder.state==='inactive')recorder.onstop();else recorder.stop();
    });return stopPromise;
   }
  };
 } catch(error) {
  stream?.getTracks().forEach(t=>t.stop());
  if(error.name==='NotAllowedError')throw new Error('Camera or microphone permission was denied. Allow both in your browser, then reload this page.');
  if(error.name==='NotFoundError')throw new Error('No camera or microphone was found. Connect both, then reload this page.');
  throw error;
 }
}
