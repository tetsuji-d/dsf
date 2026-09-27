import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { reviewWorkIsPublic, reviewReactionCounts } from '../js/review-client.js';
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS',name);}
const now=Date.now(),publication={publicFrom:new Date(now-1000),listedFrom:new Date(now-1000),listedUntil:new Date(now+1000),publicUntil:null,expiredAt:null,expireReason:null};
const meta={source:'shared',workId:'work',releaseId:'r',projectId:'p',authorUid:'author',dsfStatus:'public',publication};
check('public window',()=>assert(reviewWorkIsPublic(meta,now)));
for(const [key,value] of [['publicFrom',new Date(now+1)],['listedFrom',new Date(now+1)],['listedUntil',new Date(now)],['publicUntil',new Date(now)],['expiredAt',new Date(now)],['expireReason','listing']]){
 check('closed '+key,()=>assert.equal(reviewWorkIsPublic({...meta,publication:{...publication,[key]:value}},now),false));
}
for(const value of [null,{}, {dsfStatus:'private',publication}, {...meta,publication:{}}])check('incomplete or private',()=>assert.equal(reviewWorkIsPublic(value,now),false));
check('unlisted readable',()=>assert(reviewWorkIsPublic({...meta,dsfStatus:'unlisted'},now)));
check('legacy missing counters start zero',()=>assert.deepEqual(reviewReactionCounts({},'','good'),{goodCount:1,badCount:0}));
check('negative old count rejected',()=>assert.throws(()=>reviewReactionCounts({goodCount:-1},'','good')));
check('inconsistent count is not clamped',()=>assert.throws(()=>reviewReactionCounts({goodCount:0},'good',''),/repair/));
check('fraction rejected',()=>assert.throws(()=>reviewReactionCounts({badCount:0.5},'','good')));
const source=readFileSync(new URL('../js/viewer.js',import.meta.url),'utf8');
const section=source.slice(source.indexOf('function createReviewUiState()'),source.indexOf('function getMetricSessionId()'));
const ctx=vm.createContext({state:{uid:'reader',user:{uid:'reader'}},viewerProjectMeta:{...meta,publication:{...publication,listedUntil:new Date(now+3600000)}},
 reviewGeneration:0,reviewUiState:{},reviewWorkIsPublic,renderViewerInfoPanel(){},vt:key=>key,console:{warn(){}},
 document:{getElementById:()=>null},window:{confirm:()=>true},ensureUserBootstrap:async()=>({publicProfile:{displayName:'Reader'}})});
vm.runInContext(section,ctx);ctx.resetReviewUiState();
const pending=[];ctx.reviewClient={load:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
const old=ctx.loadViewerReviews();ctx.state.uid='other';ctx.resetReviewUiState();const fresh=ctx.loadViewerReviews();
pending[1].resolve([{reviewId:'fresh',body:'new account'}]);await fresh;
pending[0].resolve([{reviewId:'old',body:'old account',userReaction:'good'}]);await old;
check('old account response discarded',()=>assert.equal(ctx.reviewUiState.reviews[0].reviewId,'fresh'));
const failure=ctx.loadViewerReviews();pending[2].reject(Error('offline'));await failure;
check('failed read clears cached public text',()=>assert.equal(ctx.reviewUiState.reviews.length,0));
check('load error shown',()=>assert.equal(ctx.reviewUiState.status,'error'));
ctx.reviewClient={submit:async()=>{throw Error('offline')},load:async()=>[]};
const container={querySelector:()=>({value:'draft preserved'})};
await ctx.submitViewerReview(container);
check('failed post retains draft',()=>assert.equal(ctx.reviewUiState.draft,'draft preserved'));
let count=0,finish;ctx.reviewClient={submit:()=>{count++;return new Promise(r=>{finish=r})},load:async()=>[]};
const post=ctx.submitViewerReview(container);await Promise.resolve();await ctx.submitViewerReview(container);finish('posted');await post;
check('double submit writes once',()=>assert.equal(count,1));
check('successful post clears draft',()=>assert.equal(ctx.reviewUiState.draft,''));
ctx.window.confirm=()=>false;await ctx.submitViewerReview(container);
check('cancel does not post',()=>assert.equal(count,1));
ctx.reviewUiState={...ctx.reviewUiState,status:'loaded',reviews:[{reviewId:'r'}],draft:'still here'};
let reactCount=0,finishVote;ctx.reviewClient={react:()=>{reactCount++;return new Promise(r=>{finishVote=r})}};
const vote=ctx.setViewerReviewReaction('r','good');await ctx.setViewerReviewReaction('r','bad');
finishVote({goodCount:1,badCount:0,userReaction:'good'});await vote;
check('overlapping votes prevented',()=>assert.equal(reactCount,1));
check('vote preserves draft',()=>assert.equal(ctx.reviewUiState.draft,'still here'));
ctx.reviewClient={react:async()=>{throw Object.assign(Error('blocked'),{code:'permission-denied'})}};
await ctx.setViewerReviewReaction('r','bad');
check('vote errors visible',()=>assert.equal(ctx.reviewUiState.lastError,'reviewPermissionDenied'));
check('vote failure clears stale list',()=>assert.equal(ctx.reviewUiState.reviews.length,0));
check('bookmark eligibility unchanged',()=>assert(source.includes("function canUseViewerBookmark() {\n    return viewerProjectMeta.source === 'shared' && !!viewerProjectMeta.workId;")));
console.log(`Review client/UI state: ${checks} checks passed.`);
