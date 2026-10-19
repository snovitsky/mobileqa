const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const manifest = require('../extension/manifest.json');
const notes = require('../extension/release-notes.json');
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/;
function validVersion(version) {
 return typeof version === 'string' && versionPattern.test(version) && version.split('.').every(part => Number(part) <= 65535) && version.split('.').some(part => Number(part) > 0);
}
function compareVersions(left, right) {
 assert(validVersion(left) && validVersion(right), 'Invalid Chrome release version');
 const a = left.split('.').map(Number), b = right.split('.').map(Number);
 for (let index=0; index<4; index++) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
 return 0;
}
function validateNotes(data = notes) {
 assert(Array.isArray(data.releases) && data.releases.length > 0, 'Production notes are required');
 const versions = new Set();
 data.releases.forEach((release, index) => {
  assert(validVersion(release.version) && !versions.has(release.version), 'Invalid or duplicate release version');
  versions.add(release.version);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(release.date) && new Date(release.date).toISOString().slice(0,10) === release.date, 'Invalid release date');
  assert(typeof release.title === 'string' && release.title.trim(), 'Release title is required');
  assert(Array.isArray(release.changes) && release.changes.length > 0, 'User-facing changes are required');
  for (const text of [release.title, ...release.changes]) assert(typeof text === 'string' && text.trim() && !/<[^>]*>|TODO|FIXME|\.cjs\b|\.js\b|token|resolver|stack trace/i.test(text), 'Notes must be readable user-facing text');
  const previous = data.releases[index+1];
  if (previous) {
   assert(release.fromVersion === previous.version && compareVersions(release.version,previous.version) > 0, 'Notes must aggregate from the preceding production version');
   assert(/^[a-f0-9]{40}$/.test(release.baselineSha), 'A production baseline SHA is required');
  } else assert(release.fromVersion === null && release.baselineSha === null, 'The first production release must have a null baseline');
 });
 return data;
}
function releaseEntry(version = manifest.version, data = notes) {
 validateNotes(data);
 const current = data.releases.find(release => release.version === version);
 assert(current, 'Every released version must have aggregate production notes');
 return current;
}
function releaseNotes(version = manifest.version, {verifyFile = true, data = notes} = {}) {
 const current = releaseEntry(version, data);
 const baseline = current.fromVersion ? `Изменения с версии ${current.fromVersion}.` : 'Первый выпуск в Chrome Web Store.';
 const text = `# Brandmaker QA ${version}\n\n${current.date} — ${current.title}\n\n${baseline}\n\n${current.changes.map(change => '- ' + change).join('\n')}\n`;
 if (verifyFile) {
  const saved = fs.readFileSync(path.resolve(__dirname,`../releases/${version}.md`),'utf8').replace(/\r\n/g,'\n');
  assert.equal(saved,text,'Prepare and review releases/<version>.md before promotion to main (npm run notes:write)');
 }
 return text;
}
if (require.main === module) {
 const write = process.argv.includes('--write');
 const text = releaseNotes(manifest.version,{verifyFile:!write});
 const out = path.resolve(__dirname,write?'../releases':'../dist');
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,write?`${manifest.version}.md`:`release-notes-${manifest.version}.md`),text);
 console.log(`PASS aggregate user-facing production notes: ${manifest.version}`);
}
module.exports = {validVersion,compareVersions,validateNotes,releaseEntry,releaseNotes};
