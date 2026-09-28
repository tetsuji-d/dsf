import {chooseAuthoringDestination} from '/js/authoring-destination-dialog.js';
const scenario=document.querySelector('#scenario'),result=document.querySelector('#result');
for(const id of ['new','cloud','horizon'])document.getElementById(id).onclick=async()=>{
 const s=scenario.value;Object.defineProperty(navigator,'onLine',{configurable:true,value:s!=='offline'});
 const value=await chooseAuthoringDestination({allowLocal:id==='new',purpose:id==='horizon'?'horizon':'save',uid:s==='guest'?'':'fixture',loadCatalogue:async()=>{if(s==='failure')throw Error('offline');return {uid:'fixture',spaces:[{id:'sample-space',name:'検証出版'}]};},isCurrent:()=>s!=='changed',onLogin:()=>result.textContent='ログインの案内を表示'});
 if(value!==null)result.textContent=JSON.stringify(value);else if(s!=='guest')result.textContent='キャンセル（保存なし）';
};
