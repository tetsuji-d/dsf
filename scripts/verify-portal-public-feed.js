import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const portalSource = readFileSync(new URL('../js/portal.js', import.meta.url), 'utf8');
const initMarker = '// ---- Init ----------------------------------------------------------------';
const initStart = portalSource.indexOf(initMarker);

assert.notEqual(initStart, -1, 'Portal init section must exist');

const initSource = portalSource.slice(initStart);
const publicFeedStart = initSource.indexOf('void loadPublicProjects();');
const authRedirectStart = initSource.indexOf('await handleRedirectResult(auth);');

assert.notEqual(publicFeedStart, -1, 'Portal init must start the public feed');
assert.notEqual(authRedirectStart, -1, 'Portal init must handle the auth redirect');
assert.ok(
    publicFeedStart < authRedirectStart,
    'Public feed loading must start before authentication bootstrap'
);
assert.equal(
    (initSource.match(/loadPublicProjects\(\)/g) || []).length,
    1,
    'Portal init must not start duplicate public feed loads'
);

console.log('Portal public feed startup verification passed.');
