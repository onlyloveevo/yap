// Check for the YAP Home + Prepare shell (ChatGPT chat summary 3 Oct 01:10: Just talk / idea / paste; beats as memory triggers; 1-3 delivery cues). The shell is a stand-in, not one of Deth's chosen frames (D-98).
// Usage: node test/shells/check_prepare.cjs <folder> [http://127.0.0.1:PORT/path]   (with a URL it checks the wired screen; requests to that same origin are allowed; screenshots go to SHOT_DIR or .tmp/shells/)
//
// This is the copy inside the app folder (Plan 02-05; D-102, D-104, D-142), made with cp from the shell folder's check_prepare.js. It needs playwright on NODE_PATH (tools/browser.js finds it).
// It differs from the original in four places, the same ones as check_ideas.cjs, and no assertion is touched (every line that asserts is byte for byte; test/shell-checks.test.js holds those lines to a sha256):
// 1. the guard just below: with no folder it prints its usage line and stops. `node --test` runs every file under test/, this one included, so under the test runner that is exit 0; from a shell it is exit 2.
// 2. the url, origin and shotDir line: an optional served address after the folder, and screenshots in SHOT_DIR, or .tmp/shells/ in the app folder. Never beside a page.
// 3. the request line lets through requests to the served address's own origin, and the goto line opens that address when one is given.
// 4. the screenshot line near the end writes prepare-<width>.png into the screenshot folder.
if (!process.argv[2]) { console.log('Usage: node test/shells/check_prepare.cjs <folder> [http://127.0.0.1:PORT/path]   (playwright on NODE_PATH; screenshots go to SHOT_DIR or .tmp/shells/)'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
const url = /^https?:\/\//.test(process.argv[3] || '') ? process.argv[3] : null; const origin = url ? new URL(url).origin : null; const shotDir = path.resolve(process.env.SHOT_DIR || path.join(__dirname, '..', '..', '.tmp', 'shells'));
const words = s => s.trim().split(/\s+/).filter(Boolean).length;
(async () => {
  const f = path.join(dir, 'index.html'); if (!fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u) && !(origin && u.startsWith(origin))) ext.push(u); });
    const T = id => `[data-testid="${id}"]`;
    const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => (await p.$eval(T(id), e => e.innerText).catch(() => ''));
    const click = async id => { const e = await p.$(T(id)); if (!e) { need(false, `${w}: [data-testid=${id}] missing`); return; } await e.click().catch(() => need(false, `${w}: cannot click ${id}`)); await p.waitForTimeout(250); };
    const beats = async () => p.$$eval(T('beat'), es => es.map(e => ({ label: (e.querySelector('[data-testid="beat-label"]') || {}).innerText || '', points: [...e.querySelectorAll('[data-testid="beat-point"]')].map(x => x.innerText) })));
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300);
    for (const id of ['brand', 'title', 'choice-just-talk', 'choice-idea', 'choice-paste', 'recent', 'camera']) need(await vis(id), `${w}: ${id} missing on the home screen`);
    need(/what are we making/i.test(await txt('title')), `${w}: home title should ask "What are we making?"`);
    need((await p.$$(T('recent-row'))).length >= 1, `${w}: no recent recording rows`);
    // Just talk -> default beats, no model
    await click('choice-just-talk');
    let bs = await beats(); need(bs.map(x => x.label.toLowerCase()).join(',') === 'hook,story,point,takeaway', `${w}: Just talk should give the default beats Hook, Story, Point, Takeaway (got ${bs.map(x => x.label).join(', ')})`);
    await click('back-home');
    // Idea -> 3-6 beats, labels <= 3 words, points <= 6 words, at most 3 per beat
    await click('choice-idea'); need(await vis('idea-input'), `${w}: idea input missing after Start from an idea`);
    await p.fill(T('idea-input'), 'Why most people use AI wrong, and the story of my client').catch(() => need(false, `${w}: cannot type in idea-input`));
    await click('make-beats'); bs = await beats();
    need(bs.length >= 3 && bs.length <= 6, `${w}: idea should give 3-6 beats (got ${bs.length})`);
    for (const x of bs) { need(words(x.label) >= 1 && words(x.label) <= 3, `${w}: beat label "${x.label}" should be 1-3 words`); need(x.points.length <= 3, `${w}: beat "${x.label}" has ${x.points.length} points (max 3)`); for (const pt of x.points) need(words(pt) <= 6, `${w}: point "${pt}" is over 6 words`); }
    // delivery cues: 6 chips, at most 3 chosen
    const chips = await p.$$(T('cue-chip')); need(chips.length === 6, `${w}: ${chips.length} delivery cue chips (want 6)`);
    const want = ['slow down', 'smile', 'more energy', 'pause', 'look at lens', 'land the point']; const ct = (await p.$$eval(T('cue-chip'), es => es.map(e => e.innerText.toLowerCase()))).join('|');
    for (const c of want) need(ct.includes(c), `${w}: no "${c}" chip`);
    for (const c of chips.slice(0, 4)) { await c.click(); await p.waitForTimeout(120); }
    const on = (await p.$$eval(T('cue-chip'), es => es.filter(e => e.getAttribute('aria-pressed') === 'true').length));
    need(on === 3, `${w}: choosing 4 cues should leave exactly 3 chosen (aria-pressed), got ${on}`);
    need(await vis('cue-limit'), `${w}: a 4th cue should show a short note (cue-limit) that 3 is the most`);
    need(await vis('start-recording'), `${w}: Start recording button missing`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b/.test(body), `${w}: no score or grade`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(shotDir, `prepare-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS Home + Prepare shell: three starts, default beats, idea beats within limits, 6 cues with a 3-cue limit, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
