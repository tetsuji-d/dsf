import { fixture, SAMPLE_TEXT, SECRET_TEXT } from './fixtures.mjs';
import { validateWritingEnvelope, collectFontText, sharedCopy } from '/js/dsf-writing-contract.js';
const status=document.querySelector('#status'),result=document.querySelector('#result'),samples=document.querySelector('#samples');
const manifest=await (await fetch('/assets/assets.json')).json();let report;const activeFonts=[];
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function checked(url) {const asset=manifest.find(x=>x.url===url);if(!asset)throw new Error('Asset not pinned');const b=await (await fetch(url)).arrayBuffer();if(await hash(b)!==asset.sha256)throw new Error('Asset mismatch');return new Uint8Array(b);}
document.querySelector('#prepare').onclick=async()=>{
    try{status.textContent='オフライン資源を準備中';await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready;
        const channel=new MessageChannel();const done=new Promise((resolve,reject)=>{channel.port1.onmessage=e=>e.data.ok?resolve(e.data):reject(new Error(e.data.error));});
        registration.active.postMessage({type:'prepare'},[channel.port2]);const ready=await done;status.textContent=`オフライン準備済み：${ready.count}資源。再読み込み後も検証できます。`;
    }catch(e){status.textContent=e.message;}
};
function runWorker(input) {return new Promise((resolve,reject)=>{const worker=new Worker('/worker.js');const timeout=setTimeout(()=>{worker.terminate();reject(new Error('WASM_TIMEOUT'));},60000);
    worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();e.data.ok?resolve(e.data):reject(new Error(e.data.error));};worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(new Error(e.message));};worker.postMessage(input,[input.font.buffer]);});}
document.querySelector('#run').onclick=async()=>{
    const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);samples.replaceChildren();report=null;activeFonts.splice(0).forEach(f=>document.fonts.delete(f));
    try {
        const f=await fixture();validateWritingEnvelope(f.original,f.context);validateWritingEnvelope(f.editable,f.context);
        const shared=sharedCopy(f.editable,f.context,'shared1'),current=collectFontText(shared,f.context),history=collectFontText(f.editable,f.context);
        const catalog=JSON.parse(new TextDecoder().decode(await checked('/assets/catalog.json')));
        report={date:new Date().toISOString(),userAgent:navigator.userAgent,navigatorOnlineAtStart:navigator.onLine,serviceWorkerControlled:!!navigator.serviceWorker.controller,baseHash:f.base.sha256,
            contracts:{original:true,editable:true,shared:true,secretRemoved:!JSON.stringify(shared).includes(SECRET_TEXT)},fonts:[]};
        for(const [i,c] of catalog.entries()) {
            status.textContent=`${c.family}：Worker内で生成・比較中`;
            const full=await checked(`/assets/fonts/${c.id}.woff2`);
            const groups={current:current[c.id],history:history[c.id],probe:SAMPLE_TEXT+' か\u3099'};
            const samplesFor = envelope => (envelope.history?.revisions.map(r=>r.pages) || [envelope.document.pages])
                .flatMap(pages=>pages.flatMap(p=>p.objects.filter(o=>o.type==='text').flatMap(o=>o.runs.filter(r=>r.fontId===c.id).map(r=>o.text.slice(r.start,r.end)))));
            const shapeSamples={current:samplesFor(shared),history:samplesFor(f.editable),probe:[groups.probe]};
            const output=await runWorker({font:full.slice(),sha256:c.asset.sha256,groups,shapeSamples});
            const original=new FontFace(`W0Full${i}`,full,{weight:'100 900'});await original.load();document.fonts.add(original);activeFonts.push(original);
            const sub=output.results.find(r=>r.name==='probe');const derived=new FontFace(`W0Subset${i}`,sub.bytes,{weight:'100 900'});await derived.load();document.fonts.add(derived);activeFonts.push(derived);
            const comparisons=[];
            for(const weight of [400,700]) for(const vertical of [false,true]) {
                const article=document.createElement('article'),title=document.createElement('h2');title.textContent=`${c.family} ${weight} ${vertical?'縦書き':'横書き'}`;article.append(title);
                const pair=document.createElement('div');pair.className='pair';const spans=[];
                for(const [label,family] of [['元フォント',original.family],['サブセット',derived.family]]) {
                    const column=document.createElement('div'),caption=document.createElement('p'),span=document.createElement('div');caption.textContent=label;caption.className='caption';
                    span.className=`sample${vertical?' vertical':''}`;span.style.fontFamily=family;span.style.fontWeight=weight;span.textContent=SAMPLE_TEXT+' か\u3099';column.append(caption,span);pair.append(column);spans.push(span);
                }article.append(pair);samples.append(article);await document.fonts.ready;
                const boxes=spans.map(span=>[...span.firstChild.textContent].map((_,index)=>{const r=document.createRange();r.setStart(span.firstChild,index);r.setEnd(span.firstChild,index+1);const b=r.getBoundingClientRect(),p=span.getBoundingClientRect();return [b.x-p.x,b.y-p.y,b.width,b.height].map(x=>Math.round(x*1000)/1000);}));
                const maxDelta=Math.max(...boxes[0].flatMap((b,i)=>b.map((v,j)=>Math.abs(v-boxes[1][i][j]))));
                // DOM layout quantizes each absolute origin to 1/64 CSS pixel.
                const same=maxDelta<=1/64+0.001;if(!same)throw new Error(`BROWSER_RANGE_MISMATCH ${weight} ${vertical} delta=${maxDelta} ${JSON.stringify(boxes[0].map((b,i)=>({i,a:b,b:boxes[1][i]})).filter(p=>JSON.stringify(p.a)!==JSON.stringify(p.b)).slice(0,3))}`);comparisons.push({weight,vertical,equal:true,maxDeltaCssPx:maxDelta,toleranceCssPx:1/64+0.001});
            }
            // Bytes stay in browser only. Report exposes measurements, not font payloads.
            report.fonts.push({id:c.id,sourceBytes:c.asset.byteLength,missingRejected:output.missingRejected,historyPruned:output.historyPruned,
                ms:output.ms,wasmLinearBytes:output.wasmLinearBytes,measurement:output.measurement,sourceNames:output.sourceNames,
                results:output.results.map(({bytes,...r})=>r),browserComparisons:comparisons});
        }
        report.ok=report.fonts.every(f=>f.missingRejected&&f.historyPruned)&&report.contracts.secretRemoved;
        status.textContent=report.ok?'検証成功：2書体・横縦・400/700・履歴除去・不足字形拒否':'検証失敗';
        result.textContent=JSON.stringify({...report,fonts:report.fonts.map(({sourceNames,results,...f})=>({...f,results:results.map(({cmap,names,axes,text,...r})=>r)}))},null,2);
    }catch(e){status.textContent='検証失敗';result.textContent=e.stack;report=null;}
    finally{buttons.forEach(b=>b.disabled=false);document.querySelector('#save').disabled=!report?.ok;}
};
document.querySelector('#save').onclick=async()=>{const r=await fetch('/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});status.textContent=r.ok?'検証結果をローカル保存しました':'記録失敗';};
