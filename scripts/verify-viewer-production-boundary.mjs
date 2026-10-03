import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// Release audit against the last production header release, not a data migration.
const baseline='a92422a';
const normalize=s=>s.replaceAll('\r\n','\n');
const previous=path=>normalize(execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8',maxBuffer:8e6}));
const current=path=>normalize(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const region=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert(a>=0&&b>a);return s.slice(a,b);};
const old=previous('js/viewer.js'),viewer=current('js/viewer.js');
for(const [start,end] of [
 ['function createReviewUiState()','function getMetricSessionId()'],
 ["    const editorPreview=params.get('editorPreview');",'    const ownerDraftPid'],
 ['async function loadViewerFile(','async function loadRemoteDsf('],
 ['async function loadWorkFromPublicIndex','async function loadHorizonProjection'],
]) assert.equal(region(viewer,start,end),region(old,start,end),start+' must preserve the production contract');
for(const path of ['js/app.js','js/state.js','js/firebase.js','js/export.js','js/press.js','js/viewer-owner-preview.js','js/viewer-release-route.js','js/dsf-local-viewer-package.js','js/dsf-horizon-viewer-load.js','firestore.rules','.env.production','wrangler.toml','public/studio.webmanifest']) {
 assert.equal(current(path),previous(path),path+' is outside this Viewer rollout');
}
assert.match(viewer,/const viewerBookEdgesRequested = viewerBookEdgesOverride !== '0';/);
assert.doesNotMatch(viewer,/\b(createReviewClient|installFileLaunch)\b/);
assert.doesNotMatch(current('viewer.html'),/account-notifications-entry|data-account-notifications/);
console.log('Production boundary: existing review, preview, file/public loaders, Studio, storage, rules and environment preserved; book UI enabled by default.');
