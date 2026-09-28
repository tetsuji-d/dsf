// Recovery stays outside the cached Studio entry routes. Never touch authoring storage.
const button=document.getElementById('repair'),status=document.getElementById('status');
function waitForWorker(worker,states){return new Promise((resolve,reject)=>{
 const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);error?reject(error):resolve();};
 const changed=()=>{if(states.includes(worker.state))finish();else if(worker.state==='redundant')finish(new Error('UPDATE_FAILED'));};
 const timer=setTimeout(()=>finish(new Error('UPDATE_TIMEOUT')),180000);worker.addEventListener('statechange',changed);changed();
});}
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='アプリとフォントを更新しています。画面を開いたままお待ちください。';
 try{
  if('serviceWorker' in navigator){const registration=await navigator.serviceWorker.getRegistration('/');
   if(registration){const existing=registration.active||registration.waiting||registration.installing;
    if(!existing||new URL(existing.scriptURL).origin!==location.origin||new URL(existing.scriptURL).pathname!=='/studio-sw.js')throw new Error('UNEXPECTED_WORKER');
    await registration.update();
    if(registration.installing)await waitForWorker(registration.installing,['installed','activated']);
    const waiting=registration.waiting;
    if(waiting){const activated=waitForWorker(waiting,['activated']);waiting.postMessage({type:'STUDIO_ACTIVATE'});await activated;}
   }
  }
  status.textContent='更新を確認しました。Studioを開きます。';location.replace('/studio?room=home');
 }catch{status.textContent='更新を完了できませんでした。通信状態を確認して再試行してください。原稿は削除していません。';button.disabled=false;}
});
