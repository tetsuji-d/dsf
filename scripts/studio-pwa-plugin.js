import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Exact app resources only. No authoring, authentication or publication API data.
export function studioPwaPlugin(){
 let mode='production';
 const builtAt=Date.now(),iso=new Date(builtAt).toISOString(),id=iso.replace(/[^0-9]/g,'');
 const build={schema:1,id,builtAt,label:'v'+iso.slice(0,10).replaceAll('-','.')+'-'+id.slice(8,14)};
 return {name:'studio-offline-build',enforce:'post',
 configResolved:config=>{mode=config.mode;},
 config:()=>({define:{__STUDIO_BUILD__:JSON.stringify(build)}}),
 configureServer:server=>server.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/studio-update-core.js')return next();
  res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');
  res.end(readFileSync(new URL('../js/studio-update-core.js',import.meta.url),'utf8'));
 }),
 transformIndexHtml:html=>html.replace('<head>','<head><meta name="dsf-studio-build" content="'+build.id+'">').replace('</body>',mode==='development'?'</body>':'<script type="module" src="/platform-update-entry.js?build='+build.id+'"></script></body>'),
 generateBundle(options,bundle){
 this.emitFile({type:'asset',fileName:'studio-update-core.js',source:readFileSync(new URL('../js/studio-update-core.js',import.meta.url),'utf8')});
 const manifest=JSON.parse(readFileSync(new URL('../public/studio.webmanifest',import.meta.url),'utf8'));
 // Keep the installed identity stable, but distinguish preview from production.
 if(mode!=='production')manifest.name=manifest.short_name='DSF Studio ('+mode+')';
 this.emitFile({type:'asset',fileName:'studio.webmanifest',source:JSON.stringify(manifest,null,2)+'\n'});
 const fileIcons=[...new Set((manifest.file_handlers||[]).flatMap(h=>(h.icons||[]).map(icon=>icon.src)).concat(['/file-icons/dsp.svg','/file-icons/dsf.svg']))];
 const files=Object.keys(bundle).filter(p=>p.startsWith('assets/')||['index.html','mypage.html','admin/index.html','studio.html','viewer.html'].includes(p)).sort();
 let source=readFileSync(new URL('../js/studio-service-worker.js',import.meta.url),'utf8');
 const appIcons=['/studio-icon.svg','/studio-icon-192.png','/studio-icon-512.png'];
 const version=createHash('sha256').update(source+JSON.stringify(manifest)+[...fileIcons,...appIcons].map(p=>createHash('sha256').update(readFileSync(new URL('../public'+p,import.meta.url))).digest('hex')).join('')+files.map(p=>p+String(bundle[p].code||bundle[p].source)).join('')).digest('hex').slice(0,20);
 source=source.replace('__STUDIO_BUILD_INFO__',JSON.stringify(build)).replace('__STUDIO_PRECACHE__',JSON.stringify(files.map(p=>'/'+p).concat(['platform-update-entry.js','platform-update-core.js','studio-update-core.js'].map(p=>'/'+p+'?build='+build.id),['/studio.webmanifest','/studio-icon.svg','/studio-icon-192.png','/studio-icon-512.png'],fileIcons))).replace('__STUDIO_VERSION__',JSON.stringify(version));
 this.emitFile({type:'asset',fileName:'studio-sw.js',source:source.replace('__STUDIO_FULL_OFFLINE__','true')});
 for(const name of ['platform-sw.js','viewer-sw.js'])this.emitFile({type:'asset',fileName:name,source:source.replace('__STUDIO_FULL_OFFLINE__','false')});
 for(const name of ['platform-update-entry.js','platform-update-core.js'])this.emitFile({type:'asset',fileName:name,source:readFileSync(new URL('../js/'+name,import.meta.url),'utf8').replaceAll('./platform-update-core.js','./platform-update-core.js?build='+build.id).replaceAll('./studio-update-core.js','./studio-update-core.js?build='+build.id)});
 this.emitFile({type:'asset',fileName:'studio-version.json',source:JSON.stringify(build)});
}};}
