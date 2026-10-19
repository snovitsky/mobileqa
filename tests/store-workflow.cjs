const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {yaml}=require(path.resolve(__dirname,'../node_modules/playwright-core/lib/utilsBundle.js'));
const {verifyRun}=require('../scripts/store-bootstrap-check.cjs');
const {activationEnabled}=require('../scripts/store-workflow-check.cjs');
const read=name=>yaml.parse(fs.readFileSync(path.resolve(__dirname,'../.github/workflows/'+name),'utf8'));
const ci=read('ci.yml'),publish=read('store-publish.yml'),monitor=read('store-status.yml'),bootstrap=read('store-bootstrap.yml');
assert.deepEqual(ci.on.push.branches,['main','staging']);
assert.equal(typeof activationEnabled(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../store/release-state.json'),'utf8'))),'boolean');
assert.equal(activationEnabled({schemaVersion:1,automationEnabled:false}),false);
assert.equal(activationEnabled({schemaVersion:1,automationEnabled:true}),true);
assert.throws(()=>activationEnabled({automationEnabled:'true'}));
assert.deepEqual(Object.keys(ci.jobs),['checks'],'Both branches must use the same complete checks job');
assert(!ci.jobs.checks.if,'The shared test job must not be filtered by branch');
assert.equal(ci.permissions.contents,'read');assert(!ci.permissions['id-token']);
const runs=ci.jobs.checks.steps.map(step=>step.run).filter(Boolean);
assert(runs.indexOf('npm test')<runs.indexOf('npm run build:store')&&runs.includes('node scripts/store-release.cjs'));
assert(runs.includes('npm run build')&&ci.jobs.checks.steps.filter(step=>step.run).every(step=>!step.if),'Tests and both builds must run identically on main and staging');
for(const workflow of [publish,monitor,bootstrap]) {
 assert.equal(workflow.concurrency.group,'chrome-web-store-production');assert.equal(workflow.concurrency['cancel-in-progress'],false);
 for(const job of Object.values(workflow.jobs)) {
  assert(job.if.includes('main')&&job.environment==='chrome-web-store');
  for(const step of job.steps)if(step.uses)assert(/@[a-f0-9]{40}$/.test(step.uses),'Production actions must be pinned');
  for(const step of job.steps.filter(step=>step.uses?.startsWith('google-github-actions/auth@'))) {
   assert.equal(step.with.create_credentials_file,false);assert.equal(step.with.export_environment_variables,false);
  }
 }
}
assert(publish.jobs.publish.if.includes("workflow_run.event == 'push'")&&publish.jobs.publish.if.includes('head_repository.full_name == github.repository'));
assert(publish.jobs.publish.if.includes("conclusion == 'success'")&&publish.jobs.publish.if.includes("CWS_PUBLISH_ENABLED == 'true'"));
const download=publish.jobs.publish.steps.find(step=>step.uses?.startsWith('actions/download-artifact@'));
assert(download.with['run-id'].includes('workflow_run.id')&&download.with.name.includes('workflow_run.head_sha'));
for(const job of [publish.jobs.publish,monitor.jobs.status]) {
 const gate=job.steps.findIndex(step=>step.id==='activation');assert(gate>=0);
 for(const step of job.steps.slice(gate+1))if(step.id!=='google'&&!step.if?.includes('pending.outputs.pending'))assert(step.if?.includes("activation.outputs.enabled == 'true'"),'Deferred automation must stop before dependency downloads, authentication or mutation');
}
assert.equal(monitor.jobs.status.steps.find(step=>step.id==='google').with.access_token_scopes,'https://www.googleapis.com/auth/chromewebstore.readonly');
assert(monitor.jobs.status.if.includes('inputs.verify_connection != true'),'Readonly connection verification must not run the publication monitor');
assert(monitor.jobs.verify.if.includes('inputs.verify_connection == true')&&!monitor.jobs.verify.if.includes('CWS_PUBLISH_ENABLED'),'Explicit readonly verification must work before enabling production');
assert.equal(monitor.jobs.verify.permissions.contents,'read');
assert(monitor.jobs.verify.steps.some(step=>step.run==='node scripts/store-publish.cjs status'));
assert(!monitor.jobs.verify.steps.some(step=>/store-publish\.cjs (?:submit|bootstrap|monitor)/.test(step.run||'')),'Connection verification must not finalize GitHub production releases');
assert(bootstrap.jobs.bootstrap.if.includes('confirmed_exact_package == true'));
const good={name:'CI',path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',event:'push',head_branch:'main',head_repository:{full_name:'example/qa'},head_sha:'a'.repeat(40)};
assert.equal(verifyRun(good,'example/qa'),good.head_sha);
for(const patch of [{event:'pull_request'},{head_branch:'staging'},{conclusion:'failure'},{head_repository:{full_name:'other/qa'}},{path:'.github/workflows/other.yml'}])assert.throws(()=>verifyRun({...good,...patch},'example/qa'));
console.log('PASS main-only production identity, exact successful CI artifact, OIDC scopes, no keys, concurrency and explicit first-publication guards');
