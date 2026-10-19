const fs=require('node:fs'),path=require('node:path');
const excluded=new Set(['.git','node_modules','dist','test-results','playwright-report']);
const rules=[
 ['Yandex OAuth token',/\b(?:y0_[A-Za-z0-9_-]{25,}|AQAAAA[A-Za-z0-9_-]{25,})\b/g],
 ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
 ['Google API key',/\bAIza[A-Za-z0-9_-]{30,}\b/g],
 ['Google OAuth token',/\bya29\.[A-Za-z0-9_-]{30,}\b/g],
 ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
 ['Private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
 ['JWT credential',/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g],
 ['Literal authorization credential',/\bAuthorization["']?\s*[:=]\s*["'](?:Bearer|OAuth)\s+([A-Za-z0-9_.~-]{24,})["']/gi],
 ['Literal access secret',/\b(?:YANDEX_TOKEN|METRIKA_TOKEN|DIRECT_TOKEN|CLIENT_?SECRET|REFRESH_?TOKEN|ACCESS_?TOKEN|API_?KEY|PASSWORD)["']?\s*[:=]\s*["']([A-Za-z0-9_.~+\/-]{16,})["']/gi],
];
function scanText(filename,text) {
 const findings=[];
 for(const [kind,pattern] of rules) {
  pattern.lastIndex=0;
  for(const match of text.matchAll(pattern))findings.push({file:filename,line:text.slice(0,match.index).split('\n').length,kind});
 }
 // Only names/line numbers are returned; credential values must never enter logs or reports.
 return findings;
}
function scanRepository(root=path.resolve(__dirname,'..')) {
 const findings=[];let files=0;
 function visit(directory) {
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
   if(entry.isSymbolicLink())continue;
   const full=path.join(directory,entry.name),relative=path.relative(root,full).replaceAll(path.sep,'/');
   if(entry.isDirectory()){if(!excluded.has(entry.name))visit(full);continue;}
   if(!entry.isFile())continue;
   if(/^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|(?:credentials|service-account)\.json)$/i.test(entry.name))findings.push({file:relative,line:1,kind:'Credential file requires review'});
   const bytes=fs.readFileSync(full);if(bytes.includes(0))continue;
   files++;findings.push(...scanText(relative,bytes.toString('utf8')));
  }
 }
 visit(root);return {files,findings};
}
if(require.main===module) {
 const result=scanRepository();
 if(result.findings.length){console.error(JSON.stringify(result,null,2));process.exitCode=1;}
 else console.log(`PASS secret scan: ${result.files} text files, no detected credential signatures; dependency/cache/Git history directories excluded`);
}
module.exports={scanText,scanRepository};
