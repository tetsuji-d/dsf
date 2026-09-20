import assert from 'node:assert/strict';
import { createFirestoreStore, encodeFirestoreValue, decodeFirestoreValue } from '../../server/private-authoring/firestore.js';
import { createAuthoringMaintenance } from '../../server/private-authoring/maintenance.js';
import { createMaintenanceBackupStore } from '../../server/private-authoring/maintenance-common.js';
import { createAuthoringBucket } from '../../server/private-authoring/r2.js';
import { createAuthoringService } from '../../server/private-authoring/service.js';
import { createFlowGroupBlock } from '../../js/flow-project-model.js';
import { createPublicProjectProjection } from '../../js/project-persistence.js';
import { AuthoringApiError } from '../../server/private-authoring/common.js';
import { MemoryR2 } from './private-authoring-api-fixture.js';
export const scope = { uid: 'owner_1', projectId: 'project_1', generationId: 'generation_1' };
export const root = 'users/owner_1/projects/project_1', child = `${root}/authoring/current`, control = `${root}/authoringControl/current`, head = `${root}/authoringHeads/current`;
const clone = structuredClone;
export function maintenanceFixture() {
    let clock = 1_800_000_000_000, serial = 0, txSerial = 0, revoked = false, committedWrites = 0;
    const docs = new Map(), transactions = new Map();
    const typed = value => encodeFirestoreValue(value).mapValue.fields;
    const setFields = (path, fields) => docs.set(path, { fields: clone(fields), updateTime: new Date(1_700_000_000_000 + ++serial).toISOString(), createTime: docs.get(path)?.createTime || new Date(1_700_000_000_000).toISOString() });
    const set = (path, value) => setFields(path, typed(value));
    const get = path => docs.has(path) ? decodeFirestoreValue({ mapValue: { fields: docs.get(path).fields } }) : null;
    const source = { version: 6, projectId: scope.projectId, workId: 'work_1', title: '原稿', projectName: '移行試験', languages: ['ja', 'en'], defaultLang: 'ja',
        futurePrivate: { value: 'PRIVATE_SOURCE_SENTINEL', '10': 'ten', '2': 'two', src: 'prose: not an asset' }, blocks: [createFlowGroupBlock({ id: 'flow_1', sourceLanguage: 'ja',
            document: { schemaVersion: 2, id: 'doc_1', sections: [{ id: 'chapter_1', blocks: [{ id: 'p_1', type: 'paragraph', texts: { ja: '小説\r\n本文\n  😀 e\u0301  ', en: '  Exact\ntext  ' } }] }] } })] };
    set('users/owner_1', { uid: 'owner_1', status: { disabled: false, moderationHold: false } });
    set(root, { ...createPublicProjectProjection(source), ownerUid: scope.uid, releaseId: 'release_1', dsfStatus: 'public', visibility: 'public',
        publication: { publicFrom: new Date(clock - 100000), listedFrom: new Date(clock - 100000) }, unknownRoot: 'old private value' });
    docs.get(root).fields.lastUpdated = { timestampValue: '2026-09-19T01:02:03.123456789Z' };
    set(child, { ...source, lastUpdated: new Date(clock) });
    set('users/owner_1/works/work_1', { ownerUid: scope.uid, projectId: scope.projectId, latestReleaseId: 'release_1', title: '原稿' });
    set('users/owner_1/works/work_1/releases/release_1', { releaseId: 'release_1', title: 'Published' });
    set('public_projects/work_1', { authorUid: scope.uid, projectId: scope.projectId, releaseId: 'release_1' });
    const faults = { loseReply: false };
    const db = createFirestoreStore({ projectId: 'demo-maintenance', post: async (url, body) => {
        if (url.endsWith(':beginTransaction')) { const id = `tx_${++txSerial}`; transactions.set(id, { snapshot: clone(docs), reads: new Set() }); return { transaction: id }; }
        const t = transactions.get(body.transaction); assert(t);
        if (url.endsWith(':batchGet')) return body.documents.map(name => {
            const path = name.split('/documents/')[1]; t.reads.add(path); const raw = t.snapshot.get(path);
            return raw ? { found: { name, ...clone(raw) } } : { missing: name };
        });
        if (url.endsWith(':rollback')) { transactions.delete(body.transaction); return {}; }
        assert(url.endsWith(':commit'));
        for (const path of t.reads) if (docs.get(path)?.updateTime !== t.snapshot.get(path)?.updateTime) {
            const error = new AuthoringApiError('ABORTED'); error.aborted = true; throw error;
        }
        for (const write of body.writes) {
            const path = (write.delete || write.update.name).split('/documents/')[1];
            assert.equal(docs.has(path), write.currentDocument.exists);
            if (write.delete) docs.delete(path); else setFields(path, write.updateMask ? { ...docs.get(path).fields, ...write.update.fields } : write.update.fields);
            committedWrites++;
        }
        if (faults.loseReply && body.writes.some(write => write.update?.name.endsWith('/authoringControl/current'))) {
            faults.loseReply = false; throw new AuthoringApiError('UPSTREAM_UNAVAILABLE');
        }
        transactions.delete(body.transaction); return {};
    } });
    const rawBucket = new MemoryR2(), bucket = createAuthoringBucket(rawBucket);
    const authorize = async target => { if (revoked || target.uid !== scope.uid || target.projectId !== scope.projectId) throw new AuthoringApiError('MAINTENANCE_FORBIDDEN', 403); };
    const maintenance = createAuthoringMaintenance({ db, bucket, backups: createMaintenanceBackupStore(rawBucket), authorize, now: () => clock });
    const service = createAuthoringService({ db, bucket, assertLiveIdentity: () => authorize(scope), now: () => clock });
    return { docs, db, source, set, get, setFields, rawBucket, bucket, maintenance, service, faults,
        advance: ms => { clock += ms; }, revoke: () => { revoked = true; }, time: () => clock, writeCount: () => committedWrites };
}
