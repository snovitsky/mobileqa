const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');

// Pure background fixture: no browser, server, user profile, or real permission changes.
function fixture(initialPanels,initialWatches={}){
 const panelURL='chrome-extension://fixture/panel.html',listeners={},messages=[],tabMessages=[];
 const allowed=new Set(Object.values(initialPanels).map(session=>session.permissionMatch).filter(Boolean));
 const storage={panels:structuredClone(initialPanels),sourceWatches:structuredClone(initialWatches)};
 let rules=Object.keys(initialPanels).map((id,index)=>({id:index+1,condition:{tabIds:[Number(id)]}}));
 let scripts=Object.values(initialPanels).map((session,index)=>({id:'script-'+index,js:['bridge.js','desktop-source.js'],matches:[session.permissionMatch||'https://'+session.host+'/*']}));
 const tabs=new Map([11,12,13,14].map(id=>[id,{id,windowId:1,url:panelURL,active:false}]));
 for(const session of Object.values(initialPanels))if(session.sourceTabId)tabs.set(session.sourceTabId,{id:session.sourceTabId,windowId:1,url:'https://'+session.host+'/',status:'complete',active:session.sourceTabId===21});
 const event=name=>({addListener:listener=>{listeners[name]=listener;}});
 const chrome={
  runtime:{id:'fixture',getURL:()=>panelURL,onMessage:event('message'),sendMessage:async message=>{messages.push(structuredClone(message));}},
  storage:{session:{get:async()=>structuredClone(storage),set:async value=>Object.assign(storage,structuredClone(value))}},
  permissions:{contains:async({origins})=>origins.every(origin=>allowed.has(origin)),onRemoved:event('removed'),onAdded:event('added')},
  scripting:{getRegisteredContentScripts:async()=>structuredClone(scripts),unregisterContentScripts:async({ids})=>{scripts=scripts.filter(script=>!ids.includes(script.id));},registerContentScripts:async entries=>{scripts.push(...structuredClone(entries));},updateContentScripts:async()=>{},executeScript:async()=>{}},
  declarativeNetRequest:{getSessionRules:async()=>structuredClone(rules),updateSessionRules:async({removeRuleIds=[],addRules=[]})=>{rules=rules.filter(rule=>!removeRuleIds.includes(rule.id)).concat(structuredClone(addRules));}},
  tabs:{get:async id=>{if(!tabs.has(id))throw Error('Missing fixture tab');return structuredClone(tabs.get(id));},query:async query=>[...tabs.values()].filter(tab=>(query.windowId===undefined||tab.windowId===query.windowId)&&(!query.active||tab.active)),sendMessage:async(id,message)=>{tabMessages.push({id,...structuredClone(message)});},onActivated:event('activated'),onRemoved:event('tabRemoved'),onUpdated:event('updated')},
  windows:{get:async id=>({id,type:'normal'}),getLastFocused:async()=>({id:1,type:'normal'})},action:{onClicked:event('clicked')}
 };
 const context=vm.createContext({chrome,URL,crypto:{randomUUID},normalizeURL:value=>new URL(value).href,ERROR_MESSAGES:{},userError:code=>Object.assign(new Error(code),{code}),userMessage:error=>error.message});
 const source=fs.readFileSync(path.resolve(__dirname,'../extension/background.js'),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(source,context,{filename:'background.js'});
 return {allowed,storage,messages,tabMessages,tabs,listeners,get rules(){return rules;},get scripts(){return scripts;},
  request:(message,panel=14)=>new Promise(resolve=>listeners.message(message,{id:'fixture',frameId:0,url:panelURL,tab:{id:panel}},resolve))};
}
const session=(host,sourceTabId,scheme='https')=>({host,permissionMatch:scheme+'://'+host+'/*',sourceTabId,sourceWindowId:1,token:'token-'+host,syncEnabled:false});
(async()=>{
 const f=fixture({11:session('alpha.test',21),12:session('beta.test',22),13:session('gamma.test',23)},{11:{sourceTabId:21,sourceWindowId:1}});
 // Removing a narrower grant while an overlapping grant remains must preserve sessions/rules/scripts.
 await f.listeners.removed({origins:['https://alpha.test/*']});
 assert.equal(Object.keys(f.storage.panels).length,3);assert.equal(f.rules.length,3);assert.equal(f.scripts.length,3);assert.equal(f.tabMessages.length,0);
 f.allowed.delete('https://alpha.test/*');await f.listeners.removed({origins:['https://alpha.test/*']});
 assert(!f.storage.panels[11]);assert(f.storage.panels[12]);assert(f.storage.panels[13]);
 assert(!f.rules.some(rule=>rule.condition.tabIds.includes(11)));assert.equal(f.rules.length,2);
 assert(!f.scripts.some(script=>script.matches.includes('https://alpha.test/*')));assert.equal(f.scripts.length,2);
 assert(f.tabMessages.some(message=>message.id===21&&message.type==='source-stop'));
 assert.deepEqual(f.storage.sourceWatches[11],{sourceTabId:21,sourceWindowId:1});
 assert(f.messages.some(message=>message.type==='source-candidate'&&message.panelTabId===11&&message.state==='needs-access'));
 for(const panelTabId of [11,12,13,14])assert(f.messages.some(message=>message.type==='access-revoked'&&message.panelTabId===panelTabId));
 assert(f.messages.some(message=>message.type==='access-revoked'&&message.panelTabId===11&&message.sessionRevoked===true));
 assert(f.messages.filter(message=>message.type==='access-revoked'&&message.panelTabId!==11).every(message=>message.sessionRevoked===false));
 const staleApply=await f.request({type:'source-apply',token:'token-alpha.test',event:{kind:'click'}},11);assert.equal(staleApply.data,false);
 f.allowed.add('https://alpha.test/*');await f.listeners.added({origins:['https://alpha.test/*']});
 assert(f.messages.some(message=>message.type==='source-candidate'&&message.panelTabId===11&&message.state==='ready'));
 assert(!f.storage.panels[11],'Grant restoration must not silently recreate a terminated session');
 f.allowed.add('https://delta.test/*');const prepared=await f.request({type:'prepare',url:'https://delta.test/',compatibility:false,sync:false});
 assert.equal(prepared.ok,true);assert.equal(f.storage.panels[14].permissionMatch,'https://delta.test/*');assert.equal(f.storage.panels[14].syncEnabled,false);
 // Exact schemes are independent; wildcard legacy grants cover base host and subdomains only.
 const legacyBase={...session('alpha.test',21)};delete legacyBase.permissionMatch;
 const legacySub={...session('shop.alpha.test',22)};delete legacySub.permissionMatch;
 const legacyOther={...session('unrelated.test',23)};delete legacyOther.permissionMatch;
 const wildcard=fixture({11:legacyBase,12:legacySub,13:legacyOther,14:session('alpha.test',undefined,'http')});
 await wildcard.listeners.removed({origins:['https://*.alpha.test/*']});
 assert(!wildcard.storage.panels[11]);assert(!wildcard.storage.panels[12]);assert(wildcard.storage.panels[13]);assert(wildcard.storage.panels[14]);
 const overlapping=fixture({11:legacySub});overlapping.allowed.add('https://shop.alpha.test/*');
 await overlapping.listeners.removed({origins:['https://*.alpha.test/*']});assert(overlapping.storage.panels[11]);
 // Protocol wildcard revocation must respect whichever exact scheme remains granted.
 const both=fixture({11:session('alpha.test',21),12:session('alpha.test',22,'http')});both.allowed.delete('https://alpha.test/*');
 await both.listeners.removed({origins:['*://*.alpha.test/*']});assert(!both.storage.panels[11]);assert(both.storage.panels[12]);
 const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../extension/manifest.json'),'utf8'));
 assert.deepEqual(manifest.permissions,['activeTab','tabs','storage','scripting','declarativeNetRequestWithHostAccess']);
 assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
 console.log('PASS access revocation: exact and wildcard scopes, overlapping grants, session/token/rule/script cleanup, source-stop, watch recovery, pending panel signal, unchanged permissions');
})().catch(error=>{console.error(error);process.exitCode=1;});
