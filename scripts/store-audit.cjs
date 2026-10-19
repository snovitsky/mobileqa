const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {unzipSync}=require('fflate');
const {runtimeFiles}=require('./release-files.cjs');
const {scanText}=require('./secret-scan.cjs');
const expectedPermissions=['tabs','storage','scripting','declarativeNetRequestWithHostAccess'];
function auditPackage(filename){
 const entries=unzipSync(fs.readFileSync(filename));
 assert.deepEqual(Object.keys(entries).sort(),[...runtimeFiles].sort(),'Store ZIP must contain only the explicit runtime allowlist, with manifest at root');
 const manifest=JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
 assert.equal(manifest.manifest_version,3);assert.equal(manifest.version,require('../package.json').version);
 assert.deepEqual(manifest.permissions,expectedPermissions);
 assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
 for(const key of ['host_permissions','externally_connectable','web_accessible_resources','update_url','oauth2','key'])assert(!Object.hasOwn(manifest,key),'Unexpected manifest capability: '+key);
 for(const [name,data] of Object.entries(entries)){
  assert(Buffer.from(data).equals(fs.readFileSync(path.resolve(__dirname,'../extension',name))),'Package must match reviewed source: '+name);
  if(!/\.(?:js|json|html|css)$/.test(name))continue;
  const text=Buffer.from(data).toString('utf8');
  assert.equal(scanText(name,text).length,0,'Credential signature in store package: '+name);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[\w-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}/.test(text),'Possible secret in '+name);
  assert(!/[A-Za-z]:[\\/]Users[\\/]|\/home\/runner\/|\/Users\//.test(text),'Machine path in '+name);
  if(name.endsWith('.js')){
   assert(!/\beval\s*\(|new\s+Function\s*\(|\b(?:XMLHttpRequest|WebSocket)\b|navigator\.sendBeacon/.test(text),'Unexpected dynamic code or transport in '+name);
   for(const imported of text.matchAll(/(?:import\s+[\s\S]*?\s+from|export\s+[\s\S]*?\s+from)\s*['"]([^'"]+)['"]/g)){
    assert(imported[1].startsWith('./'),'Runtime imports must be local: '+name);
    assert(entries[path.posix.normalize(path.posix.join(path.posix.dirname(name),imported[1]))],'Missing import from '+name);
   }
  }
  if(name.endsWith('.html')){
   assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(text),'Inline script in '+name);
   assert(!/<script\b[^>]*\bsrc=["']https?:/i.test(text),'Remote executable code in '+name);
   assert(!/\son\w+\s*=|javascript:/i.test(text),'Inline event handler in '+name);
  }
 }
 assert(Buffer.from(entries['qr.js']).toString().includes('MIT License'),'Keep QR third-party license');
 console.log(`PASS store audit: ${Object.keys(entries).length} runtime files, root manifest, exact source bytes, permissions, local imports, no detected secret signatures`);
 return {manifest,files:Object.keys(entries)};
}
if(require.main===module)auditPackage(process.argv[2]||path.resolve(__dirname,`../dist/brandmaker-qa-${require('../package.json').version}-store.zip`));
module.exports={auditPackage};
