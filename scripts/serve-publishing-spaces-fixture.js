import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { publishingSpacesFixture } from './fixtures/publishing-spaces-fixture.js';
const f=publishingSpacesFixture(), port=Number(process.env.PORT || 5192);
const allowed=new Map([
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
