import assert from 'node:assert/strict';
import { createLMStudioTranslationProvider } from '../js/lm-studio-translator-provider.js';

const calls = [];
const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({
            models: [
                { key: 'gemma4:e4b', display_name: 'Gemma 4', type: 'llm', publisher: 'google' },
                { key: 'text-embedding-nomic', display_name: 'Nomic Embed', type: 'embedding' },
                { key: 'qwen3:4b', display_name: 'Qwen 3', type: 'llm', publisher: 'qwen' },
            ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    const source = body.messages.find((message) => message.role === 'user')?.content || '';
    return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: `EN(${source})` } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const provider = createLMStudioTranslationProvider({
    fetch: fakeFetch,
    baseUrl: 'http://127.0.0.1:1234/',
});
const models = await provider.listModels();
assert.deepEqual(models.map((model) => model.id), ['gemma4:e4b', 'qwen3:4b']);

const progress = [];
const response = await provider.translate({
    sourceLang: 'ja',
    targetLang: 'en-US',
    modelId: 'gemma4:e4b',
    units: [
        { unitId: 'unit_1', text: '永遠 DSF-100 https://dsf.ink' },
        { unitId: 'unit_empty', text: '' },
    ],
    constraints: {
        protectedTerms: ['DSF-100'],
        glossary: [{ source: '永遠', target: 'Eternity' }],
        instructions: 'Keep the tone restrained.',
        allowTargetPageCountChange: true,
    },
}, {
    onProgress(value) {
        progress.push(value);
    },
});
assert.equal(response.units.length, 2);
assert.equal(response.units[0].status, 'needs-review');
assert.equal(response.units[0].text, 'EN(永遠) DSF-100 https://dsf.ink');
assert.equal(response.units[1].text, '');
assert.ok(progress.some((item) => item.phase === 'translating' && item.current === 1));

const translationCall = calls.find((call) => String(call.url).endsWith('/v1/chat/completions'));
assert.ok(translationCall);
assert.equal(JSON.parse(translationCall.init.body).model, 'gemma4:e4b');
const systemPrompt = JSON.parse(translationCall.init.body).messages
    .find((message) => message.role === 'system')?.content || '';
assert.match(systemPrompt, /different page count/);
assert.doesNotMatch(systemPrompt, /fixed page slot/i);
assert.match(systemPrompt, /DSF-100/);
assert.match(systemPrompt, /Eternity/);
assert.match(systemPrompt, /Keep the tone restrained/);

const retryCalls = [];
const retryFetch = async (url, init = {}) => {
    retryCalls.push({ url, init });
    const attempt = retryCalls.filter((call) => String(call.url).endsWith('/v1/chat/completions')).length;
    const translated = attempt === 1 ? 'X'.repeat(705) : 'Y'.repeat(670);
    return new Response(JSON.stringify({ choices: [{ message: { content: translated } }] }), { status: 200 });
};
const retryProvider = createLMStudioTranslationProvider({ fetch: retryFetch });
const retried = await retryProvider.translate({
    sourceLang: 'ja',
    targetLang: 'de',
    modelId: 'gemma4:e4b',
    units: [{ unitId: 'unit_retry', text: '制約付き再翻訳の確認' }],
    constraints: { maxCharacters: 680 },
});
assert.equal(retried.units[0].text.length, 670);
assert.equal(retryCalls.filter((call) => String(call.url).endsWith('/v1/chat/completions')).length, 2);
const retryPrompt = JSON.parse(retryCalls.at(-1).init.body).messages
    .find((message) => message.role === 'system')?.content || '';
assert.match(retryPrompt, /STRICT OUTPUT LIMIT/);
assert.match(retryPrompt, /previous attempt used 705/);

let cancelCallCount = 0;
const cancelFetch = async (url, init = {}) => {
    cancelCallCount += 1;
    if (cancelCallCount === 1) {
        const body = JSON.parse(init.body);
        const source = body.messages.find((message) => message.role === 'user')?.content || '';
        return new Response(JSON.stringify({ choices: [{ message: { content: `EN(${source})` } }] }), { status: 200 });
    }
    return new Promise((resolve, reject) => {
        init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
        );
    });
};
const cancelProvider = createLMStudioTranslationProvider({ fetch: cancelFetch, timeoutMs: 5000 });
const abortController = new AbortController();
const cancelledPromise = cancelProvider.translate({
    sourceLang: 'ja',
    targetLang: 'en-US',
    modelId: 'gemma4:e4b',
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
console.log('LM Studio Translator provider verification passed.');
