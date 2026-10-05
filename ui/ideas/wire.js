// The Ideas opening, wired (D-110, D-112). The page is the approved shell, and
// its own script (ideas.js) still enables Send and fires the shell's events.
// This module answers those events and wires the nav. Outside shell mode it
// also sets the front door for a first visit: one button that plays the sample
// take, "Need a spark?" offering a sentence to finish from the format library,
// and a template carried in from the gallery's popular formats.
import { go, sayQuietly, wireNav, isShellMode } from '../lib/app.js';
import { APP_API, createIdea, createRecordingFor } from '../lib/api.js';
import { talkInto } from '../lib/idea-wire.js';
import { SPARKS, isTemplate, templateOf } from '../../src/engine/formats.js';
import { recordingRequest } from '../lib/prepare-model.js';
import { routeFor } from '../lib/routes.js';

const hook = (id) => document.querySelector(`[data-testid="${id}"]`);
const box = hook('idea-input');
const send = hook('send');
const talk = hook('talk-to-yap');
const savedIdeas = hook('saved-ideas');
const spark = hook('need-spark');
const chips = [...document.querySelectorAll('.chip')];
const shell = isShellMode(location);
/** The template a popular format of the gallery sent the person here with, or null. */
const wanted = new URLSearchParams(location.search).get('template');
const template = !shell && isTemplate(wanted) ? templateOf(wanted) : null;

wireNav(document);

// Send keeps the typed thought as a new idea and opens its first conversation.
let sending = false;
document.addEventListener('yap:idea-submit', async (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  const thought = String((detail && detail.text) || '').trim();
  if (!thought || sending) return;
  sending = true;
  try {
    const { id } = await createIdea(thought);
    // An idea started from a popular format is headed there from its first turn.
    if (template) await fetch(`${APP_API}idea-coach/${id}`, { method: 'POST', mode: 'same-origin', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'template', template: template.key, rev: 0 }) }).catch(() => {});
    go(routeFor('idea', { id }));
  } catch (err) {
    // Nothing was kept: say so in the server's own words, and leave the typed words where they are.
    const refused = err && typeof (/** @type {any} */ (err).status) === 'number';
    sayQuietly(document, refused ? /** @type {Error} */ (err).message : 'YAP could not keep that thought: its own server did not answer.');
  } finally {
    sending = false;
  }
});

// Talk to YAP dictates into the text box and says it is listening at once; a second press stops it.
document.addEventListener('yap:talk', () => {
  talkInto(box, talk);
});

// Saved ideas opens the Create gallery.
savedIdeas.addEventListener('click', () => go(routeFor('gallery')));

// A chip says what kind of start this is: it sets the question in the box and puts the cursor there.
// In shell mode the drawn chips stay as drawn. The shell's own script lights a pressed chip; this runs
// after it (a click reaches the document last) and settles which one stays lit.
document.addEventListener('click', (event) => {
  const target = /** @type {any} */ (event.target);
  const chip = target && typeof target.closest === 'function' ? target.closest('.chip') : null;
  if (!chip || !chips.includes(chip)) return;
  for (const each of chips) each.setAttribute('aria-pressed', 'false');
  if (shell) return;
  chip.setAttribute('aria-pressed', 'true');
  box.placeholder = chip.dataset.testid === 'chip-think' ? 'What are you trying to work out?' : 'What video would you like to make?';
  box.focus();
});

if (!shell) {
  // Enter sends, as a person expects of a conversation; Shift and Enter makes a new line.
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!send.disabled) send.click();
  });

  // Need a spark? writes a sentence to finish into the box, one for each format in turn.
  // Words the person already typed are theirs: the spark is then said beside them, not over them.
  let sparkAt = -1;
  spark.addEventListener('click', (event) => {
    event.preventDefault();
    sparkAt = (sparkAt + 1) % SPARKS.length;
    const next = SPARKS[sparkAt];
    const own = box.value.trim() !== '' && !SPARKS.some((each) => each.text === box.value);
    if (own) {
      sayQuietly(document, `A way in: “${next.text.trim()}…”`);
      return;
    }
    box.value = next.text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    box.setSelectionRange(next.text.length, next.text.length);
  });

  if (template) {
    hook('idea-status').textContent = `Not started · ${template.name}`;
    box.placeholder = `Start with a rough thought for ${/^[aeiou]/i.test(template.name) ? 'an' : 'a'} ${template.name}...`;
  }

  // The first thing to try: the bundled sample take, playing through YAP.
  const watch = document.createElement('button');
  watch.type = 'button';
  watch.className = 'watch';
  watch.dataset.testid = 'watch-yap-work';
  const play = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  play.setAttribute('viewBox', '0 0 24 24');
  play.innerHTML = '<path d="M8 5.5v13l10.5-6.5z"/>';
  watch.append(play, document.createTextNode('Watch YAP work'));
  hook('idea-empty-sub').after(watch);

  let opening = false;
  watch.addEventListener('click', async () => {
    if (opening) return;
    opening = true;
    watch.disabled = true;
    try {
      const { id } = await createRecordingFor(recordingRequest({ ideaId: 'sample' }, [], { sample: true }));
      go(`${routeFor('record', { id })}?sample=1`);
    } catch {
      opening = false;
      watch.disabled = false;
      sayQuietly(document, 'YAP could not open the sample take. Try again.');
    }
  });

  const look = document.createElement('style');
  look.textContent = [
    '[hidden] { display:none !important; }',
    '.watch { display:inline-flex; align-items:center; gap:12px; height:54px; margin-top:4.2vh; padding:0 30px 0 24px; border:1.5px solid var(--amber); border-radius:var(--radius-pill); background:var(--amber-tint); color:var(--white); font-size:17px; font-weight:600; box-shadow:0 0 26px var(--amber-tint); cursor:pointer; }',
    '.watch svg { width:20px; height:20px; fill:var(--amber); stroke:none; }',
    '.watch:hover { background:rgba(244,198,107,.24); }',
    '.watch:disabled { opacity:.6; cursor:default; }',
  ].join('\n');
  document.head.append(look);
}
