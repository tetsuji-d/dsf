// Local review server; the synthetic DSF is never added to the release directory.
import {preview} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('outputs/production-candidate'),m=JSON.parse(readFileSync(join(out,'source-manifest.json'),'utf8'));
assert(m.snapshot.startsWith(out));
const sample=readFileSync('outputs/file-launch/sample.dsf');
const server=await preview({root:m.snapshot,configFile:join(m.snapshot,'vite.config.js'),preview:{host:'127.0.0.1',port:5295,strictPort:true},plugins:[{
 name:'local-candidate-sample',configurePreviewServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/__verification/sample.dsf')return next();
  res.setHeader('Content-Type','application/zip');res.setHeader('Cache-Control','no-store');res.end(sample);
 });}
}]});
server.printUrls();
