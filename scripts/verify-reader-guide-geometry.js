import assert from 'node:assert/strict';
import {calculateReadingGuideSegments as guides} from '../js/viewer-reading-guide-geometry.js';
const line={x:100,y:20,width:18,height:200,vertical:true};
assert.deepEqual(guides(line),[{x1:98.5,y1:20,x2:98.5,y2:220}]);
// Neighbouring column ruby crosses the guide: leave a clearance, do not move text.
const ruby={x:96,y:80,width:6,height:25};
const result=guides(line,[ruby]);assert.equal(result.length,2);
assert.ok(result[0].y2<80&&result[1].y1>105);
assert.deepEqual(guides(line,[{x:119,y:20,width:8,height:200}]),guides(line));
assert.deepEqual(guides(line,[{x:95,y:0,width:7,height:300}]),[]);
const horizontal={x:20,y:100,width:200,height:18,vertical:false};
assert.deepEqual(guides(horizontal),[{x1:20,y1:119.5,x2:220,y2:119.5}]);
const segments=guides(horizontal,[{x:80,y:118,width:20,height:8},{x:90,y:118,width:40,height:8}]);
assert.equal(segments.length,2);assert.ok(segments[0].x2<80&&segments[1].x1>130);
console.log('Left/bottom guide geometry, own ruby separation, adjacent ruby collision clearance, overlapping exclusions passed');
