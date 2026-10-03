import {fetchStudioUpdateTarget,prepareStudioUpdate} from './studio-update-core.js';
// Recovery stays outside cached entry routes and never reloads other editing tabs.
const button=document.getElementById('repair'),status=document.getElementById('status');
button.addEventListener('click',async()=>{
 button.disabled=true;status.textContent='配信中のバージョンを確認しています…';
 try{
  const target=await fetchStudioUpdateTarget();
  await prepareStudioUpdate(target,{onProgress:phase=>{
   const label={downloading:'アプリとフォントを取得しています…',activating:'新しいアプリへ切り替えています…',checking:'起動するアプリのバージョンを確認しています…',ready:'更新を確認しました。Studioを開きます。'}[phase];
   status.textContent=target.label+' — '+label;
  }});
  location.replace('/studio?room=home&studioBuild='+encodeURIComponent(target.id));
 }catch(error){
  const mismatch=['VERSION_CHANGED','CONTROLLER_UNCONFIRMED','SHELL_UNCONFIRMED'].includes(error.message);
  status.textContent=mismatch?'配信中の版と起動するアプリの一致を確認できませんでした。旧版は開かず、この画面で止めています。しばらく待って再試行してください。原稿は保持しています。':'更新を完了できませんでした。通信状態を確認して再試行してください。原稿は保持しています。';
  button.disabled=false;
 }
});
