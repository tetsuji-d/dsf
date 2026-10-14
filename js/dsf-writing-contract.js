/** W0 experimental contract. Not connected to production readers or writers. */
import { serializeDsfReleaseJson } from './dsf-release-assembly.js';
import {WRITING_HISTORY_OPERATIONS,writingPageKey,applyWritingDelta,writingRetainedObjects} from './reader-writing-history.js';

export const WRITING_LIMITS = Object.freeze({
    fontBytes: 16 * 1024 * 1024, sfntBytes: 32 * 1024 * 1024,
    jsonBytes: 8 * 1024 * 1024, entries: 4096, expandedBytes: 256 * 1024 * 1024,
    revisions: WRITING_HISTORY_OPERATIONS + 1, objects: 4096, points: 200000, textUnits: 200000,
}); // W0 conservative ceilings; mobile acceptance must precede product activation.
const encoder = new TextEncoder();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
export function ensure(condition, code) { if (!condition) throw new Error(code); }
function exact(obj, keys) {
    ensure(obj && typeof obj === 'object' && !Array.isArray(obj), 'WRITING_RECORD');
    ensure(Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k)), 'WRITING_KEYS');
}
function id(value) { ensure(typeof value === 'string' && idPattern.test(value), 'WRITING_ID'); }
function finite(v, min, max) { ensure(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, 'WRITING_NUMBER'); }
function list(value, max) { ensure(Array.isArray(value) && value.length <= max, 'WRITING_LIMIT'); }
export const canonicalBytes = value => encoder.encode(serializeDsfReleaseJson(value));
export async function sha256(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function validatePath(path) {
    ensure(typeof path === 'string' && path.length <= 256 && /^[A-Za-z0-9_./-]+$/.test(path)
        && path.split('/').every(s => s && s !== '.' && s !== '..'), 'WRITING_PATH');
}
function basePath(path) {
    return ['meta.json', 'content.json', 'resources.json'].includes(path)
        || /^content\/[a-z0-9-]+\.json$/.test(path)
        || /^assets\/images\/[a-f0-9]{64}\.webp$/.test(path)
        || /^fonts\/[a-f0-9]{64}\.woff2$/.test(path)
        || /^licenses\/fonts\/[a-f0-9]{64}\.txt$/.test(path);
}
/** Hashes expanded immutable original bytes, never Writing or ZIP compression. */
export async function describeBase(files) {
    list(files, WRITING_LIMITS.entries);
    let total = 0; const seen = new Set(); const entries = [];
    for (const file of files) {
        exact(file, ['path', 'mimeType', 'bytes']); validatePath(file.path);
        ensure(basePath(file.path) && !seen.has(file.path), 'WRITING_BASE_PATH'); seen.add(file.path);
        ensure(file.bytes instanceof Uint8Array, 'WRITING_BYTES');
        total += file.bytes.length; ensure(total <= WRITING_LIMITS.expandedBytes, 'WRITING_LIMIT');
        const expectedMime = file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.webp') ? 'image/webp'
            : file.path.endsWith('.woff2') ? 'font/woff2' : 'text/plain';
        ensure(file.mimeType === expectedMime, 'WRITING_MIME');
        entries.push({ path: file.path, mimeType: file.mimeType, byteLength: file.bytes.length, sha256: await sha256(file.bytes) });
    }
    ensure(seen.has('meta.json') && seen.has('content.json'), 'WRITING_BASE_REQUIRED');
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const descriptor = { schemaVersion: 1, entries };
    return { descriptor, bytes: canonicalBytes(descriptor), sha256: await sha256(canonicalBytes(descriptor)) };
}
export function makeFormat(copyKind, baseHash) {
    ensure(['original', 'writing-editable', 'writing-shared'].includes(copyKind), 'WRITING_KIND');
    ensure(hashPattern.test(baseHash), 'WRITING_HASH');
    return { formatVersion: 3, kind: 'dsf', copyKind, base: { path: 'base.json', sha256: baseHash },
        writing: copyKind === 'original' ? null : { schemaVersion: 1, document: 'writing/document.json',
            history: copyKind === 'writing-editable' ? 'writing/history.json' : null } };
}
function point(p) { list(p, 2); ensure(p.length === 2, 'WRITING_POINT'); finite(p[0], -360, 720); finite(p[1], -640, 1280); }
function color(v) { ensure(typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v), 'WRITING_COLOR'); }
function rect(v) { list(v, 4); ensure(v.length === 4, 'WRITING_RECT'); point(v.slice(0, 2)); finite(v[2], 0.01, 1080); finite(v[3], 0.01, 1920); }
export function validateWritingPages(pages, pageKeys, fonts) {
    list(pages, WRITING_LIMITS.entries); const seenPages = new Set(); const seenObjects = new Set();
    let points = 0, textUnits = 0;
    for (const page of pages) {
        exact(page, ['language', 'pageId', 'objects']);
        const key = `${page.language}/${page.pageId}`;
        ensure(pageKeys.has(key) && !seenPages.has(key), 'WRITING_PAGE'); seenPages.add(key);
        list(page.objects, WRITING_LIMITS.objects);
        for (const o of page.objects) {
            id(o.id); ensure(!seenObjects.has(o.id), 'WRITING_DUPLICATE_OBJECT'); seenObjects.add(o.id);
            ensure(seenObjects.size <= WRITING_LIMITS.objects, 'WRITING_LIMIT');
            if(Object.hasOwn(o,'locked'))ensure(typeof o.locked==='boolean','WRITING_OBJECT_LOCK');
            if (o.type === 'text') {
                exact(o, [...(Object.hasOwn(o,'locked')?['locked']:[]),'id', 'type', 'text', 'rect', 'writingMode', 'align', 'runs', 'layout']); rect(o.rect);
                ensure(typeof o.text === 'string' && o.text.isWellFormed(), 'WRITING_TEXT'); textUnits += o.text.length;
                ensure(['horizontal-tb', 'vertical-rl'].includes(o.writingMode) && ['start', 'center', 'end'].includes(o.align), 'WRITING_TEXT_STYLE');
                const boundaries = new Set([o.text.length, ...[...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(o.text)].map(s => s.index)]);
                list(o.runs, WRITING_LIMITS.textUnits); let end = 0;
                for (const run of o.runs) {
                    exact(run, ['start', 'end', 'fontId', 'weight', 'size', 'color']);
                    ensure(run.start === end && run.end > run.start && boundaries.has(run.start) && boundaries.has(run.end), 'WRITING_RUN_RANGE');
                    ensure(fonts.has(run.fontId), 'WRITING_FONT'); finite(run.weight, 100, 900); finite(run.size, 1, 360); color(run.color); end = run.end;
                }
                ensure(end === o.text.length, 'WRITING_RUN_COVERAGE');
                list(o.layout, WRITING_LIMITS.textUnits);
                // Fixed text spans must stay within one style run on reload.
                let layoutEnd = 0;
                for (const pos of o.layout) {
                    exact(pos, ['start', 'end', 'x', 'y']);
                    ensure(pos.start === layoutEnd && pos.end > pos.start && boundaries.has(pos.start) && boundaries.has(pos.end), 'WRITING_LAYOUT');
                    ensure(o.runs.some(run => run.start <= pos.start && run.end >= pos.end), 'WRITING_LAYOUT_STYLE');
                    point([pos.x, pos.y]); layoutEnd = pos.end;
                }
                ensure(layoutEnd === o.text.length, 'WRITING_LAYOUT');
            } else if (o.type === 'stroke') {
                const inkBrush=o.tool==='brush'&&[2,3,4].includes(o.geometryVersion);
                exact(o, [...(Object.hasOwn(o,'locked')?['locked']:[]),'id', 'type', 'tool', 'color', 'opacity', 'baseWidth', 'geometryVersion', 'points', ...(inkBrush?['inkAmount']:[])]);
                ensure(['pen', 'brush', 'marker', 'highlighter', 'correction'].includes(o.tool) && (o.geometryVersion === 1||inkBrush), 'WRITING_STROKE');
                if(inkBrush)finite(o.inkAmount,0,1);
                if(o.tool==='correction')ensure(typeof o.color==='string'&&o.color.toLowerCase()==='#ffffff'&&o.opacity===1,'WRITING_CORRECTION');
                color(o.color); finite(o.opacity, 0, 1); finite(o.baseWidth, 0.01, 360); list(o.points, WRITING_LIMITS.points); ensure(o.points.length > 0, 'WRITING_STROKE');
                for (const p of o.points) { exact(p, ['x', 'y', 'pressure', 'width',...(o.geometryVersion===4?['dryness']:[])]); point([p.x, p.y]); finite(p.pressure, 0, 1); finite(p.width, 0.01, 360);if(o.geometryVersion===4)finite(p.dryness,0,1); }
                points += o.points.length;
            } else if (o.type === 'line') {
                exact(o, [...(Object.hasOwn(o,'locked')?['locked']:[]),...(Object.hasOwn(o,'arrowHead')?['arrowHead']:[]),'id', 'type', 'from', 'to', 'color', 'width', 'arrow']); point(o.from); point(o.to); color(o.color); finite(o.width, 0.01, 360);
                ensure(['none', 'start', 'end', 'both'].includes(o.arrow), 'WRITING_ARROW');
                if(Object.hasOwn(o,'arrowHead'))ensure(['open','triangle','circle','diamond'].includes(o.arrowHead),'WRITING_ARROW_HEAD');
            } else if (o.type === 'shape') {
                exact(o, [...(Object.hasOwn(o,'locked')?['locked']:[]),'id', 'type', 'shape', 'rect', 'color', 'fill', 'width', 'opacity']); rect(o.rect); color(o.color);
                ensure(['rect', 'ellipse'].includes(o.shape), 'WRITING_SHAPE'); if (o.fill !== null) color(o.fill);
                finite(o.width, 0.01, 360); finite(o.opacity, 0, 1);
            } else ensure(false, 'WRITING_OBJECT_TYPE');
        }
    }
    ensure(points <= WRITING_LIMITS.points && textUnits <= WRITING_LIMITS.textUnits, 'WRITING_LIMIT');
}
/** Validates JSON contract only. Does not claim ZIP, font bytes or delivery-v2 validation. */
export function validateWritingEnvelope(value, { baseHash, pageKeys, fontIds }) {
    exact(value, ['format', 'document', 'history']);
    ensure(canonicalBytes(value).length <= WRITING_LIMITS.jsonBytes, 'WRITING_LIMIT');
    const f = value.format;
    ensure(serializeDsfReleaseJson(f) === serializeDsfReleaseJson(makeFormat(f.copyKind, baseHash)), 'WRITING_FORMAT');
    if (f.copyKind === 'original') { ensure(value.document === null && value.history === null, 'WRITING_ORIGINAL'); return true; }
    const d = value.document;
    exact(d, ['schemaVersion', 'documentId', 'baseContentHash', 'headRevisionId', 'pages']);
    ensure(d.schemaVersion === 1 && d.baseContentHash === baseHash, 'WRITING_BASE'); id(d.documentId);
    validateWritingPages(d.pages, pageKeys, fontIds);
    if (f.copyKind === 'writing-shared') { ensure(d.headRevisionId === null && value.history === null, 'WRITING_SHARED_HISTORY'); return true; }
    const h = value.history; exact(h, ['schemaVersion', 'revisions']); ensure([1,2].includes(h.schemaVersion), 'WRITING_HISTORY');
    if(h.schemaVersion===2){validateDeltaHistory(h,d,pageKeys,fontIds);return true;}
    // Import-only compatibility for the prototype's snapshot history.
    list(h.revisions, 256); const seen = new Map(); let roots = 0;
    for (const r of h.revisions) {
        exact(r, ['id', 'parentId', 'operation', 'createdAt', 'pages']); id(r.id);
        ensure(!seen.has(r.id), 'WRITING_REVISION_DUPLICATE');
        ensure(typeof r.operation === 'string' && r.operation.length > 0 && r.operation.length <= 80, 'WRITING_OPERATION');
        ensure(typeof r.createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.createdAt) && Number.isFinite(Date.parse(r.createdAt)), 'WRITING_TIME');
        if (r.parentId === null) { roots++; ensure(r.pages.length === 0, 'WRITING_ROOT'); }
        else ensure(seen.has(r.parentId), 'WRITING_PARENT'); // topological order rejects cycles / missing parents.
        validateWritingPages(r.pages, pageKeys, fontIds); seen.set(r.id, r);
    }
    ensure(roots === 1 && seen.has(d.headRevisionId), 'WRITING_HEAD');
    ensure(serializeDsfReleaseJson(d.pages) === serializeDsfReleaseJson(seen.get(d.headRevisionId).pages), 'WRITING_HEAD_STATE');
    return true;
}
function validateDeltaHistory(h,d,pageKeys,fontIds){
    list(h.revisions,WRITING_LIMITS.revisions);ensure(h.revisions.length>0,'WRITING_HEAD');const ids=new Set();
    for(const [i,r] of h.revisions.entries()){
        exact(r,['id','parentId','operation','createdAt','changes']);id(r.id);ensure(!ids.has(r.id),'WRITING_REVISION_DUPLICATE');ids.add(r.id);
        ensure(r.parentId===(i?h.revisions[i-1].id:null),'WRITING_PARENT');
        ensure(typeof r.operation==='string'&&r.operation.length>0&&r.operation.length<=80,'WRITING_OPERATION');
        ensure(typeof r.createdAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.createdAt)&&Number.isFinite(Date.parse(r.createdAt)),'WRITING_TIME');
        list(r.changes,WRITING_LIMITS.entries);if(!i)ensure(!r.changes.length,'WRITING_ROOT');
        const keys=new Set();
        for(const c of r.changes){
            exact(c,['language','pageId','beforeOrder','afterOrder','objects']);const key=writingPageKey(c);
            ensure(pageKeys.has(key)&&!keys.has(key),'WRITING_PAGE');keys.add(key);
            for(const order of [c.beforeOrder,c.afterOrder]){list(order,WRITING_LIMITS.objects);order.forEach(id);ensure(new Set(order).size===order.length,'WRITING_DUPLICATE_OBJECT');}
            list(c.objects,WRITING_LIMITS.objects);const objects=new Set();
            for(const e of c.objects){exact(e,['id','before','after']);id(e.id);ensure(!objects.has(e.id)&&(e.before||e.after),'WRITING_DUPLICATE_OBJECT');objects.add(e.id);
                for(const field of ['before','after'])if(e[field]){ensure(e[field].id===e.id&&c[field+'Order'].includes(e.id),'WRITING_HISTORY_STATE');}
            }
            for(const field of ['before','after'])validateWritingPages([{language:c.language,pageId:c.pageId,objects:c.objects.map(e=>e[field]).filter(Boolean)}],pageKeys,fontIds);
        }
    }
    const cursor=h.revisions.findIndex(r=>r.id===d.headRevisionId);ensure(cursor>=0,'WRITING_HEAD');
    const state=new Map(d.pages.map(p=>[writingPageKey(p),p]));
    const apply=(r,forward)=>{for(const c of r.changes){const key=writingPageKey(c),objects=applyWritingDelta(state.get(key)?.objects||[],c,forward);
        if(objects.length)state.set(key,{language:c.language,pageId:c.pageId,objects});else state.delete(key);}};
    for(let i=cursor;i>0;i--)apply(h.revisions[i],false);
    // Check bounds and identity in all reachable states, including retained redo.
    validateWritingPages([...state.values()],pageKeys,fontIds);
    for(const r of h.revisions.slice(1)){apply(r,true);validateWritingPages([...state.values()],pageKeys,fontIds);}
}
export function collectFontText(envelope, context) {
    validateWritingEnvelope(envelope, context);
    const sets = new Map();
    for (const o of writingRetainedObjects(envelope)) if (o.type === 'text') {
        for (const run of o.runs) {
            if (!sets.has(run.fontId)) sets.set(run.fontId, new Set());
            // Preserve normalization closure before sorting destroys adjacent combining sequences.
            const text = o.text.slice(run.start, run.end);
            for (const c of text + text.normalize('NFC') + text.normalize('NFD')) if (c !== '\n' && c !== '\r') sets.get(run.fontId).add(c);
        }
    }
    return Object.fromEntries([...sets].sort().map(([font, chars]) => [font, [...chars].sort((a,b) => a.codePointAt(0)-b.codePointAt(0)).join('')]));
}
export function sharedCopy(envelope, context, documentId) {
    validateWritingEnvelope(envelope, context); ensure(envelope.format.copyKind === 'writing-editable', 'WRITING_SHARE_SOURCE'); id(documentId);
    const result = { format: makeFormat('writing-shared', context.baseHash), document: { ...structuredClone(envelope.document), documentId, headRevisionId: null }, history: null };
    validateWritingEnvelope(result, context); return result;
}

/** W0 font declaration, separate from byte verification and production registry. */
export function validateDerivedFont(resource, source, area) {
    exact(resource, ['sourceFontId', 'sourceVersion', 'sourceSha256', 'recipe', 'textDigest', 'sha256', 'byteLength', 'path', 'license']);
    ensure(['original','writing'].includes(area), 'WRITING_FONT_AREA');
    ensure(resource.sourceFontId === source.id && resource.sourceVersion === source.version && resource.sourceSha256 === source.asset.sha256, 'WRITING_FONT_SOURCE');
    const permissions = source.license.permissions;
    ensure(['webDistribution','offlineCache','newTextInput','subsetting','portableRedistribution'].every(k=>permissions[k]===true), 'WRITING_FONT_PERMISSION');
    exact(resource.recipe, ['id', 'layoutFeatures', 'normalizationClosure', 'retainVariations', 'retainNames']);
    ensure(resource.recipe.id === 'harfbuzzjs-1.6.3-woff2-0.1.1-w0' && resource.recipe.layoutFeatures === '*'
        && resource.recipe.normalizationClosure === 'NFC+NFD' && resource.recipe.retainVariations === true && resource.recipe.retainNames === true, 'WRITING_FONT_RECIPE');
    for(const h of [resource.sourceSha256,resource.textDigest,resource.sha256]) ensure(typeof h === 'string' && hashPattern.test(h), 'WRITING_HASH');
    ensure(Number.isSafeInteger(resource.byteLength) && resource.byteLength>0 && resource.byteLength<=WRITING_LIMITS.fontBytes, 'WRITING_LIMIT');
    const prefix=area==='writing'?'writing/':'';
    ensure(resource.path === `${prefix}fonts/${resource.sha256}.woff2`, 'WRITING_FONT_PATH');
    exact(resource.license,['spdxId','noticeSha256','noticePath']);
    ensure(resource.license.spdxId === source.license.spdxId && resource.license.noticeSha256 === source.license.assetNoticeSha256
        && resource.license.noticePath === `${prefix}licenses/fonts/${resource.license.noticeSha256}.txt`, 'WRITING_FONT_NOTICE');
    return true;
}
