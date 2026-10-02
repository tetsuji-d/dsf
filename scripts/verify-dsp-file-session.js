import assert from 'node:assert/strict';
import {createDspFileSession,fingerprintDspFile,dspFilename} from '../js/dsp-file-session.js';
import {createLocalDraftStatus} from '../js/local-draft-status.js';
let scope=1;
function disk(name='original.dsp',text='old') {
 let bytes=text,modified=1,staged=null,permission='granted',hooks={};
 const counts={opened:0,closed:0,aborted:0};
 const handle={kind:'file',name,
  requestPermission:async()=>permission,
  getFile:async()=>new File([bytes],name,{lastModified:modified}),
  isSameEntry:async other=>other===handle||other.alias===handle,
  createWritable:async options=>{
   assert.equal(options.mode,'exclusive');counts.opened++;if(hooks.create)await hooks.create();
   return {async write(blob){staged=await blob.text();if(hooks.write)await hooks.write();},async close(){if(hooks.close)await hooks.close();bytes=staged;modified++;staged=null;counts.closed++;if(hooks.afterClose)await hooks.afterClose();},async abort(){staged=null;counts.aborted++;}};
  }
 };
 return {handle,counts,hooks,text:()=>bytes,permission:value=>permission=value,change:(text,{keepTime=false}={})=>{bytes=text;if(!keepTime)modified++;}};
}
const build=text=>async()=>({blob:new Blob([text]),token:{version:text}});
const session=()=>createDspFileSession({readScope:()=>scope});
const attach=async(s,d)=>s.attach(d.handle,await fingerprintDspFile(await d.handle.getFile()));
{
 const d=disk(),s=session();await attach(s,d);
 const result=await s.save({buildBlob:build('new')});assert.equal(d.text(),'new');assert.equal(result.status,'saved');assert.equal(s.read().name,'original.dsp');
 await s.save({buildBlob:build('latest')});assert.equal(d.text(),'latest');assert.equal(d.counts.closed,2);
 d.change('LATEST',{keepTime:true});await assert.rejects(s.save({buildBlob:build('lost')}),{code:'DSP_FILE_CHANGED'});assert.equal(d.text(),'LATEST');
 // Save As to the same underlying file cannot bypass the stale baseline.
 await assert.rejects(s.save({saveAs:true,chooseHandle:async()=>({...d.handle,alias:d.handle}),buildBlob:build('lost')}),{code:'DSP_FILE_CHANGED'});
 const copy=disk('copy.dsp','');await s.save({saveAs:true,chooseHandle:async()=>copy.handle,buildBlob:build('kept')});assert.equal(copy.text(),'kept');assert.equal(d.text(),'LATEST');assert.equal(s.read().name,'copy.dsp');
 const cancelled=await s.save({saveAs:true,chooseHandle:async()=>{throw new DOMException('cancel','AbortError');},buildBlob:()=>{throw Error('must not build');}});assert.equal(cancelled.status,'cancelled');assert.equal(s.read().name,'copy.dsp');
 s.clear();assert.equal(s.read().name,'');
}
{
 const d=disk(),s=session();await attach(s,d);d.permission('denied');
 await assert.rejects(s.save({buildBlob:build('lost')}),{code:'DSP_FILE_PERMISSION'});assert.equal(d.counts.opened,0);assert.equal(d.text(),'old');
}
for(const stage of ['build','write','close']){
 const d=disk(),s=session();await attach(s,d);
 if(stage!=='build')d.hooks[stage]=async()=>{throw Error('injected failure');};
 await assert.rejects(s.save({buildBlob:stage==='build'?async()=>{throw Error('injected failure');}:build('lost')}));
 assert.equal(d.text(),'old');assert.equal(s.read().busy,false);assert.equal(s.read().name,'original.dsp');
 if(stage!=='build')assert.equal(d.counts.aborted,1);
}
for(const stage of ['build','write']){
 const d=disk(),s=session();await attach(s,d);
 if(stage==='write')d.hooks.write=async()=>d.change('other app');
 await assert.rejects(s.save({buildBlob:async()=>{if(stage==='build')d.change('other app');return {blob:new Blob(['lost'])};}}),{code:'DSP_FILE_CHANGED'});
 assert.equal(d.text(),'other app');assert.equal(d.counts.closed,0);
}
{
 const d=disk(),s=session();await attach(s,d);d.hooks.afterClose=async()=>d.change('other writer');
 await assert.rejects(s.save({buildBlob:build('saved')}),{code:'DSP_FILE_VERIFY_FAILED'});assert.equal(d.text(),'other writer');
}
{
 const d=disk(),s=session();await attach(s,d);let resume;
 const pending=s.save({buildBlob:()=>new Promise(resolve=>resume=resolve)});
 while(!resume)await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(s.save({buildBlob:build('overlap')}),{code:'DSP_FILE_BUSY'});
 scope++;resume({blob:new Blob(['old project'])});await assert.rejects(pending,{code:'DSP_FILE_SESSION_CHANGED'});assert.equal(d.counts.opened,0);assert.equal(s.read().name,'');
}
{
 const d=disk(),s=session(),tracker=createLocalDraftStatus();await attach(s,d);tracker.dirty();
 const token=tracker.checkpoint();const result=await s.save({buildBlob:async()=>{tracker.dirty();return {blob:new Blob(['earlier snapshot']),token};}});
 assert.equal(result.status,'saved');assert.equal(tracker.confirm(result.token),false);assert.equal(tracker.read().dirty,true);
}
{
 const d=disk(),s=createDspFileSession({readScope:()=>scope,canBind:()=>false});await attach(s,d);
 assert.equal(s.read().name,'');await s.save({saveAs:true,chooseHandle:async()=>d.handle,buildBlob:build('cloud export')});
 assert.equal(d.text(),'cloud export');assert.equal(s.read().name,'');
}
{
 const d=disk(),s=session();await attach(s,d);let resume;
 const pending=s.save({buildBlob:()=>new Promise(resolve=>resume=resolve)});
 while(!resume)await new Promise(resolve=>setTimeout(resolve,0));
 s.clear();resume({blob:new Blob(['discarded'])});await assert.rejects(pending,{code:'DSP_FILE_SESSION_CHANGED'});
 assert.equal(d.text(),'old');assert.equal(s.read().name,'');
}
assert.equal(dspFilename('my:file'),'my_file.dsp');assert.equal(dspFilename('draft.DSP'),'draft.DSP');
console.log('PASS DSP file saving: round trip, same-file conflicts, Save As, permissions/cancel, write/close/verification failures, abort, external edits, concurrent saves, project change and dirty revision');
