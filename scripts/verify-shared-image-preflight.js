import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectSharedImages} from '../server/shared-image-preflight.js';
const bytes=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
const url='https://media.test/users/owner_1/dsf/cover.webp';
const object=()=>({size:bytes.length,httpMetadata:{contentType:'image/webp'},body:new Response(bytes).body});
const project=refs=>({blocks:refs.map((background,i)=>({id:'image_'+i,kind:'page',content:{background}}))});
const run=(refs,extra={})=>inspectSharedImages({project:project(refs),ownerUid:'owner_1',publicBaseUrl:'https://media.test',...extra});
await test('deduplicates image slots, verifies actual bytes, and leaves manuscript unchanged',async()=>{
 const p=project([url,url]);p.blocks[0].content.text='URL in prose: https://external.test/a.webp';const before=structuredClone(p);let gets=0;
 const result=await run([],{project:p,publicBucket:{get:async key=>{gets++;assert.equal(key,'users/owner_1/dsf/cover.webp');return object();}}});
 assert.equal(gets,1);assert.equal(result.references,2);assert.equal(result.uniqueImages,1);assert.equal(result.verifiedBytes,bytes.length);
 assert.equal(result.copyable,true);assert.equal(result.entries[0].width,1);assert.match(result.entries[0].sha256,/^[a-f0-9]{64}$/);assert.deepEqual(p,before);
});
await test('external, another owner, credentials, encoded paths, blob and signed URLs never reach storage',async()=>{
 const refs=['https://external.test/x.webp','https://media.test/users/owner_2/dsf/a.webp',url+'?token=secret',url+'#fragment','blob:abc','data:image/webp;base64,AA==','https://user:password@media.test/users/owner_1/dsf/a.webp','https://media.test/users/owner_1/dsf/%2e%2e/a.webp',url.replace('/dsf/','/dsf/../../owner_2/dsf/')];
 const result=await run(refs,{publicBucket:{get:()=>{throw Error('must not read')}}});
 assert.equal(result.verifiedImages,0);assert(result.entries.every(e=>e.status==='UNSUPPORTED_IMAGE_REFERENCE'));assert(!JSON.stringify(result).includes('secret'));
});
await test('missing, corrupt, wrong type and oversized objects are distinguished without mutation',async()=>{
 const objects=[null,{...object(),httpMetadata:{contentType:'image/png'}},{...object(),size:26*1024*1024},{size:4,httpMetadata:{contentType:'image/webp'},body:new Response('bad!').body}];
 const result=await run(objects.map((_,i)=>url.replace('cover',String(i))),{publicBucket:{get:async()=>objects.shift()}});
 assert.deepEqual(result.entries.map(e=>e.status),['IMAGE_MISSING','IMAGE_FORMAT_INVALID','IMAGE_SIZE_INVALID','IMAGE_READ_FAILED']);assert.equal(result.copyable,false);
});
await test('read count is bounded and private refs require their own readiness check',async()=>{
 let gets=0;const result=await run(Array.from({length:34},(_,i)=>url.replace('cover',String(i))),{publicBucket:{get:async()=>{gets++;return object();}}});
 assert.equal(gets,32);assert.equal(result.entries[33].status,'INSPECTION_LIMIT');assert.equal(result.copyable,false);
 assert.equal((await run(['assets/private/'+'a'.repeat(64)+'.webp'])).entries[0].status,'PRIVATE_IMAGE_RECHECK_REQUIRED');
 assert.equal((await run([url])).entries[0].status,'IMAGE_STORAGE_UNAVAILABLE');
});
await test('revalidation before and after I/O propagates revocation, never turns it into an image warning',async()=>{
 let checks=0;await assert.rejects(run([url,url.replace('cover','second')],{publicBucket:{get:async()=>object()},assertCurrent:async()=>{if(++checks===2)throw Error('REVOKED');}}),/REVOKED/);assert.equal(checks,2);
});
