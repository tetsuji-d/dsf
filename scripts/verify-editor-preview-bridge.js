import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('js/viewer.js','utf8');
const start=source.indexOf("    const editorPreview=params.get('editorPreview');");
assert(start>0);
const bridge=source.slice(start,source.indexOf('    const ownerDraftPid',start));
for(const fail of [false,true]) {
    let receive,loads=0,removed=0;
    const messages=[],opener={postMessage:message=>messages.push(message.type)};
    const context={params:new URLSearchParams('editorPreview=test'),Blob,File,location:{origin:'https://studio.test'},
        window:{opener,addEventListener:(_,fn)=>receive=fn,removeEventListener:()=>removed++},
        document:{getElementById:()=>({})},showStandaloneEmpty(){},resizeCanvas(){},updateUiVisibility(){},
        loadViewerFile:async(file,options)=>{assert.equal(file.name,'editor-preview.dsf');assert.equal(options.preview,true);loads++;if(fail)throw Error('Invalid package');}};
    vm.runInNewContext('(async()=>{'+bridge+'})()',context);
    assert.deepEqual(messages,['dsf-editor-preview-ready']);
    const good={source:opener,origin:'https://studio.test',data:{nonce:'test',type:'dsf-editor-preview-package',blob:new Blob(['test'])}};
    for(const bad of [{...good,source:{}},{...good,origin:'https://other.test'},{...good,data:{...good.data,nonce:'other'}},{...good,data:{...good.data,blob:'not a blob'}}])await receive(bad);
    assert.equal(loads,0);assert.equal(removed,0);
    await receive(good);assert.equal(loads,1);assert.equal(removed,1);
    assert.equal(messages.at(-1),fail?'dsf-editor-preview-failed':'dsf-editor-preview-loaded');
}
console.log('PASS editor preview bridge: opener, origin, nonce, Blob, one-shot receive, success/failure acknowledgement');
