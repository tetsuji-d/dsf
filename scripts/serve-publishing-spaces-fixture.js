import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { publishingSpacesFixture } from './fixtures/publishing-spaces-fixture.js';
const f=publishingSpacesFixture(), port=Number(process.env.PORT || 5192);
const allowed=new Map([
 ['/js/home-start.js',['js/home-start.js','text/javascript']],
 ['/js/project-copy-ui.js',['js/project-copy-ui.js','text/javascript']],
 ['/js/project-actions-ui.js',['js/project-actions-ui.js','text/javascript']],
 ['/js/account-json-request.js',['js/account-json-request.js','text/javascript']],
 ['/js/space-settings-navigation.js',['js/space-settings-navigation.js','text/javascript']],
 ['/members',['scripts/fixtures/publishing-space-members-ui.html','text/html']],
 ['/scripts/fixtures/publishing-space-members-ui.js',['scripts/fixtures/publishing-space-members-ui.js','text/javascript']],
 ['/js/publishing-space-members-ui.js',['js/publishing-space-members-ui.js','text/javascript']],
 ['/js/publishing-space-access.js',['js/publishing-space-access.js','text/javascript']],
 ['/css/publishing-space-members.css',['css/publishing-space-members.css','text/css']],
 ['/scripts/fixtures/home-workspace-ui.js',['scripts/fixtures/home-workspace-ui.js','text/javascript']],
 ['/js/home-workspace.js',['js/home-workspace.js','text/javascript']],
 ['/js/i18n-studio.js',['js/i18n-studio.js','text/javascript']],
 ['/css/home-workspace.css',['css/home-workspace.css','text/css']],
 ['/css/studio.css',['css/studio.css','text/css']],
 ['/css/variables.css',['css/variables.css','text/css']],
 ['/', ['scripts/fixtures/publishing-spaces-ui.html','text/html']],
 ['/scripts/fixtures/publishing-spaces-ui.html',['scripts/fixtures/publishing-spaces-ui.html','text/html']],
 ['/scripts/fixtures/publishing-spaces-ui.js',['scripts/fixtures/publishing-spaces-ui.js','text/javascript']],
 ['/js/publishing-space-create-dialog.js',['js/publishing-space-create-dialog.js','text/javascript']],
 ['/css/publishing-space-create-dialog.css',['css/publishing-space-create-dialog.css','text/css']],
 ['/js/publishing-space-publish-dialog.js',['js/publishing-space-publish-dialog.js','text/javascript']],
 ['/css/publishing-space-publish-dialog.css',['css/publishing-space-publish-dialog.css','text/css']],
 ['/js/publishing-spaces-ui.js',['js/publishing-spaces-ui.js','text/javascript']],
 ['/js/publishing-spaces-transport.js',['js/publishing-spaces-transport.js','text/javascript']],
 ['/js/publishing-space-image.js',['js/publishing-space-image.js','text/javascript']],
 ['/css/publishing-spaces.css',['css/publishing-spaces.css','text/css']],
]);
createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://127.0.0.1:'+port);
        if(url.pathname==='/workspace'){
            const html=(await readFile(new URL('../studio.html',import.meta.url),'utf8'))
                .replace('data-booting="true"','')
                .replace('<script type="module" src="js/app.js"></script>','<script type="module" src="/scripts/fixtures/home-workspace-ui.js"></script>')
                .replace('</head>','<link rel="stylesheet" href="/css/publishing-spaces.css"><link rel="stylesheet" href="/css/home-workspace.css"></head>');
            res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(html);return;
        }
        if(url.pathname==='/api/publishing-spaces'){
            const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>460800){res.writeHead(413);res.end();return;}parts.push(part);}
            const response=await f.handler({env:f.env,request:new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(parts)}:{})})});
            res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
        }
        if(url.pathname==='/fixture/proof'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([...f.docs]));return;}
        const file=allowed.get(url.pathname);if(!file){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',file[1]+'; charset=utf-8');res.setHeader('Cache-Control','no-store');
        res.end(await readFile(new URL('../'+file[0],import.meta.url)));
    }catch(error){console.error(error);res.writeHead(500);res.end('fixture error');}
}).listen(port,'127.0.0.1',()=>console.log('Publishing spaces fixture: http://127.0.0.1:'+port));
