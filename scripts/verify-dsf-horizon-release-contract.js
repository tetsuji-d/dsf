import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
    DSF_HORIZON_RELEASE_PLAN_KIND,
    DSF_HORIZON_RELEASE_SEAL_KIND,
    DsfHorizonReleaseContractError,
    createDsfHorizonReleasePlan,
    sealDsfHorizonReleasePlan,
    selectDsfPublicReleaseTransport,
} from '../js/dsf-horizon-release-contract.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);

function createSyntheticRegistry() {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-global-sans-v1': {
                declaration: {
                    family: 'Synthetic Global Sans',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-global-sans-v1.woff2',
                    sha256: 'a'.repeat(64),
                },
                asset: {
                    format: 'woff2',
                    mimeType: 'font/woff2',
                    byteLength: 123456,
                    immutable: true,
                },
                license: {
                    spdxId: 'OFL-1.1',
                    licenseHref: 'https://unit-test-fonts.dsf-format.org/licenses/ofl-1.1',
                    rightsHolder: 'Synthetic test fixture only',
                    reviewedAt: '2026-08-26',
                    reviewedBy: 'Automated test fixture',
                    allowsWebDistribution: true,
                    allowsPortableEmbedding: true,
                },
                capabilities: {
                    languages: ['ja', 'en'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

function createTextBlock() {
    return {
        id: 'fixed_text_story',
        kind: 'page',
        content: {
            pageKind: 'text',
            texts: {
                ja: '冬の金沢は静かだった。',
                en: 'Kanazawa was quiet in winter.',
            },
            textAlign: 'start',
            backgroundColor: '#fffdf8',
            textColor: '#1f1b16',
            bubbles: [],
            interactions: [],
        },
    };
}

function createSnapshot(text) {
    return {
        composition: {
            version: 2,
            writingMode: 'horizontal-tb',
            frame: { x: 20, y: 20, w: 320, h: 600 },
            font: {
                family: "'Synthetic Global Sans',sans-serif",
                size: 16,
                lineHeight: 1.8,
                letterSpacing: 0,
            },
            rules: { maxLines: 20, charsPerLine: 32 },
            lines: [text],
            overflow: false,
            overflowText: '',
        },
        evidence: {
            sourceText: text,
            layoutVersion: 2,
            fontId: 'synthetic-global-sans-v1',
            fontSha256: 'a'.repeat(64),
        },
    };
}

const registry = createSyntheticRegistry();
const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const textBlock = createTextBlock();
const blocks = [graphicBlock, textBlock];

function createPreflight(language) {
    return createDsfPressPreflight({
        blocks,
        language,
        compositionSnapshots: {
            [textBlock.id]: createSnapshot(textBlock.content.texts[language]),
        },
        fontRegistry: registry,
    });
}

function createImageAssets(language) {
    return {
        [graphicBlock.id]: {
            pageId: `cover-${language}`,
            pageLabel: '1',
            sha256: language === 'ja' ? 'b'.repeat(64) : 'c'.repeat(64),
            byteLength: language === 'ja' ? 42000 : 43000,
            width: 1080,
            height: 1920,
            mimeType: 'image/webp',
        },
    };
}

const assembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes: sha256,
    languages: [
        {
            language: 'ja',
            pageDirection: 'rtl',
            preflight: createPreflight('ja'),
            imageAssets: createImageAssets('ja'),
        },
        {
            language: 'en',
            pageDirection: 'ltr',
            preflight: createPreflight('en'),
            imageAssets: createImageAssets('en'),
        },
    ],
});

const planInput = {
    assembly,
    uid: 'reader_owner_1',
    workId: 'work_horizon_v2',
    releaseId: 'rel_horizon_v2_1',
    publicBaseUrl: 'https://media.dsf.ink',
    fontRegistry: registry,
    hashBytes: sha256,
};
const planInputSnapshot = clone({ ...planInput, hashBytes: null });
const plan = await createDsfHorizonReleasePlan(planInput);

assert.equal(plan.contractKind, DSF_HORIZON_RELEASE_PLAN_KIND);
assert.equal(plan.readyForUpload, true);
assert.equal(plan.readyForMetadataWrite, false);
assert.equal(plan.releaseRootPath, 'users/reader_owner_1/dsf/work_horizon_v2/rel_horizon_v2_1');
assert.equal(plan.files.length, 5);
assert.deepEqual(plan.files.map((file) => file.role), [
    'content-index',
    'language-manifest',
    'language-manifest',
    'image',
    'image',
]);
assert.equal(plan.files[0].storagePath, 'users/reader_owner_1/dsf/work_horizon_v2/rel_horizon_v2_1/content.json');
assert.equal(plan.files[0].publicUrl, 'https://media.dsf.ink/users/reader_owner_1/dsf/work_horizon_v2/rel_horizon_v2_1/content.json');
assert.equal(plan.files[0].json, assembly.files.index.json);
assert.equal(plan.files.every((file) => file.cacheControl === DSF_HORIZON_IMMUTABLE_CACHE_CONTROL), true);
assert.equal(plan.files.some((file) => file.mimeType === 'font/woff2'), false,
    'Horizon release files must reuse certified shared CDN fonts instead of duplicating WOFF2 per work');
assert.deepEqual(plan.candidate.dsfLangs, ['ja', 'en']);
assert.deepEqual(plan.candidate.dsfPageCounts, { ja: 2, en: 2 });
assert.equal(plan.candidate.defaultLang, 'ja');
assert.equal(plan.candidate.pageCount, 2);
assert.equal(plan.candidate.dsfContentHash, assembly.files.index.sha256);
assert.equal(plan.candidate.dsfTotalBytes, assembly.summary.totalBytes);
assert.equal(Object.isFrozen(plan), true);
assert.equal(Object.isFrozen(plan.files), true);
assert.deepEqual(clone({ ...planInput, hashBytes: null }), planInputSnapshot,
    'Horizon planning cannot mutate the verified release assembly or identity input');

const receipts = plan.files.map((file) => ({
    storagePath: file.storagePath,
    publicUrl: file.publicUrl,
    mimeType: file.mimeType,
    byteLength: file.byteLength,
    sha256: file.sha256,
    cacheControl: file.cacheControl,
})).reverse();
const seal = sealDsfHorizonReleasePlan({ plan, receipts });

assert.equal(seal.contractKind, DSF_HORIZON_RELEASE_SEAL_KIND);
assert.equal(seal.readyForMetadataWrite, true);
assert.deepEqual(seal.releaseMetadata, {
    dsfSchemaVersion: 2,
    dsfContentUrl: plan.candidate.dsfContentUrl,
    dsfContentHash: plan.candidate.dsfContentHash,
    dsfLangs: ['ja', 'en'],
    dsfPageCounts: { ja: 2, en: 2 },
    dsfTotalBytes: assembly.summary.totalBytes,
});
assert.deepEqual(seal.publicLocator, plan.candidate);
assert.equal(Object.isFrozen(seal.publicLocator.dsfPageCounts), true);

const publicMetadata = {
    authorUid: plan.identity.uid,
    workId: plan.identity.workId,
    releaseId: plan.identity.releaseId,
    defaultLang: seal.publicLocator.defaultLang,
    pageCount: seal.publicLocator.pageCount,
    ...seal.releaseMetadata,
    dsfPages: [{ urls: { ja: 'https://stale.invalid/page.webp' } }],
};
const v2Transport = selectDsfPublicReleaseTransport(publicMetadata, {
    allowedContentOrigins: ['https://media.dsf.ink'],
});
assert.equal(v2Transport.transportKind, 'horizon-v2');
assert.equal(v2Transport.contentUrl, seal.releaseMetadata.dsfContentUrl);
assert.equal(v2Transport.contentHash, seal.releaseMetadata.dsfContentHash);
assert.deepEqual(v2Transport.pageCounts, { ja: 2, en: 2 });
assert.equal('pages' in v2Transport, false, 'declared v2 must never fall back to stale v1 dsfPages');

const v1Pages = [{ pageNum: 1, urls: { ja: 'https://media.dsf.ink/page-001.webp' } }];
const v1Transport = selectDsfPublicReleaseTransport({ dsfPages: v1Pages });
assert.equal(v1Transport.transportKind, 'webp-v1');
assert.deepEqual(v1Transport.pages, v1Pages);

const mismatchedReceipts = clone(receipts);
mismatchedReceipts[0].sha256 = 'f'.repeat(64);
assert.throws(
    () => sealDsfHorizonReleasePlan({ plan, receipts: mismatchedReceipts }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_RELEASE_RECEIPT_MISMATCH'),
    'Firestore metadata must remain unavailable when one uploaded object does not match the plan',
);
assert.throws(
    () => sealDsfHorizonReleasePlan({ plan, receipts: receipts.slice(1) }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_RELEASE_RECEIPT_SET_MISMATCH'),
);

const wrongFontAssembly = clone(assembly);
wrongFontAssembly.bundle.index.fonts['synthetic-global-sans-v1'].source = 'embedded';
wrongFontAssembly.files.index.json = JSON.stringify(wrongFontAssembly.bundle.index);
await assert.rejects(
    () => createDsfHorizonReleasePlan({ ...planInput, assembly: wrongFontAssembly }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_RELEASE_FONT_CERTIFICATE_MISMATCH'),
    'Horizon cannot silently accept a portable embedded-font declaration',
);

const partialV2 = { dsfPages: v1Pages, dsfContentUrl: seal.releaseMetadata.dsfContentUrl };
assert.throws(
    () => selectDsfPublicReleaseTransport(partialV2),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_PUBLIC_V2_LOCATOR_PARTIAL'),
    'partially written v2 metadata must not fall back to v1',
);

const wrongHashMetadata = { ...publicMetadata, dsfContentHash: 'x'.repeat(64) };
assert.throws(
    () => selectDsfPublicReleaseTransport(wrongHashMetadata, {
        allowedContentOrigins: ['https://media.dsf.ink'],
    }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_RELEASE_HASH_INVALID'),
);

const wrongOriginMetadata = {
    ...publicMetadata,
    dsfContentUrl: publicMetadata.dsfContentUrl.replace('https://media.dsf.ink', 'https://attacker.invalid'),
};
assert.throws(
    () => selectDsfPublicReleaseTransport(wrongOriginMetadata, {
        allowedContentOrigins: ['https://media.dsf.ink'],
    }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_PUBLIC_CONTENT_URL_INVALID'),
);

assert.throws(
    () => selectDsfPublicReleaseTransport({ dsfSchemaVersion: 3, dsfPages: v1Pages }),
    (error) => error instanceof DsfHorizonReleaseContractError
        && error.issues.some((issue) => issue.code === 'HORIZON_PUBLIC_SCHEMA_UNSUPPORTED'),
);

const moduleSource = readFileSync(new URL('../js/dsf-horizon-release-contract.js', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
for (const forbidden of ["from './firebase", "from 'firebase", 'firebase/firestore', 'fetch(', 'new formdata', 'uploadpresspage', 'setdoc(', 'saveas(']) {
    assert.equal(moduleSource.toLowerCase().includes(forbidden), false,
        `pure Horizon release contract cannot depend on ${forbidden}`);
}
assert.equal(viewerSource.includes("'./dsf-horizon-release-contract.js'"), false,
    '9A-6C-C-C-0 cannot connect the public Viewer runtime');
assert.equal(pressSource.includes("'./dsf-horizon-release-contract.js'"), false,
    '9A-6C-C-C-0 cannot enable Horizon upload');
assert.equal(worksSource.includes("'./dsf-horizon-release-contract.js'"), false,
    '9A-6C-C-C-0 cannot write public_projects');

console.log('DSF Horizon v2 release and public Viewer transport contract verification passed.');
