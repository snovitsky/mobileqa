const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.resolve(__dirname, '../extension/panel.css'), 'utf8');
const child = `<!doctype html><meta charset="utf-8"><style>
body{margin:24px;background:white;color:#17212b;font:18px Arial}h1{font:28px Arial}input{display:block;margin-top:20px;width:350px;padding:8px}
</style><h1><span id="word">Responsive</span> website text</h1><p>Text inside the website remains selectable.</p><input id="field" aria-label="Поле сайта" value="Website input text">`;
const host = `<!doctype html><meta charset="utf-8"><style>${css}</style>
<style>main{width:850px;margin:20px;padding:10px}.device{width:620px;--device-scale:1}.deviceheading{height:40px}.screen{width:600px;height:320px}.screen iframe{width:600px;height:320px}</style>
<main><article class="device"><div class="deviceheading"><span id="heading">Заголовок экрана</span><span>01</span></div>
<div class="dimensions">600 × 320 CSS px</div><div class="shell"><div class="screen"><iframe title="Локальный сайт" src="/site"></iframe></div></div>
<p class="pageurl">http://localhost/example</p><div class="controls"><button>Обновить</button></div></article></main>`;

(async () => {
 const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.url === '/site' ? child : host);
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const iframe = await page.locator('iframe').elementHandle();
  const frame = await iframe.contentFrame();
  await frame.locator('#field').waitFor();
  const heading = await page.locator('#heading').boundingBox();
  const screen = await page.locator('.screen').boundingBox();
  // Реальный drag из оболочки через iframe не должен выделять iframe как объект родительского документа.
  await page.mouse.move(heading.x + 3, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.mouse.move(screen.x + screen.width - 15, screen.y + screen.height - 15, { steps: 25 });
  await page.mouse.up();
  const selection = await page.evaluate(() => {
   const selected = getSelection();
   const iframe = document.querySelector('iframe');
   return {
    text: selected.toString(),
    containsFrame: !!selected.rangeCount && !selected.isCollapsed && selected.getRangeAt(0).intersectsNode(iframe),
   };
  });
  assert.equal(selection.containsFrame, false, 'Оболочка не должна выделять iframe целиком');
  assert.equal(selection.text, '', 'Drag из заголовка не должен выделять текст оболочки');

  // user-select оболочки не распространяется на документ внутри iframe.
  await frame.locator('#word').dblclick();
  assert.equal((await frame.evaluate(() => getSelection().toString())).trim(), 'Responsive');
  const field = frame.locator('#field');
  await field.click();
  await field.press('Control+A');
  assert.equal(await field.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), 'Website input text');
  await field.press('Backspace');
  await field.pressSequentially('Edited website input');
  assert.equal(await field.inputValue(), 'Edited website input');

  // Адрес под экраном по-прежнему можно выделить для копирования.
  await page.locator('.pageurl').dblclick();
  assert((await page.evaluate(() => getSelection().toString())).length > 0);
  await page.locator('#heading').click();
  fs.mkdirSync(path.resolve(__dirname, '../dist'), { recursive: true });
  await page.screenshot({ path: path.resolve(__dirname, '../dist/selection-safe.png') });
  console.log('PASS selection: drag across iframe does not select its host object; website text, input editing and displayed URL selection remain available');
 } finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
