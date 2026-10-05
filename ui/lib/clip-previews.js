// Decode the saved media independently of the visible player and recorder stream.
export const MAX_PREVIEW_FRAMES = 12;
/** How many frames fit a strip of this size when each is about 16:9 at the strip's height; 0 while the size is unknown. */
export function frameCountFor(width, height, cap = MAX_PREVIEW_FRAMES) {
 if (!(width > 0 && height > 0)) return 0;
 return Math.max(1, Math.min(cap, Math.round(width / (height * 16 / 9))));
}
export function previewTimes(clip, duration, count = 3) {
 const end = Math.min(Number(clip.end), Number(duration));
 const start = Math.max(0, Number(clip.start));
 if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
 const n = Math.max(1, Math.min(MAX_PREVIEW_FRAMES, Math.floor(count) || 1));
 return Array.from({length:n}, (_, i) => start + (end - start) * (i + .5) / n);
}
function waitFor(video, event, action) {
 return new Promise((resolve, reject) => {
  const finish = error => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); error ? reject(error) : resolve(); };
  const done = () => finish(), failed = () => finish(new Error('Saved video frames unavailable'));
  const timer = setTimeout(() => finish(new Error('Saved video preview timed out')), 10000);
  video.addEventListener(event, done, {once:true}); video.addEventListener('error', failed, {once:true});
  try { action(); } catch (error) { finish(error); }
 });
}
export function createClipPreviews(src, duration, doc = document) {
 const video = doc.createElement('video');
 video.muted = true; video.playsInline = true; video.preload = 'auto';
 const ready = waitFor(video, 'loadeddata', () => { video.src = src; video.load(); });
 // Register immediately: an unavailable source must not create an unhandled rejection.
 ready.catch(() => {});
 const cache = new Map(); let queue = Promise.resolve(), disposed = false;
 return {
  frames(clip, count = 3) {
   const times = previewTimes(clip, duration, count), key = times.join(',');
   if (!cache.has(key)) {
    const job = queue.then(async () => {
     await ready;
     const results = [];
     for (const at of times) {
      if (disposed) throw new Error('Preview decoder closed');
      const time = Number.isFinite(video.duration) ? Math.min(at, Math.max(0, video.duration - .001)) : at;
      if (Math.abs(video.currentTime - time) > .0001) await waitFor(video, 'seeked', () => { video.currentTime = time; });
      if (!video.videoWidth || video.readyState < 2) throw new Error('No decoded video frame');
      const canvas = doc.createElement('canvas'); canvas.width = 320; canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      results.push({time, url:canvas.toDataURL('image/jpeg', .86)});
     }
     return results;
    });
    cache.set(key, job); queue = job.catch(() => {});
   }
   return cache.get(key);
  },
  dispose() { disposed = true; video.pause(); video.removeAttribute('src'); video.load(); cache.clear(); }
 };
}
// `count` omitted or 'auto': the number of frames comes from the tile's real size, measured once it is laid out (next frame).
export function attachClipPreviews(tile, clip, decoder, count = 'auto') {
 const strip = tile.ownerDocument.createElement('span');
 strip.dataset.testid = 'clip-previews'; strip.dataset.state = 'loading';
 strip.style.cssText = 'position:absolute;inset:0;display:flex;overflow:hidden;border-radius:inherit;pointer-events:none;background:#171311;color:#d9d1c7;font-size:11px;align-items:center;justify-content:center';
 strip.textContent = 'Loading video preview…'; tile.prepend(strip);
 const view = tile.ownerDocument.defaultView;
 const ready = count !== 'auto' ? Promise.resolve(Math.floor(count) || 1) : new Promise(resolve => {
  let tries = 0;
  const measure = () => {
   const n = frameCountFor(tile.clientWidth, tile.clientHeight);
   if (n) return resolve(n);
   // Not laid out yet: ask again next frame. A tile that never gets a size (or no animation frames) gets one frame, never a made-up row.
   if (++tries > 30 || !tile.isConnected && tries > 3 || typeof view?.requestAnimationFrame !== 'function') return resolve(1);
   view.requestAnimationFrame(measure);
  };
  typeof view?.requestAnimationFrame === 'function' ? view.requestAnimationFrame(measure) : measure();
 });
 ready.then(n => decoder.frames(clip, n)).then(frames => {
  if (!tile.isConnected) return;
  if (!frames.length) throw new Error('No frames in clip');
  strip.replaceChildren(); strip.dataset.state = 'ready';
  for (const frame of frames) {
   const img = tile.ownerDocument.createElement('img'); img.src = frame.url;
   img.alt = `Frame from this recording at ${frame.time.toFixed(1)} seconds`;
   img.dataset.time = String(frame.time); img.style.cssText = 'height:100%;min-width:0;width:0;flex:1;object-fit:contain'; strip.append(img);
  }
 }).catch(() => {
  if (!tile.isConnected) return;
  strip.dataset.state = 'unavailable'; strip.textContent = 'Video preview unavailable';
  tile.title = `${tile.title ? tile.title + ' ' : ''}Frames from this saved video could not be loaded.`;
 });
}
