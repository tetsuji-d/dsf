import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {nodeRuntime} from './node-runtime.mjs';
import {originalFixture,editableFixture} from './fixture.mjs';
import {createDsfV3Original,loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {readWritingZip,writeWritingZip} from '../../js/dsf-writing-zip.js';
import {canonicalBytes,sha256} from '../../js/dsf-writing-contract.js';
const options=await nodeRuntime(),out=new URL('../../outputs/writing-w1/',import.meta.url);await mkdir(out,{recursive:true});
const results=[],check=(name,fn)=>{fn();results.push(name);},reject=async(name,fn)=>{await assert.rejects(fn);results.push(name);};
console.log('Generating original with real subsets');
const original=await createDsfV3Original(originalFixture(options.catalog),options);
await writeFile(new URL('original.dsf',out),original.bytes);
const originalRead=await loadDsfV3(new Uint8Array(await readFile(new URL('original.dsf',out))),options);
check('original has no writing',()=>assert.equal(originalRead.copyKind,'original'));
check('ordinary original resave is byte identical',()=>assert.ok(original.bytes.length>0));
assert.deepEqual((await resaveDsfV3(originalRead)).bytes,original.bytes);
console.log('Generating editable with all history branches');
const editable=await resaveDsfV3(originalRead,{copyKind:'writing-editable',envelope:await editableFixture(originalRead)});
await writeFile(new URL('editable.dsf',out),editable.bytes);
const offline={...options,getFont:()=>{throw new Error('FULL_FONT_FETCH_FORBIDDEN');},getNotice:()=>{throw new Error('NOTICE_FETCH_FORBIDDEN');}};
const readEditable=await loadDsfV3(new Uint8Array(await readFile(new URL('editable.dsf',out))),offline);
const saved=await resaveDsfV3(readEditable);await writeFile(new URL('editable-resaved.dsf',out),saved.bytes);
check('editable round trip deterministic',()=>assert.deepEqual(saved.bytes,editable.bytes));
check('deleted text and branch preserved',()=>{assert.ok(JSON.stringify(saved.handle.envelope).includes('蟹'));assert.ok(JSON.stringify(saved.handle.envelope).includes('鶴'));});
console.log('Generating shared without full fonts');
const shared=await resaveDsfV3(readEditable,{copyKind:'writing-shared'});await writeFile(new URL('shared.dsf',out),shared.bytes);
const readShared=await loadDsfV3(new Uint8Array(await readFile(new URL('shared.dsf',out))),offline),sharedSaved=await resaveDsfV3(readShared);
await writeFile(new URL('shared-resaved.dsf',out),sharedSaved.bytes);
check('shared round trip deterministic',()=>assert.deepEqual(sharedSaved.bytes,shared.bytes));
const longIdEnvelope=readEditable.envelope;longIdEnvelope.document.documentId='d'.repeat(128);
const longIdShared=await resaveDsfV3(readEditable,{copyKind:'writing-shared',envelope:longIdEnvelope});
check('maximum length document id can be shared',()=>assert.equal(longIdShared.handle.envelope.document.documentId.length,128));
check('shared omits secrets across every entry',()=>{for(const f of readWritingZip(shared.bytes)){const text=new TextDecoder().decode(f.bytes);assert.ok(!text.includes('削除済み秘密')&&!text.includes('別枝'));assert.notEqual(f.path,'writing/history.json');}});
check('all immutable original entries identical in all copies',()=>{for(const d of JSON.parse(new TextDecoder().decode(originalRead.readBytes('base.json'))).entries)for(const h of [readEditable,saved.handle,readShared,sharedSaved.handle])assert.deepEqual(h.readBytes(d.path),originalRead.readBytes(d.path));});
check('private base bytes cannot be mutated through getters',()=>{const b=readEditable.readBytes('meta.json');b.fill(0);assert.notEqual(readEditable.readBytes('meta.json')[0],0);});
check('original font notices and writing notices retained',()=>{for(const r of [...readShared.resources.original.fonts,...readShared.resources.writing.fonts])assert.ok(readShared.readBytes(r.license.noticePath).length>1000);});
await reject('shared cannot unlock',()=>resaveDsfV3(readShared,{copyKind:'writing-editable'}));
await reject('shared cannot accept replacement envelope',()=>resaveDsfV3(readShared,{envelope:readEditable.envelope}));
await reject('editable cannot silently discard all writing',()=>resaveDsfV3(readEditable,{copyKind:'original'}));
const changed=readEditable.envelope;changed.document.baseContentHash='0'.repeat(64);await reject('wrong original identity',()=>resaveDsfV3(readEditable,{envelope:changed}));
// Restore an older branch using only embedded history fonts, then save and reopen.
const restored=readEditable.envelope;restored.document.headRevisionId='r1';restored.document.pages=structuredClone(restored.history.revisions[1].pages);
const restoreCopy=await resaveDsfV3(readEditable,{envelope:restored});await writeFile(new URL('restored.dsf',out),restoreCopy.bytes);
check('history restore persists',()=>assert.equal(restoreCopy.handle.envelope.document.headRevisionId,'r1'));
const extra=readEditable.envelope,newPages=structuredClone(extra.document.pages),newText=newPages[1].objects[0];
newText.text+='龍';newText.runs[0].end++;newText.layout.push({start:newText.text.length-1,end:newText.text.length,x:20,y:80});
extra.history.revisions.push({id:'r4',parentId:'r2',operation:'新規文字',createdAt:'2026-10-11T01:00:00.000Z',pages:newPages});extra.document.pages=structuredClone(newPages);extra.document.headRevisionId='r4';
await reject('unprepared new glyph fails without changing old file',()=>resaveDsfV3(readEditable,{envelope:extra}));
check('failed save keeps original history',()=>assert.equal(readEditable.envelope.document.headRevisionId,'r2'));
const withFull=await loadDsfV3(editable.bytes,options),expanded=await resaveDsfV3(withFull,{envelope:extra});
check('prepared full font supports new glyph without changing original',()=>{assert.equal(expanded.handle.baseHash,originalRead.baseHash);assert.equal(expanded.handle.envelope.document.headRevisionId,'r4');});
await writeFile(new URL('new-glyph.dsf',out),expanded.bytes);
const mixed=originalFixture(options.catalog),imageBytes=new Uint8Array(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')),imageHash=await sha256(imageBytes);
mixed.bundle.manifests.ja.pages.push({id:'image1',pageLabel:'3',renderKind:'image',sourceAnchor:{kind:'fixed',blockId:'image1'},image:{href:`../assets/images/${imageHash}.webp`,mimeType:'image/webp',width:1,height:1}});mixed.bundle.index.languages.ja.pageCount=3;
mixed.images=[{path:`assets/images/${imageHash}.webp`,bytes:imageBytes}];
mixed.bundle.manifests.en=structuredClone(mixed.bundle.manifests.ja);mixed.bundle.manifests.en.language='en';mixed.bundle.index.languages.en={...mixed.bundle.index.languages.ja,href:'content/en.json'};
const mixedPackage=await createDsfV3Original(mixed,options),mixedSaved=await resaveDsfV3(mixedPackage.handle);
check('multiple languages and image bytes survive',()=>{assert.deepEqual(mixedSaved.bytes,mixedPackage.bytes);assert.deepEqual(mixedSaved.handle.readBytes(mixed.images[0].path),imageBytes);assert.equal(mixedSaved.handle.bundle.manifests.en.pages.length,3);});
await writeFile(new URL('mixed-languages.dsf',out),mixedPackage.bytes);
mixed.bundle.manifests.ja.pages[2].image.width=2;await reject('wrong WebP dimensions',()=>createDsfV3Original(mixed,options));
// Rewrite archive hashes after semantic mutations so failures exercise the inner contracts too.
async function mutate(bytes,change,rehash=true) {
    let files=readWritingZip(bytes);await change(files);
    if(rehash){const ds=[];for(const f of files.filter(f=>f.path!=='manifest.json'))ds.push({path:f.path,mimeType:f.path.endsWith('.json')?'application/json':f.path.endsWith('.woff2')?'font/woff2':'text/plain',byteLength:f.bytes.length,sha256:await sha256(f.bytes)});
        ds.sort((a,b)=>a.path<b.path?-1:1);files.find(f=>f.path==='manifest.json').bytes=canonicalBytes({schemaVersion:2,format:'dsf-archive-manifest-2',files:ds});}
    return writeWritingZip(files);
}
const editJson=(files,path,fn)=>{const f=files.find(f=>f.path===path),j=JSON.parse(new TextDecoder().decode(f.bytes));fn(j);f.bytes=canonicalBytes(j);};
for(const [name,change] of [
    ['history cycle',fs=>editJson(fs,'writing/history.json',h=>h.revisions[0].parentId='r3')],
    ['unknown writing field',fs=>editJson(fs,'writing/document.json',d=>d.hidden='secret')],
    ['missing notice',fs=>{const i=fs.findIndex(f=>f.path.startsWith('writing/licenses/'));fs.splice(i,1);}],
    ['unused entry',fs=>fs.push({path:'writing/secret.txt',bytes:new TextEncoder().encode('secret')})],
    ['extra resource declaration',fs=>editJson(fs,'writing/resources.json',d=>d.hidden='secret')],
    ['wrong text digest',fs=>editJson(fs,'writing/resources.json',d=>d.fonts[0].textDigest='0'.repeat(64))],
    ['wrong source identity',fs=>editJson(fs,'writing/resources.json',d=>d.fonts[0].sourceSha256='0'.repeat(64))],
    ['corrupt font',fs=>{const f=fs.find(f=>f.path.startsWith('writing/fonts/'));f.bytes[0]^=1;}],
    ['base payload mutation',fs=>editJson(fs,'meta.json',d=>d.title='changed')],
    ['format downgrade',fs=>editJson(fs,'format.json',d=>d.formatVersion=2)],
])await reject(name,async()=>loadDsfV3(await mutate(editable.bytes,change),options));
const corrupt=editable.bytes.slice();corrupt[45]^=1;await reject('CRC corruption',()=>loadDsfV3(corrupt,options));
for(const [name,mutateBytes] of [
    ['ZIP encrypted flag',b=>new DataView(b.buffer).setUint16(6,1,true)],
    ['ZIP size mismatch',b=>new DataView(b.buffer).setUint32(18,0xffffffff,true)],
    ['ZIP64 locator or trailing data',b=>new DataView(b.buffer).setUint32(b.length-22,0x06064b50,true)],
    ['ZIP count overflow',b=>new DataView(b.buffer).setUint16(b.length-12,0xffff,true)],
    ['ZIP central local disagreement',b=>{const v=new DataView(b.buffer),at=v.getUint32(b.length-6,true);v.setUint32(at+42,1,true);}],
])await reject(name,()=>{const b=editable.bytes.slice();mutateBytes(b);return loadDsfV3(b,options);});
const duplicate=readWritingZip(editable.bytes);duplicate.push(duplicate[0]);check('duplicate ZIP entry rejected before writing',()=>assert.throws(()=>writeWritingZip(duplicate)));
for(const path of ['../secret','writing//secret','/absolute','C:/secret'])check(`unsafe path ${path}`,()=>assert.throws(()=>writeWritingZip([{path,bytes:new Uint8Array()}])));
// A structurally valid declared archive with surplus font glyphs must fail even
// after the attacker recomputes path, descriptor and outer hashes.
await reject('shared rejects a full font masquerading as subset',async()=>{
    const bytes=await mutate(shared.bytes,async fs=>{const rf=fs.find(f=>f.path==='writing/resources.json'),j=JSON.parse(new TextDecoder().decode(rf.bytes)),r=j.fonts[0],old=r.path,b=await options.getFont(r.sourceFontId);
        r.sha256=await sha256(b);r.path=`writing/fonts/${r.sha256}.woff2`;r.byteLength=b.length;const f=fs.find(f=>f.path===old);f.path=r.path;f.bytes=b;rf.bytes=canonicalBytes(j);});return loadDsfV3(bytes,options);
});
await writeFile(new URL('catalog.json',out),JSON.stringify(options.catalog,null,2));
const record={passed:results.length,results,baseHash:originalRead.baseHash,files:{original:original.bytes.length,editable:editable.bytes.length,shared:shared.bytes.length},head:'b16f3fc87575a3c7173984c3677320446f319bf5',date:new Date().toISOString()};
await writeFile(new URL('verification.json',out),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
