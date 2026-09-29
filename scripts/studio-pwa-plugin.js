import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Exact app resources only. No authoring, authentication or publication API data.
export function studioPwaPlugin(){
 const builtAt=Date.now(),iso=new Date(builtAt).toISOString(),id=iso.replace(/[^0-9]/g,'');
 const build={schema:1,id,builtAt,label:'v'+iso.slice(0,10).replaceAll('-','.')+'-'+id.slice(8,14)};
 return {name:'studio-offline-build',enforce:'post',
 config:()=>({define:{__STUDIO_BUILD__:JSON.stringify(build)}}),
 generateBundle(options,bundle){
 const files=Object.keys(bundle).filter(p=>p.startsWith('assets/')||['studio.html','viewer.html'].includes(p)).sort();
 let source=readFileSync(new URL('../js/studio-service-worker.js',import.meta.url),'utf8');
 const version=createHash('sha256').update(source+readFileSync(new URL('../public/studio.webmanifest',import.meta.url),'utf8')+files.map(p=>p+String(bundle[p].code||bundle[p].source)).join('')).digest('hex').slice(0,20);
 source=source.replace('__STUDIO_BUILD_INFO__',JSON.stringify(build)).replace('__STUDIO_PRECACHE__',JSON.stringify(files.map(p=>'/'+p).concat(['/studio.webmanifest','/studio-icon.svg','/studio-icon-192.png','/studio-icon-512.png']))).replace('__STUDIO_VERSION__',JSON.stringify(version));
 this.emitFile({type:'asset',fileName:'studio-sw.js',source});
 this.emitFile({type:'asset',fileName:'studio-version.json',source:JSON.stringify(build)});
}};}
