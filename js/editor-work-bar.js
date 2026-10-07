import {studioWorkText} from './studio-work-status.js';

// Presentation only: the dashboard owns the common save-state interpretation.
export function editorWorkView(work,en=false) {
    const recovery=work.local&&work.cloudLinked;
    return {
        destination:recovery?(en?'Recovered manuscript · destination unconfirmed':'復元原稿・保存先未確認'):
            work.local?(work.fileName?`DSP · ${work.fileName}`:(en?'This device · DSP file':'この端末・DSPファイル')):
            work.shared?(en?'Shared cloud manuscript':'共有クラウド原稿'):(en?'Cloud manuscript':'クラウド原稿'),
        status:studioWorkText(work,en),
        saveLabel:recovery?(en?'Save a DSP copy':'DSPに退避'):
            work.local?(en?'Save DSP file':'DSPに保存'):(en?'Save to cloud':'クラウドに保存'),
        canSave:work.canSave,
        backup:work.backupCurrent?(en?'A recovery copy of the current edits is retained in this browser.':'現在の編集内容の復元用コピーを、このブラウザーに保持しています。'):
            (en?'A recovery copy of the current edits has not been confirmed.':'現在の編集内容の復元用コピーは、まだ確認できていません。'),
    };
}

export function installEditorWorkBar({host,read,getLocale,onSave,onSaveAs,onDownload,onCloud,onRecovery}) {
    if(!host)return;
    const root=host.closest('#ribbon-bar');root?.classList.add('has-editor-work-bar');
    const destination=document.createElement('strong'),status=document.createElement('span');
    const info=document.createElement('div');info.className='editor-work-info';status.setAttribute('role','status');info.append(destination,status);
    const nameHelp=document.createElement('span'),titleHelp=document.createElement('span');
    nameHelp.id='editor-project-name-help';titleHelp.id='editor-work-title-help';nameHelp.className=titleHelp.className='sr-only';host.append(nameHelp,titleHelp);
    const save=host.querySelector('#btn-save'),details=document.createElement('button');details.type='button';details.className='editor-work-details';
    save.removeAttribute('onclick');save.removeAttribute('data-i18n-title');save.removeAttribute('data-i18n-aria');
    const review=host.querySelector('#editor-resume-copy');
    host.prepend(info);host.append(details);
    let pending=false,error='',identity=null,dialog=null,renderDialog=()=>{};
    function render(){
        const work=read(),en=getLocale()==='en',view=editorWorkView(work,en);
        if(identity!==work.identity){identity=work.identity;error='';dialog?.close();}
        if(['saved-cloud','saved-file'].includes(work.status))error='';
        host.dataset.state=error?'error':work.status;
        destination.textContent=work.open?view.destination:'';destination.title=destination.textContent;
        status.textContent=error||view.status;
        save.textContent=view.saveLabel;save.title=view.saveLabel+' (Ctrl+S / ⌘S)';save.setAttribute('aria-label',view.saveLabel);
        save.disabled=pending||!view.canSave;save.setAttribute('aria-busy',String(pending||work.status==='saving'));
        details.textContent=en?'Save details':'保存の詳細';details.disabled=pending||!work.open;
        if(review){review.hidden=!work.recoveryBlocked;review.textContent=en?'Review recovered copy':'復元原稿を確認';review.disabled=pending||!!work.busy;}
        const project=document.getElementById('project-title'),title=document.getElementById('prop-title');
        nameHelp.textContent=en?'Used to organize your manuscripts.':'原稿を管理するための名前です。';titleHelp.textContent=en?'The title shown to readers, per language.':'読者に表示する言語ごとのタイトルです。';
        if(project){project.title=en?'Project name: used to organize your manuscripts':'プロジェクト名：原稿を管理するための名前';project.setAttribute('aria-describedby',nameHelp.id);}
        if(title)title.setAttribute('aria-describedby',titleHelp.id);
        renderDialog();
    }
    async function run(action){
        if(pending)return;
        const before=read().identity;pending=true;error='';render();
        try{await action();}catch{if(read().identity===before)error=getLocale()==='en'?'Could not save. Your manuscript is kept.':'保存を完了できませんでした。原稿は保持されています。';}
        finally{pending=false;render();}
    }
    save.onclick=()=>{if(read().canSave)void run(onSave);};
    details.onclick=()=>{
        if(dialog)return;
        dialog=document.createElement('dialog');dialog.className='editor-save-details';
        const heading=document.createElement('h2'),target=document.createElement('p'),state=document.createElement('p'),backup=document.createElement('p'),explanation=document.createElement('p'),names=document.createElement('p');
        heading.id='editor-save-details-title';dialog.setAttribute('aria-labelledby',heading.id);state.setAttribute('role','status');
        const actions=document.createElement('div');actions.className='editor-save-detail-actions';
        const saveAs=document.createElement('button'),download=document.createElement('button'),cloud=document.createElement('button'),recovery=document.createElement('button'),close=document.createElement('button');
        for(const button of [saveAs,download,cloud,recovery,close])button.type='button';
        actions.append(saveAs,download,cloud,recovery);dialog.append(heading,target,state,backup,explanation,actions,names,close);
        renderDialog=()=>{
            const work=read(),en=getLocale()==='en',view=editorWorkView(work,en);
            heading.textContent=en?'Save details':'保存の詳細';target.textContent=view.destination;state.textContent=error||view.status;backup.textContent=view.backup;
            explanation.textContent=en?'Recovery copies help after an interruption. They do not confirm saving to the cloud or a DSP file.':'復元用コピーは、作業が中断したときの備えです。クラウドやDSPファイルへの保存完了を意味しません。';
            names.textContent=en?'Project name organizes your manuscripts. Work title is the title shown to readers for each language.':'プロジェクト名は原稿を管理するための名前です。リードタイトルは、読者に表示する言語ごとのタイトルです。';
            saveAs.textContent=work.local?(en?'Save DSP as…':'DSPに名前を付けて保存'):(en?'Export a DSP copy':'DSPファイルを書き出す');
            download.textContent=en?'Download DSP':'DSPをダウンロード';cloud.textContent=work.cloudDestinationPending?(en?'Retry cloud destination saving':'クラウド保存先への保存を再試行'):(en?'Choose a cloud destination':'クラウド保存先を選ぶ');recovery.textContent=en?'View recovery copies':'復元用コピーを確認';close.textContent=en?'Close':'閉じる';
            saveAs.hidden=download.hidden=work.shared;saveAs.disabled=download.disabled=pending||!work.canExport;
            cloud.hidden=work.shared||work.recoveryBlocked||(!work.cloudDestinationPending&&(!work.local||work.cloudLinked));cloud.disabled=pending||!work.canSave||!work.online;
            recovery.hidden=work.shared;recovery.disabled=pending||!!work.busy;close.disabled=pending;
        };
        const act=action=>{dialog.close();void run(action);};
        saveAs.onclick=()=>act(onSaveAs);download.onclick=()=>act(onDownload);cloud.onclick=()=>act(onCloud);recovery.onclick=()=>{dialog.close();onRecovery();};close.onclick=()=>dialog.close();
        dialog.addEventListener('close',()=>{dialog.remove();dialog=null;renderDialog=()=>{};},{once:true});
        document.body.append(dialog);renderDialog();dialog.showModal();heading.tabIndex=-1;heading.focus();
    };
    for(const event of ['studio-work-status','local-draft-status','home-start-refresh','dsp-file-change','safe-resume-change','online','offline'])window.addEventListener(event,render);
    document.addEventListener('studio-ui-language-change',render);render();return {render};
}
