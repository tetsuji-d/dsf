import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadConfigFromFile} from 'vite';
const config=async()=> (await loadConfigFromFile({mode:'production',command:'build'})).config;
import {writingStagingAssets,writingStagingPlugin} from './staging-assets.mjs';
const oldRelease=process.env.DSF_WRITING_RELEASE,oldPreview=process.env.DSF_WRITING_PREVIEW;
try{
 delete process.env.DSF_WRITING_RELEASE;process.env.DSF_WRITING_PREVIEW='1';
 assert.equal(writingStagingPlugin('production'),null);
 assert.equal((await config()).define.__WRITING_ENABLED__,'false');
 process.env.DSF_WRITING_RELEASE='1';
 assert.ok(writingStagingPlugin('production'));
 assert.equal((await config()).define.__WRITING_ENABLED__,'true');
 delete process.env.DSF_WRITING_PREVIEW;
 assert.equal(writingStagingPlugin('staging'),null);
 const files=await writingStagingAssets({production:true});
 const html=files.get('writing/index.html').toString();
 assert.ok(!html.includes('ステージング確認版'));
 assert.ok(!files.get('writing/reader-writing.mjs').toString().includes('record-file'));
 assert.ok([...files.keys()].every(p=>p.startsWith('writing/')&&!/browser-saved|fixture|secrets|outputs/.test(p)));
 const list=JSON.parse(files.get('writing/cache-list.json'));
 for(const item of list){const path=item.url==='/writing/'?'writing/index.html':item.url.slice(1);assert.equal(createHash('sha256').update(files.get(path)).digest('hex'),item.sha256);}
 console.log('PASS production explicit opt-in, preview separation, allowlisted assets, no fixture writer, '+list.length+' cache hashes.');
}finally{for(const [key,value] of [['DSF_WRITING_RELEASE',oldRelease],['DSF_WRITING_PREVIEW',oldPreview]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
