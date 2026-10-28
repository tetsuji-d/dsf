import assert from 'node:assert/strict';
import { loadEditionList, editionListCounts, editionListFolder, editionStatusLabel } from '../js/edition-list.js';
import { editionIdFor } from '../js/edition-policy.js';

const uid = 'owner', workId = 'work_one', projectId = 'project_one';
const timestamp = { toDate: () => new Date('2026-01-01T00:00:00Z') };
const releases = ['first', 'second', 'archived', 'disposed'].map(id => ({ id, projectId, title: 'Issued ' + id, createdAt: timestamp }));
const states = await Promise.all(['first','second','archived','disposed','cleanup'].map(async id => ({ id,
    editionId: await editionIdFor(uid, workId, id), status: { first:'public',second:'private',archived:'archived',disposed:'disposed',cleanup:'disposed' }[id],
    cleanupPending: id === 'cleanup', publication: {}, publicSnapshot: id === 'first' ? { title: 'Immutable title' } : undefined,
})));
const records = async path => path.at(-1) === 'works' ? [{ id: workId, projectId, title: 'Changed work title' }]
    : path.at(-1) === 'projects' ? [{ id: projectId, title: 'Changed editable title', dsfStatus:'unlisted', dsfSchemaVersion:2 }]
    : path.at(-1) === 'releases' ? releases : states;
const options = { uid, origin:'https://example.test', records, publicRecords:async()=>[] };
const rows = await loadEditionList(options);
assert.equal(rows.length, 4, 'separate editions remain distinct; completed disposal is excluded');
assert.equal(rows.find(r=>r.releaseId==='first').title, 'Immutable title');
assert.equal(rows.find(r=>r.releaseId==='second').state.status, 'private', 'Project status cannot override a release');
assert.deepEqual(editionListCounts(rows), {public:1,unlisted:0,private:1,archived:2});
assert.equal(editionListFolder({status:'public',publication:{publicUntil:'2020-01-01'}}),'private');
assert.equal(editionStatusLabel('private'),'非公開');
assert.equal(editionStatusLabel('private','en'),'Private');
const legacy = await loadEditionList({...options, records:async path=>path.at(-1)==='edition_states'?[]:records(path),publicRecords:async()=>[{workId,releaseId:'first',dsfStatus:'unlisted'}]});
assert.equal(legacy.find(r=>r.releaseId==='first').state.status,'unlisted');
assert.match(legacy.find(r=>r.releaseId==='first').shareUrl,/work=work_one&r=first/);
assert.equal(legacy.find(r=>r.releaseId==='second').state.status,'private');
const scope = {viewKind:()=> 'owned',catalogueReady:()=>true,filter:()=>[]};
assert.deepEqual(await loadEditionList({...options,scope}),[]);
await assert.rejects(loadEditionList({...options,records:async()=>{throw Error('offline');}}),/offline/,'partial failures cannot produce zero totals');
let current=true;
await assert.rejects(loadEditionList({...options,isCurrent:()=>current,records:async p=>{const value=await records(p);if(p.at(-1)==='releases')current=false;return value;}}),/SESSION_CHANGED/);
await assert.rejects(loadEditionList({...options,scope:{...scope,catalogueReady:()=>false,load:async()=>{}}}),/SCOPE_UNAVAILABLE/);
console.log('Edition inventory: immutable title/status, separate editions, cleanup, legacy, scope, expiry, failure and account-race checks passed.');
