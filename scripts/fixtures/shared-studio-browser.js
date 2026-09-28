// Imported only by the loopback-only shared Studio fixture, never by studio.html.
import '../../js/app.js';
import {state,dispatch,actionTypes} from '../../js/state.js';
import * as persistence from '../../js/firebase.js';
import * as history from '../../js/history.js';
import {get} from 'idb-keyval';
window.fixtureStudio={state,dispatch,actionTypes,persistence,history,getBackup:()=>get('dsf_autosave')};

// Visible controls for browser-only interaction tests. This file is never a production entrypoint.
const fixturePanel=document.createElement('details');fixturePanel.id='lifecycle-fixture-controls';fixturePanel.style.cssText='position:fixed;right:10px;bottom:8px;z-index:100001;background:#fff1cd;color:#29200c;padding:8px';
const summary=document.createElement('summary');summary.textContent='ローカル検証操作';fixturePanel.append(summary);
const status=document.createElement('p');status.setAttribute('role','status');fixturePanel.append(status);
const action=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{await fn();status.textContent=label+'：完了';}catch(e){status.textContent=e.code||e.message;}};fixturePanel.append(b);};
action('保存失敗を再現',()=>fetch('/fixture/save-failure',{method:'POST',body:JSON.stringify({enabled:true})}));
action('保存を正常に戻す',()=>fetch('/fixture/save-failure',{method:'POST',body:JSON.stringify({enabled:false})}));
action('参加解除を再現',async()=>{
 const call=async c=>{const r=await fetch('/api/invitations',{method:'POST',headers:{Authorization:'Bearer fixture-owner_1','Content-Type':'application/json'},body:JSON.stringify(c)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
 const c={spaceId:'space_demo',memberUid:'reader_1'};const data=await call({kind:'getMemberExit',...c});await call({kind:'removeMember',...c,expectedToken:data.memberToken,requestId:crypto.randomUUID()});await persistence.checkSharedStudioAccess().catch(()=>{});
});
action('退避状態を表示',async()=>{const rows=await persistence.sharedDraftRecovery.list();status.textContent=JSON.stringify(rows.map(x=>({title:x.record.project.title,revision:x.record.revision,persisted:x.persisted,images:x.record.assets.length,body:JSON.stringify(x.record.project.blocks)})));});
document.body.append(fixturePanel);
