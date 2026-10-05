if (!process.argv[2]) { console.log('Usage: check copied shell folder and served URL'); process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 2); }
// Check for the YAP live-mode screen shell. Usage: node check_live.js <task dir>. Prints every failed assertion; exit 0 only when all pass.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const dir = path.resolve(process.argv[2] || '.');
const fails = [];
const need = (ok, msg) => { if (!ok) fails.push(msg); };
const url=process.argv[3], origin=url ? new URL(url).origin : null; const shotDir=process.env.SHOT_DIR || path.join(__dirname,'..','..','.tmp','shells'); fs.mkdirSync(shotDir,{recursive:true});
(async () => {
  const page_ = path.join(dir, 'index.html');
  if (!fs.existsSync(page_)) { console.log('FAIL index.html missing in ' + dir); process.exit(1); }
  const css = ['styles.css'].map(f => path.join(dir, f)).filter(fs.existsSync).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  need(/:root\s*{[^}]*--/s.test(css), 'styles.css has no colour/size tokens on :root');
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = [], ext = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push(String(e)));
    p.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:') && !(origin && new URL(r.url()).origin===origin)) ext.push(r.url()); });
    await p.goto(url || 'file://' + page_);
    await p.waitForTimeout(400);
    const box = async id => { const el = await p.$(`[data-testid="${id}"]`); if (!el) { need(false, `${w}x${h}: [data-testid=${id}] missing`); return null; } const r = await el.boundingBox(); need(!!r && r.width > 0 && r.height > 0, `${w}x${h}: ${id} not visible`); return r; };
    for (const id of ['camera', 'brand', 'tagline', 'help', 'story-card', 'story-label', 'beat-title', 'delivery-cue', 'pause', 'stop', 'timer', 'tick', 'beats', 'edit', 'export']) await box(id);
    const txt = async id => (await p.$eval(`[data-testid="${id}"]`, e => e.innerText).catch(() => ''));
    need(/show up\.?\s*yap\.?\s*be you/i.test((await txt('tagline')).replace(/\n/g, ' ')), `${w}x${h}: tagline is not "Show up. Yap. Be you."`);
    need(/story/i.test(await txt('story-label')), `${w}x${h}: story label does not say STORY`);
    const pts = await p.$$('[data-testid="point"]');
    need(pts.length >= 1 && pts.length <= 3, `${w}x${h}: ${pts.length} talking points (want 1-3)`);
    for (const el of pts) { const t = (await el.innerText()).trim(); need(t.split(/\s+/).length <= 6, `${w}x${h}: talking point over 6 words: "${t}"`); }
    const nodes = await p.$$('[data-testid="beat-node"]');
    need(nodes.length === 5, `${w}x${h}: ${nodes.length} beat nodes (want 5)`);
    const done = await p.$$('[data-testid="beat-node"][data-state="done"]'), cur = await p.$$('[data-testid="beat-node"][data-state="current"]');
    need(done.length >= 1 && cur.length === 1, `${w}x${h}: beats need done ticks and exactly one current (done=${done.length} current=${cur.length})`);
    // the near-axis rule (ChatGPT chat, 3 Oct 01:10): story and delivery cues together on the centre line, never on two sides of the face
    const s = await box('story-card'), d = await box('delivery-cue');
    if (s && d) {
      const sc = s.x + s.width / 2, dc = d.x + d.width / 2;
      need(Math.abs(sc - w / 2) < w * 0.08, `${w}x${h}: story card is not centred (centre ${Math.round(sc)} vs ${w / 2})`);
      need(Math.abs(dc - sc) < 120, `${w}x${h}: delivery cue is ${Math.round(Math.abs(dc - sc))}px off the story card's centre line (max 120)`);
      const gap = d.y > s.y ? d.y - (s.y + s.height) : s.y - (d.y + d.height);
      need(gap < 60, `${w}x${h}: delivery cue is ${Math.round(gap)}px from the story card (max 60)`);
    }
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    need(sw <= w, `${w}x${h}: horizontal scroll (${sw}px wide)`);
    need(errs.length === 0, `${w}x${h}: console errors: ${errs.slice(0, 3).join(' | ')}`);
    need(ext.length === 0, `${w}x${h}: network requests outside the folder: ${ext.slice(0, 3).join(' ')}`);
    await p.screenshot({ path: path.join(shotDir, `live-${w}.png`) });
    await p.close();
  }
  await b.close();
  if (fails.length) { console.log('FAIL\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('PASS live-mode shell: all elements, cue rule, 2 sizes, no errors, no network; screenshots shot-1440.png shot-1280.png');
})().catch(e => { console.log('FAIL check crashed: ' + e); process.exit(1); });
