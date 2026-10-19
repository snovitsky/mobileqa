// Store listing artwork only. No output from this script belongs in the extension ZIP.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require('playwright');
const project=path.resolve(__dirname,'..');
const demo=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Демо — адаптивный сайт</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fa;color:#152c40;font:16px/1.45 system-ui,sans-serif}header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;background:white;border-bottom:1px solid #dce5ec}.logo{font-weight:800;letter-spacing:-.6px}.logo i{display:inline-block;width:14px;height:14px;background:#00a9c9;border-radius:4px;margin-right:8px}nav{display:flex;gap:18px}a{color:#436076;text-decoration:none;font-size:13px}main{padding:32px 24px;max-width:1100px;margin:auto}.eyebrow{color:#087b96;text-transform:uppercase;font-size:11px;font-weight:800;letter-spacing:1.4px}h1{font-size:clamp(32px,5vw,52px);line-height:1.12;letter-spacing:-1.5px;margin:14px 0}p{color:#536c7e;font-size:15px;max-width:440px}.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:28px;align-items:center}.button{display:inline-block;color:white;background:#087f9b;padding:13px 19px;border-radius:10px;font-weight:650;font-size:14px;margin-top:12px;border:0;cursor:pointer}.art{position:relative;min-height:240px;border-radius:26px;background:linear-gradient(145deg,#d8f3f1,#b2dce7);overflow:hidden}.circle{position:absolute;width:180px;height:180px;border-radius:50%;background:#f8fcfd;right:-20px;top:-30px}.panel{position:absolute;inset:40px 30px 32px;transform:rotate(-7deg);border:1px solid #c8d9e2;background:#fff;border-radius:16px;box-shadow:0 20px 30px #193e5a20;padding:20px}.line{height:9px;background:#d8e8ed;border-radius:10px;margin:12px 0;width:75%}.line:first-child{background:#13a3b6;width:40%;height:13px}.blocks{display:flex;gap:10px;margin-top:20px}.blocks div{height:65px;flex:1;background:#e3f0f5;border-radius:9px}.blocks div:nth-child(2){background:#a3d6dc}.section{margin-top:32px}h2{font-size:21px;margin:0 0 16px;letter-spacing:-.5px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{padding:19px 15px;background:white;border:1px solid #dce5ec;border-radius:13px}.card b{display:block;font-size:14px}.card span{display:block;font-size:12px;color:#627b8b;margin-top:7px}.number{color:#087f9b;font-size:12px;margin-bottom:10px}footer{font-size:11px;color:#718696;margin-top:30px;border-top:1px solid #dce5ec;padding-top:15px}@media(max-width:600px){header{padding:16px 20px}nav{gap:12px}nav a{font-size:12px}main{padding:24px 20px}.hero{display:block}.art{min-height:180px;margin-top:24px}.panel{inset:28px 35px 24px}.blocks div{height:43px}.cards{grid-template-columns:1fr}.card{padding:16px}.card span{margin-top:4px}.section{margin-top:25px}}
</style><header><div class="logo"><i></i>Демо</div><nav><a href="#features">Возможности</a><a href="#about">О проекте</a></nav></header><main><div class="hero"><div><div class="eyebrow">Пример адаптивного сайта</div><h1>Хорошо на<br>любом экране</h1><p>Один сайт. Разные размеры.<br>Сравните страницы рядом.</p><a class="button" href="#features">Смотреть возможности</a></div><div class="art" aria-label="Иллюстрация карточек интерфейса"><div class="circle"></div><div class="panel"><div class="line"></div><div class="line"></div><div class="line"></div><div class="blocks"><div></div><div></div><div></div></div></div></div></div><section class="section" id="features"><h2>Всё на своих местах</h2><div class="cards"><div class="card"><div class="number">01</div><b>Гибкая сетка</b><span>Блоки подстраиваются под ширину.</span></div><div class="card"><div class="number">02</div><b>Понятная навигация</b><span>Нужное всегда рядом.</span></div><div class="card"><div class="number">03</div><b>Удобные элементы</b><span>Текст, кнопки и отступы.</span></div></div></section><footer id="about">Локальная демонстрация · без клиентских данных</footer></main></html>`;

(async()=>{
 const output=path.join(project,'dist','store-assets');fs.mkdirSync(output,{recursive:true});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brandmaker-store-assets-'));
 let context,server;
 try{
  server=http.createServer((request,response)=>{
   if(request.url!=='/'&&request.url!=='/demo'){response.writeHead(404);response.end();return;}
   response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(demo);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${server.address().port}/demo`;
  const extension=path.join(temp,'extension');fs.cpSync(path.join(project,'extension'),extension,{recursive:true});
  const manifestFile=path.join(extension,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.host_permissions=['http://127.0.0.1/*'];
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
   channel:'chromium',headless:true,viewport:{width:1280,height:800},deviceScaleFactor:1,
   ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']
  });
  // This screenshot session must never navigate to a production site.
  await context.route('**/*',route=>{
   const requested=route.request().url();
   if(requested.startsWith(`http://127.0.0.1:${server.address().port}/`)||requested.startsWith('chrome-extension:')||requested.startsWith('data:'))return route.continue();
   return route.abort();
  });
  const cdp=await context.browser().newBrowserCDPSession();
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({preferences:{count:'3',followSource:false,scale:'auto',browserMode:'collapsed',devices:['iphone11','galaxys24','ipad11'],sync:true}}));
  const page=await context.newPage();
  await page.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(url)}`);
  await page.waitForFunction(()=>document.querySelectorAll('.device-status').length===3&&[...document.querySelectorAll('.device-status')].every(el=>el.textContent==='Подключён'),{},{timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;});
  for(const frame of page.frames().filter(frame=>frame.url()===url))await frame.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(output,'panel-1280x800.png'),animations:'disabled'});
  const screenshot=fs.readFileSync(path.join(output,'panel-1280x800.png')).toString('base64');
  const icon=fs.readFileSync(path.join(project,'extension/icons/128.png'));
  fs.writeFileSync(path.join(output,'icon-128.png'),icon);
  const promo=await context.newPage();await promo.setViewportSize({width:440,height:280});
  await promo.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;overflow:hidden;background:linear-gradient(135deg,#11253e,#174b63);font-family:system-ui,sans-serif;color:#fff}.brand{position:absolute;left:24px;top:22px;display:flex;align-items:center;gap:12px;font-size:25px;font-weight:750;letter-spacing:-.8px}.brand img{width:37px;height:37px}.line{position:absolute;left:27px;top:75px;color:#b9e9ef;font-size:14px}.screen{position:absolute;left:27px;top:110px;width:460px;border-radius:9px;box-shadow:0 12px 30px #00122190;transform:rotate(-5deg);border:2px solid #447086}.orb{position:absolute;width:240px;height:240px;background:#14a6be22;border-radius:50%;right:-100px;top:-90px}</style><div class="orb"></div><div class="brand"><img src="data:image/png;base64,${icon.toString('base64')}" alt="">Brandmaker QA</div><div class="line">Один сайт. Несколько экранов.</div><img class="screen" src="data:image/png;base64,${screenshot}" alt="Реальная панель расширения"></html>`);
  await promo.locator('.screen').evaluate(image=>image.decode());
  await promo.screenshot({path:path.join(output,'promo-440x280.png'),animations:'disabled'});
  console.log('Store listing assets: dist/store-assets/panel-1280x800.png, promo-440x280.png, icon-128.png. Review visually before upload.');
 }finally{
  await context?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  // Delete only the exact temporary directory created above, never a computed parent.
  const resolved=path.resolve(temp),prefix=path.join(os.tmpdir(),'brandmaker-store-assets-');
  if(resolved.startsWith(path.resolve(prefix))&&path.dirname(resolved)===path.resolve(os.tmpdir()))fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
