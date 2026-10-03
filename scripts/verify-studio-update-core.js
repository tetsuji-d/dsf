import assert from 'node:assert/strict';
import {prepareStudioUpdate,fetchStudioUpdateTarget} from '../js/studio-update-core.js';
const target={schema:1,id:'20261003121902931',builtAt:1791029942931,label:'v2026.10.03-121902'};
const origin='https://studio.example';
function scenario({staleWorker=false,staleController=false,staleShell=false,installFailure=false,foreign=false}={}){
 const calls=[];
 const old={scriptURL:origin+(foreign?'/another-sw.js':'/studio-sw.js'),build:{...target,id:'20261003115606999'}};
 const next=new EventTarget();Object.assign(next,{state:'installing',build:staleWorker?old.build:target});
 const registration={active:old,installing:null,waiting:null};
 const serviceWorker={controller:old,getRegistration:async()=>registration,register:async(url,options)=>{
  calls.push({url,options});registration.installing=next;
  setTimeout(()=>{next.state=installFailure?'redundant':'installed';registration.installing=null;if(!installFailure)registration.waiting=next;next.dispatchEvent(new Event('statechange'));},0);
  return registration;
 }};
 next.postMessage=data=>{assert.equal(data.type,'STUDIO_ACTIVATE');calls.push('activate');registration.waiting=null;registration.active=next;if(!staleController)serviceWorker.controller=next;next.state='activated';next.dispatchEvent(new Event('statechange'));};
 const options={serviceWorker,origin,readBuild:async worker=>worker.build,fetcher:async(url,settings)=>{calls.push({url,settings});return new Response('<meta name="dsf-studio-build" content="'+(staleShell?old.build.id:target.id)+'">');}};
 return {calls,options};
}
const good=scenario();await prepareStudioUpdate(target,good.options);
assert.deepEqual(good.calls[0],{url:'/studio-sw.js?build='+target.id,options:{scope:'/',updateViaCache:'none'}});
assert.equal(good.calls[1],'activate');assert.equal(good.calls[2].settings.cache,'no-store');
for(const [flags,error] of [[{staleWorker:true},'VERSION_CHANGED'],[{staleController:true},'CONTROLLER_UNCONFIRMED'],[{staleShell:true},'SHELL_UNCONFIRMED'],[{installFailure:true},'INSTALL_FAILED'],[{foreign:true},'UNEXPECTED_WORKER']]){
 const test=scenario(flags);await assert.rejects(prepareStudioUpdate(target,test.options),new RegExp(error));
 if(flags.staleWorker||flags.installFailure||flags.foreign)assert.ok(!test.calls.includes('activate'),'do not activate an unverified worker');
}
await assert.rejects(fetchStudioUpdateTarget(async()=>new Response('{}')),/VERSION_UNCONFIRMED/);
await assert.rejects(fetchStudioUpdateTarget(async()=>new Response('',{status:503})),/VERSION_UNAVAILABLE/);
assert.deepEqual(await fetchStudioUpdateTarget(async(url,options)=>{assert.equal(options.cache,'no-store');return Response.json(target);}),target);
await prepareStudioUpdate(target,{serviceWorker:undefined});
await prepareStudioUpdate(target,{serviceWorker:{getRegistration:async()=>undefined}});
console.log('PASS update core: build-specific fetch, old worker/controller/shell rejection, failed installation, foreign registration, metadata errors, and no-registration path');
