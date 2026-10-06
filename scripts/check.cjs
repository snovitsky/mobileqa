const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../extension'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),pkg=require('../package.json');
assert.equal(manifest.version,pkg.version,'Package and manifest versions must match');assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions,['activeTab','storage','scripting','declarativeNetRequestWithHostAccess'],'Permission changes require explicit review');
assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
const files=fs.readdirSync(root);for(const name of files.filter(n=>n.endsWith('.js')))execFileSync(process.execPath,['--check',path.join(root,name)]);
for(const name of [manifest.background.service_worker,...Object.values(manifest.icons)])assert(fs.existsSync(path.join(root,name)),`Missing ${name}`);
for(const name of files)assert(!/goal|metrika|conversion|\.env/i.test(name),'Basic must not package analytics data');
console.log('PASS syntax, manifest, version, permissions and Basic package');
