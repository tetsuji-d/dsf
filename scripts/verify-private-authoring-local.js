/** Local workerd/Miniflare contract check. No Cloudflare or Firebase account access. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wranglerCli = require.resolve('wrangler');
const wranglerRequire = createRequire(wranglerCli);
const { Miniflare } = wranglerRequire('miniflare');
const { buildSync } = wranglerRequire('esbuild');
const temporary = mkdtempSync(join(tmpdir(), 'dsf-authoring-local-'));
const workerPath = join(temporary, 'worker.mjs');
let runtime;
try {
    execFileSync(process.execPath, [wranglerCli, 'pages', 'functions', 'build', 'functions', '--outfile', workerPath,
        '--compatibility-date', '2024-09-01'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', timeout: 60_000,
    });
    // Pages --outfile is an upload multipart bundle, not a JavaScript source file.
    const bundle = readFileSync(workerPath);
    const boundary = bundle.toString('utf8').split('\r\n')[0].slice(2);
    const form = await new Response(bundle, { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }).formData();
    const metadata = JSON.parse(form.get('metadata'));
    assert.deepEqual([...form.keys()].sort(), ['metadata', metadata.main_module].sort(), 'unexpected external Worker modules');
    const source = await form.get(metadata.main_module).text();
    const fixture = buildSync({ entryPoints: [fileURLToPath(new URL('./fixtures/private-authoring-r2-worker.js', import.meta.url))],
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' }).outputFiles[0].text;
    runtime = new Miniflare({ workers: [
        { name: 'pages', modules: true, script: source, compatibilityDate: '2024-09-01', bindings: { AUTHORING_API_ENABLED: 'false' } },
        { name: 'r2-check', modules: true, script: fixture, compatibilityDate: '2024-09-01', r2Buckets: ['AUTHORING_BUCKET'] },
    ] });
    for (const path of ['/api/projects/project_1/actions', '/api/projects/project_1/authoring', '/api/projects/project_1/authoring/operations/request_1']) {
        const response = await runtime.dispatchFetch(`https://studio.test${path}`);
        assert.equal(response.status, 503, path);
        assert.equal((await response.json()).error, 'AUTHORING_API_DISABLED');
        assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    }
    const localWorker = await runtime.getWorker('r2-check');
    const result = await localWorker.fetch('https://local.test/verify');
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).passed, true);
    console.log('Local workerd routes + R2 conditional write, retry, scope and corruption verification passed.');
} finally {
    await runtime?.dispose();
    // Remove only the file and empty directory created by this script (no recursive delete).
    if (existsSync(workerPath)) unlinkSync(workerPath);
    rmdirSync(temporary);
}
