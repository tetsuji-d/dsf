import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const dashboardStart = appSource.indexOf('async function renderHomeDashboard()');
const dashboardEnd = appSource.indexOf('// ── Studio 認証 UI', dashboardStart);

assert.notEqual(dashboardStart, -1, 'Home dashboard renderer must exist');
assert.notEqual(dashboardEnd, -1, 'Home dashboard renderer boundary must exist');

const dashboardSource = appSource.slice(dashboardStart, dashboardEnd);
const initialWorkRender = dashboardSource.indexOf('pendingReviewSummaries.get(');
const reviewLoad = dashboardSource.indexOf('await loadHomeReviewSummaries(works);');
const localRender = dashboardSource.indexOf('renderHomeLocalProjects(localGrid, localCount, localProjects);');
const cloudWait = dashboardSource.indexOf('await cloudProjectsPromise;');

assert.match(appSource, /let homeDashboardRenderRevision = 0;/, 'Dashboard must track render revisions');
assert.match(
    dashboardSource,
    /if \(renderRevision !== homeDashboardRenderRevision\) return;/,
    'Dashboard must ignore stale asynchronous results'
);
assert.notEqual(initialWorkRender, -1, 'Dashboard must render work cards with pending review state');
assert.notEqual(reviewLoad, -1, 'Dashboard must load review summaries after the initial cards');
assert.ok(
    initialWorkRender < reviewLoad,
    'Work cards must render before review summary requests finish'
);
assert.notEqual(localRender, -1, 'Dashboard must render local projects independently');
assert.notEqual(cloudWait, -1, 'Dashboard must wait for the already-started cloud request');
assert.ok(
    localRender < cloudWait,
    'Local projects must render while cloud projects are still loading'
);
assert.match(
    dashboardSource,
    /reviewsLoading:\s*works\.length > 0/,
    'Dashboard stats must show a loading state while reviews are pending'
);
assert.match(
    appSource,
    /function bindHomeWorkActions\(workGrid, cloudProjects\)/,
    'Work actions must be rebound after review metrics update'
);
assert.match(
    appSource,
    /const HOME_REVIEW_CACHE_TTL_MS = 30_000;/,
    'Dashboard review summaries must use a short-lived cache'
);
assert.match(
    appSource,
    /const homeReviewSummaryRequests = new Map\(\);/,
    'Dashboard review summaries must track in-flight requests'
);
assert.match(
    appSource,
    /const inFlight = homeReviewSummaryRequests\.get\(workId\);\s*if \(inFlight\) return inFlight;/,
    'Dashboard must reuse an in-flight review request'
);
assert.match(
    appSource,
    /if \(!summary\.unavailable\) \{\s*homeReviewSummaryCache\.set\(/,
    'Dashboard must only cache successful review summaries'
);
assert.match(
    appSource,
    /loading="lazy" decoding="async"/,
    'Dashboard thumbnails must not block initial rendering'
);
assert.match(
    appSource,
    /function fetchHomeCloudProjects\(\)/,
    'Dashboard must centralize cloud project requests'
);
assert.match(
    appSource,
    /homeCloudProjectsRequest && homeCloudProjectsRequestUid === requestUid/,
    'Dashboard must reuse an in-flight cloud request for the same user'
);
assert.match(
    dashboardSource,
    /fetchHomeCloudProjects\(\)/,
    'Dashboard rendering must use the deduplicated cloud request'
);

console.log('Home dashboard progressive loading verification passed.');
