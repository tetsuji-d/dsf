import { createProjectActions } from './actions.js';
import { createReleaseVerifier } from './release-verifier.js';
import { createPrivateAuthoringSnapshot, PRIVATE_AUTHORING_MAX_BYTES, PrivateAuthoringError } from '../../js/private-authoring-storage.js';
import { AuthoringApiError, check, parseJson, readBounded, segment } from './common.js';
import { createGoogleClient, createIdTokenVerifier } from './google-auth.js';
import { createFirestoreStore } from './firestore.js';
import { createAuthoringBucket } from './r2.js';
import { createAuthoringService } from './service.js';

const headers = () => ({ 'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin' });
function json(data, status = 200) { return Response.json(data, { status, headers: headers() }); }

// The envelope may contain text beginning with "blob:". Check only existing asset slots.
function assertResolvedAssets(project) {
    function owner(value) {
        if (!value || typeof value !== 'object') return;
        for (const key of ['background', 'thumbnail', 'publicationThumbnailUrl']) {
            check(typeof value[key] !== 'string' || !/^blob:/i.test(value[key]), 'ASSETS_NOT_RESOLVED', 422);
        }
        for (const url of Object.values(value.backgrounds || {})) {
            check(typeof url !== 'string' || !/^blob:/i.test(url), 'ASSETS_NOT_RESOLVED', 422);
        }
        for (const layer of value.layers || []) {
            owner(layer);
            if (layer.type === 'image') check(typeof layer.src !== 'string' || !/^blob:/i.test(layer.src), 'ASSETS_NOT_RESOLVED', 422);
        }
    }
    owner(project);
    for (const asset of project.projectAssets || []) owner(asset);
    for (const block of project.blocks || []) owner(block.content);
    for (const page of project.pages || []) owner(page);
    for (const section of project.sections || []) owner(section);
}
function testProjects(env) {
    let entries;
    try { entries = JSON.parse(env.AUTHORING_TEST_PROJECTS); } catch { throw new AuthoringApiError('CONFIG_TEST_PROJECTS'); }
    check(Array.isArray(entries) && entries.length > 0 && entries.length <= 20
        && entries.every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/.test(value)), 'CONFIG_TEST_PROJECTS');
    return entries;
}

/** Dependencies are injected in tests only. Public routes construct their own runtime. */
export function createAuthoringApi({ verifyToken, service, actions }) {
    return async ({ request, env, params }) => {
        try {
            check(env?.AUTHORING_API_ENABLED === 'true', 'AUTHORING_API_DISABLED');
            const allowlist = testProjects(env);
            const origin = request.headers.get('Origin');
            check(!origin || origin === new URL(request.url).origin, 'ORIGIN_FORBIDDEN', 403);
            const actionRoute = params.actionRoute === true;
            const operationRoute = params.requestId !== undefined;
            check(actionRoute ? ['GET', 'POST'].includes(request.method) : operationRoute ? request.method === 'GET' : ['GET', 'PUT'].includes(request.method), 'METHOD_NOT_ALLOWED', 405);
            const projectId = segment(params.projectId);
            const requestId = operationRoute ? segment(params.requestId) : undefined;
            const authorization = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
            check(authorization, 'AUTH_REQUIRED', 401);
            const identity = await verifyToken(authorization[1]);
            check(identity?.uid, 'AUTH_INVALID', 401);
            check(allowlist.includes(`${identity.uid}/${projectId}`), 'PROJECT_NOT_ENABLED', 403);
            if (actionRoute) {
                check(actions, 'AUTHORING_API_DISABLED');
                if (request.method === 'GET') return json(await actions.context(identity, projectId));
                check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''), 'CONTENT_TYPE_INVALID', 415);
                check(!request.headers.has('Content-Encoding') || request.headers.get('Content-Encoding') === 'identity', 'CONTENT_ENCODING_INVALID', 415);
                const command = parseJson(await readBounded(request.body, 768 * 1024));
                return json(await actions.execute(identity, projectId, command));
            }
            if (operationRoute) {
                const generationId = segment(request.headers.get('X-Authoring-Generation'));
                const context = await service.access(identity, projectId, { requestId, generationId });
                return json(service.operation(context));
            }
            if (request.method === 'GET') {
                const context = await service.access(identity, projectId);
                const result = await service.load(identity, projectId, context);
                return new Response(result.bytes, { headers: { ...headers(), 'X-Authoring-Head': JSON.stringify(result.head) } });
            }
            const generationId = segment(request.headers.get('X-Authoring-Generation'));
            const id = segment(request.headers.get('X-Authoring-Request-Id'));
            const base = request.headers.get('X-Authoring-Base-Revision');
            check(typeof base === 'string' && /^(0|[1-9]\d{0,15})$/.test(base) && Number.isSafeInteger(Number(base)), 'INVALID_BASE_REVISION', 400);
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''), 'CONTENT_TYPE_INVALID', 415);
            check(!request.headers.has('Content-Encoding') || request.headers.get('Content-Encoding') === 'identity', 'CONTENT_ENCODING_INVALID', 415);
            const length = request.headers.get('Content-Length');
            if (length !== null) check(/^\d+$/.test(length) && Number(length) <= PRIVATE_AUTHORING_MAX_BYTES, 'BODY_TOO_LARGE', 413);
            await service.access(identity, projectId, { write: true, generationId });
            const bytes = await readBounded(request.body, PRIVATE_AUTHORING_MAX_BYTES);
            if (length !== null) check(Number(length) === bytes.byteLength, 'BODY_LENGTH_MISMATCH', 400);
            const snapshot = await createPrivateAuthoringSnapshot(parseJson(bytes));
            assertResolvedAssets(snapshot.project);
            const receipt = await service.save(identity, projectId, { snapshot, requestId: id, generationId, baseRevision: Number(base) });
            return json(receipt);
        } catch (error) {
            if (error instanceof AuthoringApiError) return json({ error: error.code }, error.status);
            if (error instanceof PrivateAuthoringError) {
                const status = /CONFLICT|REQUEST_REUSED|NOT_ACTIVE/.test(error.code) ? 409 : /TOO_LARGE|COMPLEXITY_LIMIT/.test(error.code) ? 413 : 422;
                return json({ error: error.code }, status);
            }
            if (['FLOW_PROJECT_INVALID', 'PROJECT_NOT_JSON_SAFE', 'PERSISTED_PROJECT_RUNTIME_DATA', 'MIXED_SPINE_FIXED_PAGE_COUNT_MISMATCH'].includes(error?.code)) {
                return json({ error: 'AUTHORING_SCHEMA_INVALID' }, 422);
            }
            if (/^(FLOW_HORIZON|WORKS_PUBLICATION|HORIZON_|DSF_)/.test(error?.code || error?.issues?.[0]?.code || '')) return json({ error: 'RELEASE_METADATA_INVALID' }, 422);
            return json({ error: 'AUTHORING_UNAVAILABLE' }, 503);
        }
    };
}

const runtimes = new WeakMap();
export async function handlePrivateAuthoring(context) {
    if (context.env?.AUTHORING_API_ENABLED !== 'true') return json({ error: 'AUTHORING_API_DISABLED' }, 503);
    try {
        let handler = runtimes.get(context.env);
        if (!handler) {
            const env = context.env;
            // A deliberately separate binding prevents accidental use of R2_BUCKET.
            check(env.AUTHORING_BUCKET && env.AUTHORING_BUCKET !== env.R2_BUCKET, 'CONFIG_AUTHORING_BUCKET');
            const google = createGoogleClient({ projectId: env.FIREBASE_PROJECT_ID, serviceAccountJson: env.AUTHORING_GOOGLE_SERVICE_ACCOUNT });
            const db = createFirestoreStore(google), bucket = createAuthoringBucket(env.AUTHORING_BUCKET);
            const service = createAuthoringService({ db, bucket, assertLiveIdentity: google.assertLiveIdentity });
            const actions = createProjectActions({ db, bucket, service, assertLiveIdentity: google.assertLiveIdentity,
                verifyRelease: createReleaseVerifier(env.R2_BUCKET, env.R2_PUBLIC_URL), publicBaseUrl: env.R2_PUBLIC_URL });
            handler = createAuthoringApi({ verifyToken: createIdTokenVerifier({ projectId: env.FIREBASE_PROJECT_ID }), service, actions });
            runtimes.set(env, handler);
        }
        return await handler(context);
    } catch (error) {
        return json({ error: error instanceof AuthoringApiError ? error.code : 'AUTHORING_UNAVAILABLE' }, 503);
    }
}
