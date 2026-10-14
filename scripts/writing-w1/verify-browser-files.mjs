import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {nodeRuntime} from './node-runtime.mjs';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {sha256} from '../../js/dsf-writing-contract.js';
const options=await nodeRuntime();options.getFont=()=>{throw new Error('FULL_FONT_FETCH_FORBIDDEN');};options.getNotice=()=>{throw new Error('NOTICE_FETCH_FORBIDDEN');};
const root=new URL('../../outputs/writing-w1/',import.meta.url),original=await loadDsfV3(new Uint8Array(await readFile(new URL('original.dsf',root))),options),results=[];
for(const file of (await readdir(new URL('browser-saved/',root))).filter(f=>f.endsWith('.dsf'))) {
    const bytes=new Uint8Array(await readFile(new URL('browser-saved/'+file,root))),h=await loadDsfV3(bytes,options);
    assert.equal(h.baseHash,original.baseHash);for(const d of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(h.readBytes(d.path),original.readBytes(d.path));
    const saved=await resaveDsfV3(h);assert.deepEqual(saved.bytes,bytes);
    results.push({file,kind:h.copyKind,sha256:await sha256(bytes),byteLength:bytes.length,baseHash:h.baseHash,head:h.envelope.document?.headRevisionId||null,history:h.envelope.history?.revisions.length||0});
}
assert.ok(results.length>=2,'Expected browser-created editable and shared files');
assert.ok(results.some(r=>r.kind==='writing-editable'));assert.ok(results.some(r=>r.kind==='writing-shared'));
await writeFile(new URL('browser-verification.json',root),JSON.stringify({ok:true,results},null,2));console.log(JSON.stringify({ok:true,results},null,2));
