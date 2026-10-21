/** Format 3 file API. No network, DOM, authoring state or cloud writes.
 * An opened handle owns private copies of original bytes. Resave has no base setter.
 */
import {canonicalBytes,sha256,describeBase,makeFormat,validateWritingEnvelope,validateDerivedFont,sharedCopy,ensure,WRITING_LIMITS} from './dsf-writing-contract.js';
import {fontTextDigest} from './dsf-writing-font-engine.js';
import {writeWritingZip,readWritingZip} from './dsf-writing-zip.js';
import {assertValidDsfDeliveryBundle} from './dsf-delivery-v2.js';
import {inspectDsfWebPBytes} from './dsf-release-byte-sealing.js';
import {writingRetainedObjects} from './reader-writing-history.js';
export const DSF_V3_MIME='application/vnd.dsf.content+zip';
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder(),sessions=new WeakMap();
function exact(o,keys) {ensure(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k)),'DSF3_KEYS');}
function json(bytes) {ensure(bytes&&bytes.length<=WRITING_LIMITS.jsonBytes,'DSF3_JSON_LIMIT');const text=decoder.decode(bytes),value=JSON.parse(text);ensure(decoder.decode(canonicalBytes(value))===text,'DSF3_CANONICAL_JSON');return value;}
function mime(path) {return path.endsWith('.json')?'application/json':path.endsWith('.woff2')?'font/woff2':path.endsWith('.webp')?'image/webp':'text/plain';}
const file=(path,bytes)=>({path,bytes,mimeType:mime(path)});
const jsonFile=(path,value)=>file(path,canonicalBytes(value));
function sameKeys(a,b) {return JSON.stringify([...a].sort())===JSON.stringify([...b].sort());}
function groupRuns(runs) {const out=Object.create(null);for(const {fontId,text} of runs)(out[fontId]??=[]).push(text);return Object.fromEntries(Object.entries(out).map(([id,text])=>[id,text.join('\n')]));}
export function originalFontText(bundle) {
    const runs=[];for(const m of Object.values(bundle.manifests))for(const p of m.pages)for(const line of p.lines||[])for(const r of line.runs)
        runs.push({fontId:m.styles[r.styleRef||line.styleRef].fontRef,text:r.text});return groupRuns(runs);
}
export function writingFontText(envelope) {
    const runs=[];
    for(const o of writingRetainedObjects(envelope))if(o.type==='text')for(const r of o.runs)runs.push({fontId:r.fontId,text:o.text.slice(r.start,r.end)});
    return groupRuns(runs);
}
function sourceFor(options,id) {const source=options.catalog.find(c=>c.id===id);ensure(source&&Array.isArray(source.nameRecords),'DSF3_FONT_SOURCE');return source;}
async function derivedFiles(texts,area,getBytes,options) {
    const fonts=[],files=[];
    for(const [id,text] of Object.entries(texts).sort(([a],[b])=>a.localeCompare(b))) {
        const source=sourceFor(options,id),input=await getBytes(id),bytes=await options.engine.derive(input,text,source),hash=await sha256(bytes),prefix=area==='writing'?'writing/':'';
        const notice=await options.getNotice(id);ensure(await sha256(notice)===source.license.assetNoticeSha256,'DSF3_NOTICE_BYTES');
        const descriptor={sourceFontId:id,sourceVersion:source.version,sourceSha256:source.asset.sha256,
            recipe:{id:'harfbuzzjs-1.6.3-woff2-0.1.1-w0',layoutFeatures:'*',normalizationClosure:'NFC+NFD',retainVariations:true,retainNames:true},
            textDigest:await fontTextDigest(text),sha256:hash,byteLength:bytes.length,path:`${prefix}fonts/${hash}.woff2`,
            license:{spdxId:source.license.spdxId,noticeSha256:source.license.assetNoticeSha256,noticePath:`${prefix}licenses/fonts/${source.license.assetNoticeSha256}.txt`}};
        validateDerivedFont(descriptor,source,area);fonts.push(descriptor);files.push(file(descriptor.path,bytes),file(descriptor.license.noticePath,notice));
    }
    return {resources:{schemaVersion:1,fonts},files:[...new Map(files.map(f=>[f.path,f])).values()]};
}
async function verifyResources(resources,texts,area,byPath,used,options) {
    exact(resources,['schemaVersion','fonts']);ensure(resources.schemaVersion===1&&Array.isArray(resources.fonts)&&resources.fonts.length<=32,'DSF3_RESOURCES');
    const ids=new Set();
    for(const r of resources.fonts) {
        const source=sourceFor(options,r.sourceFontId);validateDerivedFont(r,source,area);ensure(!ids.has(source.id)&&Object.hasOwn(texts,source.id),'DSF3_FONT_UNUSED');ids.add(source.id);
        const b=byPath.get(r.path),notice=byPath.get(r.license.noticePath);ensure(b&&b.length===r.byteLength&&await sha256(b)===r.sha256,'DSF3_FONT_BYTES');
        ensure(notice&&await sha256(notice)===r.license.noticeSha256,'DSF3_NOTICE_BYTES');
        ensure(await fontTextDigest(texts[source.id])===r.textDigest,'DSF3_FONT_TEXT');
        await options.engine.verify(b,texts[source.id],source,true);used.add(r.path);used.add(r.license.noticePath);
    }
    ensure(sameKeys(ids,Object.keys(texts)),'DSF3_FONT_MISSING');
}
async function verifyBase(files,options) {
    const described=await describeBase(files),byPath=new Map(files.map(f=>[f.path,f.bytes])),get=path=>json(byPath.get(path));
    const meta=get('meta.json'),index=get('content.json'),resources=get('resources.json'),manifests={},used=new Set(['meta.json','content.json','resources.json']);
    ensure(typeof meta.workId==='string'&&meta.workId&&typeof meta.releaseId==='string'&&meta.releaseId,'DSF3_IDENTITY');
    for(const [language,d] of Object.entries(index.languages||{})) {
        const path=`content/${language}.json`;ensure(d.href===path&&byPath.has(path)&&await sha256(byPath.get(path))===d.sha256,'DSF3_LANGUAGE');manifests[language]=get(path);used.add(path);
    }
    const bundle={index,manifests};assertValidDsfDeliveryBundle(bundle);
    const texts=originalFontText(bundle);await verifyResources(resources,texts,'original',byPath,used,options);
    ensure(sameKeys(Object.keys(index.fonts),Object.keys(texts)),'DSF3_FONT_DECLARATIONS');
    for(const r of resources.fonts) {const f=index.fonts[r.sourceFontId],source=sourceFor(options,r.sourceFontId);
        exact(f,['family','version','source','href','sha256']);ensure(f.source==='embedded'&&f.href===r.path&&f.sha256===r.sha256&&f.family===source.family&&f.version===source.version,'DSF3_FONT_DECLARATION');}
    const pageKeys=new Set();
    for(const [language,m] of Object.entries(manifests))for(const p of m.pages) {
        pageKeys.add(`${language}/${p.id}`);
        for(const image of [p.image,p.background?.imageHref?{href:p.background.imageHref}:null].filter(Boolean)) {
            ensure(/^\.\.\/assets\/images\/[a-f0-9]{64}\.webp$/.test(image.href),'DSF3_IMAGE_PATH');const path=image.href.slice(3),bytes=byPath.get(path);
            ensure(bytes&&await sha256(bytes)===path.slice(14,-5),'DSF3_IMAGE_HASH');
            const info=await inspectDsfWebPBytes(bytes);if(image.width!==undefined)ensure(info.width===image.width&&info.height===image.height,'DSF3_IMAGE_SIZE');used.add(path);
        }
    }
    ensure(sameKeys(used,byPath.keys()),'DSF3_UNUSED_BASE_ENTRY');return {described,bundle,meta,resources,pageKeys};
}
async function packageFiles(baseFiles,envelope,resources,writingFiles,options) {
    const base=await describeBase(baseFiles);ensure(envelope.format.base.sha256===base.sha256,'DSF3_BASE_MISMATCH');
    const files=[file('mimetype',encoder.encode(DSF_V3_MIME)),jsonFile('format.json',envelope.format),jsonFile('base.json',base.descriptor),...baseFiles];
    if(envelope.document){files.push(jsonFile('writing/document.json',envelope.document),jsonFile('writing/resources.json',resources),...writingFiles);
        if(envelope.history)files.push(jsonFile('writing/history.json',envelope.history));}
    const descriptors=[];for(const f of files)descriptors.push({path:f.path,mimeType:f.mimeType,byteLength:f.bytes.length,sha256:await sha256(f.bytes)});
    descriptors.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    files.push(jsonFile('manifest.json',{schemaVersion:2,format:'dsf-archive-manifest-2',files:descriptors}));
    files.sort((a,b)=>a.path==='mimetype'?-1:b.path==='mimetype'?1:a.path<b.path?-1:1);
    const bytes=writeWritingZip(files),handle=await loadDsfV3(bytes,options);return {bytes,blob:new Blob([bytes],{type:DSF_V3_MIME}),sha256:await sha256(bytes),handle};
}
/** Press-side entry point, accepts a confirmed fixed-layout delivery bundle. */
export async function createDsfV3Original({bundle,meta,images=[]},options) {
    bundle=structuredClone(bundle);assertValidDsfDeliveryBundle(bundle);
    const generated=await derivedFiles(originalFontText(bundle),'original',async id=>{
        const bytes=await options.getFont(id);ensure(await sha256(bytes)===sourceFor(options,id).asset.sha256,'DSF3_SOURCE_BYTES');return bytes;
    },options);
    bundle.index.fonts=Object.fromEntries(generated.resources.fonts.map(r=>{const s=sourceFor(options,r.sourceFontId);return [s.id,{family:s.family,version:s.version,source:'embedded',href:r.path,sha256:r.sha256}];}));
    const baseFiles=[jsonFile('meta.json',meta),jsonFile('resources.json',generated.resources),...generated.files,...images.map(f=>file(f.path,new Uint8Array(f.bytes)))];
    for(const [language,m] of Object.entries(bundle.manifests)) {const f=jsonFile(`content/${language}.json`,m);baseFiles.push(f);bundle.index.languages[language].href=f.path;bundle.index.languages[language].sha256=await sha256(f.bytes);}
    baseFiles.push(jsonFile('content.json',bundle.index));const base=await verifyBase(baseFiles,options);
    return packageFiles(baseFiles,{format:makeFormat('original',base.described.sha256),document:null,history:null},null,[],options);
}
export async function loadDsfV3(input,options) {
    ensure(options&&Array.isArray(options.catalog)&&options.engine,'DSF3_TRUST_CONTEXT');
    if(input instanceof Blob){ensure(input.size<=WRITING_LIMITS.expandedBytes+1024*1024,'ZIP_LIMIT');input=new Uint8Array(await input.arrayBuffer());}
    await options.onProgress?.('integrity','ファイルの内容を確認しています…','Checking file contents…');
    const files=readWritingZip(input),byPath=new Map(files.map(f=>[f.path,f.bytes]));
    ensure(decoder.decode(byPath.get('mimetype'))===DSF_V3_MIME,'DSF3_MIMETYPE');const manifest=json(byPath.get('manifest.json'));
    exact(manifest,['schemaVersion','format','files']);ensure(manifest.schemaVersion===2&&manifest.format==='dsf-archive-manifest-2'&&Array.isArray(manifest.files),'DSF3_MANIFEST');
    const names=new Set();let previous='';for(const d of manifest.files) {
        exact(d,['path','mimeType','byteLength','sha256']);ensure(d.path>previous&&d.path!=='manifest.json','DSF3_MANIFEST_ORDER');previous=d.path;names.add(d.path);
        const b=byPath.get(d.path);ensure(b&&d.mimeType===mime(d.path)&&d.byteLength===b.length&&d.sha256===await sha256(b),'DSF3_ENTRY_HASH');
    }
    ensure(sameKeys(names,[...byPath.keys()].filter(p=>p!=='manifest.json')),'DSF3_ENTRY_SET');
    const format=json(byPath.get('format.json')),descriptor=json(byPath.get('base.json'));exact(descriptor,['schemaVersion','entries']);
    ensure(descriptor.schemaVersion===1&&Array.isArray(descriptor.entries),'DSF3_BASE');
    await options.onProgress?.('original-fonts','本文の書体を確認しています…','Checking document fonts…');
    const baseFiles=descriptor.entries.map(d=>file(d.path,byPath.get(d.path))),base=await verifyBase(baseFiles,options);
    ensure(await sha256(canonicalBytes(descriptor))===base.described.sha256,'DSF3_BASE_DESCRIPTOR');
    const context={baseHash:base.described.sha256,pageKeys:base.pageKeys,fontIds:new Set(options.catalog.map(c=>c.id))};
    const document=byPath.has('writing/document.json')?json(byPath.get('writing/document.json')):null,history=byPath.has('writing/history.json')?json(byPath.get('writing/history.json')):null;
    const envelope={format,document,history};validateWritingEnvelope(envelope,context);
    const used=new Set(['mimetype','manifest.json','format.json','base.json',...baseFiles.map(f=>f.path)]);let resources=null;
    await options.onProgress?.('writing-fonts','書き込みと履歴を確認しています…','Checking writing and history…');
    if(document) {resources=json(byPath.get('writing/resources.json'));used.add('writing/document.json');used.add('writing/resources.json');if(history)used.add('writing/history.json');
        await verifyResources(resources,writingFontText(envelope),'writing',byPath,used,options);}
    ensure(sameKeys(used,byPath.keys()),'DSF3_UNUSED_ENTRY');
    const handle=Object.freeze({get copyKind(){return format.copyKind;},get baseHash(){return base.described.sha256;},
        get envelope(){return structuredClone(envelope);},get bundle(){return structuredClone(base.bundle);},get meta(){return structuredClone(base.meta);},
        get inventory(){return structuredClone(manifest.files);},get resources(){return structuredClone({original:base.resources,writing:resources});},
        readBytes(path){const b=byPath.get(path);ensure(b,'DSF3_MISSING_ENTRY');return b.slice();}});
    sessions.set(handle,{baseFiles,base,envelope,resources,byPath,context,options});return handle;
}
/** Edits and sharing preserve all original bytes. Shared input cannot be unlocked. */
export async function resaveDsfV3(handle,{copyKind=handle.copyKind,envelope}={}) {
    const s=sessions.get(handle);ensure(s,'DSF3_HANDLE');
    ensure(s.envelope.format.copyKind!=='writing-shared'||(copyKind==='writing-shared'&&!envelope),'DSF3_SHARED_LOCKED');
    ensure(copyKind===s.envelope.format.copyKind||s.envelope.format.copyKind==='original'&&copyKind==='writing-editable'
        ||s.envelope.format.copyKind==='writing-editable'&&copyKind==='writing-shared','DSF3_COPY_TRANSITION');
    if(!envelope&&copyKind===s.envelope.format.copyKind) {
        const payload=[...s.byPath].filter(([path])=>/^writing\/(fonts|licenses)\//.test(path)).map(([path,bytes])=>file(path,bytes));
        return packageFiles(s.baseFiles,s.envelope,s.resources,payload,s.options);
    }
    let next=envelope?structuredClone(envelope):structuredClone(s.envelope);
    if(envelope)ensure(next.format.copyKind==='writing-editable'&&copyKind!=='original','DSF3_EDIT_KIND');
    validateWritingEnvelope(next,s.context);
    if(copyKind==='writing-shared'&&next.format.copyKind==='writing-editable')next=sharedCopy(next,s.context,`${next.document.documentId.slice(0,121)}-shared`);
    ensure(next.format.copyKind===copyKind,'DSF3_COPY_KIND');
    const resources=s.resources?.fonts||[],getStored=id=>resources.find(r=>r.sourceFontId===id);
    const options={...s.options,getNotice:async id=>{const r=getStored(id);return r?s.byPath.get(r.license.noticePath):s.options.getNotice(id);}};
    await options.onProgress?.('subset','保存用の文字をまとめています…','Preparing text for the saved file…');
    const generated=next.document?await derivedFiles(writingFontText(next),'writing',async id=>{
        const r=getStored(id);if(r){const bytes=s.byPath.get(r.path);try{await s.options.engine.verify(bytes,writingFontText(next)[id],sourceFor(options,id),false);return bytes;}catch(e){if(e.message!=='FONT_GLYPH_MISSING')throw e;}}
        const bytes=await s.options.getFont(id);ensure(await sha256(bytes)===sourceFor(options,id).asset.sha256,'DSF3_SOURCE_BYTES');return bytes;
    },options):{resources:null,files:[]};
    await options.onProgress?.('package','保存ファイルを作成しています…','Creating the file…');
    const output=await packageFiles(s.baseFiles,next,generated.resources,generated.files,options);
    ensure(output.handle.baseHash===handle.baseHash,'DSF3_ORIGINAL_CHANGED');return output;
}
