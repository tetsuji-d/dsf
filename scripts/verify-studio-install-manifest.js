import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {studioPwaPlugin} from './studio-pwa-plugin.js';
const original=JSON.parse(readFileSync('public/studio.webmanifest'));
for(const mode of ['production','staging']){
 const plugin=studioPwaPlugin(),assets=new Map();
 plugin.configResolved({mode});
 plugin.generateBundle.call({emitFile:a=>assets.set(a.fileName,a.source)}, {}, {'studio.html':{source:'studio'},'viewer.html':{source:'viewer'}});
 const manifest=JSON.parse(assets.get('studio.webmanifest'));
 const build=JSON.parse(assets.get('studio-version.json'));
 assert.ok(plugin.transformIndexHtml('<html><head></head></html>').includes('name="dsf-studio-build" content="'+build.id+'"'));
 assert.ok(assets.get('studio-update-core.js').includes('prepareStudioUpdate'),'recovery page shares the updater');
 assert.equal(manifest.id,original.id,'updates retain installed identity');
 assert.equal(manifest.name,mode==='production'?'DSF Studio':'DSF Studio (staging)');
 assert.deepEqual(manifest.file_handlers,original.file_handlers);
 assert.equal(manifest.launch_handler.client_mode,'navigate-new');
 for(const [i,ext] of ['dsp','dsf'].entries()){
  const handler=manifest.file_handlers[i];
  assert.ok(handler.name);assert.equal(handler.launch_type,'multiple-clients');
  assert.equal(handler.action,ext==='dsp'?'/studio?room=home&fileLaunch=dsp':'/viewer?fileLaunch=dsf');
  for(const icon of handler.icons){
   const bytes=readFileSync('public'+icon.src),size=Number(icon.sizes.split('x')[0]);
   assert.equal(bytes.subarray(1,4).toString(),'PNG');
   assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
   assert.ok(assets.get('studio-sw.js').includes(icon.src),'offline shell contains every file icon');
  }
 }
}
console.log('PASS install manifest: stable identities, separate names, safe routes, PNG dimensions, offline resources');
