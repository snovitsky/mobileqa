'use strict';
const assert=require('node:assert/strict');
const {hash,compareVersions,validateMetadata,decodeMarker,createPublisher,hasPendingRelease,workflowSourceSha,cli}=require('../scripts/store-publish.cjs');
const SOURCE='a'.repeat(40),BASE='b'.repeat(40),ITEM='a'.repeat(32),NAME=`publishers/test/items/${ITEM}`;
const clone=value=>structuredClone(value);
function bundle(fromVersion=null){
 const zip=Buffer.from('fixture ZIP bytes'),notes=Buffer.from('# Новые возможности\n\n- Удобнее выбирать сайт.\n');
 const metadata={schemaVersion:1,version:'2.7.1',fromVersion,baselineSha:fromVersion?BASE:null,sourceSha:SOURCE,zipFile:'brandmaker-qa-2.7.1-store.zip',zipSha256:hash(zip),notesFile:'release-notes-2.7.1.md',notesSha256:hash(notes)};
 return {metadata,raw:Buffer.from(JSON.stringify(metadata)+'\n'),zip,notes};
}
function fixture({baseline=null}={}){
 const f={calls:[],releases:[],assets:[],tags:baseline?{[`prod/v${baseline}`]:BASE}:{},status:{name:NAME,itemId:ITEM,lastAsyncUploadState:'NOT_FOUND'},uploadVersion:'2.7.1',uploadState:'SUCCEEDED',fail:null};
 if(baseline)f.status.publishedItemRevisionStatus={state:'PUBLISHED',distributionChannels:[{crxVersion:baseline,deployPercentage:100}]};
 const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(value)});
 f.fetch=async(url,options={})=>{
  const method=options.method||'GET',u=new URL(url);f.calls.push({url,method,options});
  assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  if(f.fail){const failure=f.fail(url,options);if(failure)return failure;}
  let body=options.body;if(typeof body==='string')body=JSON.parse(body);
  if(u.hostname==='chromewebstore.googleapis.com'){
   assert.equal(options.headers.Authorization,'Bearer fake-cws');
   if(u.pathname.endsWith(':fetchStatus'))return response(f.status);
   if(u.pathname.endsWith(':upload')){assert(Buffer.isBuffer(body));return response({name:NAME,itemId:ITEM,crxVersion:f.uploadVersion,uploadState:f.uploadState});}
   if(u.pathname.endsWith(':publish')){
    assert.deepEqual(body,{publishType:'DEFAULT_PUBLISH',skipReview:false,blockOnWarnings:true,deployInfos:[{deployPercentage:100}]});
    f.status.submittedItemRevisionStatus={state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'2.7.1',deployPercentage:100}]};
    return response({name:NAME,itemId:ITEM,state:'PENDING_REVIEW'});
   }
  }
  assert.equal(options.headers.Authorization,'Bearer fake-github');
  if(u.hostname==='uploads.github.com'){
   assert(Buffer.isBuffer(body),'Assets must be uploaded as exact bytes, including JSON metadata');
   const asset={id:f.assets.length+1,name:u.searchParams.get('name'),state:'uploaded',digest:`sha256:${hash(body)}`};f.assets.push(asset);return response(asset,201);
  }
  const route=u.pathname.replace('/repos/owner/repo','');
  if(route==='/releases'&&method==='GET')return response(f.releases);
  if(route.startsWith('/releases/tags/')){const release=f.releases.find(r=>r.tag_name===route.slice('/releases/tags/'.length));return release?response(release):response({},404);}
  if(route==='/releases'&&method==='POST'){
   const release={id:1,...body};f.releases.push(release);return response(release,201);
  }
  if(route==='/releases/1/assets')return response(f.assets);
  if(route==='/releases/1'&&method==='PATCH'){Object.assign(f.releases[0],body);return response(f.releases[0]);}
  if(route.startsWith('/git/commits/'))return response({sha:route.slice('/git/commits/'.length)});
  if(route.startsWith('/git/ref/tags/')){
   const sha=f.tags[route.slice('/git/ref/tags/'.length)];return sha?response({object:{type:'commit',sha}}):response({},404);
  }
  if(route==='/git/refs'&&method==='POST'){
   f.tags[body.ref.replace('refs/tags/','')]=body.sha;return response({object:{type:'commit',sha:body.sha}},201);
  }
  throw new Error(`Unexpected fixture request ${method} ${u.pathname}`);
 };
 f.publisher=createPublisher({publisherId:'test',itemId:ITEM,repository:'owner/repo',cwsToken:'fake-cws',githubToken:'fake-github'},{fetch:f.fetch});
 f.publish=()=>{f.status.publishedItemRevisionStatus={state:'PUBLISHED',distributionChannels:[{crxVersion:'2.7.1',deployPercentage:100}]};delete f.status.submittedItemRevisionStatus;};
 f.writes=()=>f.calls.filter(c=>c.method!=='GET');
 f.cwsWrites=()=>f.writes().filter(c=>c.url.includes('chromewebstore'));
 return f;
}
async function main(){
 assert.equal(compareVersions('2.7.1','2.6.20'),1);assert.equal(compareVersions('2.7.1','2.7.1.0'),0);
 for(const invalid of ['2.01.1','0','65536.1','2.1.1.1.1','2.1/evil'])assert.throws(()=>compareVersions(invalid,'1'));
 assert.throws(()=>validateMetadata({...bundle().metadata,zipFile:'../secret.zip'}));
 assert.throws(()=>validateMetadata({...bundle().metadata,baselineSha:BASE}));
 assert.equal(workflowSourceSha({CWS_SOURCE_SHA:SOURCE,GITHUB_SHA:BASE}),SOURCE);assert.equal(workflowSourceSha({GITHUB_SHA:BASE}),BASE);
 assert.throws(()=>workflowSourceSha({CWS_SOURCE_SHA:'invalid',GITHUB_SHA:BASE}),/source SHA/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/staging'},'submit'),/main/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main'},'submit',{activationState:{schemaVersion:1,automationEnabled:false}}),/deferred by owner/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main'},'monitor',{activationState:{schemaVersion:1,automationEnabled:false}}),/deferred by owner/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main'},'monitor'),/GitHub Actions/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main'},'bootstrap'),/CWS_BOOTSTRAP_CONFIRMED/);
 await assert.rejects(()=>cli({GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/staging'},'status'),/main/);
 const connection=fixture();connection.status.publicKey='must-not-be-exposed';
 assert.deepEqual(await connection.publisher.inspect(),{state:'STORE_STATUS',itemId:ITEM,publishedVersion:null,publishedState:null,submittedState:null,submittedVersion:null,warned:false,takenDown:false,lastAsyncUploadState:'NOT_FOUND'});
 assert.equal(connection.calls.length,1);assert(connection.calls[0].url.endsWith(':fetchStatus'));assert.equal(connection.writes().length,0);
 const partialStatus=fixture({baseline:'2.6.20'});partialStatus.status.publishedItemRevisionStatus.distributionChannels[0].deployPercentage=50;
 partialStatus.status.submittedItemRevisionStatus={state:'DRAFT',distributionChannels:[{crxVersion:'2.7.1'}]};
 const partialResult=await partialStatus.publisher.inspect();assert.equal(partialResult.publishedVersion,'2.6.20');assert.equal(partialResult.submittedState,'DRAFT');assert.equal(partialResult.submittedVersion,'2.7.1');assert.equal(partialStatus.calls.length,1);
 const badConnection=fixture();badConnection.status.itemId='b'.repeat(32);await assert.rejects(()=>badConnection.publisher.inspect(),/identity/);assert.equal(badConnection.calls.length,1);
 const malformedStatus=fixture();malformedStatus.status.lastAsyncUploadState='<script>secret</script>';await assert.rejects(()=>malformedStatus.publisher.inspect(),error=>/Invalid Store status state/.test(error.message)&&!error.message.includes('secret'));

 const unconfirmed=fixture();await assert.rejects(()=>unconfirmed.publisher.bootstrap(bundle()),/explicit operator/);assert.equal(unconfirmed.calls.length,0);
 const notPublished=fixture();await assert.rejects(()=>notPublished.publisher.bootstrap(bundle(),{confirmed:true}),/already PUBLISHED/);assert.equal(notPublished.writes().length,0);
 const bootstrapOther=fixture({baseline:'2.6.20'});await assert.rejects(()=>bootstrapOther.publisher.bootstrap(bundle(),{confirmed:true}),/already PUBLISHED/);assert.equal(bootstrapOther.writes().length,0);
 const baselineBootstrap=fixture();baselineBootstrap.publish();await assert.rejects(()=>baselineBootstrap.publisher.bootstrap(bundle('2.6.20'),{confirmed:true}),/first production/);assert.equal(baselineBootstrap.calls.length,0);
 const malformedBootstrap=bundle();delete malformedBootstrap.metadata.baselineSha;
 await assert.rejects(()=>fixture().publisher.bootstrap(malformedBootstrap,{confirmed:true}),/baseline SHA/);
 const bootstrapPending=fixture();bootstrapPending.publish();bootstrapPending.status.submittedItemRevisionStatus={state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'2.8.0'}]};
 await assert.rejects(()=>bootstrapPending.publisher.bootstrap(bundle(),{confirmed:true}),/submission blocks/);assert.equal(bootstrapPending.writes().length,0);
 const bootstrapDraft=fixture();bootstrapDraft.publish();bootstrapDraft.releases=[{draft:true,tag_name:'cws-candidate/v2.7.1'}];
 await assert.rejects(()=>bootstrapDraft.publisher.bootstrap(bundle(),{confirmed:true}),/candidate blocks/);assert.equal(bootstrapDraft.writes().length,0);
 const manual=fixture();manual.publish();assert.deepEqual(await manual.publisher.bootstrap(bundle(),{confirmed:true}),{state:'PUBLISHED',version:'2.7.1'});
 assert.equal(manual.cwsWrites().length,0,'Bootstrap must never upload or publish to CWS');
 assert.equal(manual.tags['prod/v2.7.1'],SOURCE);assert.equal(manual.releases[0].draft,false);
 const attestation=JSON.parse(/^<!-- brandmaker-cws (.*) -->/.exec(manual.releases[0].body)[1]);
 assert.equal(attestation.bootstrapAttestation,'operator-confirmed-exact-ci-package');assert.equal(attestation.bootstrapSourceSha,SOURCE);assert.equal(attestation.bootstrapZipSha256,bundle().metadata.zipSha256);
 const bootstrapWrites=manual.writes().length;
 assert.equal((await manual.publisher.bootstrap(bundle(),{confirmed:true})).state,'SKIPPED_ALREADY_PUBLISHED');assert.equal(manual.writes().length,bootstrapWrites);
 const alteredManual=bundle();alteredManual.notes=Buffer.from('other notes');alteredManual.metadata.notesSha256=hash(alteredManual.notes);alteredManual.raw=Buffer.from(JSON.stringify(alteredManual.metadata));
 await assert.rejects(()=>manual.publisher.bootstrap(alteredManual,{confirmed:true}),/increase the extension version/);assert.equal(manual.writes().length,bootstrapWrites);

 const first=fixture();
 assert.deepEqual(await first.publisher.submit(bundle()),{state:'PENDING_REVIEW',version:'2.7.1'});
 assert.equal(first.cwsWrites().length,2);assert.equal(first.releases[0].draft,true);assert.equal(first.tags['prod/v2.7.1'],undefined);
 const writes=first.cwsWrites().length;
 assert.equal((await first.publisher.submit(bundle())).state,'PENDING_REVIEW');assert.equal(first.cwsWrites().length,writes,'Retry must not re-upload a pending release');
 assert.equal((await first.publisher.monitor()).state,'PENDING_REVIEW');assert.equal(first.cwsWrites().length,writes,'Monitor never submits packages');
 first.publish();assert.equal((await first.publisher.monitor()).state,'PUBLISHED');
 assert.equal(first.tags['prod/v2.7.1'],SOURCE);assert.equal(first.releases[0].draft,false);assert.equal(first.releases[0].tag_name,'prod/v2.7.1');
 assert.equal((await first.publisher.monitor()).state,'NO_PENDING_RELEASE');
 const docsOnly=bundle();docsOnly.metadata.sourceSha='c'.repeat(40);docsOnly.raw=Buffer.from(JSON.stringify(docsOnly.metadata));
 const productionWrites=first.writes().length;
 assert.equal((await first.publisher.submit(docsOnly)).state,'SKIPPED_ALREADY_PUBLISHED');assert.equal(first.writes().length,productionWrites);assert.equal(first.tags['prod/v2.7.1'],SOURCE);
 const changed=bundle();changed.zip=Buffer.from('changed runtime');changed.metadata.zipSha256=hash(changed.zip);changed.raw=Buffer.from(JSON.stringify(changed.metadata));
 await assert.rejects(()=>first.publisher.submit(changed),/increase the extension version/);assert.equal(first.writes().length,productionWrites);
 const noRecord=fixture({baseline:'2.7.1'});await assert.rejects(()=>noRecord.publisher.submit(bundle()),/explicit bootstrap/);assert.equal(noRecord.writes().length,0);

 const update=fixture({baseline:'2.6.20'});await update.publisher.submit(bundle('2.6.20'));
 const mismatch=fixture({baseline:'2.6.19'});await assert.rejects(()=>mismatch.publisher.submit(bundle('2.6.20')),/Production version changed/);assert.equal(mismatch.writes().length,0);
 const wrongTag=fixture({baseline:'2.6.20'});wrongTag.tags['prod/v2.6.20']=SOURCE;
 await assert.rejects(()=>wrongTag.publisher.submit(bundle('2.6.20')),/baseline tag/);assert.equal(wrongTag.writes().length,0);
 const other=fixture();other.status.submittedItemRevisionStatus={state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'2.8.0'}]};
 await assert.rejects(()=>other.publisher.submit(bundle()),/submission blocks/);assert.equal(other.writes().length,0);
 const badID=fixture();badID.status.itemId='b'.repeat(32);await assert.rejects(()=>badID.publisher.submit(bundle()),/identity/);assert.equal(badID.writes().length,0);
 const policy=fixture();policy.status.warned=true;await assert.rejects(()=>policy.publisher.submit(bundle()),/policy warning/);assert.equal(policy.writes().length,0);
 const altered=bundle();altered.zip=Buffer.from('other');const tampered=fixture();await assert.rejects(()=>tampered.publisher.submit(altered),/digest/);assert.equal(tampered.calls.length,0);

 const uploading=fixture();uploading.fail=(url)=>{if(url.endsWith(':upload'))throw new Error('fake-cws must never appear in outer errors');};
 await assert.rejects(()=>uploading.publisher.submit(bundle()),error=>/result unknown/.test(error.message)&&!error.message.includes('fake-cws'));
 assert.equal(decodeMarker(uploading.releases[0]).phase,'UPLOADING');
 const count=uploading.cwsWrites().length;uploading.fail=null;
 await assert.rejects(()=>uploading.publisher.submit(bundle()),/manual reconciliation/);assert.equal(uploading.cwsWrites().length,count);

 const wrongUpload=fixture();wrongUpload.uploadVersion='2.7.0';await assert.rejects(()=>wrongUpload.publisher.submit(bundle()),/exact target/);assert.equal(wrongUpload.cwsWrites().length,1);
 const asyncUpload=fixture();asyncUpload.uploadState='IN_PROGRESS';delete asyncUpload.uploadVersion;
 await assert.rejects(()=>asyncUpload.publisher.submit(bundle()),/exact target/);assert.equal(asyncUpload.cwsWrites().length,1);
 const submitting=fixture();submitting.fail=url=>{if(url.endsWith(':publish'))throw new Error('network timeout');};
 await assert.rejects(()=>submitting.publisher.submit(bundle()),/result unknown/);assert.equal(decodeMarker(submitting.releases[0]).phase,'SUBMITTING');
 submitting.fail=null;await assert.rejects(()=>submitting.publisher.submit(bundle()),/manual reconciliation/);assert.equal(submitting.cwsWrites().length,2);
 // A successful remote write whose response was lost can be reconciled by an exact pending version.
 submitting.status.submittedItemRevisionStatus={state:'PENDING_REVIEW',distributionChannels:[{crxVersion:'2.7.1'}]};
 assert.equal((await submitting.publisher.monitor()).state,'PENDING_REVIEW');assert.equal(submitting.cwsWrites().length,2);

 const assetBad=fixture();await assetBad.publisher.submit(bundle());assetBad.assets[0].digest='sha256:'+'0'.repeat(64);assetBad.publish();
 await assert.rejects(()=>assetBad.publisher.monitor(),/asset digest/);assert.equal(assetBad.tags['prod/v2.7.1'],undefined);
 const conflict=fixture();await conflict.publisher.submit(bundle());conflict.publish();conflict.tags['prod/v2.7.1']=BASE;
 await assert.rejects(()=>conflict.publisher.monitor(),/tag conflict/);assert.equal(conflict.releases[0].draft,true);
 const rollout=fixture();await rollout.publisher.submit(bundle());rollout.publish();rollout.status.publishedItemRevisionStatus.distributionChannels[0].deployPercentage=50;
 await assert.rejects(()=>rollout.publisher.monitor(),/100 percent/);assert.equal(rollout.tags['prod/v2.7.1'],undefined);
 for(const state of ['REJECTED','CANCELLED']){
  const rejected=fixture();await rejected.publisher.submit(bundle());rejected.status.submittedItemRevisionStatus.state=state;
  await assert.rejects(()=>rejected.publisher.monitor(),/rejected\/cancelled/);assert.equal(rejected.tags['prod/v2.7.1'],undefined);
 }
 const http=fixture();http.fail=url=>url.endsWith(':fetchStatus')?{ok:false,status:403,json:async()=>({secret:'never print'})}:null;
 await assert.rejects(()=>http.publisher.submit(bundle()),error=>/HTTP 403/.test(error.message)&&!error.message.includes('never print'));
 let probeCalls=0;assert.equal(await hasPendingRelease('owner/repo','probe',async(url,options)=>{
  probeCalls++;assert(!url.includes('google'));assert.equal(options.redirect,'error');return {ok:true,status:200,json:async()=>[{draft:true,tag_name:'cws-candidate/v2.7.1'}]};
 }),true);assert.equal(probeCalls,1);
 await assert.rejects(()=>hasPendingRelease('owner/repo','probe',async()=>({ok:true,status:200,json:async()=>Array(100).fill({draft:false})})),/pagination limit/);
 const multiple=fixture();multiple.releases=[{draft:true,tag_name:'cws-candidate/v1'},{draft:true,tag_name:'cws-candidate/v2'}];
 await assert.rejects(()=>multiple.publisher.monitor(),/Multiple pending/);assert.equal(multiple.writes().length,0);
 console.log('PASS CWS v2 publication: exact baseline, digests, single candidate, no blind retries, review monitoring, immutable production tags and explicit operator-attested bootstrap');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
