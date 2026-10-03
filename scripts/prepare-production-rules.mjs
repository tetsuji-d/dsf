// Generates reviewable local candidates. Never deploys or edits firestore.rules.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const output=new URL('../outputs/production-candidate/',import.meta.url);
const normalize=s=>s.replace(/\r\n/g,'\n');
const hash=s=>createHash('sha256').update(normalize(s)).digest('hex');
const git=ref=>normalize(execFileSync('git',['show',ref+':firestore.rules'],{encoding:'utf8'}));
const baseline=git('91db176'),full=normalize(readFileSync(new URL('../firestore.rules',import.meta.url),'utf8'));
const live=readFileSync(new URL('production-live.rules',output),'utf8');
const audit=JSON.parse(readFileSync(new URL('production-rules-audit.json',output),'utf8'));
assert.equal(audit.project,'vmnn-26345');
assert.equal(hash(live),audit.sha256LF,'Audit file changed');
assert.equal(hash(live),hash(baseline),'Live Rules differ from the reviewed baseline. Reconcile first.');
assert.equal(hash(full),hash(git('60bfc53')),'Rules changed after the reviewed T/P/R changes. Review before regenerating.');
function section(source,from,to){
    const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
    assert(start>=0&&end>start,`Missing unique Rules section: ${from}`);
    assert.equal(source.indexOf(from,start+from.length),-1,`Ambiguous section: ${from}`);
    return source.slice(start,end);
}
function replaceOnce(source,from,to){assert.equal(source.split(from).length,2,'Expected one exact Rules anchor');return source.replace(from,to);}
// Keep lifecycle protection of the public index when deferring the space policy.
const spaceBlock=section(full,'    // Publishing spaces organize ownership','    function projectWriteHasSupportedVersion()');
let tr=replaceOnce(full,spaceBlock,
    '    // Trash protection does not impose publishing-space membership.\n'+
    '    function publicIndexActiveAllowed(uid, pid) {\n'+
    "      let projectId = request.resource.data.get('projectId', pid);\n"+
    '      return projectId is string && projectIsActive(uid, projectId);\n    }\n\n');
tr=replaceOnce(tr,'                      && projectPublicationCreateAllowed(uid, pid)\n','');
tr=replaceOnce(tr,'                      && projectPublicationUpdateAllowed(uid, pid)\n','');
tr=replaceOnce(tr,'publicIndexSpaceAllowed(request.auth.uid, pid)','publicIndexActiveAllowed(request.auth.uid, pid)');
const currentReviewFunctions=section(tr,'    // Candidate: review access','    // ユーザー正本');
const oldReviewFunctions=section(baseline,'    function validReviewCreate(','    // ユーザー正本');
let trash=replaceOnce(tr,currentReviewFunctions,oldReviewFunctions);
// Review is the final match section in both audited inputs. Preserve the closing braces too.
const reviewMatch='    match /reviews/{workId} {';
assert.equal(tr.split(reviewMatch).length,2);assert.equal(baseline.split(reviewMatch).length,2);
trash=replaceOnce(trash,trash.slice(trash.indexOf(reviewMatch)),baseline.slice(baseline.indexOf(reviewMatch)));
assert(!trash.includes('reviewWorkIsPublic'));assert(!trash.includes('hasPublishingSpace'));
assert(tr.includes('reviewWorkIsPublic'));assert(!tr.includes('hasPublishingSpace'));
for(const text of [trash,tr,full])assert(text.includes('projectTrashUpdateAllowed()'));
const candidates=[['a0-baseline',baseline,[]],['a-trash',trash,['trash']],['b-trash-review',tr,['trash','review']],['c-trash-review-publication',full,['trash','review','publication']]];
mkdirSync(new URL('rules/',output),{recursive:true});
const manifest={createdAt:new Date().toISOString(),baselineAudit:audit,sourceRulesSha256LF:hash(full),
    deployableWithoutApproval:false,stages:candidates.map(([name,text,features])=>{
        const path=`rules/${name}.rules`;
        writeFileSync(new URL(path,output),text);
        writeFileSync(new URL(`firebase.${name}.json`,output),JSON.stringify({firestore:{rules:path}},null,2)+'\n');
        return {name,path,features,sha256LF:hash(text)};
    })};
writeFileSync(new URL('rules-manifest.json',output),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
