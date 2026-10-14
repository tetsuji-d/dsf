import {createDsfV3Original,loadDsfV3,resaveDsfV3} from '/js/dsf-writing-package.js';
import {originalFixture,editableFixture} from '/scripts/writing-w1/fixture.mjs';
import {prepareDsfViewerFixedTextContext,createDsfFixedTextPageElement} from '/js/viewer-fixed-text.js';
const $=id=>document.getElementById(id),catalog=await (await fetch('/catalog.json')).json(),events=[],faces=[];
let handle,busy=false,worker,requestId=0,generatedFile;const pending=new Map();
function dispose(){if(worker)worker.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timeout);p.reject(new Error('FONT_CANCELLED'));}pending.clear();}
function rpc(method,...args){if(!worker){worker=new Worker('/font-worker.js');worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;clearTimeout(p.timeout);pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};worker.onerror=()=>dispose();}
    return new Promise((resolve,reject)=>{const id=++requestId,timeout=setTimeout(()=>{dispose();},60000);pending.set(id,{resolve,reject,timeout});worker.postMessage({id,method,args});});}
const options={catalog,engine:{derive:(...args)=>rpc('derive',...args),verify:(...args)=>rpc('verify',...args)},
    getFont:async id=>new Uint8Array(await (await fetch(`/assets/fonts/${id}.woff2`)).arrayBuffer()),
    getNotice:async id=>new Uint8Array(await (await fetch(`/notices/${id}.txt`)).arrayBuffer())};
function controls(){for(const id of ['create','prepare','file'])$(id).disabled=busy;$('record-file').disabled=busy||!generatedFile;for(const id of ['edit','restore','share','save'])$(id).disabled=busy||!handle||id==='edit'&&handle.copyKind!=='original'||['restore','share'].includes(id)&&handle.copyKind!=='writing-editable';}
function record(action,data={}){events.push({action,online:navigator.onLine,...data});$('events').textContent=JSON.stringify(events,null,2);}
async function action(name,fn){busy=true;controls();$('status').textContent=`${name}…`;try{await fn();$('status').textContent=`${name}：成功`;record(name,{kind:handle?.copyKind,baseHash:handle?.baseHash});}catch(e){$('status').textContent=`${name}：失敗 ${e.message}`;record(name,{error:e.message});}finally{dispose();busy=false;controls();}}
async function show(next){
    const bundle=next.bundle,loaded=[],fontFamilies={original:{},writing:{}};
    try{for(const area of ['original','writing'])for(const r of next.resources[area]?.fonts||[]){const family=`W1_${area}_${r.sha256}`;
        const face=new FontFace(family,next.readBytes(r.path),{weight:'100 900'});await face.load();document.fonts.add(face);loaded.push(face);fontFamilies[area][r.sourceFontId]=family;}
        const certificates={};for(const [id,d] of Object.entries(bundle.index.fonts)){d.family=fontFamilies.original[id];certificates[id]={...d};}
        const context=await prepareDsfViewerFixedTextContext({bundle,language:'ja',certifiedFonts:certificates,fontFaceSet:document.fonts}),fragment=document.createDocumentFragment();
        for(const page of context.manifest.pages){const article=document.createElement('article'),title=document.createElement('h2'),surface=document.createElement('div');title.textContent=`${page.pageLabel} ページ`;surface.className='surface';
            surface.append(createDsfFixedTextPageElement({documentRef:document,page,context}));
            const layer=document.createElement('div');layer.className='writing';
            for(const o of next.envelope.document?.pages.find(p=>p.language==='ja'&&p.pageId===page.id)?.objects||[]){
                if(o.type==='text')for(const pos of o.layout){const run=o.runs.find(r=>r.start<=pos.start&&r.end>=pos.end),span=document.createElement('span');if(!run)throw new Error('Writing layout crosses a style run');
                    span.className='writing-text';span.textContent=o.text.slice(pos.start,pos.end);Object.assign(span.style,{left:`${pos.x}px`,top:`${pos.y}px`,fontFamily:`"${fontFamilies.writing[run.fontId]}"`,fontSize:`${run.size}px`,fontWeight:run.weight,color:run.color,writingMode:o.writingMode});layer.append(span);}
                if(o.type==='stroke'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 640');svg.style.cssText='position:absolute;inset:0;width:100%;height:100%';
                    o.points.forEach((p,i)=>{const a=o.points[Math.max(0,i-1)],line=document.createElementNS(svg.namespaceURI,'line');for(const [k,v] of Object.entries({x1:a.x,y1:a.y,x2:p.x,y2:p.y,stroke:o.color,'stroke-width':p.width,'stroke-linecap':'round',opacity:o.opacity}))line.setAttribute(k,v);svg.append(line);});layer.append(svg);}
            }surface.append(layer);article.append(title,surface);fragment.append(article);}
        const oldHash=handle?.baseHash;handle=next;faces.splice(0).forEach(f=>document.fonts.delete(f));faces.push(...loaded);$('pages').replaceChildren(fragment);
        $('summary').textContent=JSON.stringify({保存種別:handle.copyKind,原本hash:handle.baseHash,履歴件数:handle.envelope.history?.revisions.length||0,現在の履歴:handle.envelope.document?.headRevisionId||null,原本フォント数:handle.resources.original.fonts.length,Writingフォント数:handle.resources.writing?.fonts.length||0,収録ファイル数:handle.inventory.length+1,前回と原本一致:oldHash?oldHash===handle.baseHash:null},null,2);
    }catch(e){loaded.forEach(f=>document.fonts.delete(f));throw e;}
}
$('create').onclick=()=>action('通常版生成',async()=>show((await createDsfV3Original(originalFixture(catalog),options)).handle));
$('file').onchange=()=>action('ファイル読込',async()=>{const file=$('file').files[0];if(file)await show(await loadDsfV3(file,options));$('file').value='';});
$('edit').onclick=()=>action('Writing追加',async()=>show((await resaveDsfV3(handle,{copyKind:'writing-editable',envelope:await editableFixture(handle)})).handle));
$('restore').onclick=()=>action('履歴復元',async()=>{const envelope=handle.envelope;envelope.document.headRevisionId='r1';envelope.document.pages=structuredClone(envelope.history.revisions.find(r=>r.id==='r1').pages);await show((await resaveDsfV3(handle,{envelope})).handle);});
$('share').onclick=()=>action('共有用作成',async()=>show((await resaveDsfV3(handle,{copyKind:'writing-shared'})).handle));
$('save').onclick=()=>action('再保存',async()=>{const before=handle;const output=await resaveDsfV3(handle);await show(output.handle);if(before.baseHash!==handle.baseHash)throw new Error('原本不一致');
    generatedFile=output;const a=$('download');if(a.href.startsWith('blob:'))URL.revokeObjectURL(a.href);a.href=URL.createObjectURL(output.blob);a.download=`w1-${handle.copyKind}.dsf`;a.hidden=false;record('file-ready',{bytes:output.bytes.length,sha256:output.sha256});});
$('record-file').onclick=()=>action('検証ファイル保存',async()=>{const response=await fetch('/record-file',{method:'POST',headers:{'Content-Type':'application/vnd.dsf.content+zip','X-DSF-SHA256':generatedFile.sha256},body:generatedFile.blob});
    if(!response.ok)throw new Error('検証ファイル保存失敗');const receipt=await response.json();record('file-written',receipt);$('summary').textContent+='\n検証ファイル: '+receipt.file;});
$('prepare').onclick=()=>action('オフライン準備',async()=>{await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready,channel=new MessageChannel();
    const result=await new Promise((resolve,reject)=>{channel.port1.onmessage=e=>e.data.ok?resolve(e.data):reject(new Error(e.data.error));registration.active.postMessage({type:'prepare'},[channel.port2]);});record('cached',result);});
$('status').textContent='DSFを開くか、検証用の通常版を生成してください。';controls();
