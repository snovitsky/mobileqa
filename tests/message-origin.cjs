const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-origin-'));let context;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Origin fixture</title><input id="field"><script>window.received=[];addEventListener("message",e=>received.push(e.data));</script>');}).listen(0,'127.0.0.1');
 const other=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Other origin</title><p>Observer</p><script>window.received=[];addEventListener("message",e=>received.push(e.data));</script>');}).listen(0,'127.0.0.1');
 await Promise.all([new Promise(r=>server.once('listening',r)),new Promise(r=>other.once('listening',r))]);
 try{
  const ext=path.join(root,'extension');fs.cpSync(path.resolve(__dirname,'../extension'),ext,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  const cdp=await context.browser().newBrowserCDPSession(),{id}=await cdp.send('Extensions.loadUnpacked',{path:ext});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({preferences:{followSource:false}}));
  const page=await context.newPage(),url=`http://127.0.0.1:${server.address().port}/`,otherURL=`http://127.0.0.1:${other.address().port}/`;
  await page.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(url)}`);
  await page.waitForFunction(()=>[...document.querySelectorAll('.device-status')].length===4&&[...document.querySelectorAll('.device-status')].every(e=>e.textContent==='Подключён'));
  const frame=page.frames().find(f=>f.url()===url);
  const token=await worker.evaluate(async()=>Object.values((await chrome.storage.session.get('panels')).panels)[0].token);
  await frame.goto(otherURL);
  await frame.evaluate(()=>{window.received=[];});
  await page.locator('.screen').first().dispatchEvent('pointerleave');
  await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await frame.evaluate(()=>received.filter(m=>m.app==='mobile-qa-v2').length),0,'Another origin must not receive a session envelope, even after an iframe navigation');
  await frame.evaluate(token=>parent.postMessage({app:'mobile-qa-v2',type:'http-status',token,url:location.href,status:404},'*'),token);
  await frame.evaluate(token=>parent.postMessage({app:'mobile-qa-v2',type:'ready',token,url:location.href},'*'),token);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.locator('.pageurl').first().textContent(),url,'A different origin must not be accepted even with a correct test token');
  assert.equal(await page.locator('.http-warning:visible').count(),0);
  console.log('PASS exact session origin for incoming/outgoing messages, no envelope leakage to navigated iframe, correct-token cross-origin forgery rejected');
 }finally{await context?.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>other.close(r))]);fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
