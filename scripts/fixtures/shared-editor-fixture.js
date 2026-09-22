import {MemoryR2} from './private-authoring-api-fixture.js';
import {createSharedAuthoringService} from '../../server/shared-authoring.js';
import {createAuthoringBucket} from '../../server/private-authoring/r2.js';
import {createPrivateAuthoringSnapshot} from '../../js/private-authoring-storage.js';
import {createSharedAuthoringApi} from '../../server/shared-authoring-http.js';
export async function attachSharedEditorFixture(f,{initialObjects=[],persistObjects=async()=>{},now=Date.now}={}){
    const r2=new MemoryR2();for(const [key,obj]of initialObjects)r2.objects.set(key,{...obj,bytes:Uint8Array.from(obj.bytes)});
    let persistQueue=Promise.resolve();
    const originalPut=r2.put.bind(r2);r2.put=async(...args)=>{const result=await originalPut(...args);const snapshot=[...r2.objects].map(([key,obj])=>[key,{...obj,bytes:[...obj.bytes]}]);persistQueue=persistQueue.catch(()=>{}).then(()=>persistObjects(snapshot));await persistQueue;return result;};
    for(const [pid,wid,title]of [['book_library','work_library','潮騒の図書館'],['book_notes','work_notes','夜明けのノート']]){
        const root='users/owner_1/projects/'+pid;
        if(!f.docs.has(root+'/authoringHeads/current')){
            Object.assign(f.docs.get(root),{version:6,authoringBackend:'r2-private',authoringStorageVersion:1,authoringRef:'authoringHeads/current'});
            f.docs.set(root+'/authoringControl/current',{storageVersion:1,generationId:'fixture_generation',status:'active',initialized:false});
            const text='港の図書館に、灯台から一通の手紙が届いた。\n司書は封を開き、静かに読み始めた。';
            const snapshot=await createPrivateAuthoringSnapshot({version:6,projectId:pid,workId:wid,title,projectName:title,languages:['ja'],defaultLang:'ja',
                blocks:[{id:'paragraph_page',kind:'page',content:{pageKind:'text',background:'',text,texts:{ja:text},layers:[]}}]});
            const service=createSharedAuthoringService({db:f.db,bucket:createAuthoringBucket(r2),assertLiveIdentity:f.assertLiveIdentity,spaceId:'space_demo',workId:wid});
            await service.save({uid:'owner_1'},pid,{snapshot,requestId:'fixture_seed',generationId:'fixture_generation',baseRevision:0});
        }
    }
    const handler=createSharedAuthoringApi({now,db:f.db,privateBucket:r2,assertLiveIdentity:f.assertLiveIdentity,
        verifyToken:async token=>/^fixture-(owner_1|reader_1|reader_2|admin_1)$/.test(token)?{uid:token.slice(8)}:null});
    return {r2,handler};
}
