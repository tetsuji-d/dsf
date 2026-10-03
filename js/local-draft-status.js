// Runtime evidence only. DSP/DSF and cloud schemas are unchanged.
export function createLocalDraftStatus(onChange=()=>{}) {
 let session=0, revision=0, savedRevision=0, fileSaved=false,restored=false;
 const read=()=>({session,revision,dirty:revision!==savedRevision,fileSaved,restored,needsSave:restored||revision!==savedRevision});
 return {read, reset(){session++;revision=savedRevision=0;fileSaved=restored=false;onChange(read());},
  restore(){revision++;savedRevision=revision;fileSaved=false;restored=true;onChange(read());},
  dirty(){revision++;restored=false;onChange(read());}, checkpoint:()=>({session,revision}),
  confirm(token){if(token.session!==session||token.revision!==revision)return false;savedRevision=revision;fileSaved=true;restored=false;onChange(read());return true;}};
}
export function installLocalLeaveWarning({target,tracker,isLocal}) {
 let attached=false;
 const warn=e=>{if(isLocal()&&tracker.read().needsSave){e.preventDefault();e.returnValue='';}};
 const sync=()=>{const next=isLocal()&&tracker.read().needsSave;if(next===attached)return;attached=next;target[next?'addEventListener':'removeEventListener']('beforeunload',warn);};
 return {sync,dispose(){target.removeEventListener('beforeunload',warn);attached=false;}};
}
