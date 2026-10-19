import { newerVersion } from './update-lifecycle.js';

export async function setupReleaseNotice(container, { updateButton, applyUpdate } = {}) {
 if (!container) return;
 const current = chrome.runtime.getManifest().version;
 const link = container.querySelector('a'), text = container.querySelector('span'), dismiss = container.querySelector('button');
 const apply = document.createElement('button');
 apply.type = 'button'; apply.textContent = 'Обновить'; apply.className = 'release-apply'; apply.hidden = true;
 container.append(apply);
 let pending = '', mode = '', applying = false, revision = 0;
 const localNotes = chrome.runtime.getURL('whats-new.html') + '#v' + current;
 async function refresh() {
  const ownRevision = ++revision;
  try {
   const data = await chrome.storage.local.get(['pendingExtensionUpdate', 'dismissedPendingUpdate', 'extensionUpdate', 'seenReleaseVersion']);
   if (ownRevision !== revision || applying) return;
   pending = newerVersion(data.pendingExtensionUpdate?.version, current) ? data.pendingExtensionUpdate.version : '';
   if (updateButton) {
    updateButton.hidden = !pending;
    updateButton.textContent = pending ? `Обновить до ${pending}` : 'Обновить расширение';
   }
   mode = pending ? 'pending' : 'installed';
   apply.hidden = !pending;
   if (pending) {
    text.textContent = `Доступна версия ${pending}.`;
    link.href = 'https://github.com/snovitsky/mobileqa/blob/main/releases/' + pending + '.md';
    dismiss.textContent = 'Позже'; dismiss.title = 'Напомнить об обновлении позже';
    dismiss.setAttribute('aria-label', 'Отложить обновление');
    container.hidden = data.dismissedPendingUpdate === pending;
   } else {
    text.textContent = `Brandmaker QA обновлён до ${current}.`;
    link.href = localNotes; dismiss.textContent = '×'; dismiss.title = 'Скрыть сообщение об обновлении';
    dismiss.setAttribute('aria-label', dismiss.title);
    container.hidden = data.extensionUpdate?.version !== current || data.seenReleaseVersion === current;
   }
  } catch { /* Необязательное уведомление не останавливает проверку сайта. */ }
 }
 dismiss.addEventListener('click', () => {
  container.hidden = true;
  chrome.storage.local.set(mode === 'pending' ? { dismissedPendingUpdate: pending } : { seenReleaseVersion: current }).catch(() => {});
 });
 link.addEventListener('click', () => {
  if (mode === 'installed') {
   container.hidden = true;
   chrome.storage.local.set({ seenReleaseVersion: current }).catch(() => {});
  }
 });
 async function update() {
  if (!pending || applying || !applyUpdate) return;
  if (!window.confirm('Завершить QA-сеанс и обновить Brandmaker QA? Все макеты будут закрыты. Настройки сохранятся, заполненные формы не сохраняются.')) return;
  applying = true; apply.disabled = true; if (updateButton) updateButton.disabled = true;
  try {
   text.textContent = 'Сохраняем настройки и завершаем QA-сеанс…'; container.hidden = false;
   await applyUpdate();
  } catch {
   text.textContent = 'Не удалось применить обновление. Сеанс мог быть остановлен. Повторите обновление или нажмите ▶, чтобы продолжить работу.';
   container.hidden = false;
  } finally {
   applying = false; apply.disabled = false; if (updateButton) updateButton.disabled = false;
  }
 }
 apply.addEventListener('click', update);
 updateButton?.addEventListener('click', update);
 chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void refresh(); });
 await refresh();
 return { refresh };
}
