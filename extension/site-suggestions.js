import { displayAddress } from './url-display.js';

function canonicalAddress(value) {
 try { return new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value).href; }
 catch { return value; }
}

export function setupSiteSuggestions(input, list) {
 input.removeAttribute('list');
 input.setAttribute('role', 'combobox');
 input.setAttribute('aria-autocomplete', 'list');
 input.setAttribute('aria-controls', list.id);
 input.setAttribute('aria-expanded', 'false');
 list.setAttribute('role', 'listbox');
 list.setAttribute('aria-label', 'Разрешённые сайты');
 list.className = 'site-suggestions';
 list.hidden = true;
 // Список вне прокручиваемой шапки, чтобы её overflow не обрезал подсказки.
 document.body.append(list);
 let revision = 0, addresses = [], matches = [], active = -1, dismissed = false;
 let pointerStart = null, dragged = false;
 function close() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
 }
 function position() {
  if (list.hidden) return;
  const rect = input.getBoundingClientRect();
  list.style.left = rect.left + 'px';
  list.style.top = rect.bottom + 4 + 'px';
  list.style.width = rect.width + 'px';
  list.style.maxHeight = Math.max(0, Math.min(280, window.innerHeight - rect.bottom - 12)) + 'px';
 }
 function choose(index) {
  const match = matches[index];
  if (!match) return;
  input.value = match.readable;
  dismissed = true;
  close();
  input.focus();
  input.select();
  input.dispatchEvent(new Event('input', {bubbles:true}));
  input.dispatchEvent(new Event('change', {bubbles:true}));
  dismissed = true;
  close();
 }
 function render() {
  const query = input.value.trim(), search = query.toLocaleLowerCase('ru');
  const exact = canonicalAddress(query);
  matches = addresses.filter(({ascii, readable}) => ascii !== exact &&
   (ascii.toLocaleLowerCase('ru').includes(search) || readable.toLocaleLowerCase('ru').includes(search)));
  active = -1;
  input.removeAttribute('aria-activedescendant');
  list.replaceChildren(...matches.map(({readable}, index) => {
   const option = document.createElement('div');
   option.id = list.id + '-' + index;
   option.setAttribute('role', 'option');
   option.setAttribute('aria-selected', 'false');
   option.textContent = readable;
   option.title = readable;
   option.addEventListener('pointerdown', event => event.preventDefault());
   option.addEventListener('click', () => choose(index));
   return option;
  }));
  if (dismissed || document.activeElement !== input || !matches.length) return close();
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  position();
 }
 async function refresh() {
  const current = ++revision;
  try {
   const permissions = await chrome.permissions.getAll();
   if (current !== revision) return;
   const unique = new Map();
   for (const pattern of permissions.origins || []) {
    // Общий wildcard не является адресом сайта; историю посещений не читаем.
    if (!/^https?:\/\/[^/*]+\/\*$/.test(pattern)) continue;
    let url; try { url = new URL(pattern.slice(0, -1)); } catch { continue; }
    if (url.username || url.password || url.hostname.includes('*')) continue;
    unique.set(url.href, {ascii:url.href, readable:displayAddress(url.href)});
   }
   addresses = [...unique.values()].sort((a,b) => a.readable.localeCompare(b.readable, 'ru'));
  } catch { if (current !== revision) return; addresses = []; }
  render();
 }
 input.addEventListener('focus', () => { dismissed = false; if (!pointerStart) input.select(); void refresh(); });
 input.addEventListener('pointerdown', event => { pointerStart = {x:event.clientX,y:event.clientY}; dragged = false; });
 input.addEventListener('pointermove', event => {
  if (pointerStart && event.buttons && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>3) dragged = true;
 });
 input.addEventListener('pointercancel', () => { pointerStart = null; dragged = false; });
 input.addEventListener('click', event => {
  if (pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>3) dragged = true;
  if (!dragged && event.detail <= 1 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) input.select();
  pointerStart = null;
  dismissed = false;
  render();
 });
 input.addEventListener('input', () => { dismissed = false; render(); });
 input.addEventListener('blur', close);
 input.addEventListener('keydown', event => {
  if (event.key === 'Escape') { dismissed = true; close(); return; }
  if (list.hidden) return;
  if (event.key === 'Tab' && !event.shiftKey) {
   event.preventDefault(); choose(0); return;
  }
  if (event.key === 'Enter' && active >= 0) {
   event.preventDefault(); choose(active); return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  active = active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
   : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
  [...list.children].forEach((option,index) => option.setAttribute('aria-selected', String(index === active)));
  input.setAttribute('aria-activedescendant', list.children[active].id);
  list.children[active].scrollIntoView({block:'nearest'});
 });
 window.addEventListener('resize', position);
 window.addEventListener('scroll', position, true);
 chrome.permissions.onAdded.addListener(refresh);
 chrome.permissions.onRemoved.addListener(refresh);
 void refresh();
 return {refresh};
}
