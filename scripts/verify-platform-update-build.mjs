import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('dist/studio-version.json','utf8'));
for(const entry of ['index.html','studio.html','viewer.html','mypage.html','admin/index.html']){
 const html=readFileSync('dist/'+entry,'utf8');assert.ok(html.includes('/platform-update-entry.js?build='+version.id),entry+' uses the shared update bootstrap');
}
for(const name of ['studio-sw.js','viewer-sw.js','platform-sw.js']){
 const worker=readFileSync('dist/'+name,'utf8');assert.ok(!/__STUDIO_/.test(worker),'worker placeholders must be resolved');
 for(const module of ['platform-update-entry.js','platform-update-core.js','studio-update-core.js'])assert.ok(worker.includes('/'+module+'?build='+version.id),'offline bootstrap is complete');
 assert.ok(worker.includes('const FULL_OFFLINE='+(name==='studio-sw.js'?'true':'false')));
}
assert.ok(readFileSync('dist/platform-update-core.js','utf8').includes('./studio-update-core.js?build='+version.id));
console.log('PASS platform packaging: all app entrypoints, legacy worker, offline bootstrap and full/ordinary cache modes.');
