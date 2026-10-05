// The still frame behind Return: saved footage from the finished take, never a live camera.
//
// Return shows a paused, muted frame of the take that was just recorded (or, once the completed child is
// validated, of that child). It uses the saved-media route that already exists, asks for no device and
// never plays. The frame is shown only once it has really decoded; a missing or unreadable file leaves
// the neutral background and one plain label, and the memory choices keep working.

/** The seek point for a finite clip: one second in, or the middle of a clip shorter than two seconds. */
export function seekTime(duration) {
  return Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0;
}

/** The label words for each state of the preview. */
export function previewLabel(kind, state) {
  if (state === 'unavailable') return 'Previous preview unavailable';
  if (state === 'loading') return 'Loading previous take…';
  return kind === 'completed' ? 'Completed take' : 'Previous take';
}

/** What a screen reader hears for the video: it is saved footage, paused, and not a live feed. */
export function previewAria(kind) {
  return `Saved footage from your ${kind === 'completed' ? 'completed' : 'previous'} take, paused. This is not a live camera.`;
}

/** The same-origin saved-media address of a recording id (ids are route-safe: letters, digits, hyphens). */
export const mediaPath = id => `/api/app/recordings/${encodeURIComponent(id)}/media`;

const STYLE = `
[data-yap-return-preview] .camera.is-ready{transform:none}
.preview-label{position:absolute;z-index:2;left:var(--page-pad,32px);bottom:calc(var(--bar-height,72px) + 16px);margin:0;padding:6px 12px;border-radius:999px;font-size:13px;line-height:1.2;font-weight:500;letter-spacing:.01em;color:#f5f1ea;background:rgba(16,15,14,.72);border:1px solid rgba(255,255,255,.14)}
.preview-label[data-state="unavailable"]{color:#d6d0c7}
.controls .record.has-label{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:var(--record-size,72px);padding:0 28px 0 20px;gap:12px;flex-direction:row;border-radius:999px;background:#c22b27}
.controls .record.has-label .record-label{display:block;width:auto;height:auto;border-radius:0;background:none;font-size:16px;font-weight:600;color:#fff;white-space:nowrap}
`;

/**
 * Wire the preview into a Return page.
 * @param {Document} document
 * @param {{record:HTMLElement}} hooks
 * @returns {{show(id:string, kind:'previous'|'completed'):void, state():string, target():string|null}}
 */
export function createReturnPreview(document, { record }) {
  const video = document.querySelector('[data-testid="camera"]');
  const shell = document.querySelector('.live-shell');
  if (!video || !shell) return { show() {}, state: () => 'none', target: () => null };
  shell.dataset.yapReturnPreview = '';
  const style = document.createElement('style');
  style.dataset.testid = 'return-preview-style';
  style.textContent = STYLE;
  document.head.append(style);
  // Saved footage is neither live nor playing: no autoplay, no sound, no controls.
  video.removeAttribute('autoplay');
  video.autoplay = false;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'auto';
  const label = document.createElement('p');
  label.className = 'preview-label';
  label.dataset.testid = 'preview-label';
  label.setAttribute('role', 'status');
  label.hidden = true;
  video.after(label);
  const recordLabel = record.querySelector('.record-label') || (() => {
    const span = document.createElement('b');
    span.className = 'record-label';
    span.textContent = 'Record the next take';
    record.append(span);
    return span;
  })();
  record.classList.add('has-label');
  record.setAttribute('aria-label', recordLabel.textContent);

  let current = null, token = 0, state = 'none', cleanup = () => {};
  const set = (next, kind, reason) => {
    state = next;
    video.dataset.previewState = next;
    label.dataset.state = next;
    label.textContent = previewLabel(kind, next);
    label.hidden = false;
    if (reason) video.dataset.previewError = reason; else delete video.dataset.previewError;
  };
  const fail = (mine, kind, reason) => {
    if (mine !== token) return;
    video.classList.remove('is-ready');
    video.removeAttribute('src');
    video.load();
    // The real reason stays visible to a developer; the person sees one plain line.
    console.warn(`Return preview unavailable: ${reason}`);
    set('unavailable', kind, reason);
  };
  function show(id, kind) {
    // One attempt per target: Keep, Remove and re-renders never call this again for the same take.
    if (!id || current === `${kind}:${id}`) return;
    cleanup();
    current = `${kind}:${id}`;
    const mine = ++token;
    video.classList.remove('is-ready');
    video.setAttribute('aria-label', previewAria(kind));
    set('loading', kind);
    let seeking = false, settled = false, deadline;
    const done = () => {
      clearTimeout(deadline);
      video.removeEventListener('loadeddata', onData);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const reveal = () => {
      if (settled || mine !== token) return;
      if (video.readyState < 2 || !(video.videoWidth > 0)) { settled = true; done(); return fail(mine, kind, 'the file has no decodable frame'); }
      settled = true; done(); video.pause();
      video.classList.add('is-ready');
      set('ready', kind);
    };
    const onMeta = () => {
      if (mine !== token) return;
      const at = seekTime(video.duration);
      // A recording with no stated length still shows its first frame; a finite one is sought into.
      if (at > 0) { seeking = true; video.currentTime = at; } else if (video.readyState >= 2) reveal();
    };
    const onSeeked = () => { if (seeking) reveal(); };
    const onError = () => { if (!settled) { settled = true; done(); fail(mine, kind, video.error?.message || 'the media could not be read'); } };
    const onData = () => { if (!seeking) reveal(); };
    cleanup = done;
    deadline = setTimeout(() => { if (!settled) { settled = true; done(); fail(mine, kind, 'the saved frame did not load within eight seconds'); } }, 8000);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    // With a zero seek the first frame arrives as loadeddata rather than seeked.
    video.addEventListener('loadeddata', onData, { once: true });
    video.src = mediaPath(id);
  }
  return { show, state: () => state, target: () => current };
}
