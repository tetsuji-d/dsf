import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production async check against delayed responses and a minimal
// DOM. In particular, a retry must never flash content previously denied.
const source=readFileSync(new URL('../js/viewer-embed.js',import.meta.url),'utf8');
const start=source.indexOf('async function checkAccess() {');
const end=source.indexOf('export function updateEmbedControls',start);
assert.ok(start>=0&&end>start);
const classes=new Set(),visibility=[],queue=[];
let calls=0,reloads=0,panel=null;
const node=tag=>({tag,children:[],textContent:'',setAttribute(){},append(...items){this.children.push(...items);},remove(){if(this===panel)panel=null;}});
const context=vm.createContext({
    reading:true,checkBusy:false,revision:1,unavailable:false,normalUrl:'/viewer?edition=test',
    document:{body:{classList:{add(name){classes.add(name);visibility.push(true);},toggle(name,value){value?classes.add(name):classes.delete(name);visibility.push(value);}},append(value){panel=value;}},
        createElement:node,querySelector(selector){return selector==='#embed-unavailable'?panel:panel?.children.find(n=>n.tag==='p');}},
    location:{reload(){reloads++;}},t:j=>j,unavailableMessage:error=>String(error.status||'connection'),bindReaderLink(){},
    access(){calls++;return new Promise((resolve,reject)=>queue.push({resolve,reject}));}
});
vm.runInContext(source.slice(start,end)+';globalThis.runCheck=checkAccess;',context);
const hidden=()=>classes.has('embed-checking');

let pending=context.runCheck();
assert.equal(hidden(),false,'pending background request keeps content visible');
await context.runCheck();assert.equal(calls,1,'overlapping checks coalesce');
queue.shift().resolve({revision:1});await pending;
assert.equal(hidden(),false);assert.equal(reloads,0);
assert.equal(visibility.includes(true),false,'successful refresh must not flash hidden');

for(const status of [403,404,undefined]){
    pending=context.runCheck();assert.equal(hidden(),false);
    queue.shift().reject(Object.assign(new Error('unavailable'),{status}));await pending;
    assert.equal(hidden(),true);assert.ok(panel,'failure presents retry notice');
    pending=context.runCheck();assert.equal(hidden(),true,'retry stays fail-closed while pending');
    queue.shift().resolve({revision:1});await pending;
    assert.equal(hidden(),false);assert.equal(panel,null,'successful retry restores the page');
}
pending=context.runCheck();queue.shift().reject(new Error('offline'));await pending;
pending=context.runCheck();queue.shift().reject(new Error('still offline'));await pending;
assert.equal(hidden(),true,'repeated failures never reveal content');
pending=context.runCheck();queue.shift().resolve({revision:2});await pending;
assert.equal(reloads,1);assert.equal(hidden(),true,'changed policy stays hidden for document reload');
assert.equal(context.checkBusy,false);
console.log('Delayed refresh without flicker, concurrency, denied/offline fail-closed, retry and changed-policy reload passed.');
