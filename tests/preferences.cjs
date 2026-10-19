const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brandmaker-preferences-'));
 const extension = path.join(root, 'extension');
 fs.cpSync(path.resolve(__dirname, '../extension'), extension, { recursive: true });
 const profile = path.join(root, 'profile');
 let context, page, extensionId, sourceId;
 async function launch() {
  context = await chromium.launchPersistentContext(profile, {
   channel: 'chromium', headless: true, viewport: { width: 1600, height: 1100 },
   ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  const cd = await context.browser().newBrowserCDPSession();
  extensionId = (await cd.send('Extensions.loadUnpacked', { path: extension })).id;
  const source = await context.newPage();
  await source.goto('about:blank');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  sourceId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  page = await context.newPage();
  await open();
 }
 async function open(source = true) {
  await page.goto(`chrome-extension://${extensionId}/panel.html${source ? '?source=' + sourceId : ''}`);
  await page.waitForFunction(() => document.querySelectorAll('.device').length > 0);
 }
 async function assertSelection(scale = '1', sync = false, followSource = false) {
  assert.equal(await page.locator('#count').inputValue(), '3');
  assert.deepEqual(await page.locator('.device').evaluateAll(cards => cards.map(card => card.classList.contains('landscape'))), [true, false, true]);
  assert.equal(await page.locator('#scale').inputValue(), scale);
  assert.equal(await page.locator('#sync').isChecked(), sync);
  assert.equal(await page.locator('#follow-source').isChecked(), followSource);
  assert.equal(await page.locator('#calibration-dialog').evaluate(el => el.open), false);
 }
 try {
  await launch();
  // Старые записи без новых полей читаются с прежними defaults.
  await page.evaluate(() => chrome.storage.local.set({ preferences: {
   count: '4', compatibility: false, devices: ['iphone11', 'redminote13', 'galaxya12', 'ipad11'], futureOption: 'keep',
  } }));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 4);
  assert.equal(await page.locator('#scale').inputValue(), 'auto');
  assert(await page.locator('#sync').isChecked());
  assert(await page.locator('#follow-source').isChecked());
  await page.locator('#count').selectOption('3');
  await page.locator('.device').nth(0).locator('[data-action=rotate]').click();
  await page.locator('.device').nth(2).locator('[data-action=rotate]').click();
  await page.locator('#count').selectOption('4');
  await page.locator('#count').selectOption('3');
  await page.locator('#scale').selectOption('css');
  await page.locator('#sync').uncheck();
  await page.locator('#follow-source').uncheck();
  await page.locator('#scale').selectOption('1');
  await page.locator('#calibration-method').selectOption('ruler');
  await page.locator('#measurement-width').fill('250');
  await page.locator('#calibration-save').click();
  await page.waitForFunction(async () => {
   const { preferences } = await chrome.storage.local.get('preferences');
   return preferences.scale === '1' && preferences.count === '3' && preferences.sync === false && preferences.followSource === false;
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 3);
  await assertSelection();
  assert.equal((await page.evaluate(() => chrome.storage.local.get('preferences'))).preferences.futureOption, 'keep');
  // Режим сохраняется и при открытии панели без источника; ID вкладки не сохраняем.
  await open(false);
  await assertSelection();
  assert(await page.locator('#source-controls').isVisible());
  const stored = (await page.evaluate(() => chrome.storage.local.get('preferences'))).preferences;
  assert(!('sourceTabId' in stored));
  // Настоящий перезапуск Chromium с тем же профилем, без копирования storage.
  await context.close(); context = null;
  await launch();
  await assertSelection();
  const calibration = (await page.evaluate(() => chrome.storage.local.get('displayCalibration'))).displayCalibration;
  assert.equal(calibration.pxPerMM, 5);
  // Выбор любого другого масштаба и включённые checkbox тоже сохраняются.
  await page.locator('#scale').selectOption('0.75');
  await page.locator('#sync').check();
  await page.locator('#follow-source').check();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 3);
  await assertSelection('0.75', true, true);
  // Физический масштаб без калибровки не должен притворяться реальным размером.
  await page.evaluate(() => chrome.storage.local.remove('displayCalibration'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 3);
  await assertSelection('auto', true, true);
  await page.locator('#scale').selectOption('css');
  await page.locator('#scale').selectOption('1');
  await page.locator('#calibration-cancel').click();
  await page.waitForFunction(() => document.querySelector('#scale').value === 'css');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 3);
  await assertSelection('css', true, true);
  await page.evaluate(() => chrome.storage.local.set({ preferences: { count: '99', scale: 'invalid', sync: 'false', followSource: 'false' } }));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.device').length === 4);
  assert.equal(await page.locator('#scale').inputValue(), 'auto');
  assert(await page.locator('#sync').isChecked());
  assert(await page.locator('#follow-source').isChecked());
  console.log('PASS preferences: legacy/defaults, reload/new panel/browser restart, per-screen orientation + count rebuild, 3 screens + physical scale/calibration + both switches, CSS/75%, cancel, invalid values, retained fields and no stored tab IDs');
 } finally {
  await context?.close();
  fs.rmSync(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
