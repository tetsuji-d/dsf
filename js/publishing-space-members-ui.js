import {canAccessPublishingSpace as can,canManageSpaceMember,visibleSpaceWorks,describeAccessChange,validSpaceMember} from './publishing-space-access.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy={
 ja:{title:'メンバーと権限',intro:'役割と担当範囲を組み合わせて、作品へのアクセスを設定します。',actor:'操作する役割を試す',owner:'所有者',admin:'管理者',member:'担当範囲を指定',editor:'編集可',viewer:'閲覧のみ',none:'アクセス不可',space:'スペース全体',label:'指定レーベル',work:'指定作品',people:'メンバー',preview:'このメンバーから見える作品',change:'権限を変更',save:'試作に反映',review:'変更内容を確認',back:'戻る',cancel:'キャンセル',add:'担当範囲を追加',remove:'削除',role:'役割',scope:'アクセス範囲',target:'対象',choose:'選択してください',future:'レーベル指定は、そのレーベルに今後追加される作品にも適用されます。作品のレーベル変更は管理者以上が行います。',overlap:'範囲が重なる作品では編集権限が優先されます。公開・所属変更は編集権限に含まれません。',empty:'閲覧できる作品はありません。',error:'担当範囲を1件以上指定し、対象を選択してください。',confirm:'アクセスの変更を確認',noChange:'現在の作品に対するアクセス変更はありません。',saved:'試作画面に反映しました。実際の共有権限は変更していません。',all:'すべての作品',inherited:'スペース全体の管理',restricted:'自分の担当作品だけを表示しています。',count:'作品',ownerName:'山口（所有者）',objects:'レーベル・作品から設定',labels:'レーベル',works:'作品',access:'アクセス権限',menu:'メニュー',close:'閉じる',direct:'この対象に直接設定',fromSpace:'スペース全体から継承',fromLabel:'レーベルから継承',individual:'作品ごとの設定',partial:'一部の作品のみ',setTarget:'この対象の権限を設定',editSource:'付与元で変更',limited:'この画面では、この対象の直接設定だけを変更します。',currentEffective:'反映後に有効な権限',readOnlySources:'継承した権限（変更不可）',noInherited:'継承した権限はありません。',unchanged:'直接設定なし',stale:'設定が変更されています。閉じてから開き直してください。',targetHint:'この対象の設定と、上位から引き継いだ権限を表示しています。',sourceHint:'継承した権限はここでは変更できません。変更する場合は、付与元のレーベルまたはメンバー管理から開いてください。直接設定を弱めても、継承した権限は残ります。',editingTarget:'設定する対象',editingSource:'付与元の設定を変更',objectHint:'各メニューから、アクセスできるメンバーを確認・変更できます。'},
 en:{title:'Members & permissions',intro:'Combine roles and scopes to control access to works.',actor:'Try acting as',owner:'Owner',admin:'Administrator',member:'Scoped access',editor:'Can edit',viewer:'View only',none:'No access',space:'Entire space',label:'Selected label',work:'Selected work',people:'Members',preview:'Works visible to this member',change:'Change access',save:'Apply to preview',review:'Review changes',back:'Back',cancel:'Cancel',add:'Add scope',remove:'Remove',role:'Role',scope:'Access scope',target:'Target',choose:'Choose a target',future:'Label access includes works added to that label in the future. Only administrators and the owner can change work labels.',overlap:'Editing takes precedence where scopes overlap. Editing does not include publishing or moving works.',empty:'No accessible works.',error:'Add at least one scope and select its target.',confirm:'Review access changes',noChange:'No access changes to existing works.',saved:'Applied to this preview. No real sharing permissions changed.',all:'All works',inherited:'Space-wide management',restricted:'Only your assigned works are shown.',count:'works',ownerName:'Yamaguchi (owner)',objects:'Manage access from a label or work',labels:'Labels',works:'Works',access:'Access permissions',menu:'Menu',close:'Close',direct:'Assigned directly to this target',fromSpace:'Inherited from the space',fromLabel:'Inherited from a label',individual:'Individual work access',partial:'Selected works only',setTarget:'Set access to this target',editSource:'Change at source',limited:'Only the direct assignment for this target can be changed here.',currentEffective:'Effective access after applying',readOnlySources:'Inherited access (read-only)',noInherited:'No inherited access.',unchanged:'No direct assignment',stale:'Permissions changed. Close and reopen this view.',targetHint:'Direct assignments and inherited permissions for this target.',sourceHint:'Inherited access cannot be changed here. Open the source label or member management to change it. Lowering a direct assignment does not remove inherited access.',editingTarget:'Target to configure',editingSource:'Change the source assignment',objectHint:'Open a menu to view and change who can access that label or work.'}
};
// A target-scoped update never accepts replacement grants for other resources.
export function withTargetPermission(original, target, role) {
 if(!original || !validSpaceMember(original,original.spaceId) || original.role!=='member'
  || !target || !['work','label'].includes(target.scope) || !['viewer','editor'].includes(role))return null;
 const draft=structuredClone(original),grant={scope:target.scope,targetId:target.targetId,role};
 let replaced=false;
 draft.grants=draft.grants.flatMap(g=>{
  if(g.scope!==target.scope||g.targetId!==target.targetId)return [g];
  if(replaced)return [];replaced=true;return [grant];
 });
 if(!replaced)draft.grants.push(grant);
 return validSpaceMember(draft,draft.spaceId)?draft:null;
}
// A memory-only design preview. Real membership writes require server transactions and endpoint-wide authorization.
export function createSpaceMembersPreview({root,data,getLocale}) {
 let actorUid=data.space.ownerUid,selectedUid='editor',message='';
 const t=()=>copy[getLocale()==='en'?'en':'ja'];
 const member=uid=>data.members.find(m=>m.uid===uid);
 const context=uid=>({actorUid:uid,space:data.space,member:member(uid)});
 const name=uid=>uid===data.space.ownerUid?t().ownerName:member(uid)?.name||uid;
 const scopeName=grant=>grant.scope==='space'?t().all:(grant.scope==='label'?data.labels:data.works).find(item=>item.id===grant.targetId)?.[grant.scope==='label'?'name':'title']||t().choose;
 const summary=m=>m.role==='admin'?t().inherited:m.grants.map(g=>t()[g.role]+' · '+scopeName(g)).join(' / ');
 const options=(rows,value)=>rows.map(([id,label])=>'<option value="'+escape(id)+'" '+(id===value?'selected':'')+'>'+escape(label)+'</option>').join('');
 function render(){
  const text=t(),actor=context(actorUid),manage=can(actor,'manageMembers');
  const members=manage?data.members:data.members.filter(m=>m.uid===actorUid);
  if(!manage)selectedUid=actorUid;
  root.innerHTML='<h1>'+text.title+'</h1><p class="subtle">'+text.intro+'</p><div class="members-toolbar"><label for="actor">'+text.actor+'</label><select id="actor">'+options([[data.space.ownerUid,text.owner],...data.members.map(m=>[m.uid,m.name])],actorUid)+'</select></div><p role="status" id="member-status">'+escape(message)+'</p><div class="members-layout"><section class="members-panel"><h2>'+text.people+'</h2>'
   +(manage?'<div class="member-row"><div><strong>'+escape(text.ownerName)+'</strong><span class="member-badge role-owner">'+text.owner+'</span></div></div>':'<p class="notice">'+text.restricted+'</p>')
   +members.map(m=>'<div class="member-row"><div><strong>'+escape(m.name)+'</strong><small>'+escape(summary(m))+'</small></div>'+(canManageSpaceMember(actor,m,m)?'<button type="button" data-edit-member="'+escape(m.uid)+'">'+text.change+'</button>':'')+'</div>').join('')
   +'</section><section class="members-panel"><h2>'+text.preview+'</h2><select class="members-preview-select" id="preview-member" aria-label="'+text.preview+'">'+options((manage?[[data.space.ownerUid,text.ownerName],...members.map(m=>[m.uid,m.name])]:members.map(m=>[m.uid,m.name])),selectedUid)+'</select><div id="visible-works"></div><p class="subtle">'+text.overlap+'</p></section></div>';
  root.querySelector('#actor').onchange=e=>{actorUid=e.target.value;message='';render();};
  root.querySelector('#preview-member').onchange=e=>{selectedUid=e.target.value;renderWorks();};
  root.querySelectorAll('[data-edit-member]').forEach(button=>button.onclick=()=>openEditor(button.dataset.editMember,button));renderWorks();
  if(manage)renderObjects();
 }
 function renderWorks(){
  const ctx=context(selectedUid),works=visibleSpaceWorks(ctx,data.works);
  root.querySelector('#visible-works').innerHTML=works.length?works.map(w=>'<div class="work-access" data-visible-work="'+escape(w.id)+'"><span>'+escape(w.title)+'</span><span class="member-badge">'+(can(ctx,'editWork',w)?t().editor:t().viewer)+'</span></div>').join(''):'<p>'+t().empty+'</p>';
 }
 function renderObjects(){
  const menu=(scope,item)=>'<div class="resource-row"><strong>'+escape(item.name||item.title)+'</strong><details class="resource-menu"><summary aria-label="'+escape((item.name||item.title)+' · '+t().menu)+'">⋯</summary><button type="button" data-target-scope="'+scope+'" data-target-id="'+escape(item.id)+'">'+t().access+'</button></details></div>';
  const section=document.createElement('section');section.className='resource-section';
  section.innerHTML='<h2>'+t().objects+'</h2><p class="subtle">'+t().objectHint+'</p><div class="members-layout"><section class="members-panel"><h3>'+t().labels+'</h3>'+data.labels.map(item=>menu('label',item)).join('')+'</section><section class="members-panel"><h3>'+t().works+'</h3>'+data.works.map(item=>menu('work',item)).join('')+'</section></div>';
  root.append(section);
  section.querySelectorAll('[data-target-scope]').forEach(button=>button.onclick=()=>{button.closest('details').open=false;openTarget({scope:button.dataset.targetScope,targetId:button.dataset.targetId},button.closest('details').querySelector('summary'));});
  section.addEventListener('keydown',event=>{if(event.key==='Escape'){const details=event.target.closest('details');if(details){details.open=false;details.querySelector('summary').focus();}}});
 }
 function openTarget(target,trigger){
  if(!can(context(actorUid),'manageMembers'))return;
  const text=t(),targetWorks=target.scope==='label'?data.works.filter(w=>w.labelId===target.targetId):data.works.filter(w=>w.id===target.targetId);
  const dialog=document.createElement('dialog');dialog.className='target-access-dialog';dialog.setAttribute('aria-labelledby','target-access-title');document.body.append(dialog);
  const restore=()=>{if(trigger?.isConnected)trigger.focus();else [...root.querySelectorAll('[data-target-id]')].find(b=>b.dataset.targetId===target.targetId&&b.dataset.targetScope===target.scope)?.closest('details').querySelector('summary').focus();};
  const close=()=>{dialog.close();dialog.remove();restore();};
  const rows=[{uid:data.space.ownerUid,role:'owner'},...data.members.filter(m=>validSpaceMember(m,data.space.id))];
  dialog.innerHTML='<button type="button" class="target-close" data-close-target aria-label="'+text.close+'">×</button><h2 id="target-access-title">'+text.access+' · '+escape(scopeName(target))+'</h2><p class="subtle">'+text.targetHint+'</p><p class="notice">'+text.sourceHint+'</p>';
  for(const m of rows){
   const matches=m.role==='member'?m.grants.filter(g=>g.scope==='space'||(g.scope===target.scope&&g.targetId===target.targetId)||(target.scope==='work'&&g.scope==='label'&&g.targetId===targetWorks[0]?.labelId)||(target.scope==='label'&&g.scope==='work'&&targetWorks.some(w=>w.id===g.targetId))):[];
   let level='editor';
   if(m.role==='member'){
    if(target.scope==='work')level=can(context(m.uid),'editWork',targetWorks[0])?'editor':can(context(m.uid),'readWork',targetWorks[0])?'viewer':'none';
    else {const broad=matches.filter(g=>g.scope!=='work');level=broad.some(g=>g.role==='editor')?'editor':broad.length?'viewer':matches.length?'partial':'none';}
   }
   const editable=m.role==='member'&&canManageSpaceMember(context(actorUid),m,m);
   const origin=g=>g.scope===target.scope&&g.targetId===target.targetId?text.direct:g.scope==='space'?text.fromSpace:g.scope==='label'?text.fromLabel:text.individual;
   dialog.innerHTML+='<div class="target-member" data-target-member="'+escape(m.uid)+'"><div class="target-member-head"><strong>'+escape(name(m.uid))+'</strong><span class="member-badge">'+(target.scope==='label'&&['editor','viewer'].includes(level)?text.label+' · ':'')+text[level]+'</span></div>'
    +(m.role==='owner'||m.role==='admin'?'<p class="subtle">'+text[m.role]+' · '+text.inherited+'</p>':matches.map((g,i)=>'<div class="permission-source"><span>'+escape(origin(g)+' · '+scopeName(g)+' · '+text[g.role])+'</span>'+'</div>').join(''))
    +(editable?'<button type="button" data-direct-uid="'+escape(m.uid)+'">'+text.setTarget+'</button>':'')+'</div>';
  }
  dialog.innerHTML+='<footer><button type="button" data-close-target>'+text.close+'</button></footer>';
  const edit=(uid,entry)=>{dialog.close();dialog.remove();openScopedEditor(uid,entry,()=>openTarget(target,trigger));};
  dialog.querySelectorAll('[data-direct-uid]').forEach(button=>button.onclick=()=>edit(button.dataset.directUid,{...target,source:false}));
  dialog.querySelectorAll('[data-close-target]').forEach(button=>button.onclick=close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
 }
 function openScopedEditor(uid,target,onReturn){
  const original=structuredClone(member(uid)),actor=context(actorUid);
  if(!original||original.role!=='member'||!canManageSpaceMember(actor,original,original))return;
  if(!['work','label'].includes(target.scope)||!(target.scope==='work'?data.works:data.labels).some(x=>x.id===target.targetId))return;
  const works=target.scope==='work'?data.works.filter(w=>w.id===target.targetId):data.works.filter(w=>w.labelId===target.targetId);
  const direct=original.grants.filter(g=>g.scope===target.scope&&g.targetId===target.targetId);
  const initial=direct.some(g=>g.role==='editor')?'editor':direct.length?'viewer':'';
  const inherited=original.grants.filter(g=>g.scope==='space'||(target.scope==='work'&&g.scope==='label'&&g.targetId===works[0]?.labelId));
  let selected=initial,step='edit',error='';
  const dialog=document.createElement('dialog');dialog.className='scoped-permission-dialog';dialog.setAttribute('aria-labelledby','scoped-title');document.body.append(dialog);
  const close=()=>{dialog.close();dialog.remove();onReturn();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  const draft=()=>withTargetPermission(original,target,selected);
  const changes=()=>describeAccessChange({space:data.space,actorUid:uid,member:original},{space:data.space,actorUid:uid,member:draft()},works);
  function effective(){
   const updated=draft();if(!updated)return '';
   return works.map(work=>'<li>'+escape(work.title)+': '+(can({space:data.space,actorUid:uid,member:updated},'editWork',work)?t().editor:t().viewer)+'</li>').join('');
  }
  function paint(){
   const text=t();
   dialog.innerHTML='<h2 id="scoped-title">'+(step==='edit'?text.change:text.confirm)+'</h2><p>'+escape(name(uid))+'</p><div class="fixed-permission-target"><small>'+text[target.scope]+'</small><strong>'+escape(scopeName(target))+'</strong></div><p class="subtle">'+text.limited+'</p>';
   if(step==='edit')dialog.innerHTML+='<label>'+text.direct+'<select id="scoped-role">'+options([['',text.choose],['viewer',text.viewer],['editor',text.editor]],selected)+'</select></label>';
   else dialog.innerHTML+='<div class="confirmation-summary">'+text.direct+': '+(initial?text[initial]:text.unchanged)+' → '+text[selected]+'</div><ul class="changes">'+changes().map(c=>'<li>'+escape(works.find(w=>w.id===c.workId).title)+': '+text[c.from]+' → '+text[c.to]+'</li>').join('')+'</ul>'+(changes().length?'':'<p>'+text.noChange+'</p>');
   dialog.innerHTML+='<section class="read-only-permissions"><h3>'+text.readOnlySources+'</h3>'+(inherited.length?'<ul>'+inherited.map(g=>'<li>'+escape(scopeName(g))+' · '+text[g.role]+'</li>').join('')+'</ul><p class="subtle">'+text.sourceHint+'</p>':'<p>'+text.noInherited+'</p>')+'</section>';
   if(target.scope==='label')dialog.innerHTML+='<p class="notice">'+text.future+'</p>';
   dialog.innerHTML+='<section aria-live="polite"><h3>'+text.currentEffective+'</h3><ul id="scoped-effective">'+effective()+'</ul></section><p class="error" role="alert">'+error+'</p><footer><button type="button" data-cancel>'+text.cancel+'</button>'+(step==='edit'?'<button type="button" id="scoped-review" class="primary" '+(!draft()?'disabled':'')+'>'+text.review+'</button>':'<button type="button" id="scoped-back">'+text.back+'</button><button type="button" id="scoped-apply" class="primary">'+text.save+'</button>')+'</footer>';
   dialog.querySelector('[data-cancel]').onclick=close;
   if(step==='edit'){
    dialog.querySelector('#scoped-role').onchange=e=>{selected=e.target.value;dialog.querySelector('#scoped-review').disabled=!draft();dialog.querySelector('#scoped-effective').innerHTML=effective();};
    dialog.querySelector('#scoped-review').onclick=()=>{if(!draft())return;step='confirm';paint();dialog.querySelector('#scoped-apply').focus();};
   }else{
    dialog.querySelector('#scoped-back').onclick=()=>{step='edit';paint();dialog.querySelector('#scoped-role').focus();};
    dialog.querySelector('#scoped-apply').onclick=()=>{
     const updated=draft();
     if(JSON.stringify(member(uid))!==JSON.stringify(original)||!updated||!canManageSpaceMember(context(actorUid),member(uid),updated)){error=text.stale;paint();return;}
     data.members[data.members.findIndex(m=>m.uid===uid)]=updated;selectedUid=uid;message=text.saved;render();close();
    };
   }
  }
  paint();dialog.showModal();dialog.querySelector('#scoped-role').focus();
 }
 function openEditor(uid,trigger){
  const original=structuredClone(member(uid));let draft=structuredClone(original),step='edit',error='';
  if(!canManageSpaceMember(context(actorUid),original,draft))return;
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','permission-dialog-title');document.body.append(dialog);
  const close=()=>{dialog.close();dialog.remove();trigger.isConnected?trigger.focus():root.querySelector('[data-edit-member="'+uid+'"]')?.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  function paint(){
   const text=t();
   dialog.innerHTML='<h2 id="permission-dialog-title">'+(step==='edit'?text.change:text.confirm)+'</h2><p>'+escape(name(uid))+'</p>';
   if(step==='edit'){
    dialog.innerHTML+='<label>'+text.role+'<select id="membership-role">'+options([['member',text.member],...(actorUid===data.space.ownerUid?[['admin',text.admin]]:[])],draft.role)+'</select></label>';
    if(draft.role==='member') dialog.innerHTML+='<div id="grants">'+draft.grants.map((g,i)=>'<div class="grant-row" data-grant="'+i+'"><label>'+text.role+'<select data-grant-role>'+options([['editor',text.editor],['viewer',text.viewer]],g.role)+'</select></label><label>'+text.scope+'<select data-grant-scope>'+options([['space',text.space],['label',text.label],['work',text.work]],g.scope)+'</select></label><label class="grant-target">'+text.target+'<select data-grant-target '+(g.scope==='space'?'disabled':'')+'>'+options(g.scope==='space'?[['',text.all]]:[['',text.choose],...(g.scope==='label'?data.labels:data.works).map(item=>[item.id,item.name||item.title])],g.targetId||'')+'</select></label><button type="button" data-remove-grant>'+text.remove+'</button></div>').join('')+'</div><button type="button" id="add-grant">＋ '+text.add+'</button>';
    dialog.innerHTML+='<p class="notice">'+text.future+'</p><p role="alert" class="error">'+error+'</p><footer><button type="button" data-cancel>'+text.cancel+'</button><button type="button" class="primary" id="review-access">'+text.review+'</button></footer>';
    dialog.querySelector('#membership-role').onchange=e=>{draft.role=e.target.value;draft.grants=draft.role==='admin'?[]:[{role:'viewer',scope:'work',targetId:''}];paint();};
    dialog.querySelectorAll('[data-grant]').forEach(row=>{
     const i=Number(row.dataset.grant);
     row.querySelector('[data-grant-role]').onchange=e=>{draft.grants[i].role=e.target.value;};
     row.querySelector('[data-grant-scope]').onchange=e=>{draft.grants[i].scope=e.target.value;delete draft.grants[i].targetId;paint();dialog.querySelectorAll('[data-grant-scope]')[i]?.focus();};
     row.querySelector('[data-grant-target]').onchange=e=>{draft.grants[i].targetId=e.target.value;};
     row.querySelector('[data-remove-grant]').onclick=()=>{draft.grants.splice(i,1);paint();dialog.querySelector('#add-grant')?.focus();};
    });
    const add=dialog.querySelector('#add-grant');if(add)add.onclick=()=>{draft.grants.push({role:'viewer',scope:'work',targetId:''});paint();dialog.querySelectorAll('[data-grant-role]')[draft.grants.length-1]?.focus();};
    dialog.querySelector('#review-access').onclick=()=>{
     const targetsValid=draft.grants.every(g=>g.scope==='space'||(g.scope==='label'?data.labels:data.works).some(x=>x.id===g.targetId));
     if(!validSpaceMember(draft,data.space.id)||!targetsValid||!canManageSpaceMember(context(actorUid),original,draft)){error=text.error;paint();return;}
     step='confirm';paint();dialog.querySelector('#apply-access').focus();
    };
   }else{
    const changes=describeAccessChange({space:data.space,actorUid:uid,member:original},{space:data.space,actorUid:uid,member:draft},data.works);
    dialog.innerHTML+='<div class="confirmation-summary">'+escape(summary(draft))+'</div><ul class="changes">'+changes.map(change=>'<li>'+escape(data.works.find(w=>w.id===change.workId).title)+': '+text[change.from]+' → '+text[change.to]+'</li>').join('')+'</ul>'+(changes.length?'':'<p>'+text.noChange+'</p>')+'<p class="notice">'+text.future+'</p><footer><button type="button" data-cancel>'+text.cancel+'</button><button type="button" id="back-access">'+text.back+'</button><button type="button" class="primary" id="apply-access">'+text.save+'</button></footer>';
    dialog.querySelector('#back-access').onclick=()=>{step='edit';paint();dialog.querySelector('#membership-role').focus();};
    dialog.querySelector('#apply-access').onclick=()=>{
     if(!canManageSpaceMember(context(actorUid),member(uid),draft))return;
     data.members[data.members.findIndex(m=>m.uid===uid)]=structuredClone(draft);selectedUid=uid;message=text.saved;render();close();
    };
   }
   dialog.querySelector('[data-cancel]').onclick=close;
  }
  paint();dialog.showModal();dialog.querySelector('select')?.focus();
 }
 return {render};
}
