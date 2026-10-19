const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),assert=require('assert');
const fixture=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:20px system-ui}button,input,a{display:block;margin:20px;padding:10px}.tail{height:2500px}</style><button id="menu" onclick="document.querySelector('#result').textContent='Открыто'">Меню</button><p id="result">Закрыто</p><input id="field"><input id="password" type="password"><div id="box" style="height:100px;overflow:auto"><div style="height:900px">Вложенная прокрутка</div></div><a id="next" href="/next">Дальше</a><a id="blank" href="/new" target="_blank">Новое окно</a><form action="/post" method="POST"><button type="submit" id="submit">Заявка</button></form><div class="tail"></div>`;
(async()=>{let posts=0;const server=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture);}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const site='http://127.0.0.1:'+server.address().port,root=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-qa-desktop-')),ext=path.join(root,'extension');fs.cpSync(path.resolve(__dirname,'../extension'),ext,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));let context;
try{context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chromium',headless:true,viewport:{width:1500,height:1100},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});const cd=await context.browser().newBrowserCDPSession(),{id}=await cd.send('Extensions.loadUnpacked',{path:ext});const source=await context.newPage();await source.goto(site+'/');const panel=await context.newPage(),errors=[];panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`chrome-extension://${id}/panel.html`);const worker=context.serviceWorkers()[0],sourceId=await worker.evaluate(async url=>(await chrome.tabs.query({url:url+'/*'}))[0].id,site);await panel.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(site+'/')}&source=${sourceId}`);
await panel.waitForFunction(()=>document.querySelectorAll('.device-status').length===4&&[...document.querySelectorAll('.device-status')].every(x=>x.textContent==='Подключён'));assert.equal(source.url(),site+'/');assert(await panel.locator('#follow-source').isChecked());
const navigationTrace=[];const recordNavigation=entry=>{navigationTrace.push({at:Date.now(),...entry});if(navigationTrace.length>100)navigationTrace.shift();};
source.on('framenavigated',frame=>{if(frame===source.mainFrame())recordNavigation({type:'source-committed',url:frame.url()});});
source.on('requestfailed',request=>{if(request.isNavigationRequest())recordNavigation({type:'source-navigation-failed',url:request.url(),error:request.failure()?.errorText});});
panel.on('framenavigated',frame=>recordNavigation({type:'panel-frame-committed',url:frame.url()}));
await panel.evaluate(()=>{
 window.desktopTrace=[];const record=event=>{desktopTrace.push({at:Date.now(),...event});if(desktopTrace.length>160)desktopTrace.shift();};
 chrome.runtime.onMessage.addListener(message=>{if(['source-candidate','desktop-source-event'].includes(message.type))record({type:message.type,eventType:message.eventType,state:message.state,sourceTabId:message.sourceTabId,url:message.sourceURL||message.payload?.url,kind:message.payload?.event?.kind,selector:message.payload?.event?.target?.selector});});
 addEventListener('message',event=>{if(event.data?.app==='mobile-qa-v2')record({type:'bridge-'+event.data.type,url:event.data.url,kind:event.data.event?.kind,selector:event.data.event?.target?.selector,reason:event.data.reason});});
});
async function navigationCheckpoint(label){console.log(label,JSON.stringify({sourceURL:source.url(),frames:panel.frames().map(frame=>frame.url()),navigationTrace,panel:await panel.evaluate(()=>({notice:document.querySelector('#error-notice').textContent,sourceNotice:document.querySelector('#source-notice').textContent,sourceStatus:document.querySelector('#source-status').textContent,sourceURL:document.querySelector('#source-status').dataset.url,session:document.querySelector('#session-state').dataset.state,devices:[...document.querySelectorAll('.device-status')].map(el=>el.textContent),trace:window.desktopTrace}))}));}
await source.bringToFront();await source.locator('#menu').click();await panel.waitForTimeout(300);let frames=panel.frames().filter(f=>f.url().startsWith(site));console.log('DESKTOP',await panel.locator('#source-status').textContent(),await panel.locator('#status').textContent(),await Promise.all(frames.map(f=>f.locator('#result').textContent())));assert((await Promise.all(frames.map(f=>f.locator('#result').textContent()))).every(x=>x==='Открыто'));
await source.locator('#field').fill('Две вкладки');await panel.waitForTimeout(200);assert((await Promise.all(frames.map(f=>f.locator('#field').inputValue()))).every(x=>x==='Две вкладки'));
await source.evaluate(()=>scrollTo(0,900));await Promise.all(frames.map(f=>f.waitForFunction(()=>scrollY>500)));assert((await Promise.all(frames.map(f=>f.evaluate(()=>scrollY>500)))).every(Boolean));

// Mobile and tablet actions must reach the ordinary desktop tab and every peer.
await panel.bringToFront();frames=panel.frames().filter(f=>f.url().startsWith(site));
await frames[0].locator('#field').fill('Из телефона');await source.waitForFunction(()=>document.querySelector('#field').value==='Из телефона');
assert((await Promise.all(frames.map(f=>f.locator('#field').inputValue()))).every(x=>x==='Из телефона'));
await frames[3].locator('#field').fill('Из планшета');await source.waitForFunction(()=>document.querySelector('#field').value==='Из планшета');
await frames[0].locator('#password').fill('local-only');await panel.waitForTimeout(250);assert.equal(await source.locator('#password').inputValue(),'');assert.equal(await frames[1].locator('#password').inputValue(),'');
// Local fixture only: matching must preserve the clicked part of a shared anchor.
const worlds=[source,...frames];
async function installMatching(ambiguous=false){
 await Promise.all(worlds.map(world=>world.evaluate(ambiguous=>{
  document.querySelector('#matching')?.remove();const section=document.createElement('section');section.id='matching';
  section.innerHTML='<a href="/matching" style="margin:0;padding:0"><span data-action="first" style="display:inline-block;padding:4px">'+(ambiguous?'Одинаково':'Первое')+'</span><span data-action="second" style="display:inline-block;padding:4px">'+(ambiguous?'Одинаково':'Подробнее')+'</span></a><output id="match-result">none</output>';
  section.querySelector('a').addEventListener('click',event=>event.preventDefault());
  for(const span of section.querySelectorAll('span'))span.addEventListener('click',()=>{section.querySelector('output').textContent=span.dataset.action;});
  window.matchingClicks=[];section.addEventListener('click',event=>window.matchingClicks.push({action:event.target.dataset.action,tag:event.target.localName,text:event.target.textContent,trusted:event.isTrusted}),true);
  document.body.prepend(section);scrollTo(0,0);
 },ambiguous)));
 await Promise.all(worlds.map(world=>world.waitForFunction(()=>scrollY===0)));
}
async function clickMatching(driver){
 const target=driver.locator('#matching span').nth(1);
 if(driver===source)await target.click();
 else{
  // Координаты OOPIF пересчитываем вручную, но сначала выводим цель из-под sticky-шапки.
  await target.scrollIntoViewIfNeeded();
  const frameElement=await driver.frameElement();
  await frameElement.evaluate(el=>{
   const header=document.querySelector('.app-header').getBoundingClientRect();
   scrollBy({top:el.getBoundingClientRect().top-header.bottom-30,behavior:'instant'});
  });
  await panel.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const outer=await frameElement.boundingBox();
  const inner=await target.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,w:innerWidth,hit:el.contains(document.elementFromPoint(x,y))};});
  assert(inner.hit,'Matching target must be visible inside the iframe: '+JSON.stringify(inner));
  const point={x:outer.x+inner.x*outer.width/inner.w,y:outer.y+inner.y*outer.width/inner.w};
  const exposed=await frameElement.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,point);
  assert(exposed,'Matching target must not be outside the panel viewport or behind its header: '+JSON.stringify({point,outer,inner}));
  await panel.mouse.click(point.x,point.y);
 }
 assert(await driver.evaluate(()=>window.matchingClicks.some(event=>event.trusted&&event.tag==='span'&&event.action==='second')),'Matching regression must click the intended span with a trusted pointer event: '+JSON.stringify({driver:driver===source?'desktop':'phone',clicks:await driver.evaluate(()=>window.matchingClicks),panelScroll:await panel.evaluate(()=>scrollY)}));
}
for(const driver of [source,frames[0]]){
 await installMatching();if(driver===source)await source.bringToFront();else await panel.bringToFront();
 await clickMatching(driver);
  try{await Promise.all(worlds.map(world=>world.waitForFunction(()=>document.querySelector('#match-result').textContent==='second',null,{timeout:5000})));}
  catch(error){console.log('MATCHING FAILURE',JSON.stringify({driver:driver===source?'desktop':'phone',notice:await panel.locator('#error-notice').textContent(),sourceStatus:await panel.locator('#source-status').textContent(),worlds:await Promise.all(worlds.map(world=>world.evaluate(()=>({url:location.href,result:document.querySelector('#match-result')?.textContent,clicks:window.matchingClicks,scrollY,spans:[...document.querySelectorAll('#matching span')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,rect:{x:r.x,y:r.y,width:r.width,height:r.height},visibility:getComputedStyle(el).visibility};})}))))}));throw error;}
 await installMatching(true);if(await panel.locator('#error-dismiss').isVisible())await panel.locator('#error-dismiss').click();
 if(driver===source)await source.bringToFront();else await panel.bringToFront();
 if(driver!==source)await panel.evaluate(()=>scrollTo(0,document.body.scrollHeight));
 await clickMatching(driver);
 await panel.waitForFunction(()=>!document.querySelector('#error-notice').hidden);
 assert.equal(await driver.locator('#match-result').textContent(),'second');
 for(const recipient of worlds.filter(world=>world!==driver))assert.equal(await recipient.locator('#match-result').textContent(),'none','Ambiguous shared anchors must not click any peer element');
 await panel.locator('#error-dismiss').click();
}
await Promise.all(worlds.map(world=>world.evaluate(()=>{
 document.querySelector('#matching').remove();document.querySelector('#password').value='';
 const file=document.createElement('input');file.id='file';file.type='file';document.body.prepend(file);
 window.protectedEvents=[];document.addEventListener('input',event=>{if(['password','file'].includes(event.target.type))window.protectedEvents.push({type:event.target.type,trusted:event.isTrusted});},true);
})));
// Trusted capture exclusions in both directions, including native file-input events.
const fixtureFile=path.join(root,'fixture.txt');fs.writeFileSync(fixtureFile,'Local fixture only');
for(const driver of [source,frames[0]]){
 await Promise.all(worlds.map(world=>world.evaluate(()=>{document.querySelector('#password').value='';document.querySelector('#file').value='';window.protectedEvents=[];})));
 if(driver===source)await source.bringToFront();else await panel.bringToFront();
 await driver.locator('#password').fill('local-password');
 await driver.locator('#file').setInputFiles(fixtureFile);
 await panel.waitForTimeout(250);
 const protectedEvents=await driver.evaluate(()=>window.protectedEvents);
 assert(['password','file'].every(type=>protectedEvents.some(event=>event.type===type&&event.trusted)),'Capture regression must exercise trusted input events: '+JSON.stringify({driver:driver===source?'desktop':'phone',events:protectedEvents}));
 for(const recipient of worlds.filter(world=>world!==driver)){
  assert.equal(await recipient.locator('#password').inputValue(),'');
  assert.equal(await recipient.locator('#file').evaluate(el=>el.files.length),0);
 }
}
// Authenticated apply packets must reject protected destination types even if the packet claims text.
await Promise.all(worlds.map(world=>world.evaluate(()=>{document.querySelector('#password').value='';document.querySelector('#file').value='';window.protectedEvents=[];})));
const session=await worker.evaluate(async()=>Object.values((await chrome.storage.session.get('panels')).panels)[0]);
for(const targetId of ['password','file']){
 const event={kind:'input',seq:9000,url:site+'/',target:{id:targetId,tag:'input',selector:'#'+targetId},value:'must-not-apply',type:'text'};
 await worker.evaluate(({sourceId,token,event})=>chrome.tabs.sendMessage(sourceId,{type:'source-apply',token,event}),{sourceId,token:session.token,event});
 await panel.evaluate(({token,event})=>document.querySelector('.screen iframe').contentWindow.postMessage({app:'mobile-qa-v2',type:'apply',token,event},'*'),{token:session.token,event});
}
await panel.waitForTimeout(250);
for(const world of [source,frames[0]]){
 assert.equal(await world.locator('#password').inputValue(),'');assert.equal(await world.locator('#file').inputValue(),'');
 assert.deepEqual(await world.evaluate(()=>window.protectedEvents),[]);
}
assert.equal(await panel.locator('#error-notice').isVisible(),false,'Protected apply must return before attempting a native setter');
await Promise.all(worlds.map(world=>world.evaluate(()=>document.querySelector('#file').remove())));
console.log('PASS shared-anchor identity and ambiguity in both directions; trusted password/file capture and protected apply guards');
await frames[0].locator('#box').evaluate(e=>e.scrollIntoView({block:'center'}));await panel.waitForTimeout(500);const outer=await (await frames[0].frameElement()).boundingBox();const inner=await frames[0].locator('#box').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth};});await panel.mouse.move(outer.x+inner.x*outer.width/inner.w,outer.y+inner.y*outer.width/inner.w);await panel.mouse.wheel(0,400);await panel.waitForTimeout(600);await source.waitForFunction(()=>document.querySelector('#box').scrollTop>300);
// Action replay pauses in both directions; Main still follows source addresses.
await panel.locator('#sync').uncheck();await frames[0].locator('#field').fill('Только телефон');await panel.waitForTimeout(250);assert.equal(await source.locator('#field').inputValue(),'Из планшета');
await source.locator('#field').fill('Только основная');await panel.waitForTimeout(250);assert.equal(await frames[0].locator('#field').inputValue(),'Только телефон');
await source.evaluate(()=>history.pushState(null,'','/paused'));await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/paused')));
await source.evaluate(()=>history.replaceState(null,'','/'));await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/'))&&[...document.querySelectorAll('.device-status')].every(e=>e.textContent==='Подключён'));frames=panel.frames().filter(f=>f.url().startsWith(site));await panel.locator('#sync').check();
// Return control to a phone, then to desktop, without rebroadcast loops.
await panel.bringToFront();await frames[0].locator('#field').fill('Снова вместе');await source.waitForFunction(()=>document.querySelector('#field').value==='Снова вместе');
await panel.waitForFunction(()=>document.querySelector('.device').classList.contains('controller'));
const testPanelId=await panel.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
await worker.evaluate(async({sourceId,panelTabId})=>{
 const tab=await chrome.tabs.get(sourceId);
 await chrome.runtime.sendMessage({type:'source-candidate',panelTabId,state:'ready',sourceTabId:sourceId,sourceWindowId:tab.windowId,sourceURL:tab.url,host:new URL(tab.url).hostname});
},{sourceId,panelTabId:testPanelId});
await panel.waitForFunction(()=>document.querySelector('#source-controls').classList.contains('controller')&&!document.querySelector('.device.controller'));
// Simulate unavailable late injection: document_start must reconnect without it.
await worker.evaluate(()=>{globalThis.originalDesktopInjection=chrome.scripting.executeScript;chrome.scripting.executeScript=async options=>{if(options.files?.includes('desktop-source.js'))throw new Error('Local test: late injection unavailable');return globalThis.originalDesktopInjection.call(chrome.scripting,options);};});
await frames[0].locator('#next').evaluate(e=>e.scrollIntoView({block:'center'}));await panel.waitForTimeout(500);const navOuter=await (await frames[0].frameElement()).boundingBox();const navInner=await frames[0].locator('#next').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth};});
try{await panel.mouse.click(navOuter.x+navInner.x*navOuter.width/navInner.w,navOuter.y+navInner.y*navOuter.width/navInner.w);await source.waitForURL('**/next');await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/next')));await panel.waitForFunction(()=>[...document.querySelectorAll('.device-status')].every(x=>x.textContent==='Подключён'));}
catch(error){await navigationCheckpoint('MOBILE NAVIGATION FAILURE');throw error;}
await source.waitForLoadState('load');await panel.waitForFunction(url=>document.querySelector('#source-status').dataset.url===url,site+'/next',{timeout:10000});await source.bringToFront();await source.locator('#field').fill('Основная снова');await panel.waitForFunction(()=>document.querySelector('#status').textContent.length>0);frames=panel.frames().filter(f=>f.url().startsWith(site));await Promise.all(frames.map(f=>f.waitForFunction(()=>document.querySelector('#field').value==='Основная снова')));
await worker.evaluate(()=>{chrome.scripting.executeScript=globalThis.originalDesktopInjection;delete globalThis.originalDesktopInjection;});
console.log('PASS automatic reconnect without late injection; reverse phone/tablet input, nested scroll, password exclusion, bidirectional action pause with continued source URL following, mobile navigation and desktop takeover');
await source.locator('#next').click();await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/next')));await panel.waitForFunction(()=>[...document.querySelectorAll('.device-status')].every(x=>x.textContent==='Подключён'));
try{await source.reload();await source.locator('#menu').click();await panel.waitForTimeout(300);frames=panel.frames().filter(f=>f.url().startsWith(site));assert((await Promise.all(frames.map(f=>f.locator('#result').textContent()))).every(x=>x==='Открыто'));}
catch(error){await navigationCheckpoint('SOURCE RELOAD FAILURE');throw error;}
const opened=context.waitForEvent('page');await source.locator('#blank').click();const other=await opened;await other.waitForLoadState();assert.equal(source.url(),site+'/next');assert((await source.locator('#blank').getAttribute('target'))==='_blank');await other.bringToFront();await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/new')));await other.close();await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/next')));await source.bringToFront();
await source.locator('#submit').click();await source.waitForURL('**/post');await panel.waitForFunction(()=>[...document.querySelectorAll('.pageurl')].every(e=>e.textContent.endsWith('/post')));assert.equal(posts,1);
await panel.bringToFront();await panel.locator('#stop').click();await source.locator('#menu').click();assert.equal(await panel.locator('.device-status').first().textContent(),'Остановлен');await panel.locator('#start').click();await panel.waitForFunction(()=>document.querySelectorAll('.device-status').length===4&&[...document.querySelectorAll('.device-status')].every(x=>x.textContent==='Подключён'));const retained=await panel.locator('.pageurl').allTextContents();await source.close();await panel.waitForFunction(()=>!document.querySelector('#source-notice').hidden);assert.deepEqual(await panel.locator('.pageurl').allTextContents(),retained);
assert.deepEqual(errors,[]);console.log('PASS desktop preserved, clicks/input/proportional scroll/navigation/reload, native target_blank, one form POST, stop/reconnect, source closed');
}finally{await context?.close();server.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
