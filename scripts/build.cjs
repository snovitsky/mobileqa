const fs=require('node:fs'),path=require('node:path'),{zipSync}=require('fflate');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'))).version;
const allowed=['extension/background.js','extension/bridge.js','extension/desktop-source.js','extension/devices.js','extension/qr.js','extension/panel.js','extension/panel.html','extension/panel.css','extension/manifest.json','extension/icons/16.png','extension/icons/48.png','extension/icons/128.png','codex/user-guide.md','codex/device-sources.md'];
const entries={};for(const name of allowed)entries[name]=[fs.readFileSync(path.join(root,name)),{mtime:new Date('2020-01-01T00:00:00Z')}];
const out=path.resolve(__dirname,'../dist');fs.mkdirSync(out,{recursive:true});const target=path.join(out,`brandmaker-qa-${version}.zip`);fs.writeFileSync(target,zipSync(entries,{level:9}));console.log(target);
