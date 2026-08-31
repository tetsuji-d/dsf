import assert from 'node:assert/strict';
import {
    FlowPageProjectionError,
    buildFlowPageProjection,
    getFlowGroupProjectionPages,
} from '../js/flow-page-projection.js';
import {
    FlowRuntimePageError,
    createFlowRuntimeProjectionSignature,
    resolveFlowRuntimeLanguage,
} from '../js/flow-runtime-pages.js';

function generatedPage(index, blockId, text, manualBreakBefore = null) {
    return Object.freeze({
        index,
        manualBreakBefore,
        fragments: Object.freeze([Object.freeze({
            blockId,
            blockType: 'paragraph',
            text,
            sourceRange: Object.freeze({ start: 0, end: text.length }),
        })]),
    });
}

function result(groupId, languageKey, pages) {
    return Object.freeze({
        groupId,
        requestedLanguageKey: languageKey,
        languageKey,
        isSourceFallback: false,
        pageBox: Object.freeze({ width: 360, height: 640 }),
        writingMode: 'vertical-rl',
        typography: Object.freeze({ fontSize: 16 }),
        pagination: Object.freeze({
            documentId: `doc_${groupId}`,
            languageKey,
            writingMode: 'vertical-rl',
            pages: Object.freeze(pages),
        }),
    });
}

const fixedA = Object.freeze({ type: 'image', marker: 'A' });
const fixedB = Object.freeze({ type: 'text', marker: 'B' });
const blocks = Object.freeze([
    Object.freeze({ id: 'page_a', kind: 'page' }),
    Object.freeze({ id: 'chapter_1', kind: 'chapter' }),
    Object.freeze({
        id: 'flow_a',
        kind: 'flow',
        flow: Object.freeze({ document: Object.freeze({ id: 'doc_flow_a' }) }),
    }),
    Object.freeze({ id: 'page_b', kind: 'page' }),
]);
const sourceBefore = JSON.stringify({ blocks, fixedPages: [fixedA, fixedB] });
const flowPages = [
    generatedPage(0, 'paragraph_a', '前半'),
    generatedPage(1, 'paragraph_a', '後半', 'break_1'),
];
const flowResults = new Map([['flow_a', result('flow_a', 'ja', flowPages)]]);
const projection = buildFlowPageProjection({
    blocks,
    fixedPages: [fixedA, fixedB],
    flowResults,
    languageKey: 'ja',
});

assert.equal(JSON.stringify({ blocks, fixedPages: [fixedA, fixedB] }), sourceBefore, 'projection must not mutate source');
assert.deepEqual(projection.pages.map((page) => page.kind), ['fixed', 'flow', 'flow', 'fixed']);
assert.deepEqual(projection.pages.map((page) => page.physicalPageNumber), [1, 2, 3, 4]);
assert.deepEqual(projection.pages.map((page) => page.blockIndex), [0, 2, 2, 3]);
assert.deepEqual(projection.pages.filter((page) => page.kind === 'fixed').map((page) => page.fixedPageIndex), [0, 1]);
assert.deepEqual(getFlowGroupProjectionPages(projection, 'flow_a').map((page) => page.flowPageNumber), [1, 2]);
assert.equal(projection.fixedPageCount, 2);
assert.equal(projection.flowPageCount, 2);
assert.equal(projection.totalPageCount, 4);
assert.deepEqual(projection.flowGroups[0], {
    groupId: 'flow_a',
    documentId: 'doc_flow_a',
    blockIndex: 2,
    firstPageIndex: 1,
    pageCount: 2,
    requestedLanguageKey: 'ja',
    languageKey: 'ja',
    isSourceFallback: false,
    changeSet: null,
    metrics: null,
});
assert.equal(projection.pages[1].page, flowPages[0], 'generated page should remain a runtime reference');
assert.equal(Object.prototype.hasOwnProperty.call(blocks[2].flow, 'pages'), false, 'projection must not write pages into Flow source');
assert.notEqual(projection.pages[1].runtimeKey, projection.pages[2].runtimeKey);

const fixedOnly = buildFlowPageProjection({
    blocks: [{ id: 'page_only', kind: 'page' }],
    fixedPages: [fixedA],
    flowResults: new Map(),
    languageKey: 'ja',
});
assert.equal(fixedOnly.totalPageCount, 1);
assert.equal(fixedOnly.pages[0].runtimeKey, 'fixed:page_only');

assert.throws(
    () => buildFlowPageProjection({ blocks, fixedPages: [fixedA], flowResults, languageKey: 'ja' }),
    (error) => error instanceof FlowPageProjectionError && error.code === 'FIXED_PAGE_COUNT_MISMATCH',
);
assert.throws(
    () => buildFlowPageProjection({ blocks, fixedPages: [fixedA, fixedB], flowResults: new Map(), languageKey: 'ja' }),
    (error) => error instanceof FlowPageProjectionError && error.code === 'FLOW_RESULT_MISSING',
);
assert.throws(
    () => buildFlowPageProjection({
        blocks,
        fixedPages: [fixedA, fixedB],
        flowResults: new Map([['flow_a', result('flow_a', 'en', flowPages)]]),
        languageKey: 'ja',
    }),
    (error) => error instanceof FlowPageProjectionError && error.code === 'FLOW_LANGUAGE_MISMATCH',
);

assert.throws(
    () => buildFlowPageProjection({
        blocks: [blocks[2]],
        fixedPages: [],
        flowResults: new Map([['flow_a', result('flow_a', 'ja', [])]]),
        languageKey: 'ja',
    }),
    (error) => error instanceof FlowPageProjectionError && error.code === 'FLOW_RESULT_EMPTY',
);

const fallback = result('flow_a', 'ja', flowPages);
const fallbackProjection = buildFlowPageProjection({
    blocks: [blocks[2]],
    fixedPages: [],
    flowResults: new Map([['flow_a', Object.freeze({
        ...fallback,
        requestedLanguageKey: 'en',
        isSourceFallback: true,
    })]]),
    requestedLanguageKey: 'en',
});
assert.equal(fallbackProjection.languageKey, 'en');
assert.equal(fallbackProjection.pages[0].languageKey, 'ja');
assert.equal(fallbackProjection.pages[0].requestedLanguageKey, 'en');
assert.equal(fallbackProjection.pages[0].isSourceFallback, true);
assert.equal(fallbackProjection.flowGroups[0].requestedLanguageKey, 'en');
assert.equal(fallbackProjection.flowGroups[0].languageKey, 'ja');
assert.equal(fallbackProjection.flowGroups[0].isSourceFallback, true);

const runtimeGroup = (texts, profiles) => ({
    id: 'flow_runtime',
    kind: 'flow',
    flow: {
        document: {
            id: 'doc_runtime',
            schemaVersion: 1,
            layoutType: 'flow',
            sourceLanguage: 'ja',
            sections: [{
                id: 'section_runtime',
                title: { ja: '章' },
                blocks: [
                    { id: 'heading_runtime', type: 'heading', level: 1, texts: texts.heading },
                    { id: 'paragraph_runtime', type: 'paragraph', texts: texts.paragraph },
                ],
            }],
        },
        layout: { typographyByLanguage: profiles },
    },
});

const completeTranslation = runtimeGroup(
    { heading: { ja: '章', en: 'Chapter' }, paragraph: { ja: '本文', en: 'Body' } },
    { ja: { writingMode: 'vertical-rl' }, en: { writingMode: 'horizontal-tb' } },
);
assert.deepEqual(
    resolveFlowRuntimeLanguage(completeTranslation, 'en'),
    {
        requestedLanguageKey: 'en',
        languageKey: 'en',
        profile: completeTranslation.flow.layout.typographyByLanguage.en,
        isSourceFallback: false,
    },
);

const missingTranslation = runtimeGroup(
    { heading: { ja: '章' }, paragraph: { ja: '本文' } },
    { ja: { writingMode: 'vertical-rl' }, en: { writingMode: 'horizontal-tb' } },
);
assert.equal(resolveFlowRuntimeLanguage(missingTranslation, 'en').languageKey, 'ja');
assert.equal(resolveFlowRuntimeLanguage(missingTranslation, 'en').isSourceFallback, true);

const partialTranslation = runtimeGroup(
    { heading: { ja: '章', en: 'Chapter' }, paragraph: { ja: '本文' } },
    { ja: { writingMode: 'vertical-rl' }, en: { writingMode: 'horizontal-tb' } },
);
assert.equal(resolveFlowRuntimeLanguage(partialTranslation, 'en').languageKey, 'ja');

const missingTranslatedTypography = runtimeGroup(
    { heading: { ja: '章', en: 'Chapter' }, paragraph: { ja: '本文', en: 'Body' } },
    { ja: { writingMode: 'vertical-rl' } },
);
assert.throws(
    () => resolveFlowRuntimeLanguage(missingTranslatedTypography, 'en'),
    (error) => error instanceof FlowRuntimePageError && error.code === 'FLOW_LANGUAGE_TYPOGRAPHY_MISSING',
);

const emptyFlow = runtimeGroup(
    { heading: { ja: '章' }, paragraph: { ja: '本文' } },
    { ja: { writingMode: 'vertical-rl' } },
);
emptyFlow.flow.document.sections[0].blocks = [
    { id: 'break_runtime', type: 'pageBreak' },
];
assert.equal(resolveFlowRuntimeLanguage(emptyFlow, 'en').languageKey, 'ja');
assert.equal(resolveFlowRuntimeLanguage(emptyFlow, 'en').isSourceFallback, true);

const signatureBefore = createFlowRuntimeProjectionSignature({
    blocks: [{ id: 'fixed_signature', kind: 'page', content: { text: 'OLD' } }, completeTranslation],
}, 'ja');
const signatureAfter = createFlowRuntimeProjectionSignature({
    blocks: [{ id: 'fixed_signature', kind: 'page', content: { text: 'NEW' } }, completeTranslation],
}, 'ja');
assert.notEqual(signatureBefore, signatureAfter, 'Fixed edits must invalidate only the combined projection');

assert.notEqual(
    createFlowRuntimeProjectionSignature({
        blocks: [completeTranslation],
        languageConfigs: { ja: { fontPreset: 'gothic' } },
    }, 'ja'),
    createFlowRuntimeProjectionSignature({
        blocks: [completeTranslation],
        languageConfigs: { ja: { fontPreset: 'mincho' } },
    }, 'ja'),
    'Inherited text-page font changes must invalidate Flow projection caches',
);

assert.notEqual(
    createFlowRuntimeProjectionSignature({
        blocks: [missingTranslation],
        languageConfigs: { ja: { fontPreset: 'gothic' } },
    }, 'en'),
    createFlowRuntimeProjectionSignature({
        blocks: [missingTranslation],
        languageConfigs: { ja: { fontPreset: 'mincho' } },
    }, 'en'),
    'A source-language font change must also invalidate a translation fallback preview',
);

const fixedCompatibilityBefore = createFlowRuntimeProjectionSignature(
    { blocks: [{ id: 'fixed_signature', kind: 'page' }, completeTranslation] },
    'ja',
    [{ id: 'fixed_signature', texts: { ja: 'OLD' } }],
);
const fixedCompatibilityAfter = createFlowRuntimeProjectionSignature(
    { blocks: [{ id: 'fixed_signature', kind: 'page' }, completeTranslation] },
    'ja',
    [{ id: 'fixed_signature', texts: { ja: 'NEW' } }],
);
assert.notEqual(
    fixedCompatibilityBefore,
    fixedCompatibilityAfter,
    'Fixed compatibility pages must participate in the combined projection cache key',
);

const documentContextA = {};
const documentContextB = {};
assert.notEqual(
    createFlowRuntimeProjectionSignature({ blocks: [completeTranslation] }, 'ja', [], documentContextA),
    createFlowRuntimeProjectionSignature({ blocks: [completeTranslation] }, 'ja', [], documentContextB),
    'DOM measurement contexts must not share a projection cache key',
);
assert.notEqual(
    createFlowRuntimeProjectionSignature({ blocks: [completeTranslation] }, 'ja', [], documentContextA, 'editor'),
    createFlowRuntimeProjectionSignature({ blocks: [completeTranslation] }, 'ja', [], documentContextA, 'press'),
    'Editor and Press must not share projection/session cache identities',
);

console.log('Flow page projection checks passed.');
