import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dsfFilename,projectFilename,FILE_EXTENSIONS} from '../js/file-extensions.js';
import {createDspFileSession,fingerprintDspFile,DSP_FILE_TYPES,DSP_OPEN_FILE_TYPES} from '../js/dsp-file-session.js';
import {fileLaunchPath} from '../js/file-launch-transfer.js';
import {createFileLaunchInbox} from '../js/file-launch.js';
import {createReaderWritingModel} from '../js/reader-writing-model.js';
import {nodeRuntime} from './writing-w1/node-runtime.mjs';
import {loadDsfV3,resaveDsfV3} from '../js/dsf-writing-package.js';
const out=new URL('../outputs/extensions/',import.meta.url);await mkdir(out,{recursive:true});
for(const name of ['本','本.dsf','本.DSFR','本.DSF'])assert.equal(dsfFilename(name),'本.dsfr');
for(const name of ['原稿','原稿.dsp','原稿.DSFP','原稿.DSP'])assert.equal(projectFilename(name),'原稿.dsfp');
assert.equal(dsfFilename('本.dsfr '),'本.dsfr');assert.equal(dsfFilename('a/b'),'a_b.dsfr');
assert.equal(projectFilename('.dsp'),'project.dsfp');
for(const ext of FILE_EXTENSIONS){
 const name='Book'+ext.toUpperCase(),project=ext==='.dsp'||ext==='.dsfp';
 assert.equal(fileLaunchPath(name),project?'/studio.html?fileLaunch=dsp':'/viewer.html?fileLaunch=dsf');
 let opened=false;const inbox=createFileLaunchInbox({extension:FILE_EXTENSIONS,openFile:()=>opened=true});
 inbox.receive({files:[{kind:'file',name,getFile:async()=>({name})}]});
 assert.equal(await inbox.open(1),true);assert.equal(opened,true);
}
assert.equal(fileLaunchPath('x.dsfr.exe'),null);
assert.deepEqual(DSP_FILE_TYPES[0].accept['application/vnd.dsf.project+zip'],['.dsfp']);
assert.deepEqual(DSP_OPEN_FILE_TYPES[0].accept['application/vnd.dsf.project+zip'],['.dsfp','.dsp']);
const manifest=JSON.parse(await readFile(new URL('../public/studio.webmanifest',import.meta.url)));
assert.deepEqual(manifest.file_handlers.flatMap(h=>Object.values(h.accept).flat()).sort(),['.dsfp','.dsfr']);
// Real session code: preserve an opened legacy file, pick a new destination, then verify bytes.
function memoryHandle(name,content){let file=new File([content],name,{lastModified:1});const handle={name,kind:'file',getFile:async()=>file,isSameEntry:async other=>other===handle,createWritable:async()=>{let pending;return {write:async blob=>pending=blob,close:async()=>{file=new File([pending],name,{lastModified:2});},abort:async()=>{}};}};return handle;}
const old=memoryHandle('legacy.dsp','old archive'),dest=memoryHandle('new.dsfp','');
const session=createDspFileSession({readScope:()=>1});session.attach(old,await fingerprintDspFile(await old.getFile()));
let picks=0;const saved=await session.save({chooseHandle:async()=>{picks++;return dest;},buildBlob:async()=>({blob:new Blob(['new archive'])})});
assert.equal(saved.filename,'new.dsfp');assert.equal(picks,1);assert.equal(await (await old.getFile()).text(),'old archive');assert.equal(await (await dest.getFile()).text(),'new archive');
await session.save({chooseHandle:async()=>{throw Error('must reuse new file');},buildBlob:async()=>({blob:new Blob(['next archive'])})});
assert.equal(await (await dest.getFile()).text(),'next archive');
session.attach(old,await fingerprintDspFile(await old.getFile()));
assert.equal((await session.save({chooseHandle:async()=>{throw Object.assign(Error(),{name:'AbortError'});},buildBlob:()=>{throw Error('must not build');}})).status,'cancelled');
assert.equal(await (await old.getFile()).text(),'old archive');
// Round-trip the actual Writing ZIP under the new extension, preserving the original content.
const options=await nodeRuntime(),source=await readFile(new URL('../outputs/writing-w1/preview-sample.dsf',import.meta.url));
const original=await loadDsfV3(source,options);
const editable=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:createReaderWritingModel(original,options.catalog.map(f=>f.id)).envelope});
for(const kind of ['writing-editable','writing-shared']){
 const result=await resaveDsfV3(editable.handle,{copyKind:kind}),name=dsfFilename(kind);
 await writeFile(new URL(name,out),result.bytes);
 const reopened=await loadDsfV3(await readFile(new URL(name,out)),options);
 assert.equal(reopened.baseHash,original.baseHash);
 for(const e of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(reopened.readBytes(e.path),original.readBytes(e.path));
 const again=await resaveDsfV3(reopened,{copyKind:kind});assert.equal(again.handle.baseHash,original.baseHash);
}
await assert.rejects(loadDsfV3(new TextEncoder().encode('DSD audio is not a DSF book'),options));
// Reuse the existing portable-download behavior assertions, before its unrelated UI source checks.
const portableTest=await readFile(new URL('./verify-flow-press-portable-download.js',import.meta.url),'utf8');
await writeFile(new URL('./.verify-extensions-portable-temp.mjs',import.meta.url),portableTest.split('const pressSource =')[0]);
try{execFileSync(process.execPath,[new URL('./.verify-extensions-portable-temp.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{stdio:'pipe'});}finally{const {unlink}=await import('node:fs/promises');await unlink(new URL('./.verify-extensions-portable-temp.mjs',import.meta.url));}
const baseline=execFileSync('git',['show','HEAD:js/press.js'],{encoding:'utf8'});
const staleCheck=/window\.updatePressBookMode = \(mode\) => \{[\s\S]*?_invalidatePressFlowLocalReleaseForSettingsChange\(\);/;
const report={ok:true,newAndLegacyInputs:true,newOutputsOnly:true,legacyProjectPreserved:true,cancelPreserved:true,writingCopiesRoundTrip:true,originalBytesUnchanged:true,pwaNewExtensionsOnly:true,existingPressSourceCheckFailsAtHEAD:!staleCheck.test(baseline)};
await writeFile(new URL('verification.json',out),JSON.stringify(report,null,2));console.log(report);
