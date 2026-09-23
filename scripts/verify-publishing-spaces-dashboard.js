import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const start=source.indexOf('window.newSpaceProject = async () => {');
const end=source.indexOf('\n};',start)+4;
assert.ok(start>0 && end>start);
async function scenario(effect,spaceId='space_1',joined=false){
 const state={uid:'owner',workId:'old',projectId:'old'};
 const assigned=[],alerts=[],selected=[];let creates=0;const user={uid:'owner'};
 const context={state,firebaseAuth:{currentUser:user},getUILang:()=> 'en',alert:message=>alerts.push(message),
  getPublishingSpaceUI:()=>({selection:()=>spaceId,joinedSelection:()=>joined?{id:'space_joined'}:null,select:id=>selected.push(id),assign:async(...args)=>{assigned.push(args);return true;}}),
  persistProject:async()=>{state.projectId='new_project';await effect?.(context);},
  window:{newProject:async()=>{creates++;state.workId='new_work';state.projectId=null;return true;},switchRoom:()=>{}}
 };
 vm.runInNewContext(source.slice(start,end),context);
 await context.window.newSpaceProject();return {assigned,alerts,selected,creates};
}
assert.deepEqual((await scenario()).assigned,[['new_project','space_1']]);
assert.deepEqual((await scenario(ctx=>{ctx.state.uid='someone_else';})).assigned,[]);
assert.deepEqual((await scenario(ctx=>{ctx.state.workId='opened_other_work';})).assigned,[]);
assert.deepEqual((await scenario(ctx=>{ctx.firebaseAuth.currentUser={uid:'owner'};})).assigned,[]);
const failure=await scenario(()=>{throw new Error('SAVE_FAILED');});
assert.equal(failure.assigned.length,0);assert.equal(failure.alerts.length,1);
const personal=await scenario(null,null);assert.equal(personal.creates,1);assert.deepEqual(personal.assigned,[]);assert.deepEqual(personal.selected,['unassigned']);
const participant=await scenario(null,'space_joined',true);assert.equal(participant.creates,0);assert.deepEqual(participant.assigned,[]);
console.log('Dashboard new manuscript: assign only after successful saving; reject stale account, session and project callbacks.');

// Run the actual dashboard renderer with unresolved space loading.
// This checks observable ordering, rather than matching source text.
const rendererStart=source.indexOf('async function renderHomeDashboard(');
const rendererEnd=source.indexOf('// ── Studio 認証 UI',rendererStart);
assert.ok(rendererStart>0 && rendererEnd>rendererStart);
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',querySelectorAll:()=>[],classList:{toggle(){}}});return elements.get(id);};
let resolveSpaces,spaceLoads=0;
const pendingSpaces=new Promise(resolve=>{resolveSpaces=resolve;});
const dashboard={
 homeLoadingMarkup:()=>'',withHomeDeadline:p=>p,syncSpaceMembersSettings:()=>{},bindProjectActions:()=>{},
 getHomeWorkspace:()=>({render:()=>{}}),
 homeDashboardRenderRevision:0,state:{uid:'owner'},document:{getElementById:element},
 getPublishingSpaceUI:()=>({load:()=>{spaceLoads++;return pendingSpaces;},render:()=>{},filter:rows=>rows,label:()=> 'all',destination:()=> 'Cloud',bind:()=>{},selection:()=>null}),
 fetchHomeCloudProjects:async()=>[{id:'cloud_book',lastUpdated:{seconds:1}},{id:'recent_book',lastUpdated:{toMillis:()=>2000}}],listLocalRecentProjects:async()=>[{id:'local_copy'}],
 renderHomeLocalProjects:el=>{el.innerHTML='local visible';},t:key=>key,getUILang:()=> 'en',
 isPublishedHomeWork:()=>false,renderHomeStatCard:()=>'',renderHomeDashboardStats:()=>'',renderHomeCard:p=>'cloud visible '+p.id,
 bindHomeWorkActions:()=>{},syncStudioShell:()=>{},console
};
vm.createContext(dashboard);vm.runInContext(source.slice(rendererStart,rendererEnd),dashboard);
await Promise.race([dashboard.renderHomeDashboard(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Space loading blocked cloud manuscripts')),1000);timer.unref();})]);
assert.match(element('home-cloud-grid').innerHTML,/cloud visible cloud_book/);
assert.equal(element('home-local-grid').innerHTML,'local visible');
assert.ok(element('home-cloud-grid').innerHTML.indexOf('recent_book') < element('home-cloud-grid').innerHTML.indexOf('cloud_book'),'recently saved works appear first');
await dashboard.renderHomeDashboard({refreshSpaces:false});assert.equal(spaceLoads,1,'space completion/selection must not reload the API recursively');
resolveSpaces();
console.log('Actual dashboard renderer: cloud and local manuscripts remain available while space loading is pending; no recursive refetch.');
