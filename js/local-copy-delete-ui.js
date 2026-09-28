export function localCopyDeleteButton(project,en=false){
 const button=document.createElement('button');button.type='button';button.className='home-local-delete';
 const name=project.projectName||project.title||(en?'Untitled project':'無題のプロジェクト');
 button.setAttribute('aria-label',en?'Delete recovery copy: '+name:'「'+name+'」の復元用コピーを削除');button.title=en?'Delete recovery copy':'復元用コピーを削除';
 const icon=document.createElement('span');icon.className='material-icons';icon.setAttribute('aria-hidden','true');icon.textContent='delete_outline';button.append(icon);return button;
}
export function confirmLocalCopyDeletion({name,active=false,en=false}){
 const d=document.createElement('dialog');d.className='authoring-destination-dialog';d.setAttribute('aria-label',en?'Delete recovery copy':'復元用コピーを削除');
 const h=document.createElement('h2');h.textContent=en?'Delete recovery copy?':'復元用コピーを削除しますか？';
 const title=document.createElement('p');title.textContent=name;
 const note=document.createElement('p');note.textContent=en?'Only this browser recovery copy is removed. Cloud manuscripts and DSP files on your device are unchanged.':'このブラウザーの復元用コピーだけを削除します。クラウド原稿や端末に保存したDSPファイルには影響しません。';
 const detail=document.createElement('p');detail.textContent=(active?(en?'This manuscript will close. ':'編集中のこの原稿も閉じます。 '):'')+(en?'You can undo immediately on this screen. Editing in another tab may create a new recovery copy.':'この画面では削除直後に元に戻せます。他のタブで編集を続けると、復元用コピーが再作成されることがあります。');
 const actions=document.createElement('div');actions.className='authoring-destination-actions';
 const cancel=document.createElement('button');cancel.textContent=en?'Cancel':'キャンセル';
 const remove=document.createElement('button');remove.textContent=en?'Delete copy':'コピーを削除';remove.className='local-copy-delete-confirm';
 actions.append(cancel,remove);d.append(h,title,note,detail,actions);document.body.append(d);d.showModal();cancel.focus();
 return new Promise(resolve=>{const finish=value=>{d.close();d.remove();resolve(value);};cancel.onclick=()=>finish(false);remove.onclick=()=>finish(true);d.addEventListener('cancel',e=>{e.preventDefault();finish(false);});});
}
export function showLocalCopyUndo({host,name,restore,en=false}){
 const row=document.createElement('div');row.className='home-local-delete-notice';row.setAttribute('role','status');
 const text=document.createElement('span');text.textContent=en?'Deleted: '+name:'削除しました：'+name;
 const undo=document.createElement('button');undo.type='button';undo.textContent=en?'Undo':'元に戻す';
 undo.onclick=async()=>{undo.disabled=true;try{await restore();row.remove();}catch(error){undo.disabled=false;text.textContent=error.message==='LOCAL_COPY_LIMIT'?(en?'The list is full. Delete another copy and try again.':'一覧がいっぱいです。別のコピーを削除してから、もう一度お試しください。'):(en?'Could not restore. A newer copy may exist.':'復元できませんでした。新しいコピーが既にある場合は上書きしません。');}};
 row.append(text,undo);host.append(row);return row;
}
