import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fixture } from './fixtures/private-authoring-api-fixture.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
const stubs = {
    core: `export const db={},storage={},firebaseConfig={},authReady=Promise.resolve(); export const auth={currentUser:{uid:'owner_1',email:'fixture@example.invalid',getIdToken:async()=> 'valid'}};`,
    firestore: `export const doc=(db,...parts)=>parts.join('/'); export const serverTimestamp=()=>new Date();
export async function getDoc(path){const r=await fetch('/fixture/doc?path='+encodeURIComponent(path));const data=await r.json();return {exists:()=>data!==null,data:()=>data};}
export async function setDoc(path,data){const r=await fetch('/fixture/write',{method:'POST',body:JSON.stringify({path,data})});if(!r.ok)throw Error('Unexpected direct project write');}
export const deleteDoc=()=>{throw Error('Unexpected delete')}; export const writeBatch=()=>({set(){throw Error('Unexpected Firestore batch')},commit(){throw Error('Unexpected Firestore batch')}});`,
    auth: `export const onAuthStateChanged=()=>()=>{};export const getIdToken=user=>user.getIdToken();`,
    storage: `export const ref=()=>{};export const uploadBytes=()=>{throw Error('Unexpected upload')};export const getDownloadURL=()=>{throw Error('Unexpected upload')};`,
};
const bundle = await build({ entryPoints: ['scripts/fixtures/private-authoring-studio-browser.js'], bundle: true, write: false,
    format: 'esm', platform: 'browser', define: { 'import.meta.env.VITE_STORAGE_BACKEND': '"r2"', 'import.meta.env.VITE_R2_PUBLIC_URL': '"https://media.test"' },
    plugins: [{ name: 'local-fixture-only', setup(b) {
        b.onResolve({ filter: /firebase-core\.js$/ }, () => ({ path: 'core', namespace: 'fixture' }));
        b.onResolve({ filter: /^https:\/\/www\.gstatic\.com\/firebasejs\// }, args => ({ path: /firebase-firestore/.test(args.path) ? 'firestore' : /firebase-auth/.test(args.path) ? 'auth' : 'storage', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }] });
const f = fixture();
f.project.blocks = [createFlowGroupBlock({ id: 'flow_1', sourceLanguage: 'ja', document: { schemaVersion: 2, id: 'doc_1', sections: [{ id: 'chapter', blocks: [{ id: 'paragraph', type: 'paragraph', texts: { ja: '試験原稿' } }] }] } })];
if ((await f.request()).status !== 200) throw Error('seed failed');
let mode = 'normal', requests = 0, directProjectWrites = 0;
const html = `<!doctype html><meta charset="utf-8"><title>Unit D Studio保存検証</title><style>body{font:16px sans-serif;margin:32px;max-width:950px}button{margin:5px;padding:10px}textarea{display:block;width:95%;height:160px}pre{background:#eee;padding:16px}</style><h1>Unit D Studio保存検証</h1><p>実際のStudio保存・読込モジュールを使用。接続先はローカル検証用です。</p><button id="load">クラウド版を開く</button><button id="large">10万字×4言語</button><button id="local">ローカル復元</button><textarea id="text" aria-label="原稿"></textarea><button id="save">保存</button><button id="restore">一つ前の原稿へ復元</button><button id="delete">プロジェクト削除</button><span id="save-status">未保存</span><p><button id="normal">通常通信</button><button id="lost">次の保存の応答を失う</button><button id="conflict">他の画面から更新</button><button id="delay">次の保存を3秒待機</button><button id="switch">別プロジェクトへ切替</button><button id="stats">結果を更新</button></p><p id="result"></p><pre id="evidence"></pre><script type="module" src="/bundle.js"></script>`;
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1:8797');
        const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
        if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].text); }
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/fixture/doc') return res.end(JSON.stringify(f.db.docs.get(url.searchParams.get('path')) ?? null));
        if (url.pathname === '/fixture/write') {
            const { path } = JSON.parse(body); if (path !== 'users/owner_1') { directProjectWrites++; res.statusCode = 403; } return res.end('{}');
        }
        if (url.pathname === '/fixture/status') return res.end(JSON.stringify({ revision: f.db.docs.get('users/owner_1/projects/project_1/authoringHeads/current')?.revision || 0, bytes: f.db.docs.get('users/owner_1/projects/project_1/authoringHeads/current')?.byteLength || 0, puts: f.r2.puts, apiRequests: requests, directProjectWrites }));
        if (url.pathname.startsWith('/fixture/mode/')) {
            mode = url.pathname.split('/').at(-1);
            if (mode === 'conflict') {
                const head = f.db.docs.get('users/owner_1/projects/project_1/authoringHeads/current');
                await f.request('PUT', { id: `other_${head.revision}`, base: head.revision, project: { ...f.project, title: `別の更新${head.revision}` } }); mode = 'normal';
            }
            return res.end('{}');
        }
        if (url.pathname.startsWith('/api/projects/project_1/')) {
            requests++;
            const currentMode = mode;
            if (req.method === 'PUT' && mode === 'delay') await new Promise(resolve => setTimeout(resolve, 3000));
            const response = await f.handler({ request: new Request(url, { method: req.method, headers: req.headers, ...(['PUT', 'POST'].includes(req.method) ? { body } : {}) }), env: f.env, params: { projectId: 'project_1', actionRoute: url.pathname.endsWith('/actions'), ...(url.pathname.includes('/operations/') ? { requestId: url.pathname.split('/').at(-1) } : {}) } });
            if (req.method === 'PUT' && currentMode === 'lost') { mode = 'normal'; res.statusCode = 503; res.end(JSON.stringify({ error: 'AUTHORING_UNAVAILABLE' })); return; }
            if (req.method === 'PUT' && currentMode === 'delay') mode = 'normal';
            res.writeHead(response.status, Object.fromEntries(response.headers)); return res.end(Buffer.from(await response.arrayBuffer()));
        }
        res.statusCode = 404; res.end('{}');
    } catch (error) { console.error(error); res.statusCode = 500; res.end('{}'); }
});
server.listen(8797, '127.0.0.1', () => console.log('Studio save fixture: http://127.0.0.1:8797 (local only)'));
