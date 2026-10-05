// The Review detail at /review/<id>. Three things can live at such an address: a take recorded in
// YAP (drawn on the review page of the Loom frame, from what YAP measured in the take), a video the
// person brought in as a file (upload.js), and nothing. A sample card opens the sample review instead.
import { go } from '../lib/app.js';
import { openTake } from './take.js';

const id = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

/** Swap the page for the one a brought-in video uses: its own markup and its own two stylesheets. */
async function uploadPage() {
  document.querySelector('link[data-page="take"]').remove();
  for (const href of ['/ui/review/styles.css', '/ui/reviewdetail/styles.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
  // The sidebar stays: only the page beside it is swapped.
  document.querySelector('.app > main').replaceWith(document.getElementById('upload-page').content.cloneNode(true));
  const { openUpload } = await import('./upload.js');
  return openUpload(id);
}

/** No review lives here: say so on the page's own ground, with the way back. */
function nothingHere() {
  const main = document.querySelector('[data-testid="take-review"]');
  const line = document.createElement('p');
  line.className = 'missing';
  line.dataset.testid = 'not-found';
  line.textContent = 'There is no review at this address. ';
  const back = document.createElement('a');
  back.href = '/review';
  back.dataset.testid = 'back-to-inbox';
  back.textContent = 'Open the Review inbox';
  back.addEventListener('click', (e) => { e.preventDefault(); go('/review'); });
  line.append(back);
  main.querySelector('.head').after(line);
  for (const part of main.querySelectorAll(':scope > .kpis, :scope > .cols')) part.remove();
  main.dataset.state = 'missing';
}

if (/^sample-/.test(id)) location.replace('/review/sample-video');
else if (/^upload-[0-9a-f]{64}$/.test(id)) uploadPage();
else openTake(id).then((found) => { if (!found) nothingHere(); }, nothingHere);
