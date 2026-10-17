import {readFile} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildWritingImport,writingImportNotices} from './build-import.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const prefix='writing/';
// Explicit allowlist: never copy outputs/, private drafts, logs, or W0 test apps.
export async function writingStagingAssets(){
    const files=new Map();
    const put=(name,data)=>files.set(prefix+name,Buffer.from(data));
    const read=file=>readFile(resolve(root,file));
    const copy=async(name,file)=>put(name,await read(file));
    const scoped=text=>text.replace(/(['"`])\/(js\/|assets\/|notices\/|w0\/|catalog\.json|font-worker\.js|legacy-import\.mjs|reader-runtime\.mjs|sample\.dsfr?|sw\.js)/g,'$1/writing/$2');
    let html=(await read('scripts/writing-w1/writing.html')).toString().replaceAll('href="/writing.css"','href="/writing/writing.css"').replaceAll('src="/reader-writing.mjs"','src="/writing/reader-writing.mjs"');
    html=html.replace('開発プレビュー','ステージング確認版').replace('<head>','<head><meta name="robots" content="noindex,nofollow">').replace('<button id="record" disabled>','<button id="record" hidden disabled>');
    html=html.replace('<h2>保存</h2>','<h2>保存</h2><p id="writing-test-intro" class="subtle">この確認ページでは、ファイルと書き込みを端末内で扱います。まず「サンプルを開く」で試せます。</p>');
    html=html.replace('<details><summary>検証情報</summary>','<details><summary>試し方・書体ライセンス</summary><p>① サンプルを開く → 描く → 元に戻す。② 編集用DSFを作成し、ダウンロードしたファイルを「DSFを開く」から読み直す。③ オフライン準備の完了後、通信を切ってこのページを再読込し、端末内の下書きを開く。</p><p>Writing形式3の試作です。現行Pressの形式2は検証後に形式3のコピーとして開きます。元ファイルは上書きしません。さらに古い形式は対象外です。書き込みはクラウドへ同期されません。更新後の画面を使うときはオンラインでオフライン準備を実行し、再読込してください。</p><a href="./licenses.html">使用書体とライブラリのライセンス</a></details><details><summary>検証情報</summary>');
    put('index.html',html);await copy('writing.css','scripts/writing-w1/writing.css');await copy('native-writing.css','scripts/writing-w1/native-writing.css');
    let ui=scoped((await read('scripts/writing-w1/reader-writing.mjs')).toString());
    const record=/\$\('record'\)\.onclick=\(\)=>task\('検証フォルダーへの保存',[\s\S]*?\nlistenWindow\('keydown'/;
    if(!record.test(ui))throw Error('Writing record handler changed; review staging boundary');
    ui=ui.replace(record,"listenWindow('keydown'");
    put('reader-writing.mjs',ui);
    put('legacy-import.mjs',await buildWritingImport());
    put('licenses/import.txt',await writingImportNotices());
    let runtime=scoped((await read('scripts/writing-w1/reader-runtime.mjs')).toString());
    runtime=runtime.replace("await navigator.serviceWorker.register('/writing/sw.js'); const registration = await navigator.serviceWorker.ready, channel = new MessageChannel();",`const registration = await navigator.serviceWorker.register('/writing/sw.js',{scope:'/writing/'});
        await new Promise((resolve,reject)=>{
            if(registration.active?.state==='activated')return resolve();
            const worker=registration.installing||registration.waiting;
            if(!worker)return reject(new Error('OFFLINE_WORKER_UNAVAILABLE'));
            const timer=setTimeout(()=>reject(new Error('OFFLINE_PREPARE_TIMEOUT')),60000);
            worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}if(worker.state==='redundant'){clearTimeout(timer);reject(new Error('OFFLINE_WORKER_UNAVAILABLE'));}});
        }); const channel = new MessageChannel();`);
    if(runtime.includes('navigator.serviceWorker.ready'))throw Error('Writing worker registration changed');
    put('reader-runtime.mjs',runtime);
    put('font-worker.js',scoped((await read('scripts/writing-w1/font-worker.js')).toString()));
    await copy('w0/subsetter.mjs','scripts/writing-w0/subsetter.mjs');
    async function moduleTree(file){
        const name=relative(root,file).split(sep).join('/');if(!name.startsWith('js/')||name.includes('..'))throw Error('Writing module outside js');
        if(files.has(prefix+name))return;
        const text=(await readFile(file)).toString();put(name,text);
        for(const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await moduleTree(resolve(dirname(file),m[1]));
    }
    for(const name of ['dsf-writing-package.js','viewer-fixed-text.js','reader-writing-model.js','reader-writing-renderer.js','reader-writing-storage.js','reader-writing-tools.js','reader-writing-spread.js','reader-writing-page-gestures.js','reader-writing-layout.js','reader-writing-hit.js'])await moduleTree(resolve(root,'js',name));
    await moduleTree(resolve(root,'js','reader-writing-page-cache.js'));
    await moduleTree(resolve(root,'js','reader-writing-style-controls.js'));
    await moduleTree(resolve(root,'js','reader-writing-i18n.js'));
    await moduleTree(resolve(root,'js','reader-writing-contrast.js'));
    await moduleTree(resolve(root,'js','reader-writing-input.js'));
    await moduleTree(resolve(root,'js','reader-writing-file-save.js'));
    await moduleTree(resolve(root,'js','file-extensions.js'));
    const sample=await read('outputs/writing-w1/preview-sample.dsf');
    if(hash(sample)!=='5fdf726363255acdc0cfaa8cbcf5369252d50c84343771b2d99173f224acbfd8')throw Error('Only the reviewed synthetic eight-page sample may be published');
    put('sample.dsfr',sample);put('sample.dsf',sample); // Legacy sample URLs remain usable.
    const catalog=JSON.parse(await read('outputs/writing-w1/catalog.json'));
    put('catalog.json',JSON.stringify(catalog));
    const licenses=[['DSF取込ライブラリ','licenses/import.txt']];
    for(const c of catalog){
        const font=await read(`outputs/writing-w0/fonts/${c.id}.woff2`),notice=await read(`docs/writing-w0-licenses/${c.id}-asset.txt`);
        if(hash(font)!==c.asset.sha256||hash(notice)!==c.license.assetNoticeSha256)throw Error('Writing font integrity');
        put(`assets/fonts/${c.id}.woff2`,font);put(`notices/${c.id}.txt`,notice);licenses.push([c.family,`notices/${c.id}.txt`]);
    }
    const assets=JSON.parse(await read('outputs/writing-w0/assets.json'));
    const vendor=['harfbuzzjs/index.mjs','harfbuzzjs/harfbuzz.js','harfbuzzjs/harfbuzz.wasm','harfbuzzjs/harfbuzz-subset.wasm','harfbuzzjs-LICENSE','wawoff2/decompress_binding.js','wawoff2-LICENSE','woff2-encode-wasm/index.js','woff2-encode-wasm/encoder.wasm','woff2-encode-wasm-LICENSE'];
    for(const name of vendor){const url=`/assets/vendor/${name}`,bytes=await read(`outputs/writing-w0/vendor/${name}`);
        if(hash(bytes)!==assets.find(a=>a.url===url)?.sha256)throw Error('Writing vendor integrity');put(url.slice(1),bytes);
        if(name.endsWith('LICENSE'))licenses.push([name,`assets/vendor/${name}`]);}
    put('licenses.html',`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Writing ライセンス</title><h1>Writingの書体とライブラリ</h1><p>書体はSIL Open Font License 1.1。各配布物の条件は下記をご覧ください。</p><ul>${licenses.map(([name,url])=>`<li><a href="./${url}">${name}</a></li>`).join('')}</ul><p><a href="./">Writingに戻る</a></p></html>`);
    const worker=await read('scripts/writing-w1/staging-sw.js');
    const version=hash(Buffer.concat([worker,...[...files].sort(([a],[b])=>a.localeCompare(b)).flatMap(([name,b])=>[Buffer.from(name),b])])).slice(0,20);
    put('sw.js',worker.toString().replace('__WRITING_VERSION__',version));
    const list=[...files].map(([name,bytes])=>({url:name===prefix+'index.html'?'/writing/':'/'+name,sha256:hash(bytes),byteLength:bytes.length}));
    put('cache-list.json',JSON.stringify(list));put('build.json',JSON.stringify({version,scope:'/writing/',files:list.length,totalBytes:list.reduce((n,a)=>n+a.byteLength,0)}));
    return files;
}
export function writingStagingPlugin(mode){
    if(mode==='production'||process.env.DSF_WRITING_PREVIEW!=='1')return null;
    return {name:'writing-staging-preview',configureServer(server){
        let assets;
        server.watcher.on('change',path=>{if(/reader-writing|writing-w1/.test(path))assets=null;});
        server.middlewares.use(async(req,res,next)=>{
            const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/writing/'))return next();
            try{const files=await (assets||=writingStagingAssets()),name=path==='/writing/'?'writing/index.html':path.slice(1),bytes=files.get(name);
                if(!bytes){res.statusCode=404;return res.end();}
                const type=name.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(name)?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.wasm')?'application/wasm':name.endsWith('.woff2')?'font/woff2':'application/octet-stream';
                res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(bytes);
            }catch(error){next(error);}
        });
    },async generateBundle(){
        for(const [fileName,source] of await writingStagingAssets())this.emitFile({type:'asset',fileName,source});
        const headers=await readFile(resolve(root,'public/_headers'),'utf8');
        this.emitFile({type:'asset',fileName:'_headers',source:headers+'\n/writing/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Cache-Control: no-cache\n/writing/*.mjs\n  Content-Type: application/javascript\n/writing/sw.js\n  Service-Worker-Allowed: /writing/\n'});
    }};
}
