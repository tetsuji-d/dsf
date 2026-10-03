import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
const server=await createServer({configFile:false,mode:'production',optimizeDeps:{entries:['scripts/fixtures/studio-rollout.js']},server:{host:'127.0.0.1',port:5293,strictPort:true},plugins:[{
    name:'studio-rollout-local-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
        if(new URL(req.url,'http://127.0.0.1:5293').pathname!=='/rollout')return next();
        const html=(await readFile(new URL('../studio.html',import.meta.url),'utf8'))
            .replace('data-booting="true"','')
            .replace('<script type="module" src="js/app.js"></script>','<script type="module" src="/scripts/fixtures/studio-rollout.js"></script>');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
        res.end(await vite.transformIndexHtml('/rollout',html));
    });}
}]});
await server.listen();console.log('Isolated rollout UI: http://127.0.0.1:5293/rollout');
