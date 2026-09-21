// Test-only workerd entry; not a Pages route.
import { createPublishingSpacesService, createPublishingSpacesApi } from '../../server/publishing-spaces.js';
import { createFirestoreStore, encodeFirestoreValue } from '../../server/private-authoring/firestore.js';
const prefix='projects/local-fixture/databases/(default)/documents/';
const docs=new Map([['users/owner_1',encodeFirestoreValue({uid:'owner_1',status:{disabled:false},entitlements:{canCreateProject:true}}).mapValue.fields]]);
const transactions=new Map();let serial=0;
const google={projectId:'local-fixture',async post(url,body){
    if(url.endsWith(':beginTransaction')){const id=String(++serial);transactions.set(id,structuredClone(docs));return {transaction:id};}
    const snapshot=transactions.get(body.transaction);if(!snapshot)throw Error('Missing transaction');
    if(url.endsWith(':batchGet'))return body.documents.map(name=>snapshot.has(name.slice(prefix.length))?{found:{name,fields:snapshot.get(name.slice(prefix.length))}}:{missing:name});
    if(url.endsWith(':commit')){for(const w of body.writes||[])docs.set(w.update.name.slice(prefix.length),w.update.fields);transactions.delete(body.transaction);return {};}
    if(url.endsWith(':rollback')){transactions.delete(body.transaction);return {};}
    throw Error('Unexpected database route');
}};
export default {async fetch(request,env){
    const service=createPublishingSpacesService({db:createFirestoreStore(google,{additionalRootCollections:['publishing_spaces']}),bucket:env.AUTHORING_BUCKET,assertLiveIdentity:async()=>{}});
    const handler=createPublishingSpacesApi({service,verifyToken:async token=>token==='fixture-owner'?{uid:'owner_1'}:null});
    return handler({request,env:{PUBLISHING_SPACES_ENABLED:'true'}});
}};
