import {auth,authReady} from '../../js/firebase-core.js';
import {connectAuthEmulator,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,getRedirectResult} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {state,dispatch,actionTypes,getProjectSessionEpoch} from '../../js/state.js';
import {createEditorSaveStatus} from '../../js/editor-save-status.js';
import {syncAuthSaveStatus} from '../../js/studio-auth-save-status.js';

connectAuthEmulator(auth,'http://127.0.0.1:9098',{disableWarnings:true});
const $=id=>document.getElementById(id),rows=[];
const mode=new URL(location.href).searchParams.get('mode')==='legacy'?'legacy':'fixed';
$('mode').textContent=mode==='legacy'?'旧初期化: getAuth → setPersistence':'修正初期化: initializeAuth(localStorage)';
const evidence=createEditorSaveStatus(()=>JSON.stringify([getProjectSessionEpoch(),state.projectId,state.uid]));
let prepared=null;
const indicator=document.createElement('p');indicator.id='save-status';$('summary').before(indicator);
function render(event){
    const snapshot={event,epoch:getProjectSessionEpoch(),signedIn:!!auth.currentUser,
        account:auth.currentUser?.email?.startsWith('owner-a')?'A':auth.currentUser?'B':null,
        sameUser:prepared?prepared.user===auth.currentUser:null,save:evidence.read()};
    rows.push(snapshot);if(rows.length>60)rows.shift();
    $('summary').textContent=JSON.stringify(snapshot,null,2);$('events').textContent=JSON.stringify(rows,null,2);
    syncAuthSaveStatus(indicator,{uid:state.uid,save:evidence.read()});
}
onAuthStateChanged(auth,user=>{
    dispatch({type:actionTypes.SET_AUTH_STATE,payload:{uid:user?.uid||null,user}});
    render('auth');
});
window.addEventListener('storage',e=>{
    if(e.key?.startsWith('firebase:authUser:'))render(e.newValue?'storage-present':'storage-removed');
});
for(const account of ['a','b'])$('owner-'+account).onclick=async()=>{
    try{
        const email=`owner-${account}@example.invalid`,password='local-fixture-only';
        try{await createUserWithEmailAndPassword(auth,email,password);}
        catch(error){if(error.code!=='auth/email-already-in-use')throw error;await signInWithEmailAndPassword(auth,email,password);}
        $('result').textContent='ローカル試験ユーザーでログイン';render('login');
    }catch(error){$('result').textContent=error.code||error.message;}
};
$('signout').onclick=async()=>{await signOut(auth);render('signout');};
$('prepare').onclick=()=>{
    if(!auth.currentUser)return;
    dispatch({type:actionTypes.LOAD_PROJECT,payload:{projectId:'auth-fixture-project'}});
    prepared={user:auth.currentUser,epoch:getProjectSessionEpoch(),eventIndex:rows.length};
    evidence.cloudLoaded('r2-private');$('result').textContent='保存済みセッションを準備しました';render('prepared');
};
$('assert').onclick=()=>{
    const ok=prepared&&prepared.user===auth.currentUser&&prepared.epoch===getProjectSessionEpoch()
        &&evidence.read().cloudCurrent&&!rows.slice(prepared.eventIndex).some(row=>row.event==='storage-removed');
    $('result').textContent=ok?'PASS: 認証・保存証拠・セッションを保持':'FAIL: 認証保存先の削除またはセッション失効';
    render('assert');
};
$('delayed').onclick=()=>{
    const delayed=evidence.begin(true);render('pending');$('result').textContent='5秒後に保存応答（ローカル模擬）';
    setTimeout(()=>{delayed.cloudSaved();render('late-response');$('result').textContent=evidence.read().cloudCurrent?'保存証拠を更新':'PASS: 古いセッションの保存応答を拒否';},5000);
};
await authReady;
// Ensures popup/redirect support is still installed even without a pending redirect.
try{await getRedirectResult(auth);render('redirect-ready');}
catch(error){$('result').textContent=error.code||error.message;}
render('ready');
