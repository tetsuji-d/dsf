import assert from 'node:assert/strict';
import { calculateHorizonSaveProgress as calc, isManualHorizonSaveCancellation as cancelled } from '../js/horizon-save-progress.js';
assert.deepEqual(calc(), {percent:0,remainingSeconds:null});
assert.deepEqual(calc({completedBytes:500,totalBytes:1000,elapsedMs:20000}), {percent:50,remainingSeconds:20});
assert.equal(calc({completedBytes:1000,totalBytes:1000,elapsedMs:20000}).percent,99);
assert.equal(calc({completedBytes:1,totalBytes:1000,elapsedMs:500}).remainingSeconds,null);
assert.equal(calc({completedBytes:100,totalBytes:1000,elapsedMs:2000}).percent,10);
assert.equal(calc({completedBytes:2000,totalBytes:1000}).percent,99);
console.log('Horizon byte progress and ETA verification passed.');

const aborted = {name:'DsfHorizonReleaseUploadError',code:'DSF_HORIZON_RELEASE_UPLOAD_FAILED',issues:[{code:'HORIZON_UPLOAD_ABORTED'}]};
assert.equal(cancelled(aborted,true),true);
assert.equal(cancelled(aborted,false),false);
assert.equal(cancelled({name:'AbortError'},true),true);
assert.equal(cancelled({code:'HORIZON_UPLOAD_HTTP_FAILED'},true),false);
console.log('Manual cancellation is distinguished from automatic invalidation and failures.');
