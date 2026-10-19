import { userError, userMessage, httpStatusMessage } from './errors.js';
import { qrcodegen } from './qr.js';
import { DEVICES, normalizeURL } from './devices.js';
import { RESPONSIVE_DEVICE, normalizeResponsiveSize, normalizeResponsiveScale, renderResponsiveDimensions, attachResponsiveControls, updateResponsiveControls } from './responsive.js';
import { createErrorNotice } from './error-notice.js';
import { setupSiteAccess } from './access-settings.js';
import { renderInspectionReport } from './inspection-report.js';
const SCREEN_DEVICES = [...DEVICES, RESPONSIVE_DEVICE];
const requestedSourceId = Number(new URLSearchParams(location.search).get('source'));
let sourceTabId = Number.isSafeInteger(requestedSourceId) && requestedSourceId > 0 ? requestedSourceId : null;
const requestedWindowId = Number(new URLSearchParams(location.search).get('sourceWindow'));
let sourceWindowId = Number.isSafeInteger(requestedWindowId) && requestedWindowId > 0 ? requestedWindowId : null;
let panelTabId = null, sourceConnected = false, watchingSource = false, sourceRevision = 0, sessionSourceId = null;
let sourceCandidate = null, pendingCandidate = null, processingCandidate = false;
let pendingSourceEvents = [];
let processingSourceKey = '';
let sourceRecoveryTimer = null;
let operationRevision = 0, pendingStandalone = false, forceSourceRefresh = false;
let stoppedByUser = false;
let criticalIssue = false;
const $=id=>document.getElementById(id);
const errorNotice=createErrorNotice({container:$('error-notice'),text:$('sync-feedback'),meta:$('error-notice-meta'),dismiss:$('error-dismiss'),onDismiss:()=>status('Сообщение скрыто. При новом сбое оно появится снова.')});
const following=()=>$('follow-source').checked;let cards=[],token='',running=false,busy=false,leader=null;
let calibration=null,lastScale='auto',pendingPhysicalScale=null;
let auditing=false;
let desktopURL='';
let followSourcePreference = true;
let savedPreferences = {};
let settingsReadError = false;
let diagnostics=[],sequence=0,preparedOrigin='',lastAction=0,addressDirty=false;
function trace(type,c,data={}){if(data.kind==='scroll'&&diagnostics.at(-1)?.type===type&&diagnostics.at(-1)?.device===c?.select.value&&diagnostics.at(-1)?.kind==='scroll'){diagnostics.pop();}diagnostics.push({time:new Date().toISOString(),type,device:c?.select.value,url:c?.pageurl.textContent,...data});if(diagnostics.length>200)diagnostics.shift();}
function updateBrowserAddress(c,url){let name='Сайт';try{name=new URL(url).hostname;}catch{}c.article.querySelectorAll('.browser-site').forEach(el=>{el.textContent=name;el.title=url;});}
function updateAddress(c,url){if(addressDirty||document.activeElement===$('url')||(leader&&leader!==c))return;addressDirty=false;$('url').value=url;rememberAddress(url);}
$('url').addEventListener('input',()=>{addressDirty=true;});
const defaults=['iphone11','redminote13','galaxya12','ipad11','pixel7'];
function updateSessionControls(){
 const pending=!stoppedByUser&&(busy||processingCandidate);
 const active=running&&!stoppedByUser&&!pending&&(!following()||sourceConnected);
 const stopped=(!running||stoppedByUser)&&!pending;
 $('start').classList.toggle('primary',active);
 $('stop').classList.toggle('primary',stopped);
 $('start').setAttribute('aria-pressed',String(active));
 $('stop').setAttribute('aria-pressed',String(stopped));
 const label=stoppedByUser?'Остановлено':pending?'Подключение…':active?'Работает':watchingSource?'Ожидание вкладки':'Не запущено';
 $('session-state').textContent=label;$('session-state').dataset.state=pending?'loading':active?'running':'stopped';
 const connectedScreens=cards.filter(c=>c.ready).length;
 const failedScreens=cards.some(c=>c.connectionFailed);
 const screenState=connectedScreens===cards.length?'running':failedScreens?(connectedScreens?'partial':'disconnected'):'loading';
 const applicationState=stoppedByUser?'stopped':criticalIssue?'error':pending?'loading':active?screenState:watchingSource?'waiting':'idle';
 const applicationLabel={stopped:'Остановлено',error:'Расширение требует восстановления работы',loading:'Подключение',running:'Работает',partial:'Часть экранов не подключена',disconnected:'Экраны не подключены',waiting:'Ожидание основной вкладки',idle:'Не запущено'}[applicationState];
 $('status').dataset.state=applicationState;
 $('status').classList.toggle('error',applicationState==='error');
 $('status').title=applicationLabel+'. '+$('status').textContent;
 $('start').title=active?'Работает. Повторно открыть адрес на экранах':'Показать сайт на всех экранах';
 $('stop').title=active||pending?'Остановить сеанс и закрыть страницы во встроенных экранах':'Проверка остановлена';
}
function status(text,error=false,severity='error'){if(error){$('error-notice').dataset.severity=severity;$('sync-feedback').setAttribute('role',severity==='warning'?'status':'alert');errorNotice.show(text);}else errorNotice.clear();$('status').textContent=text;updateSessionControls();}
function missingMessage(name,data){
 const action={click:'нажатие',input:'изменение поля',scroll:'прокрутку',key:'нажатие клавиши'}[data.kind]||'действие';
 const reason={
  'element-missing':'Не удалось однозначно найти соответствующий элемент страницы. Выполните действие на этом экране вручную.',
  'different-page':'На этом экране открыта другая страница. Откройте одинаковый адрес или выберите «Настройки» → «Выровнять».',
  'apply-failed':'При повторении произошёл сбой. Проверьте результат и при необходимости выполните действие вручную.'
 }[data.reason]||data.message||'Проверьте результат и выполните действие вручную.';
 return name+' не удалось повторить '+action+'. '+reason;
}
function reportError(error, fallbackCode = 'operationFailed') {
 if(['extensionUnavailable','extensionVersionMismatch','settingsReadFailed'].includes(error?.code||fallbackCode))criticalIssue=true;
 status(userMessage(error, fallbackCode), true);
 trace('error', null, { code: error?.code || fallbackCode });
}
const siteAccess=setupSiteAccess({
 container:$('site-access'),
 onError:error=>reportError(error),
 onRevoked:async()=>{await checkCurrentAccess();status('Выбранное разрешение отозвано. Если другой доступ покрывает сайт, его экраны продолжат работу.');},
});
function invalidateAccessView(){
 operationRevision++;sourceRevision++;pendingCandidate=null;pendingStandalone=false;forceSourceRefresh=false;
 clearTimeout(sourceRecoveryTimer);
 running=false;sourceConnected=false;sessionSourceId=null;token='';leader=null;pendingSourceEvents=[];
 cards.forEach(c=>{blank(c);c.pending=[];c.placeholder.hidden=false;c.placeholder.textContent='Доступ к сайту отозван';c.state.textContent='Доступ отозван';});
 $('stop').disabled=true;
 status('Доступ к сайту отозван. Экраны и синхронизация отключены. Чтобы открыть сайт снова, нажмите ▶ и разрешите доступ.');
}
async function checkCurrentAccess(){
 if(!running||!preparedOrigin)return;
 const currentToken=token,currentOrigin=preparedOrigin,url=new URL(currentOrigin);
 const allowed=await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']});
 if(allowed||!running||token!==currentToken||preparedOrigin!==currentOrigin)return;
 // Старый worker тоже понимает stop; отзыв не зависит от наличия нового broadcast.
 invalidateAccessView();
 await send('stop');
 if(following()&&watchingSource)await refreshSource();
}
chrome.permissions.onRemoved.addListener(()=>{checkCurrentAccess().catch(error=>reportError(error,'stopFailed'));});
async function send(type, extra = {}) {
 let response;
 try { response = await chrome.runtime.sendMessage({ type, ...extra }); }
 catch { throw userError('extensionUnavailable'); }
 if (!response?.ok) {
  const fallback = type === 'prepare' ? 'startFailed' : type === 'stop' ? 'stopFailed' : 'syncFailed';
  throw userError(response?.code || (response?.error ? 'extensionVersionMismatch' : fallback));
 }
 return response.data;
}
window.addEventListener('unhandledrejection', event => {
 event.preventDefault();
 reportError(event.reason);
});

function dimensions(c){let d=SCREEN_DEVICES.find(d=>d.id===c.select.value);if(d.id==='responsive')d={...d,...normalizeResponsiveSize(c.responsiveSize)};return {w:c.landscape?d.height:d.width,h:c.landscape?d.width:d.height,d};}
function resize() {
 const physical = !['auto', 'css'].includes($('scale').value) && !!calibration;
 const sizes = cards.map(dimensions);
 cards.forEach((card, index) => {
  card.article.dataset.model = sizes[index].d.id;
  card.article.dataset.platform = sizes[index].d.platform;
 });
 const edges = cards.map(card => {
  const style = getComputedStyle(card.article.querySelector('.shell'));
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
   parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
 });
 const row = $('devices');
 const rowStyle = getComputedStyle(row);
 const padding = parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.paddingRight);
 let scale = $('scale').value === 'css' ? 1 : Number($('scale').value);
 if (!scale) {
  const gap = parseFloat(rowStyle.columnGap) || 0;
  const available = row.clientWidth - padding - gap * (cards.length - 1) - edges.reduce((sum, edge) => sum + edge, 0);
  const fixedWidth = sizes.reduce((sum, size, index) => sum + (size.d.id === 'responsive' && cards[index].responsiveScale !== null ? size.w * cards[index].responsiveScale : 0), 0);
  const autoWidth = sizes.reduce((sum, size, index) => sum + (size.d.id === 'responsive' && cards[index].responsiveScale !== null ? 0 : size.w), 0);
  scale = autoWidth ? Math.max(.01, (available - fixedWidth) / autoWidth) : 1;
 }
 cards.forEach((card, index) => {
  const { w, h, d } = sizes[index];
  const responsive = d.id === 'responsive', physicalDevice = physical && !responsive;
  updateResponsiveControls(card);
  const viewScale = physicalDevice
   ? d.diagonalInches * 25.4 * calibration.pxPerMM * calibration.dpr / devicePixelRatio / Math.hypot(w, h) * scale
   : responsive && card.responsiveScale !== null ? card.responsiveScale : responsive && physical ? 1 : scale;
  card.article.classList.toggle('physical-size', physicalDevice);
  card.article.style.setProperty('--device-scale', viewScale);
  card.article.classList.toggle('landscape', card.landscape);
  const mode = $('browser-mode').value;
  const iphone = d.platform === 'iPhone', ipad = d.platform === 'iPad', se = d.id === 'iphonese';
  const bar = responsive ? 0 : card.landscape ? 0 : ipad ? 24 : iphone ? (se ? 20 : d.id === 'iphone11' ? 44 : 59) : 28;
  const top = !responsive && mode === 'expanded' ? (ipad ? 56 : iphone ? 0 : 56) : 0;
  const bottom = responsive ? 0 : ipad ? 20 : iphone
   ? (mode === 'expanded' ? (card.landscape ? 44 : se ? 94 : 118) : (se ? 0 : 34))
   : (d.id === 'galaxya12' ? 36 : 24);
  const viewportHeight = h - bar - top - bottom;
  card.article.dataset.browserMode = mode;
  card.article.style.setProperty('--browser-top-height', top + 'px');
  card.article.style.setProperty('--browser-bottom-height', bottom + 'px');
  card.article.style.setProperty('--status-height', bar + 'px');
  card.article.querySelector('.display').style.width = w * viewScale + 'px';
  card.article.querySelector('.display').style.height = h * viewScale + 'px';
  card.frame.style.width = w + 'px';
  card.frame.style.height = viewportHeight + 'px';
  // Целочисленный zoom повышает плотность отрисовки, сохраняя точный CSS viewport.
  // Дробный zoom напрямую округляет viewport; обратный transform сохраняет геометрию калибровки.
  const rasterScale = $('scale').value === 'css' || viewScale === 1 || devicePixelRatio >= 2 ? 1 : 2;
  card.frame.style.zoom = String(rasterScale);
  card.frame.style.transform = `scale(${viewScale / rasterScale})`;
  card.screen.style.width = w * viewScale + 'px';
  card.screen.style.height = viewportHeight * viewScale + 'px';
  card.article.style.width = w * viewScale + edges[index] + 'px';
  if (responsive) renderResponsiveDimensions(card, { width: w, height: viewportHeight, scale: viewScale });
  else card.dim.textContent = `${w} × ${viewportHeight} CSS px` + (physicalDevice
   ? ` · ${Math.round(w * d.diagonalInches * 25.4 / Math.hypot(w, h) * scale) / 10} × ${Math.round(h * d.diagonalInches * 25.4 / Math.hypot(w, h) * scale) / 10} см` : '');
 });
}
// Появление вертикальной полосы окна тоже меняет доступную ширину ряда.
let observedWidth = 0;
new ResizeObserver(entries => {
 const width = entries[0].contentRect.width;
 if (Math.abs(width - observedWidth) < .1) return;
 observedWidth = width;
 if (cards.length) resize();
}).observe($('devices'));

function post(c,type,extra={}){if(c.frame.contentWindow)c.frame.contentWindow.postMessage({app:'mobile-qa-v2',token,type,...extra},'*');}
function relay(c,event){
 if(!c.ready){c.pending??=[];if(event.kind==='scroll')c.pending=c.pending.filter(x=>x.kind!=='scroll'||x.target.selector!==event.target.selector);if(c.pending.length<80)c.pending.push(event);return;}
 post(c,'apply',{event});
}
function relaySourceInteraction(event){
 if(!$('sync').checked||!['scroll','click','input','key'].includes(event?.kind))return;
 if(event.kind==='scroll'&&leader)return;
 event.seq=++sequence;leader=null;lastAction=Date.now();
 trace('desktop-interaction',null,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});
 cards.forEach(c=>relay(c,event));
}
function queueSourceInteraction(event){
 if(!$('sync').checked||!watchingSource||sourceCandidate?.state!=='loading'||sessionSourceId!==sourceTabId||!['scroll','click','input','key'].includes(event?.kind))return;
 try{if(new URL(normalizeURL(event.url)).origin!==preparedOrigin)return;}catch{return;}
 if(event.kind==='scroll')pendingSourceEvents=pendingSourceEvents.filter(item=>item.event.kind!=='scroll'||item.event.target?.selector!==event.target?.selector);
 if(pendingSourceEvents.length<80)pendingSourceEvents.push({token,sourceTabId:sessionSourceId,event});
 else status('Часть действий основной вкладки не успела повториться во время загрузки. Проверьте экраны и выполните недостающие действия вручную.',true,'warning');
}
function flushSourceInteractions(){
 const queued=pendingSourceEvents;pendingSourceEvents=[];
 if(!sourceConnected||!running||!watchingSource||!following()||!$('sync').checked)return;
 for(const item of queued){
  if(item.token===token&&item.sourceTabId===sessionSourceId&&item.event.url?.split('#')[0]===desktopURL.split('#')[0])relaySourceInteraction(item.event);
 }
}
function blank(c){
 clearTimeout(c.timeout);c.ready=false;c.view=null;c.divergence=0;
 const frame=document.createElement('iframe');frame.title=c.frame.title;frame.setAttribute('sandbox','');frame.style.cssText=c.frame.style.cssText;
 c.frame.replaceWith(frame);c.frame=frame;
}
function loading(c){
 clearTimeout(c.timeout);c.ready=false;c.connectionFailed=false;c.view=null;c.divergence=0;c.state.textContent='Загрузка';updateSessionControls();
 c.timeout=setTimeout(()=>{if(!c.ready){c.connectionFailed=true;c.placeholder.hidden=false;c.placeholder.textContent='Страница пока не подключилась. Дождитесь загрузки или нажмите «▶» ещё раз. Если сайт открывается в обычной вкладке, проверьте «Разрешить встраивание» в настройках.';c.state.textContent='Нет подключения';status('Один из экранов пока не подключился. Подождите или нажмите «▶» ещё раз; подробности указаны в самом экране.',true);}},12000);
}
function setURL(c,url){
 c.pending=[];c.article.querySelector('.http-warning').hidden=true;c.article.querySelector('.findings').hidden=true;
 url=normalizeURL(url);clearTimeout(c.timeout);c.ready=false;c.connectionFailed=false;c.view=null;c.divergence=0;c.state.textContent='Загрузка';c.placeholder.textContent='Загружаем страницу…';c.placeholder.hidden=false;updateSessionControls();
 // Set the remote source before inserting: no privileged about:blank with script+origin flags.
 const frame=document.createElement('iframe');frame.title=c.frame.title;frame.src=url;
 frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText=c.frame.style.cssText;
 frame.addEventListener('load',()=>{if(c.frame!==frame)return;loading(c);post(c,'ping');});
 c.frame.replaceWith(frame);c.frame=frame;c.pageurl.textContent=url;updateBrowserAddress(c,url);
 c.timeout=setTimeout(()=>{if(!c.ready){
  c.placeholder.textContent='Сайт не подключился. Если он запрещает встроенный просмотр, включите «Разрешить встраивание» и нажмите «▶». Для другого домена разрешите доступ отдельно.';
  c.connectionFailed=true;c.placeholder.hidden=false;c.placeholder.classList.add('unlinked');c.state.textContent='Нет подключения';
  status('Не все экраны подключились. Подождите загрузки; если она не завершится, проверьте сайт в обычной вкладке и повторите «▶».',true);
 }},10000);
}
function syncRoute(c,url){
 if(!$('sync').checked||leader!==c)return;
 cards.filter(other=>other!==c&&other.pageurl.textContent!==url).forEach(other=>setURL(other,url));
 if(following()&&sourceConnected&&desktopURL!==url){desktopURL=url;send('source-navigate',{url,token}).catch(e=>reportError(e,'syncFailed'));}
}
function build(){
 leader=null;
 const previous=cards.map(c=>c.select.value),landscapes=cards.map(c=>c.landscape),responsiveSizes=cards.map(c=>c.responsiveSize),responsiveScales=cards.map(c=>c.responsiveScale);cards.forEach(c=>clearTimeout(c.timeout));cards=[];$('devices').replaceChildren();
 for(let i=0;i<Number($('count').value);i++){
  const article=document.createElement('article');article.className='device';article.innerHTML=`<div class="deviceheading"><select aria-label="Модель экрана ${i+1}" title="Выбрать CSS-размеры устройства для этого экрана"></select><span class="rank">0${i+1}</span></div><div class="dimensions"></div><div class="shell"><div class="display"><div class="hardware-top" aria-hidden="true"><span class="hardware-clock">9:41</span><span class="hardware-signals">▮▮▮ ▰</span></div><div class="browser-top" aria-hidden="true"><div class="browser-address"><span class="browser-site">Сайт</span><span>⋮</span></div></div><div class="screen"><iframe title="Сайт на телефоне ${i+1}" sandbox="" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="placeholder"><strong>▥</strong>Здесь появится сайт</div></div><div class="browser-bottom" aria-hidden="true"><div class="browser-bottom-inner"><div class="browser-address"><span>ᴀA</span><span class="browser-site">Сайт</span><span>↻</span></div><div class="browser-navigation"><span>‹</span><span>›</span><span>↑</span><span>▤</span><span>▢</span></div><div class="home-indicator"></div><div class="android-navigation"><span>◁</span><span>○</span><span>□</span></div></div></div></div></div><p class="pageurl">Сайт ещё не открыт</p><div class="controls"><button type="button" title="Вернуться к предыдущему адресу; при синхронизации — на всех экранах" data-action="back">Назад</button><button type="button" title="Перезагрузить страницу; при синхронизации — на всех экранах" data-action="reload">Обновить</button><button type="button" title="Повернуть только этот экран" data-action="rotate">Повернуть</button><button type="button" title="Показать QR-код адреса для настоящего телефона, без передачи сессии" data-action="qr">QR</button></div><p class="device-status" role="status">Ожидание</p><p class="http-warning" role="alert" hidden></p><details class="findings" hidden><summary>Проверка вёрстки</summary><div></div></details>`;
  const select=article.querySelector('select');for(const d of SCREEN_DEVICES){const opt=document.createElement('option');opt.value=d.id;opt.textContent=d.name;select.append(opt);}select.value=previous[i]||defaults[i];
  const c={article,select,frame:article.querySelector('iframe'),screen:article.querySelector('.screen'),placeholder:article.querySelector('.placeholder'),dim:article.querySelector('.dimensions'),pageurl:article.querySelector('.pageurl'),state:article.querySelector('.device-status'),landscape:landscapes[i]===true,ready:false};cards.push(c);$('devices').append(article);
  select.addEventListener('change',()=>{resize();savePreferences();});
  c.responsiveSize=normalizeResponsiveSize(responsiveSizes[i]);c.responsiveScale=normalizeResponsiveScale(responsiveScales[i]);attachResponsiveControls(c,(_card,options={})=>{resize();if(options.save!==false)savePreferences();});
  c.screen.addEventListener('pointerleave',()=>post(c,'cancel-pointer'));
  article.querySelector('.controls').addEventListener('click',e=>{const action=e.target.dataset.action;if(action==='qr'){if(!c.ready){status('QR-код появится после подключения страницы. Укажите адрес, нажмите «▶» и дождитесь загрузки.',true);return;}showQR(c.pageurl.textContent);return;}if(action==='back'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(t=>{if(t.navigationHistory?.length>1){t.navigationHistory.pop();setURL(t,t.navigationHistory.at(-1));}});}else if(action==='rotate'){c.landscape=!c.landscape;resize();savePreferences();}else if(action==='reload'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(target=>setURL(target,$('sync').checked?c.pageurl.textContent:target.pageurl.textContent));}});
 }
 resize();
}
window.addEventListener('message',e=>{
 if(!running||e.data?.app!=='mobile-qa-v2'||e.data.token!==token)return;
 const c=cards.find(c=>c.frame.contentWindow===e.source);if(!c)return;
 if(e.data.type==='http-status'){if(!$('check-404').checked||e.data.url!==c.pageurl.textContent)return;const el=c.article.querySelector('.http-warning');el.hidden=false;el.textContent=httpStatusMessage(e.data.status);el.classList.toggle('not-found',e.data.status===404);return;}
 if(e.data.type==='page-findings'){if(e.data.url!==c.pageurl.textContent)return;renderInspectionReport(c,e.data,data=>post(c,'show-finding',data));return;}
 if(e.data.type==='finding-focused'){if(e.data.inspectionId!==c.inspection?.id)return;c.inspection.feedback.textContent=e.data.ok?'Элемент подсвечен на экране на 4 секунды.':'Элемент изменился или больше недоступен. Запустите поиск ошибок вёрстки заново.';return;}
 if(e.data.type==='view-state'){c.view=e.data.state;c.viewAt=Date.now();return;}
 if(e.data.type==='sync-ack'){trace('applied',c,{kind:e.data.kind,sequence:e.data.eventId});return;}
 if(e.data.type==='intent'){pendingSourceEvents=[];leader=c;lastAction=Date.now();}
 if(e.data.type==='loading'){loading(c);}
 if(e.data.type==='route'){c.navigationHistory??=[];if(c.navigationHistory.at(-1)!==e.data.url)c.navigationHistory.push(e.data.url);c.pageurl.textContent=e.data.url;updateBrowserAddress(c,e.data.url);if($('check-404').checked)post(c,'http-status');if(auditing)post(c,'inspect-page');syncRoute(c,e.data.url);if($('sync').checked)updateAddress(c,e.data.url);}
 if(e.data.type==='ready'){syncRoute(c,e.data.url);c.navigationHistory??=[];if(c.navigationHistory.at(-1)!==e.data.url)c.navigationHistory.push(e.data.url);c.placeholder.classList.remove('unlinked');clearTimeout(c.timeout);c.ready=true;c.connectionFailed=false;c.placeholder.hidden=true;c.pageurl.textContent=e.data.url;updateBrowserAddress(c,e.data.url);c.pageurl.title=e.data.url;if($('sync').checked)updateAddress(c,e.data.url);c.state.textContent='Подключён';if($('check-404').checked)post(c,'http-status');if(auditing)post(c,'inspect-page');trace('ready',c);const pending=c.pending||[];c.pending=[];pending.forEach(event=>relay(c,event));updateSessionControls();if(cards.every(c=>c.ready))status(following()?'Все экраны подключены. Управляйте любым экраном, включая основную вкладку.':'Все экраны подключены. Управляйте любым телефоном — остальные повторят действия.');}
 if(e.data.type==='interaction'&&$('sync').checked){const event=e.data.event;if(!['scroll','click','input','key'].includes(event?.kind))return;event.seq=++sequence;trace('interaction',c,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});if(event.kind!=='scroll'){lastAction=Date.now();c.intentional=false;}if(event.kind==='scroll'&&leader&&leader!==c)return;if(event.kind!=='scroll')leader=c;cards.filter(other=>other!==c).forEach(other=>relay(other,event));if(following()&&sourceConnected)send('source-apply',{token,event}).catch(e=>reportError(e,'syncFailed'));}
 if(e.data.type==='blocked'){c.intentional=true;trace('blocked',c,{message:e.data.message});c.state.textContent=e.data.message;status(e.data.message);return;}
 if(e.data.type==='missing'){trace(e.data.type,c,{reason:e.data.reason,kind:e.data.kind,sequence:e.data.eventId});c.state.textContent='Действие не повторилось';status(missingMessage('На экране «'+c.select.selectedOptions[0].textContent+'»',e.data),true,'warning');}
});
chrome.runtime.onMessage.addListener((msg,sender)=>{
 if(sender.id!==chrome.runtime.id||msg.panelTabId!==panelTabId)return;
 if(msg.type==='access-revoked'){
  siteAccess.refresh();
  if(!msg.sessionRevoked)return;
  invalidateAccessView();
  if(following()&&watchingSource)refreshSource().catch(error=>reportError(error,'sourceConnectFailed'));
  return;
 }
 if(msg.type==='source-candidate'){queueSource(msg);return;}
 if(msg.type!=='desktop-source-event'||!running||msg.token!==token||!following())return;
 if(['ready','route','loading'].includes(msg.eventType)) {
  if(msg.eventType==='loading')pendingSourceEvents=[];
  refreshSource().catch(error=>reportError(error,'sourceConnectFailed'));
  return;
 }
 const data=msg.payload||{};
 if(!sourceConnected){if(msg.eventType==='interaction')queueSourceInteraction(data.event);return;}
 if(msg.eventType==='intent'){leader=null;lastAction=Date.now();return;}
 if(msg.eventType==='missing'){status(missingMessage('В основной вкладке',data),true,'warning');return;}
 if(msg.eventType==='sync-ack')return;
 if(['closed','domain-change'].includes(msg.eventType)){refreshSource().catch(error=>reportError(error,'sourceConnectFailed'));return;}
 if(msg.eventType==='blocked'){status(data.message);return;}
 if(msg.eventType==='interaction')relaySourceInteraction(data.event);
});
function rememberAddress(url){
 const query=new URLSearchParams({url});
 if(sourceTabId)query.set('source',sourceTabId);
 if(sourceWindowId)query.set('sourceWindow',sourceWindowId);
 history.replaceState(null,'','?'+query);
}
function sourceHint(){document.querySelector('.hint').textContent=following()?'Экраны следуют адресу выбранной вкладки рабочего окна. Синхронизация отдельно включает повторение действий.':'Адрес экранов задаётся в панели. Синхронизация включает повторение действий между экранами.';}
function showSourceState(candidate){
 clearTimeout(sourceRecoveryTimer);
 const previousState=sourceCandidate?.state;
 sourceCandidate=candidate;
 const state=candidate.state;
 if(!['ready','loading'].includes(state)||(candidate.sourceTabId&&candidate.sourceTabId!==sessionSourceId))pendingSourceEvents=[];
 if(candidate.sourceWindowId)sourceWindowId=candidate.sourceWindowId;
 if(candidate.sourceTabId)sourceTabId=candidate.sourceTabId;
 const host=candidate.host||'';
 const messages={
  ready:host?'Основная вкладка: '+host:'Основная вкладка подключена',
  loading:'Основная вкладка загружает страницу. Текущие экраны сохранены.',
  'needs-access':'Сайт '+host+' пока не показан: расширению не разрешён доступ. Нажмите «Разрешить доступ». На экранах остаётся предыдущая страница.',
  'unknown-url':'Chrome не сообщил адрес вкладки. Откройте нужный сайт и нажмите значок расширения в его вкладке.',
  unsupported:'В рабочем окне выбрана служебная страница. Переключитесь на вкладку сайта — показ возобновится автоматически.',
  unavailable:'Нет подходящей основной вкладки. Откройте сайт в рабочем окне Chrome. Текущие экраны сохранены.'
 };
 const message=messages[state]||messages.unavailable;
 $('source-status').textContent=message;
 $('source-label').textContent=host;
 $('source-label').title=host?'Основная вкладка: '+host+' · окно '+sourceWindowId:message;
 $('source-notice-text').textContent=message;
 $('source-notice').dataset.state=state;
 $('source-notice-title').hidden=state!=='needs-access';
 $('source-notice').hidden=state==='ready'||!following();
 $('source-permission').hidden=state!=='needs-access';
 if(state!=='ready'){
  sourceConnected=false;leader=null;delete $('source-status').dataset.url;
  cards.forEach(c=>c.pending=[]);status(message);
 }else if(previousState&&previousState!=='ready')status('Основная вкладка подключена.');
 if(state==='loading'&&watchingSource&&!stoppedByUser){
  const revision=sourceRevision;
  // Восстанавливаемся и при пропущенном complete, и после запоздалого loading.
  sourceRecoveryTimer=setTimeout(()=>{
   if(revision===sourceRevision&&following()&&watchingSource)refreshSource().catch(error=>reportError(error,'sourceConnectFailed'));
  },1000);
 }
}
async function resolveSource(){
 const result=await send('resolve-source',{sourceTabId,sourceWindowId});
 if(result?.protocolVersion!==1)throw userError('extensionVersionMismatch');
 criticalIssue=false;
 return result;
}
async function refreshSource(){
 const revision=sourceRevision;
 const candidate=await resolveSource();
 if(revision===sourceRevision)queueSource(candidate);
}
function queueSource(candidate){
 if(!following()||!watchingSource)return;
 if(candidate.state!=='ready'||candidate.sourceTabId!==sessionSourceId||(candidate.sourceURL&&new URL(candidate.sourceURL).origin!==preparedOrigin))sourceConnected=false;
 const key=sourceKey(candidate);
 if(!candidate.forcePrepare&&!pendingCandidate&&processingSourceKey===key)return;
 if(pendingCandidate&&sourceKey(pendingCandidate)===key)candidate={...candidate,forcePrepare:!!(candidate.forcePrepare||pendingCandidate.forcePrepare)};
 sourceRevision++;
 pendingCandidate=candidate;
 drainSource().catch(error=>reportError(error,'sourceConnectFailed'));
}
function sourceKey(candidate){return JSON.stringify([candidate.state,candidate.sourceTabId,candidate.sourceWindowId,candidate.sourceURL]);}
async function connectScreens(url,candidate=null,revision=sourceRevision){
 const result=await send('prepare',{url,compatibility:$('compatibility').checked,sync:$('sync').checked,
  sourceTabId:candidate?.sourceTabId||null,sourceWindowId:candidate?.sourceWindowId||null});
 if(result?.protocolVersion!==1)throw userError('extensionVersionMismatch');
 if(revision!==sourceRevision||(candidate&&(!following()||!watchingSource))){sourceConnected=false;sessionSourceId=null;return;}
 pendingSourceEvents=[];token=result.token;desktopURL=result.sourceURL||'';running=true;stoppedByUser=false;criticalIssue=false;leader=null;
 preparedOrigin=new URL(url).origin;sourceConnected=!!candidate;sessionSourceId=candidate?.sourceTabId||null;
 if(candidate){sourceTabId=result.sourceTabId;sourceWindowId=result.sourceWindowId;}
 const actualURL=result.sourceURL||url;
 addressDirty=false;$('url').value=actualURL;rememberAddress(actualURL);
 cards.forEach(c=>setURL(c,actualURL));$('stop').disabled=false;
 if(candidate){showSourceState({...candidate,state:'ready'});$('source-status').dataset.url=actualURL;}
 else $('source-notice').hidden=true;
 status('Загружаем '+cards.length+' экранов…');
}
async function drainSource(){
 if(busy||processingCandidate)return;
 processingCandidate=true;
 updateSessionControls();
 try{
  while(pendingCandidate&&following()&&watchingSource){
   const candidate=pendingCandidate;pendingCandidate=null;
   processingSourceKey=sourceKey(candidate);
   const sameSource=running&&candidate.sourceTabId===sessionSourceId;
   showSourceState(candidate);
   if(candidate.forcePrepare)forceSourceRefresh=true;
   if(candidate.state!=='ready')continue;
   const forcePrepare=forceSourceRefresh;forceSourceRefresh=false;
   if(!forcePrepare&&sameSource&&running&&new URL(candidate.sourceURL).origin===preparedOrigin){
    sourceConnected=true;
    leader=null;
    desktopURL=candidate.sourceURL;
    if(!addressDirty){$('url').value=desktopURL;rememberAddress(desktopURL);}
    cards.forEach(c=>{if(c.pageurl.textContent!==desktopURL)setURL(c,desktopURL);});
    $('source-status').dataset.url=desktopURL;
    flushSourceInteractions();
    continue;
   }
   const revision=sourceRevision;
   try{await connectScreens(candidate.sourceURL,candidate,revision);}
   catch(error){sourceConnected=false;reportError(error,'sourceConnectFailed');}
   if(revision!==sourceRevision)sourceConnected=false;
  }
 }finally{processingCandidate=false;processingSourceKey='';updateSessionControls();if(pendingStandalone)resumeWork().catch(error=>reportError(error,'startFailed'));}
}
async function resumeWork(){
 if(busy||processingCandidate)return;
 if(pendingStandalone&&!following()){
  pendingStandalone=false;busy=true;
  try{
   const url=normalizeURL($('url').value),u=new URL(url);
   if(await chrome.permissions.contains({origins:[u.protocol+'//'+u.hostname+'/*']}))await connectScreens(url);
   else status('Нажмите «▶», чтобы разрешить доступ к сайту.');
  }finally{busy=false;}
 }
 await drainSource();
}
async function watchSource(){
 watchingSource=true;stoppedByUser=false;
 const candidate=await send('watch-source',{enabled:true,sourceTabId,sourceWindowId});
 queueSource(candidate);
}
async function unwatchSource(){
 pendingSourceEvents=[];
 clearTimeout(sourceRecoveryTimer);
 watchingSource=false;sourceRevision++;pendingCandidate=null;sourceConnected=false;
 delete $('source-status').dataset.url;
 await send('watch-source',{enabled:false});
}
$('source-controls').hidden=false;
$('follow-source').addEventListener('change',async()=>{
 const operation=++operationRevision;
 followSourcePreference=following();savePreferences();sourceHint();leader=null;
 try{
  if(following()){await watchSource();}
  else{
   pendingStandalone=running||busy||processingCandidate;
   await unwatchSource();if(operation!==operationRevision)return;
   $('source-notice').hidden=true;$('source-label').textContent='';
   await resumeWork();
  }
 }catch(error){reportError(error,'sourceConnectFailed');}
});
$('source-open').addEventListener('click',async()=>{
 try{
  const result=await send('source-open',{sourceTabId,sourceWindowId});
  if(following()){showSourceState(result);queueSource(result);}
  else if(['unavailable','unsupported'].includes(result.state))status('Выберите вкладку сайта в рабочем окне Chrome.');
 }catch(error){reportError(error,'sourceOpenFailed');}
});
$('source-permission').addEventListener('click',async()=>{
 if(!sourceCandidate?.sourceURL)return;
 const url=new URL(sourceCandidate.sourceURL);
 try{
  const granted=await chrome.permissions.request({origins:[url.protocol+'//'+url.hostname+'/*']});
  if(granted)await refreshSource();
  else status('Доступ не предоставлен. Для подключения сайта нажмите «Разрешить доступ». Текущие экраны сохранены.');
 }catch(error){reportError(error,'permissionRequestFailed');}
});
async function start(e){e?.preventDefault();if(busy)return;
 stoppedByUser=false;
 const operation=++operationRevision;
 let manifest;try{manifest=chrome.runtime.getManifest();}catch(error){reportError(error,'extensionUnavailable');return;}
 if(!manifest.optional_host_permissions?.length){status('Chrome использует старую версию расширения. Откройте chrome://extensions, нажмите круговую стрелку «Обновить» на карточке Brandmaker QA, затем закройте эту панель и откройте её заново.',true);return;}
 let url;try{url=normalizeURL($('url').value);}catch(err){reportError(err,'inputInvalid');return;}
 // Request optional access directly inside the user's click/submit gesture.
 const u=new URL(url),origin=u.protocol+'//'+u.hostname+'/*';
 busy=true;$('start').disabled=true;updateSessionControls();
 try{
  let granted;try{granted=await chrome.permissions.request({origins:[origin]});}catch{throw userError('permissionRequestFailed');}
  if(operation!==operationRevision)return;
  if(!granted){if(following()){status('Доступ к адресу не предоставлен. Текущие экраны сохранены; для запуска разрешите доступ при следующем нажатии ▶.');return;}throw userError('accessDenied');}
  if(following()){
   watchingSource=true;
   await send('watch-source',{enabled:true,sourceTabId,sourceWindowId});
   if(operation!==operationRevision)return;
   await send('navigate-source',{url,sourceTabId,sourceWindowId});
   if(operation!==operationRevision)return;
   const candidate=await resolveSource();
   if(operation!==operationRevision)return;
   queueSource({...candidate,forcePrepare:true});
  }else await connectScreens(url);
 }catch(err){if(operation===operationRevision)reportError(err,'startFailed');}finally{busy=false;$('start').disabled=false;updateSessionControls();resumeWork().catch(error=>reportError(error,'sourceConnectFailed'));}
}
$('address').noValidate = true;
$('address').addEventListener('submit',start);
$('stop').addEventListener('click',async()=>{operationRevision++;stoppedByUser=true;criticalIssue=false;pendingStandalone=false;forceSourceRefresh=false;running=false;updateSessionControls();cards.forEach(c=>{blank(c);c.placeholder.textContent='Проверка остановлена';c.placeholder.hidden=false;c.ready=false;c.state.textContent='Остановлен';});try{await unwatchSource();await send('stop');$('source-notice').hidden=true;status('Проверка остановлена.');}catch(e){reportError(e,'stopFailed');}$('stop').disabled=true;});
$('count').addEventListener('change',()=>{
 const urls=cards.map(c=>c.pageurl.textContent);
 const currentURL=leader?.pageurl.textContent||urls[0];
 build();
 if(running)cards.forEach((c,index)=>setURL(c,urls[index]||currentURL));
});
$('sync').addEventListener('change',()=>{savePreferences();if(!$('sync').checked){pendingSourceEvents=[];cards.forEach(c=>c.pending=[]);}leader=null;if(running)send('set-sync',{enabled:$('sync').checked}).catch(e=>reportError(e,'syncFailed'));sourceHint();status($('sync').checked?'Повторение действий включено.':following()?'Повторение действий выключено. Экраны продолжают следовать адресу основной вкладки.':'Повторение действий выключено. Экраны работают независимо.');});
$('compatibility').addEventListener('change',()=>{savePreferences();status('Нажмите «▶», чтобы применить режим встраивания.');});
function calibrationDevice(){return DEVICES.find(d=>d.id===$('calibration-model').value)||DEVICES[0];}
function measurementMM(){const d=calibrationDevice();return $('calibration-method').value==='phone'?d.diagonalInches*25.4*d.width/Math.hypot(d.width,d.height):50;}
function updateMeasurement(){const width=Number($('measurement-width').value),phone=$('calibration-method').value==='phone',d=calibrationDevice();$('measurement-line').hidden=phone;$('phone-outline').hidden=!phone;$('calibration-model-label').hidden=!phone;$('calibration-instructions').textContent=phone?'Выберите точную модель. Включите экран своего телефона, приложите рядом с контуром на мониторе и подгоните ширину и высоту светящейся области. Корпус и рамки не учитывайте.':'Приложите линейку к монитору и подгоните полоску точно под 5 см.';if(Number.isFinite(width)&&width>=50&&width<=800){$('measurement-line').style.width=width+'px';$('phone-outline').style.width=width+'px';$('phone-outline').style.height=width*d.height/d.width+'px';}}
let measurementUnit=50;
function changeMeasurement(){const density=Number($('measurement-width').value)/measurementUnit;measurementUnit=measurementMM();$('measurement-width').value=Math.max(50,Math.min(800,Math.round(density*measurementUnit*2)/2));updateMeasurement();}
function openCalibration(){settingsMenu.open=false;measurementUnit=measurementMM();const width=calibration?calibration.pxPerMM*measurementUnit*calibration.dpr/devicePixelRatio:measurementUnit*3.78;$('measurement-width').value=Math.max(50,Math.min(800,Math.round(width*2)/2));updateMeasurement();$('calibration-dialog').showModal();}
for(const d of DEVICES.filter(d=>d.platform!=='iPad')){const option=document.createElement('option');option.value=d.id;option.textContent=d.name;$('calibration-model').append(option);}
$('calibration-method').addEventListener('change',changeMeasurement);$('calibration-model').addEventListener('change',changeMeasurement);
$('measurement-width').addEventListener('input',updateMeasurement);
for(const [id,delta] of [['measure-minus',-0.5],['measure-plus',0.5]])$(id).addEventListener('click',()=>{$('measurement-width').value=Math.max(50,Math.min(800,Number($('measurement-width').value)+delta));updateMeasurement();});
$('calibrate').addEventListener('click',openCalibration);
$('calibration-cancel').addEventListener('click',()=>$('calibration-dialog').close());
$('calibration-dialog').addEventListener('close',()=>{if(pendingPhysicalScale){$('scale').value=lastScale;pendingPhysicalScale=null;resize();}});
$('calibration-save').addEventListener('click',async()=>{const width=Number($('measurement-width').value);if(!Number.isFinite(width)||width<50||width>800){status('Для калибровки укажите ширину от 50 до 800 CSS-пикселей.',true);$('measurement-width').reportValidity();return;}const next={pxPerMM:width/measurementMM(),dpr:devicePixelRatio};try{await chrome.storage.local.set({displayCalibration:next});calibration=next;const selected=pendingPhysicalScale||'1';pendingPhysicalScale=null;$('scale').value=selected;lastScale=selected;const saved=await savePreferences();$('calibration-dialog').close();resize();if(saved)status('Монитор откалиброван. 100% — физический размер экрана.');}catch(err){reportError(err,'calibrationSaveFailed');}});
$('scale').addEventListener('change',()=>{if(!['auto','css'].includes($('scale').value)&&!calibration){pendingPhysicalScale=$('scale').value;openCalibration();return;}lastScale=$('scale').value;resize();savePreferences();});window.addEventListener('resize',resize);
function savePreferences() {
 savedPreferences = {
  ...savedPreferences,
  count: $('count').value,
  scale: $('scale').value,
  sync: $('sync').checked,
  followSource: followSourcePreference,
  compatibility: $('compatibility').checked,
  devices: cards.map(card => card.select.value),
  landscapes: cards.map(card => card.landscape),
  responsiveSizes: cards.map(card => ({...card.responsiveSize})),
  responsiveScales: cards.map(card => card.responsiveScale),
  check404: $('check-404').checked,
  browserMode: $('browser-mode').value,
 };
 return chrome.storage.local.set({ preferences: savedPreferences })
  .then(() => true).catch(error => { reportError(error, 'settingsSaveFailed'); return false; });
}
$('align').addEventListener('click',()=>{if(!running){status('Сначала укажите адрес сайта и нажмите «▶».',true);return;}const source=leader?.ready?leader:cards.find(c=>c.ready);if(!source){status('Экраны ещё не подключились. Дождитесь загрузки и повторите выравнивание.',true);return;}cards.forEach(c=>setURL(c,source.pageurl.textContent));status('Открываем адрес выбранного экрана на всех устройствах.');trace('manual-align',source);});
$('export-debug').addEventListener('click',()=>{try{const report={version:chrome.runtime.getManifest().version,sync:$('sync').checked,devices:cards.map(c=>({model:c.select.value,url:c.pageurl.textContent,state:c.state.textContent})),events:diagnostics};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='brandmaker-qa-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){reportError(error,'diagnosticsSaveFailed');}});
let preferences, displayCalibration;
function showVersionState(){
 try{
  const loaded=chrome.runtime.getManifest().version;
  const source=$('version').dataset.sourceVersion||loaded;
  $('version').textContent=loaded;
  const different=loaded!==source;
  $('version').title=different?`В Chrome: ${loaded}. Файлы панели: ${source}. Рекомендуем обновить расширение.`:`Версия расширения, загруженная Chrome: ${loaded}`;
  $('update-notice').hidden=!different;
  if(different){
   const newer=source.localeCompare(loaded,undefined,{numeric:true})>0;
   $('update-notice-text').textContent=(newer?`Доступна версия ${source}. Сейчас загружена ${loaded}. `:`Chrome использует версию ${loaded}, файлы панели — ${source}. `)+'Можно продолжать работу. Рекомендуем обновить расширение: chrome://extensions → «Обновить» на карточке Brandmaker QA, затем открыть панель заново.';
  }
 }catch(error){reportError(error,'extensionUnavailable');}
}
showVersionState();
$('update-dismiss').addEventListener('click',()=>{$('update-notice').hidden=true;});
try { ({preferences, displayCalibration} = await chrome.storage.local.get(['preferences', 'displayCalibration'])); }
catch (error) { settingsReadError = true; reportError(error, 'settingsReadFailed'); }
if(displayCalibration&&Number.isFinite(displayCalibration.pxPerMM)&&displayCalibration.pxPerMM>=1&&displayCalibration.pxPerMM<=16&&Number.isFinite(displayCalibration.dpr)&&displayCalibration.dpr>0)calibration=displayCalibration;
if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
 savedPreferences = preferences;
 if (['3', '4', '5'].includes(String(preferences.count))) $('count').value = String(preferences.count);
 $('compatibility').checked = preferences.compatibility !== false;
 $('check-404').checked = !!preferences.check404;
 if (typeof preferences.sync === 'boolean') $('sync').checked = preferences.sync;
 if (typeof preferences.followSource === 'boolean') followSourcePreference = preferences.followSource;
 if (['expanded', 'collapsed'].includes(preferences.browserMode)) $('browser-mode').value = preferences.browserMode;
 const scales = ['auto', 'css', '0.5', '0.75', '1'];
 // Физический масштаб восстанавливается только с проверенной калибровкой, без нового диалога.
 if (scales.includes(preferences.scale) && (['auto', 'css'].includes(preferences.scale) || calibration)) {
  $('scale').value = preferences.scale;
 }
}
lastScale = $('scale').value;
$('follow-source').checked = followSourcePreference;
sourceHint();
$('count').addEventListener('change',savePreferences);
$('url').value=new URLSearchParams(location.search).get('url')||'';build();
if(Array.isArray(preferences?.devices))cards.forEach((c,i)=>{if(SCREEN_DEVICES.some(d=>d.id===preferences.devices[i]))c.select.value=preferences.devices[i];});
if(Array.isArray(preferences?.landscapes))cards.forEach((c,i)=>{c.landscape=preferences.landscapes[i]===true;});
if(Array.isArray(preferences?.responsiveSizes))cards.forEach((c,i)=>{c.responsiveSize=normalizeResponsiveSize(preferences.responsiveSizes[i]);});
if(Array.isArray(preferences?.responsiveScales))cards.forEach((c,i)=>{c.responsiveScale=normalizeResponsiveScale(preferences.responsiveScales[i]);});
resize();
// Restore the mode, then resolve the real source; stored tab IDs are only hints.
try { panelTabId = (await chrome.tabs.getCurrent())?.id || null; }
catch (error) { reportError(error, 'extensionUnavailable'); }
if(!settingsReadError){
 if(following()){
  try{await watchSource();}catch(error){reportError(error,'sourceConnectFailed');}
 }else if($('url').value){
  try{
   const url=normalizeURL($('url').value),u=new URL(url);
   if(await chrome.permissions.contains({origins:[u.protocol+'//'+u.hostname+'/*']})){
    busy=true;$('start').disabled=true;
    try{await connectScreens(url);}finally{busy=false;$('start').disabled=false;resumeWork().catch(error=>reportError(error,'startFailed'));}
   }else status('Нажмите «▶», чтобы разрешить доступ к сайту и открыть экраны.');
  }catch(error){reportError(error,'startFailed');}
 }
}

setInterval(()=>{if(!running)return;cards.filter(c=>c.ready).forEach(c=>post(c,'snapshot'));const source=leader;if(!$('sync').checked||!source?.ready||!source.view||Date.now()-source.viewAt>2500||source.intentional||Date.now()-lastAction<1800)return;for(const c of cards){if(c===source||!c.ready||!c.view||Date.now()-c.viewAt>2500)continue;const differentURL=c.view.url.split('#')[0]!==source.view.url.split('#')[0];const differentModal=c.view.modal!==source.view.modal;c.divergence=differentURL||differentModal?(c.divergence||0)+1:0;if(c.divergence===2){trace('view-divergence',c,{source:source.select.value,differentURL,differentModal});if(differentURL&&new URL(source.view.url).origin===preparedOrigin){setURL(c,source.view.url);status('Выравниваем адрес отставшего экрана…');}else if(differentModal){c.state.textContent='Состояние окна отличается';status('Один экран показывает другое состояние окна. Диагностику можно сохранить.',true);}}}},1200);
window.addEventListener('pagehide',()=>{chrome.runtime.sendMessage({type:'stop'}).catch(()=>{});});
window.addEventListener('blur',()=>{
 // Фокус внутри iframe тоже даёт blur окну панели; это не выход из приложения.
 setTimeout(()=>{if(!document.hasFocus())cards.forEach(c=>post(c,'cancel-pointer'));},0);
});

const settingsMenu=document.querySelector('.settings-menu');
document.addEventListener('click',e=>{if(settingsMenu.open&&!e.composedPath().includes(settingsMenu))settingsMenu.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calibration-dialog').open)settingsMenu.open=false;});

function positionSettings() {
 if (!settingsMenu.open) return;
 const content = settingsMenu.querySelector('.settings-content');
 const anchor = settingsMenu.getBoundingClientRect();
 content.style.right = '0px';
 const rect = content.getBoundingClientRect();
 if (rect.left < 12) content.style.right = (rect.left - 12) + 'px';
 content.style.maxHeight = Math.max(100, innerHeight - anchor.bottom - 20) + 'px';
}
settingsMenu.addEventListener('toggle', positionSettings);
window.addEventListener('resize', positionSettings);

// После отменённого ухода со страницы beforeunload не сопровождается новым load.
setInterval(()=>{
 if(running)cards.filter(c=>!c.ready&&c.frame.hasAttribute('src')).forEach(c=>post(c,'ping'));
},1000);
document.querySelector('.app-header').addEventListener('scroll',()=>{settingsMenu.open=false;});

function showQR(url){try{url=normalizeURL(url);const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM),canvas=$('qr-canvas'),ctx=canvas.getContext('2d'),scale=Math.max(1,Math.floor(300/(qr.size+8)));canvas.width=canvas.height=(qr.size+8)*scale;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);$('qr-url').textContent=url;$('qr-dialog').showModal();}catch(error){reportError(error,'qrFailed');}}
$('qr-close').addEventListener('click',()=>$('qr-dialog').close());
$('check-404').addEventListener('change',()=>{savePreferences();cards.forEach(c=>{c.article.querySelector('.http-warning').hidden=true;if(c.ready&&$('check-404').checked)post(c,'http-status');});});
$('scan-page').addEventListener('click',()=>{if(!running){status('Сначала укажите адрес сайта и нажмите «▶».',true);return;}auditing=true;cards.filter(c=>c.ready).forEach(c=>post(c,'inspect-page'));settingsMenu.open=false;status('Проверяем текущую вёрстку. Результаты под устройствами.');});
setInterval(()=>{cards.forEach(c=>{const active=running&&$('sync').checked&&leader===c;c.article.classList.toggle('controller',active);c.article.querySelector('.rank').textContent=active?'Управление':`0${cards.indexOf(c)+1}`;});$('source-controls').classList.toggle('controller',running&&$('sync').checked&&following()&&sourceConnected&&!leader);},150);

$('browser-mode').addEventListener('change',()=>{resize();savePreferences();status('Доступная высота страницы пересчитана. Панели браузера — приблизительный макет.');});
updateSessionControls();
