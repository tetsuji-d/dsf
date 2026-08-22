import assert from 'node:assert/strict';
import {
    listTranslationProviderModels,
    listTranslationProviders,
    normalizeTranslationProviderResponse,
    registerTranslationProvider,
    runTranslationProvider,
    TranslationProviderError,
} from '../js/translation-provider.js';

const request = {
    sourceLang: 'ja',
    targetLang: 'en-us',
    modelId: 'fake-model',
    units: [
        { unitId: 'heading_1', text: '第一章' },
        { unitId: 'paragraph_1', text: '冬の金沢は静かだった。' },
    ],
};

const progress = [];
const unregister = registerTranslationProvider('verify-flow-provider', {
    label: 'Verify Flow Provider',
    local: true,
    modelMode: 'fixed',
    defaultModelId: 'fake-model',
    async translate(value, context) {
        context.onProgress?.({ phase: 'translating', current: 1, total: value.units.length });
        const units = value.units.map((unit) => ({
            unitId: unit.unitId,
            text: `EN(${unit.text})`,
            status: 'needs-review',
        }));
        value.units[0].unitId = 'provider-mutated-copy';
        return {
            units,
        };
    },
});

assert.deepEqual(listTranslationProviders().map((provider) => provider.id), ['verify-flow-provider']);
assert.deepEqual(await listTranslationProviderModels('verify-flow-provider'), [{
    id: 'fake-model',
    label: 'Verify Flow Provider',
}]);

const result = await runTranslationProvider(request, {
    providerId: 'verify-flow-provider',
    onProgress(value) {
        progress.push(value);
    },
});
assert.equal(result.providerId, 'verify-flow-provider');
assert.equal(result.cancelled, false);
assert.deepEqual(result.missingUnitIds, []);
assert.equal(result.units[1].text, 'EN(冬の金沢は静かだった。)');
assert.ok(progress.some((value) => value.phase === 'translating'));
assert.equal(request.units[0].unitId, 'heading_1', 'providers receive a disposable request clone');

assert.throws(
    () => normalizeTranslationProviderResponse({
        units: [{ unitId: 'heading_1', text: 'Chapter 1' }],
    }, request),
    (error) => error instanceof TranslationProviderError
        && error.code === 'INVALID_PROVIDER_RESPONSE'
        && error.missingUnitIds.includes('paragraph_1'),
);

assert.throws(
    () => normalizeTranslationProviderResponse({
        units: [{ unitId: 'unknown', text: 'Unknown' }],
    }, request),
    (error) => error instanceof TranslationProviderError
        && error.code === 'INVALID_PROVIDER_RESPONSE',
);

const partial = normalizeTranslationProviderResponse({
    units: [{ unitId: 'heading_1', text: 'Chapter 1' }],
    cancelled: true,
}, request);
assert.equal(partial.cancelled, true);
assert.deepEqual(partial.missingUnitIds, ['paragraph_1']);

const controller = new AbortController();
controller.abort();
const cancelled = await runTranslationProvider(request, {
    providerId: 'verify-flow-provider',
    signal: controller.signal,
});
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.units.length, 0);

const lateAbortController = new AbortController();
const lateCancelled = await runTranslationProvider(request, {
    provider: {
        id: 'late-cancel-provider',
        async translate(value) {
            lateAbortController.abort();
            return {
                units: value.units.map((unit) => ({
                    unitId: unit.unitId,
                    text: `LATE(${unit.text})`,
                })),
            };
        },
    },
    signal: lateAbortController.signal,
});
assert.equal(lateCancelled.cancelled, true, 'late cancellation wins over a completed provider response');

let emptyProviderCalls = 0;
const emptyResult = await runTranslationProvider({
    sourceLang: 'ja',
    targetLang: 'en-us',
    units: [],
}, {
    provider: {
        id: 'empty-provider',
        async translate() {
            emptyProviderCalls += 1;
            return { units: [] };
        },
    },
});
assert.equal(emptyResult.units.length, 0);
assert.equal(emptyProviderCalls, 0, 'empty jobs never start a provider');

unregister();
assert.deepEqual(listTranslationProviders(), []);
console.log('Translation provider runtime contract verification passed.');
