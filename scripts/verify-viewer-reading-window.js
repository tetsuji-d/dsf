import assert from 'node:assert/strict';
import {buildReadingWindows} from '../js/viewer-reading-window.js';
const glyphs=Array.from({length:30},(_,i)=>({start:i*10,end:(i+1)*10}));
const windows=buildReadingWindows(glyphs,100);
assert.deepEqual(windows,[{start:0,end:100},{start:80,end:180},{start:160,end:260},{start:240,end:300}]);
for(let i=1;i<windows.length;i++) assert.equal(windows[i-1].end-windows[i].start,20);
assert.deepEqual(buildReadingWindows(glyphs,400),[{start:0,end:300}]);
assert.equal(buildReadingWindows([],100).length,1);
const tiny=buildReadingWindows(glyphs,5);assert.equal(tiny.length,30);assert(tiny.every(w=>w.end>w.start));
const text='We read the letter in the morning.';
const english=Array.from(text,(c,i)=>({start:i*10,end:(i+1)*10,space:c===' '}));
const parts=buildReadingWindows(english,120,{wordOverlap:true});
assert(parts.length>1);assert.equal(parts.at(-1).end,text.length*10);
for(const w of parts){const index=w.start/10;assert(index===0||text[index-1]===' ');}
assert.equal(buildReadingWindows(glyphs,35,{wordOverlap:true}).at(-1).end,300,'Long words fall back to glyphs');
console.log('Reading windows: exact overlap, whole-word overlap, line endpoints, short lines and small windows passed');
