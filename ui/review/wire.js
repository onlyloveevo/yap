// The Review inbox, wired (SCREEN-06). The page is the locked inbox shell; this
// module is the shell's own script (the six sample cards, the filters, the search,
// the one selected card) plus three things the shell left as toasts: Open review
// opens /review/:id, Add video opens the file picker (OWN-01), and a video the
// person brought in appears as a card. Nothing is uploaded anywhere.
import { go, wireNav } from '../lib/app.js';
import { createReviewStore } from '../../src/engine/review-store.js';
import { importVideo, openMediaStore } from '../../src/engine/video-import.js';

wireNav(document);

const samples = [
  { id: 1, route: 'sample-video', title: 'Why my first launch failed', platform: 'YouTube', status: 'needs', thumbnail: 'MY FIRST\nLAUNCH' },
  { id: 2, route: 'sample-2', title: 'A better way to start your day', platform: 'Instagram', status: 'needs', thumbnail: 'A BETTER WAY TO\nSTART YOUR DAY' },
  { id: 3, route: 'sample-3', title: 'What I learned from 30 days of filming', platform: 'YouTube', status: 'needs', pill: 'New comments to explore', thumbnail: '30 DAYS\nOF FILMING' },
  { id: 4, route: 'sample-4', title: 'The idea I almost didn’t share', platform: 'Uploaded video', status: 'needs', thumbnail: 'THE IDEA I ALMOST\nDIDN’T SHARE' },
  { id: 5, route: 'sample-5', title: 'Grab a coffee, take 1', platform: 'YouTube', status: 'waiting', thumbnail: 'GRAB A COFFEE', trial: "Trial: 'Grab a coffee' · 1 of 3 · waiting for results" },
  { id: 6, route: 'sample-6', title: 'My studio tour', platform: 'Uploaded video', status: 'reviewed', thumbnail: 'MY STUDIO TOUR' },
];

let videos = samples.map((v) => ({ ...v }));
let filter = 'needs';
let selected = 1;
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

/** The cards: six samples (the first moves to Waiting once it has an accepted trial), then the person's own videos. */
async function load() {
  const next = samples.map((v) => ({ ...v }));
  try {
    const state = createReviewStore(localStorage).load();
    const trial = state.trials.find((t) => t.context && t.context.videoId === 'sample-video');
    if (trial) {
      next[0].status = 'waiting';
      next[0].trial = `Trial: ${trial.change} · waiting for results`;
    }
  } catch {
    // No saved review here: the cards stay as drawn.
  }
  try {
    mediaStore = mediaStore || (await openMediaStore());
    const records = await mediaStore.list();
    records.sort((a, b) => String(b.video.importedAt).localeCompare(String(a.video.importedAt)));
    for (const r of records) {
      next.push({ id: r.id, route: r.id, title: r.video.title, platform: 'Uploaded video', status: 'needs', thumbnail: String(r.video.title).toUpperCase(), own: true });
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
    card.className = `card thumbnail-${v.own ? 1 : v.id}`;
    card.tabIndex = 0;
    card.dataset.testid = 'card';
    card.dataset.status = v.status;
    card.dataset.selected = String(v.id === selected);
    card.setAttribute('aria-label', v.title);
    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';
    // His picture's cards are photographs with the lettering already in them: no overlaid title.
    thumb.style.backgroundImage = `url(card-${v.own ? 5 : v.id}.jpg)`;
    thumb.style.backgroundSize = 'cover';
    thumb.style.height = 'auto';
    thumb.style.minHeight = '0';
    thumb.style.aspectRatio = '555 / 271';
    thumb.style.backgroundPosition = 'center';
    thumb.setAttribute('role', 'img');
    thumb.setAttribute('aria-label', v.title);
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const dot = document.createElement('i');
    dot.className = 'status-dot';
    dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'card-copy';
    const title = document.createElement('h2');
    title.dataset.testid = 'card-title';
    title.textContent = v.title;
    const platform = document.createElement('p');
    platform.dataset.testid = 'card-platform';
    platform.className = 'platform';
    const icon = document.createElement('span');
    icon.className = v.platform === 'YouTube' ? 'youtube' : v.platform === 'Instagram' ? 'instagram' : 'upload';
    icon.textContent = v.platform === 'YouTube' ? '▶' : v.platform === 'Instagram' ? '◎' : '↥';
    icon.setAttribute('aria-hidden', 'true');
    platform.append(icon, document.createTextNode(v.platform));
    copy.append(title, platform);
    const isSel = v.id === selected;
    const action = document.createElement(isSel ? 'button' : 'span');
    action.className = isSel ? 'open-review' : 'pill';
    action.textContent = isSel ? 'Open review →' : v.pill || (v.status === 'waiting' ? 'Waiting for results' : v.status === 'reviewed' ? 'Reviewed' : 'Ready to review');
    if (isSel) {
      action.dataset.testid = 'open-review';
      action.addEventListener('click', (e) => {
        e.stopPropagation();
        go(`/review/${v.route}`);
      });
    }
    meta.append(dot, copy, action);
    card.append(thumb, meta);
    if (v.trial) {
      const trial = document.createElement('p');
      trial.className = 'trial';
      trial.textContent = v.trial;
      card.append(trial);
    }
    const select = () => {
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
  });
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No sample videos match your search.';
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
    toast(existing ? 'This video is already here. Your saved transcript and notes are kept.' : 'Video added. It stays on this machine and was not uploaded.', 6000);
  } catch (e) {
    toast(`That file was not added: ${e && e.message ? e.message : 'it could not be read'}.`, 8000);
  }
});

await load();
render();
