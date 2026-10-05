// The B-roll preview: the clip's picture laid over the camera picture while the original recording keeps playing.
//
// The primary player is the only clock. This file never plays on its own: it reads the primary player's time, and the
// clip follows it (seek, play, pause, speed). The clip is muted, so the original narration is the only sound.
//
// It shows the clip only when the clip really has a picture for this moment (the same arithmetic Export uses,
// `brollClipTime`); if the clip is still loading or has run out, the camera picture stays, never black.
//
// The overlay sits exactly on the picture the primary player occupies, cropped to fill it the way Export crops it.

import { brollClipTime } from '../../src/engine/broll-plan.js';

/**
 * @param {{ document: Document, player: HTMLVideoElement }} options
 */
export function createBrollPreview({ document: doc, player }) {
  const frame = doc.createElement('div');
  frame.className = 'broll-frame';
  frame.dataset.testid = 'broll-preview';
  frame.dataset.state = 'off';
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  const clip = doc.createElement('video');
  clip.muted = true;
  clip.defaultMuted = true;
  clip.playsInline = true;
  clip.preload = 'auto';
  clip.tabIndex = -1;
  clip.dataset.testid = 'broll-preview-video';
  frame.append(clip);
  player.parentElement.insertBefore(frame, player.nextSibling);

  let range = null; // { start, end, inPoint } or null
  let url = '';
  let raf = 0;

  /** Put the frame on the picture the primary player really occupies. */
  function place() {
    // The primary video fills the inside of its box (inset 0), so its own client size is the room the picture has.
    const box = { width: player.clientWidth, height: player.clientHeight };
    const vw = player.videoWidth;
    const vh = player.videoHeight;
    if (!box.width || !box.height || !vw || !vh) return;
    // The editor's player fills its frame (cover); the clip then fills the same frame. Fullscreen shows the whole picture (contain).
    const host = frame.parentElement;
    if (doc.defaultView.getComputedStyle(player).objectFit === 'cover' && host) {
      Object.assign(frame.style, { left: '0px', top: '0px', width: `${host.clientWidth}px`, height: `${host.clientHeight}px` });
      return;
    }
    const scale = Math.min(box.width / vw, box.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    Object.assign(frame.style, { left: `${(box.width - w) / 2}px`, top: `${(box.height - h) / 2}px`, width: `${w}px`, height: `${h}px` });
  }

  function sync() {
    const t = player.currentTime || 0;
    const want = range ? brollClipTime({ asset: {}, ...range }, t) : null;
    const ready = want !== null && clip.readyState >= 2 && (!Number.isFinite(clip.duration) || want < clip.duration - 0.02);
    if (want === null || !url) {
      frame.hidden = true;
      frame.dataset.state = 'off';
      if (!clip.paused) clip.pause();
      return;
    }
    place();
    const drift = Math.abs(clip.currentTime - want);
    if (player.paused) {
      if (!clip.paused) clip.pause();
      if (drift > 0.04 && clip.readyState >= 1) clip.currentTime = want;
    } else {
      clip.playbackRate = player.playbackRate;
      if (drift > 0.25 && clip.readyState >= 1) clip.currentTime = want;
      if (clip.paused && clip.readyState >= 2) clip.play().catch(() => {});
    }
    frame.hidden = !ready;
    frame.dataset.state = ready ? 'showing' : 'loading';
  }

  function loop() {
    sync();
    raf = player.paused ? 0 : requestAnimationFrame(loop);
  }
  const kick = () => { sync(); if (!raf && !player.paused) raf = requestAnimationFrame(loop); };
  for (const name of ['timeupdate', 'seeked', 'seeking', 'play', 'playing', 'pause', 'ratechange', 'loadedmetadata', 'ended']) player.addEventListener(name, kick);
  for (const name of ['loadeddata', 'canplay', 'seeked', 'error']) clip.addEventListener(name, sync);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { place(); sync(); }) : null;
  observer?.observe(player.parentElement);

  return {
    element: frame,
    clip,
    /** Show this clip over this range (original recording seconds), or nothing when `next` is null. */
    set(next) {
      const nextUrl = next ? next.url : '';
      if (nextUrl !== url) {
        url = nextUrl;
        if (url) { clip.src = url; clip.load(); } else { clip.pause(); clip.removeAttribute('src'); clip.load(); }
      }
      range = next && Number.isFinite(next.start) && Number.isFinite(next.end) && next.end > next.start && Number.isFinite(next.inPoint) && next.inPoint >= 0
        ? { start: next.start, end: next.end, inPoint: next.inPoint } : null;
      sync();
    },
    sync,
    /** What the preview is doing now, for the page and for tests. */
    status() {
      return { state: frame.dataset.state, clipTime: clip.currentTime, range };
    },
    dispose() { observer?.disconnect(); if (raf) cancelAnimationFrame(raf); frame.remove(); },
  };
}
