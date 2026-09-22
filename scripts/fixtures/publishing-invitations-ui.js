import {createFixtureSharedEditor} from '/scripts/fixtures/shared-editor-ui.js';
import {createPublishingInvitationsUI} from '/js/publishing-invitations-ui.js';
let ui,sharedEditor,locale='ja';const actor=document.getElementById('fixture-account');actor.value=sessionStorage.getItem('invitation-fixture-actor')||'owner_1';
const recipients=[{uid:'reader_1',name:'佐藤'},{uid:'reader_2',name:'鈴木'}];
async function request(uid,command){
    const response=await fetch('/api/invitations',{method:'POST',headers:{Authorization:'Bearer fixture-'+uid,'Content-Type':'application/json'},body:JSON.stringify(command)});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
function render(){
    ui?.destroy();sharedEditor?.dispose();const uid=actor.value;sessionStorage.setItem('invitation-fixture-actor',uid);document.documentElement.lang=locale;
    document.getElementById('language').textContent=locale==='ja'?'English':'日本語';document.getElementById('opened-space').replaceChildren();
    document.getElementById('fixture-notice').textContent=locale==='ja'?'検証用アカウントのみ（@sato、@suzuki）。招待と通知はこのPCの検証ファイルに保存します。実際のHorizonへの通知・メール送信・作品共有は行いません。':'Test accounts only. Invitations and notifications persist in a local fixture file. No real Horizon notifications, emails or work sharing.';
    ui=createPublishingInvitationsUI({root:document.getElementById('invitations-root'),spaceId:'space_demo',canInvite:uid==='owner_1',recipients,getLocale:()=>locale,
        targets:locale==='ja'?[{scope:'space',name:'スペース全体'},{scope:'label',targetId:'label_sea',name:'レーベル：海辺文庫'},{scope:'work',targetId:'work_library',name:'作品：潮騒の図書館'}]:[{scope:'space',name:'Entire space'},{scope:'label',targetId:'label_sea',name:'Label: Seaside books'},{scope:'work',targetId:'work_library',name:'Work: Library of the tides'}],
        execute:command=>request(uid,command),
        resolveRecipient:handle=>request(uid,{kind:'resolveRecipient',spaceId:'space_demo',handle}),
        onOpenSpace:async i=>{
            const result=await request(uid,{kind:'listSpaceWorks',spaceId:i.spaceId});if(actor.value!==uid)return;
            const box=document.getElementById('opened-space');box.replaceChildren();box.className='fixture-opened';
            const h=document.createElement('h2');h.textContent=result.space.name;
            const p=document.createElement('p');p.textContent=locale==='ja'?'参加を確認しました。権限のある作品だけを表示しています。':'Joined successfully. Only permitted works are shown.';
            const editorRoot=document.createElement('section');editorRoot.id='shared-editor-root';sharedEditor?.dispose();sharedEditor=createFixtureSharedEditor({root:editorRoot,uid,isCurrent:()=>actor.value===uid,locale});
            const list=document.createElement('ul');list.id='permitted-works';
            for(const work of result.items){const row=document.createElement('li');row.textContent=work.title+' · '+(work.canEdit?(locale==='ja'?'編集可':'Can edit'):(locale==='ja'?'閲覧のみ':'View only'));const open=document.createElement('button');open.textContent=locale==='ja'?'原稿を開く':'Open manuscript';open.onclick=()=>sharedEditor.open(work);row.append(open);list.append(row);}
            box.append(h,p,list,editorRoot);if(!result.items.length){const empty=document.createElement('p');empty.textContent=locale==='ja'?'表示できる作品はありません。':'No accessible works.';box.append(empty);}
        }
    });
}
actor.onchange=render;document.getElementById('language').onclick=()=>{locale=locale==='ja'?'en':'ja';render();};render();
