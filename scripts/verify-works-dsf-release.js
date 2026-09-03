import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWorksDsfRelease } from '../js/works-dsf-release.js';

const identity = { uid: 'owner-1', workId: 'work-1', releaseId: 'release-1' };
const v2Project = {
    workId: identity.workId,
    releaseId: identity.releaseId,
    dsfSchemaVersion: 2,
    dsfContentUrl: `https://media-staging.dsf.ink/users/${identity.uid}/dsf/${identity.workId}/${identity.releaseId}/content.json`,
    dsfContentHash: 'a'.repeat(64),
    dsfLangs: ['ja', 'en-us'],
    dsfPageCounts: { ja: 120, 'en-us': 98 },
    dsfTotalBytes: 4096,
    defaultLang: 'ja',
    pageCount: 999,
    dsfPages: [],
};
const v2 = resolveWorksDsfRelease(v2Project, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
});
assert.equal(v2.releaseKind, 'horizon-v2');
assert.equal(v2.pageCount, 120, 'authoring pageCount must not replace the v2 default-language count');
assert.equal(v2.deliveryFields.pageCount, 120);
assert.equal(v2.deliveryFields.dsfPageCount, 120);
assert.deepEqual(v2.deliveryFields.dsfPages, []);
assert.equal(v2.deliveryFields.dsfContentHash, 'a'.repeat(64));
assert.equal(Object.isFrozen(v2), true);

const translatedOnly = resolveWorksDsfRelease({
    ...v2Project,
    dsfLangs: ['en-us'],
    dsfPageCounts: { 'en-us': 98 },
    defaultLang: 'ja',
}, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
});
assert.equal(translatedOnly.defaultLang, 'en-us');
assert.equal(translatedOnly.pageCount, 98);

const v1Pages = [{ pageNum: 1, urls: { ja: 'https://media.example.test/page-1.webp' } }];
const v1 = resolveWorksDsfRelease({
    dsfPages: v1Pages,
    dsfLangs: ['ja'],
    defaultLang: 'ja',
}, identity);
assert.equal(v1.releaseKind, 'webp-v1');
assert.equal(v1.pageCount, 1);
assert.deepEqual(v1.deliveryFields.dsfPages, v1Pages);

assert.throws(() => resolveWorksDsfRelease({
    ...v2Project,
    dsfContentHash: undefined,
}, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
}), /hash|metadata|locator/i, 'partial v2 metadata must not fall back to v1');

assert.throws(() => resolveWorksDsfRelease(v2Project, {
    ...identity,
    allowedContentOrigins: ['https://attacker.invalid'],
}), /location|URL|origin/i, 'v2 content URL must remain inside the configured release origin');

const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
assert.match(worksSource, /resolveWorksDsfRelease\(/);
assert.match(worksSource, /releaseKind === 'horizon-v2'/);
assert.match(worksSource, /\.\.\.release\.deliveryFields/);
assert.match(worksSource, /option value="public"[\s\S]*v2PublishDisabled/,
    'v2 public status controls must remain disabled until public Viewer loading is connected');

console.log('Works DSF v1/v2 release projection verification passed.');
