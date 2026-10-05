// The Review detail for the sample video, wired (SCREEN-07). The page is the review-shell screen
// Deth's draft picture was built to; this module is the shell's own script plus the wiring: the
// sidebar goes to the real routes, the player plays the bundled sample take, a moment or a number
// moves it or changes the prepared reply, and Try this / Adjust / Dismiss go through the existing
// trial engine. Every number and reply is sample data; no model is called.
import { go, comingSoon } from '../lib/app.js';
import { fixtureSnapshot, selectContext, proposeTrial, adjustProposal, acceptTrial, dismissProposal } from '../../src/engine/review-sample.js';
import { createReviewStore } from '../../src/engine/review-store.js';

// YAP Review screen shell. All numbers are fake SAMPLE data (labelled in the badge).
const DURATION = 507; // 8:27 in seconds

const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'ideas', label: 'Ideas', icon: 'bulb' },
  { id: 'create', label: 'Create', icon: 'plus' },
  { id: 'review', label: 'Review', icon: 'bars', current: true },
  { id: 'grow', label: 'Grow', icon: 'rocket' },
];

const KPIS = [
  { label: 'Views', value: '234K', delta: 12, icon: 'eye', spark: [3, 4, 3.6, 5, 4.6, 6, 6.5] },
  { label: 'Impressions', value: '1.8M', delta: 18, icon: 'scan', spark: [3, 3.5, 3.2, 4.8, 4.4, 5.8, 6.4] },
  { label: 'CTR', value: '6.4%', delta: -22, icon: 'cursor', alert: true, spark: [5, 6.5, 6, 6.8, 5.2, 4.2, 4.6] },
  { label: 'Avg view duration', value: '4:32', delta: 14, icon: 'clock', spark: [3, 3.4, 3.2, 4.4, 4.2, 5.4, 5.8] },
  { label: 'Watch time', value: '17.6K', unit: ' hrs', delta: 9, icon: 'chart', spark: [3.5, 3.8, 3.6, 4.6, 4.4, 5.2, 5.6] },
];

// seconds, audience % left at that point (the curve passes through these)
const YOU = [[0, 100], [8, 80], [40, 62], [72, 52], [110, 44], [140, 38], [190, 36], [245, 41], [285, 31], [330, 27], [380, 24], [430, 20], [470, 16], [507, 14]];
const AVG = [[0, 100], [8, 72], [40, 54], [72, 44], [110, 36], [140, 32], [190, 29], [245, 28], [285, 25], [330, 22], [380, 19], [430, 16], [470, 13], [507, 11]];

const MOMENTS = [
  { time: '0:00', label: 'Strong start', pct: 100, text: "viewers are fully with you. The opening line is clear and the picture is steady, so almost everyone stays for the first few seconds." },
  { time: '1:12', label: 'High retention', pct: 52, text: "about half of viewers are still watching, which is above your channel average here. The pace is brisk and each sentence adds something new." },
  { time: '2:20', label: 'Notable drop', pct: 38, text: "38% of viewers left. This dip often happens when the topic shifts from the big idea to a more detailed explanation. The energy drops and the hook from the intro isn't reinforced." },
  { time: '4:05', label: 'Spike', pct: 41, text: "more viewers stayed, and some went back to re-watch. A concrete example with a visual seems to have pulled attention back in." },
  { time: '5:30', label: 'Steady', pct: 27, text: "viewership holds steady. Nothing here pushes people away, but nothing new pulls them in either. A small pattern change could help." },
  { time: '7:10', label: 'Strong finish', pct: 17, text: "most remaining viewers watch to the end. The recap and the clear next step keep them until the last line." },
];
const DEFAULT_ANSWER = (m) => `At ${m.time}, ${m.text}`;
const SAMPLE_REPLY = "In this sample data, the click-through rate dips because the title and thumbnail don't state a specific promise. Try the simple experiment above to compare. (sample)";

const ICONS = {
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
  plus: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
  bars: '<path d="M6 20V10M12 20V4M18 20v-7"/>',
  rocket: '<path d="M5 19c0-3 1-4 2-5l-3-1 3-4 3 1c3-5 7-7 11-7 0 4-2 8-7 11l1 3-4 3-1-3c-1 1-2 2-5 2z"/><circle cx="15" cy="9" r="1.2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  scan: '<path d="M4 8V5h3M17 4h3v3M20 16v3h-3M7 20H4v-3"/><path d="M12 9v6M9 12h6"/>',
  cursor: '<path d="M6 4l12 7-5 1.5L11 18z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  cc: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 10.5c-2-1-3 0-3 1.5s1 2.5 3 1.5M17 10.5c-2-1-3 0-3 1.5s1 2.5 3 1.5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9c1.5 1.5 1.5 4.500 0 6M18.500 6.500c3 3 3 8 0 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/>',
  sparkle: '<path d="M10 4l1.800 5.200L17 11l-5.200 1.800L10 18l-1.800-5.200L3 11l5.200-1.800z"/><path d="M18 3v4M16 5h4"/>',
  opts: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/>',
  sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowright: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.500l3 3 5-6"/>',
  up: '<path d="M12 19V6M6 12l6-6 6 6"/>',
  down: '<path d="M12 5v13M6 12l6 6 6-6"/>',
};
const ic = (name, size) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${ICONS[name]}</svg>`;

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const toSec = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
const pctAt = (pts, s) => {
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * ((s - x0) / (x1 - x0)); }
  }
  return pts[pts.length - 1][1];
};

let selected = 2;
let kpiSel = 2;

function renderNav() {
  $('nav').innerHTML = NAV.map((n) =>
    `<a href="#${n.id}" data-testid="nav-${n.id}"${n.current ? ' aria-current="page"' : ''}>${ic(n.icon)}<span>${n.label}</span></a>`).join('');
  $('nav').addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    const where = { 'nav-ideas': '/', 'nav-create': '/create', 'nav-review': '/review' }[a.dataset.testid];
    if (where) go(where); else comingSoon(document, a.textContent, a);
  });
}

function renderHeader() {
  document.querySelector('.range').addEventListener('click', () => comingSoon(document, 'Date range'));
  document.querySelector('.range').innerHTML = `<span>${ic('calendar')}Last 28 days</span>${ic('chevron')}`;
  $('play').innerHTML = ic('play');
  $('ctl').innerHTML = ['cc', 'volume', 'gear', 'full'].map((n) => ic(n)).join('');
  $('info').innerHTML = ic('info');
  $('spark-ic').innerHTML = ic('sparkle');
  $('a-opt').innerHTML = ic('opts');
  $('send').innerHTML = ic('send', 16);
}

function sparkSvg(vals, down) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 70).toFixed(1)},${(24 - (v - min) / (max - min || 1) * 20).toFixed(1)}`).join(' ');
  return `<svg class="spark${down ? ' down' : ''}" viewBox="0 0 70 26" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

function renderKpis() {
  $('kpis').innerHTML = KPIS.map((k, i) => {
    const down = k.delta < 0;
    return `<div class="kpi${i === kpiSel ? ' alert' : ''}" data-testid="kpi" data-kpi="${k.label}" data-selected="${i === kpiSel}" role="button" tabindex="0" aria-pressed="${i === kpiSel}">${ic(k.icon)}<span class="kpi-label">${k.label}</span>
      <div class="kpi-body"><span class="kpi-val">${k.value}${k.unit ? `<small>${k.unit}</small>` : ''}</span>
      <span class="delta${down ? ' down' : ''}">${down ? '↓' : '↑'} ${Math.abs(k.delta)}%</span>${sparkSvg(k.spark, down)}</div></div>`;
  }).join('');
}

function curve(pts) {
  return pts.map(([s, p], i) => `${i ? 'L' : 'M'}${(s / DURATION * 1000).toFixed(1)},${(100 - p).toFixed(1)}`).join(' ');
}

function renderChart() {
  const ticks = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => m * 60);
  const grid = [0, 33, 66, 100].map((p) => `<line class="gridline" x1="0" x2="1000" y1="${100 - p}" y2="${100 - p}"/>`).join('');
  const ylab = [100, 66, 33, 0].map((p) => `<span class="ylab" style="top:${100 - p}%">${p}%</span>`).join('');
  const xlab = [...ticks, DURATION].map((s) => `<span class="xlab" style="left:${s / DURATION * 100}%">${fmt(s)}</span>`).join('');
  $('chart').innerHTML = `<div class="plot" data-testid="plot">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="Audience retention, sample data">${grid}
      <path class="area-you" d="${curve(YOU)} L1000,100 L0,100 Z"/>
      <path class="line-avg" d="${curve(AVG)}"/><path class="line-you" d="${curve(YOU)}"/></svg>
    ${ylab}
    <div class="marker" data-testid="marker" id="marker"><i id="mdot"></i></div>
    <div class="tooltip" data-testid="tooltip" id="tooltip"></div></div>${xlab}`;
  // axis labels are positioned relative to the plot via an overlay container
  const chart = $('chart');
  chart.querySelectorAll(':scope > .xlab').forEach((n) => { n.style.left = `calc(var(--axis-width) + (100% - var(--axis-width)) * ${parseFloat(n.style.left) / 100})`; });
}

function renderMoments() {
  $('moments').innerHTML = MOMENTS.map((m, i) =>
    `<button type="button" class="moment" data-testid="moment" data-time="${m.time}" data-selected="${i === selected}" aria-pressed="${i === selected}">
      <span class="tile"><img src="assets/moment-${i + 1}.jpg" alt=""></span>
      <span class="l">${m.time}</span><span class="l">${m.label}</span></button>`).join('');
}


// A prepared reply for each number. Each states only numbers that are on the screen. All of it is sample data.
const KPI_REPLIES = [
  'In this sample data, Views are 234K, up 12%. More people watched than before. The sample does not say why, so treat that as a question to explore, not a result. (sample)',
  'In this sample data, Impressions are 1.8M, up 18%. YAP was shown to more people. Whether they chose to watch is what click-through rate says. (sample)',
  "In this sample data, click-through rate is 6.4%, down 22%. More people saw the video but fewer chose it. The title and thumbnail may not state a specific promise, but this sample cannot tell us that caused it. Try the simple experiment to compare. (sample)",
  'In this sample data, Avg view duration is 4:32, up 14%. People who watch are staying longer. The retention chart below shows where they leave. (sample)',
  'In this sample data, Watch time is 17.6K hrs, up 9%. It grows more slowly than views, up 12%. The sample does not say why. (sample)',
];
function select(i, jump = true) {
  selected = i;
  const m = MOMENTS[i], s = toSec(m.time);
  document.querySelectorAll('[data-testid="moment"]').forEach((b, j) => { b.dataset.selected = String(j === i); b.setAttribute('aria-pressed', String(j === i)); });
  const x = s / DURATION * 100;
  $('marker').style.left = `${x}%`;
  $('mdot').style.top = `${100 - pctAt(YOU, s)}%`;
  const tip = $('tooltip');
  tip.style.left = `${x}%`;
  tip.innerHTML = `${m.time}<b>${m.pct}% audience left here</b>`;
  if (jump) seekTo(s);
  document.querySelector('[data-testid="question"]').textContent = 'What happened here?';
  say(DEFAULT_ANSWER(m));
}

/** The prepared reply, with its sample label. Only text written here; no model is called. */
function say(text) {
  const a = $('answer');
  a.textContent = text;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = 'Sample reply · prepared, no model is called';
  a.append(tag);
}

function pickKpi(i) {
  kpiSel = i;
  renderKpis();
  document.querySelector('[data-testid="question"]').textContent = `What does ${KPIS[i].label} tell me?`;
  say(KPI_REPLIES[i]);
}

// ---- the player: the bundled sample take; the drawn times map proportionally onto its real length ----
const video = document.createElement('video');
video.setAttribute('data-testid', 'video');
video.preload = 'metadata';
video.poster = 'assets/video.jpg';
video.src = '/sample/take1.mp4';
video.playsInline = true;
let pendingSeek = null;
function seekTo(drawnSeconds) {
  const target = (d) => Math.min(Math.max(drawnSeconds / DURATION * d, 0), d);
  if (video.readyState >= 1 && Number.isFinite(video.duration)) video.currentTime = target(video.duration);
  else pendingSeek = drawnSeconds;
  const s = drawnSeconds / DURATION;
  $('progress').style.width = `${Math.max(s * 100, 3)}%`;
}
function showTime() {
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  $('time').textContent = `${fmt(video.currentTime || 0)} / ${fmt(d)}`;
  if (d) $('progress').style.width = `${Math.max((video.currentTime / d) * 100, 3)}%`;
}
video.addEventListener('loadedmetadata', () => {
  if (pendingSeek !== null) { video.currentTime = Math.min(pendingSeek / DURATION * video.duration, video.duration); pendingSeek = null; }
  showTime();
});
video.addEventListener('timeupdate', showTime);
video.addEventListener('play', () => { $('play').innerHTML = ic('pause'); });
video.addEventListener('pause', () => { $('play').innerHTML = ic('play'); });

// ---- the trial: the existing engine, one record, saved once ----
let store = null, state = null, proposal = null;
function loadEngine() {
  try {
    store = createReviewStore(localStorage);
    state = store.load();
    const ctx = selectContext(fixtureSnapshot(), 'ctr');
    proposal = proposeTrial(ctx);
  } catch (e) {
    store = null;
  }
}
const saved = () => (state ? state.trials.find((t) => t.context && t.context.videoId === 'sample-video') : null);
function save(next) { store.save(next); state = next; }

function renderExperiment(mode = 'open') {
  const el = $('experiment');
  const t = saved();
  if (t || mode === 'trial') {
    const tr = t || {};
    el.innerHTML = `<div class="result">${ic('check')}<span data-testid="trial-saved">Trial saved · Check back after 3 videos</span></div>
      <p class="exp-note" data-testid="trial-status"></p>`;
    $('experiment').querySelector('[data-testid="trial-status"]').textContent = `${tr.change || ''} · ${tr.status === 'ready-to-try' ? 'ready to try' : tr.status || ''} · not applied yet · sample trial, nothing has been started on any platform`;
    return;
  }
  if (mode === 'dismissed') { el.innerHTML = `<div class="result dismissed">${ic('x')}<span data-testid="dismissed">Dismissed. No trial was saved.</span></div>`; return; }
  el.innerHTML = `<div class="exp-title">${ic('bulb', 18)}<b>Simple experiment</b></div>
    <p class="exp-text" data-testid="exp-text"></p>
    <div class="thumbs">
      <div class="thumb" data-testid="thumb-current"><img src="assets/thumb-current.jpg" alt="Current thumbnail (sample)"></div>
      <span class="arrow">${ic('arrowright', 18)}</span>
      <div class="thumb proposed" data-testid="thumb-proposed"><img src="assets/thumb-proposed.jpg" alt="Proposed thumbnail (sample)"></div></div>
    <div class="adjust-row" id="adjust-row" hidden><input data-testid="adjust-change" type="text" aria-label="Change to try"><button class="btn" type="button" data-testid="adjust-save">Save change</button></div>
    <div class="actions">
      <button class="btn primary" type="button" data-testid="try">${ic('flask')}Try this</button>
      <button class="btn" type="button" data-testid="adjust">${ic('sliders')}Adjust</button>
      <button class="btn" type="button" data-testid="dismiss">${ic('x')}Dismiss</button></div>
    <p class="exp-note">Sample experiment. Trying this means ready to try, not applied and not shown to work.</p>`;
  el.querySelector('[data-testid="exp-text"]').textContent = proposal && proposal.change !== 'Test a clearer thumbnail promise'
    ? `${proposal.change}. A clear, specific promise often helps the right viewers choose to watch.`
    : 'Test a clearer thumbnail with a stronger, more specific hook. A clear, specific promise often helps the right viewers choose to watch.';
  const guard = (fn) => () => { try { fn(); } catch (e) { toast(e && e.message ? e.message : 'That did not work.'); } };
  el.querySelector('[data-testid="try"]').addEventListener('click', guard(() => {
    if (!store) throw new Error('Review saving is not available in this browser.');
    save(acceptTrial(state, proposal));
    renderExperiment('trial');
  }));
  el.querySelector('[data-testid="dismiss"]').addEventListener('click', guard(() => {
    if (!store) throw new Error('Review saving is not available in this browser.');
    save(dismissProposal(state, proposal));
    renderExperiment('dismissed');
  }));
  el.querySelector('[data-testid="adjust"]').addEventListener('click', () => {
    const row = $('adjust-row');
    row.hidden = !row.hidden;
    row.querySelector('input').value = proposal ? proposal.change : '';
  });
  el.querySelector('[data-testid="adjust-save"]').addEventListener('click', guard(() => {
    proposal = adjustProposal(proposal, el.querySelector('[data-testid="adjust-change"]').value, '');
    renderExperiment('open');
  }));
}

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function addBubble(kind, text) {
  const b = document.createElement('div');
  b.className = `bubble ${kind}`; b.dataset.testid = `msg-${kind === 'you' ? 'you' : 'yap'}`;
  b.setAttribute('data-testid', `msg-${kind === 'you' ? 'you' : 'yap'}`);
  b.textContent = text;
  $('thread').appendChild(b);
  $('scroller').scrollTop = $('scroller').scrollHeight;
}

const FREE_TEXT_LINE = 'I can only give the prepared replies for now. Pick a number or a key moment, or ask about views, impressions, click-through rate, view duration or watch time. (sample)';
function ask() {
  const input = $('ask-input'), q = input.value.trim();
  if (!q) return;
  addBubble('you', q);
  const low = q.toLowerCase();
  const hit = [[/view duration|average view|avg/, 3], [/watch time/, 4], [/impression/, 1], [/ctr|click/, 2], [/\bviews?\b/, 0]].find(([re]) => re.test(low));
  addBubble('yap', hit ? KPI_REPLIES[hit[1]] : FREE_TEXT_LINE);
  input.value = '';
}

loadEngine();
renderNav(); renderHeader(); renderKpis(); renderChart(); renderMoments(); renderExperiment(); select(selected, false);
document.querySelector('.screen').append(video);
showTime();

$('play').addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
$('moments').addEventListener('click', (e) => {
  const b = e.target.closest('[data-testid="moment"]'); if (!b) return;
  select([...$('moments').children].indexOf(b));
});
$('kpis').addEventListener('click', (e) => {
  const k = e.target.closest('[data-testid="kpi"]'); if (!k) return;
  pickKpi([...$('kpis').children].indexOf(k));
});
$('kpis').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const k = e.target.closest('[data-testid="kpi"]'); if (!k) return;
  e.preventDefault(); pickKpi([...$('kpis').children].indexOf(k));
});
$('send').addEventListener('click', ask);
$('ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
