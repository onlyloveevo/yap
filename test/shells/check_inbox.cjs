// Check for the YAP Review inbox shell (locked C in the "Prepare Bloom demo today" chat, 3 Oct 02:56 BST).
// Usage: node test/shells/check_inbox.cjs <folder> [http://127.0.0.1:PORT/review]   (with a URL it checks the wired screen; requests to that same origin are allowed; screenshots go to SHOT_DIR or .tmp/shells/)
//
// This is the copy inside the app folder (SCREEN-06), made with cp from the shell folder's check_inbox.js. It differs from the original in these places:
// 1. the guard below: with no folder it prints its usage line and stops (exit 0 under the test runner, 2 from a shell).
// 2. the url, origin and shotDir lines, the request line and the goto lines: an optional served address after the folder, same-origin requests allowed, screenshots in SHOT_DIR.
// 3. SUPERSEDED ON PURPOSE (PRD-review-own-video.md, SCREEN-06): in the shell, "Open review" answered with a toast; in the wired screen it opens /review/:id. That one assertion is replaced (the line marked SUPERSEDED). The shell's "Add video" toast was never asserted here; in the wired screen it opens the file picker.
// 4. SUPERSEDED ON PURPOSE (BUILD_YapSubmitDemo, 4 Oct 2026): Home and Grow opened nothing and left the top bar; the badge reads "Sample videos" and no longer says "Not connected".
// 5. SUPERSEDED ON PURPOSE (BUILD_YapSubmitDemo round 4, 4 Oct 2026, release judges' fault 8): the inbox has the left sidebar every other screen has, in place of the top bar; the profile picture opened nothing and left with the bar.
// Every other assertion is byte for byte the original.
if (!process.argv[2]) { console.log('Usage: node test/shells/check_inbox.cjs <folder> [http://127.0.0.1:PORT/review]'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
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
    const click = async id => { const e = await p.$(T(id)); if (!e) { need(false, `${w}: [data-testid=${id}] missing`); return; } await e.click().catch(() => need(false, `${w}: cannot click ${id}`)); await p.waitForTimeout(220); };
    const cards = async () => p.$$eval(T('card'), es => es.filter(e => e.offsetParent !== null).map(e => ({ status: e.dataset.status, sel: e.dataset.selected === 'true', title: (e.querySelector('[data-testid="card-title"]') || {}).innerText || '', open: !!e.querySelector('[data-testid="open-review"]') && e.querySelector('[data-testid="open-review"]').offsetParent !== null })));
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300);
    for (const id of ['brand', 'nav-ideas', 'nav-create', 'nav', 'nav-review', 'inbox-title', 'sample-badge', 'search', 'filter-needs', 'filter-waiting', 'filter-reviewed', 'filter-all', 'add-video']) need(await vis(id), `${w}: ${id} missing or not visible`);
    need((await p.$eval(T('nav-review'), e => e.getAttribute('aria-current')).catch(() => null)) === 'page', `${w}: Review should be the current nav item (aria-current="page")`);
    need(await p.$eval(T('nav'), e => { const b = e.getBoundingClientRect(); return b.left === 0 && b.height > b.width * 2; }).catch(() => false) && (await p.$$('.top-bar')).length === 0, `${w}: the menu is the left sidebar every screen shares, not a top bar`);
    need(/review inbox/i.test(await txt('inbox-title')), `${w}: title should read "Review inbox"`);
    need(/sample/i.test(await txt('sample-badge')) && !/not connected/i.test(await p.evaluate(() => document.body.innerText)), `${w}: one quiet "Sample videos" badge, and nothing says "Not connected"`); need((await p.$$(T('nav-home'))).length + (await p.$$(T('nav-grow'))).length === 0, `${w}: Home and Grow open nothing, so they are not in the top bar`);
    let cs = await cards();
    need(cs.length >= 4 && cs.every(c => c.status === 'needs'), `${w}: the inbox opens on Needs review with at least 4 cards, all needs (got ${cs.length}: ${cs.map(c => c.status).join(',')})`);
    need(cs.filter(c => c.sel).length === 1 && cs.filter(c => c.open).length === 1 && cs.find(c => c.sel)?.open, `${w}: exactly one selected card, and the only visible Open review button sits on it`);
    for (const c of cs) need(!!c.title.trim(), `${w}: every card needs a card-title`);
    need((await p.$$(T('card-platform'))).length >= 4, `${w}: each card needs its platform (card-platform)`);
    const firstSel = cs.findIndex(c => c.sel); const other = cs.findIndex((c, i) => i !== firstSel);
    if (other >= 0) { const els = await p.$$eval(T('card'), es => es.map((e, i) => e.offsetParent !== null ? i : -1).filter(i => i >= 0)); await (await p.$$(T('card')))[els[other]].click(); await p.waitForTimeout(220); cs = await cards(); need(cs[other]?.sel && cs[other]?.open && cs.filter(c => c.sel).length === 1, `${w}: clicking another card should move the selection and the Open review button to it`); }
    await click('open-review'); await p.waitForTimeout(400); need(/\/review\/[a-z0-9-]+$/.test(new URL(p.url()).pathname), `${w}: Open review should open the review of that video at /review/:id (got ${p.url()})`); /* SUPERSEDED: the shell answered with a toast */ await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300);
    await click('filter-waiting'); cs = await cards(); need(cs.length >= 1 && cs.every(c => c.status === 'waiting'), `${w}: Waiting for results should show only waiting cards (got ${cs.map(c => c.status).join(',')})`);
    need(/grab a coffee/i.test((await p.evaluate(() => document.body.innerText))), `${w}: the coffee trial should appear under Waiting for results`);
    await click('filter-reviewed'); cs = await cards(); need(cs.length >= 1 && cs.every(c => c.status === 'reviewed'), `${w}: Reviewed should show only reviewed cards`);
    await click('filter-all'); const all = (await cards()).length; need(all >= 6, `${w}: All videos should show every card (got ${all})`);
    await p.fill(T('search'), 'launch').catch(() => need(false, `${w}: cannot type in search`)); await p.waitForTimeout(250);
    cs = await cards(); need(cs.length >= 1 && cs.every(c => /launch/i.test(c.title)), `${w}: search "launch" should leave only matching cards (got ${cs.map(c => c.title).join(' | ')})`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b|\b\d{1,3}\s*\/\s*100\b|guarantee|more views/.test(body), `${w}: no scores and no performance promises`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.goto(isUrl ? target : 'file://' + f); await p.waitForTimeout(300); fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(isUrl ? shotDir : dir, isUrl ? `inbox-${w}.png` : `shot-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS review inbox: nav, one quiet sample badge, filters, search, selection with one Open review, coffee trial waiting, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
