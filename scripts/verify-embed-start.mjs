import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/viewer-embed.js',import.meta.url),'utf8');
const start=source.slice(source.indexOf('    async function start(action){'),source.indexOf("    button.onclick=()=>start"));
const finish=source.slice(source.indexOf('    finishStart=({ready,begin})=>{'),source.indexOf('    initialControls();await load();await started;'));
function fixture(){
 const events=[],pending=[];
 const ctx=vm.createContext({display:{startPage:4},embedView:"book",starting:false,loaded:true,intent:null,revision:1,reading:false,finishStart:null,
 button:{},gate:{setAttribute(){},removeAttribute(){},remove(){events.push('remove-cover');}},
 status:{},heading:{},bar:{},progress:{},firstKey(){},checkAccess(){},
 observer:{disconnect(){}},initialBar:{destroy(){events.push('dispose-initial-bar');}},
 initialControls(){},load(){},resolveStart(){events.push('load-reader');},
 access(){return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
 location:{reload(){events.push('reload');}},t:ja=>ja,unavailableMessage:()=> 'retry',
 window:{removeEventListener(){}},document:{body:{classList:{remove(){}}},addEventListener(){}},
 toggleEmbedControls(){events.push('show-controls');},setInterval(){},
 });
 vm.runInContext(start+finish+';globalThis.start=start;',ctx);return {ctx,events,pending};
}
for(const action of [{type:'open'},{type:'step',delta:1},{type:'seek',index:7}]){
 const {ctx,events,pending}=fixture();const promise=ctx.start(action);await ctx.start({type:'seek',index:9});
 assert.equal(pending.length,1,'repeated gestures do not start a second load');
 assert.equal(events.length,0,'cover survives pending authorization');
 pending[0].resolve({revision:1});await promise;
 assert.deepEqual(events,['dispose-initial-bar','load-reader'],'cover survives actual body/font loading');
 const moves=[];ctx.finishStart({ready:true,begin:args=>moves.push(JSON.parse(JSON.stringify(args)))});
 assert.deepEqual(moves,[{page:4,intent:action,view:'book'}]);
 assert.equal(ctx.finishStart,null,'intent is consumed once');assert.ok(events.includes('remove-cover'));
}
{
 const {ctx,pending,events}=fixture();const p=ctx.start({type:'step',delta:1});pending[0].reject(new Error());await p;
 assert.equal(ctx.starting,false);assert.equal(ctx.intent,null);assert.equal(events.length,0);
 const retry=ctx.start({type:'seek',index:4});pending[1].resolve({revision:1});await retry;
 ctx.finishStart({ready:false,begin(){assert.fail('failed load must not navigate');}});
 assert.equal(ctx.bar.hidden,true);assert.ok(events.includes('remove-cover'),'existing Reader error and retry remain visible');
}
console.log('First intent survives delayed loading, duplicate input is gated, retry and failed-load handoff passed.');
