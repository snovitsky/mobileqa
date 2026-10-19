const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const helper=fs.readFileSync(path.join(root,'extension/update-lifecycle.js'),'utf8').replace(/^export /gm,'');
const background=fs.readFileSync(path.join(root,'extension/background.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
const panelURL='chrome-extension://fixture/panel.html';
function fixture({failSave=false,failCleanup=false}={}){
 const listeners={},log=[],local={pendingExtensionUpdate:{version:'3.0.0'}},session={panels:{11:{host:'example.test',sourceTabId:21,token:'secret-local-fixture'}},sourceWatches:{11:{sourceTabId:21}}};
 let rules=[{id:41,condition:{tabIds:[11]}}],scripts=[{id:'bridge',js:['bridge.js','desktop-source.js']},{id:'unrelated',js:['unrelated.js']}];
 const event=name=>({addListener:listener=>{listeners[name]=listener;}});
 const chrome={
  runtime:{id:'fixture',getURL:file=>'chrome-extension://fixture/'+file,getManifest:()=>({version:'2.6.20'}),onInstalled:event('installed'),onUpdateAvailable:event('available'),onMessage:event('message'),
   sendMessage:async message=>{log.push(message.type+':'+message.panelTabId);if(message.type==='extension-update-stop')return {ok:!failSave,panelTabId:message.panelTabId};},reload:()=>log.push('reload')},
  storage:{local:{get:async()=>structuredClone(local),set:async value=>{Object.assign(local,structuredClone(value));},remove:async keys=>{for(const key of keys)delete local[key];}},session:{get:async()=>structuredClone(session),set:async value=>{Object.assign(session,structuredClone(value));log.push('persist');}}},
  tabs:{query:async()=>[{id:11,url:panelURL+'?source=21'},{id:12,url:panelURL+'#another'},{id:13,url:panelURL+'.evil'},{id:21,url:'https://example.test/'}],sendMessage:async(id,message)=>log.push(message.type+':'+id),onActivated:event('activated'),onRemoved:event('removed'),onUpdated:event('updated')},
  permissions:{onRemoved:event('permissionRemoved'),onAdded:event('permissionAdded')},action:{onClicked:event('action')},
  declarativeNetRequest:{getSessionRules:async()=>rules,updateSessionRules:async()=>{if(failCleanup)throw Error('Private native failure');rules=[];log.push('rules-cleared');}},
  scripting:{getRegisteredContentScripts:async()=>scripts,unregisterContentScripts:async({ids})=>{scripts=scripts.filter(script=>!ids.includes(script.id));log.push('scripts-cleared');}}
 };
 const context=vm.createContext({chrome,URL,setTimeout,clearTimeout,normalizeURL:value=>new URL(value).href,ERROR_MESSAGES:{},userError:code=>Object.assign(new Error(code),{code}),userMessage:error=>error.message});
 vm.runInContext(helper+'\n'+background,context);
 const sender={id:'fixture',frameId:0,url:panelURL+'?source=21',tab:{id:11}};
 return {listeners,local,session,log,chrome,context,get rules(){return rules;},get scripts(){return scripts;},request:(custom={})=>new Promise(resolve=>{
  const result=listeners.message({type:'apply-extension-update'},{...sender,...custom},resolve);if(result!==true)resolve(null);
 })};
}
(async()=>{
 const versions=vm.createContext({});vm.runInContext(helper,versions);
 for(const value of ['2.6.20','2.6.19','evil','3.0.0/../x','3.0.0?query','65536.0','1.2.3.4.5'])assert.equal(versions.newerVersion(value,'2.6.20'),false);
 assert(versions.newerVersion('2.7.0','2.6.20'));assert(versions.newerVersion('3','2.6.20'));
 const f=fixture();
 await f.listeners.available({version:'2.6.19'});assert.equal(f.local.pendingExtensionUpdate.version,'3.0.0');
 await f.listeners.available({version:'3.0.1'});assert.equal(f.local.pendingExtensionUpdate.version,'3.0.1');assert(!f.log.includes('reload'));
 for(const sender of [{id:'foreign'},{frameId:1},{url:panelURL+'.evil'},{url:'https://example.test/panel.html'}]){
  const result=await f.request(sender);assert(!result?.ok);assert(!f.log.includes('reload'));
 }
 const result=await f.request();assert.equal(result.ok,true);
 assert.deepEqual(f.log.filter(line=>line.startsWith('extension-update-stop:')),['extension-update-stop:12','extension-update-stop:11']);
 assert.equal(f.rules.length,0);assert.deepEqual(f.scripts.map(script=>script.id),['unrelated']);
 assert.deepEqual(f.session.panels,{});assert.deepEqual(f.session.sourceWatches,{});
 for(const step of ['rules-cleared','scripts-cleared','source-stop:21','persist'])assert(f.log.indexOf(step)<f.log.indexOf('reload'));
 assert.equal(f.log.at(-1),'reload');
 for(const options of [{failSave:true},{failCleanup:true}]){
  const failed=fixture(options),result=await failed.request();assert.equal(result.ok,false);assert(!failed.log.includes('reload'));assert(failed.log.includes('extension-update-failed:11'));
  if(options.failSave)assert.equal(failed.rules.length,1,'Save failure must not destroy runtime session');
  assert.equal(vm.runInContext('extensionUpdates.applying',failed.context),false,'Failure releases the update latch');
 }
 const installed=fixture();installed.local.dismissedPendingUpdate='3.0.0';
 await installed.listeners.installed({reason:'install'});assert(!installed.local.extensionUpdate);
 await installed.listeners.installed({reason:'update',previousVersion:'2.6.19'});
 assert.equal(installed.local.extensionUpdate.version,'2.6.20');assert(!installed.local.pendingExtensionUpdate);assert(!installed.local.dismissedPendingUpdate);
 console.log('PASS native update event, version/sender guards, all-panel save acknowledgements, global cleanup before reload, failure recovery, installed notice');
})().catch(error=>{console.error(error);process.exitCode=1;});
