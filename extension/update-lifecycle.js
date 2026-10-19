const versionParts = value => typeof value === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value) && value.split('.').every(part => Number(part) <= 65535) ? value.split('.').map(Number) : null;
export function newerVersion(candidate, current) {
 const a = versionParts(candidate), b = versionParts(current);
 if (!a || !b) return false;
 for (let i = 0; i < 4; i++) {
  const difference = (a[i] || 0) - (b[i] || 0);
  if (difference) return difference > 0;
 }
 return false;
}

// Chrome supplies the downloaded update. No polling, remote code, or new site grants.
export function setupUpdateLifecycle({ chrome, serial, ready, cleanupAll, panelURL }) {
 let applying = false;
 const validPanel = sender => {
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id)) return false;
  try { const url = new URL(sender.url); url.search = ''; url.hash = ''; return url.href === panelURL; } catch { return false; }
 };
 chrome.runtime.onUpdateAvailable.addListener(details => serial(async () => {
  if (!newerVersion(details?.version, chrome.runtime.getManifest().version)) return;
  await chrome.storage.local.set({ pendingExtensionUpdate: { version: details.version } });
 }).catch(() => {}));
 chrome.runtime.onInstalled.addListener(details => serial(async () => {
  const version = chrome.runtime.getManifest().version;
  if (details.reason !== 'update') return;
  if (details.previousVersion !== version) await chrome.storage.local.set({ extensionUpdate: { version, previousVersion: details.previousVersion || '' } });
  await chrome.storage.local.remove(['pendingExtensionUpdate', 'dismissedPendingUpdate']);
 }).catch(() => {}));
 return {
  get applying() { return applying; },
  async apply(sender) {
   if (!validPanel(sender) || applying) throw new Error('Update sender rejected');
   const { pendingExtensionUpdate } = await chrome.storage.local.get('pendingExtensionUpdate');
   if (!newerVersion(pendingExtensionUpdate?.version, chrome.runtime.getManifest().version)) throw new Error('No downloaded update');
   applying = true;
   let panels = [], reloading = false;
   try {
    await ready;
    panels = (await chrome.tabs.query({})).filter(tab => validPanel({ id: chrome.runtime.id, frameId: 0, tab, url: tab.url }));
    // Preferences are shared: the panel where the user chose Update is saved last.
    panels.sort((a, b) => Number(a.id === sender.tab.id) - Number(b.id === sender.tab.id));
    // Each message is addressed to one panel: only that panel acknowledges its save/stop.
    for (const panel of panels) {
     let timer;
     const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'extension-update-stop', panelTabId: panel.id }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Panel did not acknowledge update')), 10000); })
     ]).finally(() => clearTimeout(timer));
     if (response?.ok !== true || response.panelTabId !== panel.id) throw new Error('Panel save failed');
    }
    await cleanupAll();
    chrome.runtime.reload();
    reloading = true;
    return true;
   } catch (error) {
    for (const panel of panels) await chrome.runtime.sendMessage({ type: 'extension-update-failed', panelTabId: panel.id }).catch(() => {});
    throw error;
   } finally { if (!reloading) applying = false; }
  }
 };
}
