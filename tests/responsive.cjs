const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brandmaker-responsive-'));
 const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}main{width:100%;height:100vh}@media(min-width:700px){main{background:#abc}}</style><main>Локальная проверка свободного viewport</main><script>window.siteClicks=0;document.addEventListener("click",()=>siteClicks++);</script>');
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 const url = `http://127.0.0.1:${server.address().port}/`;
 const extension = path.join(root, 'extension');
 fs.cpSync(path.resolve(__dirname, '../extension'), extension, { recursive: true });
 const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
 manifest.host_permissions = ['http://127.0.0.1/*'];
 fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
 let context;
 try {
  context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
   channel: 'chromium', headless: true, viewport: { width: 1600, height: 1100 },
   ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  const cd = await context.browser().newBrowserCDPSession();
  const { id } = await cd.send('Extensions.loadUnpacked', { path: extension });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { count: '3', followSource: false, scale: 'css' } }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(url)}`);
  await page.waitForFunction(() => document.querySelectorAll('.device-status').length === 3 &&
   [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'));

  const normalized = await page.evaluate(async () => {
   const { normalizeResponsiveSize } = await import('./responsive.js');
   return [normalizeResponsiveSize(), normalizeResponsiveSize({ width: Infinity, height: NaN }),
    normalizeResponsiveSize({ width: -2, height: 5000 }), normalizeResponsiveSize({ width: 600.4, height: 700.6 })];
  });
  assert.deepEqual(normalized, [{ width: 390, height: 844 }, { width: 390, height: 844 },
   { width: 240, height: 3840 }, { width: 600, height: 701 }]);
  const card = page.locator('.device').first();
  const currentSize = () => card.locator('iframe').evaluate(el => [parseFloat(el.style.width), parseFloat(el.style.height)]);
  async function viewport(w, h) {
   const frame = await (await card.locator('iframe').elementHandle()).contentFrame();
   try {
    await frame.waitForFunction(([expectedWidth, expectedHeight]) => innerWidth === expectedWidth && innerHeight === expectedHeight, [w, h]);
   } catch (error) {
    throw new Error(`Expected ${w}x${h}; actual ${JSON.stringify(await frame.evaluate(() => [innerWidth, innerHeight]))}; controls ${JSON.stringify(await card.locator('.responsive-resize').evaluateAll(elements => elements.map(el => ({ aria: el.getAttribute('aria-label'), active: el.classList.contains('resizing') }))))}`, { cause: error });
   }
  }
  const preferences = () => page.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  await card.locator('select').selectOption('responsive');
  await viewport(390, 844);
  assert.equal(await card.locator('.responsive-controls').count(), 0);
  assert.equal(await card.locator('.responsive-width,.responsive-height').count(), 0);
  assert.equal(await page.locator('#calibration-model option[value="responsive"]').count(), 0);
  for (const selector of ['.hardware-top', '.browser-top', '.browser-bottom']) {
   assert.equal(await card.locator(selector).evaluate(el => getComputedStyle(el).display), 'none');
  }
  async function dragHandle(axis, cssX, cssY) {
   const handle = card.locator(`.responsive-resize-${axis}`);
   await handle.scrollIntoViewIfNeeded();
   const before = await currentSize();
   const persisted = (await preferences()).responsiveSizes[0];
   const screen = await card.locator('.screen').boundingBox();
   const scale = screen.width / before[0];
   const box = await handle.boundingBox();
   const x = box.x + box.width / 2, y = box.y + box.height / 2;
   const hit = await page.evaluate(([x,y]) => { const el=document.elementFromPoint(x,y);return {className:el?.className,x,y}; }, [x,y]);
   await page.mouse.move(x, y);
   await page.mouse.down();
   await page.mouse.move(x + cssX * scale, y + cssY * scale, { steps: 8 });
   const expected = [Math.max(240, Math.min(3840, before[0] + cssX)), Math.max(240, Math.min(3840, before[1] + cssY))];
   assert.deepEqual(await currentSize(), expected, JSON.stringify({axis, hit, before, scale, active:await handle.evaluate(el=>el.classList.contains('resizing')),pageErrors}));
   await viewport(...expected);
   assert.deepEqual((await preferences()).responsiveSizes[0], persisted, 'Live resize не должен писать preferences до отпускания');
   await page.mouse.up();
   const landscape = await card.evaluate(el => el.classList.contains('landscape'));
   const canonical = landscape ? { width: expected[1], height: expected[0] } : { width: expected[0], height: expected[1] };
   await page.waitForFunction(async expected => JSON.stringify((await chrome.storage.local.get('preferences')).preferences.responsiveSizes[0]) === JSON.stringify(expected), canonical);
   assert.match(await card.locator('.dimensions').textContent(), new RegExp(`${expected[0]} × ${expected[1]} CSS px`));
   assert.match(await handle.getAttribute('aria-label'), new RegExp(String(axis === 'height' ? expected[1] : expected[0])));
   assert.equal(await handle.evaluate(el => el.classList.contains('resizing')), false);
   assert.equal(await page.locator('.responsive-resize-shield').count(), 0, 'Защитный слой должен удаляться после завершения resize');
   const content = await (await card.locator('iframe').elementHandle()).contentFrame();
   await content.waitForFunction(() => typeof siteClicks === 'number');
   assert.equal(await content.evaluate(() => siteClicks), 0, 'Ручки рамки не должны нажимать элементы сайта');
   return expected;
  }
  await dragHandle('height', 0, -344);
  await dragHandle('width', 10, 0);
  await dragHandle('both', 30, 20);
  await card.locator('[data-action="rotate"]').click();
  await viewport(520, 430);
  await dragHandle('both', 20, 30);
  assert.deepEqual((await preferences()).responsiveSizes[0], { width: 460, height: 540 });
  await page.locator('#count').selectOption('4');
  await page.locator('#count').selectOption('3');
  await viewport(540, 460);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.device select')?.value === 'responsive');
  await viewport(540, 460);
  assert(await card.evaluate(el => el.classList.contains('landscape')));
  await page.locator('#scale').selectOption('auto');
  await dragHandle('width', 40, 0);
  assert.equal(await page.locator('#scale').inputValue(), 'auto');

  // Сохранённые размеры около границ позволяют проверить clamp настоящим коротким drag.
  async function restoreSize(width, height) {
   await page.evaluate(async size => {
    const { preferences } = await chrome.storage.local.get('preferences');
    preferences.responsiveSizes[0] = size;
    preferences.landscapes[0] = false;
    await chrome.storage.local.set({ preferences });
   }, { width, height });
   await page.reload();
   await page.waitForFunction(() => document.querySelector('.device select')?.value === 'responsive');
   await viewport(width, height);
  }
  await restoreSize(3830, 500);
  await dragHandle('width', 30, 0);
  await restoreSize(250, 500);
  await dragHandle('width', -30, 0);

  // Доступная клавиатура меняет тот же viewport и сохраняет размеры.
  await card.locator('.responsive-resize-width').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await viewport(250, 500);
  await page.waitForFunction(async () => (await chrome.storage.local.get('preferences')).preferences.responsiveSizes[0].width === 250);
  await page.keyboard.press('ArrowRight');
  await viewport(251, 500);
  await card.locator('.responsive-resize-height').focus();
  await page.keyboard.press('ArrowDown');
  await viewport(251, 501);
  await page.waitForFunction(async () => (await chrome.storage.local.get('preferences')).preferences.responsiveSizes[0].height === 501);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.device select')?.value === 'responsive');
  await viewport(251, 501);
  assert.equal(await page.locator('#scale').inputValue(), 'auto');
  const cancelHandle = card.locator('.responsive-resize-width');
  await cancelHandle.scrollIntoViewIfNeeded();
  const cancelBox = await cancelHandle.boundingBox();
  const cancelScale = (await card.locator('.screen').boundingBox()).width / 251;
  const cancelX = cancelBox.x + cancelBox.width / 2, cancelY = cancelBox.y + cancelBox.height / 2;
  await page.mouse.move(cancelX, cancelY);
  await page.mouse.down();
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('responsive-resize-width')), true);
  await page.mouse.move(cancelX + 10 * cancelScale, cancelY, { steps: 5 });
  await viewport(261, 501);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.responsive-resize-shield').count(), 0);
  assert.equal(await cancelHandle.evaluate(el => el.classList.contains('resizing')), false);
  await page.mouse.up();
  await page.waitForFunction(async () => (await chrome.storage.local.get('preferences')).preferences.responsiveSizes[0].width === 261);
  const frame = await (await card.locator('iframe').elementHandle()).contentFrame();
  await frame.waitForFunction(() => typeof siteClicks === 'number');
  assert.equal(await frame.evaluate(() => siteClicks), 0, 'Ручки рамки не должны нажимать элементы сайта');
  await card.locator('select').selectOption('galaxys24');
  assert.equal(await card.locator('iframe').evaluate(el => parseFloat(el.style.width)), 360);
  assert(await card.locator('.responsive-resize-width').isDisabled());
  assert.equal(await card.locator('.responsive-resize-width').isVisible(), false);
  await card.locator('select').selectOption('responsive');
  await viewport(261, 501);
  async function editDimension(kind, value) {
   await card.locator(`button.dimension-${kind}`).click();
   const editor = card.locator(`input.dimension-${kind}`);
   await editor.fill(value);
   await editor.press('Enter');
  }
  await page.locator('#scale').selectOption('auto');
  const peerViewport = await page.locator('.device iframe').nth(1).evaluate(el=>[el.style.width,el.style.height]);
  await editDimension('width','1920');
  await editDimension('height','600');
  await editDimension('scale','50%');
  await viewport(1920,600);
  assert.equal(await card.locator('button.dimension-scale').textContent(),'50%');
  assert.equal(await card.locator('.dimension-editor').count(),0,'Editors must disappear after editing');
  assert(Math.abs((await card.locator('iframe').boundingBox()).width-960)<.1);
  assert(Math.abs((await card.locator('iframe').boundingBox()).height-300)<.1);
  assert.deepEqual(await page.locator('.device iframe').nth(1).evaluate(el=>[el.style.width,el.style.height]),peerViewport,'Changing responsive scale must preserve hardware CSS viewports');
  assert(await page.locator('#devices').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Auto layout must reserve room for a manually scaled responsive screen');
  assert(await card.locator('button.dimension-scale').evaluate(el=>getComputedStyle(el).fontWeight==='700'&&getComputedStyle(el).color===getComputedStyle(el.parentElement).color));
  for(const [kind,value] of [['width','abc'],['height','9999'],['scale','0']]){
   await editDimension(kind,value);
   assert.equal(await card.locator('.dimension-editor').count(),1);
   await card.locator('.dimension-editor').press('Escape');
   await viewport(1920,600);
   assert.equal(await card.locator('button.dimension-scale').textContent(),'50%');
  }
  await card.locator('button.dimension-width').click();
  await card.locator('input.dimension-width').fill('1930');
  await page.setViewportSize({width:1500,height:1100});
  assert.equal(await card.locator('input.dimension-width').inputValue(),'1930','Layout changes must preserve an unfinished inline edit');
  await card.locator('input.dimension-width').press('Escape');
  await editDimension('scale','37,5%');
  await viewport(1920,600);
  assert(Math.abs((await card.locator('iframe').boundingBox()).width-720)<.1);
  await editDimension('scale','');
  await page.waitForFunction(async()=> (await chrome.storage.local.get('preferences')).preferences.responsiveScales[0]===null);
  assert(await page.locator('#devices').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await editDimension('scale','50');
  await dragHandle('width',20,0);
  await editDimension('width','1920');
  await card.locator('[data-action="rotate"]').click();
  await viewport(600,1920);
  await editDimension('width','700');
  await viewport(700,1920);
  await card.locator('[data-action="rotate"]').click();
  await viewport(1920,700);
  await editDimension('height','600');
  await page.locator('#count').selectOption('4');
  await page.locator('#count').selectOption('3');
  await viewport(1920,600);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('.device select')?.value==='responsive');
  await viewport(1920,600);
  assert.equal(await card.locator('button.dimension-scale').textContent(),'50%');
  assert.equal((await preferences()).responsiveScales[0],.5);
  assert.equal(await card.locator('.dimensions input').count(),0);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: 'dist/responsive-device.png' });
  console.log('PASS responsive: handles and inline 1920x600/50%, exact viewport, scale/auto fit, validation/Escape, edit across resize, rotation, persistence/rebuild/reload and calibration isolation');
 } finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
