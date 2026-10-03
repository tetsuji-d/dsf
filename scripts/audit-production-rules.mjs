// Read-only audit. No Rules deployment, test write, IAM or token output.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const project='vmnn-26345',origin='https://firebaserules.googleapis.com/v1/';
const output=new URL('../outputs/production-candidate/',import.meta.url);
const auth=require('firebase-tools/lib/auth'),account=auth.getGlobalDefaultAccount();
assert(account,'Existing Firebase CLI login required');
const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
async function read(path){
    assert(path.startsWith(`projects/${project}/`));
    const result=await fetch(origin+path,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(20000)});
    if(!result.ok)throw Error(`Rules read failed: HTTP ${result.status}`);
    return result.json();
}
const release=await read(`projects/${project}/releases/cloud.firestore`);
assert.match(release.rulesetName,new RegExp(`^projects/${project}/rulesets/[a-zA-Z0-9-]+$`));
const ruleset=await read(release.rulesetName),files=ruleset.source?.files;
assert.equal(files?.length,1,'Inspect multi-file Rules before composing a candidate');
assert.equal(typeof files[0].content,'string');
const normalize=s=>s.replace(/\r\n/g,'\n');
const hash=s=>createHash('sha256').update(normalize(s)).digest('hex');
const deployed=files[0].content;
const baseline=execFileSync('git',['show','91db176:firestore.rules'],{encoding:'utf8'});
const current=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const evidence={checkedAt:new Date().toISOString(),project,release:release.name,ruleset:release.rulesetName,
    releaseUpdatedAt:release.updateTime,sha256LF:hash(deployed),baselineCommit:'91db176',
    matchesBaseline:hash(deployed)===hash(baseline),matchesWorkingRules:hash(deployed)===hash(current)};
mkdirSync(output,{recursive:true});
writeFileSync(new URL('production-live.rules',output),deployed);
writeFileSync(new URL('production-rules-audit.json',output),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
