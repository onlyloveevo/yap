// Check for the YAP Review screen shell (Deth's draft image 20, 3 Oct 03:14 "review scren so far").
// Usage: node test/shells/check_review.cjs <folder> [http://127.0.0.1:PORT/review/sample-video]   (with a URL it checks the wired screen; same-origin requests allowed; screenshots go to SHOT_DIR or .tmp/shells/)
// This is the copy inside the app folder, made with cp from the shell folder's check_review.js. It differs in:
// 1. the guard below (no folder: usage line, exit 0 under the test runner, 2 from a shell); 2. the url, origin and shotDir lines, the request line, the goto lines.
// 4. SUPERSEDED ON PURPOSE (BUILD_YapSubmitDemo, 4 Oct 2026): Home and Grow opened nothing and left the sidebar; "Sample" is one quiet tag; the suggestion has one action, Use in my next video, in place of Try this, Adjust and Dismiss.
// 5. SUPERSEDED ON PURPOSE (BUILD_YapSubmitDemo round 2, 4 Oct 2026, the Loom frame L04 wins): the experiment has the frame's three actions, Try this, Adjust and Dismiss, each doing something; the player runs on the video's own 8:27, so pressing 4:05 makes it read 4:05 / 8:27; the model route is answered empty here, so a typed question is answered from the sample's own facts and no model is called.
// 6. SUPERSEDED ON PURPOSE (BUILD_YapSubmitDemo round 4, 4 Oct 2026, release judges' fault 7): the sample video has no footage, so the player shows its own stills and no other video plays: it opens on the frame at 0:14, and pressing 4:05 shows that moment's frame and reads 4:05 / 8:27.
// 7. ADDED (round 4, release judges' fault 20): an accepted experiment is kept with the YAP folder, not in one browser, so each size ends by pressing Remove and seeing Try this come back.
// 3. SUPERSEDED ON PURPOSE: in the shell the player's time read the drawn "4:05 / 8:27"; the wired player plays the real sample take, so the drawn time is mapped proportionally onto its length and the assertion checks the player's position instead (the line marked SUPERSEDED). Every other assertion is the original.
if (!process.argv[2]) { console.log('Usage: node test/shells/check_review.cjs <folder> [http://127.0.0.1:PORT/review/sample-video]'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const target = process.argv[3] || ''; const isUrl = /^https?:\/\//.test(target); const origin = isUrl ? new URL(target).origin : null; const shotDir = path.resolve(process.env.SHOT_DIR || path.join(__dirname, '..', '..', '.tmp', 'shells')); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
(async () => {
  const f = path.join(dir, 'index.html'); if (!isUrl && !fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u) && !(origin && u.startsWith(origin))) ext.push(u); });
    const T = id => `[data-testid="${id}"]`; const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => (await p.$eval(T(id), e => e.innerText).catch(() => ''));
    const click = async sel => { const e = await p.$(sel); if (!e) { need(false, `${w}: ${sel} missing`); return; } await e.click().catch(() => need(false, `${w}: cannot click ${sel}`)); await p.waitForTimeout(220); };
    await p.route('**/api/model', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: '', text: '' }) }));
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300);
    for (const id of ['brand', 'nav-ideas', 'nav-create', 'nav-review', 'title', 'range', 'sample-badge', 'player', 'play', 'time', 'video-title', 'retention', 'marker', 'tooltip', 'moments', 'assistant', 'question', 'answer', 'experiment', 'thumb-current', 'thumb-proposed', 'use-lesson', 'ask-input', 'ask-send']) need(await vis(id), `${w}: ${id} missing or not visible`);
    need((await p.$eval(T('nav-review'), e => e.getAttribute('aria-current')).catch(() => null)) === 'page', `${w}: Review is the current nav item`);
    need(/^sample$/i.test((await txt('sample-badge')).trim()), `${w}: the numbers are sample data and one quiet tag says so`); need(((await p.evaluate(() => document.body.innerText)).match(/sample/gi) || []).length === 1, `${w}: "Sample" is said once on the screen`); need((await p.$$(T('nav-home'))).length + (await p.$$(T('nav-grow'))).length === 0, `${w}: Home and Grow open nothing, so they are not in the sidebar`);
    need((await txt('time')).trim() === '0:14 / 8:27' && /video\.jpg$/.test(await p.$eval(T('still'), e => e.getAttribute('src')).catch(() => '')) && (await p.$$('video')).length === 0, `${w}: the player opens on the video's own frame at 0:14 of 8:27, and no other video plays`);
    const kpis = await p.$$eval(T('kpi'), es => es.map(e => e.innerText)); need(kpis.length === 5, `${w}: ${kpis.length} KPI cards (want 5)`);
    for (const k of ['views', 'impressions', 'ctr', 'view duration', 'watch time']) need(kpis.join('|').toLowerCase().includes(k), `${w}: no "${k}" KPI`);
    const ms = await p.$$eval(T('moment'), es => es.map(e => ({ t: e.dataset.time, sel: e.dataset.selected === 'true', txt: e.innerText })));
    need(ms.length === 6, `${w}: ${ms.length} key moments (want 6)`);
    need(ms.filter(m => m.sel).length === 1 && ms.find(m => m.sel)?.t === '2:20', `${w}: the 2:20 "Notable drop" moment starts selected`);
    need(/2:20/.test(await txt('tooltip')) && /38%/.test(await txt('tooltip')), `${w}: the tooltip starts at 2:20, "38% audience left here"`);
    const a0 = await txt('answer'), x0 = await p.$eval(T('marker'), e => e.getBoundingClientRect().left).catch(() => NaN);
    const idx = ms.findIndex(m => m.t === '4:05');
    if (idx >= 0) {
      await (await p.$$(T('moment')))[idx].click(); await p.waitForTimeout(250);
      const ms2 = await p.$$eval(T('moment'), es => es.map(e => e.dataset.selected === 'true'));
      need(ms2[idx] && ms2.filter(Boolean).length === 1, `${w}: clicking the 4:05 moment should select only it`);
      need(/4:05/.test(await txt('tooltip')), `${w}: the tooltip should move to 4:05`);
      const x1 = await p.$eval(T('marker'), e => e.getBoundingClientRect().left).catch(() => NaN); need(x1 - x0 > 5, `${w}: the chart marker should move right to 4:05`);
      /* SUPERSEDED: one length everywhere */ need(/^4:05 \/ 8:27$/.test((await txt('time')).trim()), `${w}: pressing 4:05 should move the player to 4:05 of 8:27 (reads "${await txt('time')}")`); need((await p.$$eval('.xlab', es => es[es.length - 1].innerText)) === '8:27', `${w}: the chart should end at 8:27, the player's length`); need(/moment-4\.jpg$/.test(await p.$eval(T('still'), e => e.getAttribute('src')).catch(() => '')), `${w}: pressing 4:05 should show that moment's frame in the player`);
      need((await txt('answer')) !== a0 && /4:05/.test(await txt('answer')), `${w}: YAP's answer should change to explain the 4:05 moment`);
    } else need(false, `${w}: no moment with data-time="4:05"`);
    need((await p.$$eval(T('experiment') + ' button', es => es.map(e => e.innerText.trim()).join('|'))) === 'Try this|Adjust|Dismiss', `${w}: the experiment has the frame's three actions, Try this, Adjust and Dismiss`); await click(T('use-lesson')); need(/trying this in your next video/i.test(await txt('lesson-accepted')), `${w}: Try this should keep the experiment ("Trying this in your next video")`); need(await vis('trying') && /what yap is trying with you/i.test(await txt('trying')) && /thumbnail/i.test(await txt('trying')), `${w}: the experiment should show by name under "What YAP is trying with you"`);
    await p.fill(T('ask-input'), 'Why is CTR lower than my other videos?').catch(() => need(false, `${w}: cannot type in ask-input`)); await click(T('ask-send'));
    const bubbles = await p.$$eval('[data-testid="msg-you"]', es => es.map(e => e.innerText)); need(bubbles.some(t => /ctr lower/i.test(t)), `${w}: the asked question should appear as your bubble (msg-you)`);
    await p.waitForTimeout(600); const said = await p.$$eval('[data-testid="msg-yap"]', es => es.map(e => e.innerText)); need(said.length >= 1 && /6\.4%/.test(said.join(' ')), `${w}: YAP should answer the question from the video's own numbers (got "${said.join(' ')}")`);
    /* the experiment is kept with the YAP folder, so the next size starts clean only once it is removed */ await click(T('carried-lesson-remove')); await p.waitForTimeout(300); need(await vis('use-lesson') && !(await vis('trying')), `${w}: Remove under "What YAP is trying with you" should take the experiment away and offer Try this again`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b|guarantee|will get more|more views/.test(body), `${w}: no scores and no performance promises`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300); fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(isUrl ? shotDir : dir, isUrl ? `reviewdetail-${w}.png` : `shot-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS review: 5 KPIs with one quiet sample tag, chart, key moments and player on one length, YAP explains, Try this keeps the experiment by name, a typed question is answered, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
