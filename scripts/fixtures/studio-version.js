import {installStudioVersionUI} from '/js/studio-update-ui.js';
const current={schema:1,id:'20260929000000000',builtAt:1790640000000,label:'v2026.09.29-000000'};
let value=current,fail=false,locale='ja';const dirty=document.querySelector('#dirty'),result=document.querySelector('#result');
const ui=installStudioVersionUI({current,getLocale:()=>locale,homeHost:document.querySelector('#home'),helpHost:document.querySelector('#help'),blocked:()=>dirty.checked,fetchVersion:async()=>{if(fail)throw Error('offline');return value;},applyUpdate:async()=>{result.textContent='更新ボタンによる準備完了';},reload:()=>{result.textContent='PASS: 明示操作から再読み込み要求';}});
document.querySelector('#same').onclick=()=>{fail=false;value=current;void ui.check({force:true});};
document.querySelector('#new').onclick=()=>{fail=false;value={...current,id:'20260930000000000',builtAt:current.builtAt+86400000,label:'v2026.09.30-000000'};void ui.check({force:true});};
document.querySelector('#failed').onclick=()=>{fail=true;void ui.check({force:true});};
document.querySelector('#lang').onclick=()=>{locale=locale==='ja'?'en':'ja';document.dispatchEvent(new Event('studio-ui-language-change'));};
dirty.onchange=()=>window.dispatchEvent(new Event('local-draft-status'));
