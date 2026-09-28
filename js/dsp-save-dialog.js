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
