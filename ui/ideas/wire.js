// The Ideas opening, wired (D-110, D-112). The page is the approved shell, and
// its own script (ideas.js) still enables Send and fires the shell's events.
// This module answers those events and wires the nav; it draws nothing, and
// the right-hand panel stays "Not started".
import { comingSoon, go, sayQuietly, wireNav, isShellMode } from '../lib/app.js';
import { createIdea } from '../lib/api.js';
import { dictateInto } from '../lib/dictate.js';
import { routeFor } from '../lib/routes.js';
import { startIdeaChat } from '../lib/idea-chat.js';

const hook = (id) => document.querySelector(`[data-testid="${id}"]`);
const box = hook('idea-input');
const talk = hook('talk-to-yap');
const savedIdeas = hook('saved-ideas');
const spark = hook('need-spark');
const chips = [...document.querySelectorAll('.chip')];

// Ideas and Create open their screens; Home, Review and Grow say coming soon (D-110).
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
    // Keep the first thought as the first message of the conversation. YAP answers it once the idea opens.
    if (!isShellMode(location)) await startIdeaChat(id, thought);
    go(routeFor('idea', { id }));
  } catch (err) {
    // Nothing was kept: say so in the server's own words, and leave the typed words where they are.
    const refused = err && typeof (/** @type {any} */ (err).status) === 'number';
    sayQuietly(document, refused ? /** @type {Error} */ (err).message : 'YAP could not keep that thought: its own server did not answer.');
  } finally {
    sending = false;
  }
});

// Talk to YAP dictates into the text box; a second press stops it.
document.addEventListener('yap:talk', () => {
  dictateInto(box, { control: talk });
});

// Saved ideas opens the Create gallery.
savedIdeas.addEventListener('click', () => go(routeFor('gallery')));

// Need a spark? is not built yet.
spark.addEventListener('click', () => comingSoon(document, spark.textContent, spark));

// The two chips are not built yet. The shell's own script lights a pressed
// chip; this runs after it (a click reaches the document last) and puts the
// chip back, so nothing looks chosen that YAP does not act on.
document.addEventListener('click', (event) => {
  const target = /** @type {any} */ (event.target);
  const chip = target && typeof target.closest === 'function' ? target.closest('.chip') : null;
  if (!chip || !chips.includes(chip)) return;
  for (const each of chips) each.setAttribute('aria-pressed', 'false');
  if(isShellMode(location))comingSoon(document, chip.textContent, chip);else {chip.setAttribute('aria-pressed','true');box.placeholder=chip.dataset.testid==='chip-think'?'What are you trying to work out?':'What video would you like to make?';box.focus();}
});

if(!isShellMode(location)){
 const recordings = document.createElement('a');
 recordings.className = savedIdeas.className; recordings.href = '/prepare/new';
 recordings.dataset.testid = 'recent-recordings'; recordings.textContent = 'Recent recordings';
 savedIdeas.after(recordings);
 const presenting = document.createElement('a');
 presenting.className = savedIdeas.className; presenting.href = '/present';
 presenting.dataset.testid = 'presentation-link'; presenting.textContent = 'Presentation';
 recordings.after(presenting);
 const fit = document.createElement('style');
 fit.textContent = '.chips{flex-wrap:wrap}.chip{white-space:normal;min-width:0;flex:1 1 145px;padding:8px 10px;gap:8px;height:auto;min-height:58px}.chip svg{flex-shrink:0}.links{display:flex;flex-wrap:wrap;gap:14px}.link{min-width:0}.link:last-child{border:0;padding-left:0}';
 document.head.append(fit);

 spark.textContent='Need a spark? · coming soon';spark.setAttribute('aria-disabled','true');spark.style.opacity='.55';
 for(const hook of ['nav-home','nav-grow']){const item=document.querySelector(`[data-testid="${hook}"]`);if(item){item.append(document.createTextNode(' · soon'));item.setAttribute('aria-disabled','true');}}
}
