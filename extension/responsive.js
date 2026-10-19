export const RESPONSIVE_DEVICE = Object.freeze({
 id: 'responsive', name: 'Отзывчивое устройство', width: 390, height: 844,
 platform: 'responsive', diagonalInches: null,
});

const MIN_SIZE = 240;
const MAX_SIZE = 3840;

export function normalizeResponsiveScale(value) {
 return typeof value === 'number' && Number.isFinite(value) && value >= .01 && value <= 2 ? value : null;
}

export function normalizeResponsiveSize(value) {
 const side = (input, fallback) => typeof input === 'number' && Number.isFinite(input)
  ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(input))) : fallback;
 return {
  width: side(value?.width, RESPONSIVE_DEVICE.width),
  height: side(value?.height, RESPONSIVE_DEVICE.height),
 };
}

export function attachResponsiveControls(card, onChange) {
 card.responsiveSize = normalizeResponsiveSize(card.responsiveSize);
 card.responsiveScale = normalizeResponsiveScale(card.responsiveScale);
 card.onResponsiveChange = onChange;
 attachResizeHandles(card, onChange);
 updateResponsiveControls(card);
}

export function renderResponsiveDimensions(card, { width, height, scale }) {
 if (!card.responsiveFields || (!card.responsiveFields.width.button.isConnected && !card.responsiveFields.width.editor?.isConnected)) {
  card.dim.replaceChildren();
  const fields = {};
  for (const kind of ['width', 'height', 'scale']) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = `dimension-value dimension-${kind}`;
   const label = { width: 'Ширина', height: 'Высота', scale: 'Масштаб отображения' }[kind];
   button.setAttribute('aria-label', label);
   button.title = kind === 'scale' ? 'Масштаб от 1 до 200%. 100% — CSS 1:1. Пустое значение — масштаб панели.' : `${label}: от 240 до 3840 CSS px`;
   fields[kind] = { button, editor: null, value: 0 };
   button.addEventListener('click', () => editDimension(card, fields[kind], kind));
   if (kind === 'height') card.dim.append(' × ');
   if (kind === 'scale') card.dim.append(' CSS px · ');
   card.dim.append(button);
  }
  card.responsiveFields = fields;
 }
 for (const [kind, value] of Object.entries({ width, height, scale: Math.round(scale * 10000) / 100 })) {
  const field = card.responsiveFields[kind];
  field.value = value;
  field.button.textContent = kind === 'scale' ? `${value}%` : String(value);
 }
}

function editDimension(card, field, kind) {
 if (field.editor || card.select.value !== RESPONSIVE_DEVICE.id) return;
 const input = document.createElement('input');
 input.type = 'text';
 input.inputMode = kind === 'scale' ? 'decimal' : 'numeric';
 input.className = `dimension-editor dimension-${kind}`;
 input.setAttribute('aria-label', field.button.getAttribute('aria-label'));
 input.title = field.button.title;
 input.value = String(field.value);
 input.style.width = `${Math.max(4, input.value.length + 1)}ch`;
 field.editor = input;
 field.button.replaceWith(input);
 input.focus({ preventScroll: true });
 input.select();
 function finish(save, refocus = false) {
  if (field.editor !== input) return;
  const text = input.value.trim().replace(',', '.').replace(/%$/, '').trim();
  const value = Number(text);
  const valid = kind === 'scale'
   ? text === '' || (/^\d+(?:\.\d+)?$/.test(text) && value >= 1 && value <= 200)
   : /^\d+$/.test(text) && value >= MIN_SIZE && value <= MAX_SIZE;
  if (save && !valid && refocus) {
   input.setCustomValidity(kind === 'scale' ? 'Укажите масштаб от 1 до 200%.' : 'Укажите размер от 240 до 3840 CSS px.');
   input.reportValidity();
   return;
  }
  field.editor = null;
  const connected = input.isConnected && card.select.value === RESPONSIVE_DEVICE.id;
  if (input.isConnected) input.replaceWith(field.button);
  if (connected && save && valid) {
   if (kind === 'scale') card.responsiveScale = text === '' ? null : value / 100;
   else {
    // Пользователь меняет видимую сторону; храним размер в канонической ориентации.
    const side = card.landscape ? (kind === 'width' ? 'height' : 'width') : kind;
    card.responsiveSize = { ...card.responsiveSize, [side]: value };
   }
   card.onResponsiveChange(card, { save: true });
  }
  if (connected && refocus) field.button.focus({ preventScroll: true });
 }
 input.addEventListener('input', () => input.setCustomValidity(''));
 input.addEventListener('keydown', event => {
  if (!['Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  finish(event.key === 'Enter', true);
 });
 input.addEventListener('blur', () => finish(true));
}

function attachResizeHandles(card, onChange) {
 const shell = card.article.querySelector('.shell');
 let gesture;
 const effectiveSize = () => {
  const { width, height } = normalizeResponsiveSize(card.responsiveSize);
  return card.landscape ? { width: height, height: width } : { width, height };
 };
 function applySize(width, height) {
  const next = normalizeResponsiveSize({ width, height });
  card.responsiveSize = card.landscape ? { width: next.height, height: next.width } : next;
 }
 function finish() {
  if (!gesture) return;
  const completed = gesture;
  gesture = null;
  completed.shield.remove();
  window.removeEventListener('blur', finish);
  window.removeEventListener('pointermove', moved, true);
  window.removeEventListener('keydown', escape, true);
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) window.removeEventListener(kind, ended, true);
  try { if (completed.handle.hasPointerCapture(completed.id)) completed.handle.releasePointerCapture(completed.id); } catch {}
  completed.handle.classList.remove('resizing');
  if (completed.changed) onChange(card, { save: true });
 }
 function ended(event) { if (gesture?.id === event.pointerId) finish(); }
 function escape(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  finish();
 }
 function moved(event) {
  if (!gesture || gesture.id !== event.pointerId) return;
  if (!card.article.isConnected || card.select.value !== RESPONSIVE_DEVICE.id) { finish(); return; }
  const { width, height, x, y, scale, axis } = gesture;
  const nextWidth = axis === 'height' ? width : width + (event.clientX - x) / scale;
  const nextHeight = axis === 'width' ? height : height + (event.clientY - y) / scale;
  applySize(nextWidth, nextHeight);
  gesture.changed = true;
  onChange(card, { save: false });
 }
 for (const [axis, label] of [['width', 'Изменить ширину'], ['height', 'Изменить высоту'], ['both', 'Изменить ширину и высоту']]) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = `responsive-resize responsive-resize-${axis}`;
  handle.setAttribute('aria-label', label);
  handle.title = `${label}: потяните мышью или используйте стрелки клавиатуры; Shift — шаг 10 CSS px`;
  shell.append(handle);
  handle.addEventListener('pointerdown', event => {
   if (card.select.value !== RESPONSIVE_DEVICE.id || event.button !== 0 || gesture) return;
   card.dim.querySelector('.dimension-editor')?.blur();
   const size = effectiveSize();
   const scale = card.screen.getBoundingClientRect().width / size.width;
   if (!Number.isFinite(scale) || scale <= 0) return;
   event.preventDefault();
   handle.focus({ preventScroll: true });
   // Пока меняется рамка, iframe не должен перехватывать поток указателя.
   const shield = document.createElement('div');
   shield.className = `responsive-resize-shield responsive-resize-shield-${axis}`;
   shield.setAttribute('aria-hidden', 'true');
   document.body.append(shield);
   gesture = { ...size, handle, axis, scale, shield, id: event.pointerId, x: event.clientX, y: event.clientY, changed: false };
   try { handle.setPointerCapture(event.pointerId); } catch { finish(); return; }
   handle.classList.add('resizing');
   window.addEventListener('blur', finish);
   window.addEventListener('pointermove', moved, true);
   window.addEventListener('keydown', escape, true);
   for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(kind, ended, true);
  });
  handle.addEventListener('keydown', event => {
   if (card.select.value !== RESPONSIVE_DEVICE.id || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
   const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
   if ((axis === 'width' && !horizontal) || (axis === 'height' && horizontal)) return;
   event.preventDefault();
   const step = (event.shiftKey ? 10 : 1) * (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
   const { width, height } = effectiveSize();
   applySize(width + (horizontal ? step : 0), height + (horizontal ? 0 : step));
   onChange(card, { save: true });
  });
 }
}

export function updateResponsiveControls(card) {
 const hidden = card.select.value !== RESPONSIVE_DEVICE.id;
 const { width, height } = normalizeResponsiveSize(card.responsiveSize);
 const w = card.landscape ? height : width, h = card.landscape ? width : height;
 for (const [axis, label] of [['width', `ширину. Сейчас ${w} CSS px`], ['height', `высоту. Сейчас ${h} CSS px`], ['both', `ширину и высоту. Сейчас ${w} × ${h} CSS px`]]) {
  const handle = card.article.querySelector(`.responsive-resize-${axis}`);
  handle.disabled = hidden;
  handle.setAttribute('aria-label', `Изменить ${label}`);
 }
}
