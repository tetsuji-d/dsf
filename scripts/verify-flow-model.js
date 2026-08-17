import assert from 'node:assert/strict';
import {
    FLOW_DOCUMENT_SCHEMA_VERSION,
    FlowDocumentValidationError,
    createFlowDocument,
    createFlowHeading,
    createFlowPageBreak,
    createFlowParagraph,
    createFlowSection,
    normalizeFlowDocument,
    validateFlowDocument,
} from '../js/flow-document.js';
import {
    FlowPaginationError,
    createCanonicalFlowPageBox,
    paginateFlowDocument,
} from '../js/flow-pagination.js';
import { countGraphemes, segmentGraphemes } from '../js/grapheme.js';
import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from '../js/page-geometry.js';

let generatedId = 0;
const idFactory = (prefix) => `${prefix}_${++generatedId}`;

const normalized = normalizeFlowDocument({}, { idFactory });
assert.equal(normalized.schemaVersion, FLOW_DOCUMENT_SCHEMA_VERSION);
assert.equal(normalized.layoutType, 'flow');
assert.equal(normalized.sourceLanguage, 'ja');
assert.equal(normalized.sections.length, 1);
assert.equal(normalized.sections[0].blocks.length, 1);
assert.equal(normalized.sections[0].blocks[0].type, 'paragraph');
assert.equal(validateFlowDocument(normalized).valid, true);

const preservedId = normalizeFlowDocument({
    layoutType: 'flow',
    id: ' flow-document-id ',
    sourceLanguage: 'ja',
    sections: [{ id: 'section-id', title: {}, blocks: [] }],
}, { idFactory });
assert.equal(preservedId.id, ' flow-document-id ');
assert.equal(validateFlowDocument(preservedId).issues.some((issue) => issue.code === 'invalid_id'), true);

const preserved = normalizeFlowDocument({
    schemaVersion: 1,
    layoutType: 'flow',
    id: 'doc-preserved',
    sourceLanguage: 'en-us',
    extensionData: { future: true },
    sections: [{
        id: 'section-preserved',
        title: { 'en-us': ' Outline ' },
        blocks: [{
            id: 'future-block',
            type: 'futureWidget',
            payload: { untouched: true },
        }],
    }],
}, { idFactory });
assert.deepEqual(preserved.extensionData, { future: true });
assert.deepEqual(preserved.sections[0].blocks[0].payload, { untouched: true });
assert.equal(validateFlowDocument(preserved).issues.some((issue) => issue.code === 'unsupported_block_type'), true);

const invalidShapes = normalizeFlowDocument({
    layoutType: 'flow',
    id: 'invalid-shapes',
    sourceLanguage: 'ja',
    sections: [{
        id: 'invalid-section',
        title: { ja: { futureRichText: true } },
        blocks: { paragraph: { text: 'KEEP ME' } },
    }],
}, { idFactory });
assert.deepEqual(invalidShapes.sections[0].blocks, { paragraph: { text: 'KEEP ME' } });
assert.deepEqual(invalidShapes.sections[0].title.ja, { futureRichText: true });
assert.equal(validateFlowDocument(invalidShapes).valid, false);

const invalidNestedValues = normalizeFlowDocument({
    schemaVersion: null,
    layoutType: null,
    id: 'invalid-nested',
    sourceLanguage: null,
    sections: [null, {
        id: 'invalid-nested-section',
        title: null,
        blocks: [null, { id: 'invalid-null-texts', type: 'paragraph', texts: null }],
    }],
});
assert.equal(invalidNestedValues.sections[0], null);
assert.equal(invalidNestedValues.sections[1].blocks[0], null);
assert.equal(invalidNestedValues.sections[1].blocks[1].texts, null);
assert.equal(validateFlowDocument(invalidNestedValues).valid, false);
assert.throws(() => normalizeFlowDocument('not-a-document'), TypeError);

const preservedSchemaVersion = normalizeFlowDocument({
    schemaVersion: 0,
    layoutType: 'flow',
    id: 'old-schema-version',
    sourceLanguage: 'ja',
    sections: [],
});
assert.equal(preservedSchemaVersion.schemaVersion, 0);
assert.deepEqual(preservedSchemaVersion.sections, []);
assert.equal(validateFlowDocument(preservedSchemaVersion).valid, false);

const preservedEmptySections = normalizeFlowDocument({
    schemaVersion: 1,
    layoutType: 'flow',
    id: 'empty-sections',
    sourceLanguage: 'ja',
    sections: [],
});
assert.deepEqual(preservedEmptySections.sections, []);
assert.equal(validateFlowDocument(preservedEmptySections).valid, true);

const protoTexts = JSON.parse('{"__proto__":"preserved"}');
const protoDocument = normalizeFlowDocument({
    layoutType: 'flow',
    id: 'proto-document',
    sourceLanguage: '__proto__',
    sections: [{
        id: 'proto-section',
        title: {},
        blocks: [{ id: 'proto-paragraph', type: 'paragraph', texts: protoTexts }],
    }],
});
assert.equal(Object.prototype.hasOwnProperty.call(protoDocument.sections[0].blocks[0].texts, '__proto__'), true);
assert.equal(protoDocument.sections[0].blocks[0].texts.__proto__, 'preserved');
assert.equal(validateFlowDocument(protoDocument).valid, true);

const duplicate = normalizeFlowDocument({
    layoutType: 'flow',
    id: 'duplicate-id',
    sourceLanguage: 'ja',
    sections: [{
        id: 'duplicate-id',
        title: {},
        blocks: [{ id: 'paragraph-id', type: 'paragraph', texts: { ja: '' } }],
    }],
});
assert.equal(validateFlowDocument(duplicate).issues.some((issue) => issue.code === 'duplicate_id'), true);
assert.equal(validateFlowDocument({ ...normalized, sourceLanguage: ' ja ' }).issues.some(
    (issue) => issue.code === 'invalid_source_language'
), true);

const whitespace = '  先頭\n末尾  ';
const factoryDocument = createFlowDocument({
    id: 'factory-doc',
    sourceLanguage: 'ja',
    sections: [createFlowSection({
        id: 'factory-section',
        title: { ja: ' 第1章 ' },
        blocks: [
            createFlowHeading({ id: 'factory-heading', level: 1, texts: { ja: ' 見出し ' } }),
            createFlowParagraph({ id: 'factory-paragraph', texts: { ja: whitespace } }),
            createFlowPageBreak({ id: 'factory-break' }),
        ],
    })],
});
assert.equal(factoryDocument.sections[0].title.ja, ' 第1章 ');
assert.equal(factoryDocument.sections[0].blocks[1].texts.ja, whitespace);
assert.deepEqual(JSON.parse(JSON.stringify(factoryDocument)), factoryDocument);
assert.equal(validateFlowDocument(factoryDocument).valid, true);

const pageBox = createCanonicalFlowPageBox();
assert.equal(pageBox.width, CANONICAL_PAGE_WIDTH);
assert.equal(pageBox.height, CANONICAL_PAGE_HEIGHT);
assert.deepEqual(pageBox.contentBox, { x: 20, y: 20, width: 320, height: 600 });

function createCapacityMeasurer(capacity) {
    return ({ fragments }) => ({
        fits: fragments.reduce((used, fragment) => (
            used + Math.max(1, countGraphemes(fragment.text, fragment.languageKey))
        ), 0) <= capacity,
    });
}

function createDocument(sections, sourceLanguage = 'ja') {
    return {
        schemaVersion: 1,
        layoutType: 'flow',
        id: 'test-document',
        sourceLanguage,
        sections,
    };
}

const onePageDocument = createDocument([{
    id: 'section-one',
    title: { ja: '章' },
    blocks: [
        { id: 'heading-one', type: 'heading', level: 1, texts: { ja: '第1章' } },
        { id: 'paragraph-one', type: 'paragraph', texts: { ja: '冬' } },
    ],
}]);
const onePage = paginateFlowDocument(onePageDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(10),
});
assert.equal(onePage.pages.length, 1);
assert.deepEqual(onePage.pages[0].fragments.map((fragment) => fragment.blockType), ['heading', 'paragraph']);
assert.deepEqual(onePage.pages[0].fragments[0].sourceRange, {
    start: 0,
    end: 3,
    startGrapheme: 0,
    endGrapheme: 3,
});

const complexText = 'Aか\u3099👨‍👩‍👧‍👦葛\u{E0100}🇯🇵B';
const hugeDocument = createDocument([{
    id: 'section-huge',
    title: {},
    blocks: [{ id: 'paragraph-huge', type: 'paragraph', texts: { ja: complexText } }],
}]);
const huge = paginateFlowDocument(hugeDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(2),
});
assert.equal(huge.pages.length, 3);
const hugeFragments = huge.pages.flatMap((page) => page.fragments);
assert.equal(hugeFragments.map((fragment) => fragment.text).join(''), complexText);
assert.deepEqual(hugeFragments.map((fragment) => [
    fragment.sourceRange.startGrapheme,
    fragment.sourceRange.endGrapheme,
]), [[0, 2], [2, 4], [4, 6]]);
const legalOffsets = new Set(segmentGraphemes(complexText, 'ja').flatMap((segment) => [segment.index, segment.end]));
for (const fragment of hugeFragments) {
    assert.equal(legalOffsets.has(fragment.sourceRange.start), true);
    assert.equal(legalOffsets.has(fragment.sourceRange.end), true);
    assert.equal(fragment.text, complexText.slice(fragment.sourceRange.start, fragment.sourceRange.end));
}

const exactWhitespace = 'A\n  B  ';
const whitespaceDocument = createDocument([{
    id: 'section-whitespace',
    title: {},
    blocks: [{ id: 'paragraph-whitespace', type: 'paragraph', texts: { ja: exactWhitespace } }],
}]);
const whitespacePages = paginateFlowDocument(whitespaceDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(3),
});
assert.equal(whitespacePages.pages.flatMap((page) => page.fragments).map((fragment) => fragment.text).join(''), exactWhitespace);

const pageBreakDocument = createDocument([{
    id: 'section-breaks',
    title: {},
    blocks: [
        { id: 'break-start', type: 'pageBreak' },
        { id: 'paragraph-a', type: 'paragraph', texts: { ja: 'A' } },
        { id: 'break-after-a', type: 'pageBreak' },
        { id: 'break-consecutive', type: 'pageBreak' },
        { id: 'paragraph-b', type: 'paragraph', texts: { ja: 'B' } },
        { id: 'break-end', type: 'pageBreak' },
    ],
}]);
const breakPages = paginateFlowDocument(pageBreakDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(20),
});
assert.deepEqual(breakPages.pages.map((page) => page.fragments.map((fragment) => fragment.text).join('')), ['', 'A', '', 'B', '']);
assert.deepEqual(breakPages.pages.map((page) => page.manualBreakBefore?.blockId || null), [
    null,
    'break-start',
    'break-after-a',
    'break-consecutive',
    'break-end',
]);

const sectionsDocument = createDocument([
    {
        id: 'section-a',
        title: {},
        blocks: [{ id: 'section-a-paragraph', type: 'paragraph', texts: { ja: 'A' } }],
    },
    {
        id: 'section-b',
        title: {},
        blocks: [{ id: 'section-b-paragraph', type: 'paragraph', texts: { ja: 'B' } }],
    },
]);
const sectionPages = paginateFlowDocument(sectionsDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(10),
});
assert.equal(sectionPages.pages.length, 1);
assert.deepEqual(sectionPages.pages[0].fragments.map((fragment) => fragment.sectionId), ['section-a', 'section-b']);

const remainderDocument = createDocument([{
    id: 'section-remainder',
    title: {},
    blocks: [
        { id: 'paragraph-four', type: 'paragraph', texts: { ja: 'AAAA' } },
        { id: 'paragraph-six', type: 'paragraph', texts: { ja: 'BBBBBB' } },
    ],
}]);
const remainderPages = paginateFlowDocument(remainderDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(5),
    maxPages: 2,
});
assert.equal(remainderPages.pages.length, 2);
assert.deepEqual(remainderPages.pages.map((page) => page.fragments.map((fragment) => fragment.text)), [
    ['AAAA', 'B'],
    ['BBBBB'],
]);

const translatedDocument = createDocument([{
    id: 'section-translated',
    title: { ja: '章', 'en-us': 'Chapter' },
    blocks: [{
        id: 'paragraph-translated',
        type: 'paragraph',
        texts: { ja: '日本語', 'en-us': 'English text' },
    }],
}], 'ja');
const translatedPages = paginateFlowDocument(translatedDocument, {
    pageBox,
    languageKey: 'en-us',
    measurePage: createCapacityMeasurer(20),
});
assert.equal(translatedPages.languageKey, 'en-us');
assert.equal(translatedPages.pages[0].fragments[0].text, 'English text');

const literalMarkerDocument = createDocument([{
    id: 'section-marker',
    title: {},
    blocks: [{ id: 'paragraph-marker', type: 'paragraph', texts: { ja: 'A\n===\nB' } }],
}]);
const literalMarkerPages = paginateFlowDocument(literalMarkerDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(20),
});
assert.equal(literalMarkerPages.pages.length, 1);
assert.equal(literalMarkerPages.pages[0].fragments[0].text, 'A\n===\nB');

const emptyDocument = createDocument([]);
const emptyPages = paginateFlowDocument(emptyDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(1),
});
assert.equal(emptyPages.pages.length, 1);
assert.equal(emptyPages.pages[0].fragments.length, 0);

const emptyParagraphDocument = createDocument([{
    id: 'section-empty',
    title: {},
    blocks: [{ id: 'paragraph-empty', type: 'paragraph', texts: { ja: '' } }],
}]);
const emptyParagraphPages = paginateFlowDocument(emptyParagraphDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(1),
});
assert.equal(emptyParagraphPages.pages[0].fragments.length, 1);
assert.deepEqual(emptyParagraphPages.pages[0].fragments[0].sourceRange, {
    start: 0,
    end: 0,
    startGrapheme: 0,
    endGrapheme: 0,
});

const beforeMutationCheck = JSON.stringify(hugeDocument);
const repeatedA = paginateFlowDocument(hugeDocument, { pageBox, measurePage: createCapacityMeasurer(2) });
const repeatedB = paginateFlowDocument(hugeDocument, { pageBox, measurePage: createCapacityMeasurer(2) });
assert.deepEqual(repeatedA, repeatedB);
assert.equal(JSON.stringify(hugeDocument), beforeMutationCheck);

const shortDocument = createDocument([{
    id: 'section-reflow',
    title: {},
    blocks: [{ id: 'paragraph-reflow', type: 'paragraph', texts: { ja: '12345678' } }],
}]);
const addedDocument = structuredClone(shortDocument);
addedDocument.sections[0].blocks[0].texts.ja = `XX${addedDocument.sections[0].blocks[0].texts.ja}`;
const deletedDocument = structuredClone(shortDocument);
deletedDocument.sections[0].blocks[0].texts.ja = '1234';
assert.equal(paginateFlowDocument(shortDocument, { pageBox, measurePage: createCapacityMeasurer(4) }).pages.length, 2);
assert.equal(paginateFlowDocument(addedDocument, { pageBox, measurePage: createCapacityMeasurer(4) }).pages.length, 3);
assert.equal(paginateFlowDocument(deletedDocument, { pageBox, measurePage: createCapacityMeasurer(4) }).pages.length, 1);

const manyPagesDocument = createDocument([{
    id: 'section-many',
    title: {},
    blocks: [{ id: 'paragraph-many', type: 'paragraph', texts: { ja: '頁'.repeat(520) } }],
}]);
assert.equal(paginateFlowDocument(manyPagesDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(1),
}).pages.length, 520);
assert.throws(() => paginateFlowDocument(manyPagesDocument, {
    pageBox,
    measurePage: createCapacityMeasurer(1),
    maxPages: 500,
}), (error) => error instanceof FlowPaginationError && error.code === 'MAX_PAGES_EXCEEDED');

assert.throws(() => paginateFlowDocument(onePageDocument, {
    pageBox,
    measurePage: () => ({ fits: false }),
}), (error) => error instanceof FlowPaginationError && error.code === 'FRAGMENT_DOES_NOT_FIT');

assert.throws(() => paginateFlowDocument(onePageDocument, {
    pageBox,
    measurePage: () => true,
}), (error) => error instanceof FlowPaginationError && error.code === 'INVALID_MEASUREMENT_RESULT');

assert.throws(() => paginateFlowDocument({ ...onePageDocument, layoutType: 'fixed' }, {
    pageBox,
    measurePage: createCapacityMeasurer(10),
}), (error) => error instanceof FlowDocumentValidationError);

console.log('Flow document and pagination verification passed.');
