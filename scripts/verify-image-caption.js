import assert from 'node:assert/strict';
import {layoutImageCaption,validateImageCaption} from '../js/image-caption.js';
import {createGraphicObject,validateGraphicObjects} from '../js/graphic-object-model.js';
const o=createGraphicObject('image','image','ja',{assetId:'a'});o.frame={x:50,y:50,width:60,height:80,rotation:0};
const ctx={measureText:t=>({width:Array.from(t).length*10})};
for(const position of ['top','bottom','left','right']){
 o.caption={position,texts:{ja:'あいうえおかきくけこ\nさしすせそ',en:'A caption'},fontSize:10,gap:4,color:'#172c40',align:'center'};
 const c=layoutImageCaption(o,'ja','ja',ctx);assert.equal(c.lines.join(''),'あいうえおかきくけこさしすせそ');
 assert.equal(c.vertical,['left','right'].includes(position));assert.equal(c.lines.length,3);
 const smaller=structuredClone(o);smaller.frame.width=30;smaller.frame.height=40;
 assert.ok(layoutImageCaption(smaller,'ja','ja',ctx).lines.length>c.lines.length);
 assert.equal(smaller.caption.fontSize,o.caption.fontSize);
 assert.deepEqual(layoutImageCaption(o,'fr','en',ctx).lines.join(''),'A caption');
}
for(const change of [v=>v.caption.position='middle',v=>v.caption.texts='bad',v=>v.caption.fontSize=NaN,v=>v.caption.gap=-1]){const bad=structuredClone(o);change(bad);assert.throws(()=>validateImageCaption(bad));}
const bad=structuredClone(o);bad.members=[];assert.throws(()=>validateGraphicObjects({projectAssets:[{id:'a'}],blocks:[{kind:'page',content:{graphicObjects:[bad],objectOrder:['image']}}]}));
console.log('Caption four-side layout, manual breaks, resizing, language fallback and invalid data checks passed');
