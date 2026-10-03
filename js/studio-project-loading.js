// Transient feedback only; the existing loader owns persistence and error handling.
export function showStudioProjectLoading({getLocale=()=> 'ja'}={}) {
    const en=getLocale()==='en',dialog=document.createElement('dialog');
    dialog.className='authoring-destination-dialog studio-project-loading';
    const title=document.createElement('h2'),status=document.createElement('p'),progress=document.createElement('progress');
    title.textContent=en?'Opening cloud manuscript':'クラウド原稿を開いています';
    title.id='studio-project-loading-title';dialog.setAttribute('aria-labelledby',title.id);
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    progress.setAttribute('aria-label',en?'Loading':'読み込み中');
    const labels={protect:[ '現在の原稿を保護しています…','Protecting the current manuscript…'],load:['クラウドから本文と画像を読み込んでいます…','Loading manuscript and images from the cloud…'],prepare:['編集画面を準備しています…','Preparing the editor…']};
    const update=stage=>{status.textContent=labels[stage][en?1:0];};
    update('protect');dialog.append(title,status,progress);document.body.append(dialog);
    // Escape must not imply that the load was cancelled while it is still running.
    dialog.addEventListener('cancel',event=>event.preventDefault());dialog.showModal();
    return {update,close(){dialog.close();dialog.remove();}};
}
