import assert from 'node:assert/strict';
import {openEmbeddedReaderTab, bindEmbeddedReaderLink, canUseEmbeddedFullscreen, toggleEmbeddedFullscreen} from '../js/embed-reader-navigation.js';

const url='https://example.test/viewer?edition=test';
const calls=[];
const tab={opener:{},location:{replace(value){assert.equal(tab.opener,null);calls.push(['navigate',value]);}},close(){calls.push(['close']);}};
const host={parent:{},top:{},open(...args){calls.push(['open',...args]);return tab;}};
assert.equal(openEmbeddedReaderTab(url,host),true);
assert.deepEqual(calls,[['open','about:blank','_blank'],['navigate',url]]);
assert.equal(openEmbeddedReaderTab(url,{open:()=>null}),false);
assert.equal(openEmbeddedReaderTab(url,{open(){throw Error('blocked');}}),false);
for(const context of ['self','parent','top']){
    let replaced=false,closed=false;
    const current={location:{replace(){replaced=true;}},close(){closed=true;}};
    const blockedHost=context==='self'?current:{[context]:current};
    blockedHost.open=()=>current;
    assert.equal(openEmbeddedReaderTab(url,blockedHost),false);
    assert.equal(replaced,false);assert.equal(closed,false);
}
let closed=false;
assert.equal(openEmbeddedReaderTab(url,{open:()=>({set opener(v){throw Error('denied');},close(){closed=true;}})}),false);
assert.equal(closed,true);

let click,opened=0,blocked=0;
const link={href:url,addEventListener(type,handler){assert.equal(type,'click');click=handler;}};
bindEmbeddedReaderLink(link,{open:()=>{opened++;return false;},onBlocked:()=>blocked++});
const event=()=>({button:0,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
const plain=event();click(plain);
assert.equal(opened,1);assert.equal(blocked,1);assert.equal(plain.prevented,true);assert.equal(plain.stopped,true);
for(const extra of [{button:1},{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}]){
    const modified={...event(),...extra};click(modified);assert.equal(modified.prevented,undefined);
}
assert.equal(opened,1);

let notices=0,requested=0,exited=0;
assert.equal(canUseEmbeddedFullscreen({}),false);
assert.equal(canUseEmbeddedFullscreen({fullscreenEnabled:true,documentElement:{}}),false);
assert.equal(canUseEmbeddedFullscreen({fullscreenEnabled:false,documentElement:{requestFullscreen(){}}}),false);
assert.equal(canUseEmbeddedFullscreen({fullscreenEnabled:true,documentElement:{requestFullscreen(){}}}),true);
assert.equal(canUseEmbeddedFullscreen({fullscreenElement:{}}),true,'always allow exiting an active fullscreen');
const unavailable=()=>notices++;
await toggleEmbeddedFullscreen({documentElement:{}},unavailable);
assert.equal(notices,1);
await toggleEmbeddedFullscreen({fullscreenEnabled:false,documentElement:{requestFullscreen(){throw Error('should not call');}}},unavailable);
assert.equal(notices,2);
await toggleEmbeddedFullscreen({fullscreenEnabled:true,documentElement:{async requestFullscreen(){requested++;throw Error('not allowed');}}},unavailable);
assert.equal(notices,3);assert.equal(requested,1);
await toggleEmbeddedFullscreen({fullscreenEnabled:true,documentElement:{async requestFullscreen(){requested++;}}},unavailable);
assert.equal(notices,3);assert.equal(requested,2);
await toggleEmbeddedFullscreen({fullscreenElement:{},async exitFullscreen(){exited++;}},unavailable);
assert.equal(exited,1);assert.equal(notices,3);
console.log('Synchronous isolated tab, blocked/same-context safety, native modified clicks, fullscreen success/rejection and explicit fallback passed.');
