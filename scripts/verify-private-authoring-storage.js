import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { createFlowTranslationLanguageBaseline } from '../js/flow-translation-state.js';
import { prepareProjectForSave, assertFirestoreAuthoringSize } from '../js/project-persistence.js';
import {
    PRIVATE_AUTHORING_MAX_BYTES, PRIVATE_AUTHORING_HEAD_MAX_BYTES,
    PRIVATE_AUTHORING_MAX_DEPTH, PRIVATE_AUTHORING_MAX_NODES,
    createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor,
    assertPrivateAuthoringDescriptor, assertPrivateAuthoringHead,
    privateAuthoringObjectKey, readPrivateAuthoringSnapshot, planPrivateAuthoringCommit,
} from '../js/private-authoring-storage.js';

const clone = (value) => structuredClone(value);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scope = { uid: 'owner_1', projectId: 'project_1', generationId: 'generation_1' };
const code = (expected) => (error) => error.code === expected;
const simple = () => ({ version: 6, projectId: 'project_1', blocks: [], languages: ['ja'], defaultLang: 'ja' });
function mixed() {
    const flow = createFlowGroupBlock({
        id: 'flow_1', sourceLanguage: 'ja',
        document: { id: 'document_1', schemaVersion: 2, sections: [{
            id: 'chapter_1', title: { ja: '章', 'en-us': 'Chapter' }, blocks: [{
                id: 'paragraph_1', type: 'paragraph',
                texts: { ja: '小説\r\n本文\n  😀 e\u0301\u2028末尾  ', 'en-us': '  Exact\r\nEnglish  ' },
                annotations: { ja: [{ id: 'ruby_1', type: 'ruby', start: 0, end: 2, reading: 'しょうせつ' }] },
                futureParagraph: { keep: true },
            }],
        }] },
    });
    flow.flow.translationState = {
        schemaVersion: 1,
        languages: { 'en-us': createFlowTranslationLanguageBaseline(flow, 'en-us', {
            origin: 'machine', reviewState: 'needs-review',
        }) },
        futureTranslation: { keep: true },
    };
    return {
        ...simple(), languages: ['ja', 'en-us'],
        blocks: [{ id: 'fixed_1', kind: 'page', futureFixed: { keep: true }, content: {
            pageKind: 'text', text: '固定本文', texts: { ja: '固定本文' },
            layers: [{ id: 'shape_1', type: 'shape', futureShape: { keep: true } }],
        } }, flow],
        futureProject: { updatedAt: 'author-controlled text', alpha: true, '10': 'ten', '2': 'two' },
    };
}
const snapshot = await createPrivateAuthoringSnapshot(mixed());
const descriptor = createPrivateAuthoringDescriptor(snapshot, scope, 'request_1');
const plan = (overrides = {}) => planPrivateAuthoringCommit({
    scope, projectStatus: 'active', baseRevision: 0, candidate: descriptor, ...overrides,
});

await test('mixed Fixed/Flow source, annotations, translations and unknown fields round-trip exactly', async () => {
    const input = mixed();
    const before = clone(input);
    const stored = await createPrivateAuthoringSnapshot(input);
    assert.deepEqual(input, before);
    assert.deepEqual(stored.project, prepareProjectForSave(input));
    assert.deepEqual(await readPrivateAuthoringSnapshot(Buffer.from(stored.json), descriptor, scope), stored.project);
    assert.deepEqual(stored.project.blocks[1].flow, input.blocks[1].flow);
    assert.deepEqual(stored.project.blocks[0].futureFixed, input.blocks[0].futureFixed);
    assert.deepEqual(stored.project.futureProject, input.futureProject);
    assert.equal(stored.byteLength, Buffer.byteLength(stored.json));
    assert.equal(stored.sha256, digest(stored.json));
});

await test('snapshot captures before hashing and remains detached and deeply immutable', async () => {
    const input = mixed();
    const pending = createPrivateAuthoringSnapshot(input);
    input.blocks[1].flow.document.sections[0].blocks[0].texts.ja = 'new edit';
    const stored = await pending;
    assert.equal(stored.sha256, snapshot.sha256);
    assert.throws(() => { stored.project.blocks[0].content.text = 'changed'; }, TypeError);
    assert.throws(() => { stored.json = '{}'; }, TypeError);
});

await test('object property order and root operation fields do not change content hash', async () => {
    function reverseKeys(value) {
        if (Array.isArray(value)) return value.map(reverseKeys);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse()
            .map(([key, entry]) => [key, reverseKeys(entry)]));
        return value;
    }
    const input = reverseKeys(mixed());
    Object.assign(input, { updatedAt: new Date(), lastUpdated: new Date(), publication: { server: true },
        authoringBackend: 'r2-private', authoringRef: 'authoringHeads/current', revision: 27, generationId: 'old' });
    const stored = await createPrivateAuthoringSnapshot(input);
    assert.equal(stored.json, snapshot.json);
    assert.equal((await createPrivateAuthoringSnapshot(stored.project)).json, stored.json);
    for (const key of ['updatedAt', 'publication', 'authoringRef', 'revision', 'generationId']) {
        assert.equal(Object.hasOwn(stored.project, key), false);
    }
    const reordered = mixed();
    reordered.blocks.reverse();
    assert.notEqual((await createPrivateAuthoringSnapshot(reordered)).sha256, snapshot.sha256);
});

await test('100k Japanese characters plus translations can exceed the old limit without truncation', async () => {
    const input = mixed();
    const paragraph = input.blocks[1].flow.document.sections[0].blocks[0];
    delete paragraph.annotations;
    delete input.blocks[1].flow.translationState;
    input.languages = ['ja', 'en', 'ko', 'zh'];
    paragraph.texts = { ja: 'あ'.repeat(100_000), en: 'b'.repeat(100_000), ko: '한'.repeat(100_000), zh: '文'.repeat(100_000) };
    const stored = await createPrivateAuthoringSnapshot(input);
    assert.throws(() => assertFirestoreAuthoringSize(stored.project), code('FIRESTORE_AUTHORING_TOO_LARGE'));
    const desc = createPrivateAuthoringDescriptor(stored, scope, 'novel');
    const restored = await readPrivateAuthoringSnapshot(Buffer.from(stored.json), desc, scope);
    assert.deepEqual(restored.blocks[1].flow.document.sections[0].blocks[0].texts, paragraph.texts);
    console.log(`100k-character multilingual fixture: ${stored.byteLength} UTF-8 bytes`);
});

await test('exact 16 MiB boundary accepted; one extra byte and multibyte overflow rejected', async () => {
    const base = { ...simple(), padding: '' };
    const overhead = (await createPrivateAuthoringSnapshot(base)).byteLength;
    base.padding = 'x'.repeat(PRIVATE_AUTHORING_MAX_BYTES - overhead);
    assert.equal((await createPrivateAuthoringSnapshot(base)).byteLength, PRIVATE_AUTHORING_MAX_BYTES);
    await assert.rejects(createPrivateAuthoringSnapshot({ ...base, padding: base.padding + 'x' }), code('AUTHORING_TOO_LARGE'));
    await assert.rejects(createPrivateAuthoringSnapshot({ ...base, padding: 'あ'.repeat(Math.ceil(PRIVATE_AUTHORING_MAX_BYTES / 3)) }), code('AUTHORING_TOO_LARGE'));
});

await test('malformed JSON values and excessive depth/node count fail closed', async () => {
    const circular = {}; circular.self = circular;
    const sparse = Array(1);
    const getter = Object.defineProperty({}, 'trap', { enumerable: true, get() { throw new Error('must not execute'); } });
    const extended = []; extended.extra = 'would disappear';
    for (const value of [undefined, Infinity, NaN, 1n, () => 1, new Date(), circular, sparse, getter, extended,
        { [Symbol('hidden')]: 'value' }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
        await assert.rejects(createPrivateAuthoringSnapshot({ ...simple(), future: value }), code('AUTHORING_NOT_JSON_SAFE'));
    }
    let deep = {};
    for (let index = 0; index <= PRIVATE_AUTHORING_MAX_DEPTH; index += 1) deep = { nested: deep };
    await assert.rejects(createPrivateAuthoringSnapshot({ ...simple(), deep }), code('AUTHORING_COMPLEXITY_LIMIT'));
    await assert.rejects(createPrivateAuthoringSnapshot({ ...simple(), wide: Array(PRIVATE_AUTHORING_MAX_NODES).fill(0) }), code('AUTHORING_COMPLEXITY_LIMIT'));
});

await test('legacy/future schemas, invalid Flow, runtime pages and credentials are rejected', async () => {
    for (const version of [undefined, 5, 7]) {
        const input = simple(); if (version === undefined) delete input.version; else input.version = version;
        await assert.rejects(createPrivateAuthoringSnapshot(input), code('UNSUPPORTED_AUTHORING_PROJECT'));
    }
    for (const key of ['generatedPages', 'paginationCache', 'currentUser', 'idToken', 'auth']) {
        await assert.rejects(createPrivateAuthoringSnapshot({ ...simple(), [key]: {} }), code('AUTHORING_RUNTIME_DATA'));
    }
    for (const mutate of [
        (flow) => { flow.document.schemaVersion = 999; },
        (flow) => { flow.layout.schemaVersion = 999; },
        (flow) => { flow.document.generatedPages = []; },
        (flow) => { flow.translationState.schemaVersion = 999; },
        (flow) => { flow.translationState.providerId = 'must not persist'; },
        (flow) => { flow.document.sections[0].blocks[0].type = 'future'; },
    ]) {
        const input = mixed(); mutate(input.blocks[1].flow);
        await assert.rejects(createPrivateAuthoringSnapshot(input), code('FLOW_PROJECT_INVALID'));
    }
});

await test('descriptor path is derived from scope, never a caller URL or arbitrary object key', () => {
    assert.equal(descriptor.objectKey, 'users/owner_1/projects/project_1/generations/generation_1/revisions/request_1.json');
    for (const id of ['', '../other', 'a/b', 'a\\b', '%2f', 'https://example.com', 'x'.repeat(129), ' padded ']) {
        assert.throws(() => privateAuthoringObjectKey(scope, id), code('INVALID_AUTHORING_ID'));
        assert.throws(() => privateAuthoringObjectKey({ ...scope, uid: id }, 'r'), code('INVALID_AUTHORING_ID'));
    }
    assert.throws(() => assertPrivateAuthoringDescriptor(descriptor, { ...scope, uid: 'other' }), code('AUTHORING_SCOPE_MISMATCH'));
    assert.throws(() => createPrivateAuthoringDescriptor(snapshot, { ...scope, projectId: 'other' }, 'r'), code('AUTHORING_SCOPE_MISMATCH'));
    assert.throws(() => assertPrivateAuthoringDescriptor({ ...descriptor, objectKey: 'public/file.json' }, scope), code('AUTHORING_SCOPE_MISMATCH'));
});

await test('descriptor/head versions, hashes, sizes, exact keys and revision integers are strict', () => {
    for (const change of [{ storageVersion: 2 }, { projectSchemaVersion: 7 }, { sha256: 'etag' },
        { sha256: descriptor.sha256.toUpperCase() }, { byteLength: 0 }, { byteLength: 1.5 },
        { byteLength: PRIVATE_AUTHORING_MAX_BYTES + 1 }, { unexpected: true }]) {
        assert.throws(() => assertPrivateAuthoringDescriptor({ ...descriptor, ...change }, scope));
    }
    const missing = { ...descriptor }; delete missing.sha256;
    assert.throws(() => assertPrivateAuthoringDescriptor(missing, scope), code('INVALID_AUTHORING_DESCRIPTOR'));
    assert.throws(() => assertPrivateAuthoringDescriptor({ ...descriptor, padding: 'x'.repeat(PRIVATE_AUTHORING_HEAD_MAX_BYTES) }, scope), code('AUTHORING_TOO_LARGE'));
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => assertPrivateAuthoringHead({ ...descriptor, revision }, scope), code('INVALID_AUTHORING_REVISION'));
    }
});

await test('read rejects missing, truncated, corrupted, malformed and future-schema bytes', async () => {
    await assert.rejects(readPrivateAuthoringSnapshot(null, descriptor, scope), code('AUTHORING_BYTES_REQUIRED'));
    await assert.rejects(readPrivateAuthoringSnapshot(Buffer.from(snapshot.json.slice(1)), descriptor, scope), code('AUTHORING_SIZE_MISMATCH'));
    const damaged = Buffer.from(snapshot.json); damaged[10] ^= 1;
    await assert.rejects(readPrivateAuthoringSnapshot(damaged, descriptor, scope), code('AUTHORING_HASH_MISMATCH'));
    for (const [bytes, expectedCode] of [
        [Buffer.from('{'), 'AUTHORING_INVALID_JSON'],
        [Buffer.from([0xff]), 'AUTHORING_INVALID_JSON'],
        [Buffer.from(JSON.stringify({ ...snapshot.project, version: 7 })), 'UNSUPPORTED_AUTHORING_PROJECT'],
        [Buffer.from(JSON.stringify({ ...snapshot.project, authoringRef: 'server-only' })), 'AUTHORING_OPERATIONAL_DATA'],
        [Buffer.from(' ' + snapshot.json), 'AUTHORING_NONCANONICAL_JSON'],
        [Buffer.from(snapshot.json.replace('project_1', 'project_2')), 'AUTHORING_SCOPE_MISMATCH'],
    ]) {
        const desc = { ...descriptor, sha256: digest(bytes), byteLength: bytes.length };
        await assert.rejects(readPrivateAuthoringSnapshot(bytes, desc, scope), code(expectedCode));
    }
});

await test('read captures bytes and descriptor before asynchronous integrity check', async () => {
    const bytes = Buffer.from(snapshot.json);
    const desc = { ...descriptor };
    const mutableScope = { ...scope };
    const pending = readPrivateAuthoringSnapshot(bytes, desc, mutableScope);
    mutableScope.projectId = 'other';
    bytes.fill(0); desc.sha256 = '0'.repeat(64); desc.byteLength = 1;
    assert.deepEqual(await pending, snapshot.project);
});

await test('first commit, exact retry, duplicate content and two concurrent writers', async () => {
    const first = plan();
    assert.equal(first.action, 'commit');
    assert.equal(first.head.revision, 1);
    assert.equal(plan({ currentHead: first.head }).action, 'replay');
    const retryId = createPrivateAuthoringDescriptor(snapshot, scope, 'request_2');
    assert.equal(plan({ currentHead: first.head, baseRevision: 1, candidate: retryId }).action, 'unchanged');
    assert.throws(() => plan({ currentHead: first.head, candidate: retryId }), code('AUTHORING_REVISION_CONFLICT'));
    const changed = await createPrivateAuthoringSnapshot({ ...mixed(), title: 'edited' });
    const candidate = createPrivateAuthoringDescriptor(changed, scope, 'request_3');
    const second = plan({ currentHead: first.head, baseRevision: 1, candidate });
    assert.equal(second.head.revision, 2);
    const rival = createPrivateAuthoringDescriptor(snapshot, scope, 'request_4');
    assert.throws(() => plan({ currentHead: second.head, baseRevision: 1, candidate: rival }), code('AUTHORING_REVISION_CONFLICT'));
    assert.throws(() => plan({ currentHead: second.head, candidate: descriptor }), code('AUTHORING_REVISION_CONFLICT'),
        'a delayed retry cannot roll back a newer head; older receipts require the future ledger');
    assert.throws(() => { second.head.revision = 0; }, TypeError);
});

await test('reused request IDs, deleted projects, old generations and unsafe revisions never commit', () => {
    const first = plan().head;
    assert.throws(() => plan({ currentHead: first, candidate: { ...descriptor, sha256: 'f'.repeat(64) } }), code('AUTHORING_REQUEST_REUSED'));
    assert.throws(() => plan({ currentHead: first, baseRevision: 1 }), code('AUTHORING_REQUEST_REUSED'));
    for (const projectStatus of ['deleting', 'deleted', undefined, 'unknown']) {
        assert.throws(() => plan({ currentHead: first, projectStatus }), code('AUTHORING_NOT_ACTIVE'));
    }
    assert.throws(() => plan({ scope: { ...scope, generationId: 'new_generation' }, currentHead: first }), code('AUTHORING_GENERATION_CONFLICT'));
    assert.throws(() => plan({ baseRevision: -1 }), code('INVALID_AUTHORING_REVISION'));
    const maxHead = { ...first, revision: Number.MAX_SAFE_INTEGER };
    const candidate = { ...descriptor, revisionId: 'overflow', objectKey: privateAuthoringObjectKey(scope, 'overflow'), sha256: 'f'.repeat(64) };
    assert.throws(() => plan({ currentHead: maxHead, baseRevision: maxHead.revision, candidate }), code('INVALID_AUTHORING_REVISION'));
});

await test('Fixed-only v6 and FlowDocument v1 remain compatible', async () => {
    const input = mixed();
    const flow = input.blocks[1].flow;
    flow.document.schemaVersion = 1;
    delete flow.document.sections[0].blocks[0].annotations;
    const stored = await createPrivateAuthoringSnapshot(input);
    const desc = createPrivateAuthoringDescriptor(stored, scope, 'flow_v1');
    assert.deepEqual(await readPrivateAuthoringSnapshot(Buffer.from(stored.json), desc, scope), stored.project);
    assert.equal(stored.project.blocks[1].flow.document.schemaVersion, 1);
    input.blocks.pop();
    const fixed = await createPrivateAuthoringSnapshot(input);
    assert.equal(fixed.project.version, 6);
    assert.equal(fixed.project.blocks.length, 1);
    const fixedDesc = createPrivateAuthoringDescriptor(fixed, scope, 'fixed');
    assert.deepEqual(await readPrivateAuthoringSnapshot(Buffer.from(fixed.json), fixedDesc, scope), fixed.project);
});