import assert from 'node:assert/strict';
import {state,dispatch,actionTypes,getProjectSessionEpoch} from '../js/state.js';
import {createEditorSaveStatus} from '../js/editor-save-status.js';
import {syncAuthSaveStatus} from '../js/studio-auth-save-status.js';
import {describeStudioWork,studioWorkText} from '../js/studio-work-status.js';
import {editorWorkView} from '../js/editor-work-bar.js';

const user={uid:'fixture-owner'};
dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:user.uid,user}});
dispatch({type:actionTypes.LOAD_PROJECT,payload:{projectId:'fixture-project'}});
const evidence=createEditorSaveStatus(()=>JSON.stringify([getProjectSessionEpoch(),state.projectId,state.uid]));
const element={dataset:{},style:{},textContent:'ログイン済み · 保存してクラウド保存を確認'};
function render({local=false,en=false,online=true}={}) {
    const save=evidence.read();
    syncAuthSaveStatus(element,{uid:state.uid,save,local,en,online});
    const work=describeStudioWork({open:true,save,local,online});
    if(!local){
        assert.equal(element.textContent.replace(/^[✓●!] /,''),studioWorkText(work,en));
        assert.equal(editorWorkView(work,en).status,studioWorkText(work,en));
    }
    return work;
}
evidence.cloudLoaded('r2-private');
assert.equal(render().status,'saved-cloud');
assert.equal(element.dataset.saveTarget,'Cloud');
assert.equal(render({en:true}).status,'saved-cloud');
assert.match(element.textContent,/Saved to cloud/);
dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:user.uid,user}});
assert.equal(render().status,'saved-cloud','same auth notification must retain confirmation');

const pending=evidence.begin(true);pending.localSaved();
assert.equal(render().status,'saving','local backup must not finish the cloud save');
assert.equal(render({en:true}).status,'saving');
assert.equal(element.dataset.saveTarget,'');
pending.failed('cloud',{code:'AUTHORING_REVISION_CONFLICT'});
assert.equal(render().status,'error');
assert.match(element.textContent,/変更の確認/);
assert.equal(element.dataset.saveStatus,'error');
const retry=evidence.begin(true);retry.cloudSaved();
assert.equal(render().status,'saved-cloud');
evidence.dirty();assert.equal(render().status,'dirty');
assert.equal(render({online:false}).status,'waiting');

const old=evidence.begin(true);
dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:user.uid,user:{uid:user.uid}}});
old.cloudSaved();
assert.equal(render().status,'unconfirmed','auth invalidation must clear old success on every surface');
assert.equal(element.dataset.saveStatus,'idle');
assert.equal(element.dataset.saveTarget,'');
evidence.cloudLoaded('r2-private');
assert.equal(render().status,'saved-cloud','validated reload restores all status surfaces');
dispatch({type:actionTypes.LOAD_PROJECT,payload:{projectId:'fixture-project'}});
assert.equal(render().status,'unconfirmed','restored copy must not inherit cloud proof');

const local=evidence.begin(false);local.localSaved();render({local:true});
assert.equal(element.dataset.saveTarget,'Local');
assert.match(element.textContent,/復元用コピー/);
assert.doesNotMatch(element.textContent,/DSP.*保存済み/);
dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:null,user:null}});
syncAuthSaveStatus(element,{uid:'',local:false,save:evidence.read()});
assert.equal(element.textContent,'ログインでクラウド保存');
assert.equal(element.dataset.saveTarget,'');
console.log('PASS: cloud load, pending cloud/local backup, failure, retry, dirty, offline, auth invalidation, stale completion, local restore, bilingual status consistency.');
