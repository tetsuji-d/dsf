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
assert.match(
    portalSource,
    /resolveProjectDisplayTitle\(project, \{ locale: currentLang \}\)/,
    'Portal cards must resolve the current language from semantic title metadata',
);
assert.match(portalSource, /meta:\s+data\.meta/);
assert.match(portalSource, /defaultLang:\s+typeof data\.defaultLang/);
assert.doesNotMatch(portalSource, /titleRaw/);

console.log('Portal public feed startup verification passed.');
