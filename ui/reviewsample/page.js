// The Review detail page, drawn from one description of a video (a "subject"). The sample review and a
// person's own take are two subjects on the same page: five numbers, the player, a chart over the
// video's length, key moments, YAP's reading of a moment, one experiment and a box to ask in.
//
// One length runs through it: `subject.duration` is the end of the chart, the last key moment's limit
// and the player's total. Pressing a moment moves the player to that moment: its picture and its time.
import { wireNav } from '../lib/app.js';
import { carriesLesson } from '../lib/return-model.js';
import { mountLessonAction } from '../lib/review-own.js';
import { mountTrying } from '../lib/carried-lesson.js';

/**
 * @typedef {object} ReviewSubject
 * @property {string} id                 the review's address id
 * @property {boolean} sample            sample data, said once by the tag beside the title
 * @property {string} title
 * @property {string} published          the line under the title
 * @property {string} range              the chip top right
 * @property {number} duration           the video's length in seconds: chart, key moments and player share it
 * @property {{ src?: string, sampleFootage?: boolean, stills?: { at: number, img: string, small?: boolean }[], start?: number }} media   `src`: the video's footage. `stills`: a video with no footage, only its own pictures, each at its second; the player shows those and plays nothing. `start`: where the player opens. `sampleFootage`: the bundled take, framed so its own burned-in label stays out of the picture (the page says Sample once)
 * @property {{ label: string, value: string, unit?: string, icon: string, delta?: number, spark?: number[], note?: string, reply: string }[]} numbers
 * @property {number} selectedNumber
 * @property {null | { heading: string, legend: { tone: string, label: string }[], yTicks: { at: number, label: string }[], you: [number, number][], other?: [number, number][], limit?: number | null, bands?: { start: number, end: number }[], label: string }} chart   points are [seconds, height 0 to 1]
 * @property {{ time: number, clock: string, label: string, tip: string, reading: string, img?: string }[]} moments
 * @property {number} selectedMoment
 * @property {{ text: string, more?: string, current: { img?: string, text?: string }, proposed: { img?: string, text?: string } } | null} experiment
 * @property {{ id: string, title: string }} source    what a lesson picked here is named after
 * @property {object} store              where a lesson picked here is kept (lessonStore)
 * @property {(question: string) => Promise<{ text: string, suggestion?: string }>} answer
 * @property {string} placeholder
 */

const ICONS = {
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  scan: '<path d="M4 8V5h3M17 4h3v3M20 16v3h-3M7 20H4v-3"/><path d="M12 9v6M9 12h6"/>',
  cursor: '<path d="M6 4l12 7-5 1.5L11 18z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  scissors: '<circle cx="6" cy="7" r="2.500"/><circle cx="6" cy="17" r="2.500"/><path d="M8 8.500 20 18M8 15.500 20 6"/>',
  redo: '<path d="M4 12a8 8 0 1 0 3-6.200"/><path d="M4 4v5h5"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9c1.5 1.5 1.5 4.500 0 6M18.500 6.500c3 3 3 8 0 11"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/>',
  sparkle: '<path d="M10 4l1.800 5.200L17 11l-5.200 1.800L10 18l-1.800-5.200L3 11l5.200-1.800z"/><path d="M18 3v4M16 5h4"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  voice: '<circle cx="12" cy="12" r="9"/><path d="M9 10v4M12 8v8M15 10v4"/>',
  arrowright: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const ic = (name, size) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${ICONS[name] || ICONS.info}</svg>`;

const $ = (id) => document.getElementById(id);
const hook = (testid) => document.querySelector(`[data-testid="${testid}"]`);
/** m:ss, the one clock of the page. */
export const fmt = (s) => { const t = Math.max(0, Math.floor((Number(s) || 0) + 1e-6)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

/** The height of a line at a time, between its points. */
function heightAt(points, t) {
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return x1 === x0 ? y1 : y0 + (y1 - y0) * ((t - x0) / (x1 - x0)); }
  }
  return points.length ? points[points.length - 1][1] : 0;
}

/** The times written under the chart: even steps, then the video's own end. */
function axisTimes(duration) {
  const step = [5, 10, 15, 30, 60, 120, 300, 600].find((s) => duration / s <= 9) || 600;
  const ticks = [];
  for (let t = 0; t < duration - step * 0.45; t += step) ticks.push(t);
  return [...ticks, duration];
}

// What the person chose about a review's experiment before trying it: their own wording, or to set it aside.
const CHOICES_KEY = 'yap-review-choices-v1';
function readChoices(id) { try { return (JSON.parse(localStorage.getItem(CHOICES_KEY)) || {})[id] || {}; } catch { return {}; } }
function saveChoices(id, next) {
  try {
    const all = JSON.parse(localStorage.getItem(CHOICES_KEY) || '{}') || {};
    localStorage.setItem(CHOICES_KEY, JSON.stringify({ ...all, [id]: next }));
  } catch { /* No storage here: the choice lasts for this visit. */ }
}

/**
 * Draw one review and wire it.
 * @param {ReviewSubject} subject
 */
export function mountReview(subject) {
  const total = subject.duration;
  let selected = clamp(subject.selectedMoment || 0, 0, Math.max(subject.moments.length - 1, 0));
  let numberSel = subject.selectedNumber ?? -1;
  let choices = readChoices(subject.id);

  // ---- the frame of the page ----
  wireNav(document); // the sidebar every screen shares
  hook('sample-badge').hidden = !subject.sample;
  $('range').innerHTML = `${ic('calendar')}<span></span>`;
  $('range').lastElementChild.textContent = subject.range;
  $('play').innerHTML = ic('play');
  $('mute').innerHTML = ic('volume');
  $('full').innerHTML = ic('full');
  $('spark-ic').innerHTML = ic('sparkle');
  $('send').innerHTML = ic('send', 16);
  hook('video-title').textContent = subject.title;
  hook('published').textContent = subject.published;
  $('ask-input').placeholder = subject.placeholder;
  document.title = `YAP · Review · ${subject.title}`;

  // ---- the numbers ----
  function sparkSvg(vals, down) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 70).toFixed(1)},${(24 - (v - min) / (max - min || 1) * 20).toFixed(1)}`).join(' ');
    return `<svg class="spark${down ? ' down' : ''}" viewBox="0 0 70 26" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }
  function renderNumbers() {
    const kpis = $('kpis');
    kpis.style.gridTemplateColumns = `repeat(${subject.numbers.length}, 1fr)`;
    kpis.replaceChildren(...subject.numbers.map((k, i) => {
      const card = el('div', `kpi${i === numberSel ? ' alert' : ''}`);
      Object.assign(card.dataset, { testid: 'kpi', kpi: k.label, selected: String(i === numberSel) });
      card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-pressed', String(i === numberSel));
      card.innerHTML = ic(k.icon);
      const body = el('div', 'kpi-body');
      const val = el('span', 'kpi-val', k.value);
      if (k.unit) val.append(el('small', '', k.unit));
      body.append(val);
      if (typeof k.delta === 'number') {
        const down = k.delta < 0;
        body.append(el('span', `delta${down ? ' down' : ''}`, `${down ? '↓' : '↑'} ${Math.abs(k.delta)}%`));
        if (k.spark) body.insertAdjacentHTML('beforeend', sparkSvg(k.spark, down));
      } else if (k.note) body.append(el('span', 'kpi-note', k.note));
      card.append(el('span', 'kpi-label', k.label), body);
      return card;
    }));
  }

  // ---- the chart ----
  const x = (t) => (total > 0 ? clamp(t / total, 0, 1) : 0);
  const path = (pts) => pts.map(([t, h], i) => `${i ? 'L' : 'M'}${(x(t) * 1000).toFixed(1)},${(100 - clamp(h, 0, 1) * 100).toFixed(1)}`).join(' ');
  function renderChart() {
    const c = subject.chart;
    hook('chart-head').hidden = !c;
    $('chart').hidden = !c;
    if (!c) return;
    hook('chart-heading').textContent = c.heading;
    $('info').innerHTML = ic('info');
    $('info').title = c.label;
    hook('legend').replaceChildren(...c.legend.map((l) => { const s = el('span'); s.append(el('i', `dot ${l.tone}`), document.createTextNode(l.label)); return s; }));
    const grid = c.yTicks.map((y) => `<line class="gridline" x1="0" x2="1000" y1="${100 - y.at * 100}" y2="${100 - y.at * 100}"/>`).join('');
    const bands = (c.bands || []).map((b) => `<rect class="band" x="${(x(b.start) * 1000).toFixed(1)}" y="0" width="${(Math.max(x(b.end) - x(b.start), 0.004) * 1000).toFixed(1)}" height="100"/>`).join('');
    const limit = typeof c.limit === 'number' ? `<line class="line-limit" x1="0" x2="1000" y1="${100 - c.limit * 100}" y2="${100 - c.limit * 100}"/>` : '';
    const other = c.other ? `<path class="line-avg" d="${path(c.other)}"/>` : '';
    const chart = $('chart');
    chart.innerHTML = `<div class="plot" data-testid="plot">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img">${grid}${bands}
        <path class="area-you" d="${path(c.you)} L1000,100 L0,100 Z"/>${limit}${other}<path class="line-you" d="${path(c.you)}"/></svg>
      <div class="marker" data-testid="marker" id="marker"><i id="mdot"></i></div>
      <button class="tooltip" data-testid="tooltip" id="tooltip" type="button"><span class="tip-words" id="tip-words"></span><span class="tip-next" id="tip-next">${ic('chevron', 18)}</span></button></div>`;
    chart.querySelector('svg').setAttribute('aria-label', c.label);
    const plot = chart.querySelector('.plot');
    for (const y of c.yTicks) { const lab = el('span', 'ylab', y.label); lab.style.top = `${100 - y.at * 100}%`; plot.append(lab); }
    for (const t of axisTimes(total)) {
      const lab = el('span', 'xlab', fmt(t));
      lab.style.left = `calc(var(--axis-width) + (100% - var(--axis-width)) * ${x(t)})`;
      chart.append(lab);
    }
    // The label over the line steps to the next key moment, as its arrow says.
    $('tooltip').addEventListener('click', (e) => {
      e.stopPropagation();
      if (selected < subject.moments.length - 1) select(selected + 1);
    });
    // A press on the line picks the key moment nearest to it.
    plot.addEventListener('click', (e) => {
      if (!subject.moments.length) return;
      const box = plot.getBoundingClientRect();
      const t = clamp((e.clientX - box.left) / box.width, 0, 1) * total;
      select(subject.moments.reduce((best, m, i) => (Math.abs(m.time - t) < Math.abs(subject.moments[best].time - t) ? i : best), 0));
    });
  }

  // ---- the key moments ----
  function renderMoments() {
    const row = $('moments');
    row.style.gridTemplateColumns = `repeat(${Math.max(subject.moments.length, 6)}, 1fr)`;
    row.replaceChildren(...subject.moments.map((m, i) => {
      const b = el('button', 'moment');
      b.type = 'button';
      Object.assign(b.dataset, { testid: 'moment', time: m.clock, seconds: String(m.time), selected: String(i === selected) });
      b.setAttribute('aria-pressed', String(i === selected));
      const tile = el('span', 'tile');
      const img = el('img'); img.alt = '';
      if (m.img) img.src = m.img;
      tile.append(img);
      b.append(tile, el('span', 'l', m.clock), el('span', 'l', m.label));
      return b;
    }));
  }
  /** A person's own take has no drawn tiles: each one is a frame of the take at its moment. */
  async function drawFrames() {
    const wanted = subject.moments.map((m, i) => ({ m, i })).filter(({ m }) => !m.img);
    if (!wanted.length) return;
    const source = document.createElement('video');
    source.muted = true; source.preload = 'auto'; source.playsInline = true; source.src = subject.media.src;
    const once = (name) => new Promise((resolve, reject) => { source.addEventListener(name, resolve, { once: true }); source.addEventListener('error', reject, { once: true }); });
    try {
      await once('loadeddata');
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = Math.round(256 * source.videoHeight / source.videoWidth) || 144;
      for (const { m, i } of wanted) {
        source.currentTime = clamp(m.time, 0.05, Math.max(total - 0.25, 0.05));
        await once('seeked');
        canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
        const img = $('moments').children[i]?.querySelector('img');
        if (img) img.src = canvas.toDataURL('image/jpeg', 0.78);
      }
    } catch { /* The frames could not be read: the tiles stay on their warm ground. */ }
    source.removeAttribute('src'); source.load();
  }

  // ---- the player ----
  // A video with footage plays it. The sample video has no footage, only its own stills, so its player
  // shows the still that belongs to the time: the bar stops on each still's time and nowhere between.
  const stills = subject.media.stills || null;
  const player = stills ? stillsPlayer(stills) : footagePlayer();
  const { seekTo, position } = player;
  function showTime(at) {
    $('time').textContent = `${fmt(at)} / ${fmt(total)}`;
    $('progress').style.width = `${total > 0 ? clamp(at / total, 0, 1) * 100 : 0}%`;
  }
  function playing(on, label = 'Play') {
    $('play').innerHTML = ic(on ? 'pause' : 'play');
    $('play').setAttribute('aria-label', on ? 'Pause' : label);
  }

  function footagePlayer() {
    const video = document.createElement('video');
    video.setAttribute('data-testid', 'video');
    video.preload = 'metadata';
    video.playsInline = true;
    if (subject.media.sampleFootage) video.className = 'sample-footage';
    video.src = subject.media.src;
    let pending = null;
    const clip = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : total);
    const at = () => clamp(video.currentTime || 0, 0, total);
    function seek(seconds) {
      const t = clamp(seconds, 0, total);
      if (video.readyState < 1) { pending = t; showTime(t); return; }
      video.currentTime = Math.min(t, Math.max(clip() - 0.05, 0));
      showTime(t);
    }
    video.addEventListener('loadedmetadata', () => { if (pending !== null) { const t = pending; pending = null; seek(t); } else showTime(at()); });
    video.addEventListener('timeupdate', () => { if (pending === null) showTime(at()); });
    video.addEventListener('play', () => playing(true));
    video.addEventListener('pause', () => playing(false));
    $('mute').addEventListener('click', () => {
      video.muted = !video.muted;
      $('mute').setAttribute('aria-pressed', String(video.muted));
      $('mute').setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    });
    return { nodes: [video], seekTo: seek, position: at, toggle: () => { if (video.paused) video.play().catch(() => {}); else video.pause(); } };
  }

  function stillsPlayer(list) {
    const HOLD_MS = 3200;
    const LABEL = 'Play through the key moments';
    const ground = el('img', 'still-ground'); ground.alt = '';
    const picture = el('img', 'still'); picture.alt = ''; picture.dataset.testid = 'still';
    let now = 0, timer = 0;
    const nearest = (t) => list.reduce((best, s, i) => (Math.abs(s.at - t) < Math.abs(list[best].at - t) ? i : best), 0);
    function show(i) {
      now = i;
      const s = list[i];
      if (picture.getAttribute('src') !== s.img) { picture.src = s.img; ground.src = s.img; }
      document.querySelector('.screen').dataset.still = s.small ? 'tile' : 'frame';
      picture.dataset.at = fmt(s.at);
      showTime(s.at);
    }
    /** The key moment a still belongs to goes with it: the chart, the tile and YAP's reading. */
    function follow() {
      const i = subject.moments.findIndex((m) => m.time === list[now].at);
      if (i >= 0 && i !== selected) select(i, false);
    }
    function stop() { clearInterval(timer); timer = 0; playing(false, LABEL); }
    function toggle() {
      if (timer) { stop(); return; }
      show(now >= list.length - 1 ? 0 : now + 1); follow();
      if (now >= list.length - 1) return;
      playing(true);
      timer = setInterval(() => { show(now + 1); follow(); if (now >= list.length - 1) stop(); }, HOLD_MS);
    }
    // The stops of the bar: one mark at each still's time.
    for (const s of list) { const mark = el('i', 'stop'); mark.style.left = `${x(s.at) * 100}%`; hook('seek').append(mark); }
    $('mute').hidden = true;
    playing(false, LABEL);
    return {
      nodes: [ground, picture], toggle,
      position: () => list[now].at,
      /** Go to the still nearest a time. `sync`: the person moved the bar, so the key moment follows. */
      seekTo: (seconds, sync = false) => { if (timer) stop(); show(nearest(clamp(seconds, 0, total))); if (sync) follow(); },
    };
  }

  // ---- YAP's reading ----
  const say = (text) => { $('answer').textContent = text; };
  function select(i, jump = true) {
    if (!subject.moments.length) return;
    selected = i;
    const m = subject.moments[i];
    document.querySelectorAll('[data-testid="moment"]').forEach((b, j) => { b.dataset.selected = String(j === i); b.setAttribute('aria-pressed', String(j === i)); });
    if (subject.chart) {
      const left = `${x(m.time) * 100}%`;
      $('marker').style.left = left;
      $('mdot').style.top = `${100 - clamp(heightAt(subject.chart.you, m.time), 0, 1) * 100}%`;
      const tip = $('tooltip');
      tip.style.left = left;
      tip.dataset.side = x(m.time) > 0.7 ? 'left' : x(m.time) < 0.06 ? 'start' : 'right';
      $('tip-words').replaceChildren(document.createTextNode(m.clock), el('b', '', m.tip));
      const last = i >= subject.moments.length - 1;
      $('tip-next').hidden = last;
      tip.disabled = last;
      tip.setAttribute('aria-label', last ? `${m.clock}, ${m.tip}` : `${m.clock}, ${m.tip}. Next key moment`);
    }
    if (jump) seekTo(m.time);
    hook('question').textContent = 'What happened here?';
    say(m.reading);
  }
  function pickNumber(i) {
    numberSel = i;
    renderNumbers();
    const label = subject.numbers[i].label;
    hook('question').textContent = `What does ${/^[A-Z]{2,}\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)} tell me?`;
    say(subject.numbers[i].reply);
  }

  // ---- hear it: the browser's own voice reads YAP's reading aloud; the button shows only where a voice exists ----
  const voice = globalThis.speechSynthesis;
  if (voice && typeof globalThis.SpeechSynthesisUtterance === 'function') {
    const hear = $('hear');
    hear.innerHTML = ic('voice', 22);
    const quiet = () => { hear.setAttribute('aria-pressed', 'false'); hear.setAttribute('aria-label', "Hear YAP's reading"); };
    const offer = () => { hear.hidden = voice.getVoices().length === 0; };
    offer();
    voice.addEventListener('voiceschanged', offer);
    hear.addEventListener('click', () => {
      if (hear.getAttribute('aria-pressed') === 'true') { voice.cancel(); quiet(); return; }
      const words = new SpeechSynthesisUtterance($('answer').textContent);
      words.onend = quiet; words.onerror = quiet;
      voice.cancel();
      voice.speak(words);
      hear.setAttribute('aria-pressed', 'true'); hear.setAttribute('aria-label', 'Stop reading');
    });
    globalThis.addEventListener('pagehide', () => voice.cancel());
  }

  // ---- the one experiment: try it, change its words, or set it aside ----
  const tryingSlot = $('trying');
  const showTrying = () => mountTrying(tryingSlot, { sample: subject.sample, onChange: renderExperiment }).catch(() => undefined);
  function renderExperiment() {
    const box = $('experiment');
    const exp = subject.experiment;
    box.hidden = !exp;
    if (!exp) return;
    const text = choices.text || exp.text;
    const lesson = { text, source: subject.source };
    if (choices.dismissed) {
      box.className = 'experiment set-aside';
      const back = el('button', 'link', 'Bring it back');
      back.type = 'button'; back.dataset.testid = 'experiment-restore';
      back.addEventListener('click', () => { choices = { ...choices, dismissed: false }; saveChoices(subject.id, choices); renderExperiment(); });
      const line = el('p', 'exp-text', 'Experiment set aside. ');
      line.dataset.testid = 'experiment-dismissed';
      line.append(back);
      box.replaceChildren(line);
      return;
    }
    box.className = 'experiment';
    const title = el('div', 'exp-title');
    title.innerHTML = `${ic('bulb', 18)}<b>Simple experiment</b>`;
    const words = el('p', 'exp-text', exp.more ? `${text} ${exp.more}` : text);
    words.dataset.testid = 'exp-text';
    const thumbs = el('div', 'thumbs');
    const tile = (side, name, testid) => {
      const t = el('div', `thumb${name === 'Proposed' ? ' proposed' : ''}${side.img ? '' : ' words'}`);
      t.dataset.testid = testid;
      if (side.img) { const img = el('img'); img.src = side.img; img.alt = `${name} thumbnail`; t.append(img); } else t.append(el('span', 'thumb-tag', name), el('span', 'thumb-words', side.text));
      return t;
    };
    const arrow = el('span', 'arrow'); arrow.innerHTML = ic('arrowright', 18);
    thumbs.append(tile(exp.current, 'Current', 'thumb-current'), arrow, tile(exp.proposed, 'Proposed', 'thumb-proposed'));
    const action = el('div'); action.dataset.testid = 'lesson-action';
    box.replaceChildren(title, words, thumbs, action);
    mountLessonAction(action, {
      store: subject.store, lesson, carries: carriesLesson, onChange: showTrying,
      onAdjust: () => adjust(box, words, text),
      onDismiss: () => { choices = { ...choices, dismissed: true }; saveChoices(subject.id, choices); renderExperiment(); },
    });
  }
  /** Adjust: the person rewrites the experiment in their own words before trying it. */
  function adjust(box, words, text) {
    const field = el('textarea', 'adjust');
    field.dataset.testid = 'adjust-text'; field.rows = 3; field.maxLength = 240; field.value = text;
    field.setAttribute('aria-label', 'The experiment in your words');
    const save = el('button', 'lesson-use', 'Save'); save.type = 'button'; save.dataset.testid = 'adjust-save';
    const cancel = el('button', 'lesson-keep', 'Cancel'); cancel.type = 'button'; cancel.dataset.testid = 'adjust-cancel';
    const row = el('div', 'lesson-row'); row.append(save, cancel);
    words.replaceWith(field);
    hook('lesson-action').replaceChildren(row);
    field.focus();
    save.addEventListener('click', () => {
      const next = field.value.replace(/\s+/g, ' ').trim();
      if (next) { choices = { ...choices, text: next === subject.experiment.text ? '' : next }; saveChoices(subject.id, choices); }
      renderExperiment();
    });
    cancel.addEventListener('click', renderExperiment);
  }

  // ---- ask ----
  function addBubble(kind, text) {
    const b = el('div', `bubble ${kind}`, text);
    b.setAttribute('data-testid', `msg-${kind === 'you' ? 'you' : 'yap'}`);
    $('thread').appendChild(b);
    $('scroller').scrollTop = $('scroller').scrollHeight;
    return b;
  }
  let asking = false;
  async function ask() {
    const input = $('ask-input'), q = input.value.trim();
    if (!q || asking) return;
    asking = true;
    input.value = '';
    $('send').disabled = true;
    addBubble('you', q);
    const reply = addBubble('yap', '');
    reply.classList.add('thinking');
    reply.setAttribute('aria-busy', 'true');
    reply.setAttribute('aria-label', 'YAP is thinking');
    try {
      const a = await subject.answer(q);
      reply.textContent = a.text;
      if (a.suggestion) { const next = el('span', 'try-next', `Try next: ${a.suggestion}`); reply.append(next); }
    } finally {
      reply.classList.remove('thinking');
      reply.removeAttribute('aria-busy');
      reply.removeAttribute('aria-label');
      asking = false;
      $('send').disabled = false;
      $('scroller').scrollTop = $('scroller').scrollHeight;
    }
  }

  // ---- draw, then wire ----
  renderNumbers(); renderChart(); renderMoments(); renderExperiment(); showTrying();
  document.querySelector('.screen').replaceChildren(...player.nodes);
  if (subject.moments.length) select(selected, false); else { hook('question').hidden = true; say(subject.numbers[0]?.reply || ''); }
  // The sample opens where the Loom frame does; a take opens on its selected moment.
  seekTo(subject.media.start ?? (subject.moments[selected]?.time || 0));
  drawFrames();

  $('play').addEventListener('click', player.toggle);
  $('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else hook('player').requestFullscreen().catch(() => {});
  });
  // The bar: a press goes there, and holding it down drags.
  const seekBar = hook('seek');
  const seekAt = (e) => { const box = seekBar.getBoundingClientRect(); seekTo(clamp((e.clientX - box.left) / box.width, 0, 1) * total, true); };
  seekBar.addEventListener('pointerdown', (e) => { seekBar.setPointerCapture(e.pointerId); seekAt(e); });
  seekBar.addEventListener('pointermove', (e) => { if (seekBar.hasPointerCapture(e.pointerId)) seekAt(e); });
  $('moments').addEventListener('click', (e) => {
    const b = e.target.closest('[data-testid="moment"]'); if (!b) return;
    select([...$('moments').children].indexOf(b));
  });
  const numberOf = (e) => { const k = e.target.closest('[data-testid="kpi"]'); return k ? [...$('kpis').children].indexOf(k) : -1; };
  $('kpis').addEventListener('click', (e) => { const i = numberOf(e); if (i >= 0) pickNumber(i); });
  $('kpis').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const i = numberOf(e); if (i < 0) return;
    e.preventDefault(); pickNumber(i);
  });
  $('send').addEventListener('click', ask);
  $('ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) ask(); });
  return { seekTo, select, position };
}
