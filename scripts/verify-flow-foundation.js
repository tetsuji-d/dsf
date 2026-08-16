import assert from 'node:assert/strict';
import {
    countGraphemes,
    segmentGraphemes,
    splitAtGraphemeCount,
    splitGraphemes,
} from '../js/grapheme.js';
import {
    DEFAULT_FLOW_WRITING_MODE,
    getFlowKinsokuProfile,
    getFlowLanguageScript,
    getFlowTypographyProfile,
    isFlowWritingModeSupported,
    normalizeFlowLanguageTag,
} from '../js/flow-typography.js';

const decomposedGa = 'か\u3099';
const familyEmoji = '👨‍👩‍👧‍👦';
const variationKanji = '葛\u{E0100}';
const flag = '🇯🇵';

assert.equal(countGraphemes(decomposedGa, 'ja'), 1);
assert.equal(countGraphemes(familyEmoji), 1);
assert.equal(countGraphemes(variationKanji, 'ja'), 1);
assert.equal(countGraphemes(flag), 1);
assert.deepEqual(splitGraphemes(`A${decomposedGa}B`, 'ja'), ['A', decomposedGa, 'B']);

const source = `A${decomposedGa}${familyEmoji}${variationKanji}${flag}B`;
for (let limit = 0; limit <= countGraphemes(source); limit += 1) {
    const [head, tail] = splitAtGraphemeCount(source, limit, 'ja');
    assert.equal(head + tail, source, `split at ${limit} must not lose or duplicate text`);
    assert.equal(countGraphemes(head, 'ja'), limit);
}

const offsets = segmentGraphemes(`A${decomposedGa}B`, 'ja');
assert.deepEqual(offsets.map(({ index, end }) => [index, end]), [[0, 1], [1, 3], [3, 4]]);
assert.equal(countGraphemes('\r\n'), 1);

const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
if (segmenterDescriptor?.configurable) {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    try {
        assert.equal(countGraphemes(`A${decomposedGa}${familyEmoji}${flag}B`), 5);
        assert.deepEqual(splitGraphemes('\n\u0301'), ['\n', '\u0301']);
        assert.deepEqual(splitGraphemes('A\u200DB'), ['A\u200D', 'B']);
        assert.deepEqual(splitGraphemes('\u200D👩'), ['\u200D', '👩']);
        assert.equal(countGraphemes('👨\u200D👩'), 1);
        assert.equal(countGraphemes('각', 'ko'), 1);
        assert.equal(countGraphemes('각', 'ko'), 1);
    } finally {
        Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor);
    }
}

assert.equal(normalizeFlowLanguageTag('en-us'), 'en-US');
assert.equal(normalizeFlowLanguageTag('zh_cn'), 'zh-Hans');
assert.equal(normalizeFlowLanguageTag('zh-tw'), 'zh-Hant');
assert.equal(normalizeFlowLanguageTag('jp'), 'ja');
assert.equal(getFlowLanguageScript('ja'), 'jpan');
assert.equal(getFlowLanguageScript('zh-Hans'), 'hans');
assert.equal(getFlowLanguageScript('zh-Hant'), 'hant');
assert.equal(getFlowLanguageScript('zh-TW-u-nu-hanidec'), 'hant');
assert.equal(getFlowLanguageScript('zh-HK-x-private'), 'hant');
assert.equal(getFlowLanguageScript('ko'), 'kore');
assert.equal(getFlowLanguageScript('fr-FR'), 'latn');
assert.equal(getFlowLanguageScript('ar'), 'arab');
assert.equal(getFlowLanguageScript('sr-Cyrl'), 'cyrl');

const localeDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Locale');
if (localeDescriptor?.configurable) {
    Object.defineProperty(Intl, 'Locale', { configurable: true, value: undefined });
    try {
        assert.equal(getFlowLanguageScript('zh-TW-u-nu-hanidec'), 'hant');
        assert.equal(getFlowLanguageScript('sr-Cyrl'), 'cyrl');
    } finally {
        Object.defineProperty(Intl, 'Locale', localeDescriptor);
    }
}

const japaneseKinsoku = getFlowKinsokuProfile('ja');
const chineseKinsoku = getFlowKinsokuProfile('zh-Hans');
assert.equal(japaneseKinsoku.lineStart.includes('ー'), true);
assert.equal(japaneseKinsoku.lineStart.includes('」'), true);
assert.equal(chineseKinsoku.lineStart.includes('ー'), false);
assert.equal(japaneseKinsoku.lineEnd.includes('「'), true);
assert.equal(getFlowKinsokuProfile('en-US').id, 'none');

assert.equal(isFlowWritingModeSupported('ja', 'vertical-rl'), true);
assert.equal(isFlowWritingModeSupported('zh-Hant', 'vertical-rl'), true);
assert.equal(isFlowWritingModeSupported('zh-Hans', 'vertical-rl'), false);
assert.equal(isFlowWritingModeSupported('ko', 'vertical-rl'), false);
assert.equal(isFlowWritingModeSupported('en-US', 'horizontal-tb'), true);
assert.equal(isFlowWritingModeSupported('en-US', 'vertical-rl'), false);
assert.equal(isFlowWritingModeSupported('ja', 'sideways-rl'), false);
assert.equal(DEFAULT_FLOW_WRITING_MODE, 'horizontal-tb');
assert.equal(isFlowWritingModeSupported('ja'), true);

const jaProfile = getFlowTypographyProfile('ja', 'vertical-rl');
assert.equal(jaProfile.lookupLanguageTag, 'ja');
assert.equal(jaProfile.writingModeSupported, true);
assert.equal(jaProfile.rules.kinsokuProfileId, 'japanese');
assert.equal(jaProfile.rules.wrapPolicy, 'break-anywhere');
const enProfile = getFlowTypographyProfile('en-us', 'horizontal-tb');
assert.equal(enProfile.lookupLanguageTag, 'en-US');
assert.equal(enProfile.rules.kinsokuProfileId, 'none');
assert.equal(enProfile.rules.wrapPolicy, 'keep-words');
const arProfile = getFlowTypographyProfile('ar', 'horizontal-tb');
assert.equal(arProfile.script, 'arab');
assert.equal(arProfile.writingModeSupported, false);
assert.equal(arProfile.rules.wrapPolicy, 'language-default');
const invalidModeProfile = getFlowTypographyProfile('ja', 'sideways-rl');
assert.equal(invalidModeProfile.writingMode, 'sideways-rl');
assert.equal(invalidModeProfile.writingModeSupported, false);

console.log('Flow foundation verification passed.');
