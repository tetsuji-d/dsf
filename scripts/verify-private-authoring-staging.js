import assert from 'node:assert/strict';
import fs from 'node:fs';
import { customToken, scope, fixtureProject, operator, maintenance } from './operate-private-authoring-staging.js';
import { createPrivateAuthoringSnapshot } from '../js/private-authoring-storage.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
assert.equal(process.env.DSF_RUN_STAGING_AUTHORING_TEST, '1', 'Explicit staging test opt-in required');
const origin = 'https://staging.dsf-studio.pages.dev', url = `${origin}/api/projects/${scope.projectId}/authoring`;
const key = fs.readFileSync(new URL('../.env.staging', import.meta.url), 'utf8').match(/^VITE_FIREBASE_API_KEY=(.+)$/m)[1].trim();
const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await customToken(), returnSecureToken: true }) });
const session = await login.json(); assert.equal(login.status, 200, session.error?.message); assert.equal(session.localId, scope.uid);
const headers = { Authorization: `Bearer ${session.idToken}` };
async function read() { const response = await fetch(url, { headers }); const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(response.status, 200, new TextDecoder().decode(bytes)); assert.match(response.headers.get('cache-control'), /private, no-store/); return { project: JSON.parse(new TextDecoder().decode(bytes)), head: JSON.parse(response.headers.get('X-Authoring-Head')) }; }
async function put(project, id, base) { const snapshot = await createPrivateAuthoringSnapshot(project); const response = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'X-Authoring-Generation': scope.generationId, 'X-Authoring-Request-Id': id, 'X-Authoring-Base-Revision': String(base) }, body: snapshot.json }); const data = await response.json(); return { status: response.status, data, snapshot }; }
const first = await read(); assert.equal(first.head.revision, 1, 'Run this verifier on a newly migrated fixture');
assert.equal(first.project.futurePrivate.sentinel, 'UNIT_F_PRIVATE_DO_NOT_PUBLISH');
assert.equal((await fetch(url)).status, 401);
assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://foreign.invalid' } })).status, 403);
assert.equal((await fetch(`${origin}/api/projects/not_in_allowlist/authoring`, { headers })).status, 403);
const unchanged = await put(first.project, 'unit_f_unchanged_1', 1); assert.equal(unchanged.status, 200, JSON.stringify(unchanged.data)); assert.equal(unchanged.data.result, 'unchanged');
const texts = { ja: '文'.repeat(100000), en: 'a'.repeat(100000), ko: '글'.repeat(100000), zh: '章'.repeat(100000) };
const large = { ...fixtureProject(), languages: Object.keys(texts), blocks: [createFlowGroupBlock({ id: 'unit_f_long_flow', sourceLanguage: 'ja', document: { schemaVersion: 2, id: 'unit_f_doc', sections: [{ id: 'chapter', blocks: [{ id: 'paragraph', type: 'paragraph', texts }] }] } })], sections: [], pages: [] };
const saved = await put(large, 'unit_f_large_1', 1); assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert(saved.snapshot.byteLength > 850 * 1024);
const loaded = await read(); assert.equal(loaded.head.sha256, saved.snapshot.sha256); assert.deepEqual(loaded.project.blocks[0].flow.document.sections[0].blocks[0].texts, texts);
const stale = await put(first.project, 'unit_f_stale_1', 1); assert.equal(stale.status, 409);
const receipt = await fetch(`${url}/operations/unit_f_large_1`, { headers: { ...headers, 'X-Authoring-Generation': scope.generationId } }); assert.equal(receipt.status, 200); assert.equal((await receipt.json()).state, 'committed');
let op, m;
try { op = await operator(); m = await maintenance(op); await assert.rejects(m.api.inspectRollback(scope, 'too_large_probe'), e => e.code === 'FIRESTORE_AUTHORING_TOO_LARGE'); }
finally { await m?.dispose(); await op?.close(); }
const restored = await put(first.project, 'unit_f_small_1', loaded.head.revision); assert.equal(restored.status, 200, JSON.stringify(restored.data));
console.log(JSON.stringify({ realFirebaseAuthentication: true, privateR2RoundTrip: true, largeBytes: saved.snapshot.byteLength, charactersPerLanguage: 100000, languages: 4, unchangedReplay: true, staleWriteRejected: true, unauthorizedAndForeignOriginRejected: true, otherProjectRejected: true, oversizedRollbackRejected: true, finalRevision: restored.data.committedHead.revision }));
process.exit(0);
