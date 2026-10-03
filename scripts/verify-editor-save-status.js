import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createEditorSaveStatus } from '../js/editor-save-status.js';
let identity = 'one';
const status = createEditorSaveStatus(() => identity);
assert.equal(status.read().state, 'unknown');
status.dirty(); assert.equal(status.read().state, 'pending');
const first = status.begin(true); first.backend('r2-private'); first.localSaved();
assert.deepEqual(status.read(), {state:'saving',backend:'r2-private',localCurrent:true,cloudCurrent:false,errorCode:null});
status.dirty(); first.cloudSaved();
assert.equal(status.read().state, 'pending'); assert.equal(status.read().cloudCurrent,false); assert.equal(status.read().localCurrent,false);
const second = status.begin(true); second.localSaved(); second.failed('cloud', {code:'AUTHORING_CONFLICT',message:'private secret'});
assert.equal(status.read().state,'error'); assert.equal(status.read().localCurrent,true); assert.equal(status.read().cloudCurrent,false);
assert.equal(status.read().errorCode,'AUTHORING_CONFLICT');
const retry = status.begin(true); retry.backend('firestore'); retry.cloudSaved();
assert.equal(status.read().state,'saved-cloud'); assert.equal(status.read().cloudCurrent,true);
identity='two'; assert.equal(status.read().state,'unknown'); retry.cloudSaved(); assert.equal(status.read().cloudCurrent,false);
status.dirty(); const local=status.begin(false); local.failed('local',new Error('secret')); assert.equal(status.read().errorCode,'LOCAL_SAVE_FAILED');
const backup=status.begin(false); backup.localSaved(); assert.equal(status.read().state,'saved-local'); assert.equal(status.read().cloudCurrent,false);
assert.ok(!JSON.stringify(status.read()).includes('secret'));
for (const backend of ['r2-private', 'firestore']) {
    const oldSave = status.begin(true);
    identity += '-loaded';
    status.cloudLoaded(backend);
    assert.deepEqual(status.read(), {state:'saved-cloud',backend,localCurrent:false,cloudCurrent:true,errorCode:null});
    oldSave.failed('cloud', {code:'AUTHORING_CONFLICT'});
    assert.equal(status.read().state, 'saved-cloud');
    status.dirty();
    oldSave.cloudSaved();
    assert.equal(status.read().cloudCurrent, false);
    assert.equal(status.read().state, 'pending');
    identity += '-restored';
    assert.equal(status.read().cloudCurrent, false, 'a restored browser copy is not evidence of cloud persistence');
}
console.log('Save evidence passed: current revisions, queued edits, backend, local/cloud failures, session isolation.');
const source = fs.readFileSync('js/firebase.js', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('export async function restorePreviousCloudAuthoring(');
const restore = source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export ', '');
for (const switched of [false, true]) {
    let epoch = 1;
    const calls = [];
    const context = {assertPersonalStudioOperation(){}, state:{projectId:'test'},
        getProjectSessionEpoch:()=>epoch, flushPendingSave:async()=>{calls.push('pending');if(switched)epoch++;},
        flushSave:async()=>{throw Error('Must not append unchanged revision');},
        getLoadedPrivateAuthoringHead:()=>({revisionId:'current'}),
        preparePrivateProjectAction:async()=>({previousRevisionId:'previous'}),
        runPrivateProjectAction:async(_,kind,data)=>calls.push([kind,data.revisionId]),
        loadProject:async pid=>calls.push(['load',pid]), AuthoringClientError:Error};
    vm.runInNewContext(restore+';globalThis.run=restorePreviousCloudAuthoring;',context);
    if(switched) {await assert.rejects(context.run(),/AUTHORING_SESSION_CHANGED/);assert.deepEqual(calls,['pending']);}
    else {await context.run();assert.deepEqual(calls,['pending',['restore','previous'],['load','test']]);}
}
console.log('Previous source restore: no redundant save revision; session changes stop restore.');
