import {unknownSaveStatus} from './editor-save-status.js';
import {describeStudioWork,studioWorkText} from './studio-work-status.js';

/** Render current-session evidence, never a previous DOM success message. */
export function syncAuthSaveStatus(element, {uid = '', en = false, local = false, save = unknownSaveStatus(), online = true} = {}) {
    if (!element) return;
    uid = String(uid || '');
    element.dataset.authLocal = String(local);
    element.dataset.authUid = uid;
    let status='idle',target='',notice=false,text;
    // A browser backup cannot confirm a cloud write or a DSP export.
    if(save.state==='saving')status='saving';
    else if(save.state==='error')status='error';
    else if(!local&&uid&&save.cloudCurrent){status='saved';target='Cloud';}
    else if(local&&save.state==='saved-local'&&save.localCurrent){status='saved';target='Local';}
    if(status==='saving')text=studioWorkText({status:'saving'},en);
    else if(status==='error')text=studioWorkText({status:'error',errorCode:save.errorCode},en);
    else if(target==='Cloud')text=studioWorkText({status:'saved-cloud'},en);
    else if(target==='Local')text=en?'Recovery copy retained in this browser':'ブラウザの復元用コピーを保持';
    else if(local){notice=true;text=en?'Creating on this device · Save as DSP':'この端末で制作中・DSPファイルで保存';}
    else if(!uid){notice=true;text=en?'Sign in to save to cloud':'ログインでクラウド保存';}
    else text=studioWorkText(describeStudioWork({open:true,save,online}),en);
    if(notice)element.dataset.authNotice='true';else delete element.dataset.authNotice;
    element.dataset.saveStatus=status;element.dataset.saveTarget=target;
    const icons={idle:'',saving:'●',saved:'✓',error:'!'};
    element.textContent=[icons[status],text].filter(Boolean).join(' ');
    element.style.color={idle:'#8a5d00',saving:'#f0ad4e',saved:'#34c759',error:'#ff3b30'}[status];
}
