const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brandmaker-source-following-'));
 const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Локальная проверка источника</h1><input id="field"><div style="height:2000px"></div>');
 }).listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 let context;
 try {
  const ext = path.join(root, 'extension');
  fs.cpSync(path.resolve(__dirname, '../extension'), ext, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
   channel: 'chromium', headless: true, viewport: { width: 1600, height: 1100 },
   ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  const cd = await context.browser().newBrowserCDPSession();
  const { id } = await cd.send('Extensions.loadUnpacked', { path: ext });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const site = 'http://127.0.0.1:' + server.address().port;
  const source = await context.newPage(); await source.goto(site + '/first'); await source.bringToFront();
  const original = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0], source.url());
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { count: '3', followSource: true, sync: false } }));
  const opened = context.waitForEvent('page');
  await worker.evaluate(async url => chrome.windows.create({ url, type: 'popup' }), 'chrome-extension://' + id + '/panel.html?url=' + encodeURIComponent(site + '/first') + '&source=' + original.id);
  const panel = await opened; await panel.waitForLoadState();
  const errors = []; panel.on('pageerror', error => errors.push(error.message));
  async function shown(suffix) {
   await panel.waitForFunction(suffix => {
    const cards = [...document.querySelectorAll('.device-status')];
    return cards.length === 3 && cards.every(el => el.textContent === 'Подключён') && [...document.querySelectorAll('.pageurl')].every(el => el.textContent.endsWith(suffix));
   }, suffix);
  }
  await shown('/first');
  assert.equal(await panel.locator('#start').getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.locator('#stop').getAttribute('aria-pressed'), 'false');
  assert.equal(await panel.locator('#session-state').textContent(), 'Работает');
  assert.equal(await panel.locator('#sync').isChecked(), false);
  await source.goto(site + '/route'); await shown('/route');
  assert.equal(await panel.locator('#url').inputValue(), site + '/route');
  for (const draft of ['', 'http://ungranted.invalid/draft']) {
   await panel.locator('#url').fill(draft);
   await panel.locator('#count').selectOption('4');
   await panel.waitForFunction(() => document.querySelectorAll('.device-status').length === 4 && [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'));
   assert((await panel.locator('.pageurl').allTextContents()).every(url => url.endsWith('/route')));
   assert.equal(await panel.locator('#url').inputValue(), draft);
   await panel.locator('#count').selectOption('3'); await shown('/route');
  }
  await panel.locator('#url').fill(site + '/route');
  const frames = panel.frames().filter(frame => frame.url().startsWith(site));
  await source.locator('#field').fill('только источник'); await panel.waitForTimeout(350);
  assert((await Promise.all(frames.map(frame => frame.locator('#field').inputValue()))).every(value => value === ''));
  // New active websites in the original normal window become the source.
  const secondOpened = context.waitForEvent('page');
  const secondTab = await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: original.windowId, url: site + '/second' });
  const second = await secondOpened; await second.waitForLoadState(); await shown('/second');
  await panel.bringToFront(); await shown('/second');
  const unrelatedOpened = context.waitForEvent('page');
  const unrelatedWindow = await worker.evaluate(async url => chrome.windows.create({ url, type: 'normal' }), site + '/unrelated');
  const unrelated = await unrelatedOpened; await unrelated.waitForLoadState();
  await panel.waitForTimeout(350); await shown('/second');
  await worker.evaluate(id => chrome.windows.remove(id), unrelatedWindow.id);
  // Manual Show navigates the selected source even while action sync is paused.
  await panel.bringToFront(); await panel.locator('#url').fill(site + '/manual'); await panel.locator('#start').click();
  await second.waitForURL('**/manual'); await shown('/manual');
  await panel.locator('#source-open').click();
  await panel.waitForFunction(async windowId => (await chrome.windows.get(windowId)).focused, original.windowId);
  const activated = await worker.evaluate(async windowId => ({ tabs: await chrome.tabs.query({ active: true, windowId }), window: await chrome.windows.get(windowId) }), original.windowId);
  assert.equal(activated.tabs[0].id, secondTab.id); assert.equal(activated.window.focused, true);
  await panel.evaluate(() => {
   window.sourceTrace = [];
   const log = value => { window.sourceTrace.push({ at: performance.now(), ...value }); };
   chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'source-candidate' || message.type === 'desktop-source-event') log({ type: message.type, state: message.state, event: message.eventType, url: message.sourceURL || message.payload?.url });
   });
   const original = chrome.runtime.sendMessage.bind(chrome.runtime);
   chrome.runtime.sendMessage = async message => {
    if (message.type === 'prepare') log({ type: 'prepare-start', url: message.url });
    const response = await original(message);
    if (message.type === 'prepare') log({ type: 'prepare-end', url: message.url, ok: response.ok });
    return response;
   };
   new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.tagName === 'IFRAME'))) log({ type: 'frame-replaced', urls: [...document.querySelectorAll('.pageurl')].map(el => el.textContent) });
   }).observe(document.querySelector('#devices'), { childList: true, subtree: true });
  });
  // Explicit Show reapplies embedding settings even when source and URL are unchanged.
  for (const compatibility of [false, true]) {
   await panel.bringToFront();
   await panel.evaluate(() => { window.beforeCompatibility = [...document.querySelectorAll('.screen iframe')]; });
   await panel.locator('.settings-menu > summary').click();
   await panel.locator('#compatibility').setChecked(compatibility);
   await panel.locator('.settings-menu > summary').click();
   await panel.locator('#start').click();
   await panel.waitForFunction(async enabled => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return rules.length === (enabled ? 1 : 0) && window.beforeCompatibility.every((frame, index) => frame !== document.querySelectorAll('.screen iframe')[index]);
   }, compatibility);
   await shown('/manual');
   await panel.waitForFunction(() => document.querySelector('#session-state').dataset.state === 'running');
  }
  // A navigation response can arrive after Chrome has already reported completion.
  await panel.evaluate(() => {
   const original = chrome.runtime.sendMessage.bind(chrome.runtime);
   window.releaseNavigation = null;
   chrome.runtime.sendMessage = async message => {
    const response = await original(message);
    if (message.type === 'navigate-source') {
     window.navigationResponse = response;
     await new Promise(resolve => { window.releaseNavigation = resolve; });
    }
    return response;
   };
  });
  await panel.locator('#url').fill(site + '/completed-before-response');
  await panel.locator('#start').click();
  await second.waitForURL('**/completed-before-response'); await second.waitForLoadState();
  await panel.waitForFunction(() => typeof window.releaseNavigation === 'function');
  assert.equal(await worker.evaluate(async id => (await chrome.tabs.get(id)).status, secondTab.id), 'complete');
  await panel.evaluate(() => window.releaseNavigation());
  await shown('/completed-before-response');
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'running' && document.querySelector('#source-notice').hidden);
  // A missed completion notification must recover without refreshing or replacing working frames.
  const panelId = await panel.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await panel.evaluate(() => { window.beforeLateLoading = [...document.querySelectorAll('.screen iframe')]; });
  await worker.evaluate(async data => chrome.runtime.sendMessage({ type: 'source-candidate', state: 'loading', ...data }), {
   panelTabId: panelId, sourceTabId: secondTab.id, sourceWindowId: original.windowId,
   sourceURL: site + '/completed-before-response', host: '127.0.0.1',
  });
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'waiting');
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'running' && document.querySelector('#source-notice').hidden);
  assert(await panel.evaluate(() => window.beforeLateLoading.every((frame,index) => frame === document.querySelectorAll('.screen iframe')[index])));
  await second.evaluate(() => dispatchEvent(new Event('beforeunload')));
  await panel.waitForTimeout(150);
  assert.equal(await panel.locator('#status').getAttribute('data-state'), 'running');
  // Unsupported pages wait without discarding existing frame documents.
  const retained = await panel.locator('.pageurl').allTextContents();
  await panel.evaluate(() => { window.retainedFrames = [...document.querySelectorAll('.screen iframe')]; window.sourceTrace.push({ type: 'baseline', at: performance.now() }); });
  await second.goto('about:blank'); await panel.waitForFunction(() => document.querySelector('#source-notice').textContent.includes('служебная'));
  assert.deepEqual(await panel.locator('.pageurl').allTextContents(), retained);
  assert(await panel.evaluate(() => window.retainedFrames.every((frame, index) => frame === document.querySelectorAll('.screen iframe')[index])), JSON.stringify(await panel.evaluate(() => window.sourceTrace), null, 2));
  // A new host needs a deliberate grant; waiting must retain the last usable screens.
  const ungranted = 'http://localhost:' + server.address().port + '/needs-access';
  await second.goto(ungranted);
  await panel.locator('#source-permission').waitFor({ state: 'visible' });
  assert.equal(await panel.locator('#source-notice').getAttribute('data-state'), 'needs-access');
  assert.equal(await panel.locator('#source-notice-title').textContent(), 'Нужен доступ к сайту');
  assert(await panel.locator('#source-notice-title').isVisible());
  assert((await panel.locator('#source-notice-text').textContent()).includes('пока не показан'));
  assert((await panel.locator('#source-notice').textContent()).includes('localhost'));
  assert.deepEqual(await panel.locator('.pageurl').allTextContents(), retained);
  assert(await panel.evaluate(() => window.retainedFrames.every((frame, index) => frame === document.querySelectorAll('.screen iframe')[index])), JSON.stringify(await panel.evaluate(() => window.sourceTrace), null, 2));
  assert.equal(await panel.locator('#sync-feedback').isVisible(), false);
  assert.equal(await panel.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] })), false);
  await panel.screenshot({ path: 'dist/source-permission.png' });
  await panel.setViewportSize({ width: 390, height: 1000 });
  assert(await panel.locator('#source-permission').isVisible());
  assert(await panel.locator('#source-notice').evaluate(el => el.scrollWidth <= el.clientWidth));
  await panel.screenshot({ path: 'dist/source-permission-narrow.png' });
  await panel.setViewportSize({ width: 1600, height: 1100 });
  await second.goto(site + '/returned'); await shown('/returned');
  await second.close(); await worker.evaluate(id => chrome.tabs.update(id, { active: true }), original.id); await shown('/route');
  // A stale query ID must not prevent resolving the current normal window source.
  await panel.goto('chrome-extension://' + id + '/panel.html?url=' + encodeURIComponent(site + '/first') + '&source=2147483647');
  await shown('/route');
  const preferences = await panel.evaluate(async () => (await chrome.storage.local.get('preferences')).preferences);
  assert(!('sourceTabId' in preferences)); assert(!('sourceWindowId' in preferences));
  // Restored panels in the same normal window must recover a website without trusting stale IDs.
  const restoredOpened = context.waitForEvent('page');
  await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), {
   windowId: original.windowId,
   url: 'chrome-extension://' + id + '/panel.html?source=2147483647&url=' + encodeURIComponent(site + '/first'),
  });
  const restored = await restoredOpened;
  await restored.waitForFunction(() => [...document.querySelectorAll('.pageurl')].every(el => el.textContent.endsWith('/route')) && [...document.querySelectorAll('.device-status')].every(el => el.textContent === 'Подключён'));
  await restored.close();
  // Keep one owner of the source before continuing the cancellation scenarios.
  await panel.reload(); await shown('/route');
  async function delayPermission() {
   await panel.evaluate(() => {
    window.originalPermissionRequest = chrome.permissions.request;
    window.permissionPending = false;
    chrome.permissions.request = () => new Promise(resolve => { window.permissionPending = true; window.releasePermission = resolve; });
   });
   await panel.locator('#start').click();
   await panel.waitForFunction(() => window.permissionPending);
  }
  async function releasePermission() {
   await panel.evaluate(() => { chrome.permissions.request = window.originalPermissionRequest; window.releasePermission(true); });
   await panel.waitForFunction(() => !document.querySelector('#start').disabled);
  }
  // A late optional-access result must not restart a session explicitly stopped meanwhile.
  await delayPermission();
  await panel.locator('#stop').click();
  assert.equal(await panel.locator('#start').getAttribute('aria-pressed'), 'false');
  assert.equal(await panel.locator('#stop').getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.locator('#session-state').textContent(), 'Остановлено');
  assert.equal(await panel.locator('#status').getAttribute('data-state'), 'stopped');
  assert.equal(await panel.locator('#status').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(168, 102, 107)');
  assert.equal(await panel.locator('#start').evaluate(el => el.classList.contains('primary')), false);
  await panel.waitForFunction(() => document.querySelector('#stop').disabled);
  await releasePermission();
  assert.equal(await panel.locator('.screen iframe[src]').count(), 0);
  assert((await panel.locator('.device-status').allTextContents()).every(value => value === 'Остановлен'));
  let sessionState = await panel.evaluate(() => chrome.storage.session.get(['panels', 'sourceWatches']));
  assert.equal(Object.keys(sessionState.panels || {}).length, 0);
  assert.equal(Object.keys(sessionState.sourceWatches || {}).length, 0);
  assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
  // Switching Main off during that same wait reconnects independently, without stale source state.
  await panel.locator('#start').click(); await shown('/route');
  await delayPermission();
  await panel.locator('#follow-source').uncheck();
  await releasePermission();
  await panel.waitForFunction(async () => {
   const { panels = {}, sourceWatches = {} } = await chrome.storage.session.get(['panels', 'sourceWatches']);
   const sessions = Object.values(panels);
   return sessions.length === 1 && !sessions[0].sourceTabId && Object.keys(sourceWatches).length === 0;
  });
  await shown('/route');
  sessionState = await panel.evaluate(() => chrome.storage.session.get(['panels', 'sourceWatches']));
  const sessions = Object.values(sessionState.panels || {});
  assert.equal(sessions.length, 1); assert(!sessions[0].sourceTabId);
  assert.equal(Object.keys(sessionState.sourceWatches || {}).length, 0);
  await source.locator('#field').fill('основная отключена');
  await panel.waitForTimeout(350);
  assert((await Promise.all(panel.frames().filter(frame => frame.url().startsWith(site)).map(frame => frame.locator('#field').inputValue()))).every(value => value === ''));
  // Closing the entire working window waits; a different Chrome window must not take over.
  await panel.locator('#follow-source').check();
  await panel.waitForFunction(url => document.querySelector('#source-status').dataset.url === url, site + '/route');
  await shown('/route');
  await panel.evaluate(() => { window.beforeWindowClose = [...document.querySelectorAll('.screen iframe')]; });
  const replacementOpened = context.waitForEvent('page');
  await worker.evaluate(async url => chrome.windows.create({ type: 'normal', url }), site + '/must-not-follow');
  const replacement = await replacementOpened; await replacement.waitForLoadState();
  await worker.evaluate(windowId => chrome.windows.remove(windowId), original.windowId);
  await panel.waitForFunction(() => document.querySelector('#source-notice').textContent.includes('Нет подходящей основной вкладки'));
  assert(await panel.evaluate(() => window.beforeWindowClose.every((frame, index) => frame === document.querySelectorAll('.screen iframe')[index])));
  assert((await panel.locator('.pageurl').allTextContents()).every(url => url.endsWith('/route')));
  await replacement.close();
  assert.deepEqual(errors, []);
  console.log('PASS source tab/window selection; Main routes with Sync off; no action replay; manual Show + embedding reconfiguration; source-open window focus; unsupported/no-access waiting retains frames; close fallback; stale ID recovery; Stop and Main-off during pending permission');
 } finally {
  await context?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
