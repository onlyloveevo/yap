// Explicit screen presentation capture: the one exception to "device tracks only".
//
// This module is reached only from the Start screen presentation button on
// /record/:id?presentation=1. It asks the browser for a screen, window or tab
// (the browser's own picker is the person's permission), then records one
// composed 1280x720 canvas plus the microphone. The camera recorder in
// recorder.js is untouched and still refuses anything but camera and
// microphone devices.
//
// The composition (full camera, or camera bubble over the screen) is drawn here,
// so a mode switch is burned into the saved video. Page chrome, cues and beats
// are never drawn: only the screen, the camera and the bubble ring.

export const OUTPUT = Object.freeze({width: 1280, height: 720, fps: 30});
export const BUBBLE = Object.freeze({diameter: 240, margin: 32, ring: 4});
export const MODES = Object.freeze(['bubble', 'full']);
export const TRANSITION_MS = 240;
const BACKDROP = '#0d0a09';
const FIRST_FRAME_MS = 6000;

export class PresentationError extends Error {
 constructor(code, message) {super(message);this.name = 'PresentationError';this.code = code;}
}

const clamp01 = n => Math.min(1, Math.max(0, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);

/** Largest rectangle of aspect srcW:srcH that fits inside the box, centred. Nothing is stretched. */
export function containRect(srcW, srcH, box) {
 const scale = Math.min(box.w / srcW, box.h / srcH), w = srcW * scale, h = srcH * scale;
 return {x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h};
}

/** The part of a srcW x srcH picture that fills dstW x dstH without stretching (centre crop). */
export function coverCrop(srcW, srcH, dstW, dstH) {
 const src = srcW / srcH, dst = dstW / dstH;
 if (src > dst) {const sw = srcH * dst;return {sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH};}
 const sh = srcW / dst;
 return {sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh};
}

export function bubbleRect(out = OUTPUT) {
 return {x: out.width - BUBBLE.margin - BUBBLE.diameter, y: out.height - BUBBLE.margin - BUBBLE.diameter, w: BUBBLE.diameter, h: BUBBLE.diameter};
}

/**
 * Where everything is drawn. `progress` is 0 for the bubble layout and 1 for
 * full camera; in between the camera grows from the bubble to the whole frame.
 * The screen is never mirrored and keeps its own aspect ratio (fitted, not cropped).
 */
export function compositeLayout({progress = 0, screen = null, camera, out = OUTPUT}) {
 const t = clamp01(progress), full = {x: 0, y: 0, w: out.width, h: out.height}, b = bubbleRect(out);
 const rect = {x: lerp(b.x, full.x, t), y: lerp(b.y, full.y, t), w: lerp(b.w, full.w, t), h: lerp(b.h, full.h, t)};
 const radius = lerp(b.w / 2, 0, t);
 const crop = camera?.w > 0 && camera?.h > 0 ? coverCrop(camera.w, camera.h, rect.w, rect.h) : null;
 return {
  screen: t >= 1 || !(screen?.w > 0 && screen?.h > 0) ? null : containRect(screen.w, screen.h, full),
  camera: {...rect, radius, crop},
  ring: t < 1,
  mirrored: false
 };
}

const videoReady = v => Boolean(v) && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;

function pathRounded(ctx, r, radius) {
 ctx.beginPath();
 if (radius <= 0.5) {ctx.rect(r.x, r.y, r.w, r.h);return;}
 ctx.moveTo(r.x + radius, r.y);
 ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, radius);
 ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, radius);
 ctx.arcTo(r.x, r.y + r.h, r.x, r.y, radius);
 ctx.arcTo(r.x, r.y, r.x + r.w, r.y, radius);
 ctx.closePath();
}

/** Draw one composed frame. Videos that have no valid frame yet are skipped, so the previous frame is held. */
export function drawComposite(ctx, {screenVideo, cameraVideo, progress, out = OUTPUT}) {
 const screenOk = videoReady(screenVideo), cameraOk = videoReady(cameraVideo);
 const layout = compositeLayout({progress, screen: screenOk ? {w: screenVideo.videoWidth, h: screenVideo.videoHeight} : null, camera: cameraOk ? {w: cameraVideo.videoWidth, h: cameraVideo.videoHeight} : null, out});
 if (!screenOk && !cameraOk) return {drawn: false, layout};
 // A source without a valid frame holds the last frame already on the canvas; it never paints black over it.
 if (progress < 1 ? !(screenOk && cameraOk) : !cameraOk) return {drawn: false, layout, held: true};
 ctx.save();
 ctx.fillStyle = BACKDROP;ctx.fillRect(0, 0, out.width, out.height);
 if (layout.screen) ctx.drawImage(screenVideo, layout.screen.x, layout.screen.y, layout.screen.w, layout.screen.h);
 if (cameraOk && layout.camera.crop) {
  const c = layout.camera, k = c.crop;
  if (layout.ring) {ctx.shadowColor = 'rgba(0,0,0,.45)';ctx.shadowBlur = 18;ctx.shadowOffsetY = 4;ctx.fillStyle = BACKDROP;pathRounded(ctx, c, c.radius);ctx.fill();ctx.shadowColor = 'transparent';}
  ctx.save();pathRounded(ctx, c, c.radius);ctx.clip();
  ctx.drawImage(cameraVideo, k.sx, k.sy, k.sw, k.sh, c.x, c.y, c.w, c.h);
  ctx.restore();
  if (layout.ring) {ctx.lineWidth = BUBBLE.ring;ctx.strokeStyle = '#ffffff';pathRounded(ctx, {x: c.x + BUBBLE.ring / 2, y: c.y + BUBBLE.ring / 2, w: c.w - BUBBLE.ring, h: c.h - BUBBLE.ring}, c.radius - BUBBLE.ring / 2);ctx.stroke();}
 }
 ctx.restore();
 return {drawn: true, layout};
}

/**
 * A ticker that keeps going while this tab is hidden behind the presented
 * window. Timers in a hidden page are slowed to about one a second, so the tick
 * comes from a small worker (its timers are not slowed); where a worker cannot
 * be made it falls back to setInterval, and while the tab is visible
 * requestAnimationFrame adds smooth frames. stop() ends all three.
 */
export function createTicker(scope, fn, intervalMs = Math.round(1000 / OUTPUT.fps)) {
 let worker = null, url = null, timer = null, raf = null, stopped = false;
 const tick = () => {if(!stopped)fn();};
 try {
  if (scope.Worker && scope.Blob && scope.URL?.createObjectURL) {
   url = scope.URL.createObjectURL(new scope.Blob([`let t=setInterval(()=>postMessage(0),${intervalMs});onmessage=()=>{clearInterval(t);close();};`], {type: 'text/javascript'}));
   worker = new scope.Worker(url);worker.onmessage = tick;worker.onerror = () => {worker?.terminate();worker = null;if(!stopped&&!timer)timer = scope.setInterval(tick, intervalMs);};
  }
 } catch {worker = null;}
 if (!worker) timer = scope.setInterval(tick, intervalMs);
 const frame = () => {if(stopped)return;tick();raf = scope.requestAnimationFrame?.(frame) ?? null;};
 if (scope.requestAnimationFrame && scope.document?.visibilityState !== 'hidden') raf = scope.requestAnimationFrame(frame);
 scope.document?.addEventListener?.('visibilitychange', onVisible);
 function onVisible() {if(stopped||!scope.requestAnimationFrame)return;if(scope.document.visibilityState==='visible'&&raf===null)raf = scope.requestAnimationFrame(frame);}
 return {
  stop() {
   if (stopped) return;stopped = true;
   try {worker?.postMessage('stop');worker?.terminate();} catch {}
   if (url) scope.URL.revokeObjectURL(url);
   if (timer) scope.clearInterval(timer);
   if (raf !== null) scope.cancelAnimationFrame?.(raf);
   scope.document?.removeEventListener?.('visibilitychange', onVisible);
  },
  get usesWorker() {return Boolean(worker);}
 };
}

function failureFor(error, stage) {
 const name = error?.name;
 if (error instanceof PresentationError) return error;
 if (stage === 'screen') {
  if (name === 'NotAllowedError' || name === 'AbortError') return new PresentationError('screen-cancelled', 'No screen was shared. Choose a window or tab to present, then press Start again.');
  if (name === 'NotFoundError') return new PresentationError('screen-unavailable', 'There was no screen, window or tab to share. Open what you want to present, then try again.');
  return new PresentationError('screen-unavailable', 'This browser could not share the screen. Try Chrome, then press Start again.');
 }
 if (name === 'NotAllowedError') return new PresentationError('camera-denied', 'Camera or microphone permission was denied. Allow both in your browser, then press Start again.');
 if (name === 'NotFoundError') return new PresentationError('camera-missing', 'No camera or microphone was found. Connect both, then press Start again.');
 return error instanceof Error ? error : new PresentationError('failed', String(error));
}

function stopTracks(...streams) {for(const s of streams)s?.getTracks?.().forEach(t=>{try{t.stop();}catch{}});}

function waitFirstFrame(scope, video, ms = FIRST_FRAME_MS) {
 return new Promise((resolve, reject) => {
  const started = scope.performance.now();let timer = null;
  const done = ok => {scope.clearInterval(timer);video.removeEventListener?.('loadeddata', check);ok ? resolve() : reject(new PresentationError('first-frame', 'The camera or screen did not produce a picture. Try again, or choose another window.'));};
  const check = () => {if(videoReady(video))done(true);else if(scope.performance.now() - started > ms)done(false);};
  video.addEventListener?.('loadeddata', check);
  timer = scope.setInterval(check, 40);check();
 });
}

function makeVideo(scope, track, holder) {
 const v = scope.document.createElement('video');
 v.muted = true;v.playsInline = true;v.autoplay = true;v.setAttribute?.('aria-hidden', 'true');
 v.srcObject = new scope.MediaStream([track]);
 holder.append(v);
 const played = v.play?.();played?.catch?.(() => {});
 return v;
}

/**
 * Start a screen presentation recording. Call it directly from the click of the
 * Start button: getDisplayMedia is invoked before anything is awaited, so the
 * browser sees the person's gesture. Resolves with the same recorder interface
 * as startCameraRecorder (stream, elapsed, pause, resume, release, stop) plus the
 * presentation controls (mode, setMode, preview, replaceScreen).
 */
export function startScreenPresentationRecorder(options = {}) {
 if ('stream' in options) return Promise.reject(new Error('The recorder must request the screen, camera and microphone itself.'));
 const scope = options.scope || globalThis, devices = scope.navigator?.mediaDevices, Recorder = scope.MediaRecorder;
 if (!devices?.getDisplayMedia || !devices?.getUserMedia || !Recorder || !scope.document?.createElement || !scope.MediaStream) {
  return Promise.reject(new PresentationError('unsupported', 'Screen presentation recording needs Chrome on localhost or HTTPS. Your camera-only recording still works.'));
 }
 const displayRequest = displayMedia(devices);
 return build(displayRequest);

 function displayMedia(d) {
  // The browser's own picker follows; selfBrowserSurface keeps this recorder tab out of it so it cannot record itself.
  return d.getDisplayMedia({video: {frameRate: {ideal: OUTPUT.fps}}, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false});
 }

 async function build(request) {
  let screenStream = null, camStream = null, canvasStream = null, holder = null, ticker = null;
  const cleanup = () => {ticker?.stop();stopTracks(screenStream, camStream, canvasStream);holder?.remove();};
  try {
   try {screenStream = await request;} catch (error) {throw failureFor(error, 'screen');}
   const screenTrack = screenStream.getVideoTracks?.()[0];
   if (!screenTrack) throw new PresentationError('screen-unavailable', 'The browser did not give a picture of the screen. Try again.');
   try {camStream = await devices.getUserMedia({video: {width: {ideal: OUTPUT.width}, height: {ideal: OUTPUT.height}}, audio: true});} catch (error) {throw failureFor(error, 'camera');}
   const camTrack = camStream.getVideoTracks?.()[0], micTrack = camStream.getAudioTracks?.()[0];
   if (!camTrack || !micTrack) throw new PresentationError('camera-missing', 'A camera and microphone are both required to record.');
   const cs = camTrack.getSettings?.() || {}, ms = micTrack.getSettings?.() || {};
   if (cs.displaySurface || ms.displaySurface || !cs.deviceId || !ms.deviceId) throw new PresentationError('camera-missing', 'The camera and microphone must be real devices.');
   const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => Recorder.isTypeSupported(t));
   if (!mime) throw new PresentationError('recorder-unsupported', 'This browser does not support recording. Try Chrome.');

   const doc = scope.document;
   holder = doc.createElement('div');holder.setAttribute('aria-hidden', 'true');holder.dataset.testid = 'presentation-sources';
   Object.assign(holder.style, {position: 'fixed', right: '0', bottom: '0', width: '2px', height: '2px', overflow: 'hidden', opacity: '0', pointerEvents: 'none'});
   doc.body.append(holder);
   let screenVideo = makeVideo(scope, screenTrack, holder);const cameraVideo = makeVideo(scope, camTrack, holder);
   await Promise.all([waitFirstFrame(scope, screenVideo), waitFirstFrame(scope, cameraVideo)]);

   const canvas = doc.createElement('canvas');canvas.width = OUTPUT.width;canvas.height = OUTPUT.height;
   const ctx = canvas.getContext('2d', {alpha: false});
   let from = 0, to = 0, switchedAt = -Infinity, held = 0, drawn = 0, lastDraw = -Infinity;
   const progress = () => {const t = clamp01((scope.performance.now() - switchedAt) / TRANSITION_MS);return lerp(from, to, ease(t));};
   const draw = (force = false) => {
    const now = scope.performance.now();if (!force && now - lastDraw < 25) return;lastDraw = now;
    try {const r = drawComposite(ctx, {screenVideo, cameraVideo, progress: progress()});if (r.drawn) drawn++;else held++;} catch {held++;}
   };
   draw(true);
   if (!drawn) throw new PresentationError('first-frame', 'The first picture could not be drawn. Try again.');
   canvasStream = canvas.captureStream(OUTPUT.fps);const canvasTrack = canvasStream.getVideoTracks()[0];
   const stream = new scope.MediaStream([canvasTrack, micTrack]), preview = new scope.MediaStream([canvasTrack]);
   const recorder = new Recorder(stream, {mimeType: mime, videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000});
   const chunks = [];
   let started = 0, pausedAt = null, pausedMs = 0, stopped = null, failure = null, stopPromise = null, released = false, screenLive = true, mode = 'bubble';
   const now = () => scope.performance.now();
   const elapsed = () => Math.max(0, ((stopped ?? pausedAt ?? now()) - started - pausedMs) / 1000);
   recorder.ondataavailable = e => {if (e.data?.size) chunks.push(e.data);};
   recorder.onerror = e => {failure = new Error(e.error?.message || 'The presentation recorder stopped unexpectedly.');options.onError?.(failure);};
   const pause = () => {if (recorder.state === 'recording') {recorder.pause();pausedAt = now();}};
   const resume = () => {if (recorder.state === 'paused') {pausedMs += now() - pausedAt;pausedAt = null;recorder.resume();}};
   const release = () => {if (released) return;released = true;ticker?.stop();stopTracks(screenStream, camStream, canvasStream);holder?.remove();};
   const watch = (track, reason) => track.addEventListener?.('ended', () => {
    if (released || stopPromise) return;
    if (reason === 'screen') {screenLive = false;pause();}
    options.onEnded?.({reason});
   });
   watch(screenTrack, 'screen');watch(camTrack, 'camera');watch(micTrack, 'microphone');

   ticker = createTicker(scope, () => draw());
   recorder.start(250);started = now();
   return {
    stream, preview, recorder, elapsed, pause, resume, release,
    audioSource: 'microphone',
    screenLabel: screenTrack.label || 'the shared screen',
    mode: () => mode,
    setMode(next) {
     if (!MODES.includes(next)) throw new Error('Choose bubble or full camera.');
     if (next === mode) return mode;
     from = progress();mode = next;to = next === 'full' ? 1 : 0;switchedAt = now();draw(true);
     return mode;
    },
    needsScreen: () => !screenLive,
    // Call from the click of a button: it opens the browser's picker again for the same take.
    replaceScreen() {
     if (released || stopPromise) return Promise.reject(new PresentationError('stopped', 'This recording has already stopped.'));
     const request = displayMedia(devices);
     return (async () => {
      let next;
      try {next = await request;} catch (error) {throw failureFor(error, 'screen');}
      const track = next.getVideoTracks?.()[0];
      if (!track || released || stopPromise) {stopTracks(next);throw new PresentationError('screen-unavailable', 'The browser did not give a picture of the screen. Try again.');}
      const video = makeVideo(scope, track, holder);
      try {await waitFirstFrame(scope, video);} catch (error) {stopTracks(next);video.remove();throw error;}
      stopTracks(screenStream);screenVideo.remove();screenStream = next;screenVideo = video;screenLive = true;watch(track, 'screen');
      this.screenLabel = track.label || 'the shared screen';draw(true);
     })();
    },
    stats: () => ({drawn, held, worker: ticker.usesWorker}),
    stop() {
     if (stopPromise) return stopPromise;
     stopPromise = new Promise((resolve, reject) => {
      stopped = pausedAt ?? now();
      recorder.onstop = () => {
       const blob = new scope.Blob(chunks, {type: mime.split(';')[0]});
       release();
       if (failure) reject(failure);
       else if (!blob.size) reject(new Error('The presentation recording was empty. Please try another take.'));
       else resolve({blob, duration: elapsed()});
      };
      if (recorder.state === 'inactive') recorder.onstop();else recorder.stop();
     });
     return stopPromise;
    }
   };
  } catch (error) {
   cleanup();
   throw failureFor(error, 'camera');
  }
 }
}
