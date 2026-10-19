const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
 const rootPath = path.resolve(__dirname, '..');
 const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
 const errorsURL = dataModule(fs.readFileSync(path.join(rootPath, 'extension/errors.js'), 'utf8'));
 const { ERROR_MESSAGES, userError, userMessage, httpStatusMessage } = await import(errorsURL);
 const devicesSource = fs.readFileSync(path.join(rootPath, 'extension/devices.js'), 'utf8').replace("'./errors.js'", JSON.stringify(errorsURL));
 const { normalizeURL } = await import(dataModule(devicesSource));
 for (const [input, code] of [[null, 'inputInvalid'], ['', 'inputEmpty'], ['http://', 'inputInvalid'], ['chrome://extensions', 'inputUnsupported'], ['file:///test', 'inputUnsupported'], ['https://name:password@example.test', 'inputCredentials']]) {
  assert.throws(() => normalizeURL(input), error => error.code === code && error.message === ERROR_MESSAGES[code]);
 }
 assert.equal(normalizeURL('localhost:3000/path'), 'https://localhost:3000/path');
 assert.equal(normalizeURL('example.test:8080'), 'https://example.test:8080/');
 assert(httpStatusMessage(404).includes('страница не найдена'));
 assert(httpStatusMessage(401).includes('требует входа'));
 assert(httpStatusMessage(403).includes('отказал в доступе'));
 assert(httpStatusMessage(503).includes('ошибке сервера'));
 assert(httpStatusMessage(0).includes('не означает ошибку'));
 assert(httpStatusMessage('RAW_NATIVE_DETAIL').includes('не сообщил'));
 assert.equal(userMessage(new Error('RAW_NATIVE_DETAIL')), ERROR_MESSAGES.operationFailed);
 assert.equal(userMessage(new Error('RAW_NATIVE_DETAIL'), 'settingsSaveFailed'), ERROR_MESSAGES.settingsSaveFailed);

 // Неподключённый адрес источника должен давать ошибку источника, а не поля URL.
 const state = { source: { url: 'http://example.test/' }, allowed: true, updates: [], injectFailure: false, nativeFailure: false };
 let onMessage;
 const event = () => ({ addListener() {} });
 const chrome = {
  runtime: { id: 'local-test', getURL: name => 'chrome-extension://local-test/' + name, onMessage: { addListener(listener) { onMessage = listener; } }, sendMessage: async () => {} },
  permissions: { contains: async () => state.allowed, onAdded: event(), onRemoved: event() },
  storage: { session: { get: async () => ({}), set: async () => {} } },
  declarativeNetRequest: { getSessionRules: async () => { if (state.nativeFailure) throw new Error('RAW_NATIVE_DETAIL'); return []; }, updateSessionRules: async () => {} },
  scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, executeScript: async () => { if (state.injectFailure) throw new Error('RAW_NATIVE_DETAIL'); } },
  tabs: { query: async () => state.source ? [{ id: 5, windowId: 1, ...state.source }] : [], onActivated: event(), get: async () => { if (!state.source) throw new Error('RAW_NATIVE_DETAIL'); return state.source; }, update: async (...args) => state.updates.push(args), sendMessage: async () => {}, onRemoved: event(), onUpdated: event() },
  windows: { get: async id => ({ id, type: 'normal' }), getLastFocused: async () => ({ id: 1, type: 'normal' }), getAll: async () => [{ id: 1, type: 'normal' }], update: async () => {}, onFocusChanged: event() },
  action: { onClicked: event() },
 };
 const background = fs.readFileSync(path.join(rootPath, 'extension/background.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
 vm.runInNewContext(background, { chrome, normalizeURL, ERROR_MESSAGES, userError, userMessage, URL, crypto }, { filename: 'background.js' });
 const sender = { id: chrome.runtime.id, tab: { id: 100 }, frameId: 0, url: chrome.runtime.getURL('panel.html') };
 const dispatch = message => new Promise(resolve => onMessage(message, sender, resolve));
 const prepare = () => dispatch({ type: 'prepare', url: 'http://example.test/', sourceTabId: 5, compatibility: false });
 for (const [source, code] of [[null, 'sourceUnavailable'], [{}, 'sourceUnavailable'], [{ url: 'chrome://newtab/' }, 'sourceNotWebsite'], [{ url: 'http://other.test/' }, 'sourceDifferentSite']]) {
  state.source = source;
  const response = await prepare();
  assert.equal(response.code, code);
  assert.equal(response.error, ERROR_MESSAGES[code]);
  assert(!response.error.includes('Введите адрес'));
 }
 assert.equal(state.updates.length, 0, 'Validation must not navigate the user’s source tab');
 state.source = { url: 'http://example.test/' }; state.allowed = false;
 assert.equal((await prepare()).code, 'accessDenied'); state.allowed = true;
 state.injectFailure = true; assert.equal((await prepare()).code, 'sourceConnectFailed'); state.injectFailure = false;
 state.nativeFailure = true; const unknown = await prepare();
 assert.equal(unknown.code, 'startFailed'); assert(!unknown.error.includes('RAW_NATIVE_DETAIL')); state.nativeFailure = false;
 assert.equal((await prepare()).ok, true);
 assert.equal((await dispatch({ type: 'unknown-operation' })).code, 'operationFailed');
 state.source = { id: 5, windowId: 1, url: 'http://example.test/' };
 assert.equal((await dispatch({ type: 'resolve-source', sourceTabId: 5 })).data.state, 'ready');
 state.allowed = false;
 assert.equal((await dispatch({ type: 'resolve-source', sourceTabId: 5 })).data.state, 'needs-access');
 state.source = { id: 5, windowId: 1 };
 assert.equal((await dispatch({ type: 'resolve-source', sourceTabId: 5 })).data.state, 'unknown-url');
 state.source.url = 'chrome://settings/';
 assert.equal((await dispatch({ type: 'resolve-source', sourceTabId: 5 })).data.state, 'unsupported');
 state.source = null;
 assert.equal((await dispatch({ type: 'resolve-source', sourceTabId: 5 })).data.state, 'unavailable');
 state.allowed = true;
 console.log('PASS error catalog/URL/source cases/native error sanitization and no automatic source navigation');

 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brandmaker-errors-'));
 const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Тест сообщений</h1><input id="field"><div style="height:1600px"></div>'); }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 let context;
 try {
  const ext = path.join(temp, 'extension'); fs.cpSync(path.join(rootPath, 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'))); manifest.host_permissions = ['http://127.0.0.1/*']; fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1600, height: 1100 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  const cd = await context.browser().newBrowserCDPSession(); const { id } = await cd.send('Extensions.loadUnpacked', { path: ext });
  const source = await context.newPage(); await source.goto('about:blank'); await source.bringToFront();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const sourceId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const page = await context.newPage(); const site = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(site)}&source=${sourceId}`);
  await page.locator('#source-notice').waitFor({ state: 'visible' });
  const message = await page.locator('#source-notice').textContent();
  assert(message.trim().length > 0);
  assert(!message.includes('Введите адрес')); assert.equal(await page.locator('#url').inputValue(), site);
  assert.equal(await page.locator('.screen iframe[src]').count(), 0, 'Unsupported source waits without a misleading launch error');
  await page.locator('#follow-source').uncheck(); await page.locator('#start').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'));
  // A repeated replay failure must identify the action and allow dismissal in the actual panel.
  const replayToken = await page.evaluate(async () => Object.values((await chrome.storage.session.get('panels')).panels)[0].token);
  const replayFrame = page.frames().find(frame => frame.url().startsWith(site));
  const failReplay = () => replayFrame.evaluate(token => parent.postMessage({ app: 'mobile-qa-v2', token, type: 'missing', reason: 'element-missing', kind: 'click', eventId: 123 }, '*'), replayToken);
  const runningIndicator = await page.locator('#status').evaluate(el => getComputedStyle(el).backgroundColor);
  await failReplay();
  await page.waitForFunction(() => document.querySelector('#sync-feedback').textContent.includes('не удалось повторить нажатие'));
  assert((await page.locator('#sync-feedback').textContent()).includes('iPhone 11'));
  assert((await page.locator('#sync-feedback').textContent()).includes('однозначно найти'));
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'running');
  assert.equal(await page.locator('#status').evaluate(el => getComputedStyle(el).backgroundColor), runningIndicator);
  assert.equal(await page.locator('#error-notice').getAttribute('data-severity'), 'warning');
  assert.equal(await page.locator('#status').evaluate(el => el.classList.contains('error')), false);
  await failReplay();
  await page.waitForFunction(() => document.querySelector('#error-notice-meta').textContent.includes('Срабатываний: 2'));
  await page.screenshot({ path: 'dist/error-message.png' });
  await page.locator('#error-dismiss').click();
  assert.equal(await page.locator('#error-notice').isVisible(), false);
  await failReplay();
  await page.waitForFunction(() => !document.querySelector('#error-notice').hidden && document.querySelector('#error-notice-meta').textContent.includes('Срабатываний: 1'));
  await page.locator('#error-dismiss').click();
  await page.locator('#url').fill('http://'); await page.locator('#start').click();
  assert.equal(await page.locator('#sync-feedback').textContent(), ERROR_MESSAGES.inputInvalid);
  await page.locator('#url').fill(''); await page.locator('#start').click();
  assert.equal(await page.locator('#sync-feedback').textContent(), ERROR_MESSAGES.inputEmpty);
  await page.locator('#url').fill(site);
  await page.evaluate(() => { window.originalRequest = chrome.permissions.request; chrome.permissions.request = async () => false; });
  await page.locator('#start').click(); assert.equal(await page.locator('#sync-feedback').textContent(), ERROR_MESSAGES.accessDenied);
  await page.evaluate(() => { chrome.permissions.request = window.originalRequest; window.originalSet = chrome.storage.local.set; chrome.storage.local.set = async () => { throw new Error('RAW_NATIVE_DETAIL'); }; });
  await page.locator('#sync').uncheck();
  await page.waitForFunction(expected => document.querySelector('#sync-feedback').textContent === expected, ERROR_MESSAGES.settingsSaveFailed);
  assert(!(await page.locator('#sync-feedback').textContent()).includes('RAW_NATIVE_DETAIL'));
  await page.locator('.settings-menu > summary').click(); await page.locator('#calibrate').click();
  await page.locator('#measurement-width').fill('250'); await page.locator('#calibration-save').click();
  assert.equal(await page.locator('#sync-feedback').textContent(), ERROR_MESSAGES.calibrationSaveFailed);
  await page.locator('#calibration-cancel').click();
  await page.evaluate(() => { chrome.storage.local.set = window.originalSet; });
  const failedRead = await context.newPage();
  await failedRead.addInitScript(() => { if (location.protocol === 'chrome-extension:') chrome.storage.local.get = async () => { throw new Error('RAW_NATIVE_DETAIL'); }; });
  await failedRead.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(site)}`);
  await failedRead.waitForFunction(expected => document.querySelector('#sync-feedback').textContent === expected, ERROR_MESSAGES.settingsReadFailed);
  assert.equal(await failedRead.locator('.screen iframe[src]').count(), 0, 'Do not auto-start with potentially wrong default settings');
  assert.equal(await failedRead.locator('#status').getAttribute('data-state'), 'error');
  await failedRead.close();
  const retainedFrame = page.frames().find(frame => frame.url().startsWith(site));
  await retainedFrame.evaluate(() => dispatchEvent(new Event('beforeunload')));
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'loading');
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'running');
  // Existing views must not leave the indicator blue after losing their bridge connection.
  await worker.evaluate(async () => chrome.scripting.unregisterContentScripts());
  await page.evaluate(() => {
   window.realSetTimeout = window.setTimeout;
   window.setTimeout = (fn, delay, ...args) => window.realSetTimeout(fn, [10000,12000].includes(delay) ? 50 : delay, ...args);
  });
  await page.locator('[data-action="reload"]').first().click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'partial');
  assert((await page.locator('#status').getAttribute('title')).includes('Часть экранов'));
  const reloads = page.locator('[data-action="reload"]');
  for (let index = 1; index < await reloads.count(); index++) await reloads.nth(index).click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'disconnected');
  await page.evaluate(() => { window.setTimeout = window.realSetTimeout; });
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'running');
  const spaFrame = page.frames().find(frame => frame.url().startsWith(site));
  await spaFrame.evaluate(() => history.pushState({}, '', '/spa-route'));
  await page.waitForFunction(() => document.querySelector('.pageurl').textContent.endsWith('/spa-route'));
  await page.locator('[data-action="back"]').first().click();
  await page.waitForFunction(url => document.querySelector('.pageurl').textContent === url && document.querySelector('.device-status').textContent === 'Подключён', site);
  // Permission management uses isolated API doubles; no user browser grants are touched.
  await page.evaluate(() => {
   window.realGetAll = chrome.permissions.getAll;
   window.realRemove = chrome.permissions.remove;
   window.accessGrants = ['https://xn--e1afmkfd.xn--p1ai/*', 'http://beta.example/*'];
   window.accessCalls = [];
   chrome.permissions.getAll = async () => ({ origins: [...window.accessGrants] });
   chrome.permissions.remove = async request => {
    window.accessCalls.push(request);
    if (window.rejectRevoke) return false;
    window.accessGrants = window.accessGrants.filter(origin => !request.origins.includes(origin));
    return true;
   };
  });
  await page.locator('.settings-menu > summary').click();
  await page.locator('#site-access > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.site-access-list li').length === 2);
  assert((await page.locator('.site-access-list').textContent()).includes('https://пример.рф/*'));
  assert((await page.locator('.site-access-origin').allTextContents()).every(text=>!text.includes('xn--')));
  assert((await page.locator('.site-access-origin').evaluateAll(elements=>elements.map(el=>el.title))).includes('https://xn--e1afmkfd.xn--p1ai/*'));
  await page.screenshot({path:'dist/site-access-idn.png'});
  await page.getByRole('button', { name: 'Отозвать доступ к https://пример.рф/*', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.site-access-list li').length === 1);
  assert.deepEqual(await page.evaluate(() => window.accessCalls), [{ origins: ['https://xn--e1afmkfd.xn--p1ai/*'] }]);
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'running', 'An unrelated revoked site must not stop the current session');
  await page.evaluate(() => { window.rejectRevoke = true; });
  await page.locator('.site-access-list button').click();
  await page.waitForFunction(expected => document.querySelector('#sync-feedback').textContent === expected, ERROR_MESSAGES.siteAccessRevokeFailed);
  assert.equal(await page.locator('.site-access-list li').count(), 1);
  await page.setViewportSize({ width: 390, height: 1000 });
  if(!await page.locator('.settings-menu').evaluate(el=>el.open))await page.locator('.settings-menu > summary').click();
  assert(await page.locator('#site-access').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: 'dist/site-access-narrow.png' });
  await page.setViewportSize({ width: 1600, height: 1100 });
  if(!await page.locator('.settings-menu').evaluate(el=>el.open))await page.locator('.settings-menu > summary').click();
  await page.evaluate(() => {
   window.rejectRevoke = false;
   window.realContains = chrome.permissions.contains;
   chrome.permissions.contains = async () => false;
  });
  await page.locator('.site-access-list button').click();
  await page.waitForFunction(() => document.querySelector('.site-access-state').textContent.includes('Нет сохранённых'));
  assert.equal(await page.locator('.site-access-list li').count(), 0);
  await page.waitForFunction(() => document.querySelectorAll('.screen iframe[src]').length === 0);
  await page.waitForFunction(async()=>Object.keys((await chrome.storage.session.get('panels')).panels||{}).length===0);
  await page.evaluate(() => { chrome.permissions.getAll = window.realGetAll; chrome.permissions.remove = window.realRemove; chrome.permissions.contains = window.realContains; });
  // Authenticated invalidation clears already-injected documents and their token, retaining no live view.
  const panelId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async panelTabId => chrome.runtime.sendMessage({ type: 'access-revoked', panelTabId, origins: ['http://127.0.0.1/*'], sessionRevoked: true }), panelId);
  await page.waitForFunction(() => document.querySelectorAll('.screen iframe[src]').length === 0);
  assert((await page.locator('.device-status').allTextContents()).every(text => text === 'Доступ отозван'));
  assert.equal(await page.locator('#status').getAttribute('data-state'), 'idle');
  const mixedVersion = await context.newPage();
  await mixedVersion.addInitScript(() => {
   if(location.protocol !== 'chrome-extension:')return;
   const realManifest=chrome.runtime.getManifest;
   chrome.runtime.getManifest=()=>({...realManifest(),version:'2.6.13'});
   window.versionSeen=[];
   new MutationObserver(()=>{
    const text=document.getElementById('version')?.textContent;
    if(text)window.versionSeen.push(text);
   }).observe(document,{childList:true,subtree:true,characterData:true});
  });
  await mixedVersion.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(site)}`);
  await mixedVersion.waitForFunction(()=>!document.querySelector('#update-notice').hidden);
  assert.equal(await mixedVersion.locator('#version').textContent(),'2.6.13');
  assert((await mixedVersion.locator('#update-notice').textContent()).includes('Доступна версия 2.6.18'));
  await mixedVersion.waitForFunction(()=>document.querySelector('#status').dataset.state==='running');
  assert.equal(await mixedVersion.locator('.screen iframe[src]').count(),4,'An older loaded version may keep working');
  assert(!(await mixedVersion.evaluate(()=>window.versionSeen)).includes('2.6.18'),'Do not flash the source version as the loaded version');
  await mixedVersion.locator('#start').click();
  await mixedVersion.waitForFunction(()=>document.querySelector('#status').dataset.state==='running');
  assert.equal(await mixedVersion.locator('.screen iframe[src]').count(),4);
  assert.equal(await mixedVersion.locator('#error-notice').isVisible(),false);
  assert.equal(await mixedVersion.locator('#update-notice').isVisible(),true);
  await mixedVersion.locator('#update-dismiss').click();
  assert.equal(await mixedVersion.locator('#update-notice').isVisible(),false);
  assert.equal(await mixedVersion.locator('#status').getAttribute('data-state'),'running');
  await mixedVersion.close();
  console.log('PASS browser messages: filled URL + neutral unsupported source, standalone recovery, malformed/empty URL, denied permission, failed settings read/write and calibration');
 } finally {
  await context?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
