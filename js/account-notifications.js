import {createPersonalSharingClient} from './personal-sharing-ui.js';
import {studioRollout} from './studio-rollout.js';
import {createInvitationsClient} from './publishing-invitations-transport.js';
import '../css/account-notifications.css';

const bellIcon='<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,action)=>{const b=el('button',text);b.type='button';b.onclick=action;return b;};
const disabledSources=new Set(['PERSONAL_SHARING_DISABLED','PERSONAL_SHARING_NOT_ENABLED','INVITATIONS_DISABLED','INVITATION_TEST_ONLY']);

// One account inbox on every surface. Reading a notice never accepts an invitation.
export function createAccountNotifications({getUser,getLocale=()=>document.documentElement.lang,
    buttons=[...document.querySelectorAll('[data-account-notifications],[data-studio-notifications]')],
    personal=createPersonalSharingClient({getUser,timeoutMs:15000}),spaces=createInvitationsClient({getUser}),pollMs=60000,features=studioRollout}) {
    const sources=[...(features.personalSharing?['personal']:[]),...(features.invitations?['space']:[])];
    if(!sources.length){
        for(const b of buttons)b.hidden=true;
        return {update(){},open(){},refresh:async()=>{},destroy(){}};
    }
    let account=null,epoch=0,request=null,dialog=null,body=null,feedback=null,opener=null,detail=null,busy=false,destroyed=false;
    let actionVersion=0;
    let records=[],failures=[],unread=0,spaceCursor=null,loaded=false;
    const t=(ja,en)=>getLocale()==='en'?en:ja;
    const clients={personal,space:spaces};
    const status=value=>({pending:t('承諾待ち','Pending'),accepted:t('承諾済み','Accepted'),declined:t('辞退済み','Declined'),cancelled:t('取り消し済み','Cancelled'),revoked:t('共有解除済み','Revoked'),expired:t('期限切れ','Expired')})[value]||value;
    for(const b of buttons){b.classList.add('account-notification-bell');b.innerHTML=bellIcon+'<span data-notification-count>0</span>';b.setAttribute('aria-haspopup','dialog');b.addEventListener('click',open);}
    function paintBadge(){for(const b of buttons){b.hidden=false;const count=b.querySelector('[data-notification-count]');count.hidden=false;count.textContent=failures.length?'!':unread>99?'99+':String(unread);b.title=t('お知らせ','Notifications');b.setAttribute('aria-label',t('お知らせ','Notifications')+' · '+(failures.length?t('取得できませんでした','Could not load'):t('未読 ','Unread ')+unread));b.setAttribute('aria-expanded',String(!!dialog));}}
    function close(){if(!dialog)return;actionVersion++;busy=false;dialog.close();dialog.remove();dialog=null;body=null;feedback=null;detail=null;opener?.isConnected&&opener.focus();paintBadge();}
    function sync(){if(destroyed)return;const user=getUser()||null;if(account?.uid!==user?.uid){epoch++;account=user;request=null;records=[];failures=[];unread=0;spaceCursor=null;loaded=false;busy=false;close();if(account)void refresh();}paintBadge();}
    const current=(version,uid)=>!destroyed&&version===epoch&&getUser()?.uid===uid;
    const normalize=(kind,item)=>kind==='personal'?{kind,id:item.id,invitation:item,createdAt:item.createdAt,readAt:item.readAt!==undefined?item.readAt:(item.status==='pending'?null:item.updatedAt||item.createdAt)}:{...item,kind,id:item.invitation.id};
    async function refresh(){sync();if(!account)return;if(request)return request;
        const version=epoch,uid=account.uid;
        const task=Promise.allSettled(sources.map(kind=>clients[kind]({kind:'inbox'}))).then(results=>{
            if(!current(version,uid))return;const next=[];failures=[];unread=0;spaceCursor=null;
            results.forEach((result,index)=>{const kind=sources[index];if(result.status==='fulfilled'){
                const items=result.value.items.map(item=>normalize(kind,item));next.push(...items);
                unread+=result.value.unreadCount??items.filter(i=>i.readAt===null).length;
                if(kind==='space')spaceCursor=result.value.nextCursor;
            }else if(!disabledSources.has(result.reason?.code||result.reason?.message))failures.push(kind);});
            records=next.sort((a,b)=>b.createdAt-a.createdAt);loaded=true;paintBadge();if(dialog&&!detail)renderList();
        }).finally(()=>{if(request===task)request=null;});request=task;return task;
    }
    function open(){sync();if(dialog){dialog.focus();return;}opener=document.activeElement;
        dialog=el('dialog');dialog.className='account-notifications-dialog';dialog.setAttribute('aria-labelledby','account-notifications-title');
        const header=el('header'),title=el('h2',t('お知らせ','Notifications'));title.id='account-notifications-title';
        const dismiss=button(t('閉じる','Close'),close);header.append(title,dismiss);body=el('div');body.className='account-notifications-body';
        feedback=el('p');feedback.setAttribute('role','status');dialog.append(header,feedback,body);document.body.append(dialog);
        dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();paintBadge();renderList();if(account)void refresh();
    }
    function renderList(){if(!body)return;detail=null;body.replaceChildren();feedback.textContent='';
        if(!account){body.append(el('p',t('ログインすると招待やお知らせを確認できます。','Sign in to view invitations and notifications.')));return;}
        const toolbar=el('div');toolbar.className='account-notifications-toolbar';toolbar.append(el('span',t('未読 ','Unread ')+unread),button(t('更新','Refresh'),()=>void refresh()));body.append(toolbar);
        if(!loaded)body.append(el('p',t('読み込み中…','Loading…')));
        if(failures.length)body.append(el('p',t('一部のお知らせを取得できませんでした。「更新」で再試行してください。','Some notifications could not be loaded. Select Refresh to try again.')));
        if(loaded&&!records.length&&!failures.length)body.append(el('p',t('お知らせはありません。','No notifications.')));
        for(const record of records){const i=record.invitation,row=button('',()=>void read(record));row.className='account-notification-row';row.classList.toggle('unread',record.readAt===null);
            row.append(el('small',(record.kind==='personal'?t('作品への招待','Project invitation'):t('出版スペースへの招待','Publishing space invitation'))+(record.readAt===null?' · '+t('未読','Unread'):'')),el('strong',i.title||i.spaceName),el('span',i.inviterName+' · '+status(i.status)),el('small',new Date(record.createdAt).toLocaleDateString(getLocale()==='en'?'en-GB':'ja-JP')));body.append(row);}
        if(spaceCursor)body.append(button(t('さらに表示','Show more'),()=>void more()));
    }
    async function run(action){if(busy||!account)return;busy=true;const version=epoch,uid=account.uid,operation=++actionVersion;
        dialog?.setAttribute('aria-busy','true');feedback&&(feedback.textContent='');
        try{await action(()=>current(version,uid)&&operation===actionVersion);}catch(error){if(current(version,uid)&&operation===actionVersion&&feedback)feedback.textContent=t('操作できませんでした。通信と招待の状態を確認して、もう一度お試しください。','Could not complete the action. Check the connection and invitation, then retry.');}
        finally{if(current(version,uid)&&operation===actionVersion){busy=false;dialog?.removeAttribute('aria-busy');}}}
    async function read(record){await run(async valid=>{const result=await clients[record.kind]({kind:'read',id:record.id});if(!valid()||!dialog)return;
        detail={...record,invitation:result.invitation,canAccept:result.canAccept};renderDetail();await request;if(valid())await refresh();});}
    function workLink(work,spaceId){const link=el('a',t('作品を開く','Open project')+' · '+(work.title||work.workId));link.href='/studio?room=editor&sharedSpace='+encodeURIComponent(spaceId)+'&sharedWork='+encodeURIComponent(work.workId);link.target='_blank';link.rel='noopener';link.className='account-notification-link';return link;}
    function renderDetail(){if(!body||!detail)return;body.replaceChildren();feedback.textContent='';const record=detail,i=record.invitation;
        body.append(button(t('一覧へ戻る','Back to notifications'),()=>{detail=null;renderList();}),el('h3',i.title||i.spaceName),el('p',t('招待者：','Invited by: ')+i.inviterName),el('p',status(i.status)));
        if(record.kind==='personal')body.append(el('p',t('この作品の最新の保存内容を閲覧できます。編集は許可されません。','View the latest saved version of this project. Editing is not permitted.')));
        else{const list=el('ul');if(i.role==='admin')list.append(el('li',t('管理者','Administrator')));for(const [index,grant]of (i.grants||[]).entries())list.append(el('li',(grant.role==='editor'?t('編集可','Can edit'):t('閲覧のみ','View only'))+' · '+(i.scopeLabels?.[index]||t('指定範囲','Assigned scope'))));body.append(list);}
        body.append(el('p',t('承諾期限：','Accept by: ')+(i.expiresAt===null?t('無期限','No expiration'):new Date(i.expiresAt).toLocaleString(getLocale()==='en'?'en-GB':'ja-JP'))));
        if(i.status==='pending'){const actions=el('div');actions.className='account-notifications-actions';
            actions.append(button(t('辞退する','Decline'),()=>void respond(record,'decline')));const accept=button(t('招待を承諾','Accept invitation'),()=>void respond(record,'accept'));accept.className='primary';accept.disabled=record.canAccept===false;actions.append(accept);body.append(actions);
            if(record.canAccept===false)body.append(el('p',t('共有の準備が完了すると承諾できます。','You can accept once sharing is ready.')));
        }else if(i.status==='accepted'){
            if(record.kind==='personal')body.append(workLink(i,'personal'));
            else body.append(button(t('共有作品を見る','View shared projects'),()=>void showWorks(record)));
        }
    }
    async function respond(record,kind){await run(async valid=>{const result=await clients[record.kind]({kind,id:record.id});if(!valid()||!dialog)return;
        detail={...record,invitation:result.invitation};renderDetail();feedback.textContent=kind==='accept'?t('招待を承諾しました。','Invitation accepted.'):t('招待を辞退しました。','Invitation declined.');await request;if(valid())await refresh();});}
    async function more(){await run(async valid=>{const result=await spaces({kind:'inbox',cursor:spaceCursor});if(!valid()||!dialog)return;
        const seen=new Set(records.filter(i=>i.kind==='space').map(i=>i.id));records.push(...result.items.map(i=>normalize('space',i)).filter(i=>!seen.has(i.id)));records.sort((a,b)=>b.createdAt-a.createdAt);spaceCursor=result.nextCursor;renderList();});}
    async function showWorks(record){await run(async valid=>{const result=await spaces({kind:'listSpaceWorks',spaceId:record.invitation.spaceId});if(!valid()||!dialog||detail?.id!==record.id)return;
        renderDetail();const list=el('section');list.append(el('h4',t('共有された作品','Shared projects')));body.append(list);const append=items=>{for(const work of items)list.append(workLink(work,record.invitation.spaceId));};append(result.items);
        if(!result.items.length)list.append(el('p',t('閲覧できる作品はまだありません。','No shared projects available yet.')));
        let afterId=result.nextCursor;if(afterId){const next=button(t('さらに表示','Show more'),()=>void run(async validMore=>{const page=await spaces({kind:'listSpaceWorks',spaceId:record.invitation.spaceId,afterId});if(!validMore()||!list.isConnected)return;append(page.items);afterId=page.nextCursor;next.hidden=!afterId;}));list.append(next);}
    });}
    const focus=()=>{sync();if(!document.hidden)void refresh();};const language=()=>{paintBadge();if(dialog){dialog.querySelector('h2').textContent=t('お知らせ','Notifications');dialog.querySelector('header button').textContent=t('閉じる','Close');detail?renderDetail():renderList();}};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);document.addEventListener('studio-ui-language-change',language);
    const observer=new MutationObserver(language);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    const timer=setInterval(focus,pollMs);sync();
    return {update:sync,open,refresh,destroy(){destroyed=true;epoch++;close();clearInterval(timer);observer.disconnect();window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);document.removeEventListener('studio-ui-language-change',language);for(const b of buttons)b.removeEventListener('click',open);}};
}
