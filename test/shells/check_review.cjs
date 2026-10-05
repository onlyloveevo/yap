// Check for the YAP Review screen shell (Deth's draft image 20, 3 Oct 03:14 "review scren so far").
// Usage: node test/shells/check_review.cjs <folder> [http://127.0.0.1:PORT/review/sample-video]   (with a URL it checks the wired screen; same-origin requests allowed; screenshots go to SHOT_DIR or .tmp/shells/)
// This is the copy inside the app folder, made with cp from the shell folder's check_review.js. It differs in:
// 1. the guard below (no folder: usage line, exit 0 under the test runner, 2 from a shell); 2. the url, origin and shotDir lines, the request line, the goto lines.
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
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300);
    for (const id of ['brand', 'nav-home', 'nav-ideas', 'nav-create', 'nav-review', 'nav-grow', 'title', 'range', 'sample-badge', 'player', 'play', 'time', 'video-title', 'retention', 'marker', 'tooltip', 'moments', 'assistant', 'question', 'answer', 'experiment', 'thumb-current', 'thumb-proposed', 'try', 'adjust', 'dismiss', 'ask-input', 'ask-send']) need(await vis(id), `${w}: ${id} missing or not visible`);
    need((await p.$eval(T('nav-review'), e => e.getAttribute('aria-current')).catch(() => null)) === 'page', `${w}: Review is the current nav item`);
    need(/sample/i.test(await txt('sample-badge')), `${w}: the numbers are sample data and the badge must say so`);
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
      /* SUPERSEDED: the shell's drawn time text */ { const pos = await p.$eval(T('video'), v => [v.currentTime, v.duration]).catch(() => [NaN, NaN]); need(Math.abs(pos[0] - 245 / 507 * pos[1]) < 0.6, `${w}: the player should jump to 4:05 mapped onto the real length (at ${pos[0]} of ${pos[1]})`); }
      need((await txt('answer')) !== a0 && /4:05/.test(await txt('answer')), `${w}: YAP's answer should change to explain the 4:05 moment`);
    } else need(false, `${w}: no moment with data-time="4:05"`);
    await click(T('try')); need(/trial saved/i.test(await txt('experiment')) && /3 videos/i.test(await txt('experiment')), `${w}: Try this should save the trial ("Trial saved · Check back after 3 videos")`);
    await p.fill(T('ask-input'), 'Why is CTR lower than my other videos?').catch(() => need(false, `${w}: cannot type in ask-input`)); await click(T('ask-send'));
    const bubbles = await p.$$eval('[data-testid="msg-you"]', es => es.map(e => e.innerText)); need(bubbles.some(t => /ctr lower/i.test(t)), `${w}: the asked question should appear as your bubble (msg-you)`);
    need((await p.$$('[data-testid="msg-yap"]')).length >= 1, `${w}: YAP should reply (msg-yap)`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b|guarantee|will get more|more views/.test(body), `${w}: no scores and no performance promises`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300); fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(isUrl ? shotDir : dir, isUrl ? `reviewdetail-${w}.png` : `shot-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS review: 5 KPIs with a sample badge, retention marker and tooltip follow the key moments, player jumps, YAP explains, trial saves, ask works, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
