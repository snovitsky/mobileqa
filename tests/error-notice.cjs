const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.resolve(__dirname, '../extension/panel.css'), 'utf8');
const moduleSource = fs.readFileSync(path.resolve(__dirname, '../extension/error-notice.js'), 'utf8');
const fixture = `<!doctype html><meta charset="utf-8"><style>${css}</style><main>
<div id="error-notice" hidden><p id="sync-feedback" role="alert" hidden></p><span id="error-notice-meta"></span>
<button id="error-dismiss" type="button" aria-label="Скрыть сообщение" title="Скрыть сообщение"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div>
<p id="status"></p></main><script type="module">
import { createErrorNotice } from './error-notice.js';
window.dismissals=0;
window.notice=createErrorNotice({container:document.getElementById('error-notice'),text:document.getElementById('sync-feedback'),meta:document.getElementById('error-notice-meta'),dismiss:document.getElementById('error-dismiss'),onDismiss(){window.dismissals++;document.getElementById('status').textContent='Сообщение скрыто. При новом сбое оно появится снова.'}});
</script>`;

(async () => {
 const server = http.createServer((req, res) => {
  const isModule = req.url === '/error-notice.js';
  res.writeHead(200, { 'Content-Type': isModule ? 'application/javascript' : 'text/html; charset=utf-8' });
  res.end(isModule ? moduleSource : fixture);
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, timezoneId: 'UTC' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.notice);
  await page.evaluate(() => {
   window.fakeNow = Date.UTC(2026, 9, 19, 9, 0, 0);
   const NativeDate = Date;
   window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [window.fakeNow])); }
    static now() { return window.fakeNow; }
   };
  });
  const banner = page.locator('#error-notice');
  const message = page.locator('#sync-feedback');
  const meta = page.locator('#error-notice-meta');
  assert.equal(await banner.isVisible(), false);
  await page.evaluate(() => notice.show('Не удалось подключить экран.'));
  assert(await banner.isVisible());
  assert.equal(await message.textContent(), 'Не удалось подключить экран.');
  assert.match(await meta.textContent(), /Появилось в 09:00:00 · Срабатываний: 1/);

  await page.evaluate(() => { fakeNow += 3000; notice.show('Не удалось подключить экран.'); });
  assert.match(await meta.textContent(), /Последнее появление в 09:00:03 · Срабатываний: 2/);
  await page.evaluate(() => { fakeNow += 1000; notice.show('Не удалось открыть вкладку.'); });
  assert.match(await meta.textContent(), /Появилось в 09:00:04 · Срабатываний: 1/);
  assert.equal(await message.textContent(), 'Не удалось открыть вкладку.');
  await page.locator('#error-dismiss').click();
  assert.equal(await banner.isVisible(), false);
  assert.equal(await message.textContent(), '');
  assert.equal(await page.evaluate(() => dismissals), 1);
  assert.equal(await page.locator('#status').textContent(), 'Сообщение скрыто. При новом сбое оно появится снова.');

  await page.evaluate(() => { fakeNow += 1000; notice.show('Не удалось открыть вкладку.'); });
  assert(await banner.isVisible());
  assert.match(await meta.textContent(), /Появилось в 09:00:05 · Срабатываний: 1/);
  await page.evaluate(() => notice.clear());
  assert.equal(await banner.isVisible(), false);
  assert.equal(await meta.textContent(), '');
  assert.equal(await page.evaluate(() => dismissals), 1, 'Автоматическое clear не вызывает обработчик закрытия');
  await page.evaluate(() => notice.show('<img src=x onerror="window.injected=true"> ' + 'ДлинныйАдрес'.repeat(80)));
  assert.equal(await banner.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert((await message.textContent()).startsWith('<img src=x onerror='));
  assert.match(await meta.textContent(), /Срабатываний: 1$/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Баннер должен помещаться в узкое окно');
  await page.locator('#error-dismiss').focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'error-dismiss');
  await page.keyboard.press('Enter');
  assert.equal(await banner.isVisible(), false);
  assert.equal(await page.evaluate(() => dismissals), 2);
  assert.deepEqual(errors, []);
  console.log('PASS error notice: dismiss/reappear, timestamp and repeat count, changed message, clear, safe text, narrow viewport and keyboard close');
 } finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
