import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    createInitialPressReleaseLanguages,
    reconcilePressReleaseLanguages,
    togglePressReleaseLanguage,
} from '../js/press-release-languages.js';

const available = ['ja', 'en-us', 'ko'];
assert.deepEqual(createInitialPressReleaseLanguages(available, 'ja'), ['ja']);
assert.deepEqual(createInitialPressReleaseLanguages(available, 'missing'), ['ja']);
assert.deepEqual(reconcilePressReleaseLanguages(available, ['en-us', 'unknown'], 'ja'), ['en-us']);
assert.deepEqual(reconcilePressReleaseLanguages(available, [], 'ja'), ['ja']);

const added = togglePressReleaseLanguage(available, ['ja'], 'en-us', 'ja');
assert.equal(added.changed, true);
assert.deepEqual(added.languages, ['ja', 'en-us']);

const sourceRemoved = togglePressReleaseLanguage(available, added.languages, 'ja', 'ja');
assert.equal(sourceRemoved.changed, true);
assert.deepEqual(sourceRemoved.languages, ['en-us']);

const lastRemovalBlocked = togglePressReleaseLanguage(available, sourceRemoved.languages, 'en-us', 'ja');
assert.equal(lastRemovalBlocked.changed, false);
assert.equal(lastRemovalBlocked.reason, 'at-least-one-language-required');
assert.deepEqual(lastRemovalBlocked.languages, ['en-us']);

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /createInitialPressReleaseLanguages/);
assert.match(pressSource, /const langs = _getSelectedPressLangs\(\);/);
assert.doesNotMatch(pressSource, /selectedLangs\.length \? selectedLangs : \(state\.languages/);

console.log('Press release-language selection verification passed.');
