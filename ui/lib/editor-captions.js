// Captions in the editor: one drawing of a cue, used twice. The preview shows
// that drawing over the video, and Export sends the same drawing, as a PNG, for
// the server to lay over the exported MP4. So the words, the place and the look
// in the preview are what the file has.
//
// The drawing is pixels only. Caption text is never put into HTML as markup,
// and never leaves this page except as the picture and as plain text the server
// checks against its own copy of the cue.

import { CAPTION_TILE, layoutCaption } from '../../src/engine/caption-model.js';

/** Draw one cue's tile onto `canvas` (CAPTION_TILE.width x CAPTION_TILE.height, transparent where there is no caption). */
export function drawCaptionTile(canvas, text) {
  const T = CAPTION_TILE;
  canvas.width = T.width;
  canvas.height = T.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, T.width, T.height);
  const measure = (line, px) => { ctx.font = `500 ${px}px ${T.fontFamily}`; return ctx.measureText(line).width; };
  const { lines, fontPx } = layoutCaption(text, measure);
  ctx.font = `500 ${fontPx}px ${T.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lineHeight = Math.round(fontPx * 1.24);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = Math.round(fontPx * 0.55);
  const padY = Math.round(fontPx * 0.32);
  const boxW = Math.min(T.width - 32, Math.ceil(widest + padX * 2));
  const boxH = lines.length * lineHeight + padY * 2;
  const boxX = Math.round((T.width - boxW) / 2);
  const boxY = T.height - T.bottomMargin - boxH;
  ctx.fillStyle = T.backing;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(boxX, boxY, boxW, boxH, Math.round(fontPx * 0.4));
  else ctx.rect(boxX, boxY, boxW, boxH);
  ctx.fill();
  ctx.fillStyle = T.hairline;
  ctx.fillRect(Math.round(T.width / 2 - fontPx * 0.5), boxY + boxH - Math.round(padY * 0.55), Math.round(fontPx), 2);
  ctx.fillStyle = T.color;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  lines.forEach((line, k) => ctx.fillText(line, T.width / 2, boxY + padY + Math.round(fontPx * 0.86) + k * lineHeight - Math.round(padY * 0.15)));
  ctx.shadowColor = 'transparent';
  return { lines, fontPx };
}

/** The PNG of one cue as base64, drawn by the same function the preview uses. */
export async function captionTilePng(doc, text) {
  const canvas = doc.createElement('canvas');
  drawCaptionTile(canvas, text);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The caption picture could not be made.'))), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return doc.defaultView.btoa(binary);
}

/** One picture per cue, ready for Export: `[{ id, text, png }]`. Pictures that are the same are drawn once. */
export async function captionTilesFor(doc, cues) {
  const made = new Map();
  const tiles = [];
  for (const cue of cues) {
    if (!made.has(cue.text)) made.set(cue.text, await captionTilePng(doc, cue.text));
    tiles.push({ id: cue.id, text: cue.text, png: made.get(cue.text) });
  }
  return tiles;
}

/**
 * The caption overlay on the player: a canvas sized to the picture the video
 * really occupies (so a recording that is not 16:9 still gets its captions on
 * the picture), and a visually hidden copy of the words for screen readers.
 */
export function createCaptionOverlay({ document: doc, player, video }) {
  const box = doc.createElement('div');
  box.className = 'cap-overlay';
  box.dataset.testid = 'caption-overlay';
  box.hidden = true;
  const canvas = doc.createElement('canvas');
  canvas.className = 'cap-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const text = doc.createElement('span');
  text.className = 'sr-only';
  text.dataset.testid = 'caption-text';
  box.append(canvas, text);
  player.append(box);
  let shownText = null;

  function place() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const pw = player.clientWidth;
    const ph = player.clientHeight;
    if (!w || !h || !pw || !ph) { Object.assign(box.style, { left: '0', top: '0', width: '100%', height: '100%' }); return; }
    const scale = Math.min(pw / w, ph / h);
    const bw = Math.round(w * scale);
    const bh = Math.round(h * scale);
    Object.assign(box.style, { left: `${Math.round((pw - bw) / 2)}px`, top: `${Math.round((ph - bh) / 2)}px`, width: `${bw}px`, height: `${bh}px` });
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(player);
  video.addEventListener('loadedmetadata', place);

  return {
    /** Show `cue` (or nothing). */
    show(cue) {
      const want = cue ? cue.text : null;
      if (want === shownText) return;
      shownText = want;
      box.hidden = want === null;
      text.textContent = want || '';
      if (want !== null) { place(); drawCaptionTile(canvas, want); }
    },
    place,
    element: box,
  };
}
