import assert from 'node:assert/strict';
import { getBookThickness, getBookEdgeState, fitBookPageWidth, interpolateBookEdges } from '../js/book-volume.js';
const page = i => ({bookRole: `P${i}`, sourcePageIndex: i + 1});
const blank = {virtualBlank: true, bookRole: 'P5'};
const p = [1,2,3,4].map(page);
for (const rtl of [false,true]) {
    const spread = (a,b) => rtl ? {type:'spread', right:a, left:b} : {type:'spread',left:a,right:b};
    const units = [{type:'single',role:'C1'}, spread({bookRole:'C2'},p[0]),spread(p[1],p[2]),spread(p[3],{bookRole:'C3'}),{type:'single',role:'C4'}];
    const states = units.map((_,unitIndex)=>getBookEdgeState({units,unitIndex,bodyPageCount:4,rtl}));
    assert.deepEqual(states.map(s=>s.progress),[0,0,.5,1,1]);
    for (const state of states) assert.ok(Math.abs(state.left+state.right-state.thickness)<1e-8);
    assert.equal(states[0][rtl?'right':'left'],0);
    assert.equal(states.at(-1)[rtl?'left':'right'],0);
    const halfway = interpolateBookEdges(states[1],states[2],.5);
    assert.ok(Math.abs(halfway.left+halfway.right-halfway.thickness)<1e-8);
    const odd = [...units.slice(0,3),spread(p[3],blank),{type:'single',role:'C4'}];
    assert.equal(getBookEdgeState({units:odd,unitIndex:4,bodyPageCount:4,rtl}).progress,1);
}
assert.ok(getBookThickness(20)<getBookThickness(116));
assert.ok(getBookThickness(116)<getBookThickness(476));
assert.ok(getBookThickness(100000)<=64);
for (const w of [280,390,844,1440]) for(const h of [300,644,900]) for(const columns of [1,2]) {
    const t=getBookThickness(476),fit=fitBookPageWidth(w,h,columns,t);
    assert.ok(fit/360*(360*columns+t*.55*2)<=w+1e-8);
    assert.ok(fit/360*(640+t*.55*.3)<=h+1e-8);
}
console.log('Book volume: RTL/LTR, cover endpoints, same spread, virtual blank, conserved thickness, bounded fit passed.');
