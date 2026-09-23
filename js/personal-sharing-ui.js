import {accountJsonRequest} from './account-json-request.js';
export function createPersonalSharingClient({getUser,fetchImpl=fetch}){
    return command=>accountJsonRequest({getUser,fetcher:fetchImpl,url:'/api/personal-sharing',command,
        readOnly:['prepare','inbox','outbox','readiness','prepare-source','prepare-images'].includes(command.kind),limit:500000,timeoutMs:120000,
        errors:{auth:'AUTH_REQUIRED',timeout:'SHARING_TIMEOUT',offline:'SHARING_OFFLINE',invalid:'SHARING_INVALID',unavailable:'SHARING_UNAVAILABLE'}});
}
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,action)=>{const b=node('button',text);b.type='button';b.onclick=action;return b;};
const message=(error,en)=>({PERSONAL_SHARING_DISABLED:en?'Personal sharing is being prepared.':'作品の個別共有は準備中です。',
    PERSONAL_SHARING_NOT_ENABLED:en?'Sharing is currently limited to test accounts.':'現在は指定アカウントで検証中です。',
    PROJECT_NOT_MIGRATED:en?'This project needs private cloud storage before it can be shared.':'この原稿は個別共有に対応した非公開クラウド保存への移行が必要です。',
    PRIVATE_IMAGES_REQUIRED:en?'Images need private storage before this project can be shared.':'画像を非公開の共有用保存先へ移行してから共有できます。',
    WORK_SHARING_LIMIT:en?'This project has reached its active sharing limit. Revoke an invitation or access first.':'この作品の招待・共有人数が上限に達しています。不要な共有を解除してください。',
    RECIPIENT_SHARING_LIMIT:en?'The recipient has reached their active sharing limit.':'相手が受け取れる招待・共有の上限に達しています。',
    DAILY_INVITATION_LIMIT:en?'Today’s invitation limit has been reached. Try again tomorrow.':'本日の招待送信上限に達しました。日を改めてお試しください。',
    LOOKUP_LIMIT:en?'Too many account searches. Try again in a minute.':'検索が続いています。少し待ってから再度お試しください。',
    PERSONAL_WORK_REQUIRED:en?'Select a project in My space.':'マイスペースのプロジェクトを選択してください。',
    ALREADY_SHARED:en?'This person is already invited or has access.':'この相手には招待済み、または共有中です。',
    IMAGE_PREPARATION_BLOCKED:en?'Some images could not be verified. Reimport missing or unsupported images.':'検証できない画像があります。元の画像を取り込み直してください。',
    MAINTENANCE_SOURCE_CHANGED:en?'The manuscript changed. Reopen sharing preparation.':'原稿が更新されました。共有画面を開き直してください。',
    SOURCE_CHANGED:en?'The manuscript changed. Close and reopen sharing.':'原稿が更新されました。共有画面を開き直してください。',
    WORK_FORBIDDEN:en?'Access has ended or is unavailable.':'共有が解除されたか、閲覧できない状態です。',
    INVITATION_CLOSED:en?'This invitation is no longer available. Refresh the list.':'この招待は終了しています。一覧を更新してください。'}[error.message]|| (en?'Could not complete the operation. Please retry.':'操作できませんでした。再試行してください。'));
function historySection(items,en,archive){
    const ended=items.filter(i=>!['pending','accepted'].includes(i.status));if(!ended.length)return null;
    const details=node('details');details.append(node('summary',(en?'Invitation history':'終了した招待')+' ('+ended.length+')'));
    const labels={expired:en?'Expired':'期限切れ',declined:en?'Declined':'辞退',revoked:en?'Revoked':'共有解除済み'};
    for(const i of ended)details.append(node('p',(i.title||i.recipientName)+' · '+(labels[i.status]||i.status)));
    details.append(button(en?'Clear finished invitations from this list':'終了した招待を一覧から整理',archive));return details;
}
export function openPersonalSharingDialog({projectId,name,execute,getLocale=()=> 'ja',isCurrent=()=>true}){
    const en=getLocale()==='en',d=node('dialog');d.className='project-copy-dialog personal-sharing-dialog';
    d.append(node('h2',en?'Share project':'プロジェクトを共有'),node('p',name),node('p',en?'Invite someone to view the latest saved manuscript. Only this project is shared; editing is not allowed.':'最新の保存済み原稿を閲覧できる相手を招待します。この作品だけを共有し、編集は許可しません。'));
    const status=node('p');status.setAttribute('role','status');const content=node('div');d.append(status,content);
    let alive=true,busy=false,prepared=null,recipient=null,requestId=null;
    const close=()=>{if(busy)return;alive=false;d.close();d.remove();};d.append(button(en?'Close':'閉じる',close));d.addEventListener('cancel',e=>{e.preventDefault();close();});
    const valid=()=>alive&&isCurrent();
    async function run(action){if(busy)return;busy=true;d.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);status.textContent=en?'Working…':'処理中…';
        try{if(!valid())throw new Error('AUTH_REQUIRED');await action();if(valid())status.textContent='';}
        catch(e){if(alive)status.textContent=message(e,en);}finally{busy=false;if(alive)d.querySelectorAll('button,input,select').forEach(n=>n.disabled=false);}}
    function render(){content.replaceChildren();
        if(prepared.readiness){
            const r=prepared.readiness;
            content.append(node('h3',en?'Sharing preparation':'共有前の確認'));
            if(r.storage==='legacy')content.append(node('p',en?'This manuscript uses an older save format. Prepare a verified private copy before inviting anyone.':'この原稿は旧方式で保存されています。共有前にバックアップを作り、非公開の保存方式へ移します。'));
            if(r.images.managed)content.append(node('p',en?`${r.images.managed} images need migration to private storage.`:`共有の準備が必要な画像が ${r.images.managed} 点あります。内容を検証して非公開保存へコピーします。`));
            if(r.images.unsupported)content.append(node('p',en?`${r.images.unsupported} image references could not be prepared. Import the original image files into the project.`:`共有に対応していない画像が ${r.images.unsupported} 点あります。元の画像ファイルをプロジェクトに取り込んでください。`));
            content.append(node('p',en?'This check did not change the manuscript, images, or publication.':'この確認では原稿・画像・公開状態を変更していません。'));
        }
        if(prepared.readiness&&!prepared.readiness.images.unsupported){
            content.append(button(en?'Prepare private sharing':'個別共有の準備をする',()=>run(async()=>{
                const r=prepared.readiness;
                if(r.storage==='legacy'){
                    const generationId='personal_'+crypto.randomUUID();
                    const plan=await execute({kind:'prepare-source',projectId,generationId});if(!valid())return;
                    await execute({kind:'migrate-source',projectId,...plan,confirm:true});if(!valid())return;
                }
                const plan=await execute({kind:'prepare-images',projectId});if(!valid())return;
                if(plan.images.uniqueImages){
                    if(!plan.ready)throw new Error('IMAGE_PREPARATION_BLOCKED');
                    await execute({kind:'migrate-images',projectId,confirmationToken:plan.confirmationToken,imagePlanHash:plan.imagePlanHash,requestId:'personal_'+crypto.randomUUID(),confirm:true});
                }
                if(valid())await load();
            })));
            content.append(node('p',en?'Close other editor tabs before continuing. A verified source backup is kept; existing public images and published editions are retained.':'編集中の別タブを閉じてから実行してください。原稿のバックアップを保持し、既存の公開画像や発行済み作品は削除しません。'));
        }
        if(prepared.generationId){
        const label=node('label',en?'Horizon ID':'招待先のHorizon ID'),input=node('input');input.placeholder='@horizon_id';label.append(input);content.append(label);
        const found=node('p'),options=node('div');content.append(button(en?'Find account':'相手を確認',()=>run(async()=>{
            const result=await execute({kind:'lookup',handle:input.value});if(!valid())return;recipient=result.recipient;requestId=null;
            found.textContent=recipient?recipient.displayName+' (@'+recipient.handle+')':(en?'Account not found.':'アカウントが見つかりません。');options.replaceChildren();
            if(recipient){const l=node('label',en?'Invitation expires':'招待の有効期限'),select=node('select');
                for(const days of [1,3,7,14,30,null]){const o=node('option',days===null?(en?'No expiry':'無期限'):days+(en?' days':'日'));o.value=days===null?'':String(days);select.append(o);}select.value='7';l.append(select);options.append(l,node('p',en?'Expiry applies to accepting the invitation. Accepted access lasts until revoked.':'有効期限は招待の承諾期限です。承諾後は共有を解除するまで閲覧できます。'));
                select.onchange=()=>requestId=null;
                options.append(button(en?'Send view-only invitation':'閲覧のみで招待する',()=>run(async()=>{
                    requestId ||= 'personal_'+crypto.randomUUID();
                    await execute({kind:'invite',id:requestId,projectId,recipientUid:recipient.uid,revision:prepared.revision,generationId:prepared.generationId,expiresInDays:select.value===''?null:Number(select.value)});
                    if(valid())await load();
                })));
            }
        })),found,options);
        input.oninput=()=>{recipient=null;requestId=null;found.textContent='';options.replaceChildren();};
        }
        content.append(node('h3',en?'People with invitations or access':'招待・共有している相手'));
        const active=prepared.items.filter(i=>['pending','accepted'].includes(i.status));
        if(!active.length)content.append(node('p',en?'No one has access yet.':'まだ共有していません。'));
        for(const i of active){const row=node('p',i.recipientName+' · '+(i.status==='accepted'?(en?'View only':'閲覧のみ'):(en?'Pending':'承諾待ち')));
            row.append(button(en?'Revoke':'共有を解除',()=>run(async()=>{await execute({kind:'revoke',id:i.id});if(valid())await load();})));content.append(row);}
        const history=historySection(prepared.items,en,()=>run(async()=>{await execute({kind:'archive',projectId});if(valid())await load();}));if(history)content.append(history);
    }
    async function load(){prepared=await execute({kind:'outbox',projectId});if(!valid())return;render();
        try{const result=await execute({kind:'prepare',projectId});if(!valid())return;prepared=result;render();}
        catch(error){if(['PROJECT_NOT_MIGRATED','PRIVATE_IMAGES_REQUIRED'].includes(error.message)){
            const readiness=await execute({kind:'readiness',projectId});if(!valid())return;prepared={...prepared,readiness};render();return;
        }throw error;}
    }
    document.body.append(d);d.showModal();void run(load);return d;
}
export function mountPersonalSharingInbox({root,execute,getLocale=()=> 'ja',isCurrent=()=>true,onOpen=null}){
    const en=getLocale()==='en',section=node('section');section.className='personal-sharing-inbox';root.append(section);
    const title=node('h3',en?'Shared with me':'共有された作品'),status=node('p'),list=node('div');status.setAttribute('role','status');
    let alive=true,revision=0;
    const open=i=>{if(onOpen)return onOpen(i);location.href='/studio?room=editor&sharedSpace=personal&sharedWork='+encodeURIComponent(i.workId);};
    const refresh=button(en?'Notifications / refresh':'🔔 招待を確認・更新',load);section.append(title,refresh,status,list);
    async function load(){const version=++revision;refresh.disabled=true;status.textContent=en?'Loading…':'読み込み中…';
        try{const result=await execute({kind:'inbox'});if(!alive||!isCurrent()||version!==revision)return;
            refresh.textContent=(en?'Notifications':'🔔 招待')+' ('+result.pendingCount+')';status.textContent='';list.replaceChildren();
            const items=result.items.filter(i=>['pending','accepted'].includes(i.status));
            if(!items.length)list.append(node('p',en?'No shared projects or pending invitations.':'共有された作品や承諾待ちの招待はありません。'));
            for(const i of items){const row=node('article');row.append(node('strong',i.title),node('p',i.inviterName+' · '+(en?'View only':'閲覧のみ')));
                if(i.status==='accepted')row.append(button(en?'Open':'開く',()=>open(i)));
                else {row.append(node('p',en?'Only this project is shared. You will not join a publishing space.':'この作品だけを閲覧します。出版スペースには所属しません。'));
                    for(const [kind,label]of [['accept',en?'Accept invitation':'招待を承諾'],['decline',en?'Decline':'辞退']])row.append(button(label,async()=>{
                        row.querySelectorAll('button').forEach(b=>b.disabled=true);try{if(!isCurrent())return;await execute({kind,id:i.id});await load();}catch(e){if(alive)status.textContent=message(e,en);row.querySelectorAll('button').forEach(b=>b.disabled=false);}
                    }));}list.append(row);}
            const history=historySection(result.items,en,async()=>{if(!alive||!isCurrent())return;refresh.disabled=true;try{await execute({kind:'archive'});await load();}catch(e){if(alive)status.textContent=message(e,en);}finally{if(alive)refresh.disabled=false;}});if(history)list.append(history);
        }catch(e){if(alive&&version===revision)status.textContent=message(e,en);}finally{if(alive&&version===revision)refresh.disabled=false;}}
    const focus=()=>{if(alive&&isCurrent())void load();};window.addEventListener('focus',focus);void load();
    return {destroy(){alive=false;revision++;window.removeEventListener('focus',focus);section.remove();}};
}
