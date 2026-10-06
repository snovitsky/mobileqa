import { DEVICES, normalizeURL } from './devices.js';
const sourceTabId=Number(new URLSearchParams(location.search).get('source'))||null;
const $=id=>document.getElementById(id);
const following=()=>!!sourceTabId&&$('follow-source').checked;let cards=[],token='',running=false,busy=false,leader=null;
let diagnostics=[],sequence=0,preparedOrigin='',lastAction=0,addressDirty=false;
function trace(type,c,data={}){if(data.kind==='scroll'&&diagnostics.at(-1)?.type===type&&diagnostics.at(-1)?.device===c?.select.value&&diagnostics.at(-1)?.kind==='scroll'){diagnostics.pop();}diagnostics.push({time:new Date().toISOString(),type,device:c?.select.value,url:c?.pageurl.textContent,...data});if(diagnostics.length>200)diagnostics.shift();}
function updateAddress(c,url){if(following()||addressDirty||document.activeElement===$('url')||(leader&&leader!==c))return;addressDirty=false;$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+(sourceTabId?'&source='+sourceTabId:''));}
$('url').addEventListener('input',()=>{addressDirty=true;});
const defaults=['iphone11','redminote13','galaxya12','ipad11','pixel7'];
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function send(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw new Error(r?.error||'Расширение недоступно. Обновите панель.');return r.data;}
function dimensions(c){const d=DEVICES.find(d=>d.id===c.select.value);return {w:c.landscape?d.height:d.width,h:c.landscape?d.width:d.height,d};}
function resize(){
 const dims=cards.map(dimensions);let scale=Number($('scale').value);
 if(!scale){const available=$('devices').clientWidth-24*(cards.length-1)-18*cards.length;scale=Math.max(.1,available/dims.reduce((n,d)=>n+d.w,0));}
 cards.forEach((c,i)=>{const {w,h}=dims[i];c.frame.style.width=w+'px';c.frame.style.height=h+'px';c.frame.style.transform=`scale(${scale})`;c.screen.style.width=Math.round(w*scale)+'px';c.screen.style.height=Math.round(h*scale)+'px';c.article.style.width=Math.round(w*scale)+18+'px';c.dim.textContent=`${w} × ${h} CSS px`;});
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
 c.pending=[];
 url=normalizeURL(url);clearTimeout(c.timeout);c.ready=false;c.view=null;c.divergence=0;c.state.textContent='Загрузка';c.placeholder.textContent='Загружаем страницу…';c.placeholder.hidden=false;
 // Set the remote source before inserting: no privileged about:blank with script+origin flags.
 const frame=document.createElement('iframe');frame.title=c.frame.title;frame.src=url;
 frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText=c.frame.style.cssText;
 frame.addEventListener('load',()=>{if(c.frame!==frame)return;loading(c);post(c,'ping');});
 c.frame.replaceWith(frame);c.frame=frame;c.pageurl.textContent=url;
 c.timeout=setTimeout(()=>{if(!c.ready){
  c.placeholder.textContent='Сайт не подключился. Если он запрещает встроенный просмотр, включите «Разрешить встраивание» и нажмите «Показать». Для другого домена разрешите доступ отдельно.';
  c.placeholder.hidden=false;c.placeholder.classList.add('unlinked');c.state.textContent='Нет подключения';
  status('Не все экраны подключились. Проверьте режим встраивания и доступ к сайту.',true);
 }},10000);
}
function build(){
 leader=null;
 const previous=cards.map(c=>c.select.value);cards.forEach(c=>clearTimeout(c.timeout));cards=[];$('devices').replaceChildren();
 for(let i=0;i<Number($('count').value);i++){
  const article=document.createElement('article');article.className='device';article.innerHTML=`<div class="deviceheading"><select aria-label="Телефон ${i+1}"></select><span class="rank">0${i+1}</span></div><div class="dimensions"></div><div class="shell"><div class="screen"><iframe title="Сайт на телефоне ${i+1}" sandbox="" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="placeholder"><strong>▥</strong>Здесь появится сайт</div></div></div><p class="pageurl">Сайт ещё не открыт</p><div class="controls"><button data-action="back">Назад</button><button data-action="reload">Обновить</button><button data-action="rotate">Повернуть</button></div><p class="device-status" role="status">Ожидание</p>`;
  const select=article.querySelector('select');for(const d of DEVICES){const opt=document.createElement('option');opt.value=d.id;opt.textContent=d.name;select.append(opt);}select.value=previous[i]||defaults[i];
  const c={article,select,frame:article.querySelector('iframe'),screen:article.querySelector('.screen'),placeholder:article.querySelector('.placeholder'),dim:article.querySelector('.dimensions'),pageurl:article.querySelector('.pageurl'),state:article.querySelector('.device-status'),landscape:false,ready:false};cards.push(c);$('devices').append(article);
  select.addEventListener('change',()=>{resize();savePreferences();});
  article.querySelector('.controls').addEventListener('click',e=>{const action=e.target.dataset.action;if(action==='back'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(t=>{if(t.navigationHistory?.length>1){t.navigationHistory.pop();setURL(t,t.navigationHistory.at(-1));}});}else if(action==='rotate'){c.landscape=!c.landscape;resize();}else if(action==='reload'&&running){const targets=$('sync').checked?cards:[c];targets.forEach(target=>setURL(target,$('sync').checked?c.pageurl.textContent:target.pageurl.textContent));}});
 }
 resize();
}
window.addEventListener('message',e=>{
 if(!running||e.data?.app!=='mobile-qa-v2'||e.data.token!==token)return;
 const c=cards.find(c=>c.frame.contentWindow===e.source);if(!c)return;
 if(e.data.type==='view-state'){c.view=e.data.state;c.viewAt=Date.now();return;}
 if(e.data.type==='sync-ack'){trace('applied',c,{kind:e.data.kind,sequence:e.data.eventId});return;}
 if(e.data.type==='intent'){leader=c;lastAction=Date.now();}
 if(e.data.type==='loading'){loading(c);}
 if(e.data.type==='route'){c.pageurl.textContent=e.data.url;if($('sync').checked)updateAddress(c,e.data.url);}
 if(e.data.type==='ready'){c.navigationHistory??=[];if(c.navigationHistory.at(-1)!==e.data.url)c.navigationHistory.push(e.data.url);c.placeholder.classList.remove('unlinked');clearTimeout(c.timeout);c.ready=true;c.placeholder.hidden=true;c.pageurl.textContent=e.data.url;c.pageurl.title=e.data.url;if($('sync').checked)updateAddress(c,e.data.url);c.state.textContent='Подключён';trace('ready',c);const pending=c.pending||[];c.pending=[];pending.forEach(event=>relay(c,event));if(cards.every(c=>c.ready))status(following()?'Все экраны подключены. Работайте в основной вкладке — устройства повторят действия.':'Все экраны подключены. Управляйте любым телефоном — остальные повторят действия.');}
 if(e.data.type==='interaction'&&$('sync').checked&&!following()){const event=e.data.event;if(!['scroll','click','input','key'].includes(event?.kind))return;event.seq=++sequence;trace('interaction',c,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});if(event.kind!=='scroll'){lastAction=Date.now();c.intentional=false;}if(event.kind==='scroll'&&leader&&leader!==c)return;if(event.kind!=='scroll')leader=c;cards.filter(other=>other!==c).forEach(other=>relay(other,event));}
 if(e.data.type==='blocked'){c.intentional=true;trace('blocked',c,{message:e.data.message});c.state.textContent=e.data.message;status(e.data.message);return;}
 if(e.data.type==='missing'){trace(e.data.type,c,{message:e.data.message});c.state.textContent=e.data.message;status('Рассинхронизация: '+e.data.message,true);}
});
chrome.runtime.onMessage.addListener((msg,sender)=>{
 if(sender.id!==chrome.runtime.id||msg.type!=='desktop-source-event'||!running||msg.token!==token||!following())return;
 const data=msg.payload||{};
 if(msg.eventType==='closed'){running=false;$('follow-source').checked=false;status('Основная вкладка закрыта. Нажмите «Показать» для самостоятельной работы с панелью.',true);return;}
 if(msg.eventType==='domain-change'){status('Основная вкладка перешла на другой домен. Укажите её адрес и нажмите «Показать», чтобы разрешить доступ.',true);return;}
 if(['ready','route'].includes(msg.eventType)){
  let url;try{url=normalizeURL(data.url);}catch{return;}if(!addressDirty){$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+'&source='+sourceTabId);}
  leader=null;if($('sync').checked)cards.forEach(c=>{if(c.pageurl.textContent!==url)setURL(c,url);});$('source-status').textContent='Основная вкладка подключена';return;
 }
 if(msg.eventType==='loading'){$('source-status').textContent='Основная вкладка загружает страницу…';return;}
 if(msg.eventType==='blocked'){status(data.message);return;}
 if(msg.eventType==='interaction'&&$('sync').checked){const event=data.event;if(!['scroll','click','input','key'].includes(event?.kind))return;event.seq=++sequence;leader=null;lastAction=Date.now();trace('desktop-interaction',null,{kind:event.kind,selector:event.target?.selector,sequence:event.seq});cards.forEach(c=>relay(c,event));}
});
function sourceHint(){document.querySelector('.hint').textContent=following()?'Работайте в основной вкладке. Здесь отображаются четыре устройства; перенесите эту вкладку в отдельное окно на второй монитор.':'Прокручивайте и нажимайте в любом телефоне — остальные повторят действие. Синхронизацию можно отключить.';}
$('follow-source').checked=!!sourceTabId;sourceHint();$('source-controls').hidden=!sourceTabId;
$('follow-source').addEventListener('change',()=>{sourceHint();leader=null;if(following())send('resync-source').catch(e=>status(e.message,true));});
$('source-open').addEventListener('click',()=>{if(sourceTabId)chrome.tabs.update(sourceTabId,{active:true}).catch(e=>status(e.message,true));});
async function start(e){e?.preventDefault();if(busy)return;
 const manifest=chrome.runtime.getManifest();
 if(!manifest.optional_host_permissions?.length){status('Chrome использует старую версию расширения. Откройте chrome://extensions, нажмите круговую стрелку «Обновить» на карточке Mobile QA, затем закройте эту панель и откройте её заново.',true);return;}
 let url;try{url=normalizeURL($('url').value);}catch(err){status(err.message,true);return;}
 // Request optional access directly inside the user's click/submit gesture.
 const u=new URL(url),origin=u.protocol+'//'+u.hostname+'/*';
 busy=true;$('start').disabled=true;
 try{
  if(!await chrome.permissions.request({origins:[origin]}))throw new Error('Доступ к сайту не разрешён. Нажмите «Показать» и разрешите доступ.');
  running=false;leader=null;cards.forEach(c=>{c.pending=[];blank(c);});
  const result=await send('prepare',{url,compatibility:$('compatibility').checked,sourceTabId:following()?sourceTabId:null});token=result.token;running=true;preparedOrigin=new URL(url).origin;
  addressDirty=false;$('url').value=url;history.replaceState(null,'','?url='+encodeURIComponent(url)+(sourceTabId?'&source='+sourceTabId:''));
  cards.forEach(c=>setURL(c,following()?result.sourceURL||url:url));if(following())send('resync-source').catch(()=>{});$('stop').disabled=false;status('Загружаем '+cards.length+' экранов в одной вкладке…');
 }catch(err){status(err.message,true);}finally{busy=false;$('start').disabled=false;}
}
$('address').addEventListener('submit',start);
$('stop').addEventListener('click',async()=>{running=false;cards.forEach(c=>{blank(c);c.placeholder.textContent='Проверка остановлена';c.placeholder.hidden=false;c.ready=false;c.state.textContent='Остановлен';});try{await send('stop');status('Проверка остановлена.');}catch(e){status(e.message,true);}$('stop').disabled=true;});
$('count').addEventListener('change',()=>{build();if(running)cards.forEach(c=>setURL(c,$('url').value));});
$('sync').addEventListener('change',()=>{if(!$('sync').checked)cards.forEach(c=>c.pending=[]);leader=null;status($('sync').checked?'Синхронизация включена. Следующее действие повторится на остальных экранах.':'Синхронизация отключена. Экраны работают независимо.');});
$('compatibility').addEventListener('change',()=>{savePreferences();status('Нажмите «Показать», чтобы применить режим встраивания.');});
$('scale').addEventListener('change',resize);window.addEventListener('resize',resize);
function savePreferences(){chrome.storage.local.set({preferences:{count:$('count').value,compatibility:$('compatibility').checked,devices:cards.map(c=>c.select.value)}});}
$('align').addEventListener('click',()=>{if(!running)return;const source=leader?.ready?leader:cards.find(c=>c.ready);if(!source)return;cards.forEach(c=>setURL(c,source.pageurl.textContent));status('Открываем адрес выбранного экрана на всех устройствах.');trace('manual-align',source);});
$('export-debug').addEventListener('click',()=>{const report={version:chrome.runtime.getManifest().version,sync:$('sync').checked,devices:cards.map(c=>({model:c.select.value,url:c.pageurl.textContent,state:c.state.textContent})),events:diagnostics};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mobile-qa-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const {preferences}=await chrome.storage.local.get('preferences');
if(preferences){$('count').value=preferences.count||'4';$('compatibility').checked=!!preferences.compatibility;}
$('count').addEventListener('change',savePreferences);
$('url').value=new URLSearchParams(location.search).get('url')||'';build();if(preferences?.devices){cards.forEach((c,i)=>{if(DEVICES.some(d=>d.id===preferences.devices[i]))c.select.value=preferences.devices[i];});resize();}
// Auto-start only if this origin has already been approved, never pop up a permission prompt without a click.
if($('url').value){try{const u=new URL(normalizeURL($('url').value));chrome.permissions.contains({origins:[u.protocol+'//'+u.hostname+'/*']}).then(async granted=>{if(granted){busy=true;$('start').disabled=true;const result=await send('prepare',{url:u.href,compatibility:$('compatibility').checked,sourceTabId:following()?sourceTabId:null});token=result.token;running=true;preparedOrigin=u.origin;cards.forEach(c=>setURL(c,following()?result.sourceURL||u.href:u.href));if(following())send('resync-source').catch(()=>{});$('stop').disabled=false;busy=false;$('start').disabled=false;}}).catch(e=>{busy=false;$('start').disabled=false;status(e.message,true);});}catch{}}

setInterval(()=>{if(!running)return;cards.filter(c=>c.ready).forEach(c=>post(c,'snapshot'));const source=leader;if(!$('sync').checked||!source?.ready||!source.view||Date.now()-source.viewAt>2500||source.intentional||Date.now()-lastAction<1800)return;for(const c of cards){if(c===source||!c.ready||!c.view||Date.now()-c.viewAt>2500)continue;const differentURL=c.view.url.split('#')[0]!==source.view.url.split('#')[0];const differentModal=c.view.modal!==source.view.modal;c.divergence=differentURL||differentModal?(c.divergence||0)+1:0;if(c.divergence===2){trace('view-divergence',c,{source:source.select.value,differentURL,differentModal});if(differentURL&&new URL(source.view.url).origin===preparedOrigin){setURL(c,source.view.url);status('Выравниваем адрес отставшего экрана…');}else if(differentModal){c.state.textContent='Состояние окна отличается';status('Один экран показывает другое состояние окна. Диагностику можно сохранить.',true);}}}},1200);
window.addEventListener('pagehide',()=>{chrome.runtime.sendMessage({type:'stop'}).catch(()=>{});});

$('version').textContent=chrome.runtime.getManifest().version;
