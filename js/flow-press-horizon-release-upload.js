/**
 * Press-runtime adapter for uploading an already verified Flow Horizon handoff.
 *
 * This unit may write immutable release files through /upload-release, but it
 * never writes Firestore metadata or changes Works/publication state.
 */

import { uploadDsfHorizonReleasePlan } from './dsf-horizon-release-upload.js';
import {
    FLOW_PRESS_HORIZON_HANDOFF_KIND,
    FLOW_PRESS_HORIZON_HANDOFF_VERSION,
    resolveFlowPressHorizonImageBlob,
} from './flow-press-horizon-release-handoff.js';

export const FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION = 1;
export const FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND = 'flow-press-horizon-upload-execution';

const INPUT_KEYS = new Set([
    'handoff',
    'getCurrentUser',
    'fetchImpl',
    'hashBytes',
    'signal',
    'onProgress',
    'dependencies',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function fail(code, path, message) {
    throw new FlowPressHorizonReleaseUploadError([{ severity: 'error', code, path, message }]);
}

function validateInput(input) {
    if (!isRecord(input)) fail('FLOW_HORIZON_UPLOAD_INPUT_INVALID', '', 'Flow Horizon upload requires an input object.');
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) fail('FLOW_HORIZON_UPLOAD_PROPERTY_UNSUPPORTED', key, 'Flow Horizon upload input contains an unsupported property.');
    }
    const handoff = input.handoff;
    if (!isRecord(handoff)
        || handoff.handoffVersion !== FLOW_PRESS_HORIZON_HANDOFF_VERSION
        || handoff.handoffKind !== FLOW_PRESS_HORIZON_HANDOFF_KIND
        || handoff.ready !== true
        || handoff.readyForUpload !== true
        || handoff.readyForMetadataWrite !== false
        || !isRecord(handoff.identity)
        || !isRecord(handoff.plan)) {
        fail('FLOW_HORIZON_UPLOAD_HANDOFF_NOT_READY', 'handoff', 'An upload-ready Flow Horizon handoff is required.');
    }
    if (typeof input.getCurrentUser !== 'function') {
        fail('FLOW_HORIZON_UPLOAD_USER_PROVIDER_REQUIRED', 'getCurrentUser', 'A current-user provider is required.');
    }
    if (input.dependencies !== undefined && !isRecord(input.dependencies)) {
        fail('FLOW_HORIZON_UPLOAD_DEPENDENCIES_INVALID', 'dependencies', 'dependencies must be an object when supplied.');
    }
}

function requireMatchingUser(input) {
    const user = input.getCurrentUser();
    const expectedUid = String(input.handoff.identity.uid || '').trim();
    if (!user || String(user.uid || '').trim() !== expectedUid) {
        fail('FLOW_HORIZON_UPLOAD_USER_MISMATCH', 'getCurrentUser', 'The current user does not own this Horizon release handoff.');
    }
    if (typeof user.getIdToken !== 'function') {
        fail('FLOW_HORIZON_UPLOAD_TOKEN_PROVIDER_MISSING', 'getCurrentUser.getIdToken', 'The current user cannot provide a Firebase access token.');
    }
    return user;
}

export class FlowPressHorizonReleaseUploadError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Flow Press Horizon upload failed.');
        this.name = 'FlowPressHorizonReleaseUploadError';
        this.code = 'DSF_FLOW_PRESS_HORIZON_UPLOAD_INVALID';
        this.issues = deepFreeze(Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : []);
    }
}

/**
 * Execute only the immutable file upload stage. The returned seal is suitable
 * for a later, separately authorized Firestore draft-write stage.
 */
export async function executeFlowPressHorizonReleaseUpload(input = {}) {
    validateInput(input);
    requireMatchingUser(input);
    const uploadReleasePlan = input.dependencies?.uploadReleasePlan || uploadDsfHorizonReleasePlan;
    if (typeof uploadReleasePlan !== 'function') {
        fail('FLOW_HORIZON_UPLOAD_TRANSPORT_INVALID', 'dependencies.uploadReleasePlan', 'Flow Horizon upload transport must be a function.');
    }

    const upload = await uploadReleasePlan({
        plan: input.handoff.plan,
        resolveImageBlob: async (file) => resolveFlowPressHorizonImageBlob(input.handoff, file),
        getAccessToken: async () => requireMatchingUser(input).getIdToken(),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.hashBytes ? { hashBytes: input.hashBytes } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });

    if (!isRecord(upload)
        || upload.readyForMetadataWrite !== true
        || !isRecord(upload.seal)
        || upload.seal.readyForMetadataWrite !== true
        || !Array.isArray(upload.receipts)
        || !isRecord(upload.summary)
        || upload.identity?.uid !== input.handoff.identity.uid
        || upload.identity?.workId !== input.handoff.identity.workId
        || upload.identity?.releaseId !== input.handoff.identity.releaseId) {
        fail('FLOW_HORIZON_UPLOAD_RESULT_INVALID', 'upload', 'Horizon upload result does not match the verified Flow handoff.');
    }

    return deepFreeze({
        executionVersion: FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION,
        executionKind: FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND,
        readyForMetadataWrite: true,
        identity: { ...upload.identity },
        receipts: upload.receipts,
        seal: upload.seal,
        summary: { ...upload.summary },
    });
}
