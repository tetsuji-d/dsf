import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createReaderWritingModel} from '../../js/reader-writing-model.js';
import {makeFormat,validateWritingEnvelope,canonicalBytes,sharedCopy} from '../../js/dsf-writing-contract.js';
import {createWritingPageCache,writingPageWindow} from '../../js/reader-writing-page-cache.js';
const hash='a'.repeat(64),pages=Array.from({length:80},(_,i)=>({id:`p${i}`}));
const handle={baseHash:hash,copyKind:'original',bundle:{manifests:{ja:{pages},en:{pages}}},envelope:{format:makeFormat('original',hash),document:null,history:null}};
const context={baseHash:hash,fontIds:new Set(),pageKeys:new Set(['ja','en'].flatMap(l=>pages.map(p=>`${l}/${p.id}`)))};
const line=id=>({id,type:'line',from:[20,40],to:[240,180],width:2,color:'#224466',arrow:'both'});
const m=createReaderWritingModel(handle,[]),root=m.head;
for(let i=0;i<45;i++)m.change('ja',`p${i}`,'線を追加',all=>[...all,line(`o${i}`)]);
assert.equal(m.revisions.length,31);assert.equal(m.envelope.document.pages.length,45);assert.throws(()=>m.restore(root),/WRITING_HEAD/);
validateWritingEnvelope(m.envelope,context);const final=m.head;
for(let i=0;i<30;i++)assert.equal(m.restore(m.parent).pageId,`p${44-i}`);
assert.equal(m.parent,null);assert.equal(m.envelope.document.pages.length,15);
for(let i=0;i<30;i++)m.restore(m.children[0].id);
assert.equal(m.head,final);assert.equal(m.envelope.document.pages.length,45);
const retained=m.pageObjects('ja','p10');
m.restore(m.parent);const discarded=final;m.change('en','p60','別のページを編集',all=>[...all,line('english')]);
assert.equal(m.children.length,0);assert.throws(()=>m.restore(discarded),/WRITING_HEAD/);assert.equal(m.pageObjects('ja','p10'),retained);
m.takeDraftUpdate();m.change('ja','p12','移動',all=>all.map(o=>({...o,to:[260,190]})));
const patch=m.takeDraftUpdate();assert.equal(patch.pages.length,1);assert.equal(patch.envelope.document.pages.length,0);assert.equal(m.takeDraftUpdate().pages.length,0);
const before=m.head;
m.changePages('ja','見開き一筆',[{pageId:'p70',transform:all=>[...all,line('left')]},{pageId:'p71',transform:all=>[...all,line('right')]}]);const spread=m.head;
m.restore(before);assert.equal(m.objects('ja','p70').length+m.objects('ja','p71').length,0);
m.restore(spread);assert.equal(m.objects('ja','p70').length+m.objects('ja','p71').length,2);
const valid=m.envelope;
assert.throws(()=>m.changePages('ja','不正',[{pageId:'p70',transform:()=>[]},{pageId:'missing',transform:()=>[]}]),/WRITING_PAGE/);assert.deepEqual(m.envelope,valid);
assert.throws(()=>m.change('ja','p70','重複',all=>[...all,line('right')]),/WRITING_DUPLICATE_OBJECT/);assert.deepEqual(m.envelope,valid);
m.change('ja','p70','同じ状態',all=>all);assert.equal(m.head,spread);
const corrupt=structuredClone(valid);corrupt.history.revisions.at(-1).changes[0].beforeOrder=['nonexistent'];assert.throws(()=>validateWritingEnvelope(corrupt,context),/WRITING_HISTORY_STATE/);
const loaded=createReaderWritingModel({...handle,copyKind:'writing-editable',envelope:valid},[]);assert.deepEqual(loaded.envelope,valid);loaded.restore(loaded.parent);validateWritingEnvelope(loaded.envelope,context);
assert.equal(sharedCopy(valid,context,'shared').history,null);
// Prototype migration retains its current contents and converts snapshots once.
const old={format:makeFormat('writing-editable',hash),document:{schemaVersion:1,documentId:'old',baseContentHash:hash,headRevisionId:'r2',pages:[{language:'ja',pageId:'p0',objects:[line('legacy')]}]},history:{schemaVersion:1,revisions:[
    {id:'r1',parentId:null,operation:'開始',createdAt:'2026-10-14T00:00:00.000Z',pages:[]},
    {id:'r2',parentId:'r1',operation:'追加',createdAt:'2026-10-14T00:00:00.000Z',pages:[{language:'ja',pageId:'p0',objects:[line('legacy')]}]}]}};
const migrated=createReaderWritingModel(handle,[],old);assert.equal(migrated.envelope.history.schemaVersion,2);migrated.restore(migrated.parent);assert.equal(migrated.objects('ja','p0').length,0);
// Prefetch cancellation and bounded disposal during rapid navigation.
let scheduled=[],cancelled=new Set(),disposed=[];
const cache=createWritingPageCache({load:id=>id,dispose:id=>disposed.push(id),schedule:fn=>{scheduled.push(fn);return scheduled.length-1;},cancel:id=>cancelled.add(id)});
cache.window([1,2],writingPageWindow([1,2],80));assert.deepEqual(cache.keys,[1,2]);
cache.window([40,41],writingPageWindow([40,41],80));
for(let i=0;i<scheduled.length;i++)if(!cancelled.has(i))scheduled[i]();
assert.equal(cache.size,6);assert.deepEqual(new Set(cache.keys),new Set([38,39,40,41,42,43]));assert.ok(disposed.includes(1)&&disposed.includes(2));cache.clear();assert.equal(cache.size,0);
// Representative 60-page handwriting book; compare equivalent 30 retained snapshots, not the old 256 maximum.
const bench=createReaderWritingModel(handle,[]),snapshots=[],times=[];
const stroke=i=>({id:`s${i}`,type:'stroke',tool:'pen',color:'#20272b',opacity:1,baseWidth:1,geometryVersion:1,points:Array.from({length:100},(_,j)=>({x:20+j*2,y:20+i%20,pressure:.5,width:1}))});
for(let i=0;i<60;i++){const start=performance.now();bench.change('ja',`p${i}`,'筆跡',all=>[...all,stroke(i)]);times.push(performance.now()-start);snapshots.push(bench.envelope.document.pages);}
const deltaBytes=canonicalBytes(bench.envelope).length,snapshotBytes=canonicalBytes(snapshots.slice(-31)).length;
assert.ok(deltaBytes<snapshotBytes/8);
const result={ok:true,operations:30,baseline:1,currentPages:60,deltaBytes,snapshotBytes,reductionPercent:Math.round((1-deltaBytes/snapshotBytes)*100),editMilliseconds:{median:times.sort((a,b)=>a-b)[30],max:Math.max(...times)},prefetchedPageMaximum:6,atomicSpreadUndo:true,redoDiscard:true,dirtyPageOnly:true};
await writeFile(new URL('../../outputs/writing-w1/history-pages-20261014/model-proof.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
