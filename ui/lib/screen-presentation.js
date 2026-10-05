// The page side of screen presentation capture (/record/:id?presentation=1):
// the explicit Start card, the Full camera / Bubble switch, and the recovery
// card. All of it is app chrome: none of it is drawn into the recording.
// Text is set with textContent only.

export const COPY = Object.freeze({
 title: 'Present your screen',
 choose: 'Choose the window or tab to present.',
 detail: 'Pick the window or tab you want to show, not this one, so YAP does not record itself. You can choose your whole screen if you want to. YAP records your camera, your microphone and the screen you choose as one video.',
 audio: 'Microphone only. Your computer’s sound is not recorded.',
 start: 'Start screen presentation',
 retry: 'Try again',
 cameraOnly: 'Record camera only instead',
 waiting: 'Choose what to share in your browser’s window…',
 working: 'Starting your camera and microphone…',
 bubble: 'Screen + bubble',
 full: 'Full camera',
 recoverTitle: 'Screen sharing stopped',
 recoverBody: 'Your recording so far is safe and paused. Choose a window or tab to carry on, or stop and save what you have.',
 recoverButton: 'Choose a window or tab',
 recoverStop: 'Stop and save',
 deviceLost: reason => `Your ${reason} stopped, so the recording was stopped and saved.`
});

export const presentationRequested = (search, {sample = false, shell = false} = {}) => !sample && !shell && new URLSearchParams(search).get('presentation') === '1';

/** The same take, camera only: the presentation flag removed, everything else kept. */
export function cameraOnlyHref(loc) {
 const params = new URLSearchParams(loc.search);params.delete('presentation');
 const query = params.toString();
 return `${loc.pathname}${query ? `?${query}` : ''}`;
}

export const modeLabel = mode => (mode === 'full' ? COPY.full : COPY.bubble);
export const statusLine = label => `Presenting ${label}`;

export function ensureStyles(doc) {
 if (doc.querySelector('link[data-presentation-styles]')) return;
 const link = doc.createElement('link');link.rel = 'stylesheet';link.href = '../lib/screen-presentation.css';link.dataset.presentationStyles = 'true';
 doc.head.append(link);
}

function el(doc, tag, props = {}, ...children) {
 const node = doc.createElement(tag);
 for (const [k, v] of Object.entries(props)) {
  if (k === 'class') node.className = v;
  else if (k === 'text') node.textContent = v;
  else if (k === 'data') Object.assign(node.dataset, v);
  else node.setAttribute(k, v);
 }
 node.append(...children);
 return node;
}

/**
 * Show the Start card and wait for the person. `start` is called synchronously
 * inside the button's click so the browser's picker sees the gesture; nothing
 * is shared or recorded before that click. A failed attempt shows its reason
 * and leaves the button ready for another try. Resolves with the recorder.
 */
export function waitForPresentationStart({doc, start, cameraHref}) {
 ensureStyles(doc);
 const shell = doc.querySelector('.live-shell');
 const status = el(doc, 'p', {class: 'present-status', role: 'status', 'aria-live': 'polite', data: {testid: 'present-status'}});
 const button = el(doc, 'button', {class: 'present-start', type: 'button', text: COPY.start, data: {testid: 'present-start'}});
 const camera = el(doc, 'a', {class: 'present-camera-only', href: cameraHref, text: COPY.cameraOnly, data: {testid: 'present-camera-only'}});
 const card = el(doc, 'section', {class: 'present-card glass', 'aria-labelledby': 'present-title', data: {testid: 'present-card'}},
  el(doc, 'h1', {id: 'present-title', text: COPY.title}),
  el(doc, 'p', {class: 'present-choose', text: COPY.choose}),
  el(doc, 'p', {class: 'present-detail', text: COPY.detail}),
  el(doc, 'p', {class: 'present-audio', text: COPY.audio}),
  status, button, camera);
 const overlay = el(doc, 'div', {class: 'present-start-screen', data: {testid: 'present-start-screen'}}, card);
 shell.append(overlay);
 doc.documentElement.dataset.presentation = 'start';
 button.focus();
 return new Promise(resolve => {
  let busy = false;
  button.addEventListener('click', () => {
   if (busy) return;busy = true;button.disabled = true;status.dataset.state = 'waiting';status.textContent = COPY.waiting;
   let attempt;
   try {attempt = start();} catch (error) {attempt = Promise.reject(error);}
   attempt.then(recorder => {overlay.remove();doc.documentElement.dataset.presentation = 'recording';resolve(recorder);}, error => {
    busy = false;button.disabled = false;button.textContent = COPY.retry;status.dataset.state = 'error';status.textContent = error?.message || String(error);button.focus();
   });
  });
 });
}

/** Full camera / Bubble switch plus the sharing status. Returns {sync, destroy}. */
export function mountPresentationBar({doc, recorder, onChange = () => {}}) {
 const shell = doc.querySelector('.live-shell');
 const buttons = {};
 const group = el(doc, 'div', {class: 'present-switch glass', role: 'group', 'aria-label': 'Presenter view'});
 for (const mode of ['bubble', 'full']) {
  buttons[mode] = el(doc, 'button', {type: 'button', class: 'present-mode', text: modeLabel(mode), data: {testid: `present-mode-${mode}`, mode}});
  buttons[mode].addEventListener('click', () => change(mode));
  group.append(buttons[mode]);
 }
 const label = el(doc, 'p', {class: 'present-sharing glass', data: {testid: 'present-sharing'}}, el(doc, 'span', {class: 'present-dot', 'aria-hidden': 'true'}), el(doc, 'span', {text: statusLine(recorder.screenLabel)}), el(doc, 'span', {class: 'present-mic', text: 'Microphone only'}));
 const bar = el(doc, 'div', {class: 'present-bar', data: {testid: 'present-bar'}}, label, group);
 shell.append(bar);shell.classList.add('is-presenting');
 function sync() {
  const mode = recorder.mode();
  for (const [m, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(m === mode));
  doc.documentElement.dataset.presentMode = mode;
  label.children[1].textContent = statusLine(recorder.screenLabel);
 }
 function change(mode) {recorder.setMode(mode);sync();onChange(mode);}
 sync();
 return {
  sync, change,
  toggle: () => change(recorder.mode() === 'full' ? 'bubble' : 'full'),
  destroy() {bar.remove();shell.classList.remove('is-presenting');delete doc.documentElement.dataset.presentMode;}
 };
}

/** The explicit recovery action after the shared screen ends. Returns {setError, destroy}. */
export function showRecoverCard({doc, onChoose, onStop}) {
 const shell = doc.querySelector('.live-shell');
 const status = el(doc, 'p', {class: 'present-status', role: 'status', 'aria-live': 'polite', data: {testid: 'recover-status'}});
 const choose = el(doc, 'button', {type: 'button', class: 'present-start', text: COPY.recoverButton, data: {testid: 'recover-choose'}});
 const stop = el(doc, 'button', {type: 'button', class: 'present-secondary', text: COPY.recoverStop, data: {testid: 'recover-stop'}});
 const card = el(doc, 'section', {class: 'present-card present-recover glass', role: 'alertdialog', 'aria-labelledby': 'recover-title', data: {testid: 'recover-card'}},
  el(doc, 'h1', {id: 'recover-title', text: COPY.recoverTitle}), el(doc, 'p', {class: 'present-detail', text: COPY.recoverBody}), status, choose, stop);
 const overlay = el(doc, 'div', {class: 'present-start-screen', data: {testid: 'recover-screen'}}, card);
 shell.append(overlay);choose.focus();
 choose.addEventListener('click', () => {
  choose.disabled = true;status.textContent = COPY.waiting;
  let attempt;try {attempt = onChoose();} catch (error) {attempt = Promise.reject(error);}
  attempt.then(() => overlay.remove(), error => {choose.disabled = false;status.textContent = error?.message || String(error);choose.focus();});
 });
 stop.addEventListener('click', () => {overlay.remove();onStop();});
 return {destroy: () => overlay.remove(), isOpen: () => overlay.isConnected, focus: () => choose.focus()};
}
