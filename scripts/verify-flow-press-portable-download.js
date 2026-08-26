import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DSF_CONTENT_MIMETYPE } from '../js/dsf-release-file-inventory.js';
import { DSF_RELEASE_ZIP_PACKAGE_FORMAT } from '../js/dsf-release-zip-package.js';
import { FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION } from '../js/flow-press-local-release-package.js';
import {
    FLOW_PRESS_PORTABLE_DOWNLOAD_VERSION,
    createFlowPressPortableDownloadArtifact,
} from '../js/flow-press-portable-download.js';

const sha256 = 'a'.repeat(64);
const blob = new Blob([new Uint8Array([80, 75, 3, 4])], { type: DSF_CONTENT_MIMETYPE });
const packageResult = {
    packageVersion: FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION,
    packageKind: 'portable-local-only',
    ready: true,
    inventory: { meta: { title: 'Flow: 第一章?.dsf' } },
    summary: {
        roundTripVerified: true,
        zipByteLength: blob.size,
        zipSha256: sha256,
    },
    zipPackage: {
        format: DSF_RELEASE_ZIP_PACKAGE_FORMAT,
        mimeType: DSF_CONTENT_MIMETYPE,
        byteLength: blob.size,
        sha256,
        blob,
        roundTrip: { byteLength: blob.size, sha256 },
    },
};

const artifact = createFlowPressPortableDownloadArtifact({
    packageResult,
    expectedSignature: 'current-package',
    currentSignature: 'current-package',
});
assert.equal(Object.isFrozen(artifact), true);
assert.equal(artifact.downloadVersion, FLOW_PRESS_PORTABLE_DOWNLOAD_VERSION);
assert.equal(artifact.downloadKind, 'portable-local-file');
assert.equal(artifact.filename, 'Flow_ 第一章_.dsf');
assert.equal(artifact.blob, blob);
assert.equal(artifact.byteLength, blob.size);
assert.equal(artifact.sha256, sha256);

const reservedArtifact = createFlowPressPortableDownloadArtifact({
    packageResult: {
        ...packageResult,
        inventory: { meta: { title: 'CON' } },
    },
    expectedSignature: 'reserved',
    currentSignature: 'reserved',
});
assert.equal(reservedArtifact.filename, 'CON_.dsf');

assert.throws(
    () => createFlowPressPortableDownloadArtifact({
        packageResult,
        expectedSignature: 'old-package',
        currentSignature: 'new-package',
    }),
    (error) => error?.code === 'FLOW_PORTABLE_DOWNLOAD_STALE',
);
assert.throws(
    () => createFlowPressPortableDownloadArtifact({
        packageResult: {
            ...packageResult,
            summary: { ...packageResult.summary, roundTripVerified: false },
        },
        expectedSignature: 'current-package',
        currentSignature: 'current-package',
    }),
    (error) => error?.code === 'FLOW_PORTABLE_DOWNLOAD_PACKAGE_UNVERIFIED',
);
assert.throws(
    () => createFlowPressPortableDownloadArtifact({
        packageResult: {
            ...packageResult,
            zipPackage: { ...packageResult.zipPackage, byteLength: blob.size + 1 },
        },
        expectedSignature: 'current-package',
        currentSignature: 'current-package',
    }),
    (error) => error?.code === 'FLOW_PORTABLE_DOWNLOAD_PACKAGE_UNVERIFIED'
        || error?.code === 'FLOW_PORTABLE_DOWNLOAD_BLOB_INVALID',
);

const source = readFileSync(new URL('../js/flow-press-portable-download.js', import.meta.url), 'utf8');
for (const forbidden of ['saveAs(', 'document.', 'window.', 'localStorage', 'indexedDB', './firebase', 'upload']) {
    assert.equal(source.includes(forbidden), false, `pure download handoff cannot depend on ${forbidden}`);
}

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
assert.match(pressSource, /createFlowPressPortableDownloadArtifact/);
assert.match(pressSource, /getFlowPortableDsfDownloadArtifact/);
assert.match(pressSource, /data-flow-portable-download/);
assert.match(pressSource, /function _invalidatePressFlowLocalReleaseForSettingsChange\(\)/);
assert.match(pressSource, /press-resolution'\)\?\.addEventListener\('change', _handlePressLocalReleaseSettingChange\)/);
assert.match(pressSource, /window\.togglePressLang = \(code\) => \{[\s\S]*?_handlePressLocalReleaseSettingChange\(\);/);
assert.match(pressSource, /window\.updatePressBookMode = \(mode\) => \{[\s\S]*?_invalidatePressFlowLocalReleaseForSettingsChange\(\);/);
assert.match(pressSource, /state\.bookMode \|\| ''[\s\S]*?state\.book \|\| \{\}/);
assert.match(exportSource, /getFlowPortableDsfDownloadArtifact/);
assert.match(exportSource, /saveAs\(currentArtifact\.blob, currentArtifact\.filename\)/);
assert.doesNotMatch(exportSource, /検証済みFlow配信データのエクスポート名/);
assert.doesNotMatch(exportSource, /FLOW_PUBLICATION_NOT_CONNECTED/);
assert.match(appSource, /flowPortableState/);
assert.equal((studioSource.match(/data-flow-portable-download/g) || []).length, 2);
assert.match(studioSource, /press-publish-cloud-btn[^>]*data-auth-required data-flow-publication-required/);

console.log('Flow Press verified portable download handoff passed.');
