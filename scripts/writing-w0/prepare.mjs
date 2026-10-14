// Downloads only public font/license assets, verifies pinned identities, and
// builds a reproducible local-only fixture. No manuscript or credential access.
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DSF_FONT_CERTIFICATION_CANDIDATES } from '../../js/dsf-font-certification-candidates.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'outputs/writing-w0');
const hash = b => createHash('sha256').update(b).digest('hex');
await mkdir(path.join(out, 'fonts'), {recursive:true});
await mkdir(path.join(root, 'docs/writing-w0-licenses'), {recursive:true});
const fetchBytes = async url => {
    const r = await fetch(url, {headers:{Origin:'https://dsf.ink','User-Agent':'DSF-W0-font-verification'},signal:AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error(`Public asset HTTP ${r.status}: ${url}`);
    return new Uint8Array(await r.arrayBuffer());
};
const catalog = [];
for (const [id, c] of Object.entries(DSF_FONT_CERTIFICATION_CANDIDATES.candidates)) {
    const local = process.argv[2] ? path.join(process.argv[2], c.asset.fileName) : null;
    const bytes = local ? await readFile(local) : await fetchBytes(c.production.href);
    if (hash(bytes) !== c.asset.sha256 || bytes.length !== c.asset.byteLength) throw new Error('Font identity mismatch');
    await writeFile(path.join(out,'fonts',`${id}.woff2`),bytes);
    const sourceNoticeUrl = `https://raw.githubusercontent.com/google/fonts/${c.source.commit}/${c.source.path.split('/').slice(0,-1).join('/')}/OFL.txt`;
    const notice = await fetchBytes(c.license.noticeHref);
    if (hash(notice) !== c.license.noticeSha256) throw new Error('Notice identity mismatch');
    const sourceNotice = await fetchBytes(sourceNoticeUrl);
    for (const [suffix,b] of [['asset',notice],['source',sourceNotice]]) await writeFile(path.join(root,'docs/writing-w0-licenses',`${id}-${suffix}.txt`),b);
    const entry = {id,family:c.declaration.family,version:c.declaration.version,source:c.source,
        asset:{...c.asset,url:c.production.href},license:{spdxId:'OFL-1.1',reviewedAt:'2026-10-11',
            scope:'W0 prototype: OFL terms checked; production activation remains separate',
            sourceNoticeUrl,sourceNoticeSha256:hash(sourceNotice),assetNoticeUrl:c.license.noticeHref,assetNoticeSha256:hash(notice),
            sourceCopyright:new TextDecoder().decode(sourceNotice).split(/\r?\n/)[0],
            assetCopyright:new TextDecoder().decode(notice).split(/\r?\n/)[0],
            reservedFontNames:id.includes('sans')?['Source']:[],
            permissions:{webDistribution:true,offlineCache:true,newTextInput:true,subsetting:true,portableRedistribution:true},
            conditions:['retain copyright and OFL','derivatives remain OFL','respect reserved names','do not sell font alone','no endorsement implication']}};
    catalog.push(entry);
}
await writeFile(path.join(root,'docs/writing-w0-licenses/catalog.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
const vendor = path.join(out,'vendor'); await mkdir(vendor,{recursive:true});
const deps = ['hb-subset-wasm','woff2-encode-wasm','harfbuzzjs','wawoff2'];
const dependencyEvidence = [];
for (const name of deps) {
    const source = fileURLToPath(new URL(`node_modules/${name}/`,import.meta.url));
    const meta = JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
    await cp(path.join(source,name==='wawoff2'?'build':'dist'),path.join(vendor,name),{recursive:true});
    const notices = (await readdir(source)).filter(f=> /^(LICENSE|COPYING|THIRD_PARTY)/.test(f));
    for (const notice of notices) await cp(path.join(source,notice),path.join(vendor,`${name}-${notice}`));
    dependencyEvidence.push({name,version:meta.version,license:meta.license,repository:meta.repository,notices});
}
await writeFile(path.join(out,'dependencies.json'),JSON.stringify(dependencyEvidence,null,2)+'\n');
async function walk(dir) {
    const result=[];
    for (const e of await readdir(dir,{withFileTypes:true})) {
        if(e.isDirectory()) result.push(...await walk(path.join(dir,e.name)));
        else result.push(path.join(dir,e.name));
    }
    return result;
}
const files=(await walk(out)).filter(f=>!f.includes(`${path.sep}results`)&&!f.endsWith('assets.json'));
const assets=[];
for(const f of files) {const b=await readFile(f);assets.push({url:'/assets/'+path.relative(out,f).split(path.sep).join('/'),sha256:hash(b),byteLength:b.length});}
await writeFile(path.join(out,'assets.json'),JSON.stringify(assets,null,2)+'\n');
console.log(JSON.stringify({fonts:catalog.map(c=>({id:c.id,bytes:c.asset.byteLength,sourceCopyright:c.license.sourceCopyright,assetCopyright:c.license.assetCopyright})),assets:assets.length}));
