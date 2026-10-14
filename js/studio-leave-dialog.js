// Explicit navigation choice, independent of cloud/file persistence evidence.
export function createStudioLeaveGuard({read,choose,save,discard}) {
    let pending=false;
    return async()=>{
        if(pending)return false;
        const before=read(),identity=before.identity;if(!before.blocked&&!before.busy)return true;
        pending=true;
        try{
            const current=()=>read().identity===identity;
            const answer=await choose({read,save:async()=>{
                if(!current())throw Error('WORK_CHANGED');
                await save();
                if(!current())throw Error('WORK_CHANGED');
                const next=read();return !next.blocked&&!next.busy;
            }});
            if(!current())return false;
            if(answer==='discard'){discard();return true;}
            const next=read();return answer==='saved'&&!next.blocked&&!next.busy;
        }finally{pending=false;}
    };
}

export function showStudioLeaveDialog({read,save,locale='ja',documentRef=document}) {
    const en=locale==='en',doc=documentRef,previous=doc.activeElement;
    const dialog=doc.createElement('dialog');dialog.className='studio-leave-dialog';dialog.setAttribute('aria-labelledby','studio-leave-title');
    const node=(tag,text)=>{const el=doc.createElement(tag);el.textContent=text;return el;};
    const title=node('h2',en?'Leave this manuscript?':'原稿を開いたまま移動しますか？');title.id='studio-leave-title';
    const name=node('strong',read().title||(en?'Untitled manuscript':'無題の原稿'));
    const description=node('p',en?'You can leave without another save. Unsaved changes may be lost. Existing saved data and backups are kept; saves already started are not undone.':'追加で保存せずに移動できます。未保存の変更は失われる場合があります。保存済みデータとバックアップは残り、開始済みの保存は取り消されません。');
    const status=node('p','');status.setAttribute('role','status');
    const actions=node('div','');actions.className='studio-leave-actions';
    const cancel=node('button',en?'Keep editing':'編集を続ける'),skip=node('button',en?'Leave without saving':'保存せずに移動'),store=node('button',en?'Save and leave':'保存して移動');
    for(const b of [cancel,skip,store])b.type='button';store.className='studio-leave-primary';cancel.autofocus=true;
    actions.append(cancel,skip,store);dialog.append(title,name,description,status,actions);doc.body.append(dialog);
    let finished=false,saving=false,saveAttempted=false;
    return new Promise(resolve=>{
        function finish(value){if(finished)return;finished=true;dialog.close();dialog.remove();previous?.focus?.({preventScroll:true});resolve(value);}
        const refresh=()=>{if(finished||saving)return;const work=read();if(saveAttempted&&!work.blocked&&!work.busy){finish('saved');return;}store.disabled=!work.canSave;};
        const changed=()=>refresh();doc.defaultView?.addEventListener('studio-work-status',changed);
        dialog.addEventListener('close',()=>{doc.defaultView?.removeEventListener('studio-work-status',changed);if(!finished)finish('cancel');});
        dialog.addEventListener('cancel',e=>{e.preventDefault();finish('cancel');});
        dialog.addEventListener('keydown',e=>e.stopPropagation());
        cancel.onclick=()=>finish('cancel');skip.onclick=()=>finish('discard');
        store.onclick=async()=>{
            if(saving)return;saving=true;saveAttempted=true;store.disabled=true;status.textContent=en?'Saving… You can still leave without waiting.':'保存中です。待たずに「保存せずに移動」も選べます。';
            try{if(await save()){if(!finished)finish('saved');return;}
                if(!finished)status.textContent=en?'Saving is not confirmed. Confirm the file download, try saving again, or leave without saving.':'保存を確認できません。ファイルのダウンロード確認、保存の再試行、または「保存せずに移動」を選べます。';
            }catch{if(!finished)status.textContent=en?'Saving failed. You can keep editing or leave without saving.':'保存できませんでした。編集を続けるか、保存せずに移動できます。';}
            finally{saving=false;refresh();}
        };
        refresh();dialog.showModal();
    });
}
