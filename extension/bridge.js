(()=>{
 if(window.parent===window)return;
 let token,parentOrigin,mutedUntil=0,scrollFrame=0,readySent=false;
 const prefix='mobile-qa-v2';
 const send=(type,payload={})=>{if(type==='interaction'&&payload.event)payload.event.url=location.href;window.parent.postMessage({app:prefix,type,token,...payload},parentOrigin);};
 function path(el){
  if(!el||el===document||el===document.documentElement||el===document.body)return ':root';
  if(el.id)return '#'+CSS.escape(el.id);
  const parts=[];for(let n=el;n&&n.nodeType===1&&n!==document.documentElement;n=n.parentElement){
   if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}
   let part=n.localName;const siblings=n.parentElement?[...n.parentElement.children].filter(x=>x.localName===n.localName):[];
   if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(n)+1)+')';parts.unshift(part);
  }return parts.join(' > ');
 }
 function imageKey(el){
  const img=el.matches('img')?el:el.querySelector('img');if(!img)return '';
  const picture=img.closest('picture');
  const sources=picture?[...picture.querySelectorAll('source')].map(s=>s.getAttribute('data-srcset')||s.getAttribute('srcset')).filter(Boolean):[];
  const raw=sources.length?sources.sort().join('|'):(img.getAttribute('data-src')||img.getAttribute('src')||img.currentSrc);
  return raw||'';
 }
 function describe(el){const control=el.closest('button,[role="button"]');return {control:control&&control!==el?describe(control):null,selector:path(el),tag:el.localName,id:el.id,name:el.getAttribute('name'),href:el.getAttribute('href'),label:el.getAttribute('aria-label'),text:el.textContent?.trim().slice(0,160),image:imageKey(el),anchor:el.closest('a[href]')?.getAttribute('href'),classes:[...el.classList].filter(x=>!/(active|selected|current|open)/i.test(x))};}
 function visible(el){return el&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';}
 function find(t){
  if(t.selector===':root')return document.scrollingElement;
  if(t.id){const e=document.getElementById(t.id);if(visible(e)&&e.localName===t.tag)return e;}
  if(t.control){const control=find(t.control);if(control)return control;}
  const pool=t.tag?[...document.getElementsByTagName(t.tag)].filter(visible):[];
  const compatible=e=>(!t.image||imageKey(e)===t.image)&&(!t.href||e.getAttribute('href')===t.href)&&(!t.name||e.getAttribute('name')===t.name)&&(!t.label||e.getAttribute('aria-label')===t.label)&&(!t.text||e.textContent?.trim().slice(0,160)===t.text);
  if(t.anchor&&!['#','javascript:void(0)','javascript:void(0);'].includes(t.anchor)){
   let anchored=pool.filter(e=>e.closest('a[href]')?.getAttribute('href')===t.anchor&&compatible(e));
   if(t.classes?.length){const matches=anchored.filter(e=>t.classes.every(x=>e.classList.contains(x)));if(matches.length)anchored=matches;}
   if(anchored.length===1)return anchored[0];
   if(anchored.length>1){const score=e=>{const r=e.getBoundingClientRect();const area=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));return area/Math.max(1,r.width*r.height)+(e.closest('.swiper-slide-active')?2:0);};anchored.sort((a,b)=>score(b)-score(a));return score(anchored[0])-score(anchored[1])>0.001?anchored[0]:null;}
   return null;
  }
  try{const e=document.querySelector(t.selector);if(visible(e)&&e.localName===t.tag&&compatible(e))return e;}catch{}
  const candidates=pool.filter(compatible);
  if(t.image||t.name||t.label||t.text||(t.href&&!['#','javascript:void(0)','javascript:void(0);'].includes(t.href))){if(candidates.length===1)return candidates[0];}
  if(t.classes?.length){const matches=candidates.filter(e=>t.classes.every(x=>e.classList.contains(x)));if(matches.length===1)return matches[0];}
  // An ambiguous link must not silently click an unrelated menu or footer element.
  return null;
 }
 function canSubmit(el){const control=el.closest('button,input');return !!control&&!!control.form&&((control.localName==='button'&&(!control.type||control.type==='submit'))||(control.localName==='input'&&['submit','image'].includes(control.type)));}
 const pointers=new Map(),cancelledPointers=new Set();let cancellingPointer=false,cancelledMouse=false;
 function cancelPointer(pointerId,nativeCancel=false){
  const gesture=pointers.get(pointerId);if(!gesture)return;
  pointers.delete(pointerId);cancelledPointers.add(pointerId);
  if(gesture.pointerType==='mouse')cancelledMouse=true;
  const target=gesture.captureTarget?.isConnected?gesture.captureTarget:gesture.target;
  try{if(gesture.captureTarget?.hasPointerCapture(pointerId))gesture.captureTarget.releasePointerCapture(pointerId);}catch{}
  const destination=target?.isConnected?target:document;
  const init={bubbles:true,composed:true,cancelable:true,view:window,pointerId,pointerType:gesture.pointerType,isPrimary:gesture.isPrimary,clientX:gesture.x,clientY:gesture.y,button:gesture.button,buttons:0};
  // Виджеты могут ждать pointerup вместо cancel: завершаем оба семейства событий.
  // Отменённый жест не должен порождать click/submit из обработчика завершения.
  cancellingPointer=true;
  try{
   if(!nativeCancel)destination.dispatchEvent(new PointerEvent('pointercancel',init));
   const up=new PointerEvent('pointerup',init);up.preventDefault();destination.dispatchEvent(up);
   const mouseUp=new MouseEvent('mouseup',init);mouseUp.preventDefault();destination.dispatchEvent(mouseUp);
  }finally{cancellingPointer=false;}
 }
 function cancelPointers(){for(const id of [...pointers.keys()])cancelPointer(id);}
 document.addEventListener('pointerdown',e=>{
  if(!e.isTrusted||!readySent)return;
  cancelledPointers.delete(e.pointerId);
  if(e.pointerType==='mouse')cancelledMouse=false;
  pointers.set(e.pointerId,{target:e.target,pointerType:e.pointerType,isPrimary:e.isPrimary,button:e.button,x:e.clientX,y:e.clientY});
 },true);
 document.addEventListener('gotpointercapture',e=>{const gesture=pointers.get(e.pointerId);if(e.isTrusted&&gesture)gesture.captureTarget=e.target;},true);
 document.addEventListener('pointermove',e=>{
  const gesture=pointers.get(e.pointerId);if(!e.isTrusted||!gesture)return;
  gesture.x=e.clientX;gesture.y=e.clientY;
  if((e.pointerType==='mouse'&&e.buttons===0)||e.clientX<0||e.clientY<0||e.clientX>=innerWidth||e.clientY>=innerHeight)cancelPointer(e.pointerId);
 },true);
 document.addEventListener('pointerout',e=>{if(e.isTrusted&&e.relatedTarget===null)cancelPointer(e.pointerId);},true);
 document.addEventListener('pointerup',e=>{if(e.isTrusted){pointers.delete(e.pointerId);if(cancelledPointers.has(e.pointerId)){e.preventDefault();e.stopImmediatePropagation();}}},true);
 document.addEventListener('mouseup',e=>{if(e.isTrusted&&cancelledMouse){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('pointercancel',e=>{if(e.isTrusted)cancelPointer(e.pointerId,true);},true);
 document.addEventListener('click',e=>{
  if(cancellingPointer||(e.isTrusted&&cancelledPointers.has(e.pointerId))){e.preventDefault();e.stopImmediatePropagation();}
 },true);
 window.addEventListener('blur',cancelPointers);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPointers();});
 for(const kind of ['pointerdown','wheel','keydown'])document.addEventListener(kind,e=>{if(e.isTrusted&&readySent){mutedUntil=0;send('intent');}}, {capture:true,passive:true});
 document.addEventListener('keydown',e=>{if(e.isTrusted&&readySent&&e.key==='Escape')send('interaction',{event:{kind:'key',key:'Escape'}});},true);
 document.addEventListener('click',e=>{
  if(!e.isTrusted||!readySent)return;
  const el=e.target;
  if(el.closest('a[href]')){const a=el.closest('a[href]');if(['_blank','_top','_parent'].includes(a.target)){e.preventDefault();a.target='_self';if(/^https?:$/.test(new URL(a.href).protocol))location.href=a.href;}}
  // Controls with side effects are not replayed on the other screens.
  if(canSubmit(el)){send('blocked',{message:'Кнопка отправки формы нажата только на управляющем экране. Её нажатие не повторяется на остальных экранах.'});return;}
  if(el.matches('input,textarea,select,[contenteditable]'))return;
  const a=el.closest('a');if(a&&/^(tel:|mailto:|sms:|javascript:)/i.test(a.getAttribute('href')||''))return;
  send('interaction',{event:{kind:'click',target:describe(el),url:location.href}});
 },true);
 function input(e){if(!e.isTrusted||!readySent)return;const el=e.target;if(!el.matches('input,textarea,select,[contenteditable="true"]'))return;if(['file','password'].includes(el.type))return;
  send('interaction',{event:{kind:'input',target:describe(el),value:el.isContentEditable?el.innerText:el.value,checked:el.checked,type:el.type}});
 }
 document.addEventListener('input',input,true);document.addEventListener('change',input,true);
 document.addEventListener('scroll',e=>{
  if(!readySent||Date.now()<mutedUntil)return;
  const el=e.target===document?document.scrollingElement:e.target;if(!el||!('scrollTop'in el))return;
  cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(()=>send('interaction',{event:{kind:'scroll',target:describe(el),x:el.scrollLeft/Math.max(1,el.scrollWidth-el.clientWidth),y:el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight)}}));
 },true);
 // Do not let Enter or requestSubmit from a replayed click create duplicate leads.
 let replaying=false;
 document.addEventListener('submit',e=>{if(cancellingPointer||replaying||Date.now()<mutedUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('message',e=>{
  if(e.source!==window.parent||e.origin!==parentOrigin||e.data?.app!==prefix||e.data.token!==token||!readySent)return;
  if(e.data.type==='cancel-pointer'){cancelPointers();return;}
  if(e.data.type==='inspect-page'){
   const findings=[];const add=(kind,el,message)=>{if(findings.length<80)findings.push({kind,selector:describe(el).selector,message});};
   const root=document.documentElement;
   if(root.scrollWidth>innerWidth+2)add('overflow',root,`Страница шире экрана на ${root.scrollWidth-innerWidth} CSS px. Проверьте, нужна ли горизонтальная прокрутка.`);
   let visited=0;for(const el of document.querySelectorAll('body *')){if(++visited>10000)break;const r=el.getBoundingClientRect(),style=getComputedStyle(el);if(!r.width||!r.height||style.visibility==='hidden'||style.display==='none'||el.closest('[aria-hidden="true"]'))continue;
    if(r.right>innerWidth+2&&r.left>=0&&style.position!=='fixed')add('overflow',el,'Элемент выходит за правый край экрана. Проверьте, доступно ли его содержимое.');
    if(el.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button]')&&(r.width<24||r.height<24))add('target',el,`Маленькая область нажатия: ${Math.round(r.width)} × ${Math.round(r.height)} CSS px, одна из сторон меньше 24. Проверьте, удобно ли нажимать пальцем.`);
    if([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(style.fontSize)<12)add('text',el,`Мелкий текст: ${style.fontSize}, меньше 12 px. Проверьте, удобно ли его читать.`);
   }
   send('page-findings',{url:location.href,findings,truncated:visited>10000||findings.length>=80});return;
  }
  if(e.data.type==='http-status'){const nav=performance.getEntriesByType('navigation')[0];send('http-status',{url:location.href,status:nav?.name===location.href.split('#')[0]?Number(nav.responseStatus)||0:0});return;}
  if(e.data.type==='snapshot'){send('view-state',{state:{url:location.href,modal:!!document.querySelector('.fancybox-is-open,.fancybox__container,.lg-visible,dialog[open]')}});return;}
  if(e.data.type==='ping'){send('ready',{url:location.href});return;}
  if(e.data.type!=='apply')return;const ev=e.data.event;if(!ev||!['scroll','click','input','key'].includes(ev.kind))return;
  if(ev.url&&ev.url.split('#')[0]!==location.href.split('#')[0]){send('missing',{eventId:ev.seq,kind:ev.kind,reason:'different-page',message:'Действие не повторено: на экранах открыты разные страницы. Выберите «Настройки» → «Выровнять» или откройте нужную страницу вручную.'});return;}
  if(ev.kind==='key'){if(ev.key==='Escape'){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));}return;}
  const el=find(ev.target||{});if(!el){send('missing',{eventId:ev.seq,kind:ev.kind,reason:'element-missing',message:'Действие не повторено: элемент не найден в этой версии страницы. Выполните действие на этом экране вручную.'});return;}
  mutedUntil=Date.now()+400;
  try{
   if(ev.kind==='scroll'){
    el.scrollTo({left:Math.max(0,Math.min(1,Number(ev.x)||0))*Math.max(0,el.scrollWidth-el.clientWidth),top:Math.max(0,Math.min(1,Number(ev.y)||0))*Math.max(0,el.scrollHeight-el.clientHeight),behavior:'instant'});
   }else if(ev.kind==='click'){
    if(canSubmit(el))return;
    const link=el.closest('a[href]');if(link)link.target='_self';
    replaying=true;el.click();replaying=false;
   }else{
    if(['file','password'].includes(el.type))return;
    if(el.isContentEditable)el.innerText=String(ev.value).slice(0,10000);
    else{
     const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
     const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(el,String(ev.value).slice(0,10000));
     if(['checkbox','radio'].includes(el.type)){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set.call(el,!!ev.checked);}
    }
    replaying=true;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));replaying=false;
   }
  send('sync-ack',{eventId:ev.seq,kind:ev.kind});
  }catch{replaying=false;send('missing',{eventId:ev.seq,kind:ev.kind,reason:'apply-failed',message:'Не удалось повторить действие на этом экране. Проверьте результат и при необходимости выполните действие вручную.'});}
 });
 chrome.runtime.sendMessage({type:'bridge-hello'}).then(result=>{
  if(!result?.enabled)return;token=result.token;parentOrigin=result.parentOrigin;
  let viewportStyle;
  function hideViewportScrollbars(){
   // Только прямой экран панели: вложенные страницы сайта сохраняют свои полосы прокрутки.
   if(location.ancestorOrigins[0]!==parentOrigin||!document.documentElement||viewportStyle?.isConnected)return;
   viewportStyle=document.createElement('style');
   viewportStyle.textContent=':root,:root>body{scrollbar-width:none!important}:root::-webkit-scrollbar,:root>body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
   document.documentElement.append(viewportStyle);
  }
  hideViewportScrollbars();
  const loaded=()=>{hideViewportScrollbars();readySent=true;send('ready',{url:location.href});};
  window.addEventListener('beforeunload',()=>send('loading'));
  window.addEventListener('pageshow',loaded);
  let lastURL=location.href;setInterval(()=>{if(lastURL!==location.href){lastURL=location.href;send('route',{url:lastURL});}},250);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loaded,{once:true});else loaded();
 }).catch(()=>{});
})();
