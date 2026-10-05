#!/usr/bin/env node
// The walks and the check command (Plan 02-02; D-107, D-142 to D-146, D-153).
//
//   node scripts/walk.js <loop|own-take|full|review> [--until <leg>]
//   node scripts/walk.js checks
//
// A walk drives the app in a real browser, on a server it starts itself on
// 127.0.0.1 on a free port, with OPENAI_API_KEY removed and its own data folder
// at .tmp/walk/data-<mode>, emptied first. It prints one line per leg and a last
// line that starts "PASS walk:<mode>" or "FAIL". It fails on a console error, a
// page error, a request to anything but its own server, and an answer of 400 or
// above. Everything it writes is under .tmp/: the data folder, the browser's
// scratch files, and at most 2 screenshots per screen in .tmp/walk/ (D-146).
//
// The three walks are the legs of D-107 (loop), D-144 (own-take) and D-143
// (full), in the PRD's order. A leg is built when LEGS holds a function for it.
// HOW A LATER PLAN ADDS A LEG: add `'<leg-name>': async (walk) => { ... }` to
// LEGS below. Nothing else changes. Until then the leg is "not built yet":
//   - before the first built leg of a walk, it is printed as not built yet and
//     passed over (the loop walk started at the gallery until Plan 02-04 wired
//     the Ideas opening; it now starts at /);
//   - anywhere else, or named by --until, it fails the walk by name. A walk
//     never passes quietly over a leg it was asked for.
//
// `checks` is behind `npm run check:shells`. The list of shell checks is the
// `checks` key of test/shells/manifest.json, and that is the one place a check
// is registered: an entry is { screen, check, arg, path }. Each entry is started
// as `node <check> <arg> <server address + path>`, with an argument list and no
// shell, and with the browser driver as NODE_PATH. An entry whose check is not a
// .cjs file under test/shells/, or whose arg is outside test/shells/specs/ and
// ui/, is refused and not run (T-02-27). test/shell-checks.test.js runs the same
// list. No later plan edits this file or package.json to register a check.
//
// The browser driver is the copy tools/browser.js finds (YAP_PLAYWRIGHT).
// Nothing is installed. With no driver, one plain line and exit 1.
//
// Exit codes: 0 passed, 1 failed, 2 the command was not understood.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createYapServer } from '../server/serve.js';
import { validateRecording } from '../src/engine/recording.js';
import { IDEAS_FILE } from '../src/node/idea-store.js';
import { resolveDataDir } from '../src/node/store.js';
import { findBrowserDriver, loadPlaywright, NO_DRIVER_LINE } from '../tools/browser.js';
import { SAMPLE_TAKE_LABEL } from '../ui/lib/prepare-model.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The sample idea's own title, as the gallery's first card and the idea bank have it. */
const SAMPLE_IDEA_TITLE = 'Why I keep putting off filming';
/** The record address of a new Recording: its id is made by the server, so a leg knows only its shape. */
const RECORD_ADDRESS = /^\/record\/([a-z0-9][a-z0-9-]{0,63})$/;
const SAMPLE_RECORD_ADDRESS = /^\/record\/([a-z0-9][a-z0-9-]{0,63})\?sample=1$/;

export const USAGE = 'Usage: node scripts/walk.js <loop|own-take|full|review> [--until <leg>] | node scripts/walk.js checks';

/** The most screenshots kept of one screen (D-146). */
export const SHOTS_PER_SCREEN = 2;

// ---------- the three walks ----------

/** Each leg's words in the PRD (docs/PRD-screens.md, the walks of its Done-when). */
export const LEG_SAYS = Object.freeze({
  'ideas-opening': 'the Ideas opening',
  'saved-ideas': 'Saved ideas',
  'send-thought': 'type a thought and send',
  'first-conversation': 'first conversation',
  'keep-exploring': 'Keep exploring',
  'shaping-the-idea': 'shaping the idea',
  'save-idea': 'Save idea',
  'confirm-idea': 'confirm idea',
  'tick-closing': 'tick Closing',
  'press-confirm-idea': 'Save to ideas',
  gallery: 'the Create gallery',
  'first-card': 'the first card',
  'beat-list': 'the beat list',
  'accept-one-suggestion': 'accept one suggestion',
  'prepare-recording': 'Prepare recording',
  'prepare-stand-in': 'the prepare stand-in',
  'try-the-sample-take': 'Try the sample take',
  'start-recording': 'Start recording',
  'live-mode': 'live mode',
  'live-mode-5s': 'live mode for at least 5 seconds',
  'hey-yap-panel': "the Hey YAP panel opens at the sample's Hey YAP",
  try: 'Try',
  stop: 'stop',
  'first-cut-ready': '"Your first cut is ready"',
  'edit-removed-clips': 'edit with at least 2 removed clips',
  'edit-own-recording': 'edit mode opens on that same Recording',
  'restore-one': 'restore one',
  export: 'export writes a file',
  'file-plays': 'the file plays in a fresh page with a picture, an audio track and a length within 1 second of the take\'s',
  return: 'return shows the kept note, trial 1 of 3 and the last take\'s count',
  'review-take': 'Review this take: its own numbers on one length, a moment moves the player, a typed question is answered, Try this',
  'next-take-carries': 'the next take names what YAP is trying, with no bet wording',
  'review-nav': 'nav Review opens the inbox',
  'review-inbox': 'the inbox, four cards under Needs review',
  'review-open': 'Open review on the first card: the stand-in, sample labelled',
  'review-retention': 'pick a part of the retention line, the player jumps',
  'review-ctr': 'pick click-through rate, the reply changes',
  'review-not-used': 'a suggestion nobody used keeps no lesson',
  'review-use-twice': 'Try this twice, reload, exactly one lesson',
  'review-waiting': 'back to the inbox, that video under Waiting for results',
  'review-add-video': 'Add video with the bundled sample take: its card, Uploaded video',
  'review-own-plays': 'Open review: it plays, no sample number on the screen',
  'review-own-words': 'add a transcript and a note, reload, the video and both are there',
  'review-refuse-text': 'Add video with a text file: refused in plain words, the inbox still works',
});

// From live mode on, the loop walk is the full walk (D-107).
const FROM_LIVE_MODE = ['live-mode', 'hey-yap-panel', 'try', 'stop', 'first-cut-ready', 'edit-removed-clips', 'restore-one', 'export', 'return', 'review-take', 'next-take-carries'];

/** The walks: each an ordered list of leg names. */
export const MODES = Object.freeze({
  // D-107
  loop: Object.freeze([
    'ideas-opening',
    'saved-ideas',
    'gallery',
    'first-card',
    'beat-list',
    'prepare-recording',
    'prepare-stand-in',
    'try-the-sample-take',
    ...FROM_LIVE_MODE,
  ]),
  // D-144
  'own-take': Object.freeze([
    'gallery',
    'first-card',
    'beat-list',
    'prepare-recording',
    'prepare-stand-in',
    'start-recording',
    'live-mode-5s',
    'stop',
    'first-cut-ready',
    'edit-own-recording',
    'export',
    'file-plays',
  ]),
  // PRD-review-own-video.md, Done when
  review: Object.freeze([
    'review-nav',
    'review-inbox',
    'review-open',
    'review-retention',
    'review-ctr',
    'review-not-used',
    'review-use-twice',
    'review-waiting',
    'review-add-video',
    'review-own-plays',
    'review-own-words',
    'review-refuse-text',
  ]),
  // D-143
  full: Object.freeze([
    'ideas-opening',
    'send-thought',
    'first-conversation',
    'keep-exploring',
    'shaping-the-idea',
    'save-idea',
    'confirm-idea',
    'tick-closing',
    'press-confirm-idea',
    'gallery',
    'first-card',
    'beat-list',
    'accept-one-suggestion',
    'prepare-recording',
    'prepare-stand-in',
    'try-the-sample-take',
    ...FROM_LIVE_MODE,
  ]),
});

const hook = (id) => `[data-testid="${id}"]`;

/**
 * The built legs. A leg gets the walk it is part of:
 *   walk.page      the browser page (Playwright), 1440 by 900
 *   walk.base      the server's address, http://127.0.0.1:<port>
 *   walk.mode      loop, own-take or full
 *   walk.root      the app folder; walk.dataDir the walk's own data folder
 *   walk.first     true for the first leg walked: the page has opened nothing yet
 *   walk.cutShort  true for the last leg of a walk cut short by --until
 *   walk.open(address)            open an address of the server and wait for it to load
 *   walk.expectAddress(address)   throw unless the page is at that address (path and query)
 *   walk.shot(screen)             keep a screenshot of a screen; the third and later are not taken
 *   walk.mayBeNotBuilt(address)   only for a cut-short last leg: let the server's "not found" for that one page load through.
 *                                 The address is its path and query, or a pattern of them where the leg knows only the
 *                                 shape (an id the server makes)
 *   walk.wasNotBuilt(address)     true when that "not found" was seen, for the same address or pattern
 *   walk.hook(id)                 the selector of a data-testid hook
 * It throws to fail, and may return a few words that are printed after "ok".
 */
export const LEGS = {

  // The walk calls no model: Claude is silent on the coach's route, so YAP's built-in coach answers.
  'send-thought': async w => {await w.page.route('**/api/model',r=>JSON.parse(r.request().postData()||'{}').task==='idea-coach'?r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({source:'none',text:null})}):r.continue());await w.page.fill(hook('idea-input'),'I repaired a torn jacket before a rainy walk. I patched the seam with scrap fabric. Next time I will carry a small repair kit.');await w.page.click(hook('send'));await w.page.waitForURL('**/ideas/*');w.facts.idea=new URL(w.page.url()).pathname.split('/').pop();},
  'first-conversation': async w => {await w.page.locator(hook('save-thought')).waitFor();await w.page.locator(hook('idea-provenance')).waitFor();if(!(await w.page.locator('.thread').innerText()).includes('?'))throw new Error('YAP asked nothing');await w.shot('conversation');},
  'keep-exploring': async w => {await w.page.click(hook('keep-exploring'));await w.page.locator(hook('save-idea')).waitFor();},
  'shaping-the-idea': async w => {await w.page.locator(hook('idea-provenance')).waitFor();if(!(await w.page.locator('.thread').innerText()).includes('torn jacket'))throw new Error('Own words missing');if(!(await w.page.locator(hook('thumb-a')).isVisible())||await w.page.locator(`${hook('thumb-a')} img`).count())throw new Error('The key element has no direction in the person\'s words');await w.shot('concept');},
  'save-idea': async w => {await w.page.click(hook('save-idea'));await w.page.locator(hook('confirm-idea')).waitFor();},
  'confirm-idea': async w => {await w.page.locator(hook('point-closing')).waitFor();await w.shot('confirm');},
  // A proposed beat starts ticked: untick it, then tick it again.
  'tick-closing': async w => {const closing=w.page.locator(hook('point-closing'));await closing.click();if(await closing.getAttribute('aria-checked')!=='false')throw new Error('Closing did not untick');await closing.click();if(await closing.getAttribute('aria-checked')!=='true')throw new Error('Closing did not tick');},
  // Save to ideas keeps the idea in the inbox; Confirm idea would go straight on to its beats.
  'press-confirm-idea': async w => {await w.page.click(hook('save-for-later'));await w.page.waitForURL('**/create');await w.page.locator(hook('saved-'+w.facts.idea)).waitFor();const data=readData(w.dataDir,'ideas.json');const list=Array.isArray(data)?data:data.ideas;const idea=list.find(i=>i.id===w.facts.idea);if(idea?.state!=='saved'||idea?.ticks?.closing!==true)throw new Error('Confirmed idea choices did not persist');},
  'accept-one-suggestion': async w => {await w.page.locator('[data-state="suggested"] button').filter({hasText:'Accept'}).first().click();await w.page.locator('[data-state="accepted"]').first().waitFor();},


  'live-mode': async w => {
    await w.page.waitForFunction(()=>document.documentElement.dataset.recordingReady==='true');
    w.facts.id=new URL(w.page.url()).pathname.split('/').pop();
    await w.shot('live');
    return 'live engine and source ready';
  },
  'live-mode-5s': async w => {
    await w.page.waitForFunction(()=>document.documentElement.dataset.recordingReady==='true');
    w.facts.id=new URL(w.page.url()).pathname.split('/').pop();
    // Show all prompt overlays while camera-only media is recorded.
    await w.page.click(hook('help'));
    await w.page.locator(hook('help-panel')).waitFor({state:'visible'});
    await w.shot('live');
    await w.page.waitForTimeout(5500);
    await w.page.click(hook('back'));
    return 'own camera and microphone ran over 5 seconds, including visible prompts';
  },
  'hey-yap-panel': async w => {
    await w.page.locator(hook('help-panel')).waitFor({state:'visible',timeout:60000});
    await w.page.locator(hook('experiment-card')).waitFor({state:'visible'});
    const text=await w.page.locator(hook('experiment-line')).innerText();
    if(!/coffee/i.test(text))throw new Error('coffee proposal missing');
    w.facts.sampleTake=true;
    await w.shot('heyyap');
  },
  try: async w => {
    // The sample's presenter says yes a moment later and that saves it too: a press that comes after it has nothing left to do.
    await w.page.click(hook('try'),{timeout:3000}).catch(()=>{});
    await w.page.locator(hook('trial-saved')).waitFor({state:'visible'});
    const trials=readData(w.dataDir,'experiments.json');
    if(!trials?.experiments?.length)throw new Error('Trial shown saved but absent on disk');
    // Saving closes the talk with YAP and shows the experiment card; the take carries on by itself.
    if(await w.page.locator(hook('help-panel')).isVisible())await w.page.click(hook('back'));
  },
  stop: async w => {
    // The sample take plays its restarts and pauses out and stops itself where its footage ends.
    if(w.facts.sampleTake)return 'the sample take stops by itself';
    await w.page.click(hook('stop'));
  },
  'first-cut-ready': async w => {
    await w.page.locator(hook('first-cut')).waitFor({state:'visible',timeout:60000});
    if(!(await w.page.locator(hook('first-cut')).innerText()).includes('Your first cut is ready'))throw new Error('First-cut message missing');
    await w.shot('saved');
    await w.page.waitForURL(`**/video/${w.facts.id}/edit`,{timeout:10000});
  },
  'edit-removed-clips': async w => {
    await w.page.locator(hook('clip')).first().waitFor();
    const n=await w.page.locator(hook('clip')+'[data-state="removed"]').count();
    if(n<2)throw new Error(`Only ${n} removed clips; expected at least 2`);
    await w.shot('edit');
  },
  'edit-own-recording': async w => {
    await w.page.locator(hook('preview-video')).waitFor();
    const rec=readData(w.dataDir,'recordings',w.facts.id+'.json');
    if(!rec||rec.status!=='ready'||rec.duration<5||!rec.video?.file||rec.video.file.includes('take1'))throw new Error('Own take was not saved intact under its original id');
    if(rec.transcript.length!==0||rec.cuts.cuts.length!==0)throw new Error('No-speech capture contains invented transcript/cuts');
    w.facts.duration=rec.duration;
    await w.shot('edit');
    return `same Recording ${rec.id}, ${rec.duration.toFixed(2)}s, zero invented cuts`;
  },
  'restore-one': async w => {
    const removed=w.page.locator(hook('clip')+'[data-state="removed"]').first();
    const cutId=await removed.getAttribute('data-cut-id');
    await removed.click();
    await w.page.locator(hook('clip')+`[data-cut-id="${cutId}"][data-state="kept"]`).waitFor();
    const rec=readData(w.dataDir,'recordings',w.facts.id+'.json');
    if(rec.cuts.cuts.find(c=>c.id===cutId)?.applied!==false)throw new Error('Restore did not persist');
    await w.page.reload();
    await w.page.locator(hook('clip')+`[data-cut-id="${cutId}"][data-state="kept"]`).waitFor();
    await w.shot('edit');
  },
  export: async w => {
    const response=w.page.waitForResponse(r=>r.url().endsWith('/export')&&r.request().method()==='POST');
    await w.page.click(hook('export'));
    const r=await response;if(!r.ok())throw new Error(await r.text());
    const result=await r.json();w.facts.export=result;
    if(result.video!=='rendered'||!result.outputs.video)throw new Error('MP4 was not rendered');
    if(!fs.statSync(path.join(w.root,result.outputs.video)).size)throw new Error('Export file empty');
    await w.page.locator(hook('export-download')).waitFor();
    return result.outputs.video;
  },
  'file-plays': async w => {
    const page=await w.context.newPage();
    // Start from this app so the download's own-origin access guard remains meaningful.
    await page.goto(w.base+'/');
    const result=await page.evaluate(async url=>{
      const v=document.createElement('video');document.body.replaceChildren(v);v.src=url;v.muted=true;
      await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=()=>reject(new Error('Export cannot load'));});
      await v.play();await new Promise(resolve=>setTimeout(resolve,350));
      return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,audio:v.webkitAudioDecodedByteCount};
    },w.facts.export.downloadUrl);
    if(!result.width||!result.height||result.time<=0||!result.audio||Math.abs(result.duration-w.facts.duration)>1)throw new Error('Export picture/audio/duration invalid: '+JSON.stringify(result));
    await page.close();return JSON.stringify(result);
  },
  return: async w => {
    await w.page.click(hook('retry'));
    await w.page.waitForURL(`**/record/${w.facts.id}?take=2`);
    await w.page.locator(hook('memory-card')).waitFor();
    const trials=readData(w.dataDir,'experiments.json')?.experiments||[];
    if(!trials.some(t=>t.recordings?.includes(w.facts.id)))throw new Error('Trial never counted this Recording');
    await w.page.waitForFunction(()=>document.querySelector('[data-testid="trial-status"]')?.textContent.includes('1 of 3'));
    const source=readData(w.dataDir,'recordings',w.facts.id+'.json');
    if(!source.reviewMoments?.length&&!source.deliveryCues?.length)throw new Error('Return has no actual cue evidence from first take');
    const text=await w.page.locator(hook('memory-card')).innerText();
    if(!/slow down/i.test(text))throw new Error('Expected actual carried cue missing: '+text);
    if(!/Last take had \d+ restart/.test(await w.page.locator(hook('bet')).innerText()))throw new Error('The last take\'s count is missing');
    if(/\bbet\b/i.test(text))throw new Error('The card still says bet: '+text);
    await w.page.click(hook('memory-keep'));
    await w.page.waitForFunction(()=>document.querySelector('[data-testid="memory-keep"]')?.getAttribute('aria-pressed')==='true');
    const memory=readData(w.dataDir,'memory.json');
    if(!memory?.notes?.length&&!memory?.carried?.length)throw new Error('Keep did not persist the actual cue');
    await w.page.reload();
    await w.page.locator(hook('memory-card')).waitFor();
    await w.shot('return');
  },


  // ---- a take recorded in YAP, read in Review, and what follows it into the next take ----
  'review-take': async w => {
    // no model in a walk: the model route answers empty, so a typed question is answered from the take's own facts
    await w.page.route('**/api/model', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: '', text: '' }) }));
    await Promise.all([w.page.waitForURL(`${w.base}/review/${w.facts.id}`), w.page.click(hook('lesson-open-review'))]);
    await w.page.locator('[data-testid="take-review"][data-state="ready"]').waitFor();
    const numbers = await w.page.locator(hook('kpi')).allInnerTexts();
    for (const label of ['Length', 'After the cut', 'Restarts', 'Pace', 'Beats covered']) if (!numbers.some(n => n.includes(label))) throw new Error(`the take's ${label} is missing: ${numbers.join(' | ')}`);
    const text = await w.page.evaluate(() => document.body.innerText);
    if (/views|impressions|CTR|subscribers|not available|not connected/i.test(text)) throw new Error('a platform number, or a line about a missing one, is on a take\'s review');
    const total = (await w.page.locator(hook('time')).innerText()).split('/')[1].trim();
    if (await w.page.locator('.xlab').last().innerText() !== total) throw new Error('the chart and the player disagree on the take\'s length');
    const moments = w.page.locator(hook('moment'));
    if (await moments.count() < 3) throw new Error('fewer than three key moments on a take with restarts');
    await moments.nth(2).click();
    await w.page.waitForFunction(() => { const m = document.querySelectorAll('[data-testid="moment"]')[2], v = document.querySelector('[data-testid="video"]'); return Math.abs(v.currentTime - Number(m.dataset.seconds)) < 0.6; }, {}, { timeout: 8000 });
    await w.page.fill(hook('ask-input'), 'Why did YAP cut so much?');
    await w.page.click(hook('ask-send'));
    await w.page.waitForFunction(() => { const b = [...document.querySelectorAll('[data-testid="msg-yap"]')].pop(); return b && !b.classList.contains('thinking') && /YAP removed [\d.]+ seconds/.test(b.textContent); }, {}, { timeout: 8000 });
    w.facts.experiment = (await w.page.locator(hook('exp-text')).innerText()).trim();
    await w.page.click(hook('use-lesson'));
    await w.page.locator(hook('lesson-accepted')).waitFor();
    const trying = await w.page.locator(hook('trying')).innerText();
    if (!/what yap is trying with you/i.test(trying) || !/Grab a coffee/.test(trying)) throw new Error('the experiment started in the take is not under What YAP is trying with you: ' + trying);
    w.facts.lesson = await w.page.locator(`${hook('trying')} ${hook('carried-lesson-text')}`).innerText();
    if (!w.facts.experiment.startsWith(w.facts.lesson)) throw new Error('the experiment tried is not the one named');
    await w.page.unroute('**/api/model');
    await w.shot('review-take');
    return numbers.map(n => n.replace(/\s+/g, ' ')).join(' | ');
  },
  'next-take-carries': async w => {
    await w.page.goto(`${w.base}/record/${w.facts.id}?take=2`);
    await w.page.locator(`${hook('carry-forward')} ${hook('carried-lesson-text')}`).waitFor();
    if (await w.page.locator(`${hook('carry-forward')} ${hook('carried-lesson-text')}`).innerText() !== w.facts.lesson) throw new Error('the next take does not name the experiment picked in Review');
    if (await w.page.locator(hook('carried-lesson-remove')).count() !== 1) throw new Error('the experiment cannot be removed');
    const card = await w.page.locator(hook('memory-card')).innerText();
    if (/\bbet\b/i.test(card)) throw new Error('the card still says bet');
    await w.shot('return');
    return w.facts.lesson;
  },

  // ---- the review walk (PRD-review-own-video.md, Done when) ----
  'review-nav': async w => {
    await w.open('/create');
    await w.page.locator(hook('card-1')).waitFor();
    await Promise.all([w.page.waitForURL(`${w.base}/review`), w.page.click(hook('nav-review'))]);
    await w.page.locator(hook('inbox-title')).waitFor();
  },
  'review-inbox': async w => {
    const cards = w.page.locator(hook('card'));
    await cards.first().waitFor();
    const statuses = await cards.evaluateAll(es => es.map(e => e.dataset.status));
    if (statuses.length !== 4 || statuses.some(x => x !== 'needs')) throw new Error(`expected four cards under Needs review, got ${statuses.join(',')}`);
    await w.shot('review');
  },
  'review-open': async w => {
    await Promise.all([w.page.waitForURL(`${w.base}/review/sample-video`), w.page.click(hook('open-review'))]);
    await w.page.locator(hook('sample-badge')).waitFor();
    if (!/sample/i.test(await w.page.locator(hook('sample-badge')).innerText())) throw new Error('the screen does not say sample');
    // the sample video has no footage: its player shows its own stills, and opens on the frame at 0:14
    await w.page.waitForFunction(() => { const s = document.querySelector('[data-testid="still"]'); return s && s.complete && s.naturalWidth > 0; });
    if (await w.page.locator('video').count() !== 0) throw new Error('another video plays in the sample review');
    if ((await w.page.locator(hook('time')).innerText()).trim() !== '0:14 / 8:27') throw new Error('the sample player does not open at 0:14 of 8:27');
    await w.shot('review-detail');
  },
  'review-retention': async w => {
    // a key moment moves the player to that moment: the player, the chart and the key moments share the video's 8:27
    await w.page.locator(hook('moment')).nth(3).click();
    await w.page.waitForFunction(() => document.querySelector('[data-testid="time"]').textContent.trim() === '4:05 / 8:27', {}, { timeout: 8000 });
    if (await w.page.locator('.xlab').last().innerText() !== '8:27') throw new Error('the chart does not end at the player\'s length');
    if (!/moment-4\.jpg$/.test(await w.page.locator(hook('still')).getAttribute('src'))) throw new Error('the player does not show the frame of the moment pressed');
    w.facts.retentionReply = await w.page.locator(hook('answer')).innerText();
  },
  'review-ctr': async w => {
    await w.page.locator(hook('kpi')).nth(0).click();
    const views = await w.page.locator(hook('answer')).innerText();
    await w.page.locator(hook('kpi')).nth(2).click();
    const ctr = await w.page.locator(hook('answer')).innerText();
    if (ctr === views || ctr === w.facts.retentionReply) throw new Error('picking a number did not change the reply');
    if (!/6\.4%/.test(ctr)) throw new Error('the click-through reply does not state the number on the screen');
  },
  'review-not-used': async w => {
    await w.page.locator(hook('use-lesson')).waitFor();
    if (await w.page.evaluate(() => localStorage.getItem('yap-sample-lesson-v1')) !== null) throw new Error('a lesson was kept before anyone used the suggestion');
    await w.page.reload();
    await w.page.locator(hook('use-lesson')).waitFor();
  },
  'review-use-twice': async w => {
    // the same button pressed twice in one breath: one lesson is kept, in this browser and not in the person's own data
    await w.page.evaluate(() => { const b = document.querySelector('[data-testid="use-lesson"]'); b.click(); b.click(); });
    await w.page.locator(hook('lesson-accepted')).waitFor();
    const kept = () => w.page.evaluate(() => JSON.parse(localStorage.getItem('yap-sample-lesson-v1')));
    if (!/thumbnail/.test((await kept()).text)) throw new Error('Try this did not keep the lesson');
    await w.page.reload();
    await w.page.locator(hook('lesson-accepted')).waitFor();
    if (await w.page.locator(hook('use-lesson')).count() !== 0) throw new Error('after a reload the suggestion can be used a second time');
    if ('carriedLesson' in (readData(w.dataDir, 'memory.json') || {})) throw new Error('a sample lesson entered the person\'s own data');
    await w.shot('review-detail-used');
  },
  'review-waiting': async w => {
    await Promise.all([w.page.waitForURL(`${w.base}/review`), w.page.click(hook('nav-review'))]);
    await w.page.click(hook('filter-waiting'));
    const first = w.page.locator(hook('card')).filter({ hasText: 'Why my first launch failed' });
    await first.waitFor();
    if (await first.getAttribute('data-status') !== 'waiting') throw new Error('the reviewed video is not under Waiting for results');
  },
  'review-add-video': async w => {
    const [chooser] = await Promise.all([w.page.waitForEvent('filechooser'), w.page.click(hook('add-video'))]);
    await chooser.setFiles(path.join(w.root, 'sample', 'take1.mp4'));
    const card = w.page.locator(hook('card')).filter({ hasText: 'take1.mp4' });
    await card.waitFor({ timeout: 20000 });
    if (!/Uploaded video/.test(await card.innerText())) throw new Error('the new card does not say Uploaded video');
    if (await card.getAttribute('data-status') !== 'needs') throw new Error('the new card is not under Needs review');
  },
  'review-own-plays': async w => {
    await Promise.all([w.page.waitForURL(/\/review\/upload-[0-9a-f]{64}$/), w.page.click(hook('open-review'))]);
    w.facts.ownAddress = new URL(w.page.url()).pathname;
    await w.page.locator(hook('storage-line')).waitFor();
    const played = await w.page.evaluate(async () => {
      const v = document.querySelector('[data-testid="player"]');
      if (v.readyState < 1) await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot load')); });
      await v.play(); await new Promise(r => setTimeout(r, 400));
      return { duration: v.duration, time: v.currentTime };
    });
    if (!(played.duration > 1) || !(played.time > 0)) throw new Error('the own video did not play: ' + JSON.stringify(played));
    const text = await w.page.evaluate(() => document.body.innerText);
    if (/\(sample\)|2\.4%|1\.12|0\.62|Proposed trial|metric-ctr/i.test(text) || await w.page.locator(hook('metrics')).count()) throw new Error('a sample number is on an own video\'s screen');
    if (!/not uploaded/.test(text)) throw new Error('the storage line is missing');
  },
  'review-own-words': async w => {
    await w.page.fill(hook('creator-transcript'), 'Hello, this is my own transcript.');
    await w.page.fill(hook('creator-note'), 'I pause too long here.');
    await w.page.fill(hook('creator-time'), '5');
    await w.page.click(hook('save-creator'));
    await w.page.locator(hook('saved-note')).waitFor();
    await w.page.reload();
    await w.page.locator(hook('saved-transcript')).waitFor();
    if (!/own transcript/.test(await w.page.locator(hook('saved-transcript')).innerText())) throw new Error('transcript lost');
    if (!/pause too long/.test(await w.page.locator(hook('saved-note')).innerText())) throw new Error('note lost');
    const dur = await w.page.evaluate(async () => {
      const v = document.querySelector('[data-testid="player"]');
      if (v.readyState < 1) await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot load')); });
      return v.duration;
    });
    if (!(dur > 1)) throw new Error('the video does not play again after a reload');
  },
  'review-refuse-text': async w => {
    const txt = path.join(w.root, '.tmp', 'walk', 'tmp', 'notes.txt');
    fs.mkdirSync(path.dirname(txt), { recursive: true });
    fs.writeFileSync(txt, 'this is not a video\n');
    await Promise.all([w.page.waitForURL(`${w.base}/review`), w.page.click(hook('back-to-inbox'))]);
    const [chooser] = await Promise.all([w.page.waitForEvent('filechooser'), w.page.click(hook('add-video'))]);
    await chooser.setFiles(txt);
    await w.page.waitForFunction(() => /not added/i.test(document.querySelector('[data-testid="toast"]')?.textContent || ''));
    const said = await w.page.locator(hook('toast')).innerText();
    await w.page.click(hook('filter-all'));
    if (await w.page.locator(hook('card')).count() < 7) throw new Error('the inbox lost cards after a refused file');
    return `refused: ${said}`;
  },

  // The front door: the Ideas opening, the first leg of the loop walk and of the full walk.
  'ideas-opening': async (walk) => {
    if (walk.first) await walk.open('/');
    walk.expectAddress('/');
    await walk.page.locator(hook('talk-to-yap')).waitFor({ state: 'visible' });
    await walk.shot('ideas');
  },

  // Saved ideas opens the Create gallery, and leaves the page at exactly /create for the gallery leg.
  'saved-ideas': async (walk) => {
    await Promise.all([
      walk.page.waitForURL(`${walk.base}/create`, { waitUntil: 'load', timeout: 5000 }),
      walk.page.click(hook('saved-ideas')),
    ]);
    walk.expectAddress('/create');
  },

  // The Create gallery: reached from Saved ideas, or opened here when it is the first leg walked.
  gallery: async (walk) => {
    if (walk.first) await walk.open('/create');
    walk.expectAddress('/create');
    await walk.page.locator(hook('card-1')).waitFor({ state: 'visible' });
    await walk.shot('gallery');
  },

  // The first card opens the beat list of the sample idea.
  'first-card': async (walk) => {
    const address = '/create/sample/beats';
    // Cut short here, the screen it lands on may be a later plan's: then only the address is checked.
    if (walk.cutShort) walk.mayBeNotBuilt(address);
    await Promise.all([
      walk.page.waitForURL(`${walk.base}${address}`, { waitUntil: 'commit', timeout: 5000 }),
      walk.page.click(hook('card-1')),
    ]);
    await walk.page.waitForLoadState('load');
    walk.expectAddress(address);
    if (walk.wasNotBuilt(address)) return `opened ${address}; that screen is not built yet, so only the address was checked`;
    return `opened ${address}`;
  },

  // The beat list of the sample idea: its five drawn beats, and none accepted for the person.
  'beat-list': async (walk) => {
    walk.expectAddress('/create/sample/beats');
    await walk.page.locator(hook('prepare-recording')).waitFor({ state: 'visible' });
    const states = await walk.page.locator(`${hook('beat-list')} .beat`).evaluateAll((rows) => rows.map((row) => row.dataset.state));
    if (states.length !== 5) throw new Error(`the beat list shows ${states.length} beats, not the sample idea's 5`);
    if (states.includes('accepted')) throw new Error('a suggestion is accepted before the person pressed Accept');
    await walk.shot('beats');
    return '5 beats, none accepted for the person';
  },

  // Prepare recording saves the kept beats in the walk's own data folder and opens the prepare screen of the idea.
  'prepare-recording': async (walk) => {
    const address = '/prepare/sample';
    // Cut short here, the screen it lands on may be a later plan's: then only the address and what was saved are checked.
    if (walk.cutShort) walk.mayBeNotBuilt(address);
    await Promise.all([
      walk.page.waitForURL(`${walk.base}${address}`, { waitUntil: 'commit', timeout: 5000 }),
      walk.page.click(hook('prepare-recording')),
    ]);
    await walk.page.waitForLoadState('load');
    walk.expectAddress(address);
    const kept = keptBeatsOf(walk.dataDir, 'sample').map((beat) => beat.id);
    // The two beats from the idea are always kept, in their order; an accepted suggestion may sit among them.
    const own = kept.filter((id) => id === 'hours' || id === 'never');
    if (own.join(' ') !== 'hours never') throw new Error(`the kept beats saved for the sample idea are [${kept.join(', ')}], without its two own beats in order`);
    const said = `opened ${address} with ${kept.length} kept beats saved`;
    return walk.wasNotBuilt(address) ? `${said}; that screen is not built yet, so only the address and the kept beats were checked` : said;
  },

  // The prepare stand-in of the sample idea: the idea's title, its kept beats as talking points, the six cue chips,
  // and the button that plays the bundled sample take (D-122, D-123, D-126).
  'prepare-stand-in': async (walk) => {
    walk.expectAddress('/prepare/sample');
    await walk.page.locator(hook('beat')).first().waitFor({ state: 'visible' });
    const shown = await walk.page.evaluate(() => ({
      views: ['home', 'compose', 'prepare'].filter((id) => !document.getElementById(id).hidden),
      title: document.getElementById('prepare-title').textContent,
      labels: [...document.querySelectorAll('[data-testid="beat-label"]')].map((label) => label.textContent),
      chips: document.querySelectorAll('[data-testid="cue-chip"]').length,
      pressed: [...document.querySelectorAll('[data-testid="cue-chip"][aria-pressed="true"]')].map((chip) => chip.textContent).join(' and '),
      sample: [...document.querySelectorAll('[data-testid="try-sample-take"]')].map((button) => button.textContent),
    }));
    if (shown.views.join(' ') !== 'prepare') throw new Error(`the stand-in shows ${shown.views.join(' and ') || 'nothing'}, not the prepare view alone`);
    if (shown.title !== SAMPLE_IDEA_TITLE) throw new Error(`the stand-in is titled "${shown.title}", not the idea's "${SAMPLE_IDEA_TITLE}"`);
    const kept = keptBeatsOf(walk.dataDir, 'sample').map((beat) => beat.title);
    if (kept.length === 0 || shown.labels.join(' | ') !== kept.join(' | ')) {
      throw new Error(`the stand-in shows the beats [${shown.labels.join(', ')}], not the kept beats [${kept.join(', ')}]`);
    }
    if (shown.chips !== 6) throw new Error(`the stand-in shows ${shown.chips} delivery cue chips, not 6`);
    // Slow down and Smile start on, so a take recorded as it comes is coached; the four reminders wait to be asked for.
    if (shown.pressed !== 'Slow down and Smile') throw new Error(`the cues on before the person pressed one are [${shown.pressed}], not Slow down and Smile`);
    if (!(await walk.page.locator(hook('start-recording')).isVisible())) throw new Error('Start recording is not shown');
    if (shown.sample.length !== 1 || shown.sample[0] !== SAMPLE_TAKE_LABEL) {
      throw new Error(`the sample take's button reads [${shown.sample.join(' | ')}], not "${SAMPLE_TAKE_LABEL}"`);
    }
    const said = `${kept.length} kept beats shown as talking points under the idea's title, 6 cue chips, and the sample take's button`;
    if (walk.mode !== 'own-take') {
      await walk.shot('prepare');
      return said;
    }
    // The own-take walk records with a camera and a microphone: its browser has stand-ins for both, and the preview shows one.
    await walk.page.locator(`${hook('camera')}.is-ready`).waitFor({ state: 'attached', timeout: 5000 });
    await walk.shot('prepare');
    return `${said}; the camera preview shows a picture`;
  },

  // Try the sample take makes the bundled sample take's Recording and opens its record address, marked as the sample (D-123, D-124).
  'try-the-sample-take': async (walk) => {
    const made = await startTake(walk, 'try-sample-take', SAMPLE_RECORD_ADDRESS);
    if (made.meta.sample !== true) throw new Error(`the Recording ${made.id} is not marked as the sample take`);
    return `opened ${made.address} with the Recording saved as the sample take, "${made.recording.title}"${made.notBuilt}`;
  },

  // Start recording, with one delivery cue chosen, makes the person's own Recording and opens its record address (D-126, D-127).
  'start-recording': async (walk) => {
    // Slow down and Smile start on. Set up is opened and Slow down switched off, so the take carries the one cue left on.
    await walk.page.locator(hook('setup-open')).click();
    await walk.page.locator(hook('cue-chip')).first().click();
    const made = await startTake(walk, 'start-recording', RECORD_ADDRESS);
    if (made.meta.sample !== false) throw new Error(`the Recording ${made.id} is marked as the sample take, and it is the person's own`);
    const cues = made.recording.deliveryCues.length;
    if (cues !== 1) throw new Error(`the Recording ${made.id} has ${cues} delivery cues, and one of the two that start on was switched off`);
    return `opened ${made.address} with the Recording saved as the person's own take, with 1 delivery cue${made.notBuilt}`;
  },
};

/** A JSON file of the walk's own data folder, or null when it is not there or is not JSON. */
function readData(dataDir, ...parts) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, ...parts), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Press a control that starts a take, and see the record address open and the
 * Recording saved in the walk's own data folder as a record the engine accepts.
 * Cut short here, the record screen may be a later plan's: then only the
 * address and the Recording are checked.
 */
async function startTake(walk, press, like) {
  if (walk.cutShort) walk.mayBeNotBuilt(like);
  await Promise.all([
    walk.page.waitForURL((url) => like.test(`${url.pathname}${url.search}`), { waitUntil: 'commit', timeout: 5000 }),
    walk.page.click(hook(press)),
  ]);
  await walk.page.waitForLoadState('load');
  const now = new URL(walk.page.url());
  const address = `${now.pathname}${now.search}`;
  const match = like.exec(address);
  if (!match) throw new Error(`the address is ${address}, not a record address`);
  const id = match[1];
  const recording = readData(walk.dataDir, 'recordings', `${id}.json`);
  if (!recording) throw new Error(`no Recording ${id} is saved in the walk's data folder`);
  const { ok, errors } = validateRecording(recording);
  if (!ok) throw new Error(`the saved Recording ${id} is not one the engine accepts: ${errors[0]}`);
  const meta = readData(walk.dataDir, 'recording-meta', `${id}.json`);
  if (!meta) throw new Error(`nothing is kept beside the Recording ${id}`);
  const notBuilt = walk.wasNotBuilt(like) ? '; that screen is not built yet, so only the address and the Recording were checked' : '';
  return { id, address, recording, meta, notBuilt };
}

/** The kept beats the walk's server has saved for an idea, read from its own data folder; [] when none are saved. */
function keptBeatsOf(dataDir, id) {
  let ideas = [];
  try {
    ideas = JSON.parse(fs.readFileSync(path.join(dataDir, IDEAS_FILE), 'utf8')).ideas;
  } catch {
    return [];
  }
  const idea = Array.isArray(ideas) ? ideas.find((each) => each && each.id === id) : null;
  return idea && Array.isArray(idea.keptBeats) ? idea.keptBeats : [];
}

/**
 * Lay out a walk before anything is started.
 * @param {string} mode
 * @param {string} [until] the last leg to walk
 * @param {(name: string) => boolean} [isBuilt]
 * @param {Record<string, readonly string[]>} [modes]
 * @returns {{ ok: boolean, fail?: string, steps: { name: string, state: 'not-built' | 'walk', first: boolean, cutShort: boolean }[] }}
 */
export function planWalk(mode, until, isBuilt = (name) => typeof LEGS[name] === 'function', modes = MODES) {
  const names = typeof mode === 'string' && Object.prototype.hasOwnProperty.call(modes, mode) ? modes[mode] : null;
  if (!names) return { ok: false, fail: `there is no walk called ${mode}`, steps: [] };
  let end = names.length - 1;
  const cut = until !== undefined && until !== null;
  if (cut) {
    end = names.indexOf(until);
    if (end === -1) return { ok: false, fail: `the walk ${mode} has no leg called ${until}`, steps: [] };
    if (!isBuilt(until)) return { ok: false, fail: `the leg ${until} is not built yet`, steps: [] };
  }
  const firstBuilt = names.findIndex((name) => isBuilt(name));
  if (firstBuilt === -1 || firstBuilt > end) return { ok: false, fail: `no leg of the walk ${mode} is built yet`, steps: [] };
  const steps = [];
  for (let i = 0; i <= end; i += 1) {
    const name = names[i];
    if (i < firstBuilt) {
      steps.push({ name, state: 'not-built', first: false, cutShort: false });
    } else if (!isBuilt(name)) {
      return { ok: false, fail: `the leg ${name} is not built yet`, steps: [] };
    } else {
      steps.push({ name, state: 'walk', first: i === firstBuilt, cutShort: cut && i === end && end < names.length - 1 });
    }
  }
  return { ok: true, steps };
}

/**
 * True when an address is a network call to anything but the walk's own server.
 * data:, blob: and about: are no network call.
 * @param {string} address
 * @param {string} base the server's address
 */
export function offServer(address, base) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return true;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return false;
  return url.origin !== new URL(base).origin;
}

/**
 * The screenshots of one walk: at most `limit` per screen, written to `outDir`
 * as <screen>-1.png and <screen>-2.png. The first picture of a screen clears
 * that screen's pictures from an earlier walk.
 * @param {string} outDir
 * @param {number} [limit]
 * @returns {(page: { screenshot: Function }, screen: string) => Promise<string | null>} the file written, or null once the limit is reached
 */
export function createShots(outDir, limit = SHOTS_PER_SCREEN) {
  const taken = new Map();
  return async function shot(page, screen) {
    if (typeof screen !== 'string' || !/^[a-z][a-z-]*$/.test(screen)) {
      throw new Error(`a screenshot is named after a screen, in lower-case letters and hyphens (got ${JSON.stringify(screen)})`);
    }
    const n = (taken.get(screen) || 0) + 1;
    if (n > limit) return null;
    fs.mkdirSync(outDir, { recursive: true });
    if (n === 1) {
      const old = new RegExp(`^${screen}-\\d+\\.png$`);
      for (const name of fs.readdirSync(outDir)) {
        if (old.test(name)) fs.rmSync(path.join(outDir, name), { force: true });
      }
    }
    taken.set(screen, n);
    const file = path.join(outDir, `${screen}-${n}.png`);
    await page.screenshot({ path: file });
    return file;
  };
}

// ---------- the list of shell checks ----------

/** True when `value` is a plain path, as written, inside `folder` (both from the app folder, with forward slashes). */
function insideFolder(value, folder) {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) return false;
  return value.startsWith(`${folder}/`) && value.length > folder.length + 1;
}

/**
 * Why an entry of the checks list is refused, or null when it may be run.
 * @param {any} entry { screen, check, arg, path }
 * @returns {string | null}
 */
export function checkEntryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'an entry is an object { screen, check, arg, path }';
  if (typeof entry.screen !== 'string' || !/^[a-z]+$/.test(entry.screen)) return 'screen must be a name in lower-case letters';
  if (!insideFolder(entry.check, 'test/shells') || !entry.check.endsWith('.cjs')) return 'check must be a .cjs file under test/shells/';
  if (!insideFolder(entry.arg, 'test/shells/specs') && !insideFolder(entry.arg, 'ui')) return 'arg must be inside test/shells/specs/ or ui/';
  if (typeof entry.path !== 'string' || !/^\/(?![/\\])/.test(entry.path) || /[\s\\]/.test(entry.path)) {
    return 'path must be an address of this app, starting with one slash';
  }
  return null;
}

/** Why an entry's files cannot be used, or null: each must be there, and must not lead out of its folder through a link. */
function entryFileProblem(entry, root) {
  const real = (file) => {
    try {
      return fs.realpathSync(file);
    } catch {
      return null;
    }
  };
  const within = (file, folder) => {
    const a = real(file);
    const b = real(folder);
    return Boolean(a && b && a.startsWith(b + path.sep));
  };
  const check = path.join(root, entry.check);
  const arg = path.join(root, entry.arg);
  if (!fs.existsSync(check) || !fs.statSync(check).isFile()) return `${entry.check} is not there`;
  if (!fs.existsSync(arg)) return `${entry.arg} is not there`;
  if (!within(check, path.join(root, 'test', 'shells'))) return `${entry.check} leads out of test/shells/`;
  if (!within(arg, path.join(root, 'test', 'shells', 'specs')) && !within(arg, path.join(root, 'ui'))) {
    return `${entry.arg} leads out of test/shells/specs/ and ui/`;
  }
  return null;
}

/**
 * What the registry rule looks at, read from an app folder.
 * @param {string} [root]
 * @returns {{ checks: any[], checkFiles: string[], specFiles: string[], screens: string[] }}
 */
export function readShellFolders(root = APP_ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'test', 'shells', 'manifest.json'), 'utf8'));
  if (!manifest || !Array.isArray(manifest.checks)) throw new Error('test/shells/manifest.json has no checks list');
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []);
  const names = (entries) => entries.map((e) => e.name).sort();
  return {
    checks: manifest.checks,
    checkFiles: names(list(path.join(root, 'test', 'shells')).filter((e) => e.isFile() && /^check_.*\.cjs$/.test(e.name))),
    specFiles: names(list(path.join(root, 'test', 'shells', 'specs')).filter((e) => e.isFile() && e.name.endsWith('.json'))),
    screens: names(list(path.join(root, 'ui')).filter((e) => e.isDirectory())),
  };
}

/**
 * The registry rule (D-142): what is copied or wired and named by no entry, and
 * what an entry names that is not there. One line per fault, the file first.
 *   - a check_*.cjs file under test/shells/ other than the frame check must be the `check` of an entry;
 *   - a spec <name>.json whose screen folder ui/<name>/ exists must be the `arg` of an entry;
 *   - the `check` and the `arg` of every entry must be there;
 *   - a screen is registered once.
 * @param {{ checks: any[], checkFiles: string[], specFiles: string[], screens: string[] }} folders
 * @param {(file: string) => boolean} [exists] given a path from the app folder
 * @returns {string[]}
 */
export function findUnregistered(folders, exists = () => true) {
  const entries = folders.checks.filter((entry) => entry && typeof entry === 'object');
  const checksNamed = new Set(entries.map((entry) => entry.check));
  const argsNamed = new Set(entries.map((entry) => entry.arg));
  const faults = [];
  for (const file of folders.checkFiles) {
    if (file === 'check_frame.cjs') continue; // one check for five screens: it is held by its specs, below
    if (!checksNamed.has(`test/shells/${file}`)) faults.push(`test/shells/${file}: a copied check that no entry of the checks list names`);
  }
  for (const spec of folders.specFiles) {
    const screen = spec.replace(/\.json$/, '');
    if (folders.screens.includes(screen) && !argsNamed.has(`test/shells/specs/${spec}`)) {
      faults.push(`test/shells/specs/${spec}: the screen ui/${screen}/ is wired and no entry of the checks list names its spec`);
    }
  }
  const seen = new Set();
  for (const entry of entries) {
    for (const key of ['check', 'arg']) {
      if (typeof entry[key] === 'string' && !exists(entry[key])) faults.push(`${entry[key]}: named by the ${entry.screen} entry and not there`);
    }
    if (seen.has(entry.screen)) faults.push(`${entry.screen}: registered twice in the checks list`);
    seen.add(entry.screen);
  }
  return faults;
}

// ---------- running ----------

const firstLine = (e) => String(e && e.message ? e.message : e).split('\n')[0];

/** The env without the API key: the walk's server and its checks never see one. */
function withoutKey(env) {
  const out = { ...env };
  delete out.OPENAI_API_KEY;
  return out;
}

/** The walk's own data folder, .tmp/walk/data-<name> inside the app folder, emptied. */
function freshDataDir(root, name) {
  const dir = resolveDataDir(root, path.join('.tmp', 'walk', `data-${name}`));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function startServer(root, env, dataDir) {
  const server = createYapServer({ root, env, dataDir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Walk the app.
 * @param {{ mode: string, until?: string, root?: string, env?: Record<string, string | undefined>, print?: (line: string) => void, modes?: Record<string, readonly string[]>, legs?: Record<string, Function> }} options
 *   `modes` and `legs` stand in for MODES and LEGS in a test.
 * @returns {Promise<number>} the exit code: 0 passed, 1 failed
 */
export async function runWalk(options = {}) {
  const print = options.print || ((line) => process.stdout.write(`${line}\n`));
  const env = options.env || process.env;
  const root = path.resolve(options.root || APP_ROOT);
  const modes = options.modes || MODES;
  const legs = options.legs || LEGS;
  const mode = options.mode;
  const tag = `walk:${mode}`;

  const plan = planWalk(mode, options.until, (name) => typeof legs[name] === 'function', modes);
  if (!plan.ok) {
    print(`FAIL ${tag}: ${plan.fail}`);
    return 1;
  }
  const driver = findBrowserDriver(env);
  if (!driver) {
    print(NO_DRIVER_LINE);
    return 1;
  }

  const outDir = path.join(root, '.tmp', 'walk');
  const tmpDir = path.join(outDir, 'tmp');
  const previousTmp = process.env.TMPDIR;
  let server;
  let browser;
  let at = 'the start';
  const state = { facts: {}, base: '', problems: [], letThrough: new Set(), letThroughLike: [], notBuilt: new Set() };
  const causes = (extra) => [...new Set([...state.problems, ...(extra ? [extra] : [])])].slice(0, 5).join('; ');

  try {
    const dataDir = freshDataDir(root, mode);
    fs.mkdirSync(tmpDir, { recursive: true });
    // The browser's profile and scratch files stay inside the app folder.
    process.env.TMPDIR = tmpDir;
    const started = await startServer(root, withoutKey(env), dataDir);
    server = started.server;
    state.base = started.base;
    browser = await loadPlaywright(driver).chromium.launch(launchOptions(mode));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(env.YAP_DEMO_VIDEO==='1'?{recordVideo:{dir:path.join(outDir,'film'),size:{width:1440,height:900}}}:{}) });
    context.on('page', (opened) => watchPage(opened, state));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const shots = createShots(outDir);

    const filmStarted=Date.now(),filmChapters=[];
    const filmPauses=new Set(['ideas-opening','first-conversation','shaping-the-idea','confirm-idea','gallery','beat-list','prepare-stand-in','hey-yap-panel','edit-removed-clips','restore-one','export','return']);
    const passedOver = [];
    let walked = 0;
    for (const step of plan.steps) {
      if (step.state === 'not-built') {
        passedOver.push(step.name);
        print(`leg ${step.name}: not built yet, passed over (${LEG_SAYS[step.name] || step.name})`);
        continue;
      }
      at = step.name;
      const walk = {
        page,
        facts: state.facts,
        context,
        base: state.base,
        mode,
        root,
        dataDir,
        first: step.first,
        cutShort: step.cutShort,
        hook,
        open: (address) => page.goto(`${state.base}${address}`, { waitUntil: 'load' }),
        expectAddress: (address) => {
          const now = new URL(page.url());
          const got = now.origin === state.base ? `${now.pathname}${now.search}` : page.url();
          if (got !== address) throw new Error(`the address is ${got}, not ${address}`);
        },
        shot: (screen) => shots(page, screen),
        mayBeNotBuilt: (address) => {
          if (!step.cutShort) throw new Error('only the last leg of a walk cut short by --until may land on a screen that is not built yet');
          if (address instanceof RegExp) state.letThroughLike.push(address);
          else state.letThrough.add(`${state.base}${address}`);
        },
        wasNotBuilt: (address) =>
          address instanceof RegExp ? [...state.notBuilt].some((url) => address.test(addressOn(state.base, url))) : state.notBuilt.has(`${state.base}${address}`),
      };
      filmChapters.push({leg:step.name,start:(Date.now()-filmStarted)/1000});
      const note = await legs[step.name](walk);
      if(env.YAP_FILM_PAUSE==='1'&&filmPauses.has(step.name))await page.waitForTimeout(3200);
      filmChapters.at(-1).end=(Date.now()-filmStarted)/1000;
      // Let what the page was still doing be heard before the leg is called good.
      await page.waitForTimeout(150);
      if (state.problems.length) {
        print(`FAIL ${tag} at ${step.name}: ${causes()}`);
        return 1;
      }
      walked += 1;
      print(`leg ${step.name}: ok${typeof note === 'string' && note ? ` (${note})` : ''}`);
    }
    if(env.YAP_DEMO_VIDEO==='1')fs.writeFileSync(path.join(outDir,'film',`${mode}-chapters.json`),JSON.stringify({video:await page.video().path(),chapters:filmChapters},null,2));
    const said = [`${walked} ${walked === 1 ? 'leg' : 'legs'} walked`];
    if (options.until !== undefined && options.until !== null) said.push(`until ${options.until}`);
    print(`PASS ${tag} ${said.join(', ')}${passedOver.length ? `; not built yet and passed over: ${passedOver.join(', ')}` : ''}`);
    return 0;
  } catch (e) {
    print(`FAIL ${tag} at ${at}: ${causes(firstLine(e))}`);
    return 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await stopServer(server);
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
  }
}

/**
 * How the browser of a walk is started. The own-take walk records with a
 * camera and a microphone (D-144), and a walk has neither: its browser is given
 * Chromium's own stand-ins for both, and asks nobody for leave to use them. The
 * other walks play the bundled sample and start the browser as it is.
 * @param {string} mode
 * @returns {{ args?: string[] }}
 */
export function launchOptions(mode) {
  if (mode !== 'own-take') return {};
  return { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
}

/** The path and query of an address on the walk's own server; the whole address for anything else. */
function addressOn(base, url) {
  return typeof url === 'string' && url.startsWith(`${base}/`) ? url.slice(base.length) : String(url);
}

/** Did a cut-short last leg let this address's "not found" through, by the address itself or by its shape? */
function isLetThrough(state, url) {
  if (state.letThrough.has(url)) return true;
  const address = addressOn(state.base, url);
  return address !== url && state.letThroughLike.some((like) => like.test(address));
}

/** Hear everything on a page that fails a walk. */
function watchPage(page, state) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const where = message.location() && message.location().url;
    // The browser's own line about a "not found" that was let through.
    if (isLetThrough(state, where) && /\b404\b/.test(message.text())) return;
    state.problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (e) => state.problems.push(`page error: ${e && e.message ? e.message : e}`));
  page.on('request', (request) => {
    if (offServer(request.url(), state.base)) state.problems.push(`off this server: ${request.url()}`);
  });
  page.on('requestfailed', (request) => {
    const why = request.failure() && request.failure().errorText;
    if (why && /ERR_ABORTED/.test(why)) return; // a load the page itself left behind by moving on
    state.problems.push(`failed: ${request.url()}${why ? ` (${why})` : ''}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (response.status() === 404 && isLetThrough(state, response.url()) && response.request().isNavigationRequest()) {
      state.notBuilt.add(response.url());
      return;
    }
    state.problems.push(`${response.status()}: ${response.url()}`);
  });
}

/** Start node on a script with an argument list and no shell, and wait for it. */
function runNode(args, env, cwd, timeoutMs = 150000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.once('error', (e) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: `${stderr}${firstLine(e)}\n` });
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

/**
 * Run every entry of the checks list against a server started here.
 * @param {{ root?: string, env?: Record<string, string | undefined>, print?: (line: string) => void }} [options]
 * @returns {Promise<number>} the exit code: 0 passed, 1 failed
 */
export async function runChecks(options = {}) {
  const print = options.print || ((line) => process.stdout.write(`${line}\n`));
  const env = options.env || process.env;
  const root = path.resolve(options.root || APP_ROOT);

  const driver = findBrowserDriver(env);
  if (!driver) {
    print(NO_DRIVER_LINE);
    return 1;
  }
  let folders;
  try {
    folders = readShellFolders(root);
  } catch (e) {
    print(`FAIL check:shells: ${firstLine(e)}`);
    return 1;
  }
  if (folders.checks.length === 0) {
    print('FAIL check:shells: the checks list in test/shells/manifest.json is empty');
    return 1;
  }

  const shotDir = path.join(root, '.tmp', 'shells');
  const tmpDir = path.join(root, '.tmp', 'walk', 'tmp');
  const dataDir = freshDataDir(root, 'checks');
  fs.mkdirSync(shotDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // Everything a check writes stays under .tmp/, and a check is never told it
  // runs under the test runner: its no-target exit 0 must not be able to pass.
  const childEnv = { ...withoutKey(env), NODE_PATH: driver.nodePath, SHOT_DIR: shotDir, TMPDIR: tmpDir };
  delete childEnv.NODE_TEST_CONTEXT;

  let failed = 0;
  const { server, base } = await startServer(root, withoutKey(env), dataDir);
  try {
    for (const [i, entry] of folders.checks.entries()) {
      const name = entry && typeof entry.screen === 'string' && /^[a-z]+$/.test(entry.screen) ? entry.screen : `entry ${i + 1}`;
      const refusal = checkEntryProblem(entry) || entryFileProblem(entry, root);
      if (refusal) {
        failed += 1;
        print(`FAIL ${name}: refused and not run: ${refusal}`);
        continue;
      }
      const run = await runNode([path.join(root, entry.check), path.join(root, entry.arg), `${base}${entry.path}`], childEnv, root);
      const passLine = run.stdout.split('\n').find((line) => /^PASS\b/.test(line));
      if (run.status === 0 && passLine) {
        print(`PASS ${name}: ${passLine.replace(/^PASS\s*/, '')}`);
        continue;
      }
      failed += 1;
      print(`FAIL ${name}: ${run.status === 0 ? 'the check exited 0 with no PASS line, so nothing was checked' : `the check exited ${run.status}`}`);
      for (const line of `${run.stdout}\n${run.stderr}`.split('\n')) {
        if (line.trim()) print(`  ${line}`);
      }
    }
  } finally {
    await stopServer(server);
  }
  for (const fault of findUnregistered(folders, (file) => fs.existsSync(path.join(root, file)))) {
    failed += 1;
    print(`FAIL ${fault}`);
  }
  if (failed) {
    print(`FAIL check:shells: ${failed} failed`);
    return 1;
  }
  print(`PASS check:shells ${folders.checks.length} screens`);
  return 0;
}

async function main(argv) {
  const [mode, ...rest] = argv;
  const usage = () => {
    process.stdout.write(`${USAGE}\n`);
    return 2;
  };
  if (mode === 'checks') return rest.length ? usage() : runChecks();
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, mode)) return usage();
  let until;
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== '--until' || rest[1].startsWith('--')) return usage();
    until = rest[1];
  }
  return runWalk({ mode, until });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stdout.write(`FAIL ${firstLine(e)}\n`);
      process.exitCode = 1;
    }
  );
}
