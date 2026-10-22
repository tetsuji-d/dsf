import assert from 'node:assert/strict';
import {createWritingDock,writingDockRelease} from '../js/reader-writing-input.js';
import {writingChromeLayout} from '../js/reader-writing-layout.js';
const pending=new Map();let serial=0,open=true,blocked=false;
const dock=createWritingDock({isOpen:()=>open,blocked:()=>blocked,setOpen:value=>open=value,
 schedule:(fn,ms)=>{assert.equal(ms,3000);pending.set(++serial,fn);return serial;},cancel:id=>pending.delete(id)});
const tick=()=>{const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn());};
dock.arm();dock.arm();assert.equal(pending.size,1);assert.equal(open,true);tick();assert.equal(open,false);
open=true;blocked=true;dock.arm();tick();assert.equal(open,true);assert.equal(pending.size,1);
blocked=false;dock.clear();tick();assert.equal(open,true);dock.arm();tick();assert.equal(open,false);
open=true;dock.arm();dock.dispose();tick();assert.equal(open,true);dock.arm();assert.equal(pending.size,0);
assert.equal(writingDockRelease(true,80,5),false);assert.equal(writingDockRelease(false,-80,5),true);
for(const open of [false,true]){assert.equal(writingDockRelease(open,4,2),open);assert.equal(writingDockRelease(open,30,80),open);}
for(const [width,height] of [[320,568],[390,844],[812,390],[1280,720],[1920,1080]]){
 const a=writingChromeLayout({width,height,penCount:6});
 assert.ok(a.dock.left>=0);assert.ok(a.dock.left+a.dock.width<=width);
 assert.equal(a.dock.left+a.dock.shift,width-16);
 assert.equal(a.rail.left,a.dock.left+32);
}
console.log('PASS: 3-second idle, blocked interaction, cancellation/disposal, handle direction, dock bounds');
