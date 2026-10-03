import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {loadEnv} from 'vite';
import {resolveStudioRollout} from '../js/studio-rollout.js';
import {projectActionsMarkup} from '../js/project-actions-ui.js';
import {requiresPublishingSpace,canMoveProjectToTrash} from '../server/studio-rollout.js';
import {createProjectTrashService,createProjectTrashApi} from '../server/project-trash.js';
import {maintenanceFixture,scope,root,child} from './fixtures/private-authoring-maintenance-fixture.js';

test('space availability does not impose publication or enable deletion',()=>{
    for(const value of [undefined,'false','true']){
        const env={PUBLISHING_SPACES_ENABLED:value};
        assert.equal(requiresPublishingSpace(env),false);
        assert.equal(canMoveProjectToTrash(env),false);
        assert.equal(requiresPublishingSpace({...env,PUBLISHING_SPACE_REQUIRED:'true'}),true);
        assert.equal(canMoveProjectToTrash({...env,PROJECT_TRASH_ENABLED:'true'}),true);
    }
    for(const value of [true,1,'1','TRUE','false']){
        assert.equal(requiresPublishingSpace({PUBLISHING_SPACE_REQUIRED:value}),false);
        assert.equal(canMoveProjectToTrash({PROJECT_TRASH_ENABLED:value}),false);
    }
});

test('production and preview switches match their build-time presentation settings',()=>{
    const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
    const production=config.split('[vars]')[1].split('[env.preview]')[0];
    const preview=config.split('[env.preview.vars]')[1];
    for(const [mode,runtime]of [['production',production],['staging',preview]]){
        const env=loadEnv(mode,process.cwd(),'VITE_');
        for(const [client,server]of [['VITE_PROJECT_TRASH_ENABLED','PROJECT_TRASH_ENABLED'],['VITE_PUBLISHING_SPACES_REQUIRED','PUBLISHING_SPACE_REQUIRED'],['VITE_PERSONAL_SHARING_ENABLED','PERSONAL_SHARING_ENABLED'],['VITE_PUBLISHING_INVITATIONS_ENABLED','PUBLISHING_INVITATIONS_ENABLED']]){
            assert.equal(env[client],new RegExp('^'+server+' = "(true|false)"','m').exec(runtime)?.[1],`${mode}: ${client}`);
        }
    }
    const http=readFileSync(new URL('../server/private-authoring/http.js',import.meta.url),'utf8');
    assert.match(http,/requirePublishingSpace: requiresPublishingSpace\(env\)/);
    assert.doesNotMatch(http,/requirePublishingSpace: env\.PUBLISHING_SPACES_ENABLED/);
});

test('disabled share/trash menu keeps editing, copying and preview actions',()=>{
    const disabled=resolveStudioRollout();
    const markup=projectActionsMarkup({id:'book'},false,true,disabled);
    for(const action of ['edit','copy','preview','move'])assert.ok(markup.includes(`data-project-action="${action}"`));
    for(const action of ['share','delete'])assert.ok(!markup.includes(`data-project-action="${action}"`));
    const enabled=resolveStudioRollout({VITE_PROJECT_TRASH_ENABLED:'true',VITE_PERSONAL_SHARING_ENABLED:'true'});
    assert.equal(enabled.notifications,true);
    assert.equal(enabled.invitations,false);
    const preview=projectActionsMarkup({id:'book'},false,true,enabled);
    assert.ok(preview.includes('data-project-action="share"'));
    assert.ok(preview.includes('data-project-action="delete"'));
    assert.equal(resolveStudioRollout({VITE_PUBLISHING_INVITATIONS_ENABLED:'true'}).notifications,true);
});

test('disable new trash moves without stranding recovery; no source or publication mutations',async()=>{
    const f=maintenanceFixture();
    const api=createProjectTrashApi({verifyToken:async token=>{assert.equal(token,'fixture');return {uid:scope.uid};},service:createProjectTrashService({db:f.db,assertLiveIdentity:async()=>{},now:f.time})});
    const send=async(command,env={},token='fixture')=>api({env,request:new Request('https://studio.test/api/project-trash',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(command)})});
    const context=await(await send({kind:'context',projectId:scope.projectId})).json();
    const command={kind:'trash',projectId:scope.projectId,requestId:crypto.randomUUID(),baseRevision:context.revision,sourceVersion:context.sourceVersion};
    const original=structuredClone(f.docs);
    for(const env of [{},{PUBLISHING_SPACES_ENABLED:'true'},{PROJECT_TRASH_ENABLED:'false'}]){
        const denied=await send(command,env);assert.equal(denied.status,503);assert.equal((await denied.json()).error,'TRASH_UNAVAILABLE');
        assert.deepEqual(f.docs,original,'Disabled move must not write any metadata or source');
    }
    assert.equal((await send(command,{PROJECT_TRASH_ENABLED:'true',PUBLISHING_SPACES_ENABLED:'false'})).status,200);
    assert.ok(f.get(root).projectTrash);
    const after=await(await send({kind:'context',projectId:scope.projectId})).json();
    const restore={...command,kind:'restore',requestId:crypto.randomUUID(),baseRevision:after.revision,sourceVersion:after.sourceVersion};
    assert.equal((await send(restore,{PROJECT_TRASH_ENABLED:'false'})).status,200);
    assert.equal(f.get(root).projectTrash,null);
    assert.deepEqual(f.docs.get(child),original.get(child));
    assert.deepEqual(f.docs.get('public_projects/work_1'),original.get('public_projects/work_1'));
    assert.equal((await send({...restore,kind:'delete'})).status,400,'No legacy delete fallback');
});
