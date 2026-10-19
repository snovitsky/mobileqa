const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const fixture = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html{overflow-y:scroll}body{margin:0;font:18px Arial;color:#193248;background:#f5f8fb}h1,p{padding:20px}#nested{height:100px;overflow-y:scroll;margin:20px}#nested div{height:500px}.tail{height:2200px;background:linear-gradient(#edf7fc,#bfdae8)}iframe{width:100%;height:90px;border:0}</style>
<h1>Проверка чёткости и прокрутки</h1><p>Живой текст страницы — CSS viewport сохраняется при масштабировании.</p>
<div id="nested"><div>Самостоятельная прокрутка блока</div></div><iframe src="/child"></iframe><div class="tail"></div>`;

(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brandmaker-ui-'));
 const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.url === '/child' ? '<!doctype html><style>html{overflow-y:scroll}</style><div style="height:1000px">Дочерняя страница сайта</div>' : fixture);
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 const url = `http://127.0.0.1:${server.address().port}/`;
 const ext = path.join(root, 'extension');
 fs.cpSync(path.resolve(__dirname, '../extension'), ext, { recursive: true });
 const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
 manifest.host_permissions = ['http://127.0.0.1/*'];
 fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
 let context;
 try {
  for (const dpr of [1, 1.25, 2]) {
   context = await chromium.launchPersistentContext(path.join(root, `profile-${dpr}`), {
    channel: 'chromium', headless: true, viewport: { width: 1600, height: 1100 }, deviceScaleFactor: dpr,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
   });
   const cd = await context.browser().newBrowserCDPSession();
   const { id } = await cd.send('Extensions.loadUnpacked', { path: ext });
   const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
   await worker.evaluate(() => chrome.storage.local.set({ preferences: { followSource: false } }));
   const page = await context.newPage();
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(url)}`);
   await page.waitForFunction(() => document.querySelectorAll('.device-status').length === 4 &&
    [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'));
   assert(await page.locator('.device select').first().evaluate(el => getComputedStyle(el).appearance === 'none' && getComputedStyle(el).backgroundImage !== 'none' && parseFloat(getComputedStyle(el).paddingRight) >= 24));
   const frames = page.frames().filter(frame => frame.parentFrame() === page.mainFrame());
   assert.deepEqual(await Promise.all(frames.map(frame => frame.evaluate(() => innerWidth))), [414, 393, 360, 820]);
   for (const frame of frames) {
    assert(await frame.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth === 'none' &&
     document.documentElement.clientWidth === innerWidth && document.documentElement.scrollHeight > innerHeight));
    assert.notEqual(await frame.locator('#nested').evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    const child = frame.childFrames()[0];
    await child.waitForLoadState();
    assert.notEqual(await child.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth), 'none');
   }
   const ordinary = await context.newPage();
   await ordinary.goto(url);
   assert.notEqual(await ordinary.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth), 'none');
   await ordinary.close();
   await page.bringToFront();
   await frames[0].evaluate(()=>{
    window.focusClicks=0;
    const button=document.createElement('button');button.id='focus-click';button.textContent='Click';
    button.style.cssText='position:fixed;left:20px;top:20px;width:100px;height:45px;z-index:1000';
    button.addEventListener('click',event=>{if(event.isTrusted)window.focusClicks++;});
    document.body.append(button);
   });
   await page.locator('#url').focus();
   const outerClick=await page.locator('.screen iframe').first().boundingBox();
   const innerClick=await frames[0].locator('#focus-click').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth};});
   await page.mouse.move(outerClick.x+innerClick.x*outerClick.width/innerClick.width,outerClick.y+innerClick.y*outerClick.width/innerClick.width);
   await page.mouse.down();
   await page.waitForTimeout(80);
   await page.mouse.up();
   assert.equal(await frames[0].evaluate(()=>focusClicks),1,'Moving focus from the panel into an iframe must not cancel its click');
   await frames[0].locator('#focus-click').evaluate(el=>el.remove());
   const screen = await page.locator('.screen').first().boundingBox();
   await page.mouse.move(screen.x + screen.width / 2, screen.y + 60);
   await page.mouse.wheel(0, 250);
   await frames[0].waitForFunction(() => scrollY > 0);
   await frames[0].evaluate(() => scrollTo(0, 0));
   await page.mouse.click(screen.x + 50, screen.y + 60);
   await page.keyboard.press('PageDown');
   await frames[0].waitForFunction(() => scrollY > 0);
   await frames[0].evaluate(() => { document.querySelector('#nested').scrollTop = 130; });
   assert.equal(await frames[0].locator('#nested').evaluate(el => el.scrollTop), 130);
   for (const width of [1600, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.waitForFunction(() => {
     const row = document.querySelector('#devices');
     return row.scrollWidth <= row.clientWidth + 1;
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    const header = await page.locator('.app-header').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(header.scroll <= header.width, `header overflow at ${width}: ${JSON.stringify(header)}`);
    await page.locator('#url').focus();
    assert(await page.locator('#url').evaluate(el => {
     const rect = el.getBoundingClientRect(), start = document.querySelector('#start').getBoundingClientRect();
     return rect.right < start.left && parseFloat(getComputedStyle(el).outlineOffset) <= 0;
    }));
    await page.locator('.settings-menu > summary').click();
    assert(await page.locator('.settings-content').evaluate(el => {
     const rect = el.getBoundingClientRect();
     return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
    }));
    for (const selector of ['#compatibility', '#check-404', '#browser-mode', '#scan-page', '#calibrate', '#align', '#export-debug']) {
     assert(await page.locator(selector).getAttribute('title'), `Missing explanation for ${selector}`);
     assert(await page.locator(selector).evaluate(el => {
      const help = document.getElementById(el.getAttribute('aria-describedby'));
      return help?.classList.contains('sr-only') && getComputedStyle(help).position === 'absolute';
     }), `Settings explanation should only be shown as a tooltip: ${selector}`);
    }
    await page.keyboard.press('Escape');
   }
   await page.setViewportSize({ width: 1600, height: 1100 });
   for (const count of ['3', '5', '4']) {
    await page.locator('#count').selectOption(count);
    await page.waitForFunction(count => document.querySelectorAll('.device-status').length === Number(count) &&
     [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'), count);
    assert(await page.locator('#devices').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
   }
   const current = page.frames().filter(frame => frame.parentFrame() === page.mainFrame());
   await page.locator('#scale').selectOption('css');
   await page.waitForFunction(() => document.querySelector('iframe').getBoundingClientRect().width === 414);
   assert.equal(await current[0].evaluate(() => innerWidth), 414);
   assert.equal(await page.locator('.screen iframe').first().evaluate(el => el.getBoundingClientRect().width), 414);
   await page.locator('#scale').selectOption('auto');
   await page.locator('.controls [data-action=rotate]').first().click();
   await current[0].waitForFunction(() => innerWidth === 896);
   assert(await page.locator('#devices').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
   await page.locator('.controls [data-action=rotate]').first().click();
   await current[0].waitForFunction(() => innerWidth === 414);
   if (dpr === 1) {
    fs.mkdirSync('dist', { recursive: true });
    await page.screenshot({ path: 'dist/ui-fixed-workspace.png', fullPage: true });
    await page.locator('.settings-menu > summary').click();
    await page.screenshot({ path: 'dist/ui-fixed-settings.png' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.screenshot({ path: 'dist/ui-fixed-narrow.png', fullPage: true });
   }
   await page.locator('.settings-menu > summary').click();
   await page.locator('#calibrate').click();
   assert(await page.locator('#calibration-method').evaluate(el => getComputedStyle(el).appearance === 'none' && getComputedStyle(el).backgroundImage !== 'none'));
   async function checkFocus(selector) {
    const control = page.locator(selector).first();
    await control.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert(await control.evaluate(el => {
     const style = getComputedStyle(el);
     return document.activeElement === el && el.matches(':focus-visible') &&
      parseFloat(style.outlineWidth) > 0 && parseFloat(style.outlineWidth) <= 2 &&
      parseFloat(style.outlineOffset) <= 0 && style.outlineColor !== 'rgb(73, 169, 130)';
    }), `Noncompact/missing keyboard focus: ${selector}`);
   }
   await checkFocus('#calibration-method');
   await checkFocus('#measurement-width');
   await checkFocus('#calibration-save');
   await page.locator('#calibration-cancel').click();
   await checkFocus('.device select');
   await checkFocus('.device [data-action=rotate]');
   await checkFocus('#url');
   await checkFocus('.settings-menu > summary');
   await checkFocus('.guide-details summary');
   await page.setViewportSize({ width: 1600, height: 1100 });
   const button = page.locator('.device [data-action=rotate]').first();
   await page.mouse.move(0, 0);
   const beforeHover = await button.evaluate(el => getComputedStyle(el).backgroundColor);
   const beforeRect = await button.boundingBox();
   await button.hover();
   assert.notEqual(await button.evaluate(el => getComputedStyle(el).backgroundColor), beforeHover);
   const afterRect = await button.boundingBox();
   assert.equal(beforeRect.width, afterRect.width);assert.equal(beforeRect.height, afterRect.height);
   if (dpr === 1) {
    await checkFocus('.device select');
    await page.screenshot({ path: 'dist/ui-focus-model.png' });
   }
   assert.deepEqual(errors, []);
   console.log(`PASS UI DPR ${dpr}: root scrollbar isolation, wheel/keyboard/nested scroll, exact viewport, auto fit, header/menu/focus/help, rotation and CSS 1:1`);
   await context.close();
   context = null;
  }
 } finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
