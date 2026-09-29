const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function projectActionsMarkup(project,en=false,personal=false){return `<details class="project-actions"><summary aria-label="${esc((project.projectName||project.title||project.id)+(en?' actions':' の操作'))}">⋮</summary><div class="project-actions-list"><button type="button" data-project-action="edit">${en?'Continue editing':'続きから編集'}</button>${personal?`<button type="button" data-project-action="share">${en?'Share project':'共有'}</button>`:''}<button type="button" data-project-action="copy">${en?'Copy project':'プロジェクトをコピー'}</button><button type="button" data-project-action="preview">${en?'Refresh thumbnail':'サムネイルを更新'}</button><button type="button" data-project-action="move">${en?'Change save location':'保存先のスペースを変更'}</button><button type="button" class="danger" data-project-action="delete">${en?'Move to Trash':'ゴミ箱へ移す'}</button></div></details>`;}
let outsideListenerInstalled=false;
function closeProjectMenus(){for(const d of document.querySelectorAll('.project-actions[open]'))d.open=false;}
function positionProjectMenu(details){
    const menu=details.querySelector('.project-actions-list'),anchor=details.querySelector('summary').getBoundingClientRect();
    const surface=details.closest('.home-room-body')?.getBoundingClientRect();
    const left=Math.max(8,surface?.left+8||8),right=Math.min(innerWidth-8,surface?.right-8||innerWidth-8);
    menu.style.width=Math.min(280,right-left)+'px';
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(left,Math.min(anchor.right-rect.width,right-rect.width))+'px';
    menu.style.top=Math.max(8,Math.min(anchor.bottom+6,innerHeight-rect.height-8))+'px';
}
export function bindProjectActions(container,onAction){
    if(!outsideListenerInstalled){outsideListenerInstalled=true;
        document.addEventListener('pointerdown',event=>{if(!event.target.closest('.project-actions'))closeProjectMenus();});
        document.addEventListener('scroll',event=>{if(!event.target.closest?.('.project-actions-list'))closeProjectMenus();},true);
        window.addEventListener('resize',closeProjectMenus);
    }
    for(const details of container.querySelectorAll('.project-actions')){
        const menu=details.querySelector('.project-actions-list');menu.setAttribute('popover','manual');
        details.addEventListener('toggle',()=>{
            if(details.open){
                for(const other of container.querySelectorAll('.project-actions[open]'))if(other!==details)other.open=false;
                menu.showPopover?.();positionProjectMenu(details);
            }else if(menu.matches(':popover-open'))menu.hidePopover();
        });
        details.addEventListener('keydown',event=>{if(event.key==='Escape'){details.open=false;details.querySelector('summary').focus();}});
        menu.querySelectorAll('[data-project-action]').forEach(b=>b.onclick=()=>{details.open=false;onAction(b.dataset.projectAction,details.closest('[data-project-entry]')?.dataset.projectEntry);});
    }
}
export function openProjectSpaceDialog({name,spaces,currentSpaceId,onSave,en=false}){
    const d=document.createElement('dialog');d.className='project-copy-dialog';
    d.innerHTML=`<h2>${en?'Change save location':'保存先のスペースを変更'}</h2><p>${esc(name)}</p><label>${en?'Save location':'保存先'}<select><option value="">${en?'My space':'マイスペース'}</option>${spaces.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><p>${en?'Changing the save location does not unpublish an existing release or grant access to other people. Manage publication and sharing separately.':'保存先の変更では、公開済み作品の公開停止や、他の人への共有は行いません。公開状態と共有権限は別に管理します。'}</p><p role="status"></p><div><button type="button" data-cancel>${en?'Cancel':'キャンセル'}</button><button type="button" class="primary" data-save>${en?'Save change':'変更を保存'}</button></div>`;
    const select=d.querySelector('select');select.setAttribute('aria-label',en?'Save location':'保存先');select.value=currentSpaceId||'';let busy=false;
    d.querySelector('[data-cancel]').onclick=()=>{if(!busy){d.close();d.remove();}};d.addEventListener('cancel',e=>{if(busy)e.preventDefault();else d.remove();});
    d.querySelector('[data-save]').onclick=async()=>{if(busy)return;busy=true;d.querySelectorAll('button,select').forEach(b=>b.disabled=true);try{await onSave(select.value||null);d.close();d.remove();}catch{d.querySelector('[role=status]').textContent=en?'Could not save. Retry after checking the latest space settings.':'所属を変更できませんでした。最新の設定を確認して再試行してください。';}finally{busy=false;d.querySelectorAll('button,select').forEach(b=>b.disabled=false);}};
    document.body.append(d);d.showModal();select.focus();return d;
}
