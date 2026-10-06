const fs=require('node:fs'),path=require('node:path'),{zipSync}=require('fflate');
const root=path.resolve(__dirname,'../extension'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version;
const allowed=['background.js','bridge.js','desktop-source.js','devices.js','panel.js','panel.html','panel.css','manifest.json','README.md','DEVICE-SOURCES.md','icons/16.png','icons/48.png','icons/128.png'];
const entries={};for(const name of allowed)entries['extension/'+name]=[fs.readFileSync(path.join(root,name)),{mtime:new Date('2020-01-01T00:00:00Z')}];
const out=path.resolve(__dirname,'../dist');fs.mkdirSync(out,{recursive:true});const target=path.join(out,`mobile-qa-basic-${version}.zip`);fs.writeFileSync(target,zipSync(entries,{level:9}));console.log(target);
