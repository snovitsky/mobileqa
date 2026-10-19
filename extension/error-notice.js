export function createErrorNotice({ container, text, meta, dismiss, onDismiss }) {
 let lastMessage = '';
 let occurrences = 0;
 const clock = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
 });
 function clear() {
  container.hidden = true;
  text.hidden = true;
  text.textContent = '';
  meta.textContent = '';
  lastMessage = '';
  occurrences = 0;
 }
 function show(message) {
  const value = String(message);
  occurrences = !container.hidden && lastMessage === value ? occurrences + 1 : 1;
  lastMessage = value;
  const now = new Date();
  text.textContent = value;
  const prefix = occurrences === 1 ? 'Появилось в' : 'Последнее появление в';
  meta.textContent = `${prefix} ${clock.format(now)} · Срабатываний: ${occurrences}`;
  if (meta.tagName === 'TIME') meta.dateTime = now.toISOString();
  text.hidden = false;
  container.hidden = false;
 }
 dismiss.addEventListener('click', () => {
  clear();
  onDismiss?.();
 });
 return { show, clear };
}
