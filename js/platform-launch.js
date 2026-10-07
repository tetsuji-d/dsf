// One launchQueue consumer per window; URL and file deliveries must not compete.
const queues=new WeakMap();
export function registerPlatformLaunch(kind,handler,target=window){
 if(typeof target.launchQueue?.setConsumer!=='function')return;
 let state=queues.get(target);
 if(!state){state={handlers:{},pending:{url:[],file:[]}};queues.set(target,state);
  target.launchQueue.setConsumer(params=>{
   const type=params?.files?.length?'file':'url';
   if(state.handlers[type])state.handlers[type](params);else state.pending[type].push(params);
  });
 }
 state.handlers[kind]=handler;
 for(const params of state.pending[kind].splice(0))handler(params);
}
export function launchDestination(raw,current){
 try{
  const base=new URL(current),url=new URL(raw,base);
  if(url.origin!==base.origin||!['/','/index.html','/studio','/studio.html','/viewer','/viewer.html','/mypage','/mypage.html'].includes(url.pathname))return null;
  const key=u=>{const v=new URL(u);v.pathname=v.pathname.replace(/\.html$/,'').replace(/^\/index$/,'/');v.searchParams.delete('source');return v.href;};
  return key(url)===key(base)?null:url.href;
 }catch{return null;}
}

// The shared shortcut only focuses an existing window, never replaces its work.
export function isPlatformShortcut(raw,current){
 try{const url=new URL(raw,current);return url.origin===new URL(current).origin&&['/','/index.html'].includes(url.pathname)&&url.searchParams.get('source')==='pwa'&&[...url.searchParams.keys()].every(k=>k==='source')&&!url.hash;}catch{return false;}
}
