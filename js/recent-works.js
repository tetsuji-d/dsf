// Display-only grouping: identity, never title or timestamps, links a browser copy to a cloud manuscript.
export const recentIdentity=(uid,id)=>JSON.stringify([uid,id]);
export const recentTime=value=>{const n=value instanceof Date?value.getTime():typeof value==='number'?value:typeof value?.toMillis==='function'?value.toMillis():Date.parse(value||'');return Number.isFinite(n)?n:0;};
export function buildRecentWorks({uid='',owned=[],locals=[],shared=[],catalogue=null,history=[]}={}){
 const rows=new Map(),hidden=new Set(),visited=new Map(history.map(x=>[recentIdentity(x.ownerUid,x.projectId),x.at]));
 for(const p of owned||[]){const key=recentIdentity(uid,p.id);if(p.projectTrash){hidden.add(key);continue;}const known=catalogue?.uid===uid,spaceId=known?(catalogue.assignments[p.id]||null):undefined;
  rows.set(key,{key,ownerUid:uid,projectId:p.id,cloud:p,locals:[],spaceId,spaceName:spaceId?catalogue.spaces.find(s=>s.id===spaceId)?.name:null,updatedAt:recentTime(p.lastUpdated),openedAt:visited.get(key)||0});
 }
 for(const p of shared){const key=recentIdentity(p.ownerUid,p.projectId);if(hidden.has(key))continue;const old=rows.get(key);rows.set(key,{...old,key,ownerUid:p.ownerUid,projectId:p.projectId,shared:p,locals:old?.locals||[],spaceId:p.spaceId,spaceName:p.spaceName,updatedAt:Math.max(old?.updatedAt||0,recentTime(p.updatedAt)),openedAt:visited.get(key)||0});}
 for(const p of locals){
  const identity=p.projectId&&p.localOwnerUid?recentIdentity(p.localOwnerUid,p.projectId):null;
  // Another account's copy is never presented as this account's cloud item.
  const match=p.localOwnerUid===uid&&identity?rows.get(identity):null;
  if(match){match.locals.push(p);match.updatedAt=Math.max(match.updatedAt,recentTime(p.updatedAt));continue;}
  const key='local:'+p.id;rows.set(key,{key,locals:[p],spaceId:!p.projectId?'device':undefined,updatedAt:recentTime(p.updatedAt),openedAt:0,cloudTrashed:identity&&hidden.has(identity),otherAccount:!!p.localOwnerUid&&p.localOwnerUid!==uid,unconfirmed:!!p.projectId});
 }
 return [...rows.values()].sort((a,b)=>Number(!!b.openedAt)-Number(!!a.openedAt)||(b.openedAt||b.updatedAt)-(a.openedAt||a.updatedAt)||a.key.localeCompare(b.key));
}
export function filterRecentWorks(rows,{query='',scope='all'}={}){
 const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase();const q=normalize(query).trim();
 return rows.filter(r=>(scope==='all'||(scope==='device'?!r.cloud&&!r.shared&&r.spaceId==='device':scope==='copies'?r.locals.length:scope==='personal'?r.spaceId===null:r.spaceId===scope))&&(!q||[r.cloud?.title,r.cloud?.projectName,r.shared?.title,r.spaceName,...r.locals.flatMap(p=>[p.title,p.projectName])].some(s=>normalize(s).includes(q))));
}

// Recovery records stay intact; only the normal manuscript shelf is projected.
export function separateRecentRecovery(rows){
 const manuscripts=[],recovery=[];
 for(const row of rows){
  if(row.cloud||row.shared){
   recovery.push(...row.locals);
   manuscripts.push({...row,locals:[],updatedAt:Math.max(recentTime(row.cloud?.lastUpdated),recentTime(row.shared?.updatedAt))});
  }else if(row.unconfirmed||row.otherAccount||row.cloudTrashed)recovery.push(...row.locals);
  else manuscripts.push(row); // An independent draft may be the only existing manuscript.
 }
 manuscripts.sort((a,b)=>Number(!!b.openedAt)-Number(!!a.openedAt)||(b.openedAt||b.updatedAt)-(a.openedAt||a.updatedAt)||a.key.localeCompare(b.key));
 return {manuscripts,recovery};
}

// Incremental shared directory reads: at most three work pages per user request.
export function createRecentDirectory({execute,isCurrent=()=>true}){
 let spaces=[],cursor=null,started=false,queue=[],works=[],failed=false,unavailable=false,busy=false,pending=null;
 const snapshot=()=>({started,spaces:[...spaces],works:[...works],more:!unavailable&&(!started||!!cursor||queue.length>0),failed,unavailable,busy});
 async function perform(){busy=true;failed=false;
  try{
   if(!queue.length&&(!started||cursor)){const r=await execute({kind:'listJoinedSpaces',afterSpaceId:cursor});if(!isCurrent())return snapshot();
    if(!Array.isArray(r.items))throw Error('INVALID_DIRECTORY');started=true;cursor=r.nextCursor||null;
    for(const s of r.items)if(!spaces.some(x=>x.id===s.id)){spaces.push(s);queue.push({space:s,afterId:null});}
   }
   for(let i=0;i<3&&queue.length;i++){
    const item=queue[0];const r=await execute({kind:'listSpaceWorks',spaceId:item.space.id,afterId:item.afterId});if(!isCurrent())return snapshot();
    if(r.space?.id!==item.space.id||!Array.isArray(r.items))throw Error('INVALID_DIRECTORY');
    if(item.afterId===null)works=works.filter(w=>w.spaceId!==item.space.id);
    for(const p of r.items)if(p.ownerUid&&p.projectId&&!works.some(w=>w.spaceId===item.space.id&&w.workId===p.workId))works.push({...p,spaceId:item.space.id,spaceName:r.space.name,canOpen:r.canOpen!==false});
    queue.shift();if(r.nextCursor)queue.push({space:item.space,afterId:r.nextCursor});
   }
  }catch(error){unavailable=['INVITATION_TEST_ONLY','INVITATIONS_DISABLED'].includes(error.message);failed=!unavailable;const sid=queue[0]?.space.id;if(sid){works=works.filter(w=>w.spaceId!==sid);queue[0].afterId=null;}else{works=[];spaces=[];started=false;cursor=null;}}
  finally{busy=false;}return snapshot();
 }
 function load(){if(pending)return pending;pending=perform().finally(()=>{pending=null;});return pending;}
 return {load,snapshot};
}
