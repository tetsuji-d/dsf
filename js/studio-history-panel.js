import {listHistoryEntries,readHistoryEntry,subscribeHistory,getHistoryGuard} from './history.js';
import './studio-history-panel.css';
export function initHistoryPanel({getUILang,undo,redo,canStep=()=>true}) {
    const panel=document.createElement('aside');panel.id='edit-history-panel';panel.hidden=true;panel.setAttribute('aria-label','編集履歴');document.body.append(panel);
    let selected=null,lastTrigger=null,message='';
    const en=()=>getUILang()==='en';
    const words=(ja,eng)=>en()?eng:ja;
    const label=entry=> {
        const labels={edit:['編集','Edit'],add:['追加','Add'],delete:['削除','Delete'],move:['並べ替え','Reorder'],assets:['アセット登録・変更','Asset change'],other:['編集操作','Editor operation']};
        return (labels[entry.kind]||labels.other)[en()?1:0];
    };
    const targetLabel=target=>{const types={flow:['Flow原稿','Flow manuscript'],text:['本文ページ','Text page'],image:['画像ページ','Image page'],structure:['章・構成','Structure']};return `${target.position}. ${(types[target.type]||types.structure)[en()?1:0]}${target.title?' · '+target.title:''}`;};
    const el=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent?.append(node);return node;};
    function render() {
        if(panel.hidden)return;
        const data=listHistoryEntries(),guard=getHistoryGuard();panel.replaceChildren();
        const head=el('header',undefined,panel);el('h2',words('編集履歴','Edit history'),head);
        const close=el('button',words('閉じる','Close'),head);close.onclick=()=>{panel.hidden=true;lastTrigger?.focus();};
        el('p',words('このリードを開いてから最大50操作。再読み込み・リード切替で消えます。','Up to 50 operations since opening this Read. Cleared on reload or project change.'),panel);
        const controls=el('div',undefined,panel);controls.className='history-controls';
        for(const [direction,id,run] of [['undo',data.nextUndoId,undo],['redo',data.nextRedoId,redo]]) {
            const entry=data.entries.find(e=>e.id===id);
            const button=el('button',(direction==='undo'?words('元に戻す','Undo'):words('やり直す','Redo'))+(entry?` · ${label(entry)}`:''),controls);
            button.disabled=!id;button.onclick=()=>{message='';if(!canStep()){message=words('入力・組版の完了後にもう一度押してください。','Wait for editing and layout to finish, then try again.');render();return;}if(guard!==getHistoryGuard()){message=words('履歴が変わりました。対象を確認してもう一度押してください。','History changed. Review the target and try again.');render();return;}run();render();};
        }
        if(message){const status=el('p',message,panel);status.setAttribute('role','status');}
        const list=el('div',undefined,panel);list.className='history-list';
        if(!data.entries.length)el('p',words('編集履歴はまだありません。','No edits yet.'),list);
        for(const entry of [...data.entries].reverse()) {
            const button=el('button',`${entry.status==='undone'?words('取消済み','Undone'):words('適用済み','Applied')} · ${new Date(entry.timestamp).toLocaleTimeString(en()?'en':'ja')} · ${entry.actor==='ai'?'AI':words('手動','Manual')} · ${label(entry)}`,list);
            button.setAttribute('aria-pressed',String(selected===entry.id));button.dataset.historyEntry=entry.id;button.onclick=()=>{selected=entry.id;render();panel.querySelector(`[data-history-entry="${entry.id}"]`)?.focus();};
        }
        if(!selected)return;
        const detail=readHistoryEntry(selected,{includeImages:true});if(!detail){selected=null;return;}
        const box=el('section',undefined,panel);box.className='history-detail';el('h3',words('変更内容','Changes'),box);
        el('p',words(`追加 ${detail.addedCount} · 削除 ${detail.removedCount} · 編集 ${detail.editedCount}`,`Added ${detail.addedCount} · Removed ${detail.removedCount} · Edited ${detail.editedCount}`),box);
        if(detail.targetIds.length)el('p',words('対象: ','Targets: ')+detail.targets.map(targetLabel).join(' / '),box);
        if(detail.orderChanged||detail.addedCount||detail.removedCount){el('p',words('変更前の順序','Order before'),box);el('pre',detail.orderLabelsBefore.map(targetLabel).join(' → '),box);el('p',words('変更後の順序','Order after'),box);el('pre',detail.orderLabelsAfter.map(targetLabel).join(' → '),box);}
        for(const change of detail.changes){el('p',words('本文・見出し','Text / heading')+' · '+change.field.split('/').at(-1).toUpperCase(),box);el('strong',words('変更前','Before'),box);el('pre',change.before||'—',box);el('strong',words('変更後','After'),box);el('pre',change.after||'—',box);if(change.truncated)el('small',words('変更位置付近の抜粋','Excerpt near the change'),box);}
        for(const image of detail.images||[]){const row=el('div',undefined,box);row.className='history-images';for(const side of ['before','after']){const figure=el('figure',undefined,row);el('figcaption',side==='before'?words('変更前','Before'):words('変更後','After'),figure);if(image[side]){const img=el('img',undefined,figure);img.src=image[side];img.alt=image.targetId;}}}
        if(!detail.changes.length&&!detail.images?.length&&!detail.orderChanged&&!detail.removedCount&&!detail.addedCount)el('p',words('本文以外の設定変更を含む操作です。','This operation includes non-text changes.'),box);
        if(detail.changesTruncated||detail.targetsTruncated||detail.orderTruncated)el('p',words('変更が多いため一部を省略しています。','Some changes are omitted due to size.'),box);
    }
    document.querySelectorAll('[data-edit-history]').forEach(button=>button.addEventListener('click',()=>{lastTrigger=button;panel.hidden=!panel.hidden;render();if(!panel.hidden)panel.querySelector('button')?.focus();}));
    function syncLabels(){document.querySelectorAll('[data-edit-history]').forEach(button=>{button.title=words('編集履歴','Edit history');button.setAttribute('aria-label',button.title);});panel.setAttribute('aria-label',words('編集履歴','Edit history'));render();}
    document.addEventListener('studio-ui-language-change',syncLabels);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){panel.hidden=true;lastTrigger?.focus();}});
    subscribeHistory(render);syncLabels();return {render};
}
