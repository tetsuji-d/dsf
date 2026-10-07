// Transient same-origin handoff. No IndexedDB, uploads or source-window navigation.
export function fileLaunchPath(name){
 if(/\.dsp$/i.test(name))return '/studio.html?fileLaunch=dsp';
 if(/\.dsf$/i.test(name))return '/viewer.html?fileLaunch=dsf';
 return null;
}
export function transferFileLaunch(handle,target=window){
 const path=fileLaunchPath(handle?.name);if(!path)return Promise.reject(Error('type'));
 const nonce=target.crypto.randomUUID(),origin=target.location.origin;
 return new Promise((resolve,reject)=>{
  let child,timer;
  const finish=error=>{target.clearTimeout(timer);target.removeEventListener('message',onMessage);error?reject(error):resolve(true);};
  const onMessage=event=>{
   if(event.origin!==origin||event.source!==child||event.data?.nonce!==nonce)return;
   if(event.data.type==='horizon-file-ready'){
    try{child.postMessage({type:'horizon-file-delivery',nonce,handle},origin);}catch{finish(Error('open'));}
   }else if(event.data.type==='horizon-file-received')finish();
  };
  target.addEventListener('message',onMessage);
  child=target.open(path+'#file-transfer='+nonce,'_blank');
  if(!child){finish(Error('open'));return;}
  timer=target.setTimeout(()=>finish(Error('open')),30000);
 });
}
export function receiveFileTransfer(receive,extension,target=window){
 const nonce=new URLSearchParams(target.location.hash.slice(1)).get('file-transfer');
 const opener=target.opener,origin=target.location.origin;
 if(!opener||!nonce||!/^[-a-f0-9]{36}$/i.test(nonce))return;
 let done=false;
 const onMessage=event=>{
  if(done||event.source!==opener||event.origin!==origin||event.data?.nonce!==nonce||event.data.type!=='horizon-file-delivery')return;
  const handle=event.data.handle;
  if(handle?.kind!=='file'||typeof handle.getFile!=='function'||!String(handle.name).toLowerCase().endsWith(extension))return;
  receive({files:[handle]});done=true;target.removeEventListener('message',onMessage);
  opener.postMessage({type:'horizon-file-received',nonce},origin);
  target.history.replaceState(target.history.state,'',target.location.pathname+target.location.search);
 };
 target.addEventListener('message',onMessage);
 opener.postMessage({type:'horizon-file-ready',nonce},origin);
}
