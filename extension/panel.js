import { qrcodegen } from './qr.js';
import { DEVICES, normalizeURL } from './devices.js';
const sourceTabId=Number(new URLSearchParams(location.search).get('source'))||null;
const $=id=>document.getElementById(id);
const following=()=>!!sourceTabId&&$('follow-source').checked;let cards=[],token='',running=false,busy=false,leader=null;
let calibration=null,lastScale='auto',pendingPhysicalScale=null;
let auditing=false;
let desktopURL='';
let diagnostics=[],sequence=0,preparedOrigin='',lastAction=0,addressDirty=false;
function trace(type,c,data={}){if(data.kind==='scroll'&&diagnostics.at(-1)?.type===type&&diagnostics.at(-1)?.device===c?.select.value&&diagnostics.at(-1)?.kind==='scroll'){diagnostics.pop();}diagnostics.push({time:new Date().toISOString(),type,device:c?.select.value,url:c?.pageurl.textContent,...data});if(diagnostics.length>200)diagnostics.shift();}
function updateBrowserAddress(c,url){let name='Сайт';try{name=new URL(url).hostname;}catch{}c.article.querySelectorAll('.browser-site').forEach(el=>{el.textContent=name;el.title=url;});}
function updateAddress(c,url){if(addressDirty||document.activeElement===$('url')||(leader&&leader!==c))return;addressDirty=false;$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+(sourceTabId?'&source='+sourceTabId:''));}
$('url').addEventListener('input',()=>{addressDirty=true;});
const defaults=['iphone11','redminote13','galaxya12','ipad11','pixel7'];
function status(text,error=false){$('sync-feedback').hidden=!error;$('sync-feedback').textContent=error?text:'';$('status').textContent=text;$('status').title=text;$('status').classList.toggle('error',error);}
async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw new Error(r?.error||'Расширение недоступно. Обновите панель.');return r.data;}
function dimensions(c){const d=DEVICES.find(d=>d.id===c.select.value);return {w:c.landscape?d.height:d.width,h:c.landscape?d.width:d.height,d};}
function resize(){
 const physical=!['auto','css'].includes($('scale').value)&&!!calibration;const dims=cards.map(dimensions);cards.forEach((c,i)=>{c.article.dataset.model=dims[i].d.id;c.article.dataset.platform=dims[i].d.platform;});const edges=cards.map(c=>{const s=getComputedStyle(c.article.querySelector('.shell'));return parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth);});let scale=$('scale').value==='css'?1:Number($('scale').value);
 if(!scale){const available=$('devices').clientWidth-24*(cards.length-1)-edges.reduce((n,w)=>n+w,0);scale=Math.max(.1,available/dims.reduce((n,d)=>n+d.w,0));}
 cards.forEach((c,i)=>{const {w,h,d}=dims[i];const viewScale=physical?d.diagonalInches*25.4*calibration.pxPerMM*calibration.dpr/devicePixelRatio/Math.hypot(w,h)*scale:scale;c.article.classList.toggle('physical-size',physical);c.article.style.setProperty('--device-scale',viewScale);c.article.dataset.model=d.id;c.article.dataset.platform=d.platform;c.article.classList.toggle('landscape',c.landscape);const mode=$('browser-mode').value,iphone=d.platform==='iPhone',ipad=d.platform==='iPad',se=d.id==='iphonese';
 const bar=c.landscape?0:ipad?24:iphone?(se?20:d.id==='iphone11'?44:59):28;
 const top=mode==='expanded'?(ipad?56:iphone?0:56):0;
 const bottom=ipad?20:iphone?(mode==='expanded'?(c.landscape?44:se?94:118):(se?0:34)):(d.id==='galaxya12'?36:24);
 const viewportHeight=h-bar-top-bottom;c.article.dataset.browserMode=mode;
 c.article.style.setProperty('--browser-top-height',top+'px');c.article.style.setProperty('--browser-bottom-height',bottom+'px');
 c.article.style.setProperty('--status-height',bar+'px');c.article.querySelector('.display').style.width=w*viewScale+'px';c.article.querySelector('.display').style.height=h*viewScale+'px';c.frame.style.width=w+'px';c.frame.style.height=viewportHeight+'px';c.frame.style.transform=`scale(${viewScale})`;c.screen.style.width=w*viewScale+'px';c.screen.style.height=viewportHeight*viewScale+'px';c.article.style.width=w*viewScale+edges[i]+'px';c.dim.textContent=`${w} × ${viewportHeight} CSS px`+(physical?` · ${Math.round(w*d.diagonalInches*25.4/Math.hypot(w,h)*scale)/10} × ${Math.round(h*d.diagonalInches*25.4/Math.hypot(w,h)*scale)/10} см`:'');});
}
function post(c,type,extra={}){if(c.frame.contentWindow)c.frame.contentWindow.postMessage({app:'mobile-qa-v2',token,type,...extra},'*');}
function relay(c,event){
 if(!c.ready){c.pending??=[];if(event.kind==='scroll')c.pending=c.pending.filter(x=>x.kind!=='scroll'||x.target.selector!==event.target.selector);if(c.pending.length<80)c.pending.push(event);return;}
 post(c,'apply',{event});
}
function blank(c){
 clearTimeout(c.timeout);c.ready=false;c.view=null;c.divergence=0;
 const frame=document.createElement('iframe');frame.title=c.frame.title;frame.setAttribute('sandbox','');frame.style.cssText=c.frame.style.cssText;
 c.frame.replaceWith(frame);c.frame=frame;
}
function loading(c){
 clearTimeout(c.timeout);c.ready=false;c.view=null;c.divergence=0;c.state.textContent='Загрузка';
 c.timeout=setTimeout(()=>{if(!c.ready){c.placeholder.hidden=false;c.placeholder.textContent='Страница не подключилась. Проверьте доступ к домену и режим встраивания.';c.state.textContent='Нет подключения';status('Один из экранов не подключился.',true);}},12000);
}
function setURL(c,url){
 c.pending=[];c.article.querySelector('.http-warning').hidden=true;c.article.querySelector('.findings').hidden=true;
 url=normalizeURL(url);clearTimeout(c.timeout);c.ready=false;c.view=null;c.divergence=0;c.state.textContent='Загрузка';c.placeholder.textContent='Загружаем страницу…';c.placeholder.hidden=false;
 // Set the remote source before inserting: no privileged about:blank with script+origin flags.
 const frame=document.createElement('iframe');frame.title=c.frame.title;frame.src=url;
 frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText=c.frame.style.cssText;
 frame.addEventListener('load',()=>{if(c.frame!==frame)return;loading(c);post(c,'ping');});
 c.frame.replaceWith(frame);c.frame=frame;c.pageurl.textContent=url;updateBrowserAddress(c,url);
 c.timeout=setTimeout(()=>{if(!c.ready){
  c.placeholder.textContent='Сайт не подключился. Если он запрещает встроенный просмотр, включите «Разрешить встраивание» и нажмите «Показать». Для другого домена разрешите доступ отдельно.';
  c.placeholder.hidden=false;c.placeholder.classList.add('unlinked');c.state.textContent='Нет подключения';
  status('Не все экраны подключились. Проверьте режим встраивания и доступ к сайту.',true);
 }},10000);
}
function syncRoute(c,url){
 if(!$('sync').checked||leader!==c)return;
 cards.filter(other=>other!==c&&other.pageurl.textContent!==url).forEach(other=>setURL(other,url));
 if(following()&&desktopURL!==url){desktopURL=url;send('source-navigate',{url,token}).catch(e=>status(e.message,true));}
}
function build(){
 leader=null;
 const previous=cards.map(c=>c.select.value);cards.forEach(c=>clearTimeout(c.timeout));cards=[];$('devices').replaceChildren();
 for(let i=0;i<Number($('count').value);i++){
  const article=document.createElement('article');article.className='device';article.innerHTML=`<div class="deviceheading"><select aria-label="Телефон ${i+1}"></select><span class="rank">0${i+1}</span></div><div class="dimensions"></div><div class="shell"><div class="display"><div class="hardware-top" aria-hidden="true"><span class="hardware-clock">9:41</span><span class="hardware-signals">▮▮▮ ▰</span></div><div class="browser-top" aria-hidden="true"><div class="browser-address"><span class="browser-site">Сайт</span><span>⋮</span></div></div><div class="screen"><iframe title="Сайт на телефоне ${i+1}" sandbox="" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="placeholder"><strong>▥</strong>Здесь появится сайт</div></div><div class="browser-bottom" aria-hidden="true"><div class="browser-bottom-inner"><div class="browser-address"><span>ᴀA</span><span class="browser-site">Сайт</span><span>↻</span></div><div class="browser-navigation"><span>‹</span><span>›</span><span>↑</span><span>▤</span><span>▢</span></div><div class="home-indicator"></div><div class="android-navigation"><span>◁</span><span>○</span><span>□</span></div></div></div></div></div><p class="pageurl">Сайт ещё не открыт</p><div class="controls"><button data-action="back">Назад</button><button data-action="reload">Обновить</button><button data-action="rotate">Повернуть</button><button data-action="qr">QR</button></div><p class="device-status" role="status">Ожидание</p><p class="http-warning" role="alert" hidden></p><details class="findings" hidden><summary>Проверка вёрстки</summary><div></div></details>`;
  const select=article.querySelector('select');for(const d of DEVICES){const opt=document.createElement('option');opt.value=d.id;opt.textContent=d.name;select.append(opt);}select.value=previous[i]||defaults[i];
  const c={article,select,frame:article.querySelector('iframe'),screen:article.querySelector('.screen'),placeholder:article.querySelector('.placeholder'),dim:article.querySelector('.dimensions'),pageurl:article.querySelector('.pageurl'),state:article.querySelector('.device-status'),landscape:false,ready:false};cards.push(c);$('devices').append(article);
  select.addEventListener('change',()=>{resize();savePreferences();});
  article.querySelector('.controls').addEventListener('click',e=>{const action=e.target.dataset.action;if(action==='qr'){showQR(c.pageurl.textContent);return;}if(action==='back'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(t=>{if(t.navigationHistory?.length>1){t.navigationHistory.pop();setURL(t,t.navigationHistory.at(-1));}});}else if(action==='rotate'){c.landscape=!c.landscape;resize();}else if(action==='reload'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(target=>setURL(target,$('sync').checked?c.pageurl.textContent:target.pageurl.textContent));}});
 }
 resize();
}
window.addEventListener('message',e=>{
 if(!running||e.data?.app!=='mobile-qa-v2'||e.data.token!==token)return;
 const c=cards.find(c=>c.frame.contentWindow===e.source);if(!c)return;
 if(e.data.type==='http-status'){if(!$('check-404').checked||e.data.url!==c.pageurl.textContent)return;const el=c.article.querySelector('.http-warning');el.hidden=false;el.textContent=e.data.status===404?'HTTP 404 — страница не найдена':e.data.status?`HTTP ${e.data.status}`:'HTTP-статус недоступен';el.classList.toggle('not-found',e.data.status===404);return;}
 if(e.data.type==='page-findings'){if(e.data.url!==c.pageurl.textContent)return;const box=c.article.querySelector('.findings');box.hidden=false;const list=box.querySelector('div');list.replaceChildren();const results=Array.isArray(e.data.findings)?e.data.findings.slice(0,80):[];box.querySelector('summary').textContent=`Вёрстка: ${results.length} замечаний`;for(const item of results){const p=document.createElement('p');p.textContent=item.message;const code=document.createElement('code');code.textContent=item.selector||'';p.append(code);list.append(p);}if(!results.length)list.textContent='По заданным правилам проблем не найдено.';if(e.data.truncated)list.append(' Показана часть результатов.');return;}
 if(e.data.type==='view-state'){c.view=e.data.state;c.viewAt=Date.now();return;}
 if(e.data.type==='sync-ack'){trace('applied',c,{kind:e.data.kind,sequence:e.data.eventId});return;}
 if(e.data.type==='intent'){leader=c;lastAction=Date.now();}
 if(e.data.type==='loading'){loading(c);}
 if(e.data.type==='route'){c.pageurl.textContent=e.data.url;updateBrowserAddress(c,e.data.url);if($('check-404').checked)post(c,'http-status');if(auditing)post(c,'inspect-page');syncRoute(c,e.data.url);if($('sync').checked)updateAddress(c,e.data.url);}
 if(e.data.type==='ready'){syncRoute(c,e.data.url);c.navigationHistory??=[];if(c.navigationHistory.at(-1)!==e.data.url)c.navigationHistory.push(e.data.url);c.placeholder.classList.remove('unlinked');clearTimeout(c.timeout);c.ready=true;c.placeholder.hidden=true;c.pageurl.textContent=e.data.url;updateBrowserAddress(c,e.data.url);c.pageurl.title=e.data.url;if($('sync').checked)updateAddress(c,e.data.url);c.state.textContent='Подключён';if($('check-404').checked)post(c,'http-status');if(auditing)post(c,'inspect-page');trace('ready',c);const pending=c.pending||[];c.pending=[];pending.forEach(event=>relay(c,event));if(cards.every(c=>c.ready))status(following()?'Все экраны подключены. Управляйте любым экраном, включая основную вкладку.':'Все экраны подключены. Управляйте любым телефоном — остальные повторят действия.');}
 if(e.data.type==='interaction'&&$('sync').checked){const event=e.data.event;if(!['scroll','click','input','key'].includes(event?.kind))return;event.seq=++sequence;trace('interaction',c,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});if(event.kind!=='scroll'){lastAction=Date.now();c.intentional=false;}if(event.kind==='scroll'&&leader&&leader!==c)return;if(event.kind!=='scroll')leader=c;cards.filter(other=>other!==c).forEach(other=>relay(other,event));if(following())send('source-apply',{token,event}).catch(e=>status(e.message,true));}
 if(e.data.type==='blocked'){c.intentional=true;trace('blocked',c,{message:e.data.message});c.state.textContent=e.data.message;status(e.data.message);return;}
 if(e.data.type==='missing'){trace(e.data.type,c,{message:e.data.message});c.state.textContent='Не повторилось: '+e.data.message;status('Рассинхронизация: '+e.data.message,true);}
});
chrome.runtime.onMessage.addListener((msg,sender)=>{
 if(sender.id!==chrome.runtime.id||msg.type!=='desktop-source-event'||!running||msg.token!==token||!following())return;
 const data=msg.payload||{};
 if(msg.eventType==='intent'){leader=null;lastAction=Date.now();return;}
 if(msg.eventType==='missing'){status('Основная вкладка: '+data.message,true);return;}
 if(msg.eventType==='sync-ack')return;
 if(msg.eventType==='closed'){running=false;$('follow-source').checked=false;status('Основная вкладка закрыта. Нажмите «Показать» для самостоятельной работы с панелью.',true);return;}
 if(msg.eventType==='domain-change'){status('Основная вкладка перешла на другой домен. Укажите её адрес и нажмите «Показать», чтобы разрешить доступ.',true);return;}
 if(['ready','route'].includes(msg.eventType)){
  let url;try{url=normalizeURL(data.url);}catch{return;}desktopURL=url;if(!$('sync').checked||leader)return;if(!addressDirty){$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+'&source='+sourceTabId);}
  leader=null;if($('sync').checked)cards.forEach(c=>{if(c.pageurl.textContent!==url)setURL(c,url);});$('source-status').textContent='Основная вкладка подключена';return;
 }
 if(msg.eventType==='loading'){$('source-status').textContent='Основная вкладка загружает страницу…';return;}
 if(msg.eventType==='blocked'){status(data.message);return;}
 if(msg.eventType==='interaction'&&$('sync').checked){const event=data.event;if(!['scroll','click','input','key'].includes(event?.kind))return;if(event.kind==='scroll'&&leader)return;event.seq=++sequence;leader=null;lastAction=Date.now();trace('desktop-interaction',null,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});cards.forEach(c=>relay(c,event));}
});
function sourceHint(){document.querySelector('.hint').textContent=following()?'Управляйте любым устройством или основной вкладкой — остальные повторят действия.':'Прокручивайте и нажимайте в любом телефоне — остальные повторят действие. Синхронизацию можно отключить.';}
$('follow-source').checked=!!sourceTabId;sourceHint();$('source-controls').hidden=!sourceTabId;
$('follow-source').addEventListener('change',()=>{sourceHint();leader=null;if(running&&following())start();});
$('source-open').addEventListener('click',()=>{if(sourceTabId)chrome.tabs.update(sourceTabId,{active:true}).catch(e=>status(e.message,true));});
async function start(e){e?.preventDefault();if(busy)return;
 const manifest=chrome.runtime.getManifest();
 if(!manifest.optional_host_permissions?.length){status('Chrome использует старую версию расширения. Откройте chrome://extensions, нажмите круговую стрелку «Обновить» на карточке Brandmaker QA, затем закройте эту панель и откройте её заново.',true);return;}
 let url;try{url=normalizeURL($('url').value);}catch(err){status(err.message,true);return;}
 // Request optional access directly inside the user's click/submit gesture.
 const u=new URL(url),origin=u.protocol+'//'+u.hostname+'/*';
 busy=true;$('start').disabled=true;
 try{
  if(!await chrome.permissions.request({origins:[origin]}))throw new Error('Доступ к сайту не разрешён. Нажмите «Показать» и разрешите доступ.');
  running=false;leader=null;cards.forEach(c=>{c.pending=[];blank(c);});
  const result=await send('prepare',{url,compatibility:$('compatibility').checked,sync:$('sync').checked,sourceTabId:following()?sourceTabId:null});token=result.token;desktopURL=result.sourceURL||'';running=true;preparedOrigin=new URL(url).origin;
  addressDirty=false;$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+(sourceTabId?'&source='+sourceTabId:''));
  cards.forEach(c=>setURL(c,following()?result.sourceURL||url:url));if(following())send('resync-source').catch(()=>{});$('stop').disabled=false;status('Загружаем '+cards.length+' экранов в одной вкладке…');
 }catch(err){status(err.message,true);}finally{busy=false;$('start').disabled=false;}
}
$('address').addEventListener('submit',start);
$('stop').addEventListener('click',async()=>{running=false;cards.forEach(c=>{blank(c);c.placeholder.textContent='Проверка остановлена';c.placeholder.hidden=false;c.ready=false;c.state.textContent='Остановлен';});try{await send('stop');status('Проверка остановлена.');}catch(e){status(e.message,true);}$('stop').disabled=true;});
$('count').addEventListener('change',()=>{build();if(running)cards.forEach(c=>setURL(c,$('url').value));});
$('sync').addEventListener('change',()=>{if(!$('sync').checked)cards.forEach(c=>c.pending=[]);leader=null;if(running)send('set-sync',{enabled:$('sync').checked}).catch(e=>status(e.message,true));status($('sync').checked?'Синхронизация включена. Следующее действие повторится на остальных экранах.':'Синхронизация отключена. Экраны работают независимо.');});
$('compatibility').addEventListener('change',()=>{savePreferences();status('Нажмите «Показать», чтобы применить режим встраивания.');});
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
$('calibration-save').addEventListener('click',async()=>{const width=Number($('measurement-width').value);if(!Number.isFinite(width)||width<50||width>800){$('measurement-width').reportValidity();return;}const next={pxPerMM:width/measurementMM(),dpr:devicePixelRatio};try{await chrome.storage.local.set({displayCalibration:next});calibration=next;const selected=pendingPhysicalScale||'1';pendingPhysicalScale=null;$('scale').value=selected;lastScale=selected;$('calibration-dialog').close();resize();status('Монитор откалиброван. 100% — физический размер экрана.');}catch(err){status(err.message,true);}});
$('scale').addEventListener('change',()=>{if(!['auto','css'].includes($('scale').value)&&!calibration){pendingPhysicalScale=$('scale').value;openCalibration();return;}lastScale=$('scale').value;resize();});window.addEventListener('resize',resize);
function savePreferences(){chrome.storage.local.set({preferences:{count:$('count').value,compatibility:$('compatibility').checked,devices:cards.map(c=>c.select.value),check404:$('check-404').checked,browserMode:$('browser-mode').value}});}
$('align').addEventListener('click',()=>{if(!running)return;const source=leader?.ready?leader:cards.find(c=>c.ready);if(!source)return;cards.forEach(c=>setURL(c,source.pageurl.textContent));status('Открываем адрес выбранного экрана на всех устройствах.');trace('manual-align',source);});
$('export-debug').addEventListener('click',()=>{const report={version:chrome.runtime.getManifest().version,sync:$('sync').checked,devices:cards.map(c=>({model:c.select.value,url:c.pageurl.textContent,state:c.state.textContent})),events:diagnostics};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='brandmaker-qa-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const {preferences,displayCalibration}=await chrome.storage.local.get(['preferences','displayCalibration']);
if(displayCalibration&&Number.isFinite(displayCalibration.pxPerMM)&&displayCalibration.pxPerMM>=1&&displayCalibration.pxPerMM<=16&&Number.isFinite(displayCalibration.dpr)&&displayCalibration.dpr>0)calibration=displayCalibration;
if(preferences){$('count').value=preferences.count||'4';$('compatibility').checked=preferences.compatibility!==false;$('check-404').checked=!!preferences.check404;if(['expanded','collapsed'].includes(preferences.browserMode))$('browser-mode').value=preferences.browserMode;}
$('count').addEventListener('change',savePreferences);
$('url').value=new URLSearchParams(location.search).get('url')||'';build();if(preferences?.devices){cards.forEach((c,i)=>{if(DEVICES.some(d=>d.id===preferences.devices[i]))c.select.value=preferences.devices[i];});resize();}
// Auto-start only if this origin has already been approved, never pop up a permission prompt without a click.
if($('url').value){try{const u=new URL(normalizeURL($('url').value));chrome.permissions.contains({origins:[u.protocol+'//'+u.hostname+'/*']}).then(async granted=>{if(granted){busy=true;$('start').disabled=true;const result=await send('prepare',{url:u.href,compatibility:$('compatibility').checked,sync:$('sync').checked,sourceTabId:following()?sourceTabId:null});token=result.token;desktopURL=result.sourceURL||'';running=true;preparedOrigin=u.origin;cards.forEach(c=>setURL(c,following()?result.sourceURL||u.href:u.href));if(following())send('resync-source').catch(()=>{});$('stop').disabled=false;busy=false;$('start').disabled=false;}}).catch(e=>{busy=false;$('start').disabled=false;status(e.message,true);});}catch{}}

setInterval(()=>{if(!running)return;cards.filter(c=>c.ready).forEach(c=>post(c,'snapshot'));const source=leader;if(!$('sync').checked||!source?.ready||!source.view||Date.now()-source.viewAt>2500||source.intentional||Date.now()-lastAction<1800)return;for(const c of cards){if(c===source||!c.ready||!c.view||Date.now()-c.viewAt>2500)continue;const differentURL=c.view.url.split('#')[0]!==source.view.url.split('#')[0];const differentModal=c.view.modal!==source.view.modal;c.divergence=differentURL||differentModal?(c.divergence||0)+1:0;if(c.divergence===2){trace('view-divergence',c,{source:source.select.value,differentURL,differentModal});if(differentURL&&new URL(source.view.url).origin===preparedOrigin){setURL(c,source.view.url);status('Выравниваем адрес отставшего экрана…');}else if(differentModal){c.state.textContent='Состояние окна отличается';status('Один экран показывает другое состояние окна. Диагностику можно сохранить.',true);}}}},1200);
window.addEventListener('pagehide',()=>{chrome.runtime.sendMessage({type:'stop'}).catch(()=>{});});

$('version').textContent=chrome.runtime.getManifest().version;

const settingsMenu=document.querySelector('.settings-menu');
document.addEventListener('click',e=>{if(settingsMenu.open&&!settingsMenu.contains(e.target))settingsMenu.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calibration-dialog').open)settingsMenu.open=false;});

settingsMenu.addEventListener('toggle',()=>{if(!settingsMenu.open)return;const r=settingsMenu.querySelector('summary').getBoundingClientRect();const content=settingsMenu.querySelector('.settings-content');content.style.top=(r.bottom+8)+'px';content.style.right=Math.max(12,innerWidth-r.right)+'px';});
document.querySelector('.app-header').addEventListener('scroll',()=>{settingsMenu.open=false;});

function showQR(url){try{url=normalizeURL(url);const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM),canvas=$('qr-canvas'),ctx=canvas.getContext('2d'),scale=Math.max(1,Math.floor(300/(qr.size+8)));canvas.width=canvas.height=(qr.size+8)*scale;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);$('qr-url').textContent=url;$('qr-dialog').showModal();}catch{status('Не удалось создать QR. Откройте страницу или сократите адрес.',true);}}
$('qr-close').addEventListener('click',()=>$('qr-dialog').close());
$('check-404').addEventListener('change',()=>{savePreferences();cards.forEach(c=>{c.article.querySelector('.http-warning').hidden=true;if(c.ready&&$('check-404').checked)post(c,'http-status');});});
$('scan-page').addEventListener('click',()=>{if(!running){status('Сначала откройте сайт.',true);return;}auditing=true;cards.filter(c=>c.ready).forEach(c=>post(c,'inspect-page'));settingsMenu.open=false;status('Проверяем текущую вёрстку. Результаты под устройствами.');});
setInterval(()=>{cards.forEach(c=>{const active=running&&$('sync').checked&&leader===c;c.article.classList.toggle('controller',active);c.article.querySelector('.rank').textContent=active?'Управление':`0${cards.indexOf(c)+1}`;});$('source-controls').classList.toggle('controller',running&&$('sync').checked&&following()&&!leader);},150);

$('browser-mode').addEventListener('change',()=>{resize();savePreferences();status('Доступная высота страницы пересчитана. Панели браузера — приблизительный макет.');});
