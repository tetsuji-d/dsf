import assert from 'node:assert/strict';
import {writingExportName,prepareWritingFileExport,mountWritingFileExport} from '../../js/reader-writing-file-save.js';

assert.equal(writingExportName('潮騒の図書館.dsfr','Other title'),'潮騒の図書館.dsfr');
assert.equal(writingExportName('Book.DSFR'),'Book.DSFR');
assert.equal(writingExportName('old.dsf'),'old.dsfr');
assert.equal(writingExportName('Book.dsfr.zip'),'Book.dsfr');
assert.equal(writingExportName('','タイトル'),'タイトル.dsfr');
assert.equal(writingExportName('download.zip','タイトル'),'タイトル.dsfr');
assert.equal(writingExportName('Book.dsfr','',true),'Book-shared.dsfr');
const bytes=new Uint8Array([80,75,3,4,0,255,7]);
let checked,shared,called=false;
const prepared=prepareWritingFileExport(bytes,'原稿.dsfr',{
    canShare(data){checked=data.files[0];return true;},
    share(data){called=true;shared=data;return Promise.resolve();}
});
assert.equal(prepared.canShare,true);
const pending=prepared.share();
assert.equal(called,true,'sharing must start synchronously inside the click');
assert.equal(await pending,'shared');
assert.equal(shared.files[0],checked,'share the exact file checked by canShare');
assert.equal(shared.files[0].name,'原稿.dsfr');
assert.equal(shared.files[0].type,'application/octet-stream');
assert.deepEqual(new Uint8Array(await shared.files[0].arrayBuffer()),bytes);
for(const nav of [{},{share(){throw Error('must not share');},canShare(){return false;}},{share(){},canShare(){throw Error('blocked');}}]){
    const file=prepareWritingFileExport(bytes,'a.dsfr',nav);assert.equal(file.canShare,false);assert.equal(await file.share(),'unavailable');
}
for(const [name,status] of [['AbortError','cancelled'],['NotAllowedError','failed'],['DataError','failed']]){
    const file=prepareWritingFileExport(bytes,'a.dsfr',{canShare:()=>true,share:()=>Promise.reject(new DOMException('test',name))});
    assert.equal(await file.share(),status);
    assert.deepEqual(new Uint8Array(await file.file.arrayBuffer()),bytes,'cancel/failure preserves export bytes');
}
console.log('Writing save: original filenames, exact shared bytes, activation, unsupported/cancel/failure passed.');
// Exercise the UI completion boundary with a minimal DOM adapter and mocked OS sharing.
const navDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalTimeout=globalThis.setTimeout;
const doc={createElement:tag=>({tag,ownerDocument:doc,classList:{add(){}},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},replaceChildren(...children){this.children=children;}})};
try{
    globalThis.setTimeout=fn=>{fn();return 0;};
    for(const outcome of ['shared','cancelled','failed','unsupported']){
        let completed=0,calls=0;
        Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'iPhone',canShare:()=>outcome!=='unsupported',share:async()=>{
            calls++;if(outcome!=='shared')throw new DOMException('test',outcome==='cancelled'?'AbortError':'NotAllowedError');
        }}});
        const container=doc.createElement('div');
        const ui=mountWritingFileExport(container,{bytes,name:'sample.dsfr',onConfirm:()=>completed++});
        const button=text=>container.children.find(n=>n.tag==='button'&&n.textContent===text);
        const share=button('保存・共有'),confirm=button('ファイルに保存しました'),download=container.children.find(n=>n.tag==='a');
        assert.equal(confirm.hidden,true);confirm.onclick();assert.equal(completed,0);
        if(outcome!=='unsupported')await share.onclick();else assert.equal(share.hidden,true);
        assert.equal(calls,outcome==='unsupported'?0:1);
        assert.equal(completed,0,'OS sharing must never confirm saving by itself');
        assert.equal(confirm.hidden,outcome!=='shared');
        if(outcome!=='shared'){confirm.onclick();assert.equal(completed,0);download.onclick({preventDefault(){assert.fail('download unexpectedly blocked');}});}
        assert.equal(confirm.hidden,false);assert.equal(completed,0,'a download click is not save confirmation');
        confirm.onclick();assert.equal(completed,1);
        ui.dispose();assert.equal(download.onclick,null);
    }
    for(const [platform,mobile] of [[{userAgent:'Windows Chrome'},false],[{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0},false],[{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5},true],[{userAgent:'Android'},true]]){
        let shares=0;
        Object.defineProperty(globalThis,'navigator',{configurable:true,value:{...platform,canShare:()=>true,share:async()=>{shares++;}}});
        const container=doc.createElement('div'),ui=mountWritingFileExport(container,{bytes,name:'sample.dsfr'});
        const share=container.children.find(n=>n.tag==='button'&&n.textContent==='保存・共有');
        assert.equal(share.hidden,!mobile);
        await share.onclick();assert.equal(shares,mobile?1:0,'desktop must not invoke OS sharing even if canShare returns true');
        assert.equal(container.children.find(n=>n.tag==='a').hidden,false);
        ui.dispose();
    }
}finally{
    globalThis.setTimeout=originalTimeout;
    if(navDescriptor)Object.defineProperty(globalThis,'navigator',navDescriptor);else delete globalThis.navigator;
}
console.log('Writing save UI: cancel/failure keeps editing, fallback works, only explicit confirmation completes.');
if(process.argv[2]){
    const {readFile}=await import('node:fs/promises');
    const {nodeRuntime}=await import('./node-runtime.mjs');
    const {loadDsfV3}=await import('../../js/dsf-writing-package.js');
    const options=await nodeRuntime();
    const original=await loadDsfV3(await readFile(new URL('../../outputs/writing-w1/preview-sample.dsf',import.meta.url)),options);
    const saved=await loadDsfV3(await readFile(process.argv[2]),options);
    assert.equal(saved.baseHash,original.baseHash);
    const entries=JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries;
    for(const entry of entries)assert.deepEqual(saved.readBytes(entry.path),original.readBytes(entry.path));
    const objects=saved.envelope.document.pages.flatMap(p=>p.objects);
    assert.ok(objects.some(o=>o.type==='stroke'&&o.tool==='pen'));
    console.log(`Browser download reloaded: ${objects.length} objects; ${entries.length} original entries unchanged.`);
}
