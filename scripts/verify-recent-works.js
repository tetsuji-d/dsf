import assert from 'node:assert/strict';
import {buildRecentWorks,filterRecentWorks,createRecentDirectory} from '../js/recent-works.js';
const owned=[{id:'p',title:'海',lastUpdated:10},{id:'trash',projectTrash:{},title:'trash'}],catalogue={uid:'a',spaces:[{id:'s',name:'山口出版'}],assignments:{p:'s'}};
const locals=[{id:'own',localOwnerUid:'a',projectId:'p',updatedAt:99,title:'海コピー'},{id:'other',localOwnerUid:'b',projectId:'p',updatedAt:200,title:'海'},{id:'detached',title:'海'},{id:'unknown',projectId:'p',title:'海'},{id:'trashcopy',localOwnerUid:'a',projectId:'trash'}];
const rows=buildRecentWorks({uid:'a',owned,locals,catalogue});
assert.equal(rows.length,5);const linked=rows.find(r=>r.cloud);assert.equal(linked.locals.length,1);assert.equal(linked.locals[0].id,'own');assert.equal(linked.cloud.title,'海');assert.equal(rows.find(r=>r.locals[0]?.id==='trashcopy').cloudTrashed,true);
assert.equal(filterRecentWorks(rows,{scope:'s'}).length,1);assert.equal(filterRecentWorks(rows,{scope:'device'}).length,1);assert.equal(filterRecentWorks(rows,{query:'山口'}).length,1);assert.equal(filterRecentWorks(rows,{query:'ない'}).length,0);assert.equal(filterRecentWorks(rows,{scope:'copies'}).length,5);
const offline=buildRecentWorks({uid:'a',locals});assert.equal(offline.length,5);assert(!offline.some(r=>r.cloud));assert(!offline.some(r=>r.spaceId==='s'));
let calls=0,release;const gate=new Promise(r=>release=r);
const directory=createRecentDirectory({execute:async c=>{calls++;if(c.kind==='listJoinedSpaces'){await gate;return {items:[{id:'s',name:'Space'}],nextCursor:null};}return {space:{id:'s',name:'Space'},items:[{ownerUid:'b',projectId:'p',workId:'w',title:'Allowed'}],nextCursor:null};}});
const a=directory.load(),b=directory.load();release();await Promise.all([a,b]);assert.equal(calls,2);assert.equal(directory.snapshot().works.length,1);assert.equal(directory.snapshot().more,false);
let pages=0;const paged=createRecentDirectory({execute:async c=>c.kind==='listJoinedSpaces'?{items:[{id:'s'}],nextCursor:null}:{space:{id:'s'},items:[{ownerUid:'a',projectId:'p'+pages,workId:'w'+pages++}],nextCursor:pages<5?'w'+(pages-1):null}});await paged.load();assert.equal(pages,3);assert(paged.snapshot().more);await paged.load();assert.equal(pages,5);assert(!paged.snapshot().more);
let deny=false;const failing=createRecentDirectory({execute:async c=>{if(deny)throw Error('403');if(c.kind==='listJoinedSpaces')return {items:[{id:'s'}]};return {space:{id:'s'},items:[{ownerUid:'a',projectId:'p',workId:'w'}],nextCursor:'w'};}});await failing.load();deny=true;await failing.load();assert.equal(failing.snapshot().works.length,0);assert(failing.snapshot().failed);
console.log('Recent works: identity isolation, detached imports, trash, spaces, search, offline, paging, concurrent loads and revoked reads passed.');

const historyRows=buildRecentWorks({uid:'a',owned,catalogue,history:[{ownerUid:'a',projectId:'p',at:12},{ownerUid:'no_access',projectId:'secret',at:999}]});assert.equal(historyRows.length,1);assert.equal(historyRows[0].openedAt,12);assert.equal(historyRows[0].projectId,'p');
