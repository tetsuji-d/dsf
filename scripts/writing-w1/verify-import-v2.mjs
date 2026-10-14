import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {importWritingV2} from './import-v2.mjs';
import {nodeRuntime} from './node-runtime.mjs';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {writingArchiveKind,writeWritingZip} from '../../js/dsf-writing-zip.js';
import {sha256} from '../../js/dsf-writing-contract.js';
import {createReaderWritingModel} from '../../js/reader-writing-model.js';
const path=process.argv[2];assert.ok(path,'Provide a local v2 DSF path');
const input=new Uint8Array(await readFile(path)),sourceHash=await sha256(input),options=await nodeRuntime();
class Face{constructor(family){this.family=family;}async load(){return this;}}
const faces=new Set(),fontFaceSet={add:f=>faces.add(f),delete:f=>faces.delete(f),load:async()=>[...faces],check:()=>true};
const viewerOptions={FontFaceCtor:Face,fontFaceSet};
assert.equal(writingArchiveKind(input),'existing-dsf');
const result=await importWritingV2(input,options,viewerOptions);assert.equal(result.sourceSha256,sourceHash);assert.equal(faces.size,0);
const handle=await loadDsfV3(result.bytes,options),zip=await JSZip.loadAsync(input),index=JSON.parse(await zip.file('content.json').async('string'));
for(const [language,d] of Object.entries(index.languages)){
    const old=JSON.parse(await zip.file(d.href).async('string')),next=handle.bundle.manifests[language];
    for(const p of old.pages)for(const [object,key] of [[p.image,'href'],[p.background,'imageHref']])if(object?.[key]){
        const image=await zip.file(object[key].slice(3)).async('uint8array'),newPath=`assets/images/${await sha256(image)}.webp`;
        assert.deepEqual(handle.readBytes(newPath),image);object[key]='../'+newPath;
    }
    assert.deepEqual(next,old,'Page layout, text, order and styles are preserved');
}
const model=createReaderWritingModel(handle,options.catalog.map(c=>c.id)),lang=index.defaultLang,page=handle.bundle.manifests[lang].pages[0];
model.change(lang,page.id,'取込後の筆跡',objects=>[...objects,{id:'import-stroke',type:'stroke',tool:'pen',color:'#20272b',opacity:1,geometryVersion:1,baseWidth:2,points:[{x:10,y:10,pressure:.5,width:2},{x:20,y:20,pressure:.5,width:2}]}]);
const saved=await resaveDsfV3(handle,{copyKind:'writing-editable',envelope:model.envelope}),reloaded=await loadDsfV3(saved.bytes,options);
assert.equal(reloaded.baseHash,handle.baseHash);assert.deepEqual(reloaded.envelope,model.envelope);
const shared=await resaveDsfV3(reloaded,{copyKind:'writing-shared'});assert.equal(shared.handle.envelope.history,null);
assert.equal(await sha256(new Uint8Array(await readFile(path))),sourceHash,'Original disk file untouched');
// A declared Writing archive must never fall back to v2; partial/damaged formats stay strict.
const t=new TextEncoder(),diagnostic=writeWritingZip([{path:'mimetype',bytes:t.encode('test')},{path:'format.json',bytes:t.encode('{}')}]);assert.equal(writingArchiveKind(diagnostic),'writing');
const broken=input.slice();broken[35]^=1;await assert.rejects(()=>importWritingV2(broken,options,viewerOptions));
const evidence={ok:true,sourceHash,sourceBytes:input.length,convertedBytes:result.bytes.length,pages:result.pageCount,layoutEqual:true,imagesEqual:true,originalFileUnchanged:true,editableRoundtrip:true,sharedHistoryRemoved:true,corruptArchiveRejected:true};
await writeFile('outputs/writing-w1/import-v2-verification.json',JSON.stringify(evidence,null,2));console.log(evidence);
