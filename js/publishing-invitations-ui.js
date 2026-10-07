// Shared UI consumes an authenticated transport. Fixture identity selection lives outside this module.
export function createPublishingInvitationsUI({root,execute,spaceId,recipients=[],targets=[],canInvite=false,resolveRecipient=null,getLocale=()=> 'ja',onOpenSpace=()=>{},inlineInbox=false}) {
    const en=()=>getLocale()==='en', t=(ja,english)=>en()?english:ja;
    let stopped=false,busy=false,modal=null,lastFocus=null,inboxItems=[],cursor=null;
    const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
    const button=(text,action,className)=>{const b=node('button',text,className);b.type='button';b.onclick=action;return b;};
    const status=s=>({pending:t('参加待ち','Pending'),accepted:t('参加済み','Accepted'),declined:t('辞退済み','Declined'),cancelled:t('取り消し済み','Cancelled'),expired:t('期限切れ','Expired')})[s]||s;
    const errors={INVITATION_TEST_ONLY:['現在は指定された検証用スペース・アカウントでのみ利用できます。','Currently available only to the designated test space and accounts.'],INVALID_HANDLE:['Horizon IDを入力してください（@と4〜20文字の英小文字・数字・_）。','Enter a Horizon ID (4–20 lowercase letters, numbers or underscores).'],LOOKUP_RATE_LIMIT:['検索が続いています。少し待ってから再度お試しください。','Too many lookups. Please wait before trying again.'],INVITATION_PENDING:['この相手には参加待ちの招待があります。','This person already has a pending invitation.'],ALREADY_MEMBER:['すでに参加しています。','Already a member.'],INVITATION_CLOSED:['この招待は終了しています。最新の状態をご確認ください。','This invitation has closed. Refresh to see its current state.'],INVITER_UNAVAILABLE:['招待者の権限が変更されたため、参加できません。','The inviter can no longer grant this access.'],SHARING_NOT_READY:['リード共有の準備中です。まだ参加を確定できません。','Sharing is not ready. Joining is not available yet.'],INVITE_RATE_LIMIT:['本日の招待上限に達しました。','Daily invitation limit reached.']};
    root.replaceChildren();root.classList.add('invitations-ui');
    const toolbar=node('div',undefined,'invitation-toolbar'), title=node('h1',t('招待とお知らせ','Invitations & notifications'));
    const bell=button('',()=>openInbox(),'notification-bell');bell.setAttribute('aria-label',t('お知らせ','Notifications'));
    bell.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
    const badge=node('span','0','notification-badge');badge.hidden=true;bell.append(badge);toolbar.append(title,bell);if(inlineInbox){title.textContent=t('出版スペースへの招待','Publishing space invitations');bell.textContent=t('更新','Refresh');bell.onclick=()=>refresh();}
    const message=node('p','', 'invitation-message');message.setAttribute('role','status');
    const retry=button(t('再読み込み','Retry'),()=>refresh());retry.hidden=true;
    const content=node('section');root.append(toolbar,message,retry,content);
    function close(){if(modal){modal.close();modal.remove();modal=null;lastFocus?.isConnected&&lastFocus.focus();}}
    function dialog(heading){if(stopped)return node('div');const prior=modal?lastFocus:document.activeElement;close();lastFocus=prior;modal=node('dialog',undefined,'invitation-dialog');const top=node('div',undefined,'invitation-dialog-heading');const h=node('h2',heading);h.id='invitation-dialog-title';modal.setAttribute('aria-labelledby',h.id);top.append(h,button(t('閉じる','Close'),close));modal.append(top);root.append(modal);modal.addEventListener('cancel',e=>{e.preventDefault();close();});modal.showModal();return modal;}
    async function run(fn){if(busy||stopped)return;busy=true;root.setAttribute('aria-busy','true');const controls=[...root.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);
        message.textContent='';retry.hidden=true;
        try{return await fn();}catch(error){retry.hidden=false;const pair=errors[error.message];const text=pair?t(...pair):t('処理できませんでした。更新して再度お試しください。','Could not complete the action. Refresh and try again.');message.textContent=text;
            if(modal){let alert=modal.querySelector('[role="alert"]');if(!alert){alert=node('p');alert.setAttribute('role','alert');modal.append(alert);}alert.textContent=text;}
        }finally{busy=false;if(!stopped)root.removeAttribute('aria-busy');controls.forEach(b=>b.disabled=false);}}
    async function refreshBadge(){const data=await execute({kind:'inbox'});if(stopped)return;badge.textContent=data.unreadCount>99?'99+':String(data.unreadCount);badge.hidden=data.unreadCount===0;bell.setAttribute('aria-label',t('お知らせ','Notifications')+(data.unreadCount?' · '+data.unreadCount:''));return data;}
    function describe(i,parent){parent.append(node('p',i.spaceName,'invitation-space'),node('p',t('招待者：','Invited by: ')+i.inviterName));
        const role=i.role==='admin'?t('管理者','Administrator'):t('担当範囲','Assigned access');parent.append(node('h3',role));
        const list=node('ul');i.grants.forEach((g,j)=>list.append(node('li',(g.role==='editor'?t('編集可','Can edit'):t('閲覧のみ','View only'))+' · '+i.scopeLabels[j])));parent.append(list);
        parent.append(node('p',t('期限：','Expires: ')+(i.expiresAt===null?t('無期限','No expiration'):new Date(i.expiresAt).toLocaleString(en()?'en-GB':'ja-JP'))),node('p',status(i.status),'invitation-status'));}
    async function detail(id){await run(async()=>{const result=await execute({kind:'read',id});await refreshBadge();const i=result.invitation,d=dialog(t('出版スペースへの招待','Publishing space invitation'));describe(i,d);
        if(i.status==='pending'){
            d.append(node('p',t('承諾すると、上記の権限で参加します。','Accept to join with the access shown above.')));
            const actions=node('div',undefined,'invitation-actions');
            const accept=button(t('承諾して開く','Accept and open'),()=>resolve(id,'accept'),'primary');
            if(result.canAccept===false){accept.disabled=true;d.append(node('p',t('共有の準備が終わると承諾できます。招待はこの画面から確認できます。','You can accept once sharing is ready. Your invitation remains available here.')));}
            actions.append(button(t('辞退する','Decline'),()=>resolve(id,'decline')),accept);d.append(actions);
        }else if(i.status==='accepted')d.append(button(t('スペースを開く','Open space'),()=>run(async()=>{close();await onOpenSpace(i);}),'primary'));
    });}
    async function resolve(id,kind){await run(async()=>{const result=await execute({kind,id});if(stopped)return;await refreshBadge();close();message.textContent=kind==='accept'?t('招待を承諾しました。','Invitation accepted.'):t('招待を辞退しました。','Invitation declined.');if(kind==='accept')await onOpenSpace(result.invitation);});}
    function renderInbox(d){const old=d.querySelector('.notification-list');if(old)old.remove();const list=node('div',undefined,'notification-list');
        if(!inboxItems.length)list.append(node('p',t('お知らせはありません。','No notifications.')));
        for(const n of inboxItems){const i=n.invitation,row=button('',()=>detail(i.id),'notification-row');row.classList.toggle('unread',n.readAt===null);row.append(node('strong',t('出版スペースへの招待','Publishing space invitation')),node('span',i.spaceName+' · '+i.inviterName),node('small',status(i.status)+' · '+new Date(n.createdAt).toLocaleDateString(en()?'en-GB':'ja-JP')));list.append(row);}
        if(cursor)list.append(button(t('さらに表示','Show more'),()=>run(async()=>{const more=await execute({kind:'inbox',cursor});inboxItems.push(...more.items);cursor=more.nextCursor;renderInbox(d);})));d.append(list);
    }
    async function openInbox(){await run(async()=>{const data=await refreshBadge();if(!data)return;inboxItems=data.items;cursor=data.nextCursor;const d=dialog(t('お知らせ','Notifications'));renderInbox(d);});}
    async function refreshOutbox(){if(!canInvite)return;const data=await execute({kind:'outbox',spaceId});if(stopped)return;content.replaceChildren();const head=node('div',undefined,'invitation-toolbar');head.append(node('h2',t('送った招待','Sent invitations')),button(t('メンバーを招待','Invite member'),openCreate,'primary'),button(t('更新','Refresh'),()=>run(async()=>{await refreshOutbox();await refreshBadge();})));content.append(head);
        const list=node('div',undefined,'sent-invitations');content.append(list);
        const append=items=>{for(const i of items){const row=node('article',undefined,'sent-invitation');row.append(node('strong',recipients.find(r=>r.uid===i.recipientUid)?.name||i.recipientName||i.recipientUid),node('span',i.scopeLabels.join(' / ')),node('span',status(i.status)));if(i.status==='pending')row.append(button(t('取り消す','Cancel invitation'),()=>{const d=dialog(t('招待を取り消しますか','Cancel this invitation?'));describe(i,d);d.append(button(t('招待を取り消す','Cancel invitation'),()=>run(async()=>{await execute({kind:'cancel',id:i.id});close();await refreshOutbox();})));}));list.append(row);}};
        append(data.items);if(!data.items.length)list.append(node('p',t('送った招待はありません。','No sent invitations.')));
        let next=data.nextCursor;if(next){const more=button(t('さらに表示','Show more'),()=>run(async()=>{const page=await execute({kind:'outbox',spaceId,cursor:next});append(page.items);next=page.nextCursor;more.hidden=!next;}));content.append(more);}
    }
    function field(parent,label,id,options){const l=node('label',label),select=node('select');select.id=id;for(const [value,text]of options){const option=node('option',text);option.value=value;select.append(option);}l.htmlFor=id;parent.append(l,select);return select;}
    function openCreate(){const d=dialog(t('メンバーを招待','Invite member')),form=node('form');d.append(form);
        let person=null,who;
        if(resolveRecipient){
            const label=node('label',t('招待先のHorizon ID','Recipient Horizon ID'));label.htmlFor='invitation-handle';
            who=node('input');who.id='invitation-handle';who.placeholder='@sato';who.maxLength=21;who.autocomplete='off';who.spellcheck=false;
            const found=node('div','', 'invitation-recipient-preview');found.setAttribute('aria-live','polite');
            const lookup=button(t('相手を確認','Find recipient'),()=>run(async()=>{
                person=null;found.textContent='';const handle=who.value.trim();
                const result=await resolveRecipient(handle);if(who.value.trim()!==handle||!form.isConnected)return;
                person=result.recipient;
                found.textContent=person?person.displayName+' · @'+person.handle:t('該当するアカウントが見つかりません。','No matching account found.');
            }));
            who.oninput=()=>{person=null;found.textContent='';who.setCustomValidity('');};form.append(label,who,lookup,found);
        }else{
            who=field(form,t('招待先のHorizonアカウント','Horizon account'),'invitation-recipient',[[ '',t('相手を選択','Choose recipient')],...recipients.map(r=>[r.uid,r.name+' · '+r.uid])]);
        }
        const role=field(form,t('権限','Permission'),'invitation-role',[['viewer',t('閲覧のみ','View only')],['editor',t('編集可','Can edit')]]);
        const target=field(form,t('担当範囲','Scope'),'invitation-target',targets.map((v,i)=>[String(i),v.name]));
        const expiry=field(form,t('有効期限','Expires in'),'invitation-expiry',[['1',t('1日','1 day')],['3',t('3日','3 days')],['7',t('7日','7 days')],['14',t('14日','14 days')],['30',t('30日','30 days')],['none',t('無期限','No expiration')]]);
        expiry.value='7';
        const review=button(t('招待内容を確認','Review invitation'),()=>{if(!who.value||(resolveRecipient&&!person)){who.focus();who.setCustomValidity(t('招待する相手を確認してください。','Confirm the recipient first.'));who.reportValidity();return;}who.setCustomValidity('');
            const selected=resolveRecipient?person:recipients.find(r=>r.uid===who.value),scope=targets[Number(target.value)];if(!selected||!scope)return;
            const c={kind:'invite',id:'inv_'+crypto.randomUUID(),spaceId,recipientUid:selected.uid,role:'member',grants:[{role:role.value,scope:scope.scope,...(scope.targetId?{targetId:scope.targetId}:{})}],expiryDays:expiry.value==='none'?null:Number(expiry.value)};
            const reviewDialog=dialog(t('招待内容の確認','Review invitation'));reviewDialog.append(node('p',(selected.displayName||selected.name)+' · '+(selected.handle?'@'+selected.handle:selected.uid)),node('p',scope.name+' · '+(role.value==='editor'?t('編集可','Can edit'):t('閲覧のみ','View only'))),node('p',t('有効期限：','Expires in: ')+expiry.options[expiry.selectedIndex].textContent),node('p',t('相手がお知らせから承諾すると参加が確定します。','The recipient joins after accepting in Notifications.')));
            reviewDialog.append(button(t('招待する','Send invitation'),()=>run(async()=>{await execute(c);close();message.textContent=t('相手のお知らせに招待を届けました。','Invitation added to the recipient’s notifications.');await refreshOutbox();}),'primary'));
        },'primary');who.onchange=()=>who.setCustomValidity('');form.onsubmit=e=>e.preventDefault();form.append(review);
    }
    async function refresh(){await run(async()=>{const data=await refreshBadge();if(inlineInbox&&data){inboxItems=data.items;cursor=data.nextCursor;renderInbox(content);}else if(canInvite)await refreshOutbox();else if(!content.childNodes.length)content.append(node('p',t('ベルマークから招待のお知らせを確認できます。','Open the bell to view invitations.')));});}
    const focus=()=>{if(!busy&&!modal&&!document.hidden)refresh();};window.addEventListener('focus',focus);
    const timer=setInterval(()=>{if(!document.hidden&&!modal&&!busy)refresh();},30000);
    refresh();return {refresh,destroy(){stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);close();root.replaceChildren();}};
}
