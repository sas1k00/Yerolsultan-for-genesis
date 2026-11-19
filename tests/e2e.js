/* End-to-end check in headless Chromium.
 * Serve the folder first:  python3 -m http.server 8765
 * Then:                    node tests/e2e.js [outDir]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out');
const URL = process.env.DIARY_URL || 'http://localhost:8765/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.goto(URL);
  await page.waitForSelector('#demo');
  const t0 = Date.now();
  await page.click('#demo');
  await page.waitForSelector('.folder', { timeout: 120000 });
  console.log('demo days built in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.screenshot({ path: path.join(OUT, 'archive.png'), fullPage: true });
  const days = await page.evaluate(async () => (await TD.store.all()).map((d) => ({
    id: d.id, title: d.title, tech: d.design.technique, mood: d.design.mood, bpm: d.music.bpm, mode: d.music.mode,
    detected: d.music.detectedMode, shot: +d.design.motion.shotDur.toFixed(2), air: +d.design.air.toFixed(2),
  })));
  console.table(days);
  await page.goto(URL + '#/feed');
  await page.waitForSelector('.feed img');
  await page.screenshot({ path: path.join(OUT, 'feed.png'), fullPage: true });
  for (const d of days) {
    await page.goto(URL + '#/day/' + d.id);
    await page.waitForSelector('#play');
    await page.click('#play');
    await page.waitForTimeout(2600);
    const shot = await page.locator('canvas').screenshot();
    fs.writeFileSync(path.join(OUT, `day-${d.id}.png`), shot);
  }
  // reload persistence
  await page.goto(URL);
  await page.reload();
  const count = await page.locator('.folder').count();
  console.log('folders after reload:', count);
  // zip export works
  await page.goto(URL + '#/day/' + days[0].id);
  await page.waitForSelector('#zip');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#zip')]);
  const zp = path.join(OUT, 'folder.zip');
  await dl.saveAs(zp);
  console.log('zip:', dl.suggestedFilename(), fs.statSync(zp).size, 'bytes');
  const zl = require('child_process').execSync(`python3 -c "import zipfile,sys;[print('   ',n) for n in zipfile.ZipFile(sys.argv[1]).namelist()]" ${zp}`).toString();
  console.log(zl);

  // the real user path: form with a link-only song
  await page.goto(URL + '#/new');
  await page.fill('textarea[name=text]', 'Гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали.');
  await page.fill('input[name=date]', '2026-10-20');
  await page.setInputFiles('input[name=photos]', [path.join(__dirname, '../demo/photos/autumn-1.jpg'), path.join(__dirname, '../demo/photos/autumn-2.jpg')]);
  await page.fill('input[name=link]', 'https://www.youtube.com/watch?v=example0001');
  await page.fill('input[name=artist]', 'Frank Sinatra');
  await page.fill('input[name=title]', 'The Way You Look Tonight');
  await page.selectOption('select[name=genre]', 'jazz');
  await page.fill('input[name=year]', '1964');
  await page.check('input[name=moodHint][value=major]');
  await page.check('input[name=tempoHint][value=slow]');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/day\//, { timeout: 60000 });
  await page.waitForSelector('.side h1');
  const formTitle = await page.textContent('.side h1');
  const hasEmbed = await page.locator('.embed iframe').count();
  console.log('form day title:', formTitle, '| youtube embed:', hasEmbed);
  if (formTitle !== 'Осенний парк и какао') errors.push('unexpected title from form: ' + formTitle);
  await page.click('#play');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'form-day.png') });

  // phone layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await page.waitForSelector('.folder');
  await page.screenshot({ path: path.join(OUT, 'phone-archive.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) errors.push('horizontal scroll on phone');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
