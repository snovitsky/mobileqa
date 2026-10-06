import { normalizeURL } from './devices.js';
const sessions=new Map();
const ready=chrome.storage.session.get('panels').then(({panels={}})=>{for(const [id,s]of Object.entries(panels))sessions.set(Number(id),s);});
const persist=()=>chrome.storage.session.set({panels:Object.fromEntries(sessions)});
let queue=Promise.resolve();
const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
async function cleanup(tabId){
 const rules=await chrome.declarativeNetRequest.getSessionRules();
 const ids=rules.filter(r=>r.condition.tabIds?.includes(tabId)).map(r=>r.id);
 if(ids.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:ids});
 const old=sessions.get(tabId);sessions.delete(tabId);await persist();if(old?.sourceTabId)chrome.tabs.sendMessage(old.sourceTabId,{type:'source-stop'}).catch(()=>{});
}
async function prepare(tabId,url,compatibility,sourceTabId){
 url=normalizeURL(url);const host=new URL(url).hostname,protocol=new URL(url).protocol;
 const match=protocol+'//'+host+'/*';
 if(!await chrome.permissions.contains({origins:[match]}))throw new Error('Разрешите расширению доступ к этому сайту и нажмите «Показать».');
 let sourceURL;if(sourceTabId){const tab=await chrome.tabs.get(sourceTabId);sourceURL=normalizeURL(tab.url||'');if(new URL(sourceURL).hostname!==host)throw new Error('Адрес основной вкладки изменился. Введите её текущий адрес и нажмите «Показать».');}
 // Session rule is restricted to this panel tab and chosen host, never ordinary tabs.
 await cleanup(tabId);
 if(compatibility){
  const existing=await chrome.declarativeNetRequest.getSessionRules();
  const ruleId=Math.max(0,...existing.map(r=>r.id))+1;
  await chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:ruleId,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-frame-options',operation:'remove'},{header:'content-security-policy',operation:'remove'},{header:'content-security-policy-report-only',operation:'remove'}]},condition:{tabIds:[tabId],requestDomains:[host],resourceTypes:['sub_frame']}}]});
 }
 const scripts=await chrome.scripting.getRegisteredContentScripts();
 const registered=scripts.find(s=>s.matches?.includes(match));
 if(registered){await chrome.scripting.updateContentScripts([{id:registered.id,js:['bridge.js']}]);}else{
  const id='mobile-bridge-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
  await chrome.scripting.registerContentScripts([{id,matches:[match],js:['bridge.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:false}]);
 }
 const token=crypto.randomUUID();sessions.set(tabId,{host,token,sourceTabId});await persist();if(sourceTabId){try{await chrome.scripting.executeScript({target:{tabId:sourceTabId,frameIds:[0]},files:['desktop-source.js']});await chrome.tabs.sendMessage(sourceTabId,{type:'source-config',token});}catch(e){await cleanup(tabId);throw e;}}return {token,sourceURL};
}
chrome.action.onClicked.addListener(async tab=>{
 if(tab.url?.startsWith(chrome.runtime.getURL('panel.html')))return;
 let url='';try{url=normalizeURL(tab.url||'');}catch{}
 await ready;const existing=[...sessions].find(([,s])=>s.sourceTabId===tab.id);if(existing){try{await chrome.tabs.update(existing[0],{active:true});return;}catch{await cleanup(existing[0]);}}
 await chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'?url='+encodeURIComponent(url)+'&source='+tab.id});
});
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||!sender.tab)return;
 if(msg.type==='source-hello'||msg.type==='source-event'){
  ready.then(()=>{const pair=[...sessions].find(([,s])=>s.sourceTabId===sender.tab.id&&sender.frameId===0&&new URL(sender.url).hostname===s.host);if(msg.type==='source-hello'){reply({enabled:!!pair,token:pair?.[1].token});return;}if(pair&&msg.token===pair[1].token&&['ready','route','interaction','loading','blocked','intent'].includes(msg.eventType)){chrome.runtime.sendMessage({type:'desktop-source-event',panelTabId:pair[0],token:pair[1].token,eventType:msg.eventType,payload:msg.payload}).catch(()=>{});}reply({ok:true});}).catch(()=>reply({enabled:false}));return true;
 }
 if(msg.type==='bridge-hello'){
  ready.then(()=>{const s=sessions.get(sender.tab.id),enabled=!!s&&sender.frameId>0&&new URL(sender.url).hostname===s.host;reply({enabled,token:s?.token,parentOrigin:'chrome-extension://'+chrome.runtime.id});}).catch(()=>reply({enabled:false}));return true;
 }
 if(sender.frameId!==0||!sender.url?.startsWith(chrome.runtime.getURL('panel.html')))return;
 serial(async()=>{await ready;if(msg.type==='prepare')return prepare(sender.tab.id,msg.url,!!msg.compatibility,Number.isInteger(msg.sourceTabId)&&msg.sourceTabId>0?msg.sourceTabId:undefined);if(msg.type==='resync-source'){const s=sessions.get(sender.tab.id);if(!s?.sourceTabId)throw new Error('Нет подключённой основной вкладки.');await chrome.tabs.sendMessage(s.sourceTabId,{type:'source-config',token:s.token});return true;}if(msg.type==='stop'){await cleanup(sender.tab.id);return true;}throw new Error('Неизвестная команда.');}).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;
});
chrome.tabs.onRemoved.addListener(id=>serial(async()=>{await ready;await cleanup(id);for(const [panel,s]of sessions)if(s.sourceTabId===id){chrome.runtime.sendMessage({type:'desktop-source-event',panelTabId:panel,token:s.token,eventType:'closed'}).catch(()=>{});await cleanup(panel);}}).catch(()=>{}));

chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url&&!change.url.startsWith(chrome.runtime.getURL('panel.html')))serial(async()=>{await ready;if(sessions.has(id))await cleanup(id);}).catch(()=>{});});

chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status!=='complete')return;ready.then(async()=>{for(const [panel,s]of sessions){if(s.sourceTabId!==id)continue;try{const tab=await chrome.tabs.get(id);if(new URL(tab.url).hostname!==s.host){chrome.runtime.sendMessage({type:'desktop-source-event',panelTabId:panel,token:s.token,eventType:'domain-change'}).catch(()=>{});continue;}await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},files:['desktop-source.js']});await chrome.tabs.sendMessage(id,{type:'source-config',token:s.token});}catch{}}}).catch(()=>{});});
