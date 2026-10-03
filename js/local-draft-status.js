// Runtime evidence only. DSP/DSF and cloud schemas are unchanged.
export function createLocalDraftStatus(onChange=()=>{}) {
 let session=0, revision=0, savedRevision=0, fileSaved=false,restored=false,reloadPermit=null;
 const read=()=>({session,revision,dirty:revision!==savedRevision,fileSaved,restored,needsSave:restored||revision!==savedRevision,reloadPermitted:reloadPermit?.session===session&&reloadPermit?.revision===revision});
 return {read, reset(){session++;revision=savedRevision=0;fileSaved=restored=false;onChange(read());},
  restore(){revision++;savedRevision=revision;fileSaved=false;restored=true;onChange(read());},
  dirty(){revision++;restored=false;onChange(read());}, checkpoint:()=>({session,revision}),
  confirm(token){if(token.session!==session||token.revision!==revision)return false;savedRevision=revision;fileSaved=true;restored=false;onChange(read());return true;},
  permitReload(token){if(!restored||token.session!==session||token.revision!==revision)return false;reloadPermit={...token};onChange(read());return true;},
  revokeReload(){reloadPermit=null;onChange(read());}};
}
export function installLocalLeaveWarning({target,tracker,isLocal}) {
 let attached=false;
 const needsWarning=()=>isLocal()&&tracker.read().needsSave&&!tracker.read().reloadPermitted;
 const warn=e=>{if(needsWarning()){e.preventDefault();e.returnValue='';}};
 const sync=()=>{const next=needsWarning();if(next===attached)return;attached=next;target[next?'addEventListener':'removeEventListener']('beforeunload',warn);};
 return {sync,dispose(){target.removeEventListener('beforeunload',warn);attached=false;}};
}
