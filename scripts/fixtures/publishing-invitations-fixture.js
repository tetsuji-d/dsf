import {createSpaceDirectoryService,validateSpaceInvitationTargets} from '../../server/publishing-space-directory.js';
import assert from 'node:assert/strict';
import {check} from '../../server/private-authoring/common.js';
import {createPublishingInvitationsService,createPublishingInvitationsApi} from '../../server/publishing-invitations.js';
export function invitationsFixture({initialDocs=null,persist=async()=>{},allowActivation=true}={}) {
    const docs=new Map(initialDocs||[]);let clock=Date.now(),queue=Promise.resolve(),revoked=false;
    if(!initialDocs){
        for(const [uid,displayName] of [['owner_1','山口（招待者）'],['reader_1','佐藤（招待先）'],['reader_2','鈴木（別アカウント）'],['admin_1','田中（管理者）']])
            docs.set('users/'+uid,{uid,displayName,status:{disabled:false,moderationHold:false},entitlements:{canCreateProject:true}});
        docs.set('publishing_spaces/space_demo',{ownerUid:'owner_1',name:'灯台出版'});
        docs.set('users/admin_1/spaceMemberships/space_demo',{uid:'admin_1',spaceId:'space_demo',role:'admin',status:'active',grants:[]});
        docs.set('publishing_labels/label_sea',{spaceId:'space_demo',name:'海辺文庫'});
        docs.set('publishing_work_scopes/work_library',{spaceId:'space_demo',labelId:'label_sea',title:'潮騒の図書館'});
        docs.set('publishing_work_scopes/work_other',{spaceId:'space_else',labelId:null,title:'別スペースの原稿'});
    }
    const db={async transaction(callback){
        const prev=queue;let release;queue=new Promise(r=>release=r);await prev;
        const reads=new Set(),writes=new Map();
        try{
            const result=await callback({async getMany(paths){assert.equal(writes.size,0,'reads must precede all writes');paths.forEach(p=>reads.add(p));return paths.map(p=>structuredClone(docs.get(p)??null));},
                set(path,value){assert(reads.has(path),'write must follow read');writes.set(path,structuredClone(value));},
                patch(path,value){assert(reads.has(path)&&docs.has(path));writes.set(path,{...structuredClone(docs.get(path)),...structuredClone(value)});}});
            if(writes.size){const updated=new Map(docs);for(const [p,v]of writes)updated.set(p,v);await persist([...updated]);docs.clear();for(const [p,v]of updated)docs.set(p,v);}
            return structuredClone(result);
        }finally{release();}
    }};
    // Upgrade only fixture metadata, preserving invitations, memberships and account status.
    for(const [uid,handle] of [['owner_1','yamaguchi'],['reader_1','sato'],['reader_2','suzuki'],['admin_1','tanaka']]){
        const user=docs.get('users/'+uid);if(user&&!user.publicProfile)user.publicProfile={handle,displayName:user.displayName};
        if(!docs.has('handles/'+handle))docs.set('handles/'+handle,{uid,handle});
    }
    const seeds={
        'users/owner_1/publishing/catalogue':{schemaVersion:1,revision:0,spaceIds:['space_demo'],assignments:{book_library:'space_demo',book_notes:'space_demo'}},
        'users/owner_1/projects/book_library':{ownerUid:'owner_1',projectId:'book_library',workId:'work_library',title:'潮騒の図書館'},
        'users/owner_1/projects/book_notes':{ownerUid:'owner_1',projectId:'book_notes',workId:'work_notes',title:'夜明けのノート'},
        'users/owner_1/works/work_library':{ownerUid:'owner_1',projectId:'book_library'},
        'users/owner_1/works/work_notes':{ownerUid:'owner_1',projectId:'book_notes'},
        'publishing_space_catalogues/space_demo':{schemaVersion:1,workIds:['work_library','work_notes']},
        'publishing_work_scopes/work_notes':{spaceId:'space_demo',ownerUid:'owner_1',projectId:'book_notes',workId:'work_notes',labelId:null}
    };
    for(const [p,v]of Object.entries(seeds))if(!docs.has(p))docs.set(p,v);
    const binding=docs.get('publishing_work_scopes/work_library');if(binding&&!binding.ownerUid)Object.assign(binding,{ownerUid:'owner_1',projectId:'book_library',workId:'work_library'});
    const assertLiveIdentity=async()=>check(!revoked,'AUTH_REVOKED',401);
    db.listMembershipPaths=async(uid,afterSpaceId)=>[...docs.keys()].filter(p=>{const v=p.split('/');return v.length===4&&v[0]==='users'&&v[1]===uid&&v[2]==='spaceMemberships'&&(!afterSpaceId||v[3]>afterSpaceId);}).sort().slice(0,21);
    db.listMemberPaths=async(spaceId,afterUid)=>[...docs.keys()].filter(p=>{const v=p.split('/');return v.length===4&&v[0]==='users'&&v[2]==='spaceMemberships'&&v[3]===spaceId&&(!afterUid||v[1]>afterUid);}).sort().slice(0,21);
    const directory=createSpaceDirectoryService({db,assertLiveIdentity,now:()=>clock});
    const service=createPublishingInvitationsService({db,now:()=>clock,allowActivation,validateScopeTargets:validateSpaceInvitationTargets,
        assertLiveIdentity});
    const handler=createPublishingInvitationsApi({service,directory,verifyToken:async token=>/^fixture-(owner_1|reader_1|reader_2|admin_1)$/.test(token)?{uid:token.slice(8)}:null});
    const env={PUBLISHING_INVITATIONS_ENABLED:'true'};
    return {docs,db,service,directory,handler,env,assertLiveIdentity,advance:ms=>clock+=ms,revoke:()=>revoked=true,
        call:(uid,command)=>service.execute({uid},command)};
}
