import { userError } from './errors.js';
import { displayAddress } from './url-display.js';

export function setupSiteAccess({ container, onError, onRevoked }) {
 const list = container.querySelector('.site-access-list');
 const state = container.querySelector('.site-access-state');
 const summary = container.querySelector('summary');
 const required = new Set(chrome.runtime.getManifest().host_permissions || []);
 const pending = new Set();
 let revision = 0, disposed = false;

 function report(code) { if (!disposed) onError?.(userError(code)); }
 async function revoke(origin, button) {
  if (disposed || pending.has(origin)) return;
  const restoreFocus = document.activeElement === button;
  pending.add(origin);
  button.disabled = true;
  try {
   // Выполняется непосредственно из click, без запроса новых разрешений.
   const removed = await chrome.permissions.remove({ origins: [origin] });
   if (!removed) { report('siteAccessRevokeFailed'); return; }
   await refresh();
   if (!disposed) {
    if (restoreFocus) summary.focus({ preventScroll: true });
    try { await onRevoked?.({ origins: [origin] }); }
    catch (error) { onError?.(error); }
   }
  } catch { report('siteAccessRevokeFailed'); }
  finally {
   pending.delete(origin);
   if (!disposed && button.isConnected) button.disabled = false;
  }
 }

 async function refresh() {
  if (disposed) return;
  const current = ++revision;
  container.setAttribute('aria-busy', 'true');
  try {
   const grants = await chrome.permissions.getAll();
   if (disposed || current !== revision) return;
   const origins = [...new Set((grants.origins || []).filter(origin =>
    typeof origin === 'string' && /^https?:\/\//.test(origin) && !required.has(origin)
   ))].sort();
   const rows = origins.map(origin => {
    const row = document.createElement('li');
    const address = document.createElement('span');
    address.className = 'site-access-origin';
    const readable = displayAddress(origin);
    address.textContent = readable;
    address.title = origin;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Отозвать';
    button.title = `Отозвать доступ к ${readable}. Для повторного показа понадобится снова разрешить доступ. Исходный адрес: ${origin}`;
    button.setAttribute('aria-label', `Отозвать доступ к ${readable}`);
    button.disabled = pending.has(origin);
    button.addEventListener('click', () => { void revoke(origin, button); });
    row.append(address, button);
    return row;
   });
   list.replaceChildren(...rows);
   state.textContent = origins.length ? '' : 'Нет сохранённых доступов к сайтам.';
   state.hidden = origins.length > 0;
  } catch {
   if (disposed || current !== revision) return;
   state.textContent = 'Не удалось загрузить список доступов.';
   state.hidden = false;
   report('siteAccessReadFailed');
  } finally {
   if (!disposed && current === revision) container.setAttribute('aria-busy', 'false');
  }
 }

 function changed() { void refresh(); }
 function toggled() { if (container.open) changed(); }
 chrome.permissions.onAdded.addListener(changed);
 chrome.permissions.onRemoved.addListener(changed);
 container.addEventListener('toggle', toggled);
 void refresh();
 return {
  refresh,
  dispose() {
   disposed = true;
   revision++;
   chrome.permissions.onAdded.removeListener(changed);
   chrome.permissions.onRemoved.removeListener(changed);
   container.removeEventListener('toggle', toggled);
  },
 };
}
