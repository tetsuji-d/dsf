import assert from 'node:assert/strict';
import { writingBuildEnabled } from './writing-build-policy.mjs';
import { writingStagingPlugin } from './writing-w1/staging-assets.mjs';
import { writeWritingZip } from '../js/dsf-writing-zip.js';
import { loadDsfLocalViewerPackage } from '../js/dsf-local-viewer-package.js';

assert.equal(writingBuildEnabled('staging', {}), true);
assert.equal(writingBuildEnabled('staging', { DSF_WRITING_PREVIEW: '0' }), true);
assert.ok(writingStagingPlugin('staging'), 'staging must include the runtime as well as enable the UI');
assert.equal(writingBuildEnabled('production', {}), false);
assert.equal(writingBuildEnabled('production', { DSF_WRITING_RELEASE: '1' }), true);
assert.equal(writingBuildEnabled('development', {}), false);
assert.equal(writingBuildEnabled('development', { DSF_WRITING_PREVIEW: '1' }), true);

// A recognized v3 container in a deliberately disabled development build must
// report unavailable support, rather than misclassifying it as corrupt v2.
const encode = value => new TextEncoder().encode(value);
const bytes = writeWritingZip([
    { path: 'mimetype', bytes: encode('application/vnd.dsf.content+zip') },
    { path: 'format.json', bytes: encode('{}') },
]);
await assert.rejects(loadDsfLocalViewerPackage({ file: new Blob([bytes]), allowWriting: false }),
    error => error.issues?.[0]?.code === 'LOCAL_DSF_WRITING_UNAVAILABLE');
console.log('Writing build policy and unavailable-format diagnostic: PASS');
