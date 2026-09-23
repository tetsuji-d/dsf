const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function projectActionsMarkup(project,en=false){return `<details class="project-actions"><summary aria-label="${esc((project.projectName||project.title||project.id)+(en?' actions':' の操作'))}">⋮</summary><div class="project-actions-list"><button type="button" data-project-action="edit">${en?'Continue editing':'続きから編集'}</button><button type="button" data-project-action="copy">${en?'Copy project':'プロジェクトをコピー'}</button><button type="button" data-project-action="move">${en?'Change publishing space':'所属する出版スペースを変更'}</button><button type="button" class="danger" data-project-action="delete">${en?'Delete':'削除'}</button></div></details>`;}
let outsideListenerInstalled=false;
export function bindProjectActions(container,onAction){
    if(!outsideListenerInstalled){outsideListenerInstalled=true;document.addEventListener('pointerdown',event=>{if(!event.target.closest('.project-actions'))for(const d of document.querySelectorAll('.project-actions[open]'))d.open=false;});}

    for(const details of container.querySelectorAll('.project-actions')){
        details.addEventListener('toggle',()=>{if(details.open)for(const other of container.querySelectorAll('.project-actions[open]'))if(other!==details)other.open=false;});
        details.addEventListener('keydown',event=>{if(event.key==='Escape'){details.open=false;details.querySelector('summary').focus();}});
        details.querySelectorAll('[data-project-action]').forEach(b=>b.onclick=()=>{details.open=false;onAction(b.dataset.projectAction,details.closest('[data-project-entry]')?.dataset.projectEntry);});
    }
}
export function openProjectSpaceDialog({name,spaces,currentSpaceId,onSave,en=false}){
    const d=document.createElement('dialog');d.className='project-copy-dialog';
    d.innerHTML=`<h2>${en?'Change publishing space':'所属する出版スペースを変更'}</h2><p>${esc(name)}</p><label>${en?'Publishing space':'出版スペース'}<select><option value="">${en?'Not assigned':'所属未設定'}</option>${spaces.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><p role="status"></p><div><button type="button" data-cancel>${en?'Cancel':'キャンセル'}</button><button type="button" class="primary" data-save>${en?'Save change':'変更を保存'}</button></div>`;
    const select=d.querySelector('select');select.setAttribute('aria-label',en?'Publishing space':'出版スペース');select.value=currentSpaceId||'';let busy=false;
    d.querySelector('[data-cancel]').onclick=()=>{if(!busy){d.close();d.remove();}};d.addEventListener('cancel',e=>{if(busy)e.preventDefault();else d.remove();});
    d.querySelector('[data-save]').onclick=async()=>{if(busy)return;busy=true;d.querySelectorAll('button,select').forEach(b=>b.disabled=true);try{await onSave(select.value||null);d.close();d.remove();}catch{d.querySelector('[role=status]').textContent=en?'Could not save. Retry after checking the latest space settings.':'所属を変更できませんでした。最新の設定を確認して再試行してください。';}finally{busy=false;d.querySelectorAll('button,select').forEach(b=>b.disabled=false);}};
    document.body.append(d);d.showModal();select.focus();return d;
}
