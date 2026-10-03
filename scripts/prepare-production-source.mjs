// Local, review-only snapshot. No checkout changes, credentials, commit or deployment.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {resolve,relative,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {build as viteBuild} from 'vite';
import {build as esbuild} from 'esbuild';
const root=resolve('.'),out=resolve('outputs/production-candidate');
const baseline='91db176',stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const snapshot=resolve(out,'source-a-'+stamp),selected=new Map();
const slash=p=>p.replaceAll('\\','/');
const hash=b=>createHash('sha256').update(b).digest('hex');
function add(path,reason){
    const abs=resolve(root,path.split('?')[0]),rel=slash(relative(root,abs));
    if(rel==='package.json'||rel.startsWith('../')||isAbsolute(rel)||rel.startsWith('node_modules/')||rel.startsWith('outputs/')||!existsSync(abs)||!statSync(abs).isFile())return;
    assert(!rel.startsWith('.git/'));
    if(!selected.has(rel))selected.set(rel,new Set());selected.get(rel).add(reason);
}
const originalPackage=JSON.parse(execFileSync('git',['show',baseline+':package.json'],{encoding:'utf8'}));
const currentPackage=JSON.parse(readFileSync('package.json','utf8'));
for(const key of ['dependencies','devDependencies'])assert.deepEqual(currentPackage[key],originalPackage[key],'Review changed dependencies before extracting');
await viteBuild({root,mode:'production',logLevel:'warn',build:{write:false,rollupOptions:{input:resolve(root,'studio.html')}},plugins:[{
    name:'production-scope-inventory',generateBundle(){
        for(const id of this.getModuleIds())add(id,'Studio dependency');
        for(const id of this.getWatchFiles())add(id,'Studio build input');
    }
}]});
const routes=execFileSync('git',['ls-tree','-r','--name-only',baseline,'functions'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>p.endsWith('.js'));
routes.push('functions/api/publishing-spaces.js','functions/api/project-trash.js','functions/api/recent-activity.js');
for(const route of routes){
    const result=await esbuild({entryPoints:[resolve(route)],bundle:true,write:false,metafile:true,platform:'neutral',format:'esm',packages:'external',logLevel:'silent'});
    for(const path of Object.keys(result.metafile.inputs))add(path,'Existing API or owner API dependency');
}
for(const path of ['studio.html','.env.production','wrangler.toml','vite.config.js','scripts/studio-pwa-plugin.js','scripts/viewer-book-samples-plugin.js','js/studio-service-worker.js','js/studio-update-core.js','public/_headers','public/studio.webmanifest','public/studio-icon.svg','public/studio-icon-192.png','public/studio-icon-512.png','public/studio-repair.html','public/studio-repair.js','public/file-icons/dsp.svg','public/file-icons/dsf.svg'])add(path,'Studio delivery infrastructure');
// Keep deferred entry surfaces and review client at the verified production revision.
const frozen=['viewer.html','js/viewer.js','css/viewer.css','js/review-client.js','index.html','mypage.html','admin/index.html'];
for(const path of frozen)assert(!selected.has(path),`Deferred entry unexpectedly required by Studio: ${path}`);
assert(!existsSync(snapshot),'Never overwrite an existing candidate');mkdirSync(snapshot,{recursive:true});
const archive=resolve(out,'baseline-'+stamp+'.tar');
execFileSync('git',['archive','--format=tar','--output',archive,baseline]);
execFileSync('tar',['-xf',archive,'-C',snapshot]);
const baselinePaths=new Set(execFileSync('git',['ls-tree','-r','--name-only',baseline],{encoding:'utf8'}).trim().split(/\r?\n/));
const changes=[];
for(const [path,reasons] of [...selected].sort(([a],[b])=>a.localeCompare(b))){
    const target=resolve(snapshot,path),before=existsSync(target)?readFileSync(target):null,after=readFileSync(resolve(root,path));
    mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(root,path),target);
    if(!before||!before.equals(after))changes.push({path,reasons:[...reasons],action:before?'update':'add',sha256:hash(after)});
}
const overrides=[];
function override(path,transform,reason){const target=resolve(snapshot,path),before=readFileSync(target,'utf8'),after=transform(before);assert.notEqual(after,before);writeFileSync(target,after);overrides.push({path,reason});const entry=changes.find(x=>x.path===path);if(entry)entry.sha256=hash(Buffer.from(after));else changes.push({path,reasons:[reason],action:baselinePaths.has(path)?'update':'add',sha256:hash(Buffer.from(after))});}
override('wrangler.toml',s=>{assert.equal(s.split('PUBLISHING_SPACES_ENABLED = "false"').length,2);return s.replace('PUBLISHING_SPACES_ENABLED = "false"','PUBLISHING_SPACES_ENABLED = "true"');},'Proposed owner-space API enablement in this local candidate only');
override('public/studio.webmanifest',s=>{const m=JSON.parse(s);assert(m.file_handlers);delete m.file_handlers;return JSON.stringify(m,null,2)+'\n';},'Defer new OS file association; retain Studio app installation');
for(const route of ['functions/api/invitations.js','functions/api/personal-sharing.js','functions/api/spaces/[[path]].js'])assert(!existsSync(resolve(snapshot,route)),`Deferred endpoint included: ${route}`);
assert.equal(readFileSync(resolve(snapshot,'firestore.rules'),'utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show',baseline+':firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n'));
const currentChanges=execFileSync('git',['diff','--name-only',baseline],{encoding:'utf8'}).trim().split(/\r?\n/);
const report={createdAt:new Date().toISOString(),baseline,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),snapshot,
    status:'review-only; build and authenticated compatibility verification required',deployableWithoutApproval:false,
    includesUncommittedWork:true,frozen,overrides,selected:[...selected.keys()].sort(),changes,
    deferredChangedPaths:currentChanges.filter(p=>!selected.has(p)),
    caveat:'Shared modules used by the baseline Viewer/Portal can change with Studio. Frozen entry files do not prove unchanged runtime behavior.'};
writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({snapshot,selected:report.selected.length,changed:changes.length,frozen,overrides},null,2));
