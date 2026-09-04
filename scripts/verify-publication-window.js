import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    getPublicationInactiveReason,
    isPublicationActive,
    toDate,
} from '../js/publication.js';

const publication = {
    listedFrom: new Date('2026-09-01T00:00:00.000Z'),
    listedUntil: new Date('2026-09-30T23:59:59.999Z'),
    publicFrom: new Date('2026-09-04T03:00:00.000Z'),
    publicUntil: new Date('2026-09-04T04:00:00.000Z'),
};

const beforePublicStart = new Date('2026-09-04T02:59:59.999Z');
const duringPublicWindow = new Date('2026-09-04T03:30:00.000Z');
const afterPublicEnd = new Date('2026-09-04T04:00:00.001Z');

for (const status of ['public', 'unlisted']) {
    assert.equal(isPublicationActive(publication, status, beforePublicStart), false);
    assert.equal(
        getPublicationInactiveReason(publication, status, beforePublicStart),
        'public_scheduled',
    );
    assert.equal(isPublicationActive(publication, status, duringPublicWindow), true);
    assert.equal(isPublicationActive(publication, status, afterPublicEnd), false);
    assert.equal(getPublicationInactiveReason(publication, status, afterPublicEnd), 'public');
}

const beforeListingStart = {
    ...publication,
    listedFrom: new Date('2026-09-05T00:00:00.000Z'),
};
assert.equal(
    getPublicationInactiveReason(beforeListingStart, 'public', duringPublicWindow),
    'listing',
    'the listing entitlement window must take precedence over the public window',
);

const afterListingEnd = {
    ...publication,
    listedUntil: new Date('2026-09-04T03:29:59.999Z'),
};
assert.equal(isPublicationActive(afterListingEnd, 'public', duringPublicWindow), false);
assert.equal(getPublicationInactiveReason(afterListingEnd, 'public', duringPublicWindow), 'listing');

const firestoreTimestampLike = {
    toDate: () => new Date('2026-09-04T03:00:00.000Z'),
};
assert.equal(toDate(firestoreTimestampLike)?.toISOString(), '2026-09-04T03:00:00.000Z');

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
const portalSource = readFileSync(new URL('../js/portal.js', import.meta.url), 'utf8');
const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');

const publicLoaderStart = viewerSource.indexOf('async function loadWorkFromPublicIndex');
const publicLoaderEnd = viewerSource.indexOf('async function loadHorizonProjection', publicLoaderStart);
assert.ok(publicLoaderStart >= 0 && publicLoaderEnd > publicLoaderStart);
const publicLoaderSource = viewerSource.slice(publicLoaderStart, publicLoaderEnd);
const viewerWindowGate = publicLoaderSource.indexOf('isPublicationActive(');
const viewerV2Branch = publicLoaderSource.indexOf('isDsfHorizonV2MetadataDeclared(');
const viewerV1Branch = publicLoaderSource.indexOf('Array.isArray(indexData.dsfPages)');
assert.ok(viewerWindowGate >= 0, 'public Viewer must enforce the publication window');
assert.ok(
    viewerWindowGate < viewerV2Branch && viewerWindowGate < viewerV1Branch,
    'the publication window gate must run before both v2 and v1 delivery branches',
);
assert.match(
    portalSource,
    /status === 'public' && isPublicationActive\(data\.publication \|\| \{\}, status\)/,
    'Horizon must exclude public works outside their publication window',
);
assert.match(
    worksSource,
    /\(newStatus === 'public' \|\| newStatus === 'unlisted'\) && !isPublicationActive\(publication, newStatus\)/,
    'Works must reject a public transition whose publication window is already inactive',
);

console.log('Publication start/end boundary and shared v1/v2 gate verification passed.');
