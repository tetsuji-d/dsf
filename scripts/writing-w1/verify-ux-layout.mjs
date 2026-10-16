import assert from 'node:assert/strict';
import {writingChromeLayout,writingInspectorPlacement,writingTextPan} from '../../js/reader-writing-layout.js';
import {writingHitTest} from '../../js/reader-writing-hit.js';

const fixtures=[[320,568],[390,844],[768,1024],[820,1180],[812,390],[844,390],[900,700],[1440,900],[1920,1080]];
for(const [width,height] of fixtures){
 for(const safe of [{left:0,right:0,top:0,bottom:0},{left:44,right:44,top:47,bottom:34}]){
  const a=writingChromeLayout({width,height,safe});
  assert.equal(a.mode,a.totalWidth>width-Math.max(8,safe.left,safe.right)*2?'scroll':'full');assert.ok(a.size>=44);
  const r=a.rail;assert.ok(r.left>=safe.left&&r.top>=safe.top&&r.left+r.width<=width-safe.right&&r.top+r.height<=height-safe.bottom);
  assert.equal(a.tools.columns,6);assert.ok(a.history.left+a.history.width<a.tools.left);assert.ok(a.tools.left+a.tools.width<a.pens.left);
  assert.equal(a.history.top+22,a.tools.top+26,'Action and drawing tools share one baseline');
  for(const item of [a.history,a.tools,a.pens])assert.ok(item.left>=0&&item.left+item.width<=a.trackWidth&&item.top+item.height<=r.height);
  assert.equal(a.totalWidth,a.trackWidth+300,'Six Reader controls and Writing occupy the same row');
  assert.equal(r.top+r.height,height-Math.max(8,safe.bottom),'Only one bottom row is reserved');
  if(width>=1200)assert.equal(a.mode,'full','Wide desktop shows all Reader and Writing controls together');
  for(const panel of ['layers','history','settings']){
   const anchor={left:r.left+a.history.left,top:r.top+a.history.top,width:44,right:r.left+a.history.left+44,bottom:r.top+a.history.top+44};
   const pos=writingInspectorPlacement({width,height,anchor,panel});
   assert.ok(pos.top>=8&&pos.top+pos.height<=height-8);assert.ok(pos.left>=8&&pos.left+pos.width<=width-8);
  }
 }
}
const ellipse={type:'shape',shape:'ellipse',rect:[40,50,240,180],width:2,fill:null};
for(const width of [320,390,844])for(const height of [340,480,844])for(const y of [20,240,600]){
 const box={left:width/2-80,top:y,width:160,height:100},viewport={left:0,top:0,width,height};
 const pan=writingTextPan({box,viewport,toolbarBottom:116});
 assert.ok(box.left+pan.x>=20&&box.left+pan.x+box.width<=width-20);
 assert.ok(box.top+pan.y>=140&&box.top+pan.y+box.height<=height-24,'Text box must stay between the compact bar and keyboard');
}
// Split-pane resizing can move a former top history trigger to the bottom.
// Settings must keep a useful scroll area after their heading and action footer.
for(const [width,height,offsetLeft,offsetTop] of [[673,833,0,0],[740,920,0,0],[390,844,0,0],[844,390,0,0],[390,360,0,220],[740,920,20,30]]){
 for(const y of [64,height-260,height-120]){
  const anchor={left:offsetLeft+100,top:offsetTop+y,right:offsetLeft+144,bottom:offsetTop+y+44,width:44};
  const r=writingInspectorPlacement({width,height,offsetLeft,offsetTop,anchor});
  assert.ok(r.height>=Math.min(560,height-16),`Settings squeezed at ${width}x${height}, trigger y=${y}`);
  assert.ok(r.top>=offsetTop+8&&r.top+r.height<=offsetTop+height-8,'Settings fit the visible viewport vertically');
  assert.ok(r.left>=offsetLeft+8&&r.left+r.width<=offsetLeft+width-8,'Settings fit the visible viewport horizontally');
 }
}
assert.equal(writingHitTest(ellipse,{x:160,y:140}),false,'A hollow ellipse cannot intercept an object inside');
assert.equal(writingHitTest(ellipse,{x:160,y:50}),true);
assert.equal(writingHitTest({...ellipse,fill:'#fff'},{x:160,y:140}),true);
assert.equal(writingHitTest({...ellipse,shape:'rect'},{x:160,y:140}),false);
assert.equal(writingHitTest({...ellipse,shape:'rect'},{x:40,y:140}),true);
const line={type:'line',from:[10,10],to:[100,100],width:2,arrow:'both'};
assert.equal(writingHitTest(line,{x:10,y:100}),false);assert.equal(writingHitTest(line,{x:55,y:55}),true);
const stroke={type:'stroke',tool:'pen',points:[{x:30,y:120,width:2},{x:260,y:150,width:2}]};
assert.equal(writingHitTest(stroke,{x:160,y:137}),true);assert.equal(writingHitTest(stroke,{x:30,y:150}),false);
const marker={...stroke,tool:'highlighter',points:[{x:30,y:120,width:20},{x:260,y:120,width:20}]};
assert.equal(writingHitTest(marker,{x:100,y:129},0),true);assert.equal(writingHitTest(marker,{x:20,y:120},0),false);
console.log('9 bottom-dock viewport layouts and safe insets: all desktop tools, mobile scroll bounds, single-row Reader integration, aligned controls and inspector bounds passed; hollow/filled shapes, diagonal ink and marker hit tests passed.');
