import {validateFlowWrapPagination} from './flow-wrap-composition.js';
import {getFlowPublicationAnnotationGlyphs} from './flow-publication-annotations.js';
/**
 * Pure Flow publication projection for DSF delivery v2.
 *
 * Pagination owns source ranges; a separately captured, completed composition
 * snapshot owns measured line/column geometry. This module cross-checks both
 * against the semantic FlowDocument and never guesses line breaks or measures
 * DOM. It does not mutate state or connect to Press, ZIP, Viewer, or storage.
 */

import {
    DSF_DELIVERY_LAYOUT_MODEL,
    DSF_DELIVERY_SCHEMA_VERSION,
    DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    validateDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import {
    resolveDsfProductionFont,
} from './dsf-font-registry.js';
import {
    assertValidFlowDocument,
    getFlowBlockText,
    isFlowTextBlock,
} from './flow-document.js';
import {
    FLOW_DOM_RENDERER_VERSION,
    resolveFlowDomTypography,
} from './flow-dom-measurer.js';
import {
    createCanonicalFlowPageBox,
} from './flow-pagination.js';
import { segmentGraphemes } from './grapheme.js';
import { FIXED_TEXT_WHITE_SPACE_MODE } from './fixed-text-whitespace.js';
import {
    CANONICAL_PAGE_HEIGHT,
    CANONICAL_PAGE_WIDTH,
} from './page-geometry.js';
import { serializeDsfReleaseJson } from './dsf-release-assembly.js';

export const FLOW_PUBLICATION_PROJECTION_VERSION = 1;
export const FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION = 1;

const EMPTY_SHA256 = '0'.repeat(64);
const HEADING_SCALES = Object.freeze({
    1: 1.5,
    2: 1.35,
    3: 1.25,
    4: 1.16,
    5: 1.1,
    6: 1.05,
});
const INPUT_KEYS = new Set([
    'flowGroup',
    'language',
    'languageConfigs',
    'revision',
    'pagination',
    'compositionSnapshot',
    'fontRegistry',
    'fontId',
    'pageIds',
    'pageLabels',
]);
const SNAPSHOT_KEYS = new Set([
    'schemaVersion',
    'status',
    'revision',
    'rendererVersion',
    'flowGroupId',
    'documentId',
    'languageKey',
    'writingMode',
    'pageBox',
    'typography',
    'evidence',
    'pages',
]);
const SNAPSHOT_EVIDENCE_KEYS = new Set(['fontId', 'fontSha256', 'hyphenation']);
const SNAPSHOT_PAGE_KEYS = new Set(['index', 'manualBreakBefore', 'lines', 'annotations', 'wrapLayout']);
const SNAPSHOT_LINE_KEYS = new Set([
    'x',
    'y',
    'width',
    'height',
    'writingMode',
    'textOrientation',
    'runs',
]);
const SNAPSHOT_RUN_KEYS = new Set(['text', 'source']);
const RUN_SOURCE_KEYS = new Set(['blockId', 'startGrapheme', 'endGrapheme']);
const PAGINATION_KEYS = new Set(['documentId', 'languageKey', 'writingMode', 'pageBox', 'pages']);
const PAGINATION_PAGE_KEYS = new Set(['index', 'manualBreakBefore', 'fragments', 'anchoredObject', 'wrapRegions']);
const MANUAL_BREAK_KEYS = new Set(['sectionId', 'blockId']);
const FRAGMENT_KEYS = new Set([
    'titleRegion',
    'indent',
    'annotations',
    'sectionId',
    'blockId',
    'blockType',
    'languageKey',
    'text',
    'sourceRange',
    'isBlockStart',
    'isBlockEnd',
    'headingLevel',
]);
const SOURCE_RANGE_KEYS = new Set(['start', 'end', 'startGrapheme', 'endGrapheme']);

class FlowPublicationContractError extends Error {
    constructor(code, path, message, details = {}) {
        super(message);
        this.name = 'FlowPublicationContractError';
        this.code = code;
        this.path = path;
        this.details = details;
    }
}

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

function fail(code, path, message, details) {
    throw new FlowPublicationContractError(code, path, message, details);
}

function blocked(error, input) {
    const contractError = error instanceof FlowPublicationContractError
        ? error
        : new FlowPublicationContractError(
            'FLOW_PUBLICATION_PROJECTION_FAILED',
            '',
            error?.message || String(error),
        );
    return deepFreeze({
        ok: false,
        projectionVersion: FLOW_PUBLICATION_PROJECTION_VERSION,
        renderKind: null,
        publicationBlocked: {
            code: contractError.code,
            path: contractError.path,
            message: contractError.message,
            flowGroupId: typeof input?.flowGroup?.id === 'string' ? input.flowGroup.id : null,
            language: typeof input?.language === 'string' ? input.language : null,
            details: contractError.details || {},
        },
    });
}

function assertExactKeys(value, allowedKeys, path) {
    if (!isRecord(value)) fail('FLOW_PUBLICATION_OBJECT_INVALID', path, 'Value must be an object.');
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            fail('FLOW_PUBLICATION_PROPERTY_UNSUPPORTED', path ? `${path}.${key}` : key, 'Unsupported publication property.');
        }
    }
}

function exactString(value, path, maximumLength = 256) {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximumLength) {
        fail('FLOW_PUBLICATION_STRING_INVALID', path, 'Value must be a non-empty exact string.');
    }
    return value;
}

function finiteNumber(value, path, options = {}) {
    const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = options.maximum ?? Number.POSITIVE_INFINITY;
    if (typeof value !== 'number'
        || !Number.isFinite(value)
        || value < minimum
        || value > maximum
        || (options.integer && !Number.isInteger(value))) {
        fail('FLOW_PUBLICATION_NUMBER_INVALID', path, 'Value is outside the supported numeric range.');
    }
    return value;
}

function sameValue(left, right) {
    return serializeDsfReleaseJson(left) === serializeDsfReleaseJson(right);
}

function normalizeFontWeight(value, path) {
    if (value === 'normal') return 400;
    if (value === 'bold') return 700;
    const number = typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(number) || number < 100 || number > 900) {
        fail('FLOW_PUBLICATION_FONT_WEIGHT_INVALID', path, 'Flow fontWeight must resolve to 100-900.');
    }
    return number;
}

function primaryFontFamily(value) {
    return String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

function quoteFontFamily(value) {
    return `"${String(value || '').replace(/["\\]/g, '')}"`;
}

/** Resolve the exact single-family typography used for certified publication composition. */
export function resolveFlowPublicationTypography(
    language,
    profile,
    writingMode,
    certifiedFontFamily,
    options = {},
) {
    const typography = resolveFlowDomTypography(language, profile, writingMode, options);
    if (primaryFontFamily(typography.fontFamily) !== certifiedFontFamily) {
        throw new RangeError('Certified font family does not match Flow composition.');
    }
    return Object.freeze({
        ...typography,
        fontFamily: quoteFontFamily(certifiedFontFamily),
    });
}

function buildSourceModel(document, language) {
    const entries = [];
    const textEntries = [];
    const pageBreaks = [];
    const byBlockId = new Map();
    for (const section of document.sections) {
        for (const block of section.blocks) {
            const entry = {
                section,
                block,
                text: isFlowTextBlock(block) ? getFlowBlockText(block, language) : '',
            };
            entry.segments = isFlowTextBlock(block) ? segmentGraphemes(entry.text, language) : [];
            entries.push(entry);
            byBlockId.set(block.id, entry);
            if (isFlowTextBlock(block)) textEntries.push(entry);
            if (block.type === 'pageBreak') pageBreaks.push(entry);
        }
    }
    return { entries, textEntries, pageBreaks, byBlockId };
}

function utf16Range(entry, startGrapheme, endGrapheme) {
    const start = startGrapheme < entry.segments.length
        ? entry.segments[startGrapheme].index
        : entry.text.length;
    const end = endGrapheme > startGrapheme
        ? entry.segments[endGrapheme - 1].end
        : start;
    return { start, end, text: entry.text.slice(start, end) };
}

function validateManualBreak(value, path, source) {
    if (value == null) return null;
    assertExactKeys(value, MANUAL_BREAK_KEYS, path);
    const sectionId = exactString(value.sectionId, `${path}.sectionId`);
    const blockId = exactString(value.blockId, `${path}.blockId`);
    const entry = source.byBlockId.get(blockId);
    if (!entry || entry.block.type !== 'pageBreak' || entry.section.id !== sectionId) {
        fail('FLOW_PUBLICATION_PAGE_BREAK_INVALID', path, 'manualBreakBefore does not identify a semantic pageBreak.');
    }
    return { sectionId, blockId };
}

function validatePagination(pagination, context) {
    const { document, language, writingMode, pageBox, source } = context;
    assertExactKeys(pagination, PAGINATION_KEYS, 'pagination');
    if (pagination.documentId !== document.id
        || pagination.languageKey !== language
        || pagination.writingMode !== writingMode
        || !sameValue(pagination.pageBox, pageBox)) {
        fail('FLOW_PUBLICATION_PAGINATION_CONTEXT_MISMATCH', 'pagination', 'Pagination does not match the Flow publication context.');
    }
    if (!Array.isArray(pagination.pages) || pagination.pages.length < 1) {
        fail('FLOW_PUBLICATION_PAGES_INVALID', 'pagination.pages', 'Completed pagination must contain at least one page.');
    }

    validateFlowWrapPagination(context.flowGroup, pagination, context.typography);
    let textEntryIndex = 0;
    let nextGrapheme = 0;
    const manualBreaks = [];
    pagination.pages.forEach((page, pageIndex) => {
        const pagePath = `pagination.pages[${pageIndex}]`;
        assertExactKeys(page, PAGINATION_PAGE_KEYS, pagePath);
        if (page.index !== pageIndex) {
            fail('FLOW_PUBLICATION_PAGE_INDEX_INVALID', `${pagePath}.index`, 'Pagination page indexes must start at zero and be contiguous.');
        }
        const manualBreak = validateManualBreak(page.manualBreakBefore, `${pagePath}.manualBreakBefore`, source);
        if (manualBreak) manualBreaks.push(manualBreak);
        if (!Array.isArray(page.fragments)) {
            fail('FLOW_PUBLICATION_FRAGMENTS_INVALID', `${pagePath}.fragments`, 'Pagination fragments must be an array.');
        }
        page.fragments.forEach((fragment, fragmentIndex) => {
            const path = `${pagePath}.fragments[${fragmentIndex}]`;
            assertExactKeys(fragment, FRAGMENT_KEYS, path);
            const expected = source.textEntries[textEntryIndex];
            if (!expected) {
                fail('FLOW_PUBLICATION_FRAGMENT_UNEXPECTED', path, 'Pagination contains text beyond the FlowDocument.');
            }
            if((expected.block.annotations?.[language] || []).some(a=>a.type==='ruby' && a.start<fragment.sourceRange.end && fragment.sourceRange.start<a.end
                && (a.start<fragment.sourceRange.start || a.end>fragment.sourceRange.end)))fail('FLOW_PUBLICATION_ANNOTATION_MISMATCH',path,'Ruby must remain within one page fragment.');
            const expectedAnnotations=(expected.block.annotations?.[language] || []).filter(a=>a.start<fragment.sourceRange.end && fragment.sourceRange.start<a.end)
                .map(a=>({...a,start:Math.max(fragment.sourceRange.start,a.start)-fragment.sourceRange.start,end:Math.min(fragment.sourceRange.end,a.end)-fragment.sourceRange.start}));
            if(!sameValue(fragment.annotations || [],expectedAnnotations))fail('FLOW_PUBLICATION_ANNOTATION_MISMATCH',path,'Pagination annotations differ from source.');
            if(!sameValue(fragment.titleRegion || null,expected.block.titleRegion || null)
                || (page.fragments[0]?.titleRegion?.id || '') !== (fragment.titleRegion?.id || '')) {
                fail('FLOW_PUBLICATION_TITLE_REGION_MISMATCH',path,'Title region differs from source or crosses a page boundary.');
            }
            if(!sameValue(fragment.indent || null,expected.block.indentByLanguage?.[language] || null)) fail('FLOW_PUBLICATION_INDENT_MISMATCH',path,'Indent differs from source.');
            const range = fragment.sourceRange;
            assertExactKeys(range, SOURCE_RANGE_KEYS, `${path}.sourceRange`);
            const startGrapheme = finiteNumber(range.startGrapheme, `${path}.sourceRange.startGrapheme`, {
                integer: true, minimum: 0,
            });
            const endGrapheme = finiteNumber(range.endGrapheme, `${path}.sourceRange.endGrapheme`, {
                integer: true, minimum: startGrapheme, maximum: expected.segments.length,
            });
            const expectedRange = utf16Range(expected, startGrapheme, endGrapheme);
            const identityMatches = fragment.sectionId === expected.section.id
                && fragment.blockId === expected.block.id
                && fragment.blockType === expected.block.type
                && fragment.languageKey === language;
            const rangeMatches = startGrapheme === nextGrapheme
                && range.start === expectedRange.start
                && range.end === expectedRange.end
                && fragment.text === expectedRange.text
                && fragment.isBlockStart === (startGrapheme === 0)
                && fragment.isBlockEnd === (endGrapheme === expected.segments.length);
            const headingMatches = expected.block.type === 'heading'
                ? fragment.headingLevel === expected.block.level
                : !hasOwn(fragment, 'headingLevel');
            if (!identityMatches || !rangeMatches || !headingMatches) {
                fail('FLOW_PUBLICATION_FRAGMENT_SOURCE_MISMATCH', path, 'Pagination fragment does not exactly match semantic Flow source.');
            }
            if (expected.segments.length > 0 && endGrapheme <= startGrapheme) {
                fail('FLOW_PUBLICATION_FRAGMENT_RANGE_EMPTY', `${path}.sourceRange`, 'A non-empty Flow block fragment cannot have an empty range.');
            }
            if (endGrapheme === expected.segments.length) {
                textEntryIndex += 1;
                nextGrapheme = 0;
            } else {
                nextGrapheme = endGrapheme;
            }
        });
    });
    if (textEntryIndex !== source.textEntries.length || nextGrapheme !== 0) {
        fail('FLOW_PUBLICATION_SOURCE_INCOMPLETE', 'pagination.pages', 'Pagination does not cover the complete Flow text source.');
    }
    const expectedBreaks = source.pageBreaks.map((entry) => ({
        sectionId: entry.section.id,
        blockId: entry.block.id,
    }));
    if (!sameValue(manualBreaks, expectedBreaks)) {
        fail('FLOW_PUBLICATION_PAGE_BREAK_SEQUENCE_MISMATCH', 'pagination.pages', 'Pagination does not preserve every semantic pageBreak exactly once.');
    }
}

function validateSnapshotContext(snapshot, context) {
    const {
        flowGroup,
        document,
        language,
        revision,
        writingMode,
        pageBox,
        typography,
        fontId,
        fontDeclaration,
        pagination,
    } = context;
    assertExactKeys(snapshot, SNAPSHOT_KEYS, 'compositionSnapshot');
    if (snapshot.schemaVersion !== FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION
        || snapshot.status !== 'complete'
        || snapshot.revision !== revision
        || snapshot.rendererVersion !== FLOW_DOM_RENDERER_VERSION
        || snapshot.flowGroupId !== flowGroup.id
        || snapshot.documentId !== document.id
        || snapshot.languageKey !== language
        || snapshot.writingMode !== writingMode
        || !sameValue(snapshot.pageBox, pageBox)
        || !sameValue(snapshot.typography, typography)) {
        fail('FLOW_PUBLICATION_SNAPSHOT_CONTEXT_MISMATCH', 'compositionSnapshot', 'Composition snapshot is stale or belongs to a different Flow context.');
    }
    assertExactKeys(snapshot.evidence, SNAPSHOT_EVIDENCE_KEYS, 'compositionSnapshot.evidence');
    if (snapshot.evidence.fontId !== fontId
        || snapshot.evidence.fontSha256 !== fontDeclaration.sha256
        || snapshot.evidence.hyphenation !== 'none') {
        fail('FLOW_PUBLICATION_SNAPSHOT_EVIDENCE_INVALID', 'compositionSnapshot.evidence', 'Snapshot is not bound to the certified font and no-hyphenation publication mode.');
    }
    if (!Array.isArray(snapshot.pages) || snapshot.pages.length !== pagination.pages.length) {
        fail('FLOW_PUBLICATION_SNAPSHOT_PAGE_COUNT_MISMATCH', 'compositionSnapshot.pages', 'Snapshot page count does not match pagination.');
    }
}

function validateLineGeometry(line, path, writingMode, pageBox) {
    const x = finiteNumber(line.x, `${path}.x`, { minimum: 0, maximum: CANONICAL_PAGE_WIDTH });
    const y = finiteNumber(line.y, `${path}.y`, { minimum: 0, maximum: CANONICAL_PAGE_HEIGHT });
    const width = finiteNumber(line.width, `${path}.width`, { minimum: Number.EPSILON, maximum: CANONICAL_PAGE_WIDTH });
    const height = finiteNumber(line.height, `${path}.height`, { minimum: Number.EPSILON, maximum: CANONICAL_PAGE_HEIGHT });
    if (x + width > CANONICAL_PAGE_WIDTH + 1e-6 || y + height > CANONICAL_PAGE_HEIGHT + 1e-6) {
        fail('FLOW_PUBLICATION_LINE_OUT_OF_BOUNDS', path, 'Measured line or column exceeds the canonical page.');
    }
    const contentBox = pageBox.contentBox;
    if (x < contentBox.x - 1e-6
        || y < contentBox.y - 1e-6
        || x + width > contentBox.x + contentBox.width + 1e-6
        || y + height > contentBox.y + contentBox.height + 1e-6) {
        fail('FLOW_PUBLICATION_LINE_OUTSIDE_CONTENT_BOX', path, 'Measured line or column exceeds the author-defined Flow content box.');
    }
    if (line.writingMode !== writingMode || line.textOrientation !== 'mixed') {
        fail('FLOW_PUBLICATION_LINE_MODE_MISMATCH', path, 'Measured line writing mode does not match pagination.');
    }
    return { x, y, width, height };
}

function styleIdForEntry(entry) {
    return entry.block.type === 'heading' ? `heading-${entry.block.level}` : 'body';
}

export function validateSnapshotPage(snapshotPage, paginationPage, pageIndex, context) {
    const path = `compositionSnapshot.pages[${pageIndex}]`;
    assertExactKeys(snapshotPage, SNAPSHOT_PAGE_KEYS, path);
    if (snapshotPage.index !== pageIndex
        || !sameValue(snapshotPage.manualBreakBefore, paginationPage.manualBreakBefore)) {
        fail('FLOW_PUBLICATION_SNAPSHOT_PAGE_MISMATCH', path, 'Snapshot page identity or manual break is stale.');
    }
    if (!Array.isArray(snapshotPage.lines)) {
        fail('FLOW_PUBLICATION_SNAPSHOT_LINES_INVALID', `${path}.lines`, 'Snapshot lines must be an array.');
    }
    const expectedWrap = paginationPage.anchoredObject ? {object:paginationPage.anchoredObject,regions:paginationPage.wrapRegions} : null;
    if(!sameValue(snapshotPage.wrapLayout || null, expectedWrap)) fail('FLOW_PUBLICATION_WRAP_MISMATCH',path,'Background and text composition differ.');
    const fragments = paginationPage.fragments;
    let fragmentIndex = 0;
    let nextGrapheme = fragments[0]?.sourceRange?.startGrapheme ?? 0;
    const outputLines = snapshotPage.lines.map((line, lineIndex) => {
        const linePath = `${path}.lines[${lineIndex}]`;
        assertExactKeys(line, SNAPSHOT_LINE_KEYS, linePath);
        const geometry = validateLineGeometry(line, linePath, context.writingMode, context.pageBox);
        if (!Array.isArray(line.runs) || line.runs.length < 1) {
            fail('FLOW_PUBLICATION_SNAPSHOT_RUNS_INVALID', `${linePath}.runs`, 'Every measured line requires at least one semantic run.');
        }
        let lineBlockId = null;
        let lineStyleId = null;
        const outputRuns = line.runs.map((run, runIndex) => {
            const runPath = `${linePath}.runs[${runIndex}]`;
            assertExactKeys(run, SNAPSHOT_RUN_KEYS, runPath);
            if (typeof run.text !== 'string') {
                fail('FLOW_PUBLICATION_RUN_TEXT_INVALID', `${runPath}.text`, 'Snapshot run text must be a string.');
            }
            assertExactKeys(run.source, RUN_SOURCE_KEYS, `${runPath}.source`);
            const fragment = fragments[fragmentIndex];
            if (!fragment) {
                fail('FLOW_PUBLICATION_RUN_UNEXPECTED', runPath, 'Snapshot contains text beyond the pagination page.');
            }
            const entry = context.source.byBlockId.get(fragment.blockId);
            const startGrapheme = finiteNumber(run.source.startGrapheme, `${runPath}.source.startGrapheme`, {
                integer: true, minimum: 0,
            });
            const endGrapheme = finiteNumber(run.source.endGrapheme, `${runPath}.source.endGrapheme`, {
                integer: true, minimum: startGrapheme, maximum: entry.segments.length,
            });
            const fragmentEnd = fragment.sourceRange.endGrapheme;
            const emptyFragment = fragment.sourceRange.startGrapheme === fragmentEnd;
            const sourceRange = utf16Range(entry, startGrapheme, endGrapheme);
            if (run.source.blockId !== fragment.blockId
                || startGrapheme !== nextGrapheme
                || endGrapheme > fragmentEnd
                || run.text !== sourceRange.text
                || (!emptyFragment && endGrapheme <= startGrapheme)
                || (emptyFragment && (run.text !== '' || endGrapheme !== startGrapheme))) {
                fail('FLOW_PUBLICATION_RUN_SOURCE_MISMATCH', runPath, 'Measured run does not exactly cover the pagination fragment source.');
            }
            if (lineBlockId && lineBlockId !== fragment.blockId) {
                fail('FLOW_PUBLICATION_LINE_CROSSES_BLOCKS', linePath, 'A fixed line cannot combine separate semantic Flow blocks.');
            }
            lineBlockId = fragment.blockId;
            lineStyleId = styleIdForEntry(entry);
            nextGrapheme = endGrapheme;
            if (endGrapheme === fragmentEnd) {
                fragmentIndex += 1;
                nextGrapheme = fragments[fragmentIndex]?.sourceRange?.startGrapheme ?? 0;
            }
            return {
                text: run.text,
                source: {
                    blockId: run.source.blockId,
                    startGrapheme,
                    endGrapheme,
                },
            };
        });
        return {
            ...geometry,
            writingMode: context.writingMode,
            textOrientation: 'mixed',
            styleRef: lineStyleId,
            runs: outputRuns,
        };
    });
    if (fragmentIndex !== fragments.length) {
        fail('FLOW_PUBLICATION_SNAPSHOT_SOURCE_INCOMPLETE', `${path}.lines`, 'Measured lines do not cover every pagination fragment.');
    }
    const expected=fragments.flatMap(getFlowPublicationAnnotationGlyphs);
    const actual=snapshotPage.annotations || [];
    if(!Array.isArray(actual) || actual.length!==expected.length)fail('FLOW_PUBLICATION_ANNOTATION_MISMATCH',path,'Annotation glyphs are missing or duplicated.');
    actual.forEach((glyph,index)=>{
        assertExactKeys(glyph,new Set(['blockId','annotationId','type','index','text','x','y','width','height']),path);
        if(!Object.entries(expected[index]).every(([key,value])=>glyph[key]===value))fail('FLOW_PUBLICATION_ANNOTATION_MISMATCH',path,'Annotation glyphs differ from source.');
        outputLines.push({...validateLineGeometry({...glyph,writingMode:context.writingMode,textOrientation:'mixed'},path,context.writingMode,{...context.pageBox,contentBox:{x:0,y:0,width:context.pageBox.width,height:context.pageBox.height}}),
            writingMode:context.writingMode,textOrientation:'mixed',styleRef:styleIdForEntry(context.source.byBlockId.get(glyph.blockId))+'-'+glyph.type,runs:[{text:glyph.text}]});
    });
    const object=paginationPage.anchoredObject;
    if(object && outputLines.some(line=>line.x<object.x+object.width && line.x+line.width>object.x
        && line.y<object.y+object.height && line.y+line.height>object.y)) {
        fail('FLOW_PUBLICATION_OBJECT_TEXT_OVERLAP',path,'Measured text intersects its anchored background.');
    }
    return outputLines;
}

function createSourceAnchor(page, pageIndex, pagination, source, flowGroupId) {
    const firstFragment = page.fragments[0];
    if (firstFragment) {
        const entry = source.byBlockId.get(firstFragment.blockId);
        const total = entry.segments.length;
        return {
            kind: 'flow',
            flowGroupId,
            sectionId: firstFragment.sectionId,
            firstBlockId: firstFragment.blockId,
            blockProgress: total > 0 ? firstFragment.sourceRange.startGrapheme / total : 0,
        };
    }
    const boundary = page.manualBreakBefore || pagination.pages[pageIndex + 1]?.manualBreakBefore;
    const entry = boundary ? source.byBlockId.get(boundary.blockId) : null;
    if (!entry || entry.block.type !== 'pageBreak') {
        fail('FLOW_PUBLICATION_EMPTY_PAGE_ANCHOR_MISSING', `pagination.pages[${pageIndex}]`, 'An empty generated page has no semantic source anchor.');
    }
    return {
        kind: 'flow',
        flowGroupId,
        sectionId: entry.section.id,
        firstBlockId: entry.block.id,
        blockProgress: 0,
    };
}

function buildStyles(typography, fontId, source) {
    const bodyWeight = normalizeFontWeight(typography.fontWeight, 'compositionSnapshot.typography.fontWeight');
    const styles = {
        body: {
            fontRef: fontId,
            fontSize: typography.fontSize,
            fontWeight: bodyWeight,
            fontStyle: 'normal',
            lineHeight: typography.lineHeight,
            letterSpacing: typography.letterSpacing,
            color: typography.textColor,
            textDecoration: 'none',
            // Author alignment is already encoded in each measured line x/y.
            textAlign: 'start',
            whiteSpaceMode: FIXED_TEXT_WHITE_SPACE_MODE,
        },
    };
    const levels = [...new Set(source.textEntries
        .filter((entry) => entry.block.type === 'heading')
        .map((entry) => entry.block.level))].sort((left, right) => left - right);
    for (const level of levels) {
        styles[`heading-${level}`] = {
            ...styles.body,
            fontSize: typography.fontSize * HEADING_SCALES[level],
            fontWeight: 700,
            lineHeight: Math.max(1.35, typography.lineHeight - 0.15),
        };
    }
    return styles;
}

function prepareContext(input) {
    assertExactKeys(input, INPUT_KEYS, '');
    const flowGroup = input.flowGroup;
    if (!isRecord(flowGroup) || flowGroup.kind !== 'flow' || !isRecord(flowGroup.flow)) {
        fail('FLOW_PUBLICATION_GROUP_INVALID', 'flowGroup', 'A Project v6 Flow Group is required.');
    }
    const groupId = exactString(flowGroup.id, 'flowGroup.id');
    const document = flowGroup.flow.document;
    try {
        assertValidFlowDocument(document);
    } catch (error) {
        fail('FLOW_PUBLICATION_DOCUMENT_INVALID', 'flowGroup.flow.document', error.message, {
            issues: error?.issues || [],
        });
    }
    const language = exactString(input.language, 'language', 64);
    for (const section of document.sections) {
        for (const block of section.blocks) {
            if (isFlowTextBlock(block) && (!hasOwn(block.texts, language) || typeof block.texts[language] !== 'string')) {
                fail('FLOW_PUBLICATION_LANGUAGE_INCOMPLETE', `flowGroup.flow.document.blocks.${block.id}`, 'Every Flow text block requires the exact publication language.');
            }
        }
    }
    const revision = finiteNumber(input.revision, 'revision', { integer: true, minimum: 0 });
    const profile = flowGroup.flow.layout?.typographyByLanguage?.[language];
    if (!isRecord(profile)) {
        fail('FLOW_PUBLICATION_TYPOGRAPHY_MISSING', `flowGroup.flow.layout.typographyByLanguage.${language}`, 'Publication typography is missing for the exact language.');
    }
    const writingMode = String(profile.writingMode || 'horizontal-tb');
    let authorTypography;
    let pageBox;
    const typographyOptions = { languageConfigs: input.languageConfigs };
    try {
        authorTypography = resolveFlowDomTypography(language, profile, writingMode, typographyOptions);
        pageBox = createCanonicalFlowPageBox({ padding: flowGroup.flow.layout?.padding });
    } catch (error) {
        fail('FLOW_PUBLICATION_LAYOUT_INVALID', 'flowGroup.flow.layout', error.message, { code: error?.code });
    }
    const bodyWeight = normalizeFontWeight(authorTypography.fontWeight, 'flowGroup.flow.layout.typography.fontWeight');
    const fontId = exactString(input.fontId, 'fontId');
    const source = buildSourceModel(document, language);
    const requiredWeights = new Set([bodyWeight]);
    if (source.textEntries.some((entry) => entry.block.type === 'heading')) requiredWeights.add(700);
    let fontResolution;
    for (const fontWeight of requiredWeights) {
        fontResolution = resolveDsfProductionFont(input.fontRegistry, fontId, {
            language,
            writingMode,
            fontWeight,
            fontStyle: 'normal',
        });
        if (!fontResolution.ok) {
            fail(fontResolution.code || 'FONT_NOT_CERTIFIED', 'fontRegistry', 'Flow publication font is not production-certified for the required typography.', {
                fontId,
                language,
                writingMode,
                fontWeight,
                issues: fontResolution.issues || [],
            });
        }
    }
    const fontDeclaration = fontResolution.font.declaration;
    if (primaryFontFamily(authorTypography.fontFamily) !== fontDeclaration.family) {
        fail('FLOW_PUBLICATION_FONT_FAMILY_MISMATCH', 'compositionSnapshot.typography.fontFamily', 'Certified font family does not match Flow composition.');
    }
    const typography = resolveFlowPublicationTypography(
        language,
        profile,
        writingMode,
        fontDeclaration.family,
        typographyOptions,
    );
    const pagination = input.pagination;
    const context = {
        flowGroup,
        groupId,
        document,
        language,
        revision,
        writingMode,
        typography,
        pageBox,
        source,
        pagination,
        fontId,
        fontDeclaration,
    };
    validatePagination(pagination, context);
    validateSnapshotContext(input.compositionSnapshot, context);
    if (!Array.isArray(input.pageIds) || input.pageIds.length !== pagination.pages.length) {
        fail('FLOW_PUBLICATION_PAGE_IDS_INVALID', 'pageIds', 'A stable delivery page ID is required for every generated page.');
    }
    const seenPageIds = new Set();
    input.pageIds.forEach((pageId, index) => {
        exactString(pageId, `pageIds[${index}]`);
        if (seenPageIds.has(pageId)) fail('FLOW_PUBLICATION_PAGE_ID_DUPLICATE', `pageIds[${index}]`, 'Delivery page IDs must be unique.');
        seenPageIds.add(pageId);
    });
    if (input.pageLabels !== undefined) {
        if (!Array.isArray(input.pageLabels) || input.pageLabels.length !== pagination.pages.length) {
            fail('FLOW_PUBLICATION_PAGE_LABELS_INVALID', 'pageLabels', 'pageLabels must match generated page count.');
        }
        input.pageLabels.forEach((label, index) => {
            if (typeof label !== 'string' || label.length > 512) {
                fail('FLOW_PUBLICATION_PAGE_LABELS_INVALID', `pageLabels[${index}]`, 'Page label must be a bounded string.');
            }
        });
    }
    return context;
}

/** Project a complete measured Flow pagination snapshot into one v2 language-manifest fragment. */
export function projectFlowPaginationToDsfV2(input = {}) {
    try {
        const context = prepareContext(input);
        const styles = buildStyles(context.typography, context.fontId, context.source);
        for(const entry of context.source.textEntries){
            if(!entry.block.annotations?.[context.language]?.length)continue;
            const id=styleIdForEntry(entry),base=styles[id];
            styles[id+'-ruby']={...base,fontSize:base.fontSize*.5,lineHeight:1.2,letterSpacing:0};
            styles[id+'-emphasis']={...base,fontSize:base.fontSize*.48,lineHeight:1.2,letterSpacing:0};
        }
        const pages = context.pagination.pages.map((page, pageIndex) => ({
            id: input.pageIds[pageIndex],
            renderKind: 'fixedText',
            sourceAnchor: createSourceAnchor(
                page,
                pageIndex,
                context.pagination,
                context.source,
                context.groupId,
            ),
            ...(input.pageLabels === undefined ? {} : { pageLabel: input.pageLabels[pageIndex] }),
            background: { color: context.typography.paperColor },
            lines: validateSnapshotPage(
                input.compositionSnapshot.pages[pageIndex],
                page,
                pageIndex,
                context,
            ),
        }));
        const manifest = {
            schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
            language: context.language,
            styles,
            pages,
        };
        const bundle = {
            index: {
                schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
                layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
                canonicalPage: {
                    width: CANONICAL_PAGE_WIDTH,
                    height: CANONICAL_PAGE_HEIGHT,
                    aspectRatio: '9:16',
                },
                defaultLang: context.language,
                fonts: { [context.fontId]: context.fontDeclaration },
                languages: {
                    [context.language]: {
                        href: 'content/flow-projection.json',
                        pageCount: pages.length,
                        sha256: EMPTY_SHA256,
                        pageDirection: context.writingMode === 'vertical-rl' ? 'rtl' : 'ltr',
                    },
                },
            },
            manifests: { [context.language]: manifest },
        };
        const validation = validateDsfDeliveryBundle(bundle);
        if (!validation.valid) {
            fail('FLOW_PUBLICATION_DSF_VALIDATION_FAILED', 'manifest', 'Projected Flow pages do not satisfy the DSF delivery v2 contract.', {
                issues: validation.issues,
            });
        }
        return deepFreeze({
            ok: true,
            projectionVersion: FLOW_PUBLICATION_PROJECTION_VERSION,
            renderKind: 'fixedText',
            flowGroupId: context.groupId,
            documentId: context.document.id,
            language: context.language,
            revision: context.revision,
            writingMode: context.writingMode,
            font: { id: context.fontId, declaration: context.fontDeclaration },
            manifest,
            ...(context.pagination.pages.some(p=>p.anchoredObject) ? {backgrounds:context.pagination.pages.flatMap((p,index)=>p.anchoredObject ? [{pageIndex:index,object:structuredClone(p.anchoredObject),revision:context.revision}] : [])} : {}),
            summary: {
                pageCount: pages.length,
                lineCount: pages.reduce((sum, page) => sum + page.lines.length, 0),
                runCount: pages.reduce((sum, page) => (
                    sum + page.lines.reduce((lineSum, line) => lineSum + line.runs.length, 0)
                ), 0),
            },
        });
    } catch (error) {
        return blocked(error, input);
    }
}
