export function openProjectCopyDialog({name,createJob,onCreated,spaces=[],defaultSpaceId=null,getLocale=()=> 'ja'}){
    const en=getLocale()==='en',d=document.createElement('dialog');d.className='project-copy-dialog';
    const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
    const title=node('h2',en?'Copy project':'プロジェクトをコピー');title.id='project-copy-title';d.setAttribute('aria-labelledby',title.id);const description=node('p',en?'Copy the last cloud-saved manuscript and images into a new private draft. Publication and invitations are not copied. Choose My space or a publishing space for the copy.':'クラウドに保存済みの本文と画像を、別の未公開リードとしてコピーします。公開状態・招待権限は引き継ぎません。マイスペースまたは出版スペースを保存先に選んでください。');
    const label=node('label',en?'Copy name':'コピーの名前'),input=node('input');input.value=name+(en?' (copy)':'（コピー）');input.maxLength=200;label.append(input);
    const destinationLabel=node('label',en?'Save to':'保存先'),destination=node('select');destinationLabel.append(destination);destination.setAttribute('aria-label',en?'Save to':'保存先');
    const unassigned=node('option',en?'My space':'マイスペース');unassigned.value='';destination.append(unassigned);
    for(const space of spaces){const option=node('option',space.name);option.value=space.id;destination.append(option);}destination.value=spaces.some(s=>s.id===defaultSpaceId)?defaultSpaceId:'';
    const status=node('p');status.setAttribute('role','status');const actions=node('div'),cancel=node('button',en?'Cancel':'キャンセル'),submit=node('button',en?'Create copy':'コピーを作成');submit.className='home-action-btn primary';
    cancel.type=submit.type='button';actions.append(cancel,submit);d.append(title,description,label,destinationLabel,status,actions);document.body.append(d);d.showModal();input.focus();input.select();
    let job=null,busy=false,started=false;
    const close=()=>{if(busy||started)return;d.close();d.remove();};cancel.onclick=close;d.addEventListener('cancel',e=>{if(busy||started)e.preventDefault();else d.remove();});
    const messages={COPY_LISTING_FAILED:en?'The copy is saved, but its thumbnail could not be updated. Retry to finish the same copy.':'コピーは保存済みですが、一覧画像を更新できませんでした。再試行すると同じコピーの表示を整えます。',COPY_DESTINATION_FAILED:en?'The copy is saved, but its space could not be set. Retry to finish assigning the same copy.':'コピーは保存済みですが、出版スペースを設定できませんでした。再試行すると同じコピーの所属設定を続けます。',SPACE_FORBIDDEN:en?'The selected space is no longer available.':'選択した出版スペースを利用できません。',AUTHORING_CREATE_NOT_ALLOWED:en?'Cloud copying is not enabled for this account.':'このアカウントではクラウドへのコピー作成がまだ有効になっていません。',COPY_NAME_INVALID:en?'Enter a name of 1–200 characters.':'コピー名を1〜200文字で入力してください。',COPY_PRIVATE_IMAGES_UNSUPPORTED:en?'Copying shared private images is not supported yet. No copy was created.':'共有用の非公開画像を含むリードのコピーはまだ未対応です。コピーは作成していません。',COPY_ASSET_UNRESOLVED:en?'An image is not saved in the cloud. Save the source first.':'クラウド未保存の画像があります。元リードを保存してください。',AUTH_CHANGED:en?'Your account changed. Sign in again.':'アカウントが変わりました。ログインし直してください。'};
    submit.onclick=async()=>{if(busy||!input.value.trim())return;busy=true;submit.disabled=cancel.disabled=true;input.disabled=destination.disabled=true;status.textContent=en?'Creating copy…':'コピーを作成中…';
        try{job??=createJob();started=true;const result=await job.run(input.value,destination.value||null);started=false;d.close();d.remove();void Promise.resolve(onCreated(result)).catch(()=>{});}
        catch(e){status.textContent=messages[e.code||e.message]||(en?'Could not confirm saving. Retry to check the same copy; it will not create another.':'保存結果を確認できませんでした。「再試行」で同じコピーを確認します。重複して作成しません。');submit.textContent=en?'Retry':'再試行';started=false;}
        finally{busy=false;submit.disabled=cancel.disabled=false;}
    };
    return d;
}
