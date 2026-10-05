import {createStudioVersionCheck,fetchStudioVersion} from './studio-version-check.js';
import {studioWorkText} from './studio-work-status.js';
import {prepareStudioUpdate} from './studio-update-core.js';
export {prepareStudioUpdate,waitForStudioWorker} from './studio-update-core.js';
export function installStudioVersionUI({current,getLocale,homeHost,helpHost,blocked=()=>false,work,fetchVersion=fetchStudioVersion,applyUpdate=prepareStudioUpdate,reload=()=>location.reload(),enabled=true}) {
 const en=()=>getLocale()==='en',views=[];let dialog=null,applying=false;
 const text=(ja,english)=>en()?english:ja;
 function mount(host,tools=false){if(!host)return;const row=document.createElement('div');row.className='studio-version';
  const label=document.createElement('span');label.className='studio-version-number';label.textContent=current.label;
  const update=document.createElement('button');update.type='button';update.className='studio-version-update';update.hidden=true;update.onclick=()=>openUpdate();row.append(label,update);
  let check,status,repair;
  if(tools){check=document.createElement('button');check.type='button';check.onclick=()=>void checker.check({force:true});repair=document.createElement('a');repair.href='/studio-repair.html';repair.target='_blank';repair.rel='noopener';status=document.createElement('span');status.className='studio-version-status';status.setAttribute('role','status');row.append(check,repair,status);}
  host.append(row);views.push({label,update,check,status,repair,tools});
 }
 function render(){const value=checker.read();const status=!enabled?text('開発環境','Development environment'):({unknown:text('更新未確認','Not checked'),checking:text('更新を確認中…','Checking for updates…'),offline:text('オフラインのため確認できません','Offline; could not check'),failed:text('更新を確認できませんでした','Could not check for updates'),checked:value.available?text('新しいバージョンを自動で準備します','The new version will be prepared automatically'):text('更新はありません','No update available')})[value.phase];
  for(const v of views){v.label.title=text('使用中のバージョン：','Current version: ')+current.label+' · '+status;v.update.textContent=text('更新','Update');v.update.hidden=!v.tools||!value.available;v.update.disabled=applying||!navigator.onLine;
   if(v.check){v.check.textContent=text('更新を確認','Check for updates');v.check.disabled=!enabled||value.phase==='checking';v.repair.textContent=text('アプリの更新・復旧','App update / recovery');v.status.textContent=status;}}
 }
 const checker=createStudioVersionCheck({current,fetchVersion,onChange:render});
 function openUpdate(){if(dialog||!checker.read().available)return;
  dialog=document.createElement('dialog');dialog.className='authoring-destination-dialog';dialog.setAttribute('aria-label',text('アプリを更新','Update app'));
  const heading=document.createElement('h2');heading.textContent=text('アプリを更新しますか？','Update the app?');
  const message=document.createElement('p');const feedback=document.createElement('p');feedback.setAttribute('role','status');
  const manuscript=document.createElement('p');manuscript.className='studio-update-work';manuscript.setAttribute('role','status');
  const save=document.createElement('button'),edit=document.createElement('button'),exportFile=document.createElement('button');
  for(const button of [save,edit,exportFile])button.type='button';
  const actions=document.createElement('div');actions.className='authoring-destination-actions';const later=document.createElement('button');later.textContent=text('後で','Later');const yes=document.createElement('button');yes.textContent=text('更新して再読み込み','Update and reload');
  const events=['local-draft-status','studio-work-status','online','offline'];
  const sync=()=>{const unsafe=blocked(),value=work?.read();message.textContent=unsafe?text('開いている原稿の保存を確認してから更新します。保存中は完了をお待ちください。','Confirm saving the open manuscript before updating. Wait for any current save to finish.'):text('アプリを更新して、この画面を再読み込みします。端末内の原稿・履歴は削除しません。ほかのタブは再読み込みしません。','Update the app and reload this tab. Local manuscripts and history are kept. Other tabs will not reload.');yes.disabled=applying||!!unsafe||!navigator.onLine;
   if(!unsafe&&value?.status==='restored')message.textContent=text('復元後の編集はありません。端末内の原稿と画像を確認できれば、追加保存なしで更新し、同じ原稿を復元できます。','No edits since recovery. If the local manuscript and images can be verified, we can update and restore the same manuscript without another save.');
   manuscript.hidden=!value?.open;manuscript.textContent=value?.open?(value.title||text('無題の原稿','Untitled manuscript'))+' — '+(!unsafe&&value.status==='restored'?text('復元後の編集なし','No edits since recovery'):studioWorkText(value,en())):'';
   save.hidden=!value?.open||!unsafe;save.disabled=applying||!value?.canSave||!navigator.onLine;
   save.textContent=value?.local?text('DSPに保存して更新','Save DSP and update'):text('クラウドに保存して更新','Save to cloud and update');
   edit.hidden=!value?.open;edit.textContent=text('編集に戻る','Return to editor');edit.disabled=applying;
   exportFile.hidden=!value?.canExport||!unsafe||value?.local;exportFile.textContent=text('DSPに退避','Save a DSP copy');exportFile.disabled=applying;
  };
  const close=()=>{if(applying)return;dialog.close();dialog.remove();dialog=null;for(const name of events)window.removeEventListener(name,sync);};later.onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  edit.onclick=()=>{close();work.onResume();};
  exportFile.onclick=async()=>{if(applying)return;applying=true;later.disabled=true;sync();try{await work.onExport();feedback.textContent=text('DSPの保存結果を確認してください。クラウドへの保存状態は変わりません。','Check the DSP save result. Cloud save status is unchanged.');}catch{feedback.textContent=text('DSPを保存できませんでした。原稿は保持しています。','Could not save DSP. Your manuscript is kept.');}finally{applying=false;later.disabled=false;sync();}};
  const update=async(saveFirst=false)=>{if(applying||(!saveFirst&&blocked())){sync();return;}const identity=work?.read().identity;
   if(saveFirst&&!work?.read().canSave)return;
   applying=true;later.disabled=true;sync();render();feedback.textContent=saveFirst?text('原稿を保存しています…','Saving manuscript…'):text('更新を準備しています…','Preparing the update…');
   try{
    if(saveFirst){await work.onSave();if(blocked()||work.read().identity!==identity)throw Error('SAVE_UNCONFIRMED');}
    await work?.onPrepareReload?.();
    const result=await checker.check({force:true});if(result.phase!=='checked'||!result.available)throw Error('VERSION_UNCONFIRMED');
    if(blocked()||work&&work.read().identity!==identity)throw Error('UNSAVED_CHANGES');
    feedback.textContent=text('更新を準備しています…','Preparing the update…');await applyUpdate(result.latest);
    await work?.onPrepareReload?.();
    // Edits made while assets were downloading must not be discarded.
    if(blocked()||work&&work.read().identity!==identity)throw Error('UNSAVED_CHANGES');reload();applying=false;later.disabled=false;close();render();
   }catch(error){applying=false;later.disabled=false;
    feedback.textContent=error.message==='RECOVERY_UNCONFIRMED'?text('端末内の復元用原稿または画像を確認できないため、更新を止めました。原稿はこの画面に保持しています。DSPに保存してから再試行してください。','The local recovery manuscript or images could not be verified. Updating was stopped and the manuscript is kept in this tab. Save a DSP file before retrying.'):
     error.message==='SAVE_UNCONFIRMED'?text('保存がキャンセルされたか、完了を確認できていません。DSPの保存確認を完了するか、もう一度保存してください。','Saving was cancelled or has not been confirmed. Confirm the DSP save or save again.'):
     error.message==='UNSAVED_CHANGES'?text('更新の準備中に原稿または編集内容が変わったため、再読み込みを止めました。現在の原稿を確認してください。','The manuscript or its content changed during update preparation. Reload was stopped. Check the current manuscript.'):
     work?.read().status==='error'?text('原稿を保存できなかったため、更新を止めました。保存を再試行するか、編集に戻って確認してください。','The manuscript could not be saved, so updating was stopped. Retry saving or return to the editor.'):
     text('更新を完了できませんでした。原稿は保持しています。通信状態を確認して再試行してください。','Could not complete the update. Your manuscript is kept. Check the connection and retry.');sync();render();}};
  yes.onclick=()=>update();save.onclick=()=>update(true);
  actions.append(edit,exportFile,save,later,yes);dialog.append(heading,message,manuscript,feedback,actions);document.body.append(dialog);for(const name of events)window.addEventListener(name,sync);sync();dialog.showModal();later.focus();
 }
 mount(homeHost);mount(helpHost,true);render();
 const check=()=>{if(enabled&&!document.hidden)void checker.check();};
 window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('offline',()=>{if(enabled)void checker.check();render();});document.addEventListener('visibilitychange',check);document.addEventListener('studio-ui-language-change',render);
 check();return {check:checker.check,read:checker.read};
}
