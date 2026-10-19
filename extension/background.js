import { normalizeURL } from './devices.js';
import { ERROR_MESSAGES, userError, userMessage } from './errors.js';
const sessions=new Map(),watches=new Map(),candidates=new Map();
const panelURL=chrome.runtime.getURL('panel.html');
const ready=chrome.storage.session.get(['panels','sourceWatches']).then(({panels={},sourceWatches={}})=>{
 for(const [id,s]of Object.entries(panels))sessions.set(Number(id),s);
 for(const [id,w]of Object.entries(sourceWatches))watches.set(Number(id),w);
});
const persist=()=>chrome.storage.session.set({panels:Object.fromEntries(sessions),sourceWatches:Object.fromEntries(watches)});
let queue=Promise.resolve();
const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
const positive=id=>Number.isSafeInteger(id)&&id>0;
const isPanel=tab=>tab.url?.startsWith(panelURL);
async function describeSource(tab,sourceWindowId){
 if(!tab)return {state:'unavailable',sourceWindowId};
 const base={sourceTabId:tab.id,sourceWindowId:tab.windowId};
 const address=tab.pendingUrl||tab.url;
 if(!address)return {...base,state:'unknown-url'};
 let url;try{url=new URL(address);}catch{return {...base,state:'unsupported'};}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {...base,state:'unsupported'};
 const allowed=await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']});
 return {...base,state:allowed?(tab.status==='loading'?'loading':'ready'):'needs-access',sourceURL:url.href,host:url.hostname};
}
async function resolveSource(request={},panelTabId){
 let original;try{if(positive(request.sourceTabId))original=await chrome.tabs.get(request.sourceTabId);}catch{}
 let windowId=positive(request.sourceWindowId)?request.sourceWindowId:original?.windowId;
 if(!positive(windowId)){
  try{const window=await chrome.windows.getLastFocused({windowTypes:['normal']});if(window?.type==='normal')windowId=window.id;}catch{}
 }
 if(!positive(windowId))return {state:'unavailable'};
 let window;try{window=await chrome.windows.get(windowId);}catch{
  if(original||watches.has(panelTabId))return {state:'unavailable',sourceWindowId:windowId};
  try{window=await chrome.windows.getLastFocused({windowTypes:['normal']});windowId=window.id;}catch{return {state:'unavailable',sourceWindowId:windowId};}
 }
 if(window.type!=='normal')return {state:'unavailable',sourceWindowId:windowId};
 const [active]=await chrome.tabs.query({active:true,windowId});
 // A panel can live in its source window. Focusing it must not replace the site source.
 if(active&&(active.id===panelTabId||isPanel(active))){
  if(original?.windowId===windowId&&original.id!==panelTabId&&!isPanel(original))return describeSource(original,windowId);
  // A restored panel can contain IDs from a previous browser session. Recover only in this window.
  const websites=(await chrome.tabs.query({windowId})).filter(tab=>tab.id!==panelTabId&&!isPanel(tab)&&/^https?:\/\//.test(tab.pendingUrl||tab.url||''));
  websites.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0)||Math.abs((active.index||0)-a.index)-Math.abs((active.index||0)-b.index));
  if(websites.length)return describeSource(websites[0],windowId);
  return {state:'unavailable',sourceWindowId:windowId};
 }
 return describeSource(active,windowId);
}
async function notifyCandidate(panelTabId){
 const watch=watches.get(panelTabId);if(!watch)return;
 const result=await resolveSource(watch,panelTabId);
 if(result.sourceWindowId)watch.sourceWindowId=result.sourceWindowId;
 if(result.sourceTabId)watch.sourceTabId=result.sourceTabId;
 const fingerprint=JSON.stringify(result);if(candidates.get(panelTabId)===fingerprint)return;
 candidates.set(panelTabId,fingerprint);await persist();
 await chrome.runtime.sendMessage({type:'source-candidate',panelTabId,...result}).catch(()=>{});
}
async function refreshWatches(windowId){for(const [panel,w]of watches)if(!windowId||w.sourceWindowId===windowId)await notifyCandidate(panel);}
async function sourceTab(id,host){
 let tab;try{tab=await chrome.tabs.get(id);}catch{throw userError('sourceUnavailable');}
 if(!tab.url)throw userError('sourceUnavailable');
 let url;try{url=new URL(tab.url);}catch{throw userError('sourceNotWebsite');}
 if(!['http:','https:'].includes(url.protocol))throw userError('sourceNotWebsite');
 if(url.hostname!==host)throw userError('sourceDifferentSite');
 return tab;
}
async function stopUnusedSource(id){
 if(!id)return;
 const remaining=[...sessions.values()].reverse().find(s=>s.sourceTabId===id);
 await chrome.tabs.sendMessage(id,remaining?{type:'source-config',token:remaining.token}:{type:'source-stop'}).catch(()=>{});
}
async function cleanup(tabId,removeWatch=false){
 const rules=await chrome.declarativeNetRequest.getSessionRules();
 const ids=rules.filter(r=>r.condition.tabIds?.includes(tabId)).map(r=>r.id);
 if(ids.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:ids});
 const old=sessions.get(tabId);sessions.delete(tabId);
 if(removeWatch){watches.delete(tabId);candidates.delete(tabId);}
 await persist();await stopUnusedSource(old?.sourceTabId);
}
function removedPermissionMatchesHost(pattern,host){
 if(pattern==='<all_urls>')return true;
 const parts=/^(?:https?|\*):\/\/([^/]+)\//i.exec(pattern);if(!parts)return false;
 const scope=parts[1].toLowerCase();host=host.toLowerCase();
 return scope==='*'||scope===host||(scope.startsWith('*.')&&(host===scope.slice(2)||host.endsWith('.'+scope.slice(2))));
}
async function sessionLostAccess(session,origins){
 if(session.permissionMatch)return !await chrome.permissions.contains({origins:[session.permissionMatch]});
 // У старой сессии неизвестна схема: учитываем только подходящий отзыв и оставшиеся grants.
 for(const pattern of origins){
  if(!removedPermissionMatchesHost(pattern,session.host))continue;
  const scheme=/^(https?):/.exec(pattern)?.[1];
  for(const protocol of scheme?[scheme]:['http','https'])if(!await chrome.permissions.contains({origins:[protocol+'://'+session.host+'/*']}))return true;
 }
 return false;
}
chrome.permissions.onRemoved.addListener(permission=>serial(async()=>{
 await ready;const origins=permission.origins||[];if(!origins.length)return;
 const revoked=[];for(const [panel,session]of sessions)if(await sessionLostAccess(session,origins))revoked.push(panel);
 for(const panel of revoked)await cleanup(panel);
 // Удаляем регистрации, потерявшие доступ, в том числе после отзыва через настройки Chrome.
 const scripts=await chrome.scripting.getRegisteredContentScripts(),remove=[];
 for(const script of scripts){
  if(!script.js?.some(file=>['bridge.js','desktop-source.js'].includes(file)))continue;
  if((await Promise.all((script.matches||[]).map(match=>chrome.permissions.contains({origins:[match]})))).some(allowed=>!allowed))remove.push(script.id);
 }
 if(remove.length)await chrome.scripting.unregisterContentScripts({ids:remove});
 // Не затрагиваем панели, чьи сессии всё ещё покрываются оставшимися разрешениями.
 const panelIds=new Set([...revoked,...(await chrome.tabs.query({})).filter(isPanel).map(tab=>tab.id)]);
 for(const panelTabId of panelIds)await chrome.runtime.sendMessage({type:'access-revoked',panelTabId,origins,sessionRevoked:revoked.includes(panelTabId)}).catch(()=>{});
 await refreshWatches();
}).catch(()=>{}));
chrome.permissions.onAdded.addListener(()=>serial(async()=>{await ready;await refreshWatches();}).catch(()=>{}));
async function prepare(tabId,url,compatibility,sourceTabId,syncEnabled=true,sourceWindowId){
 url=normalizeURL(url);const parsed=new URL(url),host=parsed.hostname,match=parsed.protocol+'//'+host+'/*';
 if(!await chrome.permissions.contains({origins:[match]}))throw userError('accessDenied');
 let sourceURL;if(sourceTabId){const tab=await sourceTab(sourceTabId,host);sourceURL=tab.url;sourceWindowId=tab.windowId;}
 const scripts=await chrome.scripting.getRegisteredContentScripts(),registered=scripts.find(s=>s.matches?.includes(match));
 if(registered)await chrome.scripting.updateContentScripts([{id:registered.id,js:['bridge.js','desktop-source.js']}]);
 else await chrome.scripting.registerContentScripts([{id:'mobile-bridge-'+Date.now()+'-'+Math.floor(Math.random()*1e6),matches:[match],js:['bridge.js','desktop-source.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:false}]);
 // Validate injection before replacing the previous usable session or frame rules.
 if(sourceTabId)try{await chrome.scripting.executeScript({target:{tabId:sourceTabId,frameIds:[0]},files:['desktop-source.js']});}catch{throw userError('sourceConnectFailed');}
 const existing=await chrome.declarativeNetRequest.getSessionRules(),oldRules=existing.filter(r=>r.condition.tabIds?.includes(tabId));
 const rules=compatibility?[{id:Math.max(0,...existing.map(r=>r.id))+1,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-frame-options',operation:'remove'},{header:'content-security-policy',operation:'remove'},{header:'content-security-policy-report-only',operation:'remove'}]},condition:{tabIds:[tabId],requestDomains:[host],resourceTypes:['sub_frame']}}]:[];
 const old=sessions.get(tabId),token=crypto.randomUUID();
 await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:oldRules.map(r=>r.id),addRules:rules});
 sessions.set(tabId,{host,permissionMatch:match,token,sourceTabId,sourceWindowId,syncEnabled});
 try{
  await persist();
  if(sourceTabId)await chrome.tabs.sendMessage(sourceTabId,{type:'source-config',token});
 }catch{
  if(old)sessions.set(tabId,old);else sessions.delete(tabId);
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(r=>r.id),addRules:oldRules});await persist();
  if(old?.sourceTabId)await chrome.tabs.sendMessage(old.sourceTabId,{type:'source-config',token:old.token}).catch(()=>{});
  await stopUnusedSource(sourceTabId);throw userError('sourceConnectFailed');
 }
 if(old?.sourceTabId!==sourceTabId)await stopUnusedSource(old?.sourceTabId);
 return {protocolVersion:1,token,sourceTabId,sourceWindowId,sourceURL};
}
chrome.action.onClicked.addListener(tab=>serial(async()=>{
 if(isPanel(tab))return;
 let url='';try{url=normalizeURL(tab.url||'');}catch{}
 await ready;const existing=[...sessions].find(([,s])=>s.sourceTabId===tab.id);
 if(existing){try{const panel=await chrome.tabs.update(existing[0],{active:true});await chrome.windows.update(panel.windowId,{focused:true});return;}catch{await cleanup(existing[0],true);}}
 await chrome.tabs.create({url:panelURL+'?url='+encodeURIComponent(url)+'&source='+tab.id+'&sourceWindow='+tab.windowId});
}).catch(()=>{}));
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||!sender.tab)return;
 if(msg.type==='source-hello'||msg.type==='source-event'){
  ready.then(()=>{const pair=[...sessions].reverse().find(([panel,s])=>s.sourceTabId===sender.tab.id&&sender.frameId===0&&new URL(sender.url).hostname===s.host&&(!watches.has(panel)||watches.get(panel).sourceTabId===sender.tab.id)&&(msg.type==='source-hello'||msg.token===s.token));if(msg.type==='source-hello'){reply({enabled:!!pair,token:pair?.[1].token});return;}if(pair&&msg.token===pair[1].token&&['ready','route','interaction','loading','blocked','intent','missing','sync-ack'].includes(msg.eventType)){chrome.runtime.sendMessage({type:'desktop-source-event',panelTabId:pair[0],token:pair[1].token,eventType:msg.eventType,payload:msg.payload}).catch(()=>{});}reply({ok:true});}).catch(()=>reply({enabled:false}));return true;
 }
 if(msg.type==='bridge-hello'){
  ready.then(()=>{const s=sessions.get(sender.tab.id),enabled=!!s&&sender.frameId>0&&new URL(sender.url).hostname===s.host;reply({enabled,token:s?.token,parentOrigin:'chrome-extension://'+chrome.runtime.id});}).catch(()=>reply({enabled:false}));return true;
 }
 if(sender.frameId!==0||!sender.url?.startsWith(panelURL))return;
 const fallback=msg.type==='prepare'?'startFailed':msg.type==='stop'?'stopFailed':['set-sync','source-apply','source-navigate','resync-source'].includes(msg.type)?'syncFailed':'operationFailed';
 serial(async()=>{
  await ready;const panel=sender.tab.id;
  if(msg.type==='resolve-source')return {...await resolveSource(msg,panel),protocolVersion:1};
  if(msg.type==='watch-source'){
   if(!msg.enabled){watches.delete(panel);candidates.delete(panel);await persist();return true;}
   const result=await resolveSource(msg,panel);
   watches.set(panel,{sourceTabId:result.sourceTabId||msg.sourceTabId,sourceWindowId:result.sourceWindowId});
   candidates.delete(panel);await persist();await notifyCandidate(panel);return result;
  }
  if(msg.type==='source-open'){
   const result=await resolveSource({...watches.get(panel),...msg},panel);
   if(result.sourceTabId&&!['unavailable','unsupported'].includes(result.state)){
    try{await chrome.tabs.update(result.sourceTabId,{active:true});await chrome.windows.update(result.sourceWindowId,{focused:true});}catch{return {state:'unavailable',sourceWindowId:result.sourceWindowId};}
   }
   return result;
  }
  if(msg.type==='navigate-source'){
   const url=normalizeURL(msg.url),parsed=new URL(url);
   if(!await chrome.permissions.contains({origins:[parsed.protocol+'//'+parsed.hostname+'/*']}))throw userError('accessDenied');
   const result=await resolveSource({...watches.get(panel),...msg},panel);
   if(!result.sourceTabId||['unavailable','unsupported'].includes(result.state))return result;
   if(result.sourceURL===url)return result;
   try{await chrome.tabs.update(result.sourceTabId,{url});}catch{return {state:'unavailable',sourceWindowId:result.sourceWindowId};}
   return {...result,state:'loading',sourceURL:url,host:parsed.hostname};
  }
  if(msg.type==='prepare')return prepare(panel,msg.url,!!msg.compatibility,positive(msg.sourceTabId)?msg.sourceTabId:undefined,msg.sync!==false,msg.sourceWindowId);
  if(msg.type==='set-sync'){
   const s=sessions.get(panel);if(!s)throw userError('sessionNotConnected');s.syncEnabled=!!msg.enabled;await persist();return true;
  }
  if(msg.type==='source-apply'||msg.type==='source-navigate'){
   const s=sessions.get(panel);if(!s||s.token!==msg.token||!s.sourceTabId||(msg.type==='source-apply'&&s.syncEnabled===false))return false;
   if(watches.has(panel)&&watches.get(panel).sourceTabId!==s.sourceTabId)return false;
   const tab=await sourceTab(s.sourceTabId,s.host);
   if(msg.type==='source-navigate'){
    const url=normalizeURL(msg.url);if(new URL(url).hostname!==s.host)throw userError('sourceDifferentSite');
    if(tab.url!==url)try{await chrome.tabs.update(s.sourceTabId,{url});}catch{throw userError('sourceUnavailable');}
   }else try{await chrome.tabs.sendMessage(s.sourceTabId,{type:'source-apply',token:s.token,event:msg.event});}catch{throw userError('sourceConnectFailed');}
   return true;
  }
  if(msg.type==='resync-source'){
   const s=sessions.get(panel);if(!s?.sourceTabId)throw userError('sourceNotConnected');await sourceTab(s.sourceTabId,s.host);
   try{await chrome.tabs.sendMessage(s.sourceTabId,{type:'source-config',token:s.token});}catch{throw userError('sourceConnectFailed');}return true;
  }
  if(msg.type==='stop'){await cleanup(panel);return true;}
  throw userError('operationFailed');
 }).then(data=>reply({ok:true,data}),e=>{const safe=userError(Object.hasOwn(ERROR_MESSAGES,e?.code)?e.code:fallback);reply({ok:false,error:userMessage(safe),code:safe.code});});return true;
});
chrome.tabs.onActivated.addListener(({windowId})=>serial(async()=>{await ready;await refreshWatches(windowId);}).catch(()=>{}));
chrome.tabs.onRemoved.addListener(id=>serial(async()=>{
 await ready;await cleanup(id,true);
 for(const s of sessions.values())if(s.sourceTabId===id)delete s.sourceTabId;
 await persist();await refreshWatches();
}).catch(()=>{}));
chrome.tabs.onUpdated.addListener((id,change)=>serial(async()=>{
 await ready;
 if(change.url&&!change.url.startsWith(panelURL)&&sessions.has(id))await cleanup(id,true);
 if(change.url||change.status==='complete')await refreshWatches();
 if(change.status!=='complete')return;
 for(const [panel,s]of sessions){
  if(s.sourceTabId!==id)continue;
  try{
   const tab=await chrome.tabs.get(id);
   if(new URL(tab.url).hostname!==s.host){if(watches.has(panel))await notifyCandidate(panel);continue;}
   await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},files:['desktop-source.js']});
   await chrome.tabs.sendMessage(id,{type:'source-config',token:s.token});
  }catch{}
 }
}).catch(()=>{}));
