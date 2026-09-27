import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
// Isolated screen fixture. Uses the actual Viewer review functions, no cloud connection.
const source = await readFile(new URL('../js/viewer.js', import.meta.url), 'utf8');
const first = source.indexOf('function createReviewUiState()'), last = source.indexOf('function getMetricSessionId()', first);
if (first < 0 || last < 0) throw Error('Viewer review functions not found');
const strings = {};
for (const match of source.matchAll(/        (review\w+): '((?:[^'\\]|\\.)*)'/g)) {
    if (!(match[1] in strings)) strings[match[1]] = JSON.parse('"' + match[2].replaceAll('"','\\"') + '"');
}
const prefix = `import { reviewWorkIsPublic, reviewReactionCounts } from '/js/review-client.js';
const translations = ${JSON.stringify(strings)};
const vt=(key,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),translations[key]||key);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={uid:'reader',user:{uid:'reader',displayName:'読者A'}};
let viewerProjectMeta={source:'shared',workId:'fixture',authorUid:'author',projectId:'project',releaseId:'release',dsfStatus:'public',publication:{publicFrom:new Date(Date.now()-60000),listedUntil:new Date(Date.now()+3600000),publicUntil:null,expiredAt:null,expireReason:null}};
let reviewUiState=createReviewUiState(),reviewGeneration=0,publicNow=true,delayLoad=false,failNext=false;
let stored=[{reviewId:'first',readerName:'別の読者',body:'検証用レビュー',status:'published',goodCount:0,badCount:0,createdAt:{toMillis:()=>1}}];
const votes=new Map();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ensureUserBootstrap=async()=>{await pause(100);return {publicProfile:{displayName:state.user.displayName}}};
const ensurePublic=()=>{if(!publicNow)throw Object.assign(Error('unavailable'),{code:'review-unavailable'});if(failNext){failNext=false;throw Object.assign(Error('denied'),{code:'permission-denied'});}};
const reviewClient={
 async load(context){const rows=stored.map(r=>({...r,userReaction:votes.get(context.uid+':'+r.reviewId)||''}));await pause(delayLoad?1800:100);ensurePublic();return rows;},
 async submit(context,{body,readerName}){await pause(250);ensurePublic();const id='post-'+Date.now();stored.push({reviewId:id,body,readerName,status:'published',goodCount:0,badCount:0,createdAt:{toMillis:()=>Date.now()}});return id;},
 async react(context,id,requested){await pause(250);ensurePublic();const r=stored.find(r=>r.reviewId===id),key=context.uid+':'+id,old=votes.get(key)||'',next=old===requested?'':requested;Object.assign(r,reviewReactionCounts(r,old,next));votes.set(key,next);return {goodCount:r.goodCount,badCount:r.badCount,userReaction:next};}
};
const shouldShowViewerInfoBody=()=>true;
const renderViewerInfoPanel=()=>renderViewerReviewSection();
`;
const suffix = `
document.getElementById('redraw').onclick=()=>renderViewerInfoPanel();
document.getElementById('login').onclick=()=>{state.uid=state.uid?'':'reader';state.user=state.uid?{uid:'reader',displayName:'読者A'}:null;resetReviewUiState();void loadViewerReviews();};
document.getElementById('switch').onclick=()=>{state.uid=state.uid==='reader'?'other':'reader';state.user={uid:state.uid,displayName:state.uid==='reader'?'読者A':'読者B'};resetReviewUiState();void loadViewerReviews();};
document.getElementById('withdraw').onclick=()=>{publicNow=!publicNow;document.getElementById('publication').textContent=publicNow?'サーバー側：公開中':'サーバー側：非公開';};
document.getElementById('fail').onclick=()=>{failNext=true;document.getElementById('publication').textContent='次の操作を拒否';};
document.getElementById('delayed').onclick=()=>{delayLoad=true;void loadViewerReviews();delayLoad=false;};
void loadViewerReviews();`;
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DSF レビュー操作検証</title><link rel="stylesheet" href="/css/viewer.css"><style>body{position:static;overflow:auto;display:block;padding:24px;background:#f5f5f5;color:#222;font:16px sans-serif}main{max-width:640px;margin:auto}.controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}button{cursor:pointer}#viewer-info-reviews{background:white;padding:20px;border-radius:12px}.viewer-review-field{color:#222}.material-icons{font-size:12px}textarea{color:#222!important}</style><main><h1>レビュー操作検証</h1><p>ローカル検証用。画面の処理はViewer本体から読み込み。投稿先はこの画面内の仮データです。</p><div class="controls"><button id="redraw">再描画</button><button id="login">ログイン／ログアウト</button><button id="switch">別の読者に切替</button><button id="withdraw">サーバーの公開状態を切替</button><button id="fail">次の操作を拒否</button><button id="delayed">遅い読み込みを開始</button></div><p id="publication">サーバー側：公開中</p><section id="viewer-info-review-section"><h2>レビュー</h2><div id="viewer-info-reviews"></div></section></main><script type="module" src="/fixture.js"></script></html>`;
const files = new Map([['/js/review-client.js','js/review-client.js'],['/js/publication.js','js/publication.js'],['/css/viewer.css','css/viewer.css']]);
createServer(async (req,res) => {
    const path = new URL(req.url,'http://127.0.0.1:5197').pathname;
    res.setHeader('Cache-Control','no-store');
    if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
    else if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(prefix+source.slice(first,last)+suffix);}
    else if(files.has(path)){res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('../'+files.get(path),import.meta.url)));}
    else{res.writeHead(404);res.end();}
}).listen(5197,'127.0.0.1',()=>console.log('Review UI fixture http://127.0.0.1:5197'));
