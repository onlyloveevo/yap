// Optional second, native display capture. Constructing this controller requests nothing.
// Call start only from the explicit Record Live UI too button; primary owns its tracks.
export function createLiveUiRecorder({primary, scope = globalThis, onState = () => {}}) {
 let recorder, display, mic, output, stopped, retained = null, saving = false, starting = false, closed = false;
 let started = 0, pausedAt = null, pausedMs = 0, offset = 0, failure = null;
 const events = [], chunks = [], refinements = [];
 const now = () => scope.performance.now();
 const cleanTime = () => Number(primary.elapsed());
 const unload = e => { if (recorder?.state !== 'inactive' || retained) {e.preventDefault();e.returnValue = '';} };
 const release = () => {display?.getTracks().forEach(t => t.stop());mic?.stop();};
 const duration = () => Math.max(0, ((pausedAt ?? now()) - started - pausedMs) / 1000);
 function stop() {
  closed = true;
  if (stopped) return stopped;
  if (!recorder) return Promise.resolve(null);
  stopped = new Promise(resolve => {
   const endDuration = duration();
   const done = () => {
    const blob = new scope.Blob(chunks, {type: 'video/webm'});
    retained = {blob, timing: {version: 1, source: 'native-live-ui-display', startOffsetSeconds: offset, durationSeconds: endDuration, sync: 'approximate-clean-timeline', events: [...events], ...(refinements.length ? {refinements: [...refinements]} : {})}, error: failure?.message || null};
    release(); onState('stopped', retained); resolve(retained);
   };
   recorder.addEventListener('stop', done, {once: true});
   if (recorder.state === 'inactive') done(); else recorder.stop();
  });
  return stopped;
 }
 const controller = {
  async start() {
   if (closed || recorder || display || starting) throw new Error('Live UI recording has already started.');
   const source = primary.stream?.getAudioTracks()[0];
   if (!source || source.readyState !== 'live') throw new Error('Start the clean recording with its microphone first.');
   if (scope.navigator.userActivation && !scope.navigator.userActivation.isActive) throw new Error('Press Record Live UI too to choose this tab.');
   const devices = scope.navigator.mediaDevices;
   if (!devices?.getDisplayMedia || !scope.MediaRecorder) throw new Error('This browser cannot record a shared tab. The clean recording continues.');
   // This call remains before the first await: native transient user activation is preserved.
   starting = true;
   try {
    const request = devices.getDisplayMedia({video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude'});
    display = await request;
    if (closed || source.readyState !== 'live') throw new Error('The clean take ended before Live UI capture could start.');
    const video = display.getVideoTracks()[0];
    if (!video || video.readyState !== 'live') throw new Error('No Live UI picture was selected.');
    mic = source.clone();
    output = new scope.MediaStream([video, mic]);
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find(t => scope.MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('This browser cannot save a WebM UI recording.');
    recorder = new scope.MediaRecorder(output, {mimeType: mime});
    recorder.addEventListener('dataavailable', e => {if (e.data.size) chunks.push(e.data);});
    recorder.addEventListener('error', e => {failure = e.error || new Error('Live UI capture failed.');stop();});
    video.addEventListener('ended', stop, {once: true});
    mic.addEventListener('ended', stop, {once: true});
    offset = cleanTime();
    if (!Number.isFinite(offset) || offset < 0) throw new Error('The clean recording clock is unavailable.');
    recorder.start(250); started = now();
    scope.addEventListener?.('beforeunload', unload);onState('recording');return controller;
   } catch (error) {release();display = null;mic = null;recorder = null;throw error;} finally {starting = false;}
  },
  pause() {if (recorder?.state === 'recording') {recorder.pause();pausedAt = now();events.push({type: 'pause', cleanSeconds: cleanTime(), uiSeconds: duration()});onState('paused');}},
  resume() {if (recorder?.state === 'paused') {pausedMs += now() - pausedAt;pausedAt = null;recorder.resume();events.push({type: 'resume', cleanSeconds: cleanTime(), uiSeconds: duration()});onState('recording');}},
  // A refinement discussion: the clean take is paused but this recording keeps running, so the fixed start offset no longer
  // holds after it. These marks (clean second, this file's own second) say where the two files diverge.
  refine(phase) {if (recorder && ['start', 'end'].includes(phase)) refinements.push({type: `refine-${phase}`, cleanSeconds: cleanTime(), uiSeconds: duration()});},
  uiSeconds: () => duration(),
  stop,
  get result() {return retained;},
  get state() {return starting ? 'starting' : recorder?.state || 'idle';},
  async save(id) {
   if (saving) throw new Error('Live UI save is already running.');
   if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid recording id.');
   const result = await stop();
   if (!result?.blob.size) throw new Error('No Live UI recording was captured.');
   saving = true;onState('saving');
   try {
    const response = await scope.fetch(`/api/app/recordings/${id}/live-ui`, {method: 'PUT', headers: {'Content-Type': 'video/webm', 'X-Yap-Live-Ui-Timing': JSON.stringify(result.timing)}, body: result.blob});
    const body = await response.json();
    if (!response.ok || !body.downloadUrl || !body.timingUrl) throw new Error(body.error || 'Live UI video was not saved.');
    retained = null;scope.removeEventListener?.('beforeunload', unload);onState('saved', body);return body;
   } catch (error) {onState('save-failed', {error, result:retained});throw error;} finally {saving = false;}
  },
  // Caller supplies download links while result remains retained, including after failed saves.
  backupUrls() {
   if (!retained) return null;
   return {video: scope.URL.createObjectURL(retained.blob), timing: scope.URL.createObjectURL(new scope.Blob([JSON.stringify(retained.timing,null,2)], {type:'application/json'}))};
  },
  acknowledgeBackup() {retained = null;scope.removeEventListener?.('beforeunload', unload);}
 };
 return controller;
}
