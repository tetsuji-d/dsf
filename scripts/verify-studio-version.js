import assert from 'node:assert/strict';
import {createStudioVersionCheck} from '../js/studio-version-check.js';
import {waitForStudioWorker} from '../js/studio-update-ui.js';
const current={schema:1,id:'20260929000000000',builtAt:1790640000000,label:'v2026.09.29-000000'};
const next={...current,id:'20260930000000000',builtAt:current.builtAt+86400000,label:'v2026.09.30-000000'};
let clock=0,online=true,calls=0,value=current,fail=false;
const checker=createStudioVersionCheck({current,now:()=>clock,online:()=>online,fetchVersion:async()=>{calls++;if(fail)throw Error('network');return value;}});
assert.equal(checker.read().available,false);const both=await Promise.all([checker.check(),checker.check()]);assert.deepEqual(both[0],both[1]);assert.equal(calls,1);assert.equal(checker.read().available,false);
value=next;await checker.check();assert.equal(calls,1,'focus events are throttled');clock+=30*60*1000;await checker.check();assert.equal(checker.read().available,true);assert.deepEqual(checker.read().current,current,'running version remains fixed');
online=false;await checker.check({force:true});assert.equal(calls,2);assert.equal(checker.read().phase,'offline');assert.equal(checker.read().available,true,'known update survives temporary offline');
online=true;fail=true;await checker.check({force:true});assert.equal(checker.read().phase,'failed');assert.equal(checker.read().available,true);
fail=false;value={...current,builtAt:current.builtAt-1,id:'20260928000000000'};await checker.check({force:true});assert.equal(checker.read().available,false,'older response is not an upgrade');
value={label:'<img onerror=alert(1)>'};await checker.check({force:true});assert.equal(checker.read().phase,'failed');assert.equal(checker.read().available,false);
value=current;await checker.check({force:true});assert.equal(checker.read().phase,'checked');assert.equal(checker.read().available,false);
let listener=null;const worker={state:'installing',addEventListener:(name,fn)=>listener=fn,removeEventListener:()=>listener=null};const ready=waitForStudioWorker(worker,['installed'],50);worker.state='installed';listener();await ready;assert.equal(listener,null);
worker.state='redundant';await assert.rejects(waitForStudioWorker(worker,['activated'],50),/INSTALL_FAILED/);worker.state='installing';await assert.rejects(waitForStudioWorker(worker,['activated'],5),/UPDATE_TIMEOUT/);assert.equal(listener,null);
console.log('PASS version check: same/new/older versions, coalescing, throttling, offline/failure, malformed metadata, immutable running version and worker failure/timeout');

// A failed/offline check retries after one minute, without rapid reconnect loops.
clock+=1800000;online=false;await checker.check();online=true;const beforeCalls=calls;await checker.check();assert.equal(calls,beforeCalls+1);
fail=true;await checker.check({force:true});clock+=61000;fail=false;await checker.check();assert.equal(checker.read().phase,'checked');
console.log('PASS reconnect retry and shared in-flight result');
