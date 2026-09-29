import {createServer} from 'vite';
import {maintenanceFixture} from './fixtures/private-authoring-maintenance-fixture.js';
import {createRecentActivityApi,createRecentActivityService} from '../server/recent-activity.js';
const f=maintenanceFixture();f.set('users/test_owner',{uid:'test_owner',status:{disabled:false}});
for(const id of ['p1','p2','p3'])f.set('users/test_owner/projects/'+id,{ownerUid:'test_owner',title:'Fixture '+id});
f.set('users/test_owner/publishing/catalogue',{spaceIds:['s1','s2'],assignments:{p1:'s1',p2:'s2'}});
const handler=createRecentActivityApi({verifyToken:async token=>{if(token!=='fixture')throw Error('fixture only');return {uid:'test_owner'};},service:createRecentActivityService({db:f.db,assertLiveIdentity:async()=>{}})});
const server=await createServer({server:{host:'127.0.0.1',port:5276,strictPort:true},plugins:[{name:'recent-history-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(req.url!=='/api/recent-activity')return next();try{const chunks=[];for await(const c of req)chunks.push(c);const response=await handler({request:new Request('http://127.0.0.1:5276/api/recent-activity',{method:req.method,headers:req.headers,body:Buffer.concat(chunks)})});res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());}catch{res.statusCode=500;res.end('{}');}
 });}}]});await server.listen();console.log('Isolated activity fixture http://127.0.0.1:5276/scripts/fixtures/recent-works.html');
