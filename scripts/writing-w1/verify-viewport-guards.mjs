import assert from 'node:assert/strict';
import {installWritingViewportGuards} from '../../js/reader-writing-bridge.js';
const handlers={};let active=false;
installWritingViewportGuards({addEventListener(type,fn,options){assert.equal(options.passive,false);handlers[type]=fn;}},()=>active);
function blocked(type,{dialog=false,touches=2,ctrlKey=true}={}){let prevented=false;handlers[type]({ctrlKey,touches:Array(touches),composedPath:()=>[{matches:()=>dialog}],preventDefault:()=>prevented=true});return prevented;}
for(const type of Object.keys(handlers))assert.equal(blocked(type),false,'Reader retains browser gestures');
active=true;for(const type of Object.keys(handlers)){assert.equal(blocked(type),true);assert.equal(blocked(type,{dialog:true}),false,'Dialog scrolling/zoom is unaffected');}
assert.equal(blocked('touchmove',{touches:1}),false);assert.equal(blocked('wheel',{ctrlKey:false}),false);
active=false;assert.equal(blocked('gesturechange'),false);
console.log('Writing gesture guards: active-only, multi-touch, ctrl-wheel, dialog and Reader exclusions passed.');
