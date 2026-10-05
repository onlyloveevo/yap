if (!process.argv[2]) { console.log('Usage: check copied shell folder and served URL'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
// Check for the YAP Return (take 2) shell: kept note as the first cue, the running coffee trial, and YAP's bet checked after the take. Usage: node check_return.js <task dir>
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
const url=process.argv[3], origin=url ? new URL(url).origin : null; const shotDir=process.env.SHOT_DIR || path.join(__dirname,'..','..','.tmp','shells'); fs.mkdirSync(shotDir,{recursive:true});
(async () => {
  const f = path.join(dir, 'index.html'); if (!fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u) && !(origin && new URL(u).origin===origin)) ext.push(u); });
    const T = id => `[data-testid="${id}"]`;
    const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => (await p.$eval(T(id), e => e.innerText).catch(() => ''));
    const click = async id => { const e = await p.$(T(id)); if (!e) { need(false, `${w}: [data-testid=${id}] missing`); return; } await e.click().catch(() => need(false, `${w}: cannot click ${id}`)); await p.waitForTimeout(250); };
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300);
    for (const id of ['brand', 'camera', 'memory-card', 'memory-keep', 'memory-drop', 'trial-status', 'bet', 'record', 'beats']) need(await vis(id), `${w}: ${id} missing before take 2 starts`);
    need(/last time you wanted to slow down/i.test(await txt('memory-card')) && /keep that cue/i.test(await txt('memory-card')), `${w}: memory card should ask "Last time you wanted to slow down during the opening. Keep that cue?"`);
    need(/grab a coffee/i.test(await txt('trial-status')) && /1 of 3/.test(await txt('trial-status')), `${w}: trial status should read the coffee trial, video 1 of 3`);
    need(/bet/i.test(await txt('bet')) && /at most 2 restarts/i.test(await txt('bet')), `${w}: YAP's bet should read like "My bet: at most 2 restarts this take"`);
    need(!(await vis('story-card')), `${w}: the story card waits until recording starts`);
    await click('memory-keep'); await click('record');
    need(!(await vis('memory-card')), `${w}: the memory card should close when recording starts`);
    for (const id of ['story-card', 'delivery-cue', 'stop', 'timer', 'end-take']) need(await vis(id), `${w}: ${id} missing while recording take 2`);
    need(/slow down/i.test(await txt('delivery-cue')) && /last time/i.test(await txt('delivery-cue')), `${w}: the first delivery cue should be the kept note ("From last time: slow down")`);
    need(/grab a coffee/i.test(await txt('story-card')), `${w}: the story card should open on the trial greeting "Grab a coffee. Let's get into it."`);
    // the delivery cue sits on the centre line above the story card (ChatGPT chat rule)
    const s = await (await p.$(T('story-card')))?.boundingBox(), d = await (await p.$(T('delivery-cue')))?.boundingBox();
    if (s && d) need(Math.abs((s.x + s.width / 2) - (d.x + d.width / 2)) < 120 && Math.abs(s.x + s.width / 2 - w / 2) < w * 0.08, `${w}: cues must sit together on the centre line`);
    await click('end-take');
    need(await vis('bet-result') && /(held|missed)/i.test(await txt('bet-result')) && /restart/i.test(await txt('bet-result')), `${w}: after the take, the bet result should say held or missed with the restart count`);
    const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/\bscore\b|\bgrade\b|\b\d{1,3}\s*\/\s*100\b/.test(body), `${w}: no score or grade for the person`);
    need(!/more views|boost|guarantee/.test(body), `${w}: no performance promises`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300); await p.screenshot({ path: path.join(shotDir, `return-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS Return shell: kept note first, coffee trial 1 of 3, YAP bet checked after the take, cues on the centre line, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
