// Selection only. The caller owns creation/saving and checks identity again afterwards.
export function chooseAuthoringDestination({allowLocal=false,purpose='save',uid='',defaultSpaceId=null,loadCatalogue,isCurrent=()=>true,en=false,onLogin=()=>{}}){
 const d=document.createElement('dialog');d.className='authoring-destination-dialog';
 const h=document.createElement('h2');h.id='authoring-destination-title';h.textContent=allowLocal?(en?'Where will you create?':'制作場所を選ぶ'):(en?'Save manuscript to cloud':'原稿をクラウドに保存');d.setAttribute('aria-labelledby',h.id);
 const note=document.createElement('p');note.textContent=purpose==='horizon'?(en?'Horizon requires a cloud-saved manuscript. Save first, then continue publication preparation.':'Horizonへの発行にはクラウドへの原稿保存が必要です。保存先を選んで、発行準備へ進みます。'):(en?'Device drafts stay local even after signing in. Cloud saving does not publish or share your work.':'この端末の原稿はログイン後もローカルのままです。クラウドへの保存だけでは公開・共有されません。');
 const status=document.createElement('p');status.setAttribute('role','status');
 const label=document.createElement('label');label.textContent=en?'Cloud space':'クラウドの保存先';const select=document.createElement('select');select.setAttribute('aria-label',label.textContent);label.append(select);
 const actions=document.createElement('div');actions.className='authoring-destination-actions';
 const button=(text)=>{const b=document.createElement('button');b.type='button';b.className='home-action-btn';b.textContent=text;actions.append(b);return b;};
 const cancel=button(en?'Cancel':'キャンセル');const local=allowLocal?button(en?'Create on this device':'この端末で作成'):null;
 const login=button(en?'Sign in':'ログイン');login.hidden=!!uid;
 const retry=button(en?'Retry':'再読み込み');retry.hidden=true;
 const save=button(allowLocal?(en?'Create in cloud':'クラウドで作成'):(en?'Save and continue':'保存して進む'));save.classList.add('primary');save.disabled=true;
 d.append(h,note,label,status,actions);document.body.append(d);d.showModal();let closed=false;
 return new Promise(resolve=>{
  const close=value=>{if(closed)return;closed=true;d.close();d.remove();resolve(value);};
  cancel.onclick=()=>close(null);d.addEventListener('cancel',e=>{e.preventDefault();close(null);});
  if(local)local.onclick=()=>close({kind:'local'});
  login.onclick=()=>{close(null);onLogin();};
  save.onclick=()=>{if(!save.disabled&&isCurrent())close({kind:'cloud',uid,spaceId:select.value||null});else status.textContent=en?'Account or manuscript changed. Close and try again.':'アカウントか原稿が変わりました。閉じてやり直してください。';};
  async function load(){
   save.disabled=true;select.disabled=true;retry.hidden=true;
   if(!uid){label.hidden=true;status.textContent=en?'Sign in, then choose cloud saving again. Local creation needs no account.':'クラウド保存はログイン後にもう一度選んでください。この端末での制作は登録不要です。';return;}
   if(!navigator.onLine){status.textContent=en?'Cloud saving requires a connection.':'クラウド保存には通信が必要です。';retry.hidden=false;return;}
   status.textContent=en?'Loading spaces…':'保存先を確認しています…';
   try{const data=await loadCatalogue();if(closed)return;if(!isCurrent()||data?.uid!==uid)throw Error('changed');
    select.replaceChildren(new Option(en?'My space (cloud)':'マイスペース（クラウド）',''),...data.spaces.map(s=>new Option(s.name+' ('+(en?'cloud':'クラウド')+')',s.id)));
    select.value=data.spaces.some(s=>s.id===defaultSpaceId)?defaultSpaceId:'';
    select.disabled=false;save.disabled=false;status.textContent=en?'Your browser recovery copy is retained.':'ブラウザの復元用コピーも保持します。';
   }catch{if(!closed){status.textContent=en?'Could not confirm spaces. Retry when connected.':'保存先を確認できませんでした。接続を確認して再読み込みしてください。';retry.hidden=false;}}
  }
  retry.onclick=load;void load();
 });
}
