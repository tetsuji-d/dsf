import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const dist=resolve(process.argv[2]||'dist');
const read=p=>readFileSync(resolve(dist,p),'utf8');
const expectedHash='8265f64786397d6b832d1ca0aafdf149ad84e72759fffa9f7272e91a0fb015d1';
let fontPath;
for(const entry of ['index.html','studio.html','viewer.html','mypage.html','admin/index.html']){
 const html=read(entry);
 assert(!html.includes('icon?family=Material+Icons'),entry+': external icon stylesheet');
 const cssPaths=[...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m=>m[1]);
 const css=cssPaths.map(p=>read(p.replace(/^\//,''))).join('\n');
 const face=css.match(/@font-face\{[^}]*font-family:["']?Material Icons["']?;[^}]*\}/);
 assert(face,entry+': missing bundled icon font');
 const url=face[0].match(/url\(["']?([^)'"\s]+\.woff2)["']?\)/)?.[1];
 assert(url?.startsWith('/assets/'),entry+': font must be a local versioned build asset');
 fontPath=url;
 const bytes=readFileSync(resolve(dist,url.slice(1)));
 assert.equal(bytes.subarray(0,4).toString(),'wOF2');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHash);
}
for(const worker of ['studio-sw.js','platform-sw.js','viewer-sw.js']){
 const source=read(worker);
 assert(source.includes(fontPath),worker+': missing offline icon font');
 assert(!source.includes('icon?family=Material+Icons'),worker+': external icon dependency remains');
}
assert(existsSync(resolve(dist,'licenses/material-icons.txt')),'Missing deployed licence');
assert(read('licenses/material-icons.txt').includes('Apache License'));
console.log('PASS: all 5 entrypoints bundle the exact UI font; all 3 workers cache it; licence is deployed.');
