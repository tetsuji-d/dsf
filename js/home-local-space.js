// Display-only projection. Never infer assignment from the selected Dashboard space.
export function localCopySpaceLabel(project, {uid='',catalogue=null,cloudProjectIds=null,online=true,locale='ja'}={}) {
 const en=locale==='en';
 const unknown=en?'Space unconfirmed':'所属未確認';
 if(!project.projectId)return en?'This device only (no space)':'この端末のみ（スペース未所属）';
 if(!online)return en?'Space unconfirmed (offline)':'所属未確認（オフライン）';
 if(!uid)return en?'Sign in to check space':'所属確認にはログインが必要';
 if(project.localOwnerUid&&project.localOwnerUid!==uid)return en?'Copy from another account':'別アカウントの作業コピー';
 if(!project.localOwnerUid||catalogue?.uid!==uid||!catalogue.assignments)return unknown;
 const id=Object.hasOwn(catalogue.assignments,project.projectId)?catalogue.assignments[project.projectId]:null;
 if(id){
  const space=catalogue.spaces?.find(s=>s.id===id);
  return space?.name?(en?'Space: ':'所属: ')+space.name:unknown;
 }
 // An absent assignment alone is not proof that the project still exists.
 if(!cloudProjectIds?.has(project.projectId))return unknown;
 return en?'Space: My space':'所属: マイスペース';
}
