import assert from 'node:assert/strict';
import {
    createBrowserTranslationProvider,
    normalizeTranslatorLanguage,
    translateProtectedText,
} from '../js/browser-translator-provider.js';

assert.equal(normalizeTranslatorLanguage('en-US'), 'en');
assert.equal(normalizeTranslatorLanguage('zh-TW'), 'zh-Hant');
assert.equal(normalizeTranslatorLanguage('zh-Hans'), 'zh');

const protectedText = await translateProtectedText(
    '  永遠 DSF-100 https://dsf.ink  ',
    async (text) => `T(${text})`,
);
assert.equal(protectedText, '  T(永遠) DSF-100 https://dsf.ink  ');

const progress = [];
let translationCalls = 0;
const fakeTranslatorApi = {
    create(options) {
        options.monitor({
            addEventListener(type, listener) {
                if (type === 'downloadprogress') listener({ loaded: 0.5 });
            },
        });
        return Promise.resolve({
            async translate(text) {
                translationCalls += 1;
                return `EN(${text})`;
            },
        });
    },
};
const provider = createBrowserTranslationProvider({ Translator: fakeTranslatorApi });
const response = await provider.translate({
    sourceLang: 'ja',
    targetLang: 'en-US',
    units: [
        { unitId: 'unit_1', text: '重要 DSF-100' },
        { unitId: 'unit_empty', text: '' },
    ],
}, {
    onProgress(value) {
        progress.push(value);
    },
});
assert.equal(response.units.length, 2);
assert.equal(response.units[0].text, 'EN(重要) DSF-100');
assert.equal(response.units[0].status, 'needs-review');
assert.equal(response.units[1].text, '');
assert.equal(translationCalls, 1, 'blank semantic units do not call the translator');
assert.ok(progress.some((item) => item.phase === 'downloading' && item.loaded === 0.5));

const abortController = new AbortController();
let cancelCalls = 0;
const cancelProvider = createBrowserTranslationProvider({
    Translator: {
        async create() {
            return {
                translate(text) {
                    cancelCalls += 1;
                    if (cancelCalls === 1) return Promise.resolve(`EN(${text})`);
                    return new Promise(() => {});
                },
            };
        },
    },
});
const cancelledPromise = cancelProvider.translate({
    sourceLang: 'ja',
    targetLang: 'en-US',
    units: [
        { unitId: 'unit_a', text: '一' },
        { unitId: 'unit_b', text: '二' },
    ],
}, {
    signal: abortController.signal,
    onProgress(value) {
        if (value.phase === 'translating' && value.current === 2) {
            setTimeout(() => abortController.abort(), 0);
        }
    },
});
const cancelled = await cancelledPromise;
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.units.length, 1);
console.log('Browser Translator provider verification passed.');
