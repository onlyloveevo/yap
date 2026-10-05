// The Review inbox, wired (SCREEN-06). The page is the locked inbox shell; this
// module is the shell's own script (the six sample cards, the filters, the search,
// the one selected card) plus three things the shell left as toasts: Open review
// opens a review (every sample card opens the one sample review), Add video opens
// the file picker (OWN-01), and a video the person brought in appears as a card
// with a frame of its own. Nothing is uploaded anywhere. A take recorded in YAP is a card too, first
// in the list, and what YAP is trying with the person sits in the side panel.
import { go, wireNav } from '../lib/app.js';
import { listRecordings, getRecording, getTrials } from '../lib/api.js';
import { lessonStore } from '../lib/return-model.js';
import { mediaPath } from '../lib/return-preview.js';
import { mountTrying } from '../lib/carried-lesson.js';
import { importVideo, openMediaStore } from '../../src/engine/video-import.js';

wireNav(document);

const samples = [
  { id: 1, route: 'sample-video', title: 'Why my first launch failed', platform: 'YouTube', status: 'needs', thumbnail: 'MY FIRST\nLAUNCH' },
  { id: 2, route: 'sample-video', title: 'A better way to start your day', platform: 'Instagram', status: 'needs', thumbnail: 'A BETTER WAY TO\nSTART YOUR DAY' },
  { id: 3, route: 'sample-video', title: 'What I learned from 30 days of filming', platform: 'YouTube', status: 'needs', pill: 'New comments to explore', thumbnail: '30 DAYS\nOF FILMING' },
  { id: 4, route: 'sample-video', title: 'The idea I almost didn’t share', platform: 'Uploaded video', status: 'needs', thumbnail: 'THE IDEA I ALMOST\nDIDN’T SHARE' },
  { id: 5, route: 'sample-video', title: 'Grab a coffee, take 1', platform: 'YouTube', status: 'waiting', thumbnail: 'GRAB A COFFEE', trial: "Trial: 'Grab a coffee' · 1 of 3 · waiting for results" },
  { id: 6, route: 'sample-video', title: 'My studio tour', platform: 'Uploaded video', status: 'reviewed', thumbnail: 'MY STUDIO TOUR' },
];

let videos = samples.map((v) => ({ ...v }));
let filter = 'needs';
let selected = 1;
// Once the person picks a card, their pick stays the selected one.
let chosen = false;
let query = '';
let timer;
let mediaStore = null;
const grid = document.querySelector('.cards');

function toast(message, ms = 2800) {
  const el = document.querySelector('[data-testid="toast"]');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/** A frame of the person's own video, drawn once from the kept file. No frame leaves the card on its warm ground. */
const posters = new Map();
function posterOf(id, file, { src = '', crop = 0 } = {}) {
  if (!posters.has(id)) {
    posters.set(id, new Promise((resolve) => {
      const video = document.createElement('video');
      const url = file ? URL.createObjectURL(file) : src;
      const done = (value) => { if (file) URL.revokeObjectURL(url); resolve(value); };
      video.muted = true;
      video.preload = 'auto';
      video.onloadeddata = () => { video.currentTime = Math.min(1, (video.duration || 0) / 2); };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = Math.round(640 * video.videoHeight / video.videoWidth) || 360;
          // `crop` leaves out that share of the top and left, where the bundled footage carries its own label.
          const w = video.videoWidth, h = video.videoHeight;
          canvas.getContext('2d').drawImage(video, w * crop, h * crop, w * (1 - crop), h * (1 - crop), 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL('image/jpeg', 0.8));
        } catch { done(null); }
      };
      video.onerror = () => done(null);
      video.src = url;
    }));
  }
  return posters.get(id);
}

/** The cards: six samples (the first moves to Waiting once its lesson is in the next video), then the person's own videos. */
async function load() {
  const next = samples.map((v) => ({ ...v }));
  try {
    const lesson = await lessonStore({ sample: true, storage: localStorage }).read();
    if (lesson) {
      next[0].status = 'waiting';
      next[0].trial = `In your next video: ${lesson.text}`;
    }
  } catch {
    // No storage here: the cards stay as drawn.
  }
  try {
    // The person's own finished takes, newest first, each with the experiment it carried.
    const ready = (await listRecordings()).filter((r) => r.status === 'ready').slice(0, 6);
    const trials = (await getTrials().catch(() => [])) || [];
    const saved = (await Promise.all(ready.map((r) => getRecording(r.id).catch(() => null)))).filter((t) => t?.recording?.duration > 0);
    const takes = saved.map(({ recording: r, meta }) => {
      const trial = trials.find((t) => ['accepted', 'running', 'check-in due'].includes(t.status) && t.recordings?.includes(r.id));
      return {
        id: r.id, route: r.id, title: `${r.title}${meta?.returnFrom ? ', take 2' : ''}`, platform: 'Recorded in YAP', status: 'needs', take: true,
        src: mediaPath(r.id), crop: meta?.sample ? 0.14 : 0,
        ...(trial ? { trial: `Trying “${trial.change.to}” · video ${trial.recordings.indexOf(r.id) + 1} of ${trial.trialLength}` } : {}),
      };
    });
    next.unshift(...takes);
    if (takes.length && !chosen) selected = takes[0].id;
  } catch {
    // The saved takes could not be read: the samples still show.
  }
  try {
    mediaStore = mediaStore || (await openMediaStore());
    const records = await mediaStore.list();
    records.sort((a, b) => String(b.video.importedAt).localeCompare(String(a.video.importedAt)));
    for (const r of records) {
      next.push({ id: r.id, route: r.id, title: r.video.title, platform: 'Uploaded video', status: 'needs', thumbnail: String(r.video.title).toUpperCase(), own: true, file: r.file });
    }
  } catch {
    // Local video storage is not available: only the samples show.
  }
  videos = next;
}

function render() {
  const visible = videos.filter((v) => (filter === 'all' || v.status === filter) && v.title.toLowerCase().includes(query));
  grid.replaceChildren();
  visible.forEach((v) => {
    const card = document.createElement('article');
    card.className = `card thumbnail-${v.own || v.take ? 1 : v.id}`;
    card.tabIndex = 0;
    card.dataset.testid = 'card';
    card.dataset.status = v.status;
    card.dataset.selected = String(v.id === selected);
    card.setAttribute('aria-label', v.title);
    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';
    // His picture's cards are photographs with the lettering already in them: no overlaid title.
    if (v.take) posterOf(v.id, null, v).then((src) => { if (src) thumb.style.backgroundImage = `url(${src})`; });
    else if (!v.own) thumb.style.backgroundImage = `url(card-${v.id}.jpg)`;
    else if (v.file) posterOf(v.id, v.file).then((src) => { if (src) thumb.style.backgroundImage = `url(${src})`; });
    thumb.setAttribute('role', 'img');
    thumb.setAttribute('aria-label', v.title);
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const dot = document.createElement('i');
    dot.className = 'status-dot';
    dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2');
    title.dataset.testid = 'card-title';
    title.textContent = v.title;
    const platform = document.createElement('p');
    platform.dataset.testid = 'card-platform';
    platform.className = 'platform';
    const icon = document.createElement('span');
    icon.className = v.platform === 'YouTube' ? 'youtube' : v.platform === 'Instagram' ? 'instagram' : 'upload';
    if (v.take) icon.dataset.kind = 'take';
    icon.innerHTML = v.platform === 'YouTube' ? '<svg viewBox="0 0 24 24"><path d="M9 7.500v9l8-4.500z" fill="currentColor"/></svg>' : v.platform === 'Instagram' ? '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="4"/><circle cx="12" cy="12" r="3.200"/></svg>' : v.take ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.500" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v5h14v-5"/></svg>';
    icon.setAttribute('aria-hidden', 'true');
    platform.append(icon, document.createTextNode(v.platform));
    const isSel = v.id === selected;
    const action = document.createElement(isSel ? 'button' : 'span');
    action.className = isSel ? 'open-review' : 'pill';
    action.textContent = isSel ? 'Open review' : v.pill || (v.status === 'waiting' ? 'Waiting for results' : v.status === 'reviewed' ? 'Reviewed' : 'Ready to review');
    if (isSel) {
      action.dataset.testid = 'open-review';
      action.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
      action.addEventListener('click', (e) => {
        e.stopPropagation();
        go(`/review/${v.route}`);
      });
    }
    meta.append(dot, title, platform, action);
    card.append(thumb, meta);
    if (v.trial) {
      const trial = document.createElement('p');
      trial.className = 'trial';
      trial.textContent = v.trial;
      card.append(trial);
    }
    const select = () => {
      chosen = true;
      selected = v.id;
      render();
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (e) => {
      if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        select();
      }
    });
    grid.append(card);
    // His picture: the action sits beside a short title, and under a long one.
    if (title.scrollWidth > title.clientWidth) meta.dataset.action = 'below';
  });
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No videos match.';
    grid.append(empty);
  }
  document.querySelectorAll('[data-filter]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.filter === filter)));
}

document.querySelectorAll('[data-filter]').forEach((el) =>
  el.addEventListener('click', () => {
    filter = el.dataset.filter;
    render();
  })
);
document.querySelector('[data-testid="search"]').addEventListener('input', (e) => {
  query = e.target.value.toLowerCase();
  render();
});

// Add video (OWN-01): the file picker, then the checks, then the browser's own storage. No upload.
const picker = document.createElement('input');
picker.type = 'file';
picker.hidden = true;
picker.accept = '.mp4,.m4v,.mov,.webm';
picker.dataset.testid = 'add-video-input';
document.body.append(picker);
document.querySelector('[data-testid="add-video"]').addEventListener('click', () => {
  picker.value = '';
  picker.click();
});
picker.addEventListener('change', async () => {
  const file = picker.files && picker.files[0];
  if (!file) return;
  try {
    toast('Checking the video…', 8000);
    const video = await importVideo(file);
    mediaStore = mediaStore || (await openMediaStore());
    const existing = await mediaStore.get(video.id);
    if (!existing) await mediaStore.put({ id: video.id, video, file });
    const kept = await mediaStore.get(video.id);
    if (!kept || !kept.file) throw new Error('The video could not be kept in this browser.');
    await load();
    filter = 'needs';
    query = '';
    document.querySelector('[data-testid="search"]').value = '';
    selected = video.id;
    render();
    // The new card is the selected one: bring it into view, under the samples.
    grid.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast(existing ? 'This video is already here. Your saved transcript and notes are kept.' : 'Video added. It stays on this machine and was not uploaded.', 6000);
  } catch (e) {
    toast(`That file was not added: ${e && e.message ? e.message : 'it could not be read'}.`, 8000);
  }
});

await load();
render();

// What YAP is trying with the person: the lesson picked in Review and the experiments started in a take.
const trying = document.createElement('div');
trying.className = 'trying-slot';
document.querySelector('.filters').after(trying);
mountTrying(trying, { onChange: () => load().then(render) }).catch(() => undefined);
