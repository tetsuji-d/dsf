import assert from 'node:assert/strict';
import fs from 'node:fs';

const studio = fs.readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
const press = fs.readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const i18n = fs.readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');

for (const key of [
    'press_readiness_title',
    'press_readiness_description',
    'press_readiness_order',
]) {
    assert.match(studio, new RegExp(`data-i18n="${key}"`));
}
for (const key of [
    'press_flow_production_title',
    'press_flow_release_title',
    'press_flow_zip_title',
    'press_horizon_title',
    'press_horizon_draft_title',
    'press_horizon_upload_title',
]) {
    assert.match(press, new RegExp(`t\\('${key}'`));
}
assert.match(i18n, /press_readiness_title:\s*'Export readiness'/);
assert.match(i18n, /press_flow_production_title:\s*'Flow release readiness'/);
assert.match(i18n, /press_horizon_upload_title:\s*'Horizon upload'/);
assert.match(i18n, /querySelectorAll\('\[data-i18n-aria-label\]'\)/);

console.log('Press readiness English UI verification passed.');

