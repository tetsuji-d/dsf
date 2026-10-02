import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dspOpenErrorMessage} from '../js/dsp-open-status.js';
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const fn=name=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\n}',source.indexOf('function '+name+'('))+2);
const context={dspSaveBusy:false,openingProject:null,editorDragBlocked:()=>false,_flowDirectEditSession:{expectedText:'saved text'},_flowDirectEditProxy:{isConnected:true,value:'saved text',dataset:{flowReflowPending:'true'}},_editorFlowProjectionController:{},_flowAuthoringReflowTimer:42,assertPersonalStudioOperation(){},isLocalDraft:()=>true,localDraftStatus:{read:()=>({dirty:false})},state:{projectId:''},getEditorSaveStatus:()=>({cloudCurrent:true})};
vm.createContext(context);vm.runInContext(fn('readDspOpenBlockReason')+'\n'+fn('assertExternalDspOpenReady'),context);
// Reproduce a cancelled pagination proxy on the dashboard. Saved source is safe to leave.
assert.doesNotThrow(()=>context.assertExternalDspOpenReady());
context._flowDirectEditProxy.value='uncommitted text';assert.throws(()=>context.assertExternalDspOpenReady(),e=>e.reason==='uncommitted');context._flowDirectEditProxy.value='saved text';
context.localDraftStatus.read=()=>({dirty:true});assert.throws(()=>context.assertExternalDspOpenReady(),e=>e.message==='unsaved');context.localDraftStatus.read=()=>({dirty:false});
for(const [key,value,reason] of [['dspSaveBusy',true,'saving'],['openingProject',{},'opening'],['editorDragBlocked',()=>true,'editing']]){const old=context[key];context[key]=value;assert.throws(()=>context.assertExternalDspOpenReady(),e=>e.reason===reason);context[key]=old;}
context.isLocalDraft=()=>false;context.state.projectId='cloud';context.getEditorSaveStatus=()=>({cloudCurrent:false});assert.throws(()=>context.assertExternalDspOpenReady(),e=>e.message==='unsaved');
context.getEditorSaveStatus=()=>({cloudCurrent:true});assert.doesNotThrow(()=>context.assertExternalDspOpenReady());
context.assertPersonalStudioOperation=()=>{throw Error('shared');};assert.throws(()=>context.assertExternalDspOpenReady(),/shared/);
for(const en of [false,true])for(const reason of ['saving','opening','editing','uncommitted',undefined])assert.ok(dspOpenErrorMessage({message:'busy',reason},en).length>20);
assert.ok(!dspOpenErrorMessage(Error('private detail')).includes('private detail'));
console.log('PASS DSP open: cancelled preview does not block; unsaved local/cloud, active writes, input and shared boundaries remain guarded; localized errors');
