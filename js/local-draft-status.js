// Runtime evidence only. DSP/DSF and cloud schemas are unchanged.
export function createLocalDraftStatus(onChange=()=>{}) {
 let session=0, revision=0, savedRevision=0, fileSaved=false;
 const read=()=>({session,revision,dirty:revision!==savedRevision,fileSaved});
 return {read, reset(){session++;revision=savedRevision=0;fileSaved=false;onChange(read());},
  dirty(){revision++;onChange(read());}, checkpoint:()=>({session,revision}),
  confirm(token){if(token.session!==session||token.revision!==revision)return false;savedRevision=revision;fileSaved=true;onChange(read());return true;}};
}
export function installLocalLeaveWarning({target,tracker,isLocal}) {
 let attached=false;
 const warn=e=>{if(isLocal()&&tracker.read().dirty){e.preventDefault();e.returnValue='';}};
 const sync=()=>{const next=isLocal()&&tracker.read().dirty;if(next===attached)return;attached=next;target[next?'addEventListener':'removeEventListener']('beforeunload',warn);};
 return {sync,dispose(){target.removeEventListener('beforeunload',warn);attached=false;}};
}
