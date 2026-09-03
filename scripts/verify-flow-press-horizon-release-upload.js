import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    FLOW_PRESS_HORIZON_HANDOFF_KIND,
    FLOW_PRESS_HORIZON_HANDOFF_VERSION,
} from '../js/flow-press-horizon-release-handoff.js';
import {
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND,
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION,
    FlowPressHorizonReleaseUploadError,
    executeFlowPressHorizonReleaseUpload,
} from '../js/flow-press-horizon-release-upload.js';

const identity = { uid: 'owner-1', workId: 'work-1', releaseId: 'release-1' };
const handoff = Object.freeze({
    handoffVersion: FLOW_PRESS_HORIZON_HANDOFF_VERSION,
    handoffKind: FLOW_PRESS_HORIZON_HANDOFF_KIND,
    ready: true,
    readyForUpload: true,
    readyForMetadataWrite: false,
    identity: Object.freeze({ ...identity }),
    plan: Object.freeze({ identity: Object.freeze({ ...identity }) }),
    imageFiles: Object.freeze([]),
});

let currentUser = { uid: identity.uid, async getIdToken() { return 'token-1'; } };
let uploadCalls = 0;
const progress = [];
const execution = await executeFlowPressHorizonReleaseUpload({
    handoff,
    getCurrentUser: () => currentUser,
    onProgress: (value) => progress.push(value),
    dependencies: {
        async uploadReleasePlan(input) {
            uploadCalls += 1;
            assert.equal(input.plan, handoff.plan);
            assert.equal(await input.getAccessToken(), 'token-1');
            input.onProgress({ phase: 'uploaded', completedFileCount: 2, fileCount: 2 });
            return {
                readyForMetadataWrite: true,
                identity: { ...identity },
                receipts: [],
                seal: { readyForMetadataWrite: true },
                summary: { fileCount: 2, totalBytes: 100 },
            };
        },
    },
});
assert.equal(uploadCalls, 1);
assert.equal(execution.executionVersion, FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION);
assert.equal(execution.executionKind, FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND);
assert.equal(execution.readyForMetadataWrite, true);
assert.deepEqual(execution.identity, identity);
assert.equal(progress.length, 1);
assert.equal(Object.isFrozen(execution), true);

currentUser = { uid: 'other-owner', async getIdToken() { return 'wrong-token'; } };
await assert.rejects(
    () => executeFlowPressHorizonReleaseUpload({
        handoff,
        getCurrentUser: () => currentUser,
        dependencies: { uploadReleasePlan: async () => { throw new Error('must not upload'); } },
    }),
    (error) => error instanceof FlowPressHorizonReleaseUploadError
        && error.issues[0].code === 'FLOW_HORIZON_UPLOAD_USER_MISMATCH',
);

currentUser = { uid: identity.uid, async getIdToken() { return 'token-2'; } };
await assert.rejects(
    () => executeFlowPressHorizonReleaseUpload({
        handoff,
        getCurrentUser: () => currentUser,
        dependencies: {
            async uploadReleasePlan(input) {
                currentUser = { uid: 'switched-owner', async getIdToken() { return 'wrong-token'; } };
                await input.getAccessToken();
            },
        },
    }),
    (error) => error instanceof FlowPressHorizonReleaseUploadError
        && error.issues[0].code === 'FLOW_HORIZON_UPLOAD_USER_MISMATCH',
);

currentUser = { uid: identity.uid, async getIdToken() { return 'token-3'; } };
await assert.rejects(
    () => executeFlowPressHorizonReleaseUpload({
        handoff,
        getCurrentUser: () => currentUser,
        dependencies: {
            async uploadReleasePlan() {
                return {
                    readyForMetadataWrite: true,
                    identity: { ...identity, releaseId: 'other-release' },
                    seal: {},
                    receipts: [],
                    summary: {},
                };
            },
        },
    }),
    (error) => error instanceof FlowPressHorizonReleaseUploadError
        && error.issues[0].code === 'FLOW_HORIZON_UPLOAD_RESULT_INVALID',
);

const adapterSource = readFileSync(new URL('../js/flow-press-horizon-release-upload.js', import.meta.url), 'utf8');
for (const forbidden of ['./firebase', './press', 'setDoc(', 'writeBatch(', 'public_projects', 'localStorage']) {
    assert.equal(adapterSource.includes(forbidden), false, `upload adapter cannot depend on ${forbidden}`);
}

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-horizon-release-upload\.js'\)/);
assert.match(pressSource, /export function uploadFlowHorizonReleaseFiles/);
assert.match(pressSource, /if \(hasFlowGroups\(state\)\)[\s\S]*await uploadFlowHorizonReleaseFiles\(\)/,
    'Flow publish execution must use the verified upload boundary');
assert.match(pressSource, /requestPressRenderCancel\(\)[\s\S]*_pressFlowHorizonUploadController\?\.abort\(\)/,
    'the shared cancel action must abort an active Flow upload');
assert.match(pressSource, /_pressFlowHorizonUploadState === 'working'[\s\S]*_pressFlowHorizonDraftState === 'working'/,
    'the Flow draft button must remain disabled during upload and metadata write');

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(appSource, /isReadyFlowHorizonPublishControl/);
assert.match(appSource, /!flowPortableReady\s*&& !flowHorizonReady/,
    'auth UI must preserve a ready Flow Horizon draft-save control');

console.log('Flow Press Horizon upload execution boundary verification passed.');
