// Downloads have no portable completion signal. Only the user's explicit
// confirmation acknowledges that a downloaded DSP is safely in their files.
export function chooseDspFilename(defaultName, en=false, extension="dsp") {
 return new Promise(resolve=>{
 const d=document.createElement('dialog');d.className='local-file-dialog';
 const title=document.createElement('h2');title.textContent=en?'Save '+extension.toUpperCase()+' file':extension.toUpperCase()+'ファイルを保存';
 const label=document.createElement('label');label.textContent=en?'File name':'ファイル名';
 const input=document.createElement('input');input.value=defaultName;label.append(input);
 const done=value=>{d.close();d.remove();resolve(value);};
 const cancel=document.createElement('button');cancel.textContent=en?'Cancel':'キャンセル';cancel.onclick=()=>done(null);
 const save=document.createElement('button');save.textContent=en?'Download':'ダウンロード';save.onclick=()=>{let name=input.value.trim()||defaultName;name=name.replace(/[\\/:*?"<>|]/g,'_');done(name.toLowerCase().endsWith('.'+extension)?name:name+'.'+extension);};
 d.addEventListener('cancel',e=>{e.preventDefault();done(null);});d.append(title,label,cancel,save);document.body.append(d);d.showModal();input.focus();input.select();
 });
}
export function confirmDspDownload({filename,onConfirm,en=false}) {
 const d=document.createElement('dialog');d.className='local-file-dialog';
 const h=document.createElement('h2');h.textContent=en?'Check your saved file':'ファイルの保存を確認';
 const p=document.createElement('p');p.textContent=(en?'Download started: ':'ダウンロードを開始しました：')+filename;
 const hint=document.createElement('p');hint.textContent=en?'Confirm only after the DSP file appears in your files. Until then, the unsaved-file warning stays active.':'DSPファイルが端末に保存されたことを確認してください。確認するまで、閉じる際の未保存警告は残ります。';
 const close=()=>{d.close();d.remove();};const later=document.createElement('button');later.textContent=en?'Not yet':'まだ確認していない';later.onclick=close;
 const yes=document.createElement('button');yes.textContent=en?'I have the saved DSP file':'DSPファイルの保存を確認しました';yes.onclick=()=>{if(onConfirm()){close();}else{hint.textContent=en?'The manuscript changed during export. Save the latest version again.':'書き出し中に原稿が変わりました。最新の内容をもう一度保存してください。';yes.disabled=true;}};
 d.append(h,p,hint,later,yes);document.body.append(d);d.showModal();
}

export function showDspSaveError({code,en=false,onSaveAs,onDownload}) {
 const messages={
  DSP_FILE_CHANGED:en?'The file changed outside this editor. Save under a different name to keep both versions.':'元のファイルが別の操作で変更されています。別の名前で保存して両方の内容を残してください。',
  DSP_FILE_SESSION_CHANGED:en?'The active manuscript or account changed during saving. Saving was stopped or could not be confirmed. Check the file before continuing.':'保存中に原稿またはアカウントが変わったため、保存を中止したか、完了を確認できませんでした。ファイルを確認してください。',
  DSP_FILE_VERIFY_FAILED:en?'Could not verify the saved file. Keep this editor open and save another copy.':'保存後のファイル内容を確認できませんでした。この画面を閉じずに、別のファイルへ保存してください。',
  DSP_FILE_PERMISSION:en?'Write permission was not granted. Choose another destination or download a copy.':'書き込みが許可されませんでした。別の保存先を選ぶか、ダウンロードしてください。',
  NotAllowedError:en?'Writing was not permitted. Choose another destination or download a copy.':'書き込みが許可されませんでした。別の保存先を選ぶか、ダウンロードしてください。',
  NoModificationAllowedError:en?'The file is being used. Try again after the other save finishes.':'ファイルが使用中です。別の保存操作が終わってから再試行してください。'
 };
 const d=document.createElement('dialog');d.className='local-file-dialog';
 const h=document.createElement('h2');h.textContent=en?'DSP saving needs attention':'DSPファイルの保存を確認してください';
 const p=document.createElement('p');p.textContent=messages[code]||(en?'Could not save the DSP file. Your manuscript remains in this editor. Choose another destination or download a copy.':'DSPファイルを保存できませんでした。原稿はエディターに残っています。別の保存先を選ぶか、ダウンロードしてください。');
 const add=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{d.close();d.remove();action?.();};return b;};
 d.append(h,p,add(en?'Save as':'名前を付けて保存',onSaveAs),add(en?'Download copy':'ダウンロード保存',onDownload),add(en?'Close':'閉じる'));
 d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
}
