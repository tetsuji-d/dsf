import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DSF_FONT_CERTIFICATION_CANDIDATES } from '../js/dsf-font-certification-candidates.js';
import { inspectDsfWoff2Bytes } from '../js/dsf-font-asset-verification.js';

const assetDirectory = process.argv[2];
if (!assetDirectory) {
    throw new Error('Usage: node scripts/check-dsf-font-candidate-assets.js <asset-directory>');
}

const results = [];
for (const [candidateId, candidate] of Object.entries(DSF_FONT_CERTIFICATION_CANDIDATES.candidates)) {
    const assetPath = path.resolve(assetDirectory, candidate.asset.fileName);
    const bytes = await readFile(assetPath);
    const woff2 = await inspectDsfWoff2Bytes(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.byteLength, candidate.asset.byteLength, `${candidateId}: byteLength`);
    assert.equal(sha256, candidate.asset.sha256, `${candidateId}: sha256`);
    assert.equal(woff2.signature, 'wOF2', `${candidateId}: signature`);
    results.push({
        candidateId,
        fileName: candidate.asset.fileName,
        byteLength: bytes.byteLength,
        sha256,
        tableCount: woff2.numTables,
        sfntByteLength: woff2.totalSfntSize,
    });
}

console.log(JSON.stringify({ status: 'verified', assets: results }, null, 2));
