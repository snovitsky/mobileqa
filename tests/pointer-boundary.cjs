const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const bridge = fs.readFileSync(path.resolve(__dirname, '../extension/bridge.js'), 'utf8');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));

(async () => {
 let parentOrigin;
 const site = http.createServer((req, res) => {
  if (req.url === '/bridge.js') {
   res.writeHead(200, { 'Content-Type': 'application/javascript' });res.end(bridge);return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:18px Arial}#drag{margin:20px;width:350px;height:120px;background:#cee;touch-action:none}p{margin:20px}</style>
<div id="drag">Carousel drag area</div><p id="text">Selectable website text</p><a id="finish-link" href="/unexpected" hidden>Navigation sentinel</a><form id="finish-form" action="/unexpected" method="post" hidden><button id="finish-submit">Submit sentinel</button></form><script>
window.state={dragging:false,cancels:0,ups:0,pointerUps:0,clicks:0,moves:0,capture:false,mode:'all',finishActions:false,linkClicks:0,submitClicks:0,submits:0,log:[]};
for(const kind of ['pointerdown','pointermove','pointerout','pointercancel','pointerup','mouseup','gotpointercapture','lostpointercapture'])document.addEventListener(kind,e=>state.log.push({kind,trusted:e.isTrusted,x:e.clientX,y:e.clientY,target:e.target.id,related:e.relatedTarget?.id}),true);
addEventListener('blur',()=>state.log.push({kind:'blur'}));
addEventListener('pointerup',event=>{if(state.dropNativeUp&&event.isTrusted)event.stopImmediatePropagation();},true);
const drag=document.getElementById('drag');
drag.addEventListener('pointerdown',e=>{e.preventDefault();state.dragging=true;if(state.capture)drag.setPointerCapture(e.pointerId)});
document.addEventListener('pointermove',()=>{if(state.dragging)state.moves++});
document.addEventListener('pointercancel',()=>{if(state.mode==='all')state.dragging=false;state.cancels++});
document.addEventListener('pointerup',event=>{state.pointerUps++;if(state.mode!=='pointerup-window')state.dragging=false;if(state.finishActions&&!event.isTrusted){document.querySelector('#finish-link').click();document.querySelector('#finish-submit').click();document.querySelector('#finish-form').requestSubmit();}});
window.addEventListener('pointerup',()=>{if(state.mode==='pointerup-window')state.dragging=false});
document.addEventListener('mouseup',()=>{if(state.mode==='all')state.dragging=false;state.ups++});
drag.addEventListener('click',()=>state.clicks++);
document.querySelector('#finish-link').addEventListener('click',()=>state.linkClicks++);
document.querySelector('#finish-submit').addEventListener('click',()=>state.submitClicks++);
document.querySelector('#finish-form').addEventListener('submit',()=>state.submits++);
window.chrome=window.chrome||{};chrome.runtime={sendMessage:async()=>({enabled:true,token:'fixture-token',parentOrigin:${JSON.stringify(parentOrigin)}})};
</script><script src="/bridge.js"></script>`);
 });
 await listen(site);
 const siteOrigin = `http://127.0.0.1:${site.address().port}`;
 const parent = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><style>body{margin:30px}iframe{display:block;width:430px;height:260px;border:0}input{margin:20px}</style>
<iframe src="${siteOrigin}/" title="Local carousel"></iframe><input id="outside" aria-label="Outside field">
<script>window.messages=[];addEventListener('message',e=>messages.push(e.data));</script>`);
 });
 let browser;
 try {
  await listen(parent);
  parentOrigin = `http://127.0.0.1:${parent.address().port}`;
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto(parentOrigin);
  await page.waitForFunction(() => messages.some(message => message.type === 'ready'));
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  const drag = await frame.locator('#drag').boundingBox();
  const box = await page.locator('iframe').boundingBox();
  const state = () => frame.evaluate(() => ({ ...window.state }));
  async function begin(capture = false, mode = 'all') {
   // Карусель подавляет default pointerdown, поэтому фокусируем документ до начала жеста.
   await frame.locator('#text').click();
   await frame.evaluate(({capture,mode}) => { state.capture=capture;state.mode=mode;state.cancels=0;state.ups=0;state.pointerUps=0;state.clicks=0;state.moves=0;state.log=[]; }, {capture,mode});
   await page.mouse.move(drag.x + 70, drag.y + 60);
   await page.mouse.down();
   await page.mouse.move(drag.x + 120, drag.y + 60, { steps: 6 });
   assert.equal((await state()).dragging, true, JSON.stringify(await state()));
  }
  for (const capture of [false, true]) {
   await begin(capture);
   await page.mouse.move(box.x + box.width + 50, box.y + 80, { steps: 12 });
   await frame.waitForFunction(() => !state.dragging);
   assert((await state()).cancels > 0, 'Выход из viewport должен отменить pointer-жест');
   assert((await state()).ups > 0, 'Mouse-only карусель должна получить mouseup');
   await page.mouse.up();
   await page.mouse.move(drag.x + 100, drag.y + 60);
   assert.equal((await state()).dragging, false);
   assert.equal((await state()).clicks, 0);
  }

  // Some widgets end a gesture only on pointerup; pointercancel/mouseup are deliberately ignored.
  for (const mode of ['pointerup-document','pointerup-window']) for (const capture of [false,true]) {
   await begin(capture,mode);
   await page.mouse.move(box.x+box.width+50,box.y+80,{steps:12});
   await frame.waitForFunction(()=>!state.dragging,null,{timeout:3000});
   assert((await state()).pointerUps>0,'Pointerup-only widget must receive its completion event');
   await page.mouse.up();
   await page.mouse.move(drag.x+100,drag.y+60);
   assert.equal((await state()).dragging,false);
   assert.equal((await state()).clicks,0);
   await begin(capture,mode);
   await page.mouse.move(drag.x+220,drag.y+60,{steps:8});await page.mouse.up();
   assert.equal((await state()).dragging,false);assert.equal((await state()).cancels,0);
   await frame.locator('#drag').click();assert((await state()).clicks>0,'Normal click after pointerup-only cancellation must work');
  }

  // A release handler may call click/requestSubmit. Cancelling a drag must not activate either.
  await begin(true,'pointerup-document');await frame.evaluate(()=>{state.finishActions=true;});
  await page.mouse.move(box.x+box.width+50,box.y+80,{steps:12});
  await frame.waitForFunction(()=>!state.dragging);await page.mouse.up();
  assert.equal((await state()).linkClicks,0);assert.equal((await state()).submitClicks,0);assert.equal((await state()).submits,0);
  assert.equal(frame.url(),siteOrigin+'/');
  await frame.evaluate(()=>{state.finishActions=false;});

  // If another handler swallows native up, a trusted return/move with buttons:0 repairs the stale gesture.
  await begin(true,'pointerup-document');await frame.evaluate(()=>{state.dropNativeUp=true;});
  await page.mouse.up();assert.equal((await state()).dragging,true);
  await page.mouse.move(drag.x+150,drag.y+60,{steps:2});
  await frame.waitForFunction(()=>!state.dragging);assert((await state()).pointerUps>0);
  await frame.evaluate(()=>{state.dropNativeUp=false;});

  // Возврат до отпускания кнопки не должен превратить отменённый drag в click.
  await begin(true,'pointerup-window');
  await page.mouse.move(box.x + box.width + 30, box.y + 80, { steps: 8 });
  await frame.waitForFunction(() => !state.dragging);
  await page.mouse.move(drag.x + 110, drag.y + 60, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state()).clicks, 0);

  // Обычный drag внутри экрана завершается штатно и не получает pointercancel.
  await begin(true);
  await page.mouse.move(drag.x + 220, drag.y + 60, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state()).dragging, false);
  assert.equal((await state()).cancels, 0);
  assert((await state()).moves > 0);
  // Новый обычный click после отменённого жеста не должен быть заблокирован.
  await frame.locator('#drag').click();
  assert((await state()).clicks > 0);

  await begin(true,'pointerup-window');
  await page.locator('#outside').focus();
  await frame.waitForFunction(() => !state.dragging);
  assert((await state()).cancels > 0);
  await page.mouse.up();

  // Fallback родителя принимает только действующий token и проверенный origin/source.
  await begin(true,'pointerup-window');
  await page.evaluate(origin => document.querySelector('iframe').contentWindow.postMessage({app:'mobile-qa-v2',type:'cancel-pointer',token:'wrong-token'},origin), siteOrigin);
  await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal((await state()).dragging, true);
  await page.evaluate(origin => document.querySelector('iframe').contentWindow.postMessage({app:'mobile-qa-v2',type:'cancel-pointer',token:'fixture-token'},origin), siteOrigin);
  await frame.waitForFunction(() => !state.dragging);
  await page.mouse.up();
  await frame.locator('#text').dblclick();
  assert((await frame.evaluate(() => getSelection().toString())).length > 0);
  console.log('PASS pointer boundary: cross-origin exit, pointerup-only document/window widgets, capture release, return without click, normal drag/click/text, release click/submit prevention, blur and token-checked fallback');
 } finally {
  await browser?.close();
  await Promise.all([close(site), parent.listening ? close(parent) : Promise.resolve()]);
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
