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
 generateBundle(options,bundle){
 const manifest=JSON.parse(readFileSync(new URL('../public/studio.webmanifest',import.meta.url),'utf8'));
 // Keep the installed identity stable, but distinguish preview from production.
 if(mode!=='production')manifest.name=manifest.short_name='DSF Studio ('+mode+')';
 this.emitFile({type:'asset',fileName:'studio.webmanifest',source:JSON.stringify(manifest,null,2)+'\n'});
 const fileIcons=[...new Set((manifest.file_handlers||[]).flatMap(h=>(h.icons||[]).map(icon=>icon.src)).concat(['/file-icons/dsp.svg','/file-icons/dsf.svg']))];
 const files=Object.keys(bundle).filter(p=>p.startsWith('assets/')||['studio.html','viewer.html'].includes(p)).sort();
 let source=readFileSync(new URL('../js/studio-service-worker.js',import.meta.url),'utf8');
 const version=createHash('sha256').update(source+JSON.stringify(manifest)+fileIcons.map(p=>createHash('sha256').update(readFileSync(new URL('../public'+p,import.meta.url))).digest('hex')).join('')+files.map(p=>p+String(bundle[p].code||bundle[p].source)).join('')).digest('hex').slice(0,20);
 source=source.replace('__STUDIO_BUILD_INFO__',JSON.stringify(build)).replace('__STUDIO_PRECACHE__',JSON.stringify(files.map(p=>'/'+p).concat(['/studio.webmanifest','/studio-icon.svg','/studio-icon-192.png','/studio-icon-512.png'],fileIcons))).replace('__STUDIO_VERSION__',JSON.stringify(version));
 this.emitFile({type:'asset',fileName:'studio-sw.js',source});
 this.emitFile({type:'asset',fileName:'studio-version.json',source:JSON.stringify(build)});
}};}
