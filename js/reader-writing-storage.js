export function createWritingDraftStorage(DB = 'dsf-writing-ui-v1') {
let opening;
function database() {
    return opening ||= new Promise((resolve,reject) => {
        const request = indexedDB.open(DB, 2);
        request.onupgradeneeded = () => {
            const db=request.result;
            if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts');
            db.createObjectStore('bases');db.createObjectStore('pages').createIndex('draftId','draftId');
        };
        request.onblocked=()=>{opening=null;reject(new Error('DRAFT_UPGRADE_BLOCKED'));};
        request.onsuccess = () => {request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
        request.onerror = () => {opening=null;reject(request.error);};
    });
}
async function readWritingDraft(id) {
    const db = await database();
    return new Promise((resolve,reject) => {
        const tx=db.transaction(['drafts','bases','pages']),get=tx.objectStore('drafts').get(id);let record;
        get.onsuccess=()=>{record=get.result;if(!record||record.storageVersion!==2)return;
            const base=tx.objectStore('bases').get(id),pages=tx.objectStore('pages').index('draftId').getAll(id);
            base.onsuccess=()=>record.bytes=base.result;
            pages.onsuccess=()=>record.envelope.document.pages=pages.result.map(({page})=>page);
        };
        tx.oncomplete=()=>resolve(record);tx.onabort=tx.onerror=()=>reject(Error('DRAFT_STORAGE_FAILED'));
    });
}
async function listWritingDrafts() {
    const db = await database();
    return new Promise((resolve,reject) => {const r = db.transaction('drafts').objectStore('drafts').openCursor(), list=[];
        r.onsuccess = () => {const cursor=r.result;if(!cursor){resolve(list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));return;}
            const {id,title,updatedAt,version}=cursor.value;list.push({id,title,updatedAt,version});cursor.continue();}; r.onerror = () => reject(r.error);});
}
/** Compare-and-swap in a single transaction. Never overwrite a different tab's newer draft. */
async function saveWritingDraft(record, expectedVersion) {
    const db = await database();
    return new Promise((resolve,reject) => {
        const tx = db.transaction(['drafts','bases','pages'],'readwrite'), store = tx.objectStore('drafts'); let conflict = false;
        const get = store.get(record.id);
        get.onsuccess = () => {
            if ((get.result?.version || 0) !== expectedVersion) {conflict = true; tx.abort(); return;}
            const {bytes,pages,envelope,...meta}=record,previous=get.result;
            if(!previous||previous.storageVersion!==2)tx.objectStore('bases').put(bytes||previous.bytes,record.id);
            // Migrating an old draft is atomic; untouched pages stay available.
            const changes=pages||envelope.document.pages;
            if(previous&&previous.storageVersion!==2)for(const page of previous.envelope.document.pages)
                tx.objectStore('pages').put({draftId:record.id,page},[record.id,page.language,page.pageId]);
            for(const page of changes){const key=[record.id,page.language,page.pageId];
                if(page.objects.length)tx.objectStore('pages').put({draftId:record.id,page},key);else tx.objectStore('pages').delete(key);}
            store.put({...meta,storageVersion:2,envelope:{...envelope,document:{...envelope.document,pages:[]}},version:expectedVersion+1,updatedAt:new Date().toISOString()},record.id);
        };
        tx.oncomplete = () => resolve(expectedVersion+1);
        tx.onabort = tx.onerror = () => reject(new Error(conflict ? 'DRAFT_CONFLICT' : 'DRAFT_STORAGE_FAILED'));
    });
}

return {readWritingDraft,listWritingDrafts,saveWritingDraft};
}
export const {readWritingDraft,listWritingDrafts,saveWritingDraft}=createWritingDraftStorage();
