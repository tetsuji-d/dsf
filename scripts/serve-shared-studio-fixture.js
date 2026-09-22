import {createAuthoringService} from '../server/private-authoring/service.js';
import {createAuthoringApi} from '../server/private-authoring/http.js';
import {createProjectActions} from '../server/private-authoring/actions.js';
// Local-only harness: real studio.html/app.js; only identity and cloud transports are fixtures.
import {createServer as createViteServer} from 'vite';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {attachSharedEditorFixture} from './fixtures/shared-editor-fixture.js';
import {createFlowGroupBlock} from '../js/flow-project-model.js';
import {createSharedAuthoringService} from '../server/shared-authoring.js';
import {createAuthoringBucket} from '../server/private-authoring/r2.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
let clockOffset=0;
const port=Number(process.env.PORT||5210),f=invitationsFixture(),shared=await attachSharedEditorFixture(f,{now:()=>Date.now()+clockOffset});
for(const [uid,role]of [['reader_1','editor'],['reader_2','viewer']])f.docs.set(`users/${uid}/spaceMemberships/space_demo`,{uid,spaceId:'space_demo',status:'active',role:'member',grants:[{role,scope:'work',targetId:'work_library'}]});
const service=createSharedAuthoringService({db:f.db,bucket:createAuthoringBucket(shared.r2),assertLiveIdentity:f.assertLiveIdentity,spaceId:'space_demo',workId:'work_library'});
const identity={uid:'owner_1'},context=await service.access(identity,'book_library');
const source=JSON.parse(new TextDecoder().decode((await service.load(identity,'book_library',context)).bytes));
source.blocks=[createFlowGroupBlock({id:'flow_shared',sourceLanguage:'ja',document:{schemaVersion:2,id:'document_shared',sections:[{id:'chapter_shared',blocks:[{id:'paragraph_shared',type:'paragraph',texts:{ja:'港の図書館に、灯台から一通の手紙が届いた。司書は封を開き、静かに読み始めた。'}}]}]}})];delete source.sections;delete source.pages;
const head=f.docs.get('users/owner_1/projects/book_library/authoringHeads/current');
await service.save(identity,'book_library',{snapshot:await createPrivateAuthoringSnapshot(source),generationId:head.generationId,baseRevision:head.revision,requestId:'studio_flow_seed'});
let publicWrites=0,personalWrites=0;
const ownerService=createAuthoringService({db:f.db,bucket:createAuthoringBucket(shared.r2),assertLiveIdentity:f.assertLiveIdentity});
const ownerActions=createProjectActions({db:f.db,bucket:createAuthoringBucket(shared.r2),service:ownerService,assertLiveIdentity:f.assertLiveIdentity,publicBaseUrl:'https://media.example.invalid',verifyRelease:async()=>{throw Error('Fixture must not publish');}});
const ownerHandler=createAuthoringApi({service:ownerService,actions:ownerActions,verifyToken:async token=>token==='fixture-owner_1'?{uid:'owner_1'}:null});
const stubs={
core:`const uid=new URLSearchParams(location.search).get('actor')==='viewer'?'reader_2':new URLSearchParams(location.search).get('actor')==='second'?'admin_1':new URLSearchParams(location.search).get('actor')==='owner'?'owner_1':'reader_1';export const db={},storage={},firebaseConfig={};export const auth={currentUser:{uid,email:uid+'@example.invalid',displayName:uid,getIdToken:async()=>'fixture-'+uid}};export const authReady=Promise.resolve();`,
gis:`import {auth} from '/js/firebase-core.js'; export const initGIS=async()=>{};export const renderGISButton=()=>{};export const signInWithGoogle=async()=>({user:auth.currentUser});export const signOutUser=async()=>{auth.currentUser=null;};export const onAuthChanged=cb=>{setTimeout(()=>cb(auth.currentUser),0);return()=>{}};export const handleRedirectResult=async()=>null;`,
auth:`export const onAuthStateChanged=()=>()=>{};export const getIdToken=u=>u.getIdToken();`,
firestore:`export const doc=(db,...p)=>p.join('/'),collection=doc,serverTimestamp=()=>new Date(),query=(...p)=>p,where=(...p)=>p,limit=x=>x,orderBy=x=>x,documentId=()=>'',startAfter=x=>x;
export async function getDoc(path){const r=await fetch('/fixture/doc?path='+encodeURIComponent(path));const data=await r.json();return {exists:()=>data!==null,data:()=>data};}
export const getDocFromServer=getDoc;export const getDocs=async()=>({docs:[],empty:true,size:0,forEach(){}}),getDocsFromServer=getDocs;
export async function setDoc(path,data){const r=await fetch('/fixture/write',{method:'POST',body:JSON.stringify({path,data})});if(!r.ok)throw Error('Direct project write forbidden');}
export const updateDoc=setDoc,deleteDoc=setDoc,addDoc=setDoc;export const writeBatch=()=>({set:setDoc,delete:setDoc,commit:async()=>{throw Error('Personal batch forbidden')}});export const runTransaction=()=>{throw Error('Personal transaction forbidden')};`,
storage:`export const ref=()=>{};export const uploadBytes=()=>{throw Error('Public upload forbidden')};export const getDownloadURL=()=>{throw Error('Public upload forbidden')};`
};
const vite=await createViteServer({configFile:false,envFile:false,server:{host:'127.0.0.1',port,strictPort:true},define:{'import.meta.env.VITE_SHARED_STUDIO_ENABLED':'"true"','import.meta.env.VITE_STORAGE_BACKEND':'"r2"','import.meta.env.VITE_R2_PUBLIC_URL':'"https://media.example.invalid"','__APP_ENV__':'"test"'},plugins:[{name:'shared-studio-local-only',enforce:'pre',
transformIndexHtml(html){return html.replace('src="js/app.js"','src="/scripts/fixtures/shared-studio-browser.js"');},
transform(code,id){if(!id.endsWith('.js'))return;return code.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(firestore|auth|storage)\.js/g,'/fixture-sdk/$1.js');},
resolveId(id){if(id.startsWith('/fixture-sdk/'))return '\0fixture-'+id.split('/').pop().replace('.js','');if(id.endsWith('/firebase-core.js')||id==='./firebase-core.js')return '\0fixture-core';if(id.endsWith('/gis-auth.js')||id==='./gis-auth.js')return '\0fixture-gis';if(id.startsWith('https://www.gstatic.com/firebasejs/'))return '\0fixture-'+(id.includes('firestore')?'firestore':id.includes('auth')?'auth':'storage');},
load(id){if(id.startsWith('\0fixture-'))return stubs[id.slice(9)];},
configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);return res.end();}
 if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/fixture/')&&url.pathname!='/upload')return next();
 if(req.headers.origin&&req.headers.origin!==url.origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);return res.end();}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>25*1024*1024){res.writeHead(413);return res.end();}chunks.push(chunk);}const bytes=Buffer.concat(chunks);
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/fixture/doc')return res.end(JSON.stringify(f.docs.get(url.searchParams.get('path'))??null));
 if(url.pathname==='/fixture/write'){const {path}=JSON.parse(bytes);if(!/^users\/(reader_1|reader_2|admin_1|owner_1)$/.test(path)){personalWrites++;res.statusCode=403;}return res.end('{}');}
 if(url.pathname==='/fixture/advance'&&req.method==='POST'){clockOffset+=Math.max(0,Number(JSON.parse(bytes).ms)||0);return res.end('{}');}
 if(url.pathname==='/fixture/status')return res.end(JSON.stringify({head:f.docs.get('users/owner_1/projects/book_library/authoringHeads/current'),publicWrites,personalWrites,participantProject:f.docs.has('users/reader_1/projects/book_library')}));
 if(url.pathname==='/fixture/role'&&req.method==='POST'){const {role}=JSON.parse(bytes),m=f.docs.get('users/reader_1/spaceMemberships/space_demo');if(role==='revoked')m.status='revoked';else {m.status='active';m.grants[0].role=role;}return res.end('{}');}
 if(url.pathname==='/upload'){publicWrites++;res.statusCode=403;return res.end('{}');}
 const ownerRoute=/^\/api\/projects\/(book_library)\/(authoring|actions)$/.exec(url.pathname);
 if(ownerRoute){const response=await ownerHandler({env:{AUTHORING_API_ENABLED:'true',AUTHORING_TEST_PROJECTS:'["owner_1/book_library"]'},params:{projectId:ownerRoute[1],actionRoute:ownerRoute[2]==='actions'},request:new Request(url,{method:req.method,headers:req.headers,...(['PUT','POST'].includes(req.method)?{body:bytes}:{})})});res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));}
 if(url.pathname.startsWith('/api/spaces/')){const response=await shared.handler({env:{SHARED_AUTHORING_ENABLED:'true'},request:new Request(url,{method:req.method,headers:req.headers,...(['PUT','POST'].includes(req.method)?{body:bytes}:{})})});res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));}
 res.statusCode=404;res.end('{}');
 }catch(error){console.error(error);res.statusCode=500;res.end('{}');}});}
}]});
await vite.listen();console.log(`Shared Studio: http://127.0.0.1:${port}/studio.html?room=editor&sharedSpace=space_demo&sharedWork=work_library`);
