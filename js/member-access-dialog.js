export function openMemberAccessDialog({root,execute,spaceId,memberUid,getLocale,isCurrent,onSaved}){
    const en=getLocale()==='en',t=(ja,english)=>en?english:ja;
    const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    const dialog=node('dialog');dialog.className='invitation-dialog member-access-dialog';root.append(dialog);
    const title=node('h2',t('共有範囲を設定','Sharing access'));title.id='member-access-title';dialog.setAttribute('aria-labelledby',title.id);
    const status=node('p',t('設定を読み込み中…','Loading access…'));status.setAttribute('role','status');dialog.append(title,status);dialog.showModal();
    let original,grants,targets,token,busy=false,command=null;
    const current=()=>isCurrent()&&dialog.isConnected;
    const close=()=>{if(!busy){dialog.close();dialog.remove();}};
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
    const select=(label,values,value,change)=>{const l=node('label',label),s=node('select');s.setAttribute('aria-label',label);for(const [v,text] of values){const o=node('option',text);o.value=v;s.append(o);}s.value=value;s.onchange=()=>change(s.value);l.append(s);return l;};
    const targetKey=g=>g.scope+':'+(g.targetId||'');
    const describe=g=>(g.role==='editor'?t('編集可','Can edit'):t('閲覧のみ','View only'))+' · '+(targets.find(x=>targetKey(x)===targetKey(g))?.name||t('対象を確認できません','Unavailable target'));
    function paint(confirm=false){
        if(!current())return;dialog.replaceChildren(title,node('p',original.displayName));
        if(!confirm){
            grants.forEach((g,index)=>{
                const row=node('div');row.className='member-grant-row';
                row.append(select(t('権限','Permission'),[['viewer',t('閲覧のみ','View only')],['editor',t('編集可','Can edit')]],g.role,value=>g.role=value));
                const options=targets.map(x=>[targetKey(x),x.scope==='space'?t('スペース全体','Entire space'):x.name]);
                if(!options.some(([key])=>key===targetKey(g)))options.unshift([targetKey(g),t('対象を確認できません','Unavailable target')]);
                row.append(select(t('共有範囲','Scope'),options,targetKey(g),value=>{const target=targets.find(x=>targetKey(x)===value);if(target){g.scope=target.scope;delete g.targetId;if(target.targetId)g.targetId=target.targetId;}}));
                const remove=button(t('削除','Remove'),()=>{grants.splice(index,1);paint();});remove.disabled=grants.length===1;row.append(remove);dialog.append(row);
            });
            const add=button(t('担当範囲を追加','Add scope'),()=>{grants.push({role:'viewer',scope:'work',targetId:''});paint();});add.disabled=grants.length>=100;dialog.append(add);
        }else{
            dialog.append(node('h3',t('変更前','Before')),...original.grants.map(g=>node('p',describe(g))),node('h3',t('変更後','After')),...grants.map(g=>node('p',describe(g))));
        }
        dialog.append(node('p',t('スペース・レーベル全体の権限は、今後共有される作品にも適用されます。','Space and label access also applies to works shared there in the future.')));
        status.textContent='';dialog.append(status);const actions=node('div');actions.className='invitation-actions';actions.append(button(t('キャンセル','Cancel'),close));
        if(confirm)actions.append(button(t('戻る','Back'),()=>{command=null;paint();}));
        const submit=button(confirm?t('変更を保存','Save changes'):t('変更内容を確認','Review changes'),async()=>{
            if(!confirm){if(grants.some(g=>!targets.some(x=>targetKey(x)===targetKey(g)))){status.textContent=t('共有範囲を選んでください。','Choose an available scope.');return;}paint(true);return;}
            if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
            command??={kind:'setMemberAccess',spaceId,memberUid,expectedToken:token,grants:structuredClone(grants),requestId:crypto.randomUUID()};
            try{await execute(command);if(!current())return;busy=false;close();onSaved();}
            catch(e){if(!current())return;status.textContent=e.message==='MEMBER_CONFLICT'?t('他の操作で権限が変わりました。閉じて設定を開き直してください。','Access changed elsewhere. Close and reopen these settings.'):t('保存を確認できませんでした。同じ変更を再試行できます。','Saving could not be confirmed. Retry the same change.');
                actions.firstChild.disabled=false;if(e.message!=='MEMBER_CONFLICT'){submit.disabled=false;submit.textContent=t('再試行','Retry');}}
            finally{busy=false;}
        });submit.className='primary';actions.append(submit);dialog.append(actions);
    }
    async function load(){
        try{const [data,directory]=await Promise.all([execute({kind:'getMemberAccess',spaceId,memberUid}),execute({kind:'listSpaceWorks',spaceId,forInvitation:true})]);if(!current())return;
            original=data.member;token=data.memberToken;targets=directory.targets;grants=structuredClone(original.grants);paint();
        }catch{if(!current())return;status.textContent=t('設定を取得できませんでした。権限と接続を確認して開き直してください。','Could not load settings. Check access and connection, then reopen.');dialog.append(button(t('閉じる','Close'),close));}
    }
    void load();return dialog;
}
