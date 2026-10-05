if (!process.argv[2]) { console.log('Usage: check copied shell folder and served URL'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
// Check for the YAP "Hey YAP" moment shell (his confirmed image 17, 3 Oct 01:32). Usage: node check_heyyap.js <task dir>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.'); const fails = []; const need = (ok, m) => { if (!ok) fails.push(m); };
const url=process.argv[3], origin=url ? new URL(url).origin : null; const shotDir=process.env.SHOT_DIR || path.join(__dirname,'..','..','.tmp','shells'); fs.mkdirSync(shotDir,{recursive:true});
(async () => {
  const f = path.join(dir, 'index.html'); if (!fs.existsSync(f)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { const u = r.url(); if (!u.startsWith('file://') && !u.startsWith('data:') && !(origin && new URL(u).origin===origin)) ext.push(u); });
    await p.goto(url || 'file://' + f); await p.waitForTimeout(300);
    const T = id => `[data-testid="${id}"]`;
    const vis = async id => { const e = await p.$(T(id)); return !!e && await e.isVisible(); };
    const txt = async id => (await p.$eval(T(id), e => e.innerText).catch(() => ''));
    const click = async id => { const e = await p.$(T(id)); if (!e) { need(false, `${w}: [data-testid=${id}] missing`); return; } await e.click(); await p.waitForTimeout(250); };
    need(await vis('story-card'), `${w}: story card not visible before Help opens`);
    need(/grab a tea/i.test(await txt('story-card')), `${w}: before the trial the story card should hold the greeting "Grab a tea. Let's get into it."`);
    await click('help');
    for (const id of ['help-panel', 'dim', 'msg-you', 'msg-yap', 'experiment-card', 'experiment-tag', 'experiment-line', 'trial-minus', 'trial-value', 'trial-plus', 'try', 'keep', 'say-input', 'mic', 'send', 'back', 'stop', 'timer']) need(await vis(id), `${w}: ${id} not visible with Help open`);
    need(!(await vis('delivery-cue')) && (await vis('story-card')) === (w >= 1100 && h >= 820), `${w}: delivery cue hides; roomy screens retain the current wording beside chat`);
    const pb = await (await p.$(T('help-panel')))?.boundingBox();
    if (pb) need(pb.x > w * 0.5 && pb.y < h * 0.25 && pb.x + pb.width <= w, `${w}: Help panel should sit at the top right (x=${Math.round(pb.x)} y=${Math.round(pb.y)})`);
    need(/coffee/i.test(await txt('msg-you')) && /tea/i.test(await txt('msg-you')), `${w}: your message should ask to try "Grab a coffee" instead of "Grab a tea"`);
    need(/three videos|3 videos/i.test(await txt('msg-yap')), `${w}: YAP's reply should offer a three-video trial`);
    need(/new experiment/i.test(await txt('experiment-card')), `${w}: card label NEW EXPERIMENT missing`);
    need(/greeting/i.test(await txt('experiment-tag')), `${w}: tag should read Greeting`);
    need(/grab a coffee/i.test(await txt('experiment-line')), `${w}: experiment line should be "Grab a coffee. Let's get into it."`);
    need(/^\s*3 videos\s*$/i.test(await txt('trial-value')) && /3 videos/i.test(await txt('try')), `${w}: trial should start at 3 videos and the button read "Try for 3 videos"`);
    need(/keep tea/i.test(await txt('keep')), `${w}: fallback button should read "Keep tea"`);
    need(!(await vis('trial-saved')), `${w}: "Trial saved" must not show before you accept`);
    await click('trial-plus'); need(/4 videos/i.test(await txt('trial-value')) && /4 videos/i.test(await txt('try')), `${w}: + should make it 4 videos (value and button)`);
    await click('trial-minus'); need(/3 videos/i.test(await txt('trial-value')), `${w}: - should return to 3 videos`);
    const ph = await p.$eval(T('say-input'), e => e.getAttribute('placeholder') || '').catch(() => ''); need(/say it or type it/i.test(ph), `${w}: input placeholder should be "Say it or type it…"`);
    const bodyTxt = (await p.evaluate(() => document.body.innerText)).toLowerCase();
    need(!/(more views|boost|improv\w* (your )?(views|performance|reach)|guarantee)/.test(bodyTxt), `${w}: must not imply audience-performance improvement`);
    await click('try');
    need(await vis('trial-saved') && /check-in after 3 videos/i.test(await txt('trial-saved')), `${w}: after Try, "Trial saved · Check-in after 3 videos" should show`);
    await click('back');
    need(!(await vis('help-panel')), `${w}: Back to recording should close the panel`);
    need(await vis('story-card') && /grab a coffee/i.test(await txt('story-card')), `${w}: after the trial the story card should read "Grab a coffee. Let's get into it."`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); need(sw <= w, `${w}: horizontal scroll (${sw}px)`);
    need(errs.length === 0, `${w}: console errors: ${errs.slice(0, 3).join(' | ')}`); need(ext.length === 0, `${w}: network requests: ${ext.slice(0, 3).join(' ')}`);
    await click('help'); await p.screenshot({ path: path.join(shotDir, `heyyap-${w}.png`) }); await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS Hey YAP shell: panel, coffee experiment, stepper, accept-then-saved, cues hidden and restored with the new greeting, 2 sizes, no errors, no network');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
