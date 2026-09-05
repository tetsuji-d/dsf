import assert from 'node:assert/strict';
import {
    isManagedPublicationThumbnailUrl,
    selectProjectAuthoringCoverThumbnail,
    selectProjectCoverThumbnail,
    selectProjectListingThumbnail,
    selectProjectPublicationThumbnailOverride,
} from '../js/project-listing-thumbnail.js';

const HTTPS = {
    publishedJa: 'https://media.dsf.ink/releases/ja/page-1.webp',
    publishedEn: 'https://media.dsf.ink/releases/en/page-1.webp',
    pageBackground: 'https://storage.example.test/pages/page-background.webp',
    blockBackground: 'https://storage.example.test/blocks/block-background.webp',
    sectionBackground: 'https://storage.example.test/sections/section-background.webp',
    thumbnail: 'https://storage.example.test/thumbnails/thumbnail.webp',
    listThumbnail: 'https://storage.example.test/thumbnails/list-thumbnail.webp',
    publicationThumbnail: 'https://storage.example.test/thumbnails/publication-thumbnail.webp',
    releaseThumbnail: 'https://media.dsf.ink/releases/release-thumbnail.webp',
};

const completeProject = {
    defaultLang: 'ja',
    dsfPages: [{ urls: { ja: HTTPS.publishedJa, en: HTTPS.publishedEn } }],
    pages: [{ content: { backgrounds: { ja: HTTPS.pageBackground } } }],
    blocks: [{ content: { backgrounds: { ja: HTTPS.blockBackground } } }],
    sections: [{ backgrounds: { ja: HTTPS.sectionBackground } }],
    thumbnail: HTTPS.thumbnail,
    listThumbnail: HTTPS.listThumbnail,
};

assert.equal(
    selectProjectListingThumbnail(completeProject),
    HTTPS.publishedJa,
    'the first published v1 page for defaultLang must win'
);

assert.equal(
    selectProjectListingThumbnail({
        ...completeProject,
        publicationThumbnailUrl: HTTPS.publicationThumbnail,
    }, { release: { thumbnail: HTTPS.releaseThumbnail } }),
    HTTPS.releaseThumbnail,
    'an immutable Release thumbnail snapshot must have highest priority',
);

const immutableV1Release = {
    dsfSchemaVersion: 1,
    defaultLang: 'ja',
    dsfPages: [
        { urls: { ja: HTTPS.publishedJa } },
        { urls: { ja: HTTPS.publishedEn } },
    ],
    book: { mode: 'simple', covers: { c1: { pageIndex: 1 } } },
};
assert.equal(
    selectProjectListingThumbnail({
        ...completeProject,
        publicationThumbnailUrl: HTTPS.publicationThumbnail,
    }, { release: immutableV1Release }),
    HTTPS.publishedEn,
    'a canonical v1 publication must derive C1 from the immutable Release instead of Project preferences',
);
assert.equal(
    selectProjectListingThumbnail({
        ...completeProject,
        publicationThumbnailUrl: 'https://storage.example.test/thumbnails/changed-after-release.webp',
    }, { release: immutableV1Release }),
    HTTPS.publishedEn,
    'changing the Project preference must not rewrite an existing v1 Release cover',
);
assert.equal(
    selectProjectListingThumbnail({
        ...completeProject,
        dsfSchemaVersion: 2,
        thumbnail: HTTPS.thumbnail,
        publicationThumbnailUrl: HTTPS.publicationThumbnail,
    }, { release: { dsfSchemaVersion: 2 } }),
    '',
    'an explicit v2 Release without a thumbnail must never fall through to mutable Project settings',
);

assert.equal(
    selectProjectListingThumbnail({
        dsfSchemaVersion: 2,
        thumbnail: HTTPS.releaseThumbnail,
        publicationThumbnailUrl: HTTPS.publicationThumbnail,
    }),
    HTTPS.releaseThumbnail,
    'the current v2 Project release snapshot must precede a later authoring preference',
);

assert.equal(
    selectProjectListingThumbnail({
        ...completeProject,
        publicationThumbnailUrl: HTTPS.publicationThumbnail,
    }),
    HTTPS.publicationThumbnail,
    'an author-selected publication thumbnail must precede the default cover',
);

assert.equal(
    selectProjectPublicationThumbnailOverride({ publicationThumbnailUrl: HTTPS.publicationThumbnail }),
    HTTPS.publicationThumbnail,
);
assert.equal(
    selectProjectPublicationThumbnailOverride({ publicationThumbnailUrl: 'blob:local-preview' }),
    '',
    'publication overrides exposed to listing surfaces must be HTTPS-only',
);

assert.equal(
    selectProjectCoverThumbnail({
        defaultLang: 'ja',
        pages: [
            { content: { background: 'blob:local-cover' } },
            { content: { background: HTTPS.pageBackground } },
        ],
    }),
    '',
    'a later image page must never replace a non-publishable C1 cover',
);

assert.equal(
    selectProjectAuthoringCoverThumbnail({
        defaultLang: 'ja',
        dsfPages: [{ urls: { ja: HTTPS.publishedJa } }],
        blocks: [{ kind: 'page', content: { background: HTTPS.blockBackground } }],
        pages: [{ content: { background: HTTPS.pageBackground } }],
    }),
    HTTPS.blockBackground,
    'Project Settings must preview the current canonical authoring C1 instead of a previous Release',
);

assert.equal(
    selectProjectAuthoringCoverThumbnail({
        defaultLang: 'ja',
        blocks: [
            { kind: 'chapter', content: { background: HTTPS.sectionBackground } },
            { kind: 'flow', flowDocument: {} },
            { kind: 'page', content: { background: HTTPS.blockBackground } },
        ],
        pages: [{ content: { background: HTTPS.pageBackground } }],
    }),
    '',
    'a Flow authoring C1 must not be replaced by a later Fixed compatibility image',
);

assert.equal(
    selectProjectAuthoringCoverThumbnail({
        defaultLang: 'ja',
        blocks: [{ kind: 'page', content: { backgrounds: { ja: 'blob:current-authoring-cover' } } }],
    }, { allowLocal: true }),
    'blob:current-authoring-cover',
    'Project Settings may preview the current local authoring cover before upload',
);

assert.equal(
    selectProjectAuthoringCoverThumbnail({
        defaultLang: 'ja',
        pages: [{ content: { background: HTTPS.pageBackground } }],
    }),
    HTTPS.pageBackground,
    'legacy projects without canonical blocks must retain their first compatibility page preview',
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'JA',
        dsfPages: [{ urls: { ja: HTTPS.publishedJa } }],
    }),
    HTTPS.publishedJa,
    'language keys must be matched case-insensitively'
);

assert.equal(
    selectProjectListingThumbnail({
        dsfLangs: ['en'],
        dsfPages: [{ urls: { ja: HTTPS.publishedJa, en: HTTPS.publishedEn } }],
    }),
    HTTPS.publishedEn,
    'dsfLangs must supply the language when defaultLang is absent'
);

assert.equal(
    selectProjectListingThumbnail({
        dsfPages: [{ urls: { en: HTTPS.publishedEn } }],
    }),
    HTTPS.publishedEn,
    'legacy v1 data may derive its language from the first URL key'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        dsfPages: [{ urls: { en: HTTPS.publishedEn } }],
    }),
    HTTPS.publishedEn,
    'legacy v1 data must retain an HTTPS fallback when its declared language URL is absent'
);

assert.equal(
    selectProjectListingThumbnail({ dsfPages: [HTTPS.publishedJa] }),
    HTTPS.publishedJa,
    'early v1 direct page URLs must remain supported'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        dsfPages: [{ urls: { ja: 'data:image/webp;base64,unsafe' } }],
        pages: [{ content: { backgrounds: { ja: HTTPS.pageBackground } } }],
        thumbnail: HTTPS.thumbnail,
    }),
    HTTPS.pageBackground,
    'an unsafe published URL must fall through to a high-resolution background'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        pages: [{
            content: {
                backgrounds: { JA: HTTPS.pageBackground },
                background: 'https://storage.example.test/pages/generic.webp',
            },
        }],
    }),
    HTTPS.pageBackground,
    'a localized page background must beat its generic background'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        pages: [{ content: { background: HTTPS.pageBackground } }],
        blocks: [{ content: { background: HTTPS.blockBackground } }],
        sections: [{ background: HTTPS.sectionBackground }],
    }),
    HTTPS.pageBackground,
    'source backgrounds must follow pages, blocks, sections order'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        pages: [{ content: { background: 'blob:local-preview' } }],
        blocks: [{ content: { background: HTTPS.blockBackground } }],
        sections: [{ background: HTTPS.sectionBackground }],
    }),
    HTTPS.blockBackground,
    'blocks must be checked when pages have no publishable background'
);

assert.equal(
    selectProjectListingThumbnail({
        defaultLang: 'ja',
        pages: null,
        blocks: [{ content: null }],
        sections: [{ backgrounds: { ja: HTTPS.sectionBackground } }],
    }),
    HTTPS.sectionBackground,
    'sections and malformed earlier collections must be handled safely'
);

assert.equal(
    selectProjectListingThumbnail({
        pages: [{ background: HTTPS.pageBackground }],
    }),
    HTTPS.pageBackground,
    'direct legacy page background fields must remain supported'
);

assert.equal(
    selectProjectListingThumbnail({
        thumbnail: HTTPS.thumbnail,
        listThumbnail: HTTPS.listThumbnail,
    }),
    HTTPS.thumbnail,
    'an HTTPS thumbnail must precede listThumbnail within the fallback tier'
);

assert.equal(
    selectProjectListingThumbnail({
        thumbnail: 'data:image/webp;base64,unsafe',
        listThumbnail: HTTPS.listThumbnail,
    }),
    HTTPS.listThumbnail,
    'an unsafe thumbnail must fall through to an HTTPS listThumbnail'
);

assert.equal(
    selectProjectListingThumbnail({
        thumbnail: 'blob:local-preview',
        listThumbnail: 'http://storage.example.test/insecure.webp',
        pages: [{ content: { thumbnail: 'data:image/webp;base64,unsafe' } }],
        blocks: [{ content: { listThumbnail: HTTPS.listThumbnail } }],
    }),
    HTTPS.listThumbnail,
    'nested HTTPS thumbnail fields must remain usable after unsafe root fields'
);

for (const project of [
    null,
    [],
    {},
    { dsfPages: [null], pages: [null, 'invalid'], blocks: {}, sections: 'invalid' },
    { thumbnail: 'data:image/webp;base64,unsafe' },
    { thumbnail: 'blob:local-preview' },
    { thumbnail: 'http://storage.example.test/insecure.webp' },
    { thumbnail: 'https://' },
    { thumbnail: 'https://user:password@storage.example.test/secret.webp' },
]) {
    assert.doesNotThrow(() => selectProjectListingThumbnail(project));
    assert.equal(selectProjectListingThumbnail(project), '');
}

const immutableInput = {
    defaultLang: 'ja',
    dsfPages: [{ urls: { ja: `  ${HTTPS.publishedJa}  ` } }],
    pages: [{ content: { background: HTTPS.pageBackground } }],
};
const before = JSON.stringify(immutableInput);
assert.equal(selectProjectListingThumbnail(immutableInput), HTTPS.publishedJa);
assert.equal(JSON.stringify(immutableInput), before, 'selection must not mutate its input');

const ownerUid = 'owner-1';
const digest = 'a'.repeat(64);
const managedObjectPath = `users/${ownerUid}/dsf/publication-thumbnails/${digest}.webp`;
const managedOptions = {
    ownerUid,
    r2PublicBaseUrl: 'https://media-staging.dsf.ink',
    firebaseStorageBucket: 'dsf-studio-staging.appspot.com',
};
assert.equal(
    isManagedPublicationThumbnailUrl(
        `https://media-staging.dsf.ink/${managedObjectPath}`,
        managedOptions,
    ),
    true,
    'R2 publication thumbnails must match the configured base, owner path, and content hash',
);
assert.equal(
    isManagedPublicationThumbnailUrl(
        `https://firebasestorage.googleapis.com/v0/b/dsf-studio-staging.appspot.com/o/${encodeURIComponent(managedObjectPath)}?alt=media`,
        managedOptions,
    ),
    true,
    'Firebase publication thumbnails must match the configured bucket and request media bytes',
);
assert.equal(
    isManagedPublicationThumbnailUrl(
        `https://firebasestorage.googleapis.com/v0/b/dsf-studio-staging.appspot.com/o/${encodeURIComponent(managedObjectPath)}?alt=media&token=download-token`,
        managedOptions,
    ),
    true,
    'Firebase download URLs may retain their single access token',
);

for (const unmanagedUrl of [
    `https://media-staging.dsf.ink.evil.test/${managedObjectPath}`,
    `https://media-staging.dsf.ink/users/other-owner/dsf/publication-thumbnails/${digest}.webp`,
    `https://media-staging.dsf.ink/users/${ownerUid}/dsf/publication-thumbnails/not-a-hash.webp`,
    `https://media-staging.dsf.ink/${managedObjectPath}?download=1`,
    `https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/${encodeURIComponent(managedObjectPath)}?alt=media`,
    `https://firebasestorage.googleapis.com/v0/b/dsf-studio-staging.appspot.com/o/${encodeURIComponent(managedObjectPath)}?alt=json`,
    `https://firebasestorage.googleapis.com/v0/b/dsf-studio-staging.appspot.com/o/${encodeURIComponent(managedObjectPath)}?alt=media&download=1`,
]) {
    assert.equal(isManagedPublicationThumbnailUrl(unmanagedUrl, managedOptions), false, unmanagedUrl);
}

console.log('Project listing thumbnail selection verification passed.');
