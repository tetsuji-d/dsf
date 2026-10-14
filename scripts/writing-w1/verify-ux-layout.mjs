import assert from 'node:assert/strict';
import {writingChromeLayout,writingInspectorPlacement} from '../../js/reader-writing-layout.js';
import {writingHitTest} from '../../js/reader-writing-hit.js';

const fixtures=[
 [320,568,2,3,316,562,'compact'],[390,844,3,80,385,684,'compact'],
 [768,1024,97,0,575,1022,'inline'],[820,1180,78,1,663,1179,'inline'],
 [812,390,297,0,218,388,'compact'],[844,390,313,0,218,388,'compact'],[1440,900,467,1,504,896,'inline'],[1920,1080,657,1,605,1076,'side'],
];
for(const [width,height,x,y,w,h,mode] of fixtures){
 const paper={left:x,top:y,right:x+w,bottom:y+h,width:w,height:h};
 const controls=width<600?[{left:30,top:height-54,right:width-30,bottom:height-10,width:width-60,height:44}]:[{left:paper.right+12,top:height/2-147,right:paper.right+56,bottom:height/2+147,width:44,height:294}];
 const a=writingChromeLayout({width,height,paper,controls});assert.equal(a.mode,mode,`${width}x${height}`);assert.ok(a.size>=44);
 for(const r of [a.pens,a.tools,a.context]){assert.ok(r.left>=0&&r.top>=0&&r.left+r.width<=width+.1&&r.top+r.height<=height,JSON.stringify(r));
  for(const c of controls)assert.ok(r.left+r.width<=c.left||r.left>=c.right||r.top+r.height<=c.top||r.top>=c.bottom,`Writing/Reader collision ${width}x${height}`);}
 assert.ok(a.history.left>=0&&a.history.left+a.history.width<=width&&a.history.top+a.history.height<=height);
 assert.equal(a.tools.columns,6,'The drawing-tool order must not wrap when the viewport changes');
 assert.ok(a.pens.left>=50,'Top-edge pens must leave the Reader menu clear');
 if(a.mode==='side')for(const r of [a.pens,a.tools,a.context]){
  assert.ok(r.left+r.width<paper.left,'Side tools must leave the paper clear');
  assert.equal(r.left+r.width/2,a.pens.left+a.pens.width/2,'One center axis for all dock groups');
 }
 if(width>=1440){assert.ok(a.history.left+a.history.width<a.tools.left,'Wide screen history belongs left of the drawing tools');assert.equal(a.history.top+22,a.tools.top+26);}
 for(const panel of ['layers','history']){const r=writingInspectorPlacement({width,height,anchor:{...a.history,right:a.history.left+a.history.width,bottom:a.history.top+a.history.height},panel});assert.ok(r.height>=Math.min(600,height-16),'Lists need usable height even from a bottom trigger');assert.ok(r.top>=8&&r.top+r.height<=height-8);assert.ok(r.left>=8&&r.left+r.width<=width-8);}
 const header={left:width-(width<600?108:162),top:15,right:width-12,bottom:57,width:width<600?96:150,height:42};
 const withHeader=writingChromeLayout({width,height,paper,controls,header});
 for(const r of [withHeader.pens,withHeader.tools,withHeader.context]){
  assert.ok(r.left+r.width<=header.left||r.left>=header.right||r.top+r.height<=header.top||r.top>=header.bottom,`Reader header collision ${width}x${height}`);
 }
}
const ellipse={type:'shape',shape:'ellipse',rect:[40,50,240,180],width:2,fill:null};
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
const low=writingChromeLayout({width:844,height:390,paper:{left:313,right:531,top:0,bottom:388},controls:[{left:313,right:531,top:354,bottom:388,width:218,height:34}]});
assert.ok(low.history.top+low.history.height<354,'History must not overlap the Reader page-segment scrubber');
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
console.log('8 viewport layouts: minimum pen size, Reader/header collisions, menu clearance, single-row tools, shared dock axis, context/history bounds passed; hollow/filled shapes, diagonal ink and marker hit tests passed.');
