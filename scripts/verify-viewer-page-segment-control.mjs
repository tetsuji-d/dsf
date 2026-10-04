import assert from 'node:assert/strict';
import {compactPageGroups} from '../js/viewer-page-segment-control.js';
for(const total of [1,2,18,242,1002]){
 const groups=[[0]];for(let i=1;i<total-1;i+=2)groups.push([i,i+1].filter(x=>x<total-1));if(total>1)groups.push([total-1]);
 for(const current of [0,Math.floor(total/2),total-1])for(const max of [8,18,36]){
  const out=compactPageGroups(groups,current,max);
  assert.deepEqual(out.flatMap(t=>t.gap?Array.from({length:t.count},(_,i)=>t.from+i):t.pages),Array.from({length:total},(_,i)=>i));
  assert.deepEqual(out[0].pages,groups[0]);assert.deepEqual(out.at(-1).pages,groups.at(-1));
  assert.ok(out.some(t=>t.pages?.includes(current)));
  for(const item of out.filter(t=>t.pages))assert.ok(groups.some(g=>JSON.stringify(g)===JSON.stringify(item.pages)),'never split a spread');
 }
}
console.log('Compact segments keep whole spreads, both covers and every source page exactly once.');
