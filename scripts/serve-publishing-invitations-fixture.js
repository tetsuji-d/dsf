import {attachSharedEditorFixture} from './fixtures/shared-editor-fixture.js';
import {createServer} from 'node:http';
import {loadEnv} from 'vite';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
const port=Number(process.env.PORT||5200),data=new URL('../outputs/invitation-fixture-'+port+'.json',import.meta.url);
await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
const ephemeral=process.env.INVITATION_FIXTURE_EPHEMERAL==='true';
let initialDocs;if(!ephemeral)try{initialDocs=JSON.parse(await readFile(data,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const fixture=invitationsFixture({initialDocs,persist:async docs=>{if(ephemeral)return;const temp=new URL(data.href+'.tmp');await writeFile(temp,JSON.stringify(docs));await rename(temp,data);}});
const imageData=new URL('../outputs/invitation-private-objects-'+port+'.json',import.meta.url);
let initialObjects=[];if(!ephemeral)try{initialObjects=JSON.parse(await readFile(imageData,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const shared=await attachSharedEditorFixture(fixture,{initialObjects,persistObjects:async objects=>{if(ephemeral)return;const temp=new URL(imageData.href+'.tmp');await writeFile(temp,JSON.stringify(objects));await rename(temp,imageData);}});
if(process.env.INVITATION_FIXTURE_EMPTY_SPACE==='true')fixture.docs.delete('publishing_space_catalogues/space_demo');
const files=new Map([['/scripts/fixtures/joined-spaces-ui.js','scripts/fixtures/joined-spaces-ui.js'],['/css/home-workspace.css','css/home-workspace.css'],['/css/publishing-spaces.css','css/publishing-spaces.css'],['/css/variables.css','css/variables.css'],['/copy','scripts/fixtures/project-copy-ui.html'],['/css/studio.css','css/studio.css'],['/settings','scripts/fixtures/space-members-settings.html'],['/css/space-members-settings.css','css/space-members-settings.css'],['/','scripts/fixtures/publishing-invitations-ui.html'],['/scripts/fixtures/shared-editor-ui.js','scripts/fixtures/shared-editor-ui.js'],['/js/publishing-invitations-ui.js','js/publishing-invitations-ui.js'],['/css/publishing-invitations.css','css/publishing-invitations.css'],['/scripts/fixtures/publishing-invitations-ui.js','scripts/fixtures/publishing-invitations-ui.js']]);
createServer(async(req,res)=>{try{
    const origin='http://127.0.0.1:'+port,url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
    if(url.pathname==='/joined'){
        const html=(await readFile(new URL('../studio.html',import.meta.url),'utf8')).replace('data-booting="true"','').replace('<script type="module" src="js/app.js"></script>','<script type="module" src="/scripts/fixtures/joined-spaces-ui.js"></script>').replace('</head>','<link rel="stylesheet" href="/css/publishing-spaces.css"><link rel="stylesheet" href="/css/home-workspace.css"></head>');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(html);return;
    }
    if(url.pathname==='/api/invitations'||url.pathname.startsWith('/api/spaces/')){
        if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
        if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(url.pathname==='/api/invitations'?16384:25*1024*1024)){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        const response=await (url.pathname==='/api/invitations'?fixture.handler:shared.handler)({env:{...fixture.env,SHARED_AUTHORING_ENABLED:'true'},request:new Request(url,{method:req.method,headers:req.headers,...(['POST','PUT'].includes(req.method)?{body:Buffer.concat(chunks)}:{})})});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const path=files.get(url.pathname)||(/^\/js\/[a-z0-9-]+\.js$/.test(url.pathname)?url.pathname.slice(1):null);if(!path){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',(path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript')+'; charset=utf-8');res.setHeader('Cache-Control','no-store');const source=await readFile(new URL('../'+path,import.meta.url));res.end(path==='js/studio-rollout.js'?source.toString().replace('import.meta.env',JSON.stringify(loadEnv('staging',process.cwd(),'VITE_'))):source);
}catch(e){console.error(e);res.writeHead(500);res.end('Fixture unavailable');}}).listen(port,'127.0.0.1',()=>console.log('Invitation fixture: http://127.0.0.1:'+port));
