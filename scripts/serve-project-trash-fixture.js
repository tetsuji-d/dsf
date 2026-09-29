import {createServer} from 'vite';
import {maintenanceFixture,scope,root} from './fixtures/private-authoring-maintenance-fixture.js';
import {createProjectTrashService,createProjectTrashApi} from '../server/project-trash.js';
const f=maintenanceFixture();
f.set(root,{...f.get(root),projectName:'ゴミ箱テスト原稿',title:'公開を維持する作品'});
const api=createProjectTrashApi({verifyToken:async token=>{if(token!=='fixture')throw Error('fixture token only');return {uid:scope.uid};},service:createProjectTrashService({db:f.db,assertLiveIdentity:async()=>{},now:f.time})});
const server=await createServer({server:{host:'127.0.0.1',port:5274,strictPort:true},plugins:[{name:'trash-local-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(req.url==='/api/test-trash-list'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({projects:[{id:scope.projectId,...f.get(root)}],published:!!f.get('public_projects/work_1'),sourceIntact:!!f.get(root+'/authoring/current')}));return;}
 if(req.url!=='/api/project-trash')return next();
 try {const chunks=[];for await(const c of req)chunks.push(c);const r=await api({env:{PUBLISHING_SPACES_ENABLED:'true'},request:new Request('http://127.0.0.1:5274/api/project-trash',{method:req.method,headers:req.headers,body:Buffer.concat(chunks)})});res.statusCode=r.status;r.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await r.text());}catch(e){res.statusCode=500;res.end(JSON.stringify({error:'FIXTURE_FAILED'}));}
 });}}]});
await server.listen();console.log('Trash fixture: http://127.0.0.1:5274/scripts/fixtures/project-trash.html');
