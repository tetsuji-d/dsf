import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),here=fileURLToPath(new URL('./',import.meta.url)),assets=path.join(root,'outputs/writing-w0');
let blocked=false,blockedRequests=0;
const routes=new Map([['/',path.join(here,'index.html')],...['app.mjs','fixtures.mjs','worker.js','sw.js','subsetter.mjs'].map(n=>['/'+n,path.join(here,n)])]);
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.woff2':'font/woff2','.txt':'text/plain'};
async function moduleTree(file) {
    const url='/'+path.relative(root,file).split(path.sep).join('/');if(routes.has(url))return;routes.set(url,file);
    const text=await readFile(file,'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await moduleTree(path.resolve(path.dirname(file),match[1]));
}
await moduleTree(path.join(root,'js/dsf-writing-contract.js'));
for(const entry of JSON.parse(await readFile(path.join(assets,'assets.json'),'utf8')))routes.set(entry.url,path.join(assets,entry.url.slice('/assets/'.length)));
routes.set('/assets/assets.json',path.join(assets,'assets.json'));
const server=http.createServer(async(req,res)=>{
    try {
        const url=new URL(req.url,'http://127.0.0.1:5192');
        if(req.headers.host!=='127.0.0.1:5192'){res.writeHead(403);res.end();return;}
        const localOrigin=req.headers.origin==='http://127.0.0.1:5192';
        if(req.method==='POST'&&url.pathname==='/record') {
            if(!localOrigin){res.writeHead(403);res.end();return;}let text='';for await(const chunk of req){text+=chunk;if(text.length>1024*1024)throw new Error('Report too big');}
            const report=JSON.parse(text);const dir=path.join(assets,'results');await mkdir(dir,{recursive:true});
            const filename=`browser-${Date.now()}.json`;await writeFile(path.join(dir,filename),JSON.stringify({...report,serverEvidence:{blocked,blockedRequests}},null,2));res.end(filename);return;
        }
        // Fault injection is restricted to this loopback fixture and changes no OS networking.
        if(req.method==='POST'&&url.pathname==='/block') {if(!localOrigin){res.writeHead(403);res.end();return;}blocked=true;blockedRequests=0;res.end('blocked');return;}
        if(blocked){blockedRequests++;res.writeHead(503);res.end('W0 fixture network disabled');return;}
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        if(url.pathname==='/cache-list') {const list=[];for(const [url,file] of routes){const b=await readFile(file);list.push({url,sha256:createHash('sha256').update(b).digest('hex')});}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(list));return;}
        const file=routes.get(url.pathname);if(!file){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.setHeader('Cache-Control','no-store');
        res.setHeader('X-Content-Type-Options','nosniff');res.end(await readFile(file));
    }catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(5192,'127.0.0.1',()=>console.log('W0 fixture http://127.0.0.1:5192/ (loopback only)'));
