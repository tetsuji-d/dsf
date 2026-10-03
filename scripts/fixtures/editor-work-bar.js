import {describeStudioWork,installStudioWorkStatus} from '/js/studio-work-status.js';
import {installEditorWorkBar} from '/js/editor-work-bar.js';
let locale='ja',revision=0,epoch=0,finish=null,input={};
const result=document.querySelector('#result');
function mode(){epoch++;revision=0;const type=document.querySelector('#mode').value;
 input={open:true,title:'保存表示テスト',identity:String(epoch),local:type==='local'||type==='restored',cloudLinked:type!=='local',fileName:type==='local'?'test.dsp':'',
 file:type==='restored'?{restored:true}:{dirty:true},save:type==='cloud'?{cloudCurrent:true}:type==='conflict'?{state:'error',errorCode:'AUTHORING_CONFLICT'}:{state:'pending'},
 shared:type==='shared',canEdit:type!=='shared',online:type!=='offline',backupCurrent:true,recoveryBlocked:type==='restored'};emit();}
const emit=()=>window.dispatchEvent(new Event('studio-work-status'));
const read=()=>({...describeStudioWork(input),cloudLinked:input.cloudLinked,fileName:input.fileName,backupCurrent:input.backupCurrent,recoveryBlocked:input.recoveryBlocked,online:input.online});
const getLocale=()=>locale;
async function save(){const before=epoch,rev=revision,outcome=document.querySelector('#outcome').value;
 result.textContent='保存要求';if(outcome==='cancel'){result.textContent='保存キャンセル';return;}if(outcome==='fail')throw Error('TEST_FAILURE');
 input.busy='saving';emit();if(outcome==='hold')await new Promise(resolve=>finish=resolve);
 if(before!==epoch){result.textContent='別原稿へ切替済み・古い結果を無視';return;}
 input.busy='';if(rev===revision){if(input.local)input.file={fileSaved:true};else input.save={cloudCurrent:true};}emit();result.textContent=rev===revision?'保存完了':'保存中に追加入力・未保存を維持';}
installEditorWorkBar({host:document.querySelector('#editor-work-bar'),read,getLocale,onSave:save,
 onSaveAs:()=>{result.textContent='DSP書き出し要求';},onDownload:()=>{result.textContent='DSPダウンロード要求';},onCloud:()=>{result.textContent='クラウド保存先選択要求';},onRecovery:()=>{result.textContent='復元コピー画面へ移動';}});
installStudioWorkStatus({host:document.querySelector('#dashboard'),read,getLocale,onSave:save,onResume:()=>{},onExport:()=>{},onClose:()=>{}});
document.querySelector('#mode').onchange=mode;
document.querySelector('#edit').onclick=()=>{revision++;input.file={dirty:true};input.save={state:'pending'};emit();};
document.querySelector('#finish').onclick=()=>{finish?.();finish=null;};
document.querySelector('#language').onclick=()=>{locale=locale==='ja'?'en':'ja';document.dispatchEvent(new Event('studio-ui-language-change'));};
mode();
