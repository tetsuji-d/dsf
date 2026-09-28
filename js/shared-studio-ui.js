import {readSharedStudioAccess,canEditSharedStudio,subscribeSharedStudioAccess} from './shared-studio-access.js';
export function installSharedStudioUI({getUILang,checkAccess,lockAction,openRecovery=()=>{},doc=document}) {
    const style=doc.createElement('style');style.textContent='[data-shared-disabled]{opacity:.4!important;cursor:not-allowed!important}';doc.head.append(style);
    const note=doc.createElement('div');note.id='shared-studio-status';note.setAttribute('role','status');
    note.style.cssText='padding:10px 16px;background:#eaf2ff;color:#163a67;display:none;align-items:center;gap:12px;flex-wrap:wrap';
    const message=doc.createElement('span'),actions=doc.createElement('span'),errorNote=doc.createElement('span');
    errorNote.setAttribute('role','alert');note.append(message,actions,errorNote);
    let pendingAction=false,controlsKey='';
    async function act(action){if(pendingAction)return;pendingAction=true;sync();errorNote.textContent='';
        try{if(action==='recovery')await openRecovery();else if(action==='refresh')await checkAccess();else await lockAction(action);}
        catch(error){errorNote.textContent=getUILang()==='en'?'Could not change editing access. Check the connection and current editor.':'編集権を変更できませんでした。接続と現在の編集者を確認してください。';}
        finally{pendingAction=false;sync();}}
    doc.querySelector('#editor-room')?.prepend(note);
    const blocked='#flow-authoring-surface,#content-render,#bubble-layer,#canvas-page-heading-props,#image-zoom-controls-floating,#panel-right,#asset-grid,#project-settings-modal .ps-dialog';
    const safe='#btn-editor-preview,#canvas-zoom-select,#lang-tabs-top *,[onclick*="setCanvasZoom"],[onclick*="fitCanvas"],#btn-page-prev,#btn-page-next,#page-nav-slider';
    let syncing=false;
    function sync(){
        if(syncing)return;syncing=true;
        try{
            const access=readSharedStudioAccess(),readonly=!!access&&!canEditSharedStudio(),en=getUILang()==='en';
            const text=!access?'':access.status==='loading'?(en?'Opening shared manuscript…':'共有原稿を開いています…'):access.status==='disconnected'?(en?'Connection unavailable. Unsaved changes remain in this tab.':'接続を確認できません。未保存の変更はこのタブで保持しています。'):access.status!=='ready'?(access.spaceId==='personal'?(en?'Access unavailable. Reopen from shared projects.':'閲覧権限を確認できません。共有された作品の一覧から開き直してください。'):(en?'Access unavailable. Reopen the work from your space.':'閲覧権限を確認できません。出版スペースから開き直してください。')):
                access.canEdit?(en?'Shared manuscript · Editing · Saved to its publishing space':'共有原稿・編集可 ／ 出版スペースの原稿へ保存'):(access.lock?.holderName?(en?'Editing: '+access.lock.holderName+' · Read only':access.lock.holderName+' さんが編集中 ／ 閲覧のみ'):(en?'Shared manuscript · Read only · Latest saved changes refresh automatically':'共有原稿・閲覧のみ ／ 最新の保存内容を自動反映'));
            note.style.display=access?'flex':'none';if(message.textContent!==text)message.textContent=text;
            const buttons=[];
            if(access&&access.spaceId!=='personal')buttons.push(['recovery',en?'Recovery drafts':'復旧用下書き']);
            if(access?.status==='disconnected')buttons.push(['refresh',en?'Reconnect':'接続を再確認']);
            if(access?.status==='ready'&&access.permissionCanEdit){
                if(access.needsReload)buttons.push(['acquire',en?'Open latest and start editing':'最新原稿を開いて編集']);
                else if(access.lock?.isMine){
                    if(access.lock.requestId)buttons.push(['grant',en?'Save and hand over to '+access.lock.requesterName:access.lock.requesterName+' さんへ保存して交代']);
                    buttons.push(['release',en?'Save and finish editing':'保存して編集を終了']);
                }else if(access.lock?.canTakeover)buttons.push(['acquire',en?'Start editing':'編集を開始']);
                else if(access.lock?.requestPending)buttons.push(['cancel',en?'Cancel handover request':'交代依頼を取り消す']);
                else buttons.push(['request',en?'Request editing':'編集の交代を依頼']);
            }
            const key=JSON.stringify([buttons,pendingAction]);
            if(key!==controlsKey){controlsKey=key;actions.replaceChildren(...buttons.map(([action,label])=>{const b=doc.createElement('button');b.type='button';b.textContent=label;b.dataset.sharedLockAction=action;b.disabled=pendingAction;b.style.cssText='margin-inline:4px;padding:6px 10px';b.onclick=()=>void act(action);return b;}));}
            doc.body.dataset.sharedStudio=access?(readonly?'readonly':'editing'):'';
            for(const el of doc.querySelectorAll(blocked)) {if(readonly&&!el.inert){el.inert=true;el.dataset.sharedInert='1';}else if(!readonly&&el.dataset.sharedInert){el.inert=false;delete el.dataset.sharedInert;}}
            for(const el of doc.querySelectorAll('#ribbon-bar button,#ribbon-bar input,#ribbon-bar select,#project-title')){
                const deny=(readonly&&!el.matches(safe)) || !!access&&el.matches('#btn-share,#btn-restore-private-authoring,[onclick*="exportDSP"],[onclick*="exportDSF"],[onclick*="shareProject"]');
                if(deny&&el.getAttribute('aria-disabled')!=='true'){el.setAttribute('aria-disabled','true');el.dataset.sharedDisabled='1';}
                if(!deny&&el.dataset.sharedDisabled){el.removeAttribute('aria-disabled');delete el.dataset.sharedDisabled;}
            }
        }finally{syncing=false;}
    }
    // Capture precedes inline handlers, keyboard shortcuts, paste/drop and drag.
    const guard=e=>{
        if(!readSharedStudioAccess())return;
        if(e.target instanceof Element && e.target.closest('#shared-studio-status'))return;
        if(e.target instanceof Element && e.target.closest('[data-shared-disabled]')){e.preventDefault();e.stopImmediatePropagation();return;}
        if(canEditSharedStudio())return;
        const el=e.target instanceof Element?e.target:null;
        if(e.type==='keydown'&&['Enter',' '].includes(e.key)&&el?.closest(safe))return;
        const mutation=['beforeinput','paste','cut','drop','dragstart'].includes(e.type);
        const key=e.type==='keydown'&& !(['Tab','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key)||(e.ctrlKey||e.metaKey)&&['c','a','+','-','0'].includes(e.key.toLowerCase()));
        const control=el?.closest('[data-shared-disabled],#canvas-view,#asset-grid,#panel-right,#project-settings-modal input,#project-settings-modal select,#project-settings-modal textarea');
        if((mutation||key||control)&&el?.closest('#editor-room,#project-settings-modal')){e.preventDefault();e.stopImmediatePropagation();}
    };
    for(const type of ['click','dblclick','pointerdown','mousedown','touchstart','beforeinput','keydown','paste','cut','drop','dragstart','change'])doc.addEventListener(type,guard,{capture:true,passive:false});
    const observer=new MutationObserver(sync);observer.observe(doc.querySelector('#editor-room'),{childList:true,subtree:true});
    subscribeSharedStudioAccess(sync);doc.addEventListener('studio-ui-language-change',sync);
    doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')void checkAccess().catch(()=>{});});
    sync();return {sync};
}
