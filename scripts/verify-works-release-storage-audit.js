import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DSF_RELEASE_INVENTORY_CLIENT_DEFAULT_LIMIT,
    DSF_RELEASE_INVENTORY_CLIENT_MAX_PAGES,
    fetchDsfReleaseInventoryPages,
} from '../js/dsf-release-inventory-client.js';

function inventoryPage({ truncated, cursor = truncated ? 'next-cursor' : null } = {}) {
    return {
        inventoryVersion: 1,
        inventoryKind: 'owner-dsf-release-storage-page',
        prefix: 'users/owner_1/dsf/',
        objects: [],
        scannedObjectCount: 0,
        truncated,
        cursor,
    };
}

assert.equal(DSF_RELEASE_INVENTORY_CLIENT_DEFAULT_LIMIT, 1000);
assert.equal(DSF_RELEASE_INVENTORY_CLIENT_MAX_PAGES, 50);

{
    const calls = [];
    const responses = [
        inventoryPage({ truncated: true, cursor: 'opaque cursor/1' }),
        inventoryPage({ truncated: false }),
    ];
    const pages = await fetchDsfReleaseInventoryPages({
        token: 'owner-token',
        limit: 2,
        fetchImpl: async (input, options) => {
            calls.push({ input, options });
            return Response.json(responses.shift());
        },
    });
    assert.equal(pages.length, 2);
    assert.equal(pages.at(-1).truncated, false);
    assert.equal(calls[0].input, '/release-inventory?limit=2');
    assert.equal(calls[1].input, '/release-inventory?limit=2&cursor=opaque+cursor%2F1');
    calls.forEach(({ options }) => {
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, 'Bearer owner-token');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.credentials, 'same-origin');
    });
}

{
    let calls = 0;
    await assert.rejects(
        fetchDsfReleaseInventoryPages({
            token: 'owner-token',
            fetchImpl: async () => {
                calls += 1;
                return Response.json(inventoryPage({ truncated: true, cursor: 'same-cursor' }));
            },
        }),
        (error) => error?.code === 'DSF_RELEASE_INVENTORY_CURSOR_REPEATED',
    );
    assert.equal(calls, 2, 'repeated cursors must stop pagination');
}

{
    let calls = 0;
    const pages = await fetchDsfReleaseInventoryPages({
        token: 'owner-token',
        maxPages: 1,
        fetchImpl: async () => {
            calls += 1;
            return Response.json(inventoryPage({ truncated: true }));
        },
    });
    assert.equal(calls, 1, 'the hard page bound must stop additional requests');
    assert.equal(pages.at(-1).truncated, true, 'bounded results remain explicitly incomplete');
}

{
    let calls = 0;
    await assert.rejects(
        fetchDsfReleaseInventoryPages({
            token: '',
            fetchImpl: async () => {
                calls += 1;
                return Response.json(inventoryPage({ truncated: false }));
            },
        }),
        (error) => error?.code === 'DSF_RELEASE_INVENTORY_AUTH_REQUIRED',
    );
    assert.equal(calls, 0, 'no request may run without an owner token');
}

const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../js/dsf-release-inventory-client.js', import.meta.url), 'utf8');
const endpointSource = readFileSync(new URL('../functions/release-inventory.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');

assert.match(worksSource, /data-works-release-audit-run/);
assert.match(worksSource, /button\.addEventListener\('click', async \(\) =>/,
    'inventory must run only from an explicit owner action');
assert.match(worksSource, /auth\.currentUser/);
assert.match(worksSource, /user\.getIdToken\(false\)/);
assert.match(worksSource, /fetchDsfReleaseInventoryPages\(\{ token \}\)/);
assert.match(worksSource, /createDsfReleaseStorageAudit\(/);
assert.match(worksSource, /where\('authorUid', '==', ownerUid\)/);
assert.match(worksSource, /if \(!projects\.length\) return;/,
    'audit panel binding must happen before the empty-project early return');
assert.match(worksSource, /data-works-operation-diagnostic/);
assert.match(worksSource, /_clearWorksOperationDiagnostic\(row\);/);
assert.match(worksSource, /_renderWorksOperationDiagnostic\(row, err, newStatus\);/);
assert.doesNotMatch(worksSource, /alert\(t\('works_status_failed'/,
    'status failures should use the redacted inline diagnostic');

assert.doesNotMatch(clientSource, /\b(?:put|delete)\s*\(/i);
assert.doesNotMatch(endpointSource, /R2_BUCKET\.(?:put|delete)\s*\(/);
assert.match(endpointSource, /R2_BUCKET\.list\(/);
assert.equal((i18nSource.match(/works_release_audit_review_only:/g) || []).length, 2);
assert.equal((i18nSource.match(/works_operation_retry_safe:/g) || []).length, 2);
assert.match(cssSource, /\.works-release-audit\s*\{/);
assert.match(cssSource, /\.works-operation-diagnostic\.is-retry-safe/);

console.log('Works release storage audit UI/client verification passed.');
