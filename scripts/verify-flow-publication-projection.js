import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateDsfLanguageManifest } from '../js/dsf-delivery-v2.js';
import {
    DSF_FONT_REGISTRY_KIND,
    DSF_FONT_REGISTRY_SCHEMA_VERSION,
} from '../js/dsf-font-registry.js';
import {
    FLOW_DOM_RENDERER_VERSION,
} from '../js/flow-dom-measurer.js';
import {
    FLOW_PUBLICATION_PROJECTION_VERSION,
    FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION,
    projectFlowPaginationToDsfV2,
    resolveFlowPublicationTypography,
} from '../js/flow-publication-projection.js';
import {
    createCanonicalFlowPageBox,
    paginateFlowDocument,
} from '../js/flow-pagination.js';
import { segmentGraphemes } from '../js/grapheme.js';

const clone = (value) => structuredClone(value);
const FONT_ID = 'dsf-flow-ja-sans-v1';
const FONT_HASH = 'a'.repeat(64);

function createFontRegistry(overrides = {}) {
    const entry = {
        declaration: {
            family: 'Noto Sans JP',
            version: '1.0.0',
            source: 'registry',
            href: 'https://assets.dsf.ink/fonts/dsf-flow-ja-sans-v1.woff2',
            sha256: FONT_HASH,
        },
        asset: {
            format: 'woff2',
            mimeType: 'font/woff2',
            byteLength: 123456,
            immutable: true,
        },
        license: {
            spdxId: 'OFL-1.1',
            licenseHref: 'https://openfontlicense.org/open-font-license-official-text/',
            rightsHolder: 'Fixture Foundry',
            reviewedAt: '2026-08-23',
            reviewedBy: 'DSF Architect',
            allowsWebDistribution: true,
            allowsPortableEmbedding: true,
        },
        capabilities: {
            languages: ['ja'],
            writingModes: ['horizontal-tb', 'vertical-rl'],
            fontWeights: [400, 700],
            fontStyles: ['normal'],
        },
        ...overrides,
    };
    return {
        schemaVersion: DSF_FONT_REGISTRY_SCHEMA_VERSION,
        registryKind: DSF_FONT_REGISTRY_KIND,
        fonts: { [FONT_ID]: entry },
    };
}

function createFlowGroup({
    id = 'flow_story',
    documentId = 'flow_document_story',
    writingMode = 'horizontal-tb',
    blocks,
} = {}) {
    return {
        id,
        kind: 'flow',
        flow: {
            document: {
                schemaVersion: 1,
                layoutType: 'flow',
                id: documentId,
                sourceLanguage: 'ja',
                sections: [{
                    id: 'section_story',
                    title: { ja: '第一章' },
                    blocks: blocks || [
                        { id: 'heading_story', type: 'heading', level: 1, texts: { ja: '第一章' } },
                        {
                            id: 'paragraph_story',
                            type: 'paragraph',
                            texts: { ja: '<script>ではない長い本文です。冬の金沢は静かだった。' },
                        },
                        { id: 'break_story', type: 'pageBreak' },
                        { id: 'paragraph_after', type: 'paragraph', texts: { ja: '彼はコートを手に取った。' } },
                    ],
                }],
            },
            layout: {
                padding: { top: 20, right: 20, bottom: 20, left: 20 },
                typographyByLanguage: {
                    ja: {
                        writingMode,
                        fontFamily: "'Noto Sans JP',sans-serif",
                        fontSize: 16,
                        fontWeight: '400',
                        lineHeight: 1.8,
                        letterSpacing: 0,
                        textAlign: 'start',
                        paragraphSpacing: 12,
                        headingSpacing: 18,
                        textColor: '#1f1b16',
                        paperColor: '#f7f1df',
                    },
                },
            },
        },
    };
}

function paginateGroup(group, capacity = 10) {
    const profile = group.flow.layout.typographyByLanguage.ja;
    const pageBox = createCanonicalFlowPageBox({ padding: group.flow.layout.padding });
    return paginateFlowDocument(group.flow.document, {
        languageKey: 'ja',
        writingMode: profile.writingMode,
        pageBox,
        measurePage({ fragments }) {
            const graphemeCount = fragments.reduce((sum, fragment) => (
                sum + Math.max(1, fragment.sourceRange.endGrapheme - fragment.sourceRange.startGrapheme)
            ), 0);
            return { fits: graphemeCount <= capacity };
        },
    });
}

function getBlock(group, blockId) {
    for (const section of group.flow.document.sections) {
        const block = section.blocks.find((candidate) => candidate.id === blockId);
        if (block) return block;
    }
    return null;
}

function runForRange(group, blockId, startGrapheme, endGrapheme) {
    const block = getBlock(group, blockId);
    const text = block.texts.ja;
    const segments = segmentGraphemes(text, 'ja');
    const start = startGrapheme < segments.length ? segments[startGrapheme].index : text.length;
    const end = endGrapheme > startGrapheme ? segments[endGrapheme - 1].end : start;
    return {
        text: text.slice(start, end),
        source: { blockId, startGrapheme, endGrapheme },
    };
}

function createCompositionSnapshot(group, pagination, revision = 7, options = {}) {
    const profile = group.flow.layout.typographyByLanguage.ja;
    const writingMode = profile.writingMode;
    const typography = resolveFlowPublicationTypography(
        'ja', profile, writingMode, options.certifiedFontFamily || 'Noto Sans JP', options,
    );
    return {
        schemaVersion: FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION,
        status: 'complete',
        revision,
        rendererVersion: FLOW_DOM_RENDERER_VERSION,
        flowGroupId: group.id,
        documentId: group.flow.document.id,
        languageKey: 'ja',
        writingMode,
        pageBox: createCanonicalFlowPageBox({ padding: group.flow.layout.padding }),
        typography,
        evidence: {
            fontId: FONT_ID,
            fontSha256: FONT_HASH,
            hyphenation: 'none',
        },
        pages: pagination.pages.map((page) => ({
            index: page.index,
            manualBreakBefore: page.manualBreakBefore,
            lines: page.fragments.map((fragment, lineIndex) => {
                const start = fragment.sourceRange.startGrapheme;
                const end = fragment.sourceRange.endGrapheme;
                const split = start + Math.floor((end - start) / 2);
                const ranges = end - start > 1
                    ? [[start, split], [split, end]]
                    : [[start, end]];
                return {
                    x: writingMode === 'vertical-rl' ? 316 - (lineIndex * 26) : 20,
                    y: writingMode === 'vertical-rl' ? 20 : 20 + (lineIndex * 32),
                    width: writingMode === 'vertical-rl' ? 24 : 320,
                    height: writingMode === 'vertical-rl' ? 600 : 30,
                    writingMode,
                    textOrientation: 'mixed',
                    runs: ranges.map(([rangeStart, rangeEnd]) => (
                        runForRange(group, fragment.blockId, rangeStart, rangeEnd)
                    )),
                };
            }),
        })),
    };
}

function createInput(group, pagination, snapshot, overrides = {}) {
    return {
        flowGroup: group,
        language: 'ja',
        revision: 7,
        pagination,
        compositionSnapshot: snapshot,
        fontRegistry: createFontRegistry(),
        fontId: FONT_ID,
        pageIds: pagination.pages.map((_, index) => `${group.id}-ja-${String(index + 1).padStart(4, '0')}`),
        pageLabels: pagination.pages.map((_, index) => String(index + 1)),
        ...overrides,
    };
}

function expectBlocked(input, code, label) {
    const result = projectFlowPaginationToDsfV2(input);
    assert.equal(result.ok, false, `${label} must be blocked`);
    assert.equal(result.renderKind, null, `${label} must not silently choose WebP`);
    assert.equal(result.publicationBlocked.code, code, label);
    assert.equal(Object.isFrozen(result), true, `${label} result must be immutable`);
}

const horizontalGroup = createFlowGroup();
const horizontalPagination = paginateGroup(horizontalGroup, 10);
const horizontalSnapshot = createCompositionSnapshot(horizontalGroup, horizontalPagination);
const horizontalInput = createInput(horizontalGroup, horizontalPagination, horizontalSnapshot);
const horizontalBefore = clone(horizontalInput);
const horizontal = projectFlowPaginationToDsfV2(horizontalInput);

assert.equal(horizontal.ok, true);
assert.equal(horizontal.projectionVersion, FLOW_PUBLICATION_PROJECTION_VERSION);
assert.equal(horizontal.renderKind, 'fixedText');
assert.equal(horizontal.flowGroupId, horizontalGroup.id);
assert.equal(horizontal.documentId, horizontalGroup.flow.document.id);
assert.equal(horizontal.language, 'ja');
assert.equal(horizontal.revision, 7);
assert.equal(horizontal.writingMode, 'horizontal-tb');
assert.equal(horizontal.font.id, FONT_ID);
assert.deepEqual(horizontalInput, horizontalBefore, 'projection must not mutate source, pagination, or snapshot');
assert.equal(Object.isFrozen(horizontal), true);
assert.equal(Object.isFrozen(horizontal.manifest.pages), true);
assert.equal(horizontal.manifest.pages.length, horizontalPagination.pages.length);
assert.equal(horizontal.summary.pageCount, horizontalPagination.pages.length);
assert.equal(horizontal.summary.lineCount, horizontalPagination.pages.reduce((sum, page) => sum + page.fragments.length, 0));
assert.equal(horizontal.manifest.styles.body.fontWeight, 400);
assert.equal(horizontal.manifest.styles['heading-1'].fontWeight, 700);
assert.equal(horizontal.manifest.styles['heading-1'].fontSize, 24);
assert.equal(horizontal.manifest.pages[0].lines[0].styleRef, 'heading-1');
const projectedParagraphText = horizontal.manifest.pages
    .flatMap((page) => page.lines)
    .flatMap((line) => line.runs)
    .filter((run) => run.source.blockId === 'paragraph_story')
    .map((run) => run.text)
    .join('');
assert.equal(
    projectedParagraphText,
    getBlock(horizontalGroup, 'paragraph_story').texts.ja,
    'markup-like source must remain complete literal text across pages and runs',
);
assert.equal(horizontal.manifest.pages.every((page) => page.renderKind === 'fixedText'), true);
assert.equal(validateDsfLanguageManifest(horizontal.manifest, {
    expectedLanguage: 'ja',
    expectedPageCount: horizontalPagination.pages.length,
    fontIds: new Set([FONT_ID]),
}).valid, true);

const paragraphPages = horizontal.manifest.pages.filter((page) => (
    page.sourceAnchor.firstBlockId === 'paragraph_story'
));
const paragraphRuns = horizontal.manifest.pages
    .flatMap((page) => page.lines)
    .flatMap((line) => line.runs)
    .filter((run) => run.source.blockId === 'paragraph_story');
assert.equal(paragraphRuns.length >= 3, true, 'large paragraph must span at least three fixed pages');
assert.equal(paragraphRuns[0].source.startGrapheme, 0, 'paragraph source must start without loss');
assert.equal(paragraphPages.some((page) => page.sourceAnchor.blockProgress > 0), true);
assert.equal(horizontal.manifest.pages.some((page) => page.sourceAnchor.firstBlockId === 'break_story'), false,
    'non-empty pages should anchor their first text fragment');

const verticalGroup = createFlowGroup({
    id: 'flow_vertical',
    documentId: 'flow_document_vertical',
    writingMode: 'vertical-rl',
    blocks: [
        { id: 'vertical_heading', type: 'heading', level: 2, texts: { ja: '雪の音' } },
        { id: 'vertical_body', type: 'paragraph', texts: { ja: '窓の向こうで、雪は静かに降り続いていた。' } },
    ],
});
const verticalPagination = paginateGroup(verticalGroup, 12);
const verticalSnapshot = createCompositionSnapshot(verticalGroup, verticalPagination);
const vertical = projectFlowPaginationToDsfV2(createInput(verticalGroup, verticalPagination, verticalSnapshot));
assert.equal(vertical.ok, true);
assert.equal(vertical.writingMode, 'vertical-rl');
assert.equal(vertical.manifest.pages.every((page) => page.lines.every((line) => (
    line.writingMode === 'vertical-rl' && line.textOrientation === 'mixed'
))), true);
assert.equal(vertical.manifest.styles['heading-2'].fontSize, 21.6);
assert.equal(vertical.manifest.pages.flatMap((page) => page.lines)
    .flatMap((line) => line.runs).some((run) => run.text.includes('。')), true,
'vertical source punctuation must remain semantic text for CSS vertical shaping');

const inheritedFontGroup = createFlowGroup({ id: 'flow_inherited_font', writingMode: 'vertical-rl' });
delete inheritedFontGroup.flow.layout.typographyByLanguage.ja.fontFamily;
const inheritedFontBefore = clone(inheritedFontGroup);
const inheritedPagination = paginateGroup(inheritedFontGroup, 12);
const gothicConfigs = { ja: { fontPreset: 'gothic' } };
const minchoConfigs = { ja: { fontPreset: 'mincho' } };
const gothicSnapshot = createCompositionSnapshot(inheritedFontGroup, inheritedPagination, 7, {
    languageConfigs: gothicConfigs,
});
const minchoSnapshot = createCompositionSnapshot(inheritedFontGroup, inheritedPagination, 7, {
    languageConfigs: minchoConfigs,
    certifiedFontFamily: 'Noto Serif JP',
});
const serifRegistry = createFontRegistry();
serifRegistry.fonts[FONT_ID].declaration.family = 'Noto Serif JP';
assert.equal(gothicSnapshot.typography.fontFamily, '"Noto Sans JP"');
assert.equal(minchoSnapshot.typography.fontFamily, '"Noto Serif JP"');
assert.equal(projectFlowPaginationToDsfV2(createInput(
    inheritedFontGroup, inheritedPagination, gothicSnapshot, { languageConfigs: gothicConfigs },
)).ok, true, 'unconfigured Flow font must inherit the project gothic preset');
const minchoInput = createInput(inheritedFontGroup, inheritedPagination, minchoSnapshot, {
    languageConfigs: minchoConfigs,
    fontRegistry: serifRegistry,
});
const minchoInputBefore = clone(minchoInput);
const minchoProjection = projectFlowPaginationToDsfV2(minchoInput);
assert.equal(minchoProjection.ok, true, 'project mincho preset must survive strict publication projection');
assert.equal(minchoProjection.font.declaration.family, 'Noto Serif JP');
assert.deepEqual(minchoInput, minchoInputBefore, 'inherited typography cannot rewrite source, settings or snapshot');
assert.deepEqual(inheritedFontGroup, inheritedFontBefore, 'resolved font is not persisted into the source profile');
expectBlocked(createInput(inheritedFontGroup, inheritedPagination, gothicSnapshot, {
    languageConfigs: minchoConfigs,
    fontRegistry: serifRegistry,
}), 'FLOW_PUBLICATION_SNAPSHOT_CONTEXT_MISMATCH', 'snapshot captured before a project font change');
expectBlocked(createInput(inheritedFontGroup, inheritedPagination, minchoSnapshot, {
    languageConfigs: minchoConfigs,
}), 'FLOW_PUBLICATION_FONT_FAMILY_MISMATCH', 'old registry font selected after a project font change');
assert.equal(projectFlowPaginationToDsfV2(createInput(
    verticalGroup, verticalPagination, verticalSnapshot, { languageConfigs: minchoConfigs },
)).ok, true, 'explicit Flow font must take precedence over the project font preset');

const breakOnlyGroup = createFlowGroup({
    id: 'flow_break_start',
    documentId: 'flow_document_break_start',
    blocks: [
        { id: 'break_first', type: 'pageBreak' },
        { id: 'after_break', type: 'paragraph', texts: { ja: '改ページ後' } },
    ],
});
const breakPagination = paginateGroup(breakOnlyGroup, 20);
const breakSnapshot = createCompositionSnapshot(breakOnlyGroup, breakPagination);
const breakProjection = projectFlowPaginationToDsfV2(createInput(breakOnlyGroup, breakPagination, breakSnapshot));
assert.equal(breakProjection.ok, true);
assert.equal(breakProjection.manifest.pages[0].lines.length, 0);
assert.equal(breakProjection.manifest.pages[0].sourceAnchor.firstBlockId, 'break_first');
assert.equal(breakProjection.manifest.pages[1].sourceAnchor.firstBlockId, 'after_break');

const stalePagination = clone(horizontalPagination);
stalePagination.pages[0].fragments[0].text = '改ざん';
expectBlocked(
    createInput(horizontalGroup, stalePagination, horizontalSnapshot),
    'FLOW_PUBLICATION_FRAGMENT_SOURCE_MISMATCH',
    'stale pagination text',
);

const missingFragment = clone(horizontalPagination);
missingFragment.pages.at(-1).fragments = [];
expectBlocked(
    createInput(horizontalGroup, missingFragment, horizontalSnapshot),
    'FLOW_PUBLICATION_SOURCE_INCOMPLETE',
    'partial pagination',
);

const staleRevisionSnapshot = clone(horizontalSnapshot);
staleRevisionSnapshot.revision = 6;
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, staleRevisionSnapshot),
    'FLOW_PUBLICATION_SNAPSHOT_CONTEXT_MISMATCH',
    'stale revision snapshot',
);

const runningSnapshot = clone(horizontalSnapshot);
runningSnapshot.status = 'measuring';
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, runningSnapshot),
    'FLOW_PUBLICATION_SNAPSHOT_CONTEXT_MISMATCH',
    'partial composition snapshot',
);

const wrongFontEvidence = clone(horizontalSnapshot);
wrongFontEvidence.evidence.fontSha256 = 'b'.repeat(64);
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, wrongFontEvidence),
    'FLOW_PUBLICATION_SNAPSHOT_EVIDENCE_INVALID',
    'wrong font evidence',
);

const automaticHyphenation = clone(horizontalSnapshot);
automaticHyphenation.evidence.hyphenation = 'auto';
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, automaticHyphenation),
    'FLOW_PUBLICATION_SNAPSHOT_EVIDENCE_INVALID',
    'automatic hyphenation snapshot',
);

const tamperedRun = clone(horizontalSnapshot);
tamperedRun.pages[0].lines[0].runs[0].text += 'X';
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, tamperedRun),
    'FLOW_PUBLICATION_RUN_SOURCE_MISMATCH',
    'tampered measured run',
);

const rangeGap = clone(horizontalSnapshot);
rangeGap.pages[0].lines[0].runs[0].source.startGrapheme += 1;
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, rangeGap),
    'FLOW_PUBLICATION_RUN_SOURCE_MISMATCH',
    'run source gap',
);

const crossedBlocks = clone(horizontalSnapshot);
const mixedPage = crossedBlocks.pages.find((page) => page.lines.length >= 2);
mixedPage.lines[0].runs.push(...mixedPage.lines[1].runs);
mixedPage.lines.splice(1, 1);
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, crossedBlocks),
    'FLOW_PUBLICATION_LINE_CROSSES_BLOCKS',
    'line crossing semantic blocks',
);

const incompleteSnapshot = clone(horizontalSnapshot);
incompleteSnapshot.pages.at(-1).lines.pop();
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, incompleteSnapshot),
    'FLOW_PUBLICATION_SNAPSHOT_SOURCE_INCOMPLETE',
    'partial measured snapshot',
);

const outOfBounds = clone(horizontalSnapshot);
outOfBounds.pages[0].lines[0].x = 350;
outOfBounds.pages[0].lines[0].width = 20;
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, outOfBounds),
    'FLOW_PUBLICATION_LINE_OUT_OF_BOUNDS',
    'out-of-bounds line',
);

const outsideContentBox = clone(horizontalSnapshot);
outsideContentBox.pages[0].lines[0].x = 10;
outsideContentBox.pages[0].lines[0].width = 320;
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, outsideContentBox),
    'FLOW_PUBLICATION_LINE_OUTSIDE_CONTENT_BOX',
    'line outside author content box',
);

const unsupportedInput = createInput(horizontalGroup, horizontalPagination, horizontalSnapshot);
unsupportedInput.html = '<script>';
expectBlocked(unsupportedInput, 'FLOW_PUBLICATION_PROPERTY_UNSUPPORTED', 'input property injection');

expectBlocked(
    createInput(horizontalGroup, horizontalPagination, horizontalSnapshot, {
        fontRegistry: {
            schemaVersion: DSF_FONT_REGISTRY_SCHEMA_VERSION,
            registryKind: DSF_FONT_REGISTRY_KIND,
            fonts: {},
        },
    }),
    'FONT_NOT_CERTIFIED',
    'uncertified font',
);

const bodyOnlyRegistry = createFontRegistry({
    capabilities: {
        languages: ['ja'],
        writingModes: ['horizontal-tb', 'vertical-rl'],
        fontWeights: [400],
        fontStyles: ['normal'],
    },
});
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, horizontalSnapshot, { fontRegistry: bodyOnlyRegistry }),
    'FONT_WEIGHT_UNSUPPORTED',
    'heading weight not certified',
);

const incompleteLanguageGroup = clone(horizontalGroup);
delete incompleteLanguageGroup.flow.document.sections[0].blocks[1].texts.ja;
expectBlocked(
    createInput(incompleteLanguageGroup, horizontalPagination, horizontalSnapshot),
    'FLOW_PUBLICATION_LANGUAGE_INCOMPLETE',
    'missing exact language text',
);

const duplicatePageIds = horizontalPagination.pages.map(() => 'duplicate');
expectBlocked(
    createInput(horizontalGroup, horizontalPagination, horizontalSnapshot, { pageIds: duplicatePageIds }),
    'FLOW_PUBLICATION_PAGE_ID_DUPLICATE',
    'duplicate delivery page IDs',
);

const emptyGroup = createFlowGroup({
    id: 'flow_empty',
    documentId: 'flow_document_empty',
    blocks: [],
});
const emptyPagination = paginateGroup(emptyGroup, 20);
const emptySnapshot = createCompositionSnapshot(emptyGroup, emptyPagination);
expectBlocked(
    createInput(emptyGroup, emptyPagination, emptySnapshot),
    'FLOW_PUBLICATION_EMPTY_PAGE_ANCHOR_MISSING',
    'unanchored empty document page',
);

const moduleSource = readFileSync(new URL('../js/flow-publication-projection.js', import.meta.url), 'utf8');
for (const forbiddenDependency of [
    './press',
    './viewer',
    './state',
    './firebase',
    './export',
    'jszip',
    'file-saver',
    'globalThis.document',
    'querySelector(',
    'createElement(',
    'window.',
    'fetch(',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `Flow publication projection cannot depend on ${forbiddenDependency}`);
}

console.log('Flow publication projection verification passed');
