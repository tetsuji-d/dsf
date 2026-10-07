export function openMemberExitDialog({root,execute,spaceId,memberUid,self=false,getLocale,isCurrent,beforeLeave=async()=>{},onEnded=()=>{}}){
    const t=(ja,en)=>getLocale()==='en'?en:ja,node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    const dialog=node('dialog');dialog.className='invitation-dialog member-exit-dialog';root.append(dialog);
    const title=node('h2',self?t('出版スペースから脱退','Leave publishing space'):t('メンバーの参加を解除','Remove member'));
    title.id='member-exit-title';dialog.setAttribute('aria-labelledby',title.id);
    const status=node('p',t('現在の参加情報を確認しています…','Checking current membership…'));status.setAttribute('role','status');dialog.append(title,status);dialog.showModal();
    let busy=false,command=null;const current=()=>dialog.isConnected&&isCurrent();
    const close=()=>{if(!busy){dialog.close();dialog.remove();}};
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=fn;return b;};
    const cancel=button(t('キャンセル','Cancel'),close);dialog.append(cancel);
    void (async()=>{try{
        const data=await execute({kind:'getMemberExit',spaceId,memberUid});if(!current())return;
        dialog.insertBefore(node('p',data.space.name+' / '+data.member.displayName),status);
        dialog.insertBefore(node('p',t('このスペースで担当している共有原稿を閲覧・編集できなくなります。原稿・画像・公開済みリードは削除されません。再参加には新しい招待と承諾が必要です。','Access to shared manuscripts in this space will end. Manuscripts, images and published Reads remain. Rejoining requires a new invitation and acceptance.')),status);
        if(self)dialog.insertBefore(node('p',t('このタブの未保存変更は先に保存します。別のタブや端末で編集中の内容も、脱退前に保存してください。','Unsaved changes in this tab will be saved first. Save work in other tabs and devices before leaving.')),status);
        status.textContent='';
        const submit=button(self?t('保存して脱退','Save and leave'):t('参加を解除','Remove member'),async()=>{
            if(busy||!current())return;busy=true;submit.disabled=true;cancel.disabled=true;
            try{
                if(self&&!command){status.textContent=t('未保存変更を確認しています…','Checking unsaved changes…');await beforeLeave(spaceId);if(!current())return;}
                command??={kind:self?'leaveSpace':'removeMember',spaceId,memberUid,expectedToken:data.memberToken,requestId:crypto.randomUUID()};
                await execute(command);if(!current())return;busy=false;close();await onEnded({spaceId,memberUid,self});
            }catch(e){if(!current())return;const conflict=e.message==='MEMBER_CONFLICT'||e.code==='MEMBER_CONFLICT';
                status.textContent=conflict?t('参加情報が変更されています。閉じて開き直してください。','Membership changed. Close and reopen this dialog.'):
                    !command?t('原稿を保存できなかったため脱退していません。接続と保存状態を確認してください。','You have not left because saving failed. Check the connection and save status.'):
                    t('完了を確認できませんでした。同じ操作を再試行できます。','Completion could not be confirmed. Retry the same operation.');
                submit.disabled=conflict;submit.textContent=t('再試行','Retry');
            }finally{busy=false;cancel.disabled=false;if(!command)submit.disabled=false;}
        });submit.className='primary';dialog.append(submit);
    }catch{if(current())status.textContent=t('参加情報を取得できません。閉じて接続と権限を確認してください。','Could not load membership. Close and check access and connection.');}})();
    return dialog;
}
