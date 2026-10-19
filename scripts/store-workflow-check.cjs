const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
function activationEnabled(config) {
 assert(config?.schemaVersion===1&&typeof config.automationEnabled==='boolean','Invalid Store activation state');
 return config.automationEnabled;
}
function checkActivation(env=process.env) {
 const state=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../store/release-state.json'),'utf8'));
 const enabled=activationEnabled(state);
 assert(env.GITHUB_OUTPUT,'GitHub output path is required');
 fs.appendFileSync(env.GITHUB_OUTPUT,`enabled=${enabled}\n`);
 console.log(enabled?'Store automation explicitly enabled in source.':'Store automation deferred by owner; see codex/store-release-plan.md.');
}
function checkWorkflow(env = process.env) {
 const {prepareRelease,validateRecord} = require('./store-release.cjs');
 for (const name of ['CWS_PUBLISHER_ID','CWS_ITEM_ID','GCP_WORKLOAD_IDENTITY_PROVIDER','GCP_SERVICE_ACCOUNT']) assert(env[name], `Configure ${name} before enabling publication`);
 assert(/^[a-z0-9_-]+$/i.test(env.CWS_PUBLISHER_ID), 'Invalid publisher ID');
 assert(/^[a-p]{32}$/.test(env.CWS_ITEM_ID), 'Invalid Chrome Web Store item ID');
 assert(/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(env.GCP_WORKLOAD_IDENTITY_PROVIDER), 'Invalid WIF provider');
 assert(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(env.GCP_SERVICE_ACCOUNT), 'Invalid publication service account');
 const directory = path.resolve(__dirname,'../dist');
 const saved = validateRecord(JSON.parse(fs.readFileSync(path.join(directory,'store-release.json'),'utf8')));
 assert.equal(saved.sourceSha,env.EXPECTED_SOURCE_SHA,'Artifact must come from the successful CI source SHA');
 const verified = prepareRelease({sourceSha:env.EXPECTED_SOURCE_SHA,directory});
 assert.deepEqual(verified,saved,'Downloaded artifact provenance must match source bytes and reviewed notes');
 console.log('PASS production configuration and exact CI artifact provenance');
}
if (require.main === module) {
 if(process.argv[2]==='activation')checkActivation();else checkWorkflow();
}
module.exports = {checkWorkflow,activationEnabled,checkActivation};
