const fs=require('node:fs'),assert=require('node:assert/strict');
function verifyRun(run,repository) {
 assert(run?.name==='CI'&&run.path==='.github/workflows/ci.yml','Select the CI workflow run');
 assert(run.status==='completed'&&run.conclusion==='success'&&run.event==='push','CI must have passed for a push');
 assert(run.head_branch==='main'&&run.head_repository?.full_name===repository,'CI must belong to this repository main');
 assert(/^[a-f0-9]{40}$/.test(run.head_sha),'CI source SHA is missing');
 return run.head_sha;
}
async function checkBootstrap(env=process.env,fetchImpl=fetch) {
 assert(env.CWS_BOOTSTRAP_CONFIRMED==='true','Explicit confirmation of the exact manually published CI package is required');
 assert(/^[1-9]\d*$/.test(env.CWS_CI_RUN_ID||''),'A numeric CI run ID is required');
 assert(/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||'')&&env.GH_TOKEN,'Missing GitHub configuration');
 const response=await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.CWS_CI_RUN_ID}`,{
  redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 assert(response.ok,'Could not verify the selected CI run');
 const source=verifyRun(await response.json(),env.GITHUB_REPOSITORY);
 assert(env.GITHUB_OUTPUT,'GitHub output path is required');
 fs.appendFileSync(env.GITHUB_OUTPUT,`source_sha=${source}\n`);
 console.log(`PASS first-publication source: ${source}`);
}
if(require.main===module)checkBootstrap().catch(()=>{console.error('First publication could not be verified. Check confirmation and successful main CI run.');process.exitCode=1;});
module.exports={verifyRun,checkBootstrap};
