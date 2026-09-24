import {mountPersonalSharingInbox} from './personal-sharing-ui.js';
import {openMemberAccessDialog} from './member-access-dialog.js';
import {createPublishingInvitationsUI} from './publishing-invitations-ui.js';
export function createSpaceMembersSettings({root,execute,personalExecute=null,getLocale=()=> 'ja'}){
    let key='',epoch=0,ui=null,personalUI=null;
    const text=(ja,en)=>getLocale()==='en'?en:ja;
    const el=(tag,value)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;return node;};
    function update({uid,spaceId,force=false,manageMembers=true}){
        const next=JSON.stringify([uid,spaceId,getLocale(),manageMembers]);if(next===key&&!force)return;
        key=next;const revision=++epoch;ui?.destroy();ui=null;personalUI?.destroy();personalUI=null;root.replaceChildren();
        const title=el('h2',text('メンバーと招待','Members & invitations'));root.append(title);
        const openSpace=async invitation=>{
            const result=await execute({kind:'listSpaceWorks',spaceId:invitation.spaceId});if(revision!==epoch)return;
            const section=el('section');section.append(el('h3',result.space.name));
            const append=works=>works.forEach(w=>{const link=el('a',w.title);link.href='/studio?room=editor&sharedSpace='+encodeURIComponent(invitation.spaceId)+'&sharedWork='+encodeURIComponent(w.workId);link.className='space-shared-work';section.append(link);});append(result.items);
            if(!result.items.length)section.append(el('p',text('閲覧できる共有作品はまだありません。','No shared works available yet.')));
            let cursor=result.nextCursor;if(cursor){const more=el('button',text('さらに表示','Show more'));more.type='button';more.onclick=async()=>{more.disabled=true;try{const page=await execute({kind:'listSpaceWorks',spaceId:invitation.spaceId,afterId:cursor});if(revision!==epoch)return;append(page.items);cursor=page.nextCursor;more.hidden=!cursor;}catch{more.textContent=text('再試行','Retry');}finally{more.disabled=false;}};section.append(more);}
            root.querySelector('[data-shared-work-list]')?.remove();section.dataset.sharedWorkList='';root.append(section);
        };
        const personalInbox=()=>{const host=el('section');root.append(host);ui=createPublishingInvitationsUI({root:host,execute,getLocale,onOpenSpace:openSpace});};
        if(!uid){root.append(el('p',text('ログインしてください。','Sign in to continue.')));return;}
        if(!spaceId){title.textContent=text('招待と共有','Invitations & sharing');root.append(el('p',text('招待はヘッダーのお知らせベル、承諾済みの作品は左の「共有された作品」から開けます。','Open invitations from the header bell, and accepted works from Shared with me.')));return;}
        if(!manageMembers){root.append(el('p',text('参加中の出版スペースです。メンバー・共有範囲の管理は所有者または管理者が行います。','You have joined this space. Its owner or administrators manage membership and access.')));personalInbox();return;}
        const status=el('p',text('メンバーを読み込み中…','Loading members…'));status.setAttribute('role','status');root.append(status);
        const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
        const reload=()=>update({uid,spaceId,force:true,manageMembers});
        void (async()=>{
            try{
                const data=await execute({kind:'listMembers',spaceId});if(revision!==epoch)return;
                status.textContent=text('参加中のアカウントと担当範囲を確認し、Horizon IDからメンバーを招待できます。','Review members and their access, and invite people by Horizon ID.');title.textContent=data.space.name+' · '+text('メンバーと招待','Members & invitations');root.append(button(text('一覧を更新','Refresh list'),reload));
                const list=el('div');list.className='space-member-list';root.append(list);
                const names=new Map(),members=[data.owner,...data.items];
                const row=m=>{const r=el('article');r.className='space-member-row';r.append(el('strong',m.displayName||m.uid));
                    const role=m.role==='owner'?text('所有者','Owner'):m.role==='admin'?text('管理者','Administrator'):m.grants.map(g=>(g.role==='editor'?text('編集可','Can edit'):text('閲覧のみ','View only'))+' · '+(g.scope==='space'?text('スペース全体','Entire space'):names.get(g.targetId)||text(g.scope==='work'?'指定作品':'指定レーベル',g.scope==='work'?'Selected work':'Selected label'))).join(' / ');
                    r.append(el('span',role));if(m.canChangeScope)r.append(button(text('共有範囲を設定','Sharing access'),()=>openMemberAccessDialog({root,execute,spaceId,memberUid:m.uid,getLocale,isCurrent:()=>revision===epoch,onSaved:reload})));if(m.available===false)r.append(el('small',text('利用制限中','Account unavailable')));list.append(r);};
                row(data.owner);data.items.forEach(row);
                let cursor=data.nextCursor;
                const more=button(text('さらに表示','Show more'),async()=>{more.disabled=true;try{const page=await execute({kind:'listMembers',spaceId,afterUid:cursor});if(revision!==epoch)return;members.push(...page.items);page.items.forEach(row);cursor=page.nextCursor;more.hidden=!cursor;}catch{status.textContent=text('追加のメンバーを取得できませんでした。','Could not load more members.');}finally{more.disabled=false;}});more.hidden=!cursor;root.append(more);
                const inviteRoot=el('section');root.append(inviteRoot);
                let targets=[{scope:'space',name:data.space.name}];
                try{const result=await execute({kind:'listSpaceWorks',spaceId,forInvitation:true});targets=result.targets;if(targets.every(t=>t.scope==='space')){root.insertBefore(el('p',text('共有作品はまだありません。スペースへの招待・参加は先に行えます。作品は共有登録後に表示されます。','There are no shared works yet. You can invite members now; works will appear after sharing is set up.')),inviteRoot);}for(const target of targets)if(target.targetId)names.set(target.targetId,target.name);list.replaceChildren();members.forEach(row);}catch{if(revision!==epoch)return;status.textContent=text('招待対象を確認できませんでした。一覧を更新してください。','Could not verify invitation targets. Refresh the list.');personalInbox();return;}
                if(revision!==epoch)return;
                ui=createPublishingInvitationsUI({root:inviteRoot,execute,spaceId,targets,canInvite:true,getLocale,
                    resolveRecipient:handle=>execute({kind:'resolveRecipient',spaceId,handle}),onOpenSpace:openSpace});
            }catch(e){if(revision!==epoch)return;
                status.textContent=e.message==='INVITATIONS_DISABLED'?text('メンバー管理は準備中です。現在は招待を送信できません。','Member management is being prepared. Invitations are not yet available.'):
                    e.message==='INVITATION_TEST_ONLY'?text('現在は指定したアカウント・出版スペースで招待機能を検証中です。','Invitations are currently being tested with designated accounts and spaces.'):
                    e.message==='SPACE_FORBIDDEN'?text('メンバー管理は所有者・管理者が利用できます。','Only owners and administrators can manage members.'):
                    text('メンバーを取得できませんでした。再試行してください。','Could not load members. Please retry.');
                root.append(button(text('再試行','Retry'),reload));
                if(e.message==='SPACE_FORBIDDEN')personalInbox();
            }
        })();
    }
    return {update,destroy(){epoch++;ui?.destroy();personalUI?.destroy();root.replaceChildren();}};
}
