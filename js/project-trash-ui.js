import {projectTrashError} from './project-trash-client.js';
export function renderProjectTrash({root, projects, en=false, onRestore, onPublication, onRetry, spaceLabel=()=>null}) {
    if (!root) return; root.replaceChildren();
    const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
    root.append(el('h3',en?'Trash':'ゴミ箱'),el('p',en?
        'Manuscripts can be restored for 30 days. Published releases remain available; manage publication separately. Browser recovery copies are separate.':
        '原稿は30日間復元できます。Horizonの公開は継続します。公開停止は別に操作してください。ブラウザーの復元用コピーは別管理です。'));
    if (!Array.isArray(projects)) {
        root.append(el('p',en?'Connect and sign in to load Trash.':'接続・ログイン状態を確認してゴミ箱を読み込んでください。'));
        const retry=el('button',en?'Reload':'再読み込み');retry.type='button';retry.className='home-action-btn';retry.onclick=onRetry;root.append(retry);return;
    }
    const items=projects.filter(p=>p.projectTrash).sort((a,b)=>b.projectTrash.trashedAtMs-a.projectTrash.trashedAtMs);
    if (!items.length) root.append(el('p',en?'Trash is empty.':'ゴミ箱は空です。'));
    for (const p of items) {
        const card=el('article','');card.className='project-trash-card';
        card.append(el('h4',p.projectName||p.title||p.id));
        const space=spaceLabel(p.id);if(space)card.append(el('p',(en?'Space: ':'所属：')+space));
        const until=new Date(p.projectTrash.restoreUntilMs);
        card.append(el('p',(en?'Restore until: ':'復元期限：')+until.toLocaleString(en?'en-US':'ja-JP')));
        if(Date.now()>=until.getTime())card.append(el('p',en?'The displayed recovery deadline has passed. The server checks eligibility when you restore.':'表示上の復元期限を過ぎています。復元可否はサーバーで確認します。'));
        const published=['public','unlisted'].includes(p.dsfStatus);
        card.append(el('p',published?(en?'Published release remains available.':'公開は継続中です。'):(en?'Not currently public.':'現在は公開されていません。')));
        const status=el('p','');status.setAttribute('role','status');
        const restore=el('button',en?'Restore manuscript':'原稿を復元');restore.type='button';restore.className='home-action-btn';
        restore.onclick=async()=>{restore.disabled=true;status.textContent=en?'Restoring…':'復元しています…';try{await onRestore(p.id);status.textContent=en?'Restored.':'復元しました。';}catch(e){status.textContent=projectTrashError(e,en);restore.disabled=false;}};
        card.append(restore);
        if(published){const manage=el('button',en?'Manage publication':'公開状態を管理');manage.type='button';manage.className='home-action-btn';manage.onclick=onPublication;card.append(manage);}
        card.append(status);root.append(card);
    }
}
export function confirmProjectTrash(name,en=false) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='project-copy-dialog';
        const heading=document.createElement('h2');heading.id='project-trash-confirm-heading';heading.textContent=en?'Move manuscript to Trash?':'原稿をゴミ箱へ移しますか？';
        dialog.setAttribute('aria-labelledby',heading.id);
        const title=document.createElement('p');title.textContent=name;
        const note=document.createElement('p');note.textContent=en?'You can restore it for 30 days. Horizon publication and browser recovery copies remain unchanged.':'30日間復元できます。Horizonの公開とブラウザーの復元用コピーはそのまま残ります。';
        const cancel=document.createElement('button');cancel.type='button';cancel.textContent=en?'Cancel':'キャンセル';
        const move=document.createElement('button');move.type='button';move.textContent=en?'Move to Trash':'ゴミ箱へ移す';move.className='primary';
        const finish=value=>{dialog.close();dialog.remove();resolve(value);};
        cancel.onclick=()=>finish(false);move.onclick=()=>finish(true);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
        dialog.append(heading,title,note,cancel,move);document.body.append(dialog);dialog.showModal();cancel.focus();
    });
}
