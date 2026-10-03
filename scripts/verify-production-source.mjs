import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
const root=resolve('.'),out=resolve('outputs/production-candidate');
const manifest=JSON.parse(readFileSync(join(out,'source-manifest.json'),'utf8')),snapshot=manifest.snapshot;
const hash=b=>createHash('sha256').update(b).digest('hex'),slash=p=>p.replaceAll('\\','/');
assert(slash(snapshot).startsWith(slash(out)+'/source-a-'));
for(const entry of manifest.changes)assert.equal(hash(readFileSync(join(snapshot,entry.path))),entry.sha256,entry.path);
const baseline=path=>execFileSync('git',['show',manifest.baseline+':'+path]);
const baselinePaths=new Set(execFileSync('git',['ls-tree','-r','--name-only',manifest.baseline],{encoding:'utf8'}).trim().split(/\r?\n/));
for(const path of [...manifest.frozen,'firestore.rules','package.json','package-lock.json']){
    if(!baselinePaths.has(path)){assert(!existsSync(join(snapshot,path)),path);continue;}
    const original=baseline(path);
    assert.equal(readFileSync(join(snapshot,path),'utf8').replace(/\r\n/g,'\n'),original.toString().replace(/\r\n/g,'\n'),path);
}
let sharedDependencies={};
await build({root:snapshot,configFile:join(snapshot,'vite.config.js'),mode:'production',logLevel:'warn',plugins:[{
    name:'candidate-entry-dependencies',generateBundle(){
        const changed=new Set(manifest.changes.map(x=>x.path));
        for(const entry of this.getModuleIds()){
            if(!this.getModuleInfo(entry)?.isEntry||!entry.endsWith('.html'))continue;
            const visited=new Set(),walk=id=>{if(visited.has(id))return;visited.add(id);const info=this.getModuleInfo(id);for(const child of [...(info?.importedIds||[]),...(info?.dynamicallyImportedIds||[])])walk(child);};walk(entry);
            sharedDependencies[slash(relative(snapshot,entry))]=[...visited].map(id=>slash(relative(snapshot,id.split('?')[0]))).filter(p=>changed.has(p)).sort();
        }
    }
}]});
const tests=['verify-studio-restored-reload.js','verify-studio-update-core.js','verify-safe-resume-integration.js','verify-private-authoring-api.js','verify-private-authoring-creation.js','verify-private-project-actions.js','verify-project-trash.js','verify-publishing-spaces.js'];
const results=[];mkdirSync(join(out,'source-test-logs'),{recursive:true});
for(const name of ['private-authoring-api-fixture.js','private-authoring-maintenance-fixture.js','publishing-spaces-fixture.js'])copyFileSync(join(root,'scripts/fixtures',name),join(snapshot,'scripts/fixtures',name));
for(const name of tests){
    // Verification inputs only, not runtime source or release-manifest changes.
    copyFileSync(join(root,'scripts',name),join(snapshot,'scripts',name));
    let log='';try{log=execFileSync(process.execPath,['scripts/'+name],{cwd:snapshot,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']});results.push({name,passed:true,sha256:hash(readFileSync(join(root,'scripts',name)))});}
    catch(error){log=String(error.stdout||'')+'\n'+String(error.stderr||error);writeFileSync(join(out,'source-test-logs',name+'.log'),log);throw error;}
    writeFileSync(join(out,'source-test-logs',name+'.log'),log);console.log('PASS candidate '+name);
}
writeFileSync(join(out,'source-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),manifestSha256:hash(readFileSync(join(out,'source-manifest.json'))),snapshot,buildPassed:true,results,sharedDependencies,authenticatedAcceptance:false},null,2)+'\n');
console.log('PASS candidate build and targeted checks; authenticated browser acceptance remains required.');
