import {spawn} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const cache=join(homedir(),'.cache','firebase','emulators');
const jar=join(cache,readdirSync(cache).filter(n=>/^cloud-firestore-emulator-v[\d.]+\.jar$/.test(n)).sort().at(-1));
const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin','java.exe'):'java';
const rules=resolve(process.argv[2]||'firestore.rules'), port=8298; let log='',exited=false;
if(!existsSync(rules))throw Error('Rules file missing');
const emulator=spawn(java,['-Duser.language=en','-Duser.country=US','-jar',jar,'--host','127.0.0.1','--port',String(port),'--project_id','demo-dsf-trash','--rules',rules,'--single_project_mode','true'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
emulator.on('error',e=>{log+=e.message;exited=true;});emulator.on('exit',()=>exited=true);
for(const stream of [emulator.stdout,emulator.stderr])stream.on('data',b=>log=(log+b).slice(-8000));
try {
 for(let i=0;i<100&&!exited&&!log.includes('Dev App Server is now running');i++)await delay(250);
 if(!log.includes('Dev App Server is now running'))throw Error(log);
 const test=spawn(process.execPath,['scripts/verify-project-trash-rules-emulator.js'],{windowsHide:true,stdio:'inherit',env:{...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:'+port,GCLOUD_PROJECT:'demo-dsf-trash'}});
 const timer=setTimeout(()=>test.kill(),120000);try {const code=await new Promise((resolve,reject)=>{test.on('exit',resolve);test.on('error',reject);});if(code!==0)throw Error('Rules test failed: '+log.slice(-3000));}finally{clearTimeout(timer);}
} finally {if(!exited)emulator.kill();}
