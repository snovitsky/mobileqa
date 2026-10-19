const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {releaseEntry,releaseNotes,validVersion,compareVersions} = require('./release-notes.cjs');
const {auditPackage} = require('./store-audit.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateRecord(record) {
 assert(record?.schemaVersion === 1 && validVersion(record.version), 'Invalid release provenance schema/version');
 assert(/^[a-f0-9]{40}$/.test(record.sourceSha), 'A complete source commit SHA is required');
 assert(record.zipFile === `brandmaker-qa-${record.version}-store.zip` && record.notesFile === `release-notes-${record.version}.md`, 'Unexpected release filenames');
 assert(/^[a-f0-9]{64}$/.test(record.zipSha256) && /^[a-f0-9]{64}$/.test(record.notesSha256), 'Release SHA-256 digests are required');
 assert(record.fromVersion === null ? record.baselineSha === null : validVersion(record.fromVersion) && /^[a-f0-9]{40}$/.test(record.baselineSha), 'Invalid production baseline');
 if(record.fromVersion !== null)assert(compareVersions(record.version,record.fromVersion)>0,'Production release version must increase');
 return record;
}
function prepareRelease({sourceSha = process.env.GITHUB_SHA, directory = path.resolve(__dirname,'../dist')} = {}) {
 const current = releaseEntry();
 const zipFile = `brandmaker-qa-${current.version}-store.zip`, notesFile = `release-notes-${current.version}.md`;
 auditPackage(path.join(directory,zipFile));
 const text = releaseNotes();
 const notesBytes = fs.readFileSync(path.join(directory,notesFile));
 assert(notesBytes.equals(Buffer.from(text)),'Artifact notes must match the reviewed production notes');
 const record = validateRecord({schemaVersion:1,version:current.version,fromVersion:current.fromVersion,baselineSha:current.baselineSha,sourceSha,
  zipFile,zipSha256:digest(fs.readFileSync(path.join(directory,zipFile))),notesFile,notesSha256:digest(notesBytes)});
 fs.writeFileSync(path.join(directory,'store-release.json'),JSON.stringify(record,null,2)+'\n');
 console.log(`PASS release provenance: ${record.version}, source ${record.sourceSha}`);
 return record;
}
if (require.main === module) prepareRelease();
module.exports = {digest,validateRecord,prepareRelease};
