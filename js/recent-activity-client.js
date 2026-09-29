import {accountJsonRequest} from './account-json-request.js';
export function createRecentActivityClient({getUser,fetcher=fetch,now=Date.now}){
 const sent=new Map();let cached=null,inFlight=null;
 const request=command=>accountJsonRequest({getUser,fetcher,url:'/api/recent-activity',command,readOnly:command.kind==='list',limit:100000,timeoutMs:8000,errors:{auth:'AUTH_REQUIRED',timeout:'ACTIVITY_TIMEOUT',offline:'ACTIVITY_OFFLINE',invalid:'ACTIVITY_INVALID',unavailable:'ACTIVITY_UNAVAILABLE'}});
 return {
  async list({force=false}={}){const uid=getUser()?.uid;if(!uid)return null;if(!force&&cached?.uid===uid&&now()-cached.time<30000)return cached.entries;if(inFlight?.uid===uid)return inFlight.promise;
   const task=request({kind:'list'}).then(r=>{if(r.uid!==uid||!Array.isArray(r.entries))throw Error('ACTIVITY_INVALID');cached={uid,time:now(),entries:r.entries};return r.entries;});
   inFlight={uid,promise:task};try{return await task;}finally{if(inFlight?.promise===task)inFlight=null;}
  },
  async opened(target){const uid=getUser()?.uid;if(!uid)return;const key=JSON.stringify([uid,target]);if(now()-(sent.get(key)||0)<60000)return;sent.set(key,now());if(sent.size>100)sent.delete(sent.keys().next().value);
   try{await request({kind:'opened',...target});cached=null;}catch(e){sent.delete(key);throw e;}
  }
 };
}
