// Check for the YAP Ideas opening shell. Frame accepted by Deth 3 Oct 2026 04:47 in his demo chat ("so I am happy with this frame but am looking for th enext one"): ref/approved-ideas-opening.png.
// Usage: node test/shells/check_ideas.cjs <folder> [http://127.0.0.1:PORT/path]   (with a URL it checks the wired screen; requests to that same origin are allowed; screenshots go to SHOT_DIR or .tmp/shells/)
//
// This is the copy inside the app folder (Plan 02-04; D-102, D-142), made with cp from the shell folder's check_ideas.js. It needs playwright on NODE_PATH (tools/browser.js finds it).
// It differs from the original in four places, the same ones as check_frame.cjs, and no assertion is touched (every line that asserts is byte for byte; test/shell-checks.test.js holds those lines to a sha256):
// 1. the guard just below: with no folder it prints its usage line and stops. `node --test` runs every file under test/, this one included, so under the test runner that is exit 0; from a shell it is exit 2.
// 2. the url, origin and shotDir line: an optional served address after the folder, and screenshots in SHOT_DIR, or .tmp/shells/ in the app folder. Never beside a page.
// 3. the request line lets through requests to the served address's own origin, and the goto line opens that address when one is given.
// 4. the screenshot line near the end writes ideas-<width>.png into the screenshot folder.
if (!process.argv[2]) { console.log('Usage: node test/shells/check_ideas.cjs <folder> [http://127.0.0.1:PORT/path]   (playwright on NODE_PATH; screenshots go to SHOT_DIR or .tmp/shells/)'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
const url = /^https?:\/\//.test(process.argv[3] || '') ? process.argv[3] : null; const origin = url ? new URL(url).origin : null; const shotDir = path.resolve(process.env.SHOT_DIR || path.join(__dirname, '..', '..', '.tmp', 'shells'));
const norm = s => s.replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/\s+/g, ' ').trim().toLowerCase();
(async () => {
  const f = path.join(dir, 'index.html'); if (!fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(1500); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u) && !(origin && u.startsWith(origin))) ext.push(u); });
    const T = id => `[data-testid="${id}"]`;
    const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => norm(await p.$eval(T(id), e => e.innerText).catch(() => ''));
    const box = async id => { const e = await p.$(T(id)); return e ? await e.boundingBox() : null; };
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300);
    // the frame's words, exactly
    const words = { brand: 'yap', 'nav-home': 'home', 'nav-ideas': 'ideas', 'nav-create': 'create', 'nav-review': 'review', 'nav-grow': 'grow', eyebrow: 'open ideas', title: "what's on your mind?", subtitle: "talk or type. we'll work through it together.", 'chip-idea': 'an idea for a video', 'chip-think': 'help me think it through', 'talk-to-yap': 'talk to yap', 'saved-ideas': 'saved ideas', 'need-spark': 'need a spark?', 'idea-heading': 'your idea', 'idea-status': 'not started', 'idea-empty-title': 'a place for your idea to take shape.', 'idea-empty-sub': "as we talk, we'll build it here." };
    for (const [id, want] of Object.entries(words)) { need(await vis(id), `${w}: ${id} missing or hidden`); const got = await txt(id); need(got === want, `${w}: ${id} should read "${want}" (got "${got}")`); }
    need((await p.$eval(T('nav-ideas'), e => e.getAttribute('aria-current')).catch(() => null)) === 'page', `${w}: nav-ideas should be the current page (aria-current="page")`);
    need(norm(await p.$eval(T('idea-input'), e => e.getAttribute('placeholder') || '').catch(() => '')) === 'start with a rough thought...', `${w}: idea-input placeholder should be "Start with a rough thought..."`);
    // layout: nav, then the conversation panel, then a wider idea panel, side by side
    const nav = await box('nav'), left = await box('talk-panel'), right = await box('idea-panel');
    need(nav && left && right, `${w}: nav, talk-panel and idea-panel must all exist`);
    if (nav && left && right) {
      need(nav.x < left.x && left.x + left.width <= right.x + 1, `${w}: order left to right should be nav, talk-panel, idea-panel`);
      need(right.width > left.width, `${w}: idea-panel should be wider than talk-panel (${Math.round(right.width)} vs ${Math.round(left.width)})`);
      need(Math.abs(left.y - right.y) < 8 && Math.abs(left.height - right.height) < 8, `${w}: the two panels should share top and height`);
      need(nav.width < 190, `${w}: nav should be a narrow column (${Math.round(nav.width)}px)`);
    }
    // the gold button is the one strong action
    const rgb = await p.$eval(T('talk-to-yap'), e => getComputedStyle(e).backgroundColor + ' ' + getComputedStyle(e).backgroundImage).catch(() => '');
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); need(m && +m[1] > 200 && +m[2] > 140 && +m[3] < 130, `${w}: Talk to YAP should be the gold button (got ${rgb.slice(0, 60)})`);
    const tb = await box('talk-to-yap'), ib = await box('idea-input'); if (tb && ib) need(tb.y > ib.y + ib.height - 1 && Math.abs(tb.width - ib.width) < 12, `${w}: Talk to YAP sits under the text box at the same width`);
    // behaviour: send is off until there is text; send and talk announce themselves for the app to wire
    need(await p.$eval(T('send'), e => e.disabled === true).catch(() => false), `${w}: send should be disabled while the box is empty`);
    await p.evaluate(() => { window.__ev = []; for (const n of ['yap:idea-submit', 'yap:talk']) document.addEventListener(n, e => window.__ev.push([n, e.detail && e.detail.text])); });
    await p.fill(T('idea-input'), 'Why I plan a video in twenty minutes').catch(() => need(false, `${w}: cannot type in idea-input`));
    need(await p.$eval(T('send'), e => e.disabled === false).catch(() => false), `${w}: send should enable once there is text`);
    await p.click(T('send')).catch(() => need(false, `${w}: cannot click send`)); await p.click(T('talk-to-yap')).catch(() => need(false, `${w}: cannot click talk-to-yap`)); await p.waitForTimeout(150);
    const ev = await p.evaluate(() => window.__ev);
    need(ev.some(e => e[0] === 'yap:idea-submit' && e[1] === 'Why I plan a video in twenty minutes'), `${w}: send should dispatch yap:idea-submit on document with detail.text`);
    need(ev.some(e => e[0] === 'yap:talk'), `${w}: Talk to YAP should dispatch yap:talk on document`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b/.test(body), `${w}: no score or grade`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    const sh = await p.evaluate(() => document.documentElement.scrollHeight); need(sh <= h, `${w}: the opening should fit one screen without vertical scroll (${sh}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.fill(T('idea-input'), '').catch(() => {}); fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(shotDir, `ideas-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS Ideas opening shell: the frame\'s words, nav + two panels, gold Talk to YAP, send and talk events, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
