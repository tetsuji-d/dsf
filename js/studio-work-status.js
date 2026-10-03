// Runtime-only view of the open manuscript. No source or persistence schema changes.
export function describeStudioWork({open=false,title='',identity='',local=false,file={},save={},busy='',shared=false,canEdit=true,online=true}={}) {
    let status = 'none';
    if (open) {
        if (busy || save.state === 'saving') status = 'saving';
        else if (save.state === 'error') status = 'error';
        else if (local) status = file.dirty ? 'dirty' : file.fileSaved ? 'saved-file' : 'unconfirmed-file';
        else if (save.cloudCurrent) status = 'saved-cloud';
        else if (!online) status = 'waiting';
        else status = save.state === 'pending' ? 'dirty' : 'unconfirmed';
    }
    const blocked = open && !['saved-file','saved-cloud'].includes(status);
    return {open,title,identity,local,shared,status,busy,blocked,
        canSave:open && !busy && save.state !== 'saving' && canEdit && (local || online),
        canExport:open && !shared && !busy && save.state !== 'saving',
        canClose:open && !shared && !blocked,
        errorCode:save.errorCode || null};
}

export function studioWorkText(work,en=false) {
    const labels = {
        none:['開いている原稿はありません','No manuscript is open'],
        saving:['保存・処理中…','Saving or processing…'],
        dirty:['未保存の変更があります','Unsaved changes'],
        'saved-file':['DSPファイルに保存済み','Saved to DSP file'],
        'saved-cloud':['クラウドに保存済み','Saved to cloud'],
        'unconfirmed-file':['DSPファイルへの保存が未確認です','DSP file saving is unconfirmed'],
        waiting:['同期待ち・オフライン','Waiting to sync · Offline'],
        unconfirmed:['クラウドへの保存を確認してください','Confirm cloud saving'],
        error:['保存に失敗しました','Saving failed'],
    };
    if (['AUTHORING_CONFLICT','AUTHORING_REVISION_CONFLICT','AUTHORING_STALE','AUTHORING_RELOAD_REQUIRED'].includes(work.errorCode))
        return en ? 'Changes need review. Your manuscript is kept.' : '変更の確認が必要です。原稿は保持されています。';
    return labels[work.status]?.[en?1:0] || labels.unconfirmed[en?1:0];
}

export function installStudioWorkStatus({host,read,getLocale,onResume,onSave,onExport,onClose}) {
    if (!host) return;
    const section=document.createElement('section');section.className='studio-current-work';
    const info=document.createElement('div'),caption=document.createElement('small'),title=document.createElement('strong'),status=document.createElement('span');
    status.setAttribute('role','status');info.append(caption,title,status);
    const actions=document.createElement('div');actions.className='studio-current-work-actions';
    const resume=document.createElement('button'),save=document.createElement('button'),exportFile=document.createElement('button'),close=document.createElement('button');
    for(const button of [resume,save,exportFile,close])button.type='button';
    actions.append(resume,save,exportFile,close);section.append(info,actions);host.append(section);
    let pending=false,error='';
    function render(){const work=read(),en=getLocale()==='en';section.hidden=!work.open;section.dataset.state=work.status;
        caption.textContent=en?'Open manuscript':'開いている原稿';title.textContent=work.title||(en?'Untitled manuscript':'無題の原稿');
        status.textContent=error||studioWorkText(work,en);resume.textContent=en?'Continue editing':'編集を続ける';
        save.textContent=work.local?(en?'Save DSP file':'DSPファイルに保存'):(en?'Save to cloud':'クラウドに保存');
        exportFile.textContent=en?'Save a DSP copy':'DSPに退避';close.textContent=en?'Close manuscript':'原稿を閉じる';
        save.hidden=!work.blocked;save.disabled=pending||!work.canSave;resume.disabled=pending;
        exportFile.hidden=work.local||!work.blocked||!work.canExport;exportFile.disabled=pending;
        close.hidden=work.shared;close.disabled=pending||!work.canClose;close.title=work.canClose?(en?'Saved data and backups are kept':'保存済みデータとバックアップは残ります'):(en?'Save the manuscript before closing':'保存を確認してから閉じられます');
    }
    async function run(action){if(pending)return;pending=true;error='';render();try{await action();}catch{error=getLocale()==='en'?'Could not complete the operation. Your manuscript is kept.':'操作を完了できませんでした。原稿は保持されています。';}finally{pending=false;render();}}
    resume.onclick=onResume;save.onclick=()=>run(onSave);exportFile.onclick=()=>run(onExport);close.onclick=()=>run(onClose);
    for(const name of ['studio-work-status','local-draft-status','home-start-refresh','online','offline'])window.addEventListener(name,()=>{error='';render();});
    document.addEventListener('studio-ui-language-change',render);render();return {render};
}
