import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES,
    DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE,
    DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_PIXELS,
    DspPublicationThumbnailImportError,
    decodeDspPublicationThumbnailImage,
    detectDspPublicationThumbnailMimeType,
    validateDspPublicationThumbnailArchiveAsset,
} from '../js/dsp-publication-thumbnail-import.js';

const SAMPLES = Object.freeze({
    webp: Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]),
    png: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
    ]),
    jpg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    gif: new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000'),
});

function makeEntry(bytes, { declaredBytes = bytes.byteLength, onRead = () => {} } = {}) {
    return {
        dir: false,
        _data: { uncompressedSize: declaredBytes },
        async: async (kind) => {
            assert.equal(kind, 'uint8array');
            onRead();
            return bytes;
        },
    };
}

async function validate(reference, entry, options = {}) {
    return validateDspPublicationThumbnailArchiveAsset({
        reference,
        getArchiveEntry: () => entry,
        decodeImage: async () => ({ width: 720, height: 1280 }),
        ...options,
    });
}

assert.equal(DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES, 25 * 1024 * 1024);
assert.equal(DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE, 16384);
assert.equal(DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_PIXELS, 80_000_000);
assert.equal(detectDspPublicationThumbnailMimeType(SAMPLES.webp), 'image/webp');
assert.equal(detectDspPublicationThumbnailMimeType(SAMPLES.png), 'image/png');
assert.equal(detectDspPublicationThumbnailMimeType(SAMPLES.jpg), 'image/jpeg');
assert.equal(detectDspPublicationThumbnailMimeType(SAMPLES.gif), 'image/gif');
assert.equal(detectDspPublicationThumbnailMimeType(new TextEncoder().encode('<svg></svg>')), '');

for (const [extension, bytes] of Object.entries(SAMPLES)) {
    const relativePath = `assets/publication-thumbnail.${extension}`;
    const result = await validate(relativePath, makeEntry(bytes));
    assert.equal(result.relativePath, relativePath);
    assert.equal(result.mimeType, extension === 'jpg' ? 'image/jpeg' : `image/${extension}`);
    assert.deepEqual({ width: result.width, height: result.height }, { width: 720, height: 1280 });
    assert.deepEqual(result.bytes, bytes);
    assert.notEqual(result.bytes, bytes, 'validated bytes are detached from the archive entry buffer');
    assert.equal(Object.isFrozen(result), true);
}

{
    let lookupCount = 0;
    const result = await validateDspPublicationThumbnailArchiveAsset({
        reference: '',
        decodeImage: async () => { throw new Error('empty references must not decode'); },
        getArchiveEntry: () => {
            lookupCount += 1;
            return null;
        },
    });
    assert.equal(result, null, 'an empty authoring preference keeps the C1 default');
    assert.equal(lookupCount, 0);
}

for (const reference of [
    'https://tracking.example/cover.webp',
    'blob:https://studio.example/local-cover',
    'data:image/png;base64,AAAA',
    '../assets/publication-thumbnail.webp',
    'assets/../publication-thumbnail.webp',
    'assets\\publication-thumbnail.webp',
]) {
    await assert.rejects(
        validateDspPublicationThumbnailArchiveAsset({ reference, getArchiveEntry: () => makeEntry(SAMPLES.webp) }),
        (error) => error instanceof DspPublicationThumbnailImportError
            && error.code === 'DSP_PUBLICATION_THUMBNAIL_REFERENCE_INVALID',
        reference,
    );
}

await assert.rejects(
    validate('assets/publication-thumbnail.webp', null),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_ASSET_MISSING',
    'a missing archive reference fails instead of retaining its string URL',
);

await assert.rejects(
    validate('assets/publication-thumbnail.svg', makeEntry(new TextEncoder().encode('<svg></svg>'))),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_EXTENSION_UNSUPPORTED',
);

await assert.rejects(
    validate('assets/publication-thumbnail.webp', makeEntry(new TextEncoder().encode('not an image'))),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_FORMAT_INVALID',
    'an image extension cannot substitute for an actual supported image signature',
);

{
    let decodeCount = 0;
    await assert.rejects(
        validate('assets/publication-thumbnail.webp', makeEntry(new TextEncoder().encode('not an image')), {
            decodeImage: async () => {
                decodeCount += 1;
                return { width: 720, height: 1280 };
            },
        }),
        (error) => error instanceof DspPublicationThumbnailImportError
            && error.code === 'DSP_PUBLICATION_THUMBNAIL_FORMAT_INVALID',
    );
    assert.equal(decodeCount, 0, 'unsupported signatures are rejected before browser image decoding');
}

await assert.rejects(
    validate('assets/publication-thumbnail.webp', makeEntry(SAMPLES.png)),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_FORMAT_MISMATCH',
);

await assert.rejects(
    validate('assets/publication-thumbnail.webp', makeEntry(SAMPLES.webp), {
        decodeImage: async () => { throw new Error('synthetic decode failure'); },
    }),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_DECODE_FAILED',
    'a supported signature is insufficient when the browser cannot decode the image',
);

await assert.rejects(
    validate('assets/publication-thumbnail.webp', makeEntry(SAMPLES.webp), {
        decodeImage: async () => ({ width: DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE + 1, height: 1 }),
    }),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_DIMENSIONS_INVALID',
);

{
    let bitmapClosed = false;
    const dimensions = await decodeDspPublicationThumbnailImage(
        new Blob([SAMPLES.webp], { type: 'image/webp' }),
        {
            createImageBitmapRef: async () => ({
                width: 720,
                height: 1280,
                close: () => { bitmapClosed = true; },
            }),
            ImageConstructor: null,
            urlApi: null,
        },
    );
    assert.deepEqual(dimensions, { width: 720, height: 1280 });
    assert.equal(bitmapClosed, true, 'temporary ImageBitmap resources are released');
}

{
    const objectUrls = [];
    class FakeImage {
        set src(value) {
            objectUrls.push(['load', value]);
            this.naturalWidth = 640;
            this.naturalHeight = 360;
            queueMicrotask(() => this.onload());
        }
    }
    const dimensions = await decodeDspPublicationThumbnailImage(
        new Blob([SAMPLES.gif], { type: 'image/gif' }),
        {
            createImageBitmapRef: async () => { throw new Error('bitmap decoder lacks GIF support'); },
            ImageConstructor: FakeImage,
            urlApi: {
                createObjectURL: () => 'blob:validated-archive-image',
                revokeObjectURL: (value) => objectUrls.push(['revoke', value]),
            },
        },
    );
    assert.deepEqual(dimensions, { width: 640, height: 360 });
    assert.deepEqual(objectUrls, [
        ['load', 'blob:validated-archive-image'],
        ['revoke', 'blob:validated-archive-image'],
    ], 'the HTML image fallback only receives an archive-local Blob URL and always revokes it');
}

{
    let readCount = 0;
    await assert.rejects(
        validate(
            'assets/publication-thumbnail.webp',
            makeEntry(SAMPLES.webp, {
                declaredBytes: DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES + 1,
                onRead: () => { readCount += 1; },
            }),
        ),
        (error) => error instanceof DspPublicationThumbnailImportError
            && error.code === 'DSP_PUBLICATION_THUMBNAIL_SIZE_INVALID',
    );
    assert.equal(readCount, 0, 'oversized ZIP entries are rejected before decompression');
}

await assert.rejects(
    validate(
        'assets/publication-thumbnail.webp',
        makeEntry(SAMPLES.webp, { declaredBytes: 8 }),
        { maximumBytes: SAMPLES.webp.byteLength - 1 },
    ),
    (error) => error instanceof DspPublicationThumbnailImportError
        && error.code === 'DSP_PUBLICATION_THUMBNAIL_SIZE_INVALID',
    'the actual decompressed size is checked independently of ZIP metadata',
);

const exportSource = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
const parseStart = exportSource.indexOf('export async function parseAndLoadDSP');
const parseEnd = exportSource.indexOf('function buildFixedBookConfig', parseStart);
const parseSource = exportSource.slice(parseStart, parseEnd);
const validationIndex = parseSource.indexOf('validateDspPublicationThumbnailArchiveAsset');
const objectUrlIndex = parseSource.indexOf('URL.createObjectURL');
assert.equal(validationIndex >= 0 && validationIndex < objectUrlIndex, true,
    'the publication thumbnail is validated before any imported Object URL is created');
assert.match(parseSource, /getArchiveEntry:\s*\(relativePath\) => zip\.file\(relativePath\)/);
assert.match(parseSource, /isPublicationThumbnail[\s\S]*publicationThumbnailAsset\.mimeType/,
    'the validated signature MIME type is used for the restored thumbnail Blob');
assert.match(parseSource, /key === 'publicationThumbnailUrl'[\s\S]*assetMap\.get\(entry\) \|\| ''/,
    'an unresolved publicationThumbnailUrl can never survive recursive asset restoration');
assert.match(parseSource, /publicationThumbnailUrl:\s*publicationThumbnailAsset[\s\S]*assetMap\.get\(publicationThumbnailAsset\.relativePath\)[\s\S]*:\s*''/,
    'the returned Project contains only the validated archive Object URL or an empty preference');

console.log('DSP publication thumbnail import verification passed.');
