import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {editionReaderPositionUrl,readReaderPosition,restoreReaderPosition} from '../js/reader-position-link.js';
const id='e_'+'a'.repeat(64);
const url=editionReaderPositionUrl(id,{index:7,language:'en-us',view:'book'});
assert.deepEqual(readReaderPosition(url.split('?')[1]),{page:8,language:'en-us',view:'book'});
for(const query of [`edition=${id}`,`edition=${id}&page=0`,`edition=${id}&page=-1`,`edition=${id}&page=3.5`,`edition=${id}&page=2&page=3`,`edition=${id}&page=3&lang=ja&lang=en`,`edition=other&page=2`])assert.equal(readReaderPosition(query),null);
assert.equal(readReaderPosition(`edition=${id}&page=999999`).page,100000);
assert.equal(readReaderPosition(`edition=${id}&page=2&lang=https://evil.example&view=bad`).language,'');
assert.throws(()=>editionReaderPositionUrl('other'));
assert.equal(new URL(editionReaderPositionUrl(id,{index:3,language:'ja',view:'flat'}),'https://example.test').searchParams.get('view'),'flat');
const events=[];let lang='ja';
const reader={languages:()=>['ja','en-us'],selectLanguage:l=>{lang=l;events.push(l);},total:()=>lang==='ja'?10:4,selectPage:i=>events.push(i),canReadBook:()=>true,openBook:()=>events.push('book')};
restoreReaderPosition({page:8,language:'en-us',view:'book'},reader);
assert.deepEqual(events,['en-us',3,'book'],'language changes page count before clamping');
events.length=0;restoreReaderPosition({page:2,language:'missing',view:'flat'},reader);assert.deepEqual(events,[1]);
events.length=0;restoreReaderPosition({page:2,language:'ja',view:'book'},{...reader,canReadBook:()=>false});assert.deepEqual(events,['ja',1]);
// Exercise the actual async bookmark entry: a late account response must not
// even start a lookup that could override this explicit position.
const source=readFileSync(new URL('../js/viewer.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function restoreBookmarkIfAvailable()'),source.indexOf('\nfunction queueBookmarkSave()'));
const ctx=vm.createContext({readerPositionRequest:{page:8},bookmarkRestoreAttempted:false});
vm.runInContext(handler,ctx);await ctx.restoreBookmarkIfAvailable();
assert.match(source,/restoreReaderPosition\(readerPositionRequest,/);
// Run the actual pose transition entry without an animation: opening in a
// background tab must not depend on a foreground-only animation completing.
const chrome=readFileSync(new URL('../js/viewer-reader-chrome.js',import.meta.url),'utf8');
const changeTo=chrome.slice(chrome.indexOf('    function changeTo('),chrome.indexOf('    function step('));
const poseEvents=[];
const pose=vm.createContext({state:()=> 'reading',getSnapshot:()=>({thickness:8,peekIndex:5}),
    getPeek:()=>({prepare:async(i,options)=>{assert.equal(options.decodeTimeoutMs,15000);poseEvents.push(i);return true;},setReading:v=>poseEvents.push(v)}),
    beforePose(){},syncControls(){},update(){},restore(){throw new Error('unexpected restore');},
    serial:0,transition:null,mode:'',phase:'',
    document:{body:{classList:{add(){},remove(){}}}},motion:{playFan(){throw new Error('URL restoration must not start blur-sensitive animation');}}});
vm.runInContext(changeTo,pose);
assert.equal(pose.changeTo('book',false,undefined,{animate:false}),true);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(pose.mode,'edge');assert.equal(pose.phase,'peek');assert.equal(pose.transition,null);
assert.deepEqual(poseEvents,[5,1,1]);
console.log('Reader position URL round-trip, validation, language-first clamping, display fallback and bookmark precedence passed.');
