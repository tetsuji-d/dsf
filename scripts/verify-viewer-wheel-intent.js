import assert from 'node:assert/strict';
import {createViewerBookWheel} from '../js/viewer-book-wheel.js';
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.body={};document.documentElement={};globalThis.innerHeight=900;
globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);globalThis.cancelAnimationFrame=clearTimeout;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function harness(){let blocked=false;const actions=[],target={closest:selector=>selector.includes('#viewer-layout')?target:null};const wheel=createViewerBookWheel({enabled:()=>true,busy:()=>blocked,begin:()=>false,progress(){},finish(){},step:direction=>actions.push(direction),horizontal:side=>actions.push(side)});return {actions,wheel,block:v=>blocked=v,send(x,y){assert.ok(wheel.handle({deltaMode:0,deltaX:x,deltaY:y,target,preventDefault(){}}));}};}
{
 const h=harness();h.send(24,-36);await sleep(240);assert.deepEqual(h.actions,['up'],'short diagonal stroke');h.wheel.cancel();
}
{
 const h=harness();h.block(true);h.send(0,36);await sleep(250);assert.deepEqual(h.actions,[]);h.block(false);await sleep(40);assert.deepEqual(h.actions,['down'],'input during an existing transition is deferred, not discarded');h.wheel.cancel();
}
{
 const h=harness();for(const dx of [40,20,8,3,2,1]){h.send(dx,0);await sleep(40);}assert.deepEqual(h.actions,['right'],'momentum remains one action');h.send(40,0);await sleep(240);assert.deepEqual(h.actions,['right','right'],'new stroke interrupts the old tail');h.wheel.cancel();
}
{
 const h=harness();for(let i=0;i<8;i++){h.send(4,0);await sleep(10);}for(let i=0;i<6;i++){h.send(1,0);await sleep(35);}for(let i=0;i<8;i++){h.send(4,0);await sleep(10);}await sleep(240);assert.deepEqual(h.actions,['right','right'],'gentle second stroke also interrupts momentum');h.wheel.cancel();
}
{
 const h=harness();h.send(2,-4);await sleep(240);assert.deepEqual(h.actions,[],'jitter is ignored');h.block(true);h.send(36,0);await sleep(210);window.dispatchEvent(new Event('blur'));h.block(false);await sleep(40);assert.deepEqual(h.actions,[],'blur cancels queued intent');h.wheel.cancel();
}
{
 const actions=[],target={closest:s=>s.includes('#viewer-layout')?target:null};let p=0;
 const wheel=createViewerBookWheel({enabled:()=>true,busy:()=>false,begin:()=>false,progress(){},finish(){},step:s=>actions.push(s),horizontal:s=>actions.push(s),
   beginHorizontal:s=>{actions.push(['begin',s]);return true;},progressHorizontal:v=>{p=v;},finishHorizontal:a=>actions.push(['finish',a])});
 const send=(x,y=0)=>wheel.handle({deltaMode:0,deltaX:x,deltaY:y,timeStamp:performance.now(),target,preventDefault(){}});
 send(60);assert.equal(p,.25);await sleep(350);assert.equal(wheel.active,true);assert.deepEqual(actions,[['begin','right']],'silence holds the page');
 send(60);assert.equal(p,.5);send(-90);assert.equal(p,.125);send(-30);assert.equal(p,0);assert.deepEqual(actions.at(-1),['finish',false]);
 await sleep(220);send(-120);send(-120);assert.equal(p,1);assert.deepEqual(actions.at(-1),['finish',true]);
 for(const x of [-8,-4,-2])send(x);await sleep(220);assert.equal(actions.filter(a=>Array.isArray(a)&&a[0]==='begin').length,2,'tail cannot turn another page');
 send(60);window.dispatchEvent(new Event('blur'));assert.deepEqual(actions.at(-1),['finish',false]);assert.equal(wheel.active,false);
 send(60);send(0,-40);await sleep(220);assert.deepEqual(actions.slice(-2),[['finish',false],'up'],'axis change cancels held page before pose navigation');wheel.cancel();
}
console.log('Trackpad ownership, held/reversed horizontal progress, momentum and cancellation passed');
