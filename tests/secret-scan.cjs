const assert=require('node:assert/strict');
const {scanText}=require('../scripts/secret-scan.cjs');
const synthetic=[['Yandex OAuth token','y0_'+'A'.repeat(40)],['GitHub token','ghp_'+'b'.repeat(40)],['Google API key','AIza'+'C'.repeat(35)],['Private key',['-----BEGIN ','PRIVATE KEY-----'].join('')],['Literal access secret',['CLIENT_SECRET','=',JSON.stringify('a'.repeat(32))].join('')]];
for(const [kind,value] of synthetic){const results=scanText('fixture.txt','header\n'+value);assert(results.some(item=>item.kind===kind&&item.line===2));assert(!JSON.stringify(results).includes(value),'Scanner output must redact secret values');}
assert.deepEqual(scanText('workflow.yml','CWS_ACCESS_TOKEN: ${{ steps.google.outputs.access_token }}\nAuthorization: `Bearer ${token}`'),[]);
console.log('PASS credential signatures and redacted findings without logging secret values');
