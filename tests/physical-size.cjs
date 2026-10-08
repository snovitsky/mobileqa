const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'brandmaker-physical-'));let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1600,height:1000},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
 const cd=await context.browser().newBrowserCDPSession();const {id}=await cd.send('Extensions.loadUnpacked',{path:path.resolve(__dirname,'../extension')});const page=await context.newPage();
 await page.goto(`chrome-extension://${id}/panel.html`,{waitUntil:'domcontentloaded'});
 await page.locator('#scale').selectOption('1');await page.waitForFunction(()=>document.querySelector('#calibration-dialog').open);
 await page.locator('#calibration-cancel').click();await page.waitForFunction(()=>document.querySelector('#scale').value==='auto');assert.equal(await page.locator('#scale').inputValue(),'auto');
 await page.locator('#scale').selectOption('1');await page.locator('#measurement-width').fill('250');await page.locator('#measurement-width').dispatchEvent('input');
 assert.equal(await page.locator('#measurement-line').evaluate(e=>e.getBoundingClientRect().width),250);
 await page.locator('#calibration-save').click();await page.waitForFunction(()=>!document.querySelector('#calibration-dialog').open);
 async function diagonal(){return page.locator('.device:first-child .display').evaluate(e=>{const r=e.getBoundingClientRect();return Math.hypot(r.width,r.height);});}
 assert(await page.locator('.device:first-child').evaluate(e=>{const d=e.querySelector('.display').getBoundingClientRect(),bar=e.querySelector('.hardware-top').getBoundingClientRect(),site=e.querySelector('.screen').getBoundingClientRect();return Math.abs(bar.height+site.height-d.height)<1&&site.top>=bar.bottom-1;}));const expected=6.06*25.4*5;assert(Math.abs(await diagonal()-expected)<1);
 assert.equal(await page.locator('.device:first-child iframe').evaluate(e=>parseFloat(e.style.width)),414);
 await page.locator('.device:first-child [data-action="rotate"]').click();assert(Math.abs(await diagonal()-expected)<1);
 await page.locator('#scale').selectOption('0.5');assert(Math.abs(await diagonal()-expected/2)<1);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#scale').selectOption('1');assert.equal(await page.locator('#calibration-dialog').evaluate(e=>e.open),false);assert(Math.abs(await diagonal()-expected)<1);
 await page.locator('#scale').selectOption('css');assert.equal(await page.locator('.device:first-child .screen').evaluate(e=>e.getBoundingClientRect().width),414);
 await page.locator('.settings-menu summary').click();await page.locator('#calibrate').click();await page.locator('#measurement-width').fill('0');await page.locator('#calibration-save').click();assert.equal(await page.locator('#calibration-dialog').evaluate(e=>e.open),true);await page.locator('#calibration-cancel').click();
 console.log('PASS calibration required/cancel, 5cm ruler, measured display diagonal, rotation, 50%, persistence, CSS 1:1 and invalid input');
}finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
