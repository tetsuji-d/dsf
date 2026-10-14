import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fixture, SECRET_TEXT, FONT_IDS } from './fixtures.mjs';
import { validateWritingEnvelope, collectFontText, sharedCopy, describeBase, WRITING_LIMITS, validateDerivedFont } from '../../js/dsf-writing-contract.js';
const {files,base,context,editable,original} = await fixture();
const results=[];
const pass=(name,fn)=>{fn();results.push(name);};
const reject=(name,change)=>pass(name,()=>{const v=structuredClone(editable);change(v);assert.throws(()=>validateWritingEnvelope(v,context));});
pass('original',()=>assert.equal(validateWritingEnvelope(original,context),true));
pass('editable branches',()=>assert.equal(validateWritingEnvelope(editable,context),true));
const shared=sharedCopy(editable,context,'share1');
pass('shared has no history',()=>{assert.equal(validateWritingEnvelope(shared,context),true);assert.equal(JSON.stringify(shared).includes(SECRET_TEXT),false);});
pass('glyph union includes removed text and other branches',()=>{const s=collectFontText(editable,context)[FONT_IDS[0]];assert.ok(s.includes('蟹')&&s.includes('鶴'));});
pass('shared union excludes history-only text',()=>{const s=collectFontText(shared,context)[FONT_IDS[0]];assert.ok(!s.includes('蟹')&&!s.includes('鶴'));});
const mixed = structuredClone(shared);
const mixedText = mixed.document.pages[0].objects[0];
mixedText.text = 'か\u3099A';
mixedText.runs = [{...mixedText.runs[0],end:2},{...mixedText.runs[0],start:2,end:3,fontId:FONT_IDS[1]}];
mixedText.layout = [{start:0,end:2,x:20,y:20},{start:2,end:3,x:20,y:38}];
pass('multiple fonts within one text',()=>assert.equal(validateWritingEnvelope(mixed,context),true));
pass('normalization closure before glyph sorting',()=>{const s=collectFontText(mixed,context);assert.ok(s[FONT_IDS[0]].includes('が')&&s[FONT_IDS[0]].includes('か')&&s[FONT_IDS[0]].includes('\u3099'));assert.ok(!s[FONT_IDS[0]].includes('A')&&s[FONT_IDS[1]].includes('A'));});
pass('reject style splitting combining sequence',()=>{const v=structuredClone(mixed);v.document.pages[0].objects[0].runs[0].end=1;v.document.pages[0].objects[0].runs[1].start=1;assert.throws(()=>validateWritingEnvelope(v,context));});
pass('reject unpaired surrogate',()=>{const v=structuredClone(mixed);v.document.pages[0].objects[0].text='\ud800A';assert.throws(()=>validateWritingEnvelope(v,context));});
reject('wrong base',v=>v.document.baseContentHash='0'.repeat(64));
reject('unsupported format',v=>v.format.formatVersion=2);
reject('unknown field',v=>v.document.secret=SECRET_TEXT);
reject('missing parent',v=>v.history.revisions[1].parentId='missing');
reject('cycle',v=>v.history.revisions[0].parentId='r3');
reject('duplicate revision',v=>v.history.revisions[3].id='r2');
reject('head mismatch',v=>v.document.pages=[]);
reject('missing page',v=>v.document.pages[0].pageId='other');
reject('missing font',v=>v.document.pages[0].objects[0].runs[0].fontId='other');
reject('NaN point',v=>v.document.pages[0].objects[1].points[0].x=NaN);
reject('unknown object',v=>v.document.pages[0].objects[1].type='script');
reject('run gap',v=>v.document.pages[0].objects[0].runs[0].start=1);
reject('history ceiling',v=>v.history.revisions=Array(WRITING_LIMITS.revisions+1).fill(v.history.revisions[0]));
pass('JSON round trip',()=>assert.equal(validateWritingEnvelope(JSON.parse(JSON.stringify(editable)),context),true));
const reordered=await describeBase([...files].reverse());assert.equal(reordered.sha256,base.sha256);results.push('base canonical order');
const changed=structuredClone(files);changed[0].bytes[0]^=1;assert.notEqual((await describeBase(changed)).sha256,base.sha256);results.push('base byte mutation changes identity');
for(const p of ['../secret','writing/document.json','fonts//x.woff2','/meta.json']) {await assert.rejects(()=>describeBase([...files,{path:p,mimeType:'application/json',bytes:new Uint8Array()}]));results.push(`reject path ${p}`);}
await assert.rejects(()=>describeBase([...files,files[0]]));results.push('duplicate entry');
const catalog=JSON.parse(await readFile(new URL('../../docs/writing-w0-licenses/catalog.json',import.meta.url),'utf8'));
for(const source of catalog) {
    const h='a'.repeat(64),n=source.license.assetNoticeSha256;
    const resource={sourceFontId:source.id,sourceVersion:source.version,sourceSha256:source.asset.sha256,
        recipe:{id:'harfbuzzjs-1.6.3-woff2-0.1.1-w0',layoutFeatures:'*',normalizationClosure:'NFC+NFD',retainVariations:true,retainNames:true},
        textDigest:h,sha256:h,byteLength:20000,path:`writing/fonts/${h}.woff2`,license:{spdxId:'OFL-1.1',noticeSha256:n,noticePath:`writing/licenses/fonts/${n}.txt`}};
    pass(`${source.id} derived declaration`,()=>assert.equal(validateDerivedFont(resource,source,'writing'),true));
    for(const [name,change] of [
        ['wrong source',r=>r.sourceSha256=h],['missing notice',r=>r.license.noticePath=''],['wrong area',r=>r.path=`fonts/${h}.woff2`],
        ['no normalization closure',r=>r.recipe.normalizationClosure='none'],['no vertical features',r=>r.recipe.layoutFeatures='default']]) {
        pass(`${source.id} ${name}`,()=>{const r=structuredClone(resource);change(r);assert.throws(()=>validateDerivedFont(r,source,'writing'));});
    }
    pass(`${source.id} unconfirmed permission`,()=>{const c=structuredClone(source);c.license.permissions.newTextInput=null;assert.throws(()=>validateDerivedFont(resource,c,'writing'));});
    const assetNotice=await readFile(new URL(`../../docs/writing-w0-licenses/${source.id}-asset.txt`,import.meta.url));
    const {sha256}=await import('../../js/dsf-writing-contract.js');assert.equal(await sha256(assetNotice),n);results.push(`${source.id} notice bytes identity`);
}
const out=new URL('../../outputs/writing-w0/results/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('contracts.json',out),JSON.stringify({passed:results.length,results,baseHash:base.sha256},null,2));
await writeFile(new URL('fixtures.json',out),JSON.stringify({base:base.descriptor,original,editable,shared},null,2));
console.log(JSON.stringify({passed:results.length,baseHash:base.sha256}));
