'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const PHASES=['PREPARED','UPLOADING','UPLOADED','SUBMITTING','PENDING_REVIEW','BOOTSTRAPPED','PUBLISHED'];
const MARKER=/^<!-- brandmaker-cws (\{[^\n]*\}) -->\n/;
function requireThat(ok,message){if(!ok)throw new Error(message);}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function versionParts(value){
 requireThat(typeof value==='string'&&/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value),'Invalid Chrome version');
 const parts=value.split('.').map(Number);requireThat(parts.every(n=>n<=65535)&&parts.some(Boolean),'Invalid Chrome version');
 return [...parts,...Array(4-parts.length).fill(0)];
}
function compareVersions(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<4;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
function validateMetadata(m){
 requireThat(m&&m.schemaVersion===1,'Invalid release metadata schema');versionParts(m.version);
 requireThat(SHA.test(m.sourceSha)&&DIGEST.test(m.zipSha256)&&DIGEST.test(m.notesSha256),'Invalid release metadata digests');
 requireThat(m.zipFile===`brandmaker-qa-${m.version}-store.zip`&&m.notesFile===`release-notes-${m.version}.md`,'Invalid release filenames');
 if(m.fromVersion===null)requireThat(m.baselineSha===null,'First release cannot have a baseline SHA');
 else {versionParts(m.fromVersion);requireThat(SHA.test(m.baselineSha)&&compareVersions(m.version,m.fromVersion)>0,'Invalid production baseline');}
 return m;
}
function readBundle(directory){
 const raw=fs.readFileSync(path.join(directory,'store-release.json')),metadata=validateMetadata(JSON.parse(raw));
 const zip=fs.readFileSync(path.join(directory,metadata.zipFile)),notes=fs.readFileSync(path.join(directory,metadata.notesFile));
 requireThat(hash(zip)===metadata.zipSha256&&hash(notes)===metadata.notesSha256,'Release artifact digest mismatch');
 return {metadata,raw,zip,notes};
}
function validateAttestation(state){
 if(state.phase==='BOOTSTRAPPED'||state.bootstrapAttestation!==undefined){
  requireThat(state.bootstrapAttestation==='operator-confirmed-exact-ci-package'&&state.bootstrapSourceSha===state.metadata.sourceSha&&state.bootstrapZipSha256===state.metadata.zipSha256,'Invalid bootstrap operator attestation');
 }
}
function decodeMarker(release){
 const match=MARKER.exec(release.body||'');requireThat(match,'Candidate has no valid release marker');
 let state;try{state=JSON.parse(match[1]);}catch{throw new Error('Invalid release marker');}
 validateMetadata(state.metadata);
 requireThat(PHASES.includes(state.phase)&&DIGEST.test(state.metadataSha256),'Invalid candidate state');
 validateAttestation(state);
 requireThat(release.tag_name===`cws-candidate/v${state.metadata.version}`&&release.target_commitish===state.metadata.sourceSha,'Candidate source mismatch');
 return state;
}
const markerBody=(state,notes)=>`<!-- brandmaker-cws ${JSON.stringify(state)} -->\n${notes}`;
function createPublisher(config,{fetch:fetchImpl=globalThis.fetch}={}){
 const {publisherId,itemId,repository,cwsToken,githubToken}=config;
 requireThat(/^[A-Za-z0-9_-]+$/.test(publisherId||'')&&/^[a-p]{32}$/.test(itemId||''),'Invalid Chrome Web Store IDs');
 requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''),'Invalid GitHub repository');
 requireThat(cwsToken&&githubToken,'Missing publication credentials');
 const item=`publishers/${publisherId}/items/${itemId}`,ghBase=`https://api.github.com/repos/${repository}`;
 async function request(url,{method='GET',body,type='application/json',allow404=false}={}){
  const github=url.startsWith(ghBase+'/')||url.startsWith(`https://uploads.github.com/repos/${repository}/`);
  requireThat(github||url.startsWith(`https://chromewebstore.googleapis.com/v2/${item}:`)||url===`https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,'Unexpected API destination');
  let response;
  try{response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${github?githubToken:cwsToken}`,Accept:github?'application/vnd.github+json':'application/json',...(github?{'X-GitHub-Api-Version':'2022-11-28'}:{}),...(body===undefined?{}:{'Content-Type':type})},...(body===undefined?{}:{body:type==='application/json'&&!Buffer.isBuffer(body)?JSON.stringify(body):body})});}
  catch{throw new Error(`${github?'GitHub':'CWS'} ${method} result unknown; reconcile remote state before retrying`);}
  if(allow404&&response.status===404)return null;
  requireThat(response.ok,`${github?'GitHub':'CWS'} ${method} failed (HTTP ${response.status}); inspect dashboard`);
  try{return await response.json();}catch{throw new Error(`${github?'GitHub':'CWS'} ${method} returned invalid JSON; reconcile before retrying`);}
 }
 const gh=(route,options)=>request(ghBase+route,options);
 function identity(result){requireThat(result.itemId===itemId&&result.name===item,'CWS item identity mismatch');return result;}
 async function status(){return identity(await request(`https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`));}
 function safeStatus(s){
  requireThat(!s.takenDown&&!s.warned,'CWS policy warning or takedown requires manual intervention');
  const state=s.submittedItemRevisionStatus?.state;
  requireThat(!['REJECTED','CANCELLED'].includes(state),'CWS submission rejected/cancelled; manual intervention required');
 }
 function publishedVersion(s){
  const revision=s.publishedItemRevisionStatus;if(!revision)return null;
  requireThat(revision.state==='PUBLISHED','Store production revision is not fully published');
  const channels=revision.distributionChannels||[];
  requireThat(channels.length===1&&channels[0].deployPercentage===100,'Store rollout must be one channel at 100 percent');
  versionParts(channels[0].crxVersion);return channels[0].crxVersion;
 }
 function submittedVersion(s){
  const revision=s.submittedItemRevisionStatus;
  if(!revision||!['PENDING_REVIEW','STAGED','PUBLISHED_TO_TESTERS'].includes(revision.state))return null;
  const channels=revision.distributionChannels||[];
  requireThat(channels.length===1&&typeof channels[0].crxVersion==='string','Cannot identify pending Store version');
  return channels[0].crxVersion;
 }
 async function pages(route){
  const all=[];for(let page=1;page<=20;page++){
   const batch=await gh(`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`);
   requireThat(Array.isArray(batch),'Invalid GitHub list response');all.push(...batch);if(batch.length<100)return all;
  }throw new Error('GitHub pagination limit reached; refusing incomplete release state');
 }
 async function candidates(){
  const releases=await pages('/releases');
  const pending=releases.filter(r=>r.draft&&r.tag_name?.startsWith('cws-candidate/'));
  requireThat(pending.length<=1,'Multiple pending Store releases require manual reconciliation');return pending;
 }
 async function tag(version){
  const result=await gh(`/git/ref/tags/prod/v${version}`,{allow404:true});
  if(result)requireThat(result.object?.type==='commit'&&SHA.test(result.object.sha),'Production tag must be a lightweight commit reference');
  return result?.object.sha||null;
 }
 async function baseline(m,s){
  requireThat(publishedVersion(s)===m.fromVersion,'Production version changed; regenerate aggregate release notes');
  if(m.fromVersion!==null)requireThat(await tag(m.fromVersion)===m.baselineSha,'Production baseline tag mismatch');
 }
 async function verifySource(m){const commit=await gh(`/git/commits/${m.sourceSha}`);requireThat(commit.sha===m.sourceSha,'Release source commit is unavailable');}
 async function verifiedAssets(release,state){
  validateAttestation(state);
  const assets=await pages(`/releases/${release.id}/assets`),m=state.metadata;
  const expected=new Map([[m.zipFile,m.zipSha256],[m.notesFile,m.notesSha256],['store-release.json',state.metadataSha256]]);
  requireThat(assets.length===expected.size,'Candidate assets incomplete or unexpected; manual reconciliation required');
  for(const asset of assets){requireThat(expected.has(asset.name)&&asset.state==='uploaded'&&asset.digest===`sha256:${expected.get(asset.name)}`,'Candidate asset digest mismatch');expected.delete(asset.name);}
  requireThat(expected.size===0,'Candidate assets missing');await verifySource(m);
 }
 async function phase(release,state,next){
  state={...state,phase:next};
  const text=(release.body||'').replace(MARKER,'');
  const updated=await gh(`/releases/${release.id}`,{method:'PATCH',body:{body:markerBody(state,text)}});
  requireThat(updated.id===release.id&&decodeMarker(updated).phase===next,'Candidate phase was not persisted');return {release:updated,state};
 }
 async function finalize(release,state,s){
  const m=state.metadata;requireThat(publishedVersion(s)===m.version,'Target is not published in Store');
  requireThat(state.phase!=='PREPARED','Store publication has no recorded package upload; explicit bootstrap required');
  await verifiedAssets(release,state);
  const existing=await tag(m.version);requireThat(!existing||existing===m.sourceSha,'Immutable production tag conflict');
  if(!existing){const created=await gh('/git/refs',{method:'POST',body:{ref:`refs/tags/prod/v${m.version}`,sha:m.sourceSha}});requireThat(created.object?.sha===m.sourceSha,'Production tag creation not confirmed');}
  ({release,state}=await phase(release,state,'PUBLISHED'));
  const result=await gh(`/releases/${release.id}`,{method:'PATCH',body:{tag_name:`prod/v${m.version}`,target_commitish:m.sourceSha,name:`Brandmaker QA ${m.version}`,draft:false,prerelease:false,make_latest:'true',body:markerBody(state,(release.body||'').replace(MARKER,''))}});
  requireThat(result.id===release.id&&!result.draft&&result.tag_name===`prod/v${m.version}`,'GitHub production release not confirmed');
  return {state:'PUBLISHED',version:m.version};
 }
 async function reconcile(release,s){
  const state=decodeMarker(release);safeStatus(s);await verifiedAssets(release,state);
  if(publishedVersion(s)===state.metadata.version)return finalize(release,state,s);
  await baseline(state.metadata,s);
  const pending=submittedVersion(s);
  if(pending){
   requireThat(pending===state.metadata.version,'Different Store submission blocks this release');
   requireThat(s.submittedItemRevisionStatus.state==='PENDING_REVIEW','Store submission requires manual release action');
   if(state.phase!=='PENDING_REVIEW')await phase(release,state,'PENDING_REVIEW');
   return {state:'PENDING_REVIEW',version:pending};
  }
  if(['UPLOADING','SUBMITTING','PENDING_REVIEW','PUBLISHED'].includes(state.phase))throw new Error(`Candidate ${state.phase} has no matching Store proof; manual reconciliation required`);
  return {state:state.phase,version:state.metadata.version};
 }
 function checkedBundle(bundle){
  const m=validateMetadata(bundle.metadata);requireThat(hash(bundle.zip)===m.zipSha256&&hash(bundle.notes)===m.notesSha256,'Release artifact digest mismatch');
  requireThat(JSON.stringify(JSON.parse(bundle.raw))===JSON.stringify(m),'Metadata bytes differ from candidate metadata');return m;
 }
 async function alreadyPublished(bundle){
  const m=bundle.metadata,previous=await gh(`/releases/tags/prod/v${m.version}`,{allow404:true});
  requireThat(previous&&!previous.draft&&previous.tag_name===`prod/v${m.version}`,'Published Store version has no verified GitHub provenance; explicit bootstrap required');
  const match=MARKER.exec(previous.body||'');requireThat(match,'Published release provenance marker missing');
  let prior;try{prior=JSON.parse(match[1]);}catch{throw new Error('Published release provenance invalid');}
  validateMetadata(prior.metadata);
  requireThat(prior.phase==='PUBLISHED'&&DIGEST.test(prior.metadataSha256)&&prior.metadata.version===m.version&&previous.target_commitish===prior.metadata.sourceSha,'Published release provenance invalid');
  await verifiedAssets(previous,prior);
  requireThat(await tag(m.version)===prior.metadata.sourceSha,'Published production tag mismatch');
  requireThat(m.zipSha256===prior.metadata.zipSha256&&m.notesSha256===prior.metadata.notesSha256,'Published version bytes changed; increase the extension version');
  return {state:'SKIPPED_ALREADY_PUBLISHED',version:m.version};
 }
 async function createCandidate(bundle,state){
  const m=bundle.metadata;
  const release=await gh('/releases',{method:'POST',body:{tag_name:`cws-candidate/v${m.version}`,target_commitish:m.sourceSha,name:`Store candidate ${m.version}`,draft:true,prerelease:false,body:markerBody(state,bundle.notes.toString('utf8'))}});
  requireThat(Number.isSafeInteger(release.id)&&release.draft,'Draft release creation not confirmed');decodeMarker(release);
  for(const [name,bytes,type] of [[m.zipFile,bundle.zip,'application/zip'],[m.notesFile,bundle.notes,'text/markdown'],['store-release.json',bundle.raw,'application/json']]){
   const asset=await request(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,{method:'POST',body:bytes,type});
   requireThat(asset.name===name&&asset.digest===`sha256:${hash(bytes)}`&&asset.state==='uploaded','Uploaded release asset digest mismatch');
  }
  await verifiedAssets(release,state);return release;
 }
 async function submit(bundle){
  const m=checkedBundle(bundle);
  let s=await status();safeStatus(s);
  const pending=await candidates();let release,state;
  if(pending.length){
   release=pending[0];state=decodeMarker(release);
   requireThat(JSON.stringify(state.metadata)===JSON.stringify(m)&&state.metadataSha256===hash(bundle.raw),'A different release is already pending');
   const result=await reconcile(release,s);if(result.state!=='PREPARED'&&result.state!=='UPLOADED')return result;
  }else{
   if(publishedVersion(s)===m.version)return alreadyPublished(bundle);
   await baseline(m,s);requireThat(!submittedVersion(s),'Existing Store submission blocks upload');
   requireThat(!s.lastAsyncUploadState||s.lastAsyncUploadState==='NOT_FOUND'||s.lastAsyncUploadState==='SUCCEEDED','Async Store upload requires manual reconciliation');
   await verifySource(m);state={phase:'PREPARED',metadata:m,metadataSha256:hash(bundle.raw)};
   release=await createCandidate(bundle,state);
  }
  // Re-read before every CWS mutation; persisted phases prevent blind retries after timeouts.
  s=await status();safeStatus(s);await baseline(m,s);requireThat(!submittedVersion(s),'A submission appeared before upload');
  requireThat(!s.lastAsyncUploadState||s.lastAsyncUploadState==='NOT_FOUND'||s.lastAsyncUploadState==='SUCCEEDED','Async upload blocks submission');
  if(state.phase==='PREPARED'){
   ({release,state}=await phase(release,state,'UPLOADING'));
   const upload=identity(await request(`https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,{method:'POST',body:bundle.zip,type:'application/zip'}));
   requireThat(upload.uploadState==='SUCCEEDED'&&upload.crxVersion===m.version,'Upload did not confirm exact target version; manual reconciliation required');
   ({release,state}=await phase(release,state,'UPLOADED'));
  }
  s=await status();safeStatus(s);await baseline(m,s);requireThat(!submittedVersion(s),'A submission appeared before publish');
  requireThat(s.lastAsyncUploadState!=='IN_PROGRESS'&&s.lastAsyncUploadState!=='FAILED','Upload not ready for publish');
  ({release,state}=await phase(release,state,'SUBMITTING'));
  const result=identity(await request(`https://chromewebstore.googleapis.com/v2/${item}:publish`,{method:'POST',body:{publishType:'DEFAULT_PUBLISH',skipReview:false,blockOnWarnings:true,deployInfos:[{deployPercentage:100}]}}));
  requireThat(!result.warningInfo?.warnings?.length&&['PENDING_REVIEW','PUBLISHED'].includes(result.state),'Store did not accept automatic publication without warnings');
  return reconcile(release,await status());
 }
 async function monitor(){
  const pending=await candidates();if(!pending.length)return {state:'NO_PENDING_RELEASE'};
  return reconcile(pending[0],await status());
 }
 async function inspect(){
  const s=await status();
  function state(value){if(value===undefined||value===null)return null;requireThat(typeof value==='string'&&/^[A-Z][A-Z_]{0,63}$/.test(value),'Invalid Store status state');return value;}
  function revisionVersion(revision){
   if(!revision?.distributionChannels)return null;
   requireThat(Array.isArray(revision.distributionChannels),'Invalid Store status channels');
   const versions=revision.distributionChannels.map(channel=>{versionParts(channel.crxVersion);return channel.crxVersion;});
   return versions.length&&versions.every(version=>version===versions[0])?versions[0]:null;
  }
  for(const flag of ['warned','takenDown'])requireThat(s[flag]===undefined||typeof s[flag]==='boolean','Invalid Store policy flag');
  const publishedState=state(s.publishedItemRevisionStatus?.state),submittedState=state(s.submittedItemRevisionStatus?.state);
  return {state:'STORE_STATUS',itemId,publishedVersion:publishedState==='PUBLISHED'?revisionVersion(s.publishedItemRevisionStatus):null,publishedState,submittedState,submittedVersion:revisionVersion(s.submittedItemRevisionStatus),warned:s.warned===true,takenDown:s.takenDown===true,lastAsyncUploadState:state(s.lastAsyncUploadState)};
 }
 async function bootstrap(bundle,{confirmed=false}={}){
  requireThat(confirmed===true,'Bootstrap requires explicit operator confirmation of the exact CI package');
  const m=checkedBundle(bundle);requireThat(m.fromVersion===null&&m.baselineSha===null,'Bootstrap is only for first production initialization');
  let s=await status();safeStatus(s);
  requireThat(publishedVersion(s)===m.version,'Bootstrap requires exact target already PUBLISHED at 100 percent');
  requireThat(!submittedVersion(s),'Existing Store submission blocks bootstrap');
  requireThat(s.lastAsyncUploadState!=='IN_PROGRESS'&&s.lastAsyncUploadState!=='FAILED','Async Store upload blocks bootstrap');
  requireThat((await candidates()).length===0,'Existing candidate blocks bootstrap; reconcile it explicitly');
  const existing=await gh(`/releases/tags/prod/v${m.version}`,{allow404:true});if(existing)return alreadyPublished(bundle);
  const releases=await pages('/releases');requireThat(!releases.some(r=>r.tag_name?.startsWith('prod/')),'Bootstrap cannot replace existing production history');
  await verifySource(m);
  const state={phase:'BOOTSTRAPPED',metadata:m,metadataSha256:hash(bundle.raw),bootstrapAttestation:'operator-confirmed-exact-ci-package',bootstrapSourceSha:m.sourceSha,bootstrapZipSha256:m.zipSha256};
  const release=await createCandidate(bundle,state);
  // CWS cannot supply the package digest: this is deliberately an operator attestation, not API proof of ZIP bytes.
  s=await status();safeStatus(s);requireThat(!submittedVersion(s),'A Store submission appeared during bootstrap');
  return finalize(release,state,s);
 }
 return {submit,monitor,bootstrap,inspect};
}
async function hasPendingRelease(repository,token,fetchImpl=globalThis.fetch){
 requireThat(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')&&token,'Missing GitHub probe configuration');
 let found=false;
 for(let page=1;page<=20;page++){
  let response;try{response=await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,{redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});}catch{throw new Error('GitHub pending probe failed');}
  requireThat(response.ok,`GitHub pending probe failed (HTTP ${response.status})`);
  let batch;try{batch=await response.json();}catch{throw new Error('Invalid GitHub probe response');}
  requireThat(Array.isArray(batch),'Invalid GitHub release list');
  found=found||batch.some(r=>r.draft&&r.tag_name?.startsWith('cws-candidate/'));
  if(batch.length<100)return found;
 }throw new Error('GitHub pagination limit reached; pending state unknown');
}
function workflowSourceSha(env){const sha=env.CWS_SOURCE_SHA||env.GITHUB_SHA;requireThat(SHA.test(sha||''),'Missing valid workflow source SHA');return sha;}
async function cli(env=process.env,command=process.argv[2],{activationState}={}){
 requireThat(['submit','monitor','pending','bootstrap','status'].includes(command),'Usage: node scripts/store-publish.cjs submit|monitor|pending|bootstrap|status');
 if(command==='pending'){
  const pending=await hasPendingRelease(env.GITHUB_REPOSITORY,env.GH_TOKEN);
  if(env.GITHUB_OUTPUT)fs.appendFileSync(env.GITHUB_OUTPUT,`pending=${pending}\n`);
  console.log(`pending=${pending}`);return {pending};
 }
 requireThat(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REF==='refs/heads/main','Store mutations require GitHub Actions on main');
 if(command==='submit'||command==='monitor'){
  const activation=require('./store-workflow-check.cjs').activationEnabled(activationState??JSON.parse(fs.readFileSync(path.resolve(__dirname,'../store/release-state.json'),'utf8')));
  requireThat(activation,'Store automation is deferred by owner; activation requires a separately approved change');
 }
 if(command==='bootstrap')requireThat(env.CWS_BOOTSTRAP_CONFIRMED==='true','Bootstrap requires CWS_BOOTSTRAP_CONFIRMED=true');
 const publisher=createPublisher({publisherId:env.CWS_PUBLISHER_ID,itemId:env.CWS_ITEM_ID,repository:env.GITHUB_REPOSITORY,cwsToken:env.CWS_ACCESS_TOKEN,githubToken:env.GH_TOKEN});
 let result;if(command==='submit'||command==='bootstrap'){
  const bundle=readBundle(path.resolve(__dirname,'../dist'));requireThat(bundle.metadata.sourceSha===workflowSourceSha(env),'Workflow source SHA differs from release artifact');result=command==='bootstrap'?await publisher.bootstrap(bundle,{confirmed:true}):await publisher.submit(bundle);
 }else result=command==='status'?await publisher.inspect():await publisher.monitor();
 console.log(JSON.stringify(result));return result;
}
if(require.main===module)cli().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={hash,compareVersions,validateMetadata,readBundle,decodeMarker,markerBody,createPublisher,hasPendingRelease,workflowSourceSha,cli};
