import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildWritingImport} from './build-import.mjs';
const importBundle=await buildWritingImport();
const root=fileURLToPath(new URL('../../',import.meta.url)),routes=new Map(),cached=new Set();
const port=Number(process.argv[2]||5193),origin=`http://127.0.0.1:${port}`;
function route(url,file,cache=true){routes.set(url,path.join(root,file));if(cache)cached.add(url);}
for(const name of ['index.html','app.mjs','fixture.mjs','font-worker.js','sw.js'])route(name==='index.html'?'/':'/'+name,'scripts/writing-w1/'+name);
for(const name of ['writing.html','writing.css','reader-writing.mjs','reader-runtime.mjs'])route('/'+name,'scripts/writing-w1/'+name);
route('/sample.dsfr','outputs/writing-w1/preview-sample.dsf');
route('/sample.dsf','outputs/writing-w1/preview-sample.dsf');
route('/catalog.json','outputs/writing-w1/catalog.json');route('/w0/subsetter.mjs','scripts/writing-w0/subsetter.mjs');
async function moduleTree(file){const url='/'+path.relative(root,file).split(path.sep).join('/');if(routes.has(url))return;routes.set(url,file);cached.add(url);
    for(const match of (await readFile(file,'utf8')).matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await moduleTree(path.resolve(path.dirname(file),match[1]));}
await moduleTree(path.join(root,'js/reader-writing-contrast.js'));
for(const file of ['js/dsf-writing-package.js','js/viewer-fixed-text.js','js/reader-writing-model.js','js/reader-writing-renderer.js','js/reader-writing-storage.js','js/reader-writing-layout.js','js/reader-writing-hit.js','js/reader-writing-spread.js','js/reader-writing-page-gestures.js','scripts/writing-w1/fixture.mjs'])await moduleTree(path.join(root,file));
for(const a of JSON.parse(await readFile(path.join(root,'outputs/writing-w0/assets.json'),'utf8')))if(a.url.startsWith('/assets/vendor/'))route(a.url,'outputs/writing-w0/'+a.url.slice(8));
for(const c of JSON.parse(await readFile(path.join(root,'outputs/writing-w1/catalog.json'),'utf8'))){route(`/assets/fonts/${c.id}.woff2`,`outputs/writing-w0/fonts/${c.id}.woff2`,false);route(`/notices/${c.id}.txt`,`docs/writing-w0-licenses/${c.id}-asset.txt`,false);}
const types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.html':'text/html','.txt':'text/plain','.css':'text/css','.dsfr':'application/vnd.dsf.content+zip','.dsf':'application/vnd.dsf.content+zip'};
http.createServer(async(req,res)=>{try{
    if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}const url=new URL(req.url,origin);
    if(req.method==='POST'&&url.pathname==='/record-file'){
        if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw new Error('Fixture size exceeded');chunks.push(chunk);}const bytes=Buffer.concat(chunks),sha256=createHash('sha256').update(bytes).digest('hex');
        if(sha256!==req.headers['x-dsf-sha256']||bytes.readUInt32LE(0)!==0x04034b50)throw new Error('Fixture identity failed');
        const dir=path.join(root,'outputs/writing-w1/browser-saved');await mkdir(dir,{recursive:true});const file=`browser-${Date.now()}-${sha256.slice(0,12)}.dsfr`;
        await writeFile(path.join(dir,file),bytes,{flag:'wx'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({file:`outputs/writing-w1/browser-saved/${file}`,sha256,byteLength:size}));return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(url.pathname==='/legacy-import.mjs'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(importBundle);return;}
    if(url.pathname==='/cache-list'){const list=[{url:'/legacy-import.mjs',sha256:createHash('sha256').update(importBundle).digest('hex')}];for(const name of cached)list.push({url:name,sha256:createHash('sha256').update(await readFile(routes.get(name))).digest('hex')});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(list));return;}
    const file=routes.get(url.pathname);if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(await readFile(file));
}catch(e){res.writeHead(500);res.end(e.message);}}).listen(port,'127.0.0.1',()=>console.log(`Writing UI ${origin}/writing.html`));
