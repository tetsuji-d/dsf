// Local emulator only. Uses installed Java/JAR; does not deploy or download.
import {spawn} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const output=resolve('outputs/production-candidate'),manifest=JSON.parse(readFileSync(join(output,'rules-manifest.json'),'utf8'));
const cache=join(homedir(),'.cache/firebase/emulators');
const jars=existsSync(cache)?readdirSync(cache).filter(n=>/^cloud-firestore-emulator-v[\d.]+\.jar$/.test(n)).sort():[];
const jar=process.env.FIRESTORE_EMULATOR_JAR||(jars.length?join(cache,jars.at(-1)):'');
assert(existsSync(jar),'Installed emulator required');
const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
const results=[];mkdirSync(join(output,'logs'),{recursive:true});
for(const stage of manifest.stages.filter(s=>s.features.includes('trash'))){
    const rules=join(output,stage.path),text=readFileSync(rules,'utf8');
    assert.equal(createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex'),stage.sha256LF);
    const port=8297,project='demo-dsf-production-phases';let log='',exited=false;
    const emulator=spawn(java,['-Duser.language=en','-Duser.country=US','-jar',jar,'--host','127.0.0.1','--port',String(port),'--project_id',project,'--rules',rules,'--single_project_mode','true'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const ended=new Promise(resolve=>emulator.on('exit',()=>{exited=true;resolve();}));
    emulator.on('error',e=>{exited=true;log+=e.message;});
    for(const stream of [emulator.stdout,emulator.stderr])stream.on('data',b=>{log=(log+b).slice(-100000);});
    try{
        for(let i=0;i<160&&!exited&&!log.includes('Dev App Server is now running');i++)await delay(250);
        assert(log.includes('Dev App Server is now running'),log.slice(-3000));
        const tests=['verify-project-trash-rules-emulator.js','verify-production-phase-emulator.mjs',...(stage.features.includes('review')?['verify-review-rules-emulator.mjs']:[])];
        for(const script of tests){
            let report='';
            const child=spawn(process.execPath,['scripts/'+script],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FIRESTORE_EMULATOR_HOST:`127.0.0.1:${port}`,GCLOUD_PROJECT:project,DSF_TEST_SPACE_REQUIRED:String(stage.features.includes('publication'))}});
            for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{report+=b;});
            const timeout=setTimeout(()=>child.kill(),120000);
            let code;try{code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});}finally{clearTimeout(timeout);}
            writeFileSync(join(output,'logs',stage.name+'-'+script+'.log'),report);
            console.log(`${code===0?'PASS':'FAIL'} ${stage.name} / ${script}`);
            if(code!==0)throw Error(report.slice(-3500));
            results.push({stage:stage.name,rulesSha256LF:stage.sha256LF,script,passed:true});
        }
    }finally{
        if(!exited)emulator.kill();await Promise.race([ended,delay(5000)]);
        writeFileSync(join(output,'logs',stage.name+'-emulator.log'),log);
    }
}
writeFileSync(join(output,'rules-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
