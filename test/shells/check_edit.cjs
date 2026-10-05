if (!process.argv[2]) { console.log('Usage: check copied shell folder and served URL'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
// Check for the YAP Edit mode shell (his confirmed image 18, 3 Oct 02:32). Usage: node check_edit.js <task dir>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
const secs = s => { const m = String(s).match(/(\d+):(\d{2})/); return m ? +m[1] * 60 + +m[2] : NaN; };
const url=process.argv[3], origin=url ? new URL(url).origin : null; const shotDir=process.env.SHOT_DIR || path.join(__dirname,'..','..','.tmp','shells'); fs.mkdirSync(shotDir,{recursive:true});
(async () => {
  const f = path.join(dir, 'index.html'); if (!fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:') && !(origin && new URL(u).origin===origin)) ext.push(u); });
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300);
    const T = id => `[data-testid="${id}"]`;
    const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => (await p.$eval(T(id), e => e.innerText).catch(() => ''));
    for (const id of ['brand', 'mode-tab', 'status', 'help', 'player', 'story-overlay', 'play', 'time', 'cc', 'volume', 'fullscreen', 'view-original', 'view-yapcut', 'export', 'clips', 'waveform', 'wave-selection', 'playhead', 'keep', 'shorten', 'retry', 'broll']) need(await vis(id), `${w}: ${id} missing or not visible`);
    need(/edit mode/i.test(await txt('mode-tab')), `${w}: mode tab should read "Edit Mode"`);
    need(/record\.?\s*be you/i.test(await txt('status')), `${w}: status should read "Record. Be you."`);
    need(/story/i.test(await txt('story-overlay')), `${w}: story overlay should carry the STORY label`);
    need(/\d+:\d{2}\s*\/\s*\d+:\d{2}/.test(await txt('time')), `${w}: player time should read like 00:14 / 08:27`);
    const clips = await p.$$eval(T('clip'), es => es.map(e => ({ state: e.dataset.state, dur: +e.dataset.duration, sel: e.dataset.selected === 'true', label: (e.querySelector('[data-testid="clip-label"]') || {}).innerText || '' })));
    need(clips.length >= 7, `${w}: ${clips.length} clips (want at least 7)`);
    need(clips.every(c => (c.state === 'kept' || c.state === 'removed') && c.dur > 0), `${w}: every clip needs data-state kept|removed and data-duration seconds > 0`);
    const labels = clips.map(c => c.label).join(' | ');
    for (const l of ['Aside removed', 'Best take', 'Filler removed']) need(labels.toLowerCase().includes(l.toLowerCase()), `${w}: no clip label "${l}" (have: ${labels})`);
    need(clips.filter(c => c.state === 'removed').length >= 2, `${w}: at least 2 removed clips (the aside and the filler)`);
    need(clips.filter(c => c.sel).length === 1, `${w}: exactly one clip selected`);
    need(await vis('kept-bubble') && /kept,? that'?s you/i.test(await txt('kept-bubble')), `${w}: the "kept, that's you" bubble should show over the selected clip`);
    const sum = st => clips.filter(c => st.includes(c.state)).reduce((a, c) => a + c.dur, 0);
    const yc = secs(await txt('view-yapcut')), og = secs(await txt('view-original'));
    need(yc === sum(['kept']), `${w}: YAP cut length ${yc}s should equal the kept clips' total ${sum(['kept'])}s`);
    need(og === sum(['kept', 'removed']), `${w}: Original length ${og}s should equal all clips' total ${sum(['kept', 'removed'])}s`);
    need((await p.$eval(T('view-yapcut'), e => e.getAttribute('aria-pressed')).catch(() => null)) === 'true', `${w}: YAP cut should be the selected view (aria-pressed="true")`);
    // undo: a removed clip restores on click, and the YAP cut grows by its length
    const ri = clips.findIndex(c => c.state === 'removed'); const rd = clips[ri]?.dur || 0;
    if (ri >= 0) {
      await (await p.$$(T('clip')))[ri].click(); await p.waitForTimeout(250);
      const st = await p.$$eval(T('clip'), (es, i) => es[i].dataset.state, ri);
      need(st === 'kept', `${w}: clicking a removed clip should restore it (state is ${st})`);
      need(secs(await txt('view-yapcut')) === yc + rd, `${w}: after restoring, YAP cut should be ${yc + rd}s (is ${secs(await txt('view-yapcut'))}s)`);
    }
    // selecting another kept clip moves the selection and the waveform highlight
    const before = await p.$eval(T('wave-selection'), e => e.getBoundingClientRect().left).catch(() => NaN);
    const states = await p.$$eval(T('clip'), es => es.map(e => [e.dataset.state, e.dataset.selected === 'true']));
    const ki = states.findIndex(([s, sel], i) => s === 'kept' && !sel && i !== ri);
    if (ki >= 0) {
      await (await p.$$(T('clip')))[ki].click(); await p.waitForTimeout(250);
      const sel = await p.$$eval(T('clip'), es => es.map(e => e.dataset.selected === 'true'));
      need(sel[ki] && sel.filter(Boolean).length === 1, `${w}: clicking a kept clip should make it the only selected clip`);
      const after = await p.$eval(T('wave-selection'), e => e.getBoundingClientRect().left).catch(() => NaN);
      need(Math.abs(after - before) > 2, `${w}: the waveform highlight should move to the newly selected clip`);
    }
    await p.click(T('view-original'), { timeout: 2000 }).catch(() => need(false, `${w}: cannot click Original`)); await p.waitForTimeout(200);
    need((await p.$eval(T('view-original'), e => e.getAttribute('aria-pressed')).catch(() => null)) === 'true', `${w}: clicking Original should select it`);
    await p.click(T('broll'), { timeout: 2000 }).catch(() => need(false, `${w}: cannot click Add B-roll`)); await p.waitForTimeout(200);
    need(await vis('toast') && /coming soon/i.test(await txt('toast')), `${w}: Add B-roll should say it is coming soon (a toast), not fake an edit`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\b\d{1,3}\s*\/\s*100\b|\bscore\b|\bgrade\b/.test(body), `${w}: no score or grade for the person`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shotDir, `edit-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS Edit mode shell: player, views with consistent lengths, clip undo, selection and waveform, B-roll coming soon, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
