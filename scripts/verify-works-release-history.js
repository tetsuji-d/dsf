import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectReleaseHistory, releaseInspectionKey } from '../js/works-release-history.js';
import { inspectReleaseHistory } from '../js/dsf-release-history-inspection.js';
import { buildOwnerDraftViewerUrl, resolveOwnerHistoricalReleaseIdentity, assertOwnerDraftReleaseMetadata } from '../js/viewer-owner-preview.js';
import { serializeDsfReleaseJson } from '../js/dsf-release-assembly.js';
import { sha256DsfBytes } from '../js/dsf-release-byte-sealing.js';
const now = Date.parse('2026-09-05T00:00:00Z');
const base = 'https://test.dsf.invalid';
const root = 'users/owner/dsf/work/old/';
const webp = new Uint8Array(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
const common = { uid: 'owner', projectId: 'project', workId: 'work', releaseId: 'old', now,
    allowedContentOrigins: [base], r2PublicBaseUrl: base,
    project: { uid: 'owner', workId: 'work', releaseId: 'new' },
    work: { ownerUid: 'owner', workId: 'work', projectId: 'project', latestProjectId: 'project', latestReleaseId: 'new', title: 'Work title' },
    account: { status: {} },
};
const release = { projectId: 'project', workId: 'work', releaseId: 'old', dsfLangs: ['ja'], dsfPublishedAt: new Date(now - 1000),
    dsfPages: [{ urls: { ja: `${base}/${root}ja/page_001.webp` }, bytesByLang: { ja: webp.length } }],
    dsfTotalBytes: webp.length, publication: { listedFrom: new Date(now - 1000) },
};
const inventory = objects => [{ inventoryVersion: 1, inventoryKind: 'owner-dsf-release-storage-page', prefix: 'users/owner/dsf/',
    scannedObjectCount: objects.length, objects, truncated: false, cursor: null }];
const object = { storagePath: `${root}ja/page_001.webp`, byteLength: webp.length, uploadedAt: new Date(now).toISOString(), httpMetadata: { contentType: 'image/webp' }, customMetadata: {} };
const input = { ...common, release, inventoryPages: inventory([object]), fetchImpl: async () => new Response(webp, { headers: { 'content-type': 'image/webp' } }) };
const before = JSON.stringify(release);
const inspection = await inspectReleaseHistory(input);
assert.equal(inspection.status, 'verified');
assert.equal(projectReleaseHistory({ ...input, inspection }).eligibility, 'eligible', 'historical != latest is allowed');
assert.equal(projectReleaseHistory(input).eligibility, 'unknown');
assert.equal(projectReleaseHistory({ ...input, release: { ...release, releaseId: 'other' }, inspection }).eligibility, 'blocked');
assert.equal(projectReleaseHistory({ ...input, uid: 'other', inspection }).canPreview, false);
assert.equal(projectReleaseHistory({ ...input, release: { ...release, dsfContentHash: 'a'.repeat(64) } }).canPreview, false, 'partial v2 cannot fall back');
assert.equal(projectReleaseHistory({ ...input, now: now + 15 * 86400000, inspection }).eligibility, 'blocked');
assert.equal(projectReleaseHistory({ ...input, account: { status: { moderationHold: true } }, inspection }).eligibility, 'blocked');
assert.equal(projectReleaseHistory({ ...input, work: { ...common.work, title: '', projectName: 'private name' }, inspection }).eligibility, 'blocked');
assert.equal(projectReleaseHistory({ ...input, release: { ...release, dsfTotalBytes: webp.length + 1 }, inspection }).integrity, 'not_checked');
assert.equal((await inspectReleaseHistory({ ...input, inventoryPages: inventory([]) })).reason, 'missing');
assert.equal((await inspectReleaseHistory({ ...input, inventoryPages: [{ ...input.inventoryPages[0], truncated: true, cursor: 'next' }] })).reason, 'incomplete');
assert.equal((await inspectReleaseHistory({ ...input, release: { ...release, dsfPages: [{ urls: release.dsfPages[0].urls }] } })).reason, 'legacy_evidence');
assert.equal((await inspectReleaseHistory({ ...input, fetchImpl: async () => { throw new TypeError('secret token=never-show'); } })).reason, 'unavailable');
assert.equal(JSON.stringify(release), before, 'snapshot never changes');
assert.equal(buildOwnerDraftViewerUrl(base, 'project', 'old'), `${base}/viewer?draft=project&r=old`);
const identity = resolveOwnerHistoricalReleaseIdentity(common, common.work, 'old');
assert.equal(identity.releaseId, 'old');
assertOwnerDraftReleaseMetadata(release, identity);
assert.throws(() => resolveOwnerHistoricalReleaseIdentity(common, { ...common.work, ownerUid: 'other' }, 'old'));
assert.throws(() => assertOwnerDraftReleaseMetadata({ ...release, workId: 'other' }, identity));

// Real canonical JSON, independently hashed, with a structurally valid WebP fixture.
const image = webp.slice(); new DataView(image.buffer).setUint16(26, 1080, true); new DataView(image.buffer).setUint16(28, 1920, true);
const imageHash = await sha256DsfBytes(image);
const page = { id: 'p1', renderKind: 'image', sourceAnchor: { kind: 'fixed', blockId: 'b1' }, image: { href: '../assets/images/language-0001/page-00001.webp', width: 1080, height: 1920, mimeType: 'image/webp' } };
const manifest = { schemaVersion: 1, language: 'ja', styles: {}, pages: [page] };
const manifestBytes = new TextEncoder().encode(serializeDsfReleaseJson(manifest));
const manifestHash = await sha256DsfBytes(manifestBytes);
const index = { schemaVersion: 2, layoutModel: 'fixed-page-hybrid-1', canonicalPage: { width: 360, height: 640, aspectRatio: '9:16' }, defaultLang: 'ja', fonts: {}, languages: { ja: { href: 'content/language-0001.json', pageCount: 1, pageDirection: 'rtl', sha256: manifestHash } } };
const indexBytes = new TextEncoder().encode(serializeDsfReleaseJson(index));
const indexHash = await sha256DsfBytes(indexBytes);
const data = [ ['content.json', indexBytes, indexHash, 'application/json'], ['content/language-0001.json', manifestBytes, manifestHash, 'application/json'], ['assets/images/language-0001/page-00001.webp', image, imageHash, 'image/webp'] ];
const v2Release = { ...release, dsfSchemaVersion: 2, dsfPages: [], defaultLang: 'ja', dsfPageCounts: { ja: 1 }, dsfContentUrl: `${base}/${root}content.json`, dsfContentHash: indexHash, dsfTotalBytes: data.reduce((sum, [, bytes]) => sum + bytes.length, 0) };
const v2 = { ...common, release: v2Release, inventoryPages: inventory(data.map(([path, bytes, sha256, contentType]) => ({ storagePath: root + path, byteLength: bytes.length, uploadedAt: new Date(now).toISOString(), httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { dsfSchemaVersion: '2', dsfSha256: sha256, dsfByteLength: String(bytes.length) } }))), fetchImpl: async (url, options) => { assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); const item = data.find(([path]) => url === `${base}/${root}${path}`); assert.ok(item); return new Response(item[1], { headers: { 'content-type': item[3] } }); } };
const v2Inspection = await inspectReleaseHistory(v2);
assert.equal(v2Inspection.status, 'verified');
assert.deepEqual(v2Inspection.kindsByLanguage, { ja: { fixedText: 0, webp: 1 } });
assert.equal(projectReleaseHistory({ ...v2, inspection: v2Inspection }).eligibility, 'blocked', 'missing snapshot thumbnail blocks v2');
assert.equal((await inspectReleaseHistory({ ...v2, release: { ...v2Release, dsfContentHash: '0'.repeat(64) } })).reason, 'mismatch');
assert.equal(releaseInspectionKey(v2), v2Inspection.key);
assert.equal((await inspectReleaseHistory({ ...v2, fetchImpl: async () => { throw new TypeError('fixture secret'); } })).reason, 'unavailable', 'loader wrapping must not turn a network failure into corruption');
assert.equal((await inspectReleaseHistory({ ...v2, fetchImpl: async () => new Response('', { headers: { 'content-length': String(257 * 1024 * 1024) } }) })).reason, 'incomplete', 'byte budget is not missing/corrupt data');
assert.equal(projectReleaseHistory({ ...input, project: null, inspection }).canInspect, true);
assert.equal(projectReleaseHistory({ ...input, project: null, inspection }).canPreview, false);
assert.equal(projectReleaseHistory({ ...input, project: null, inspection }).eligibility, 'blocked');
const panel = readFileSync(new URL('../js/works-release-history-panel.js', import.meta.url), 'utf8');
assert.doesNotMatch(panel, /\b(?:setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|assertAccountCanPublish|ensureUserBootstrap)\b/);
assert.doesNotMatch(panel, /error\.message|error\.stack|JSON\.stringify/);
assert.doesNotMatch(JSON.stringify(projectReleaseHistory({ ...input, inspection: { key: releaseInspectionKey(input), status: 'incomplete', reason: 'secret' } })), /secret/);
console.log('Release history: immutable snapshots, owner boundaries, incomplete scans, v1/v2 bytes and pure eligibility passed.');
