// Local-only regression harness. Uses the production Firebase 10.7.1 SDK and
// firebase-core.js against Auth Emulator; never uses a real account/project.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

const env={VITE_FIREBASE_API_KEY:'demo-dsf-auth-key',VITE_FIREBASE_PROJECT_ID:'demo-dsf-auth',
    VITE_FIREBASE_AUTH_DOMAIN:'demo-dsf-auth.firebaseapp.com',VITE_FIREBASE_APP_ID:'demo-app',
    VITE_FIREBASE_STORAGE_BUCKET:'demo-dsf-auth.appspot.com'};
const legacyCore=`import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
const app=initializeApp({apiKey:'demo-dsf-auth-key',projectId:'demo-dsf-auth',authDomain:'demo-dsf-auth.firebaseapp.com'});
export const auth=getAuth(app);
export const authReady=setPersistence(auth,browserLocalPersistence);`;
const bundles={};
for(const mode of ['fixed','legacy']){
    const bundle=await build({entryPoints:['scripts/fixtures/auth-persistence-browser.js'],bundle:true,write:false,
        format:'esm',platform:'browser',external:['https://*'],define:{'import.meta.env':JSON.stringify(env)},
        plugins:mode==='legacy'?[{name:'previous-auth-initialization',setup(b){
            b.onLoad({filter:/[\\/]firebase-core\.js$/},()=>({contents:legacyCore,loader:'js'}));
        }}]:[]});
    bundles[mode]=bundle.outputFiles[0].text;
}
const html=await readFile(new URL('./fixtures/auth-persistence-browser.html',import.meta.url),'utf8');
createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:8798');
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/bundle.js'){
        res.setHeader('Content-Type','text/javascript');
        return res.end(bundles[url.searchParams.get('mode')==='legacy'?'legacy':'fixed']);
    }
    if(url.pathname!=='/'){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(html.replace('MODE',url.searchParams.get('mode')==='legacy'?'legacy':'fixed'));
}).listen(8798,'127.0.0.1',()=>console.log('Auth persistence fixture: http://127.0.0.1:8798/ (Auth Emulator required on 9098)'));
