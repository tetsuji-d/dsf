/**
 * Pure Press preflight for choosing the delivery path of authoring blocks.
 *
 * This module does not compose text, render WebP, publish assets, or write back
 * to authoring state. A text page becomes fixedText only when its existing
 * composition snapshot is bound to a production-certified font. Every other
 * representable Fixed page stays on the existing WebP path with an explicit
 * reason. Flow becomes publishable only when the caller supplies a completed,
 * matching 9A-5A projection; this module never creates or refreshes it.
 */

import { deepClone } from './utils.js';
import { validateDsfLanguageManifest } from './dsf-delivery-v2.js';
import { projectFixedTextBlockToDsfV2 } from './fixed-text-delivery-projection.js';
import {
    DSF_PRODUCTION_FONT_REGISTRY,
    assertValidDsfProductionFontRegistry,
    resolveDsfProductionFont,
} from './dsf-font-registry.js';

export const DSF_PRESS_PREFLIGHT_SCHEMA_VERSION = 1;

const STRUCTURAL_BLOCK_KINDS = new Set([
    'cover_front',
    'cover_back',
    'chapter',
    'section',
    'item',
    'item_end',
    'toc',
]);

const FONT_FAILURE_REASONS = Object.freeze({
    FONT_NOT_CERTIFIED: 'The composition font is not registered as a production-certified DSF font.',
    FONT_LANGUAGE_UNSUPPORTED: 'The certified font does not cover the exact publication language key.',
    FONT_WRITING_MODE_UNSUPPORTED: 'The certified font is not approved for this writing mode.',
    FONT_WEIGHT_UNSUPPORTED: 'The certified font is not approved for the projected font weight.',
    FONT_STYLE_UNSUPPORTED: 'The certified font is not approved for the projected font style.',
});

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function getMappedValue(source, key) {
    if (source instanceof Map) return source.get(key);
    if (isRecord(source)) return source[key];
    return undefined;
}

function getMappedEntries(source) {
    if (source instanceof Map) return [...source.entries()];
    if (isRecord(source)) return Object.entries(source);
    return [];
}

function getSnapshot(source, blockId) {
    const snapshot = getMappedValue(source, blockId);
    return isRecord(snapshot) ? snapshot : null;
}

function requireValidInput(
    blocks,
    language,
    compositionSnapshots,
    flowPublicationProjections,
    flowPublicationRevisions,
) {
    const issues = [];
    if (!Array.isArray(blocks)) {
        issues.push(createIssue('PRESS_PREFLIGHT_BLOCKS_INVALID', 'blocks', 'Authoring blocks must be an array.'));
    }
    if (typeof language !== 'string' || !language || language !== language.trim()) {
        issues.push(createIssue(
            'PRESS_PREFLIGHT_LANGUAGE_INVALID',
            'language',
            'Preflight requires an exact non-empty authoring language key.',
        ));
    }
    if (!(compositionSnapshots instanceof Map) && !isRecord(compositionSnapshots)) {
        issues.push(createIssue(
            'PRESS_PREFLIGHT_SNAPSHOTS_INVALID',
            'compositionSnapshots',
            'Composition snapshots must be a Map or an object keyed by Fixed block ID.',
        ));
    }
    if (!(flowPublicationProjections instanceof Map) && !isRecord(flowPublicationProjections)) {
        issues.push(createIssue(
            'PRESS_PREFLIGHT_FLOW_PROJECTIONS_INVALID',
            'flowPublicationProjections',
            'Flow publication projections must be a Map or an object keyed by Flow Group ID.',
        ));
    }
    if (!(flowPublicationRevisions instanceof Map) && !isRecord(flowPublicationRevisions)) {
        issues.push(createIssue(
            'PRESS_PREFLIGHT_FLOW_REVISIONS_INVALID',
            'flowPublicationRevisions',
            'Current Flow authoring revisions must be a Map or an object keyed by Flow Group ID.',
        ));
    }
    if (issues.length) throw new DsfPressPreflightError(issues);

    const firstIndexById = new Map();
    blocks.forEach((block, index) => {
        if (!isRecord(block)) {
            issues.push(createIssue('AUTHORING_BLOCK_INVALID', `blocks[${index}]`, 'Authoring block must be an object.'));
            return;
        }
        if (STRUCTURAL_BLOCK_KINDS.has(block.kind)) return;
        if (typeof block.id !== 'string' || !block.id || block.id !== block.id.trim()) {
            issues.push(createIssue('AUTHORING_BLOCK_ID_INVALID', `blocks[${index}].id`, 'Renderable blocks require a stable ID.'));
            return;
        }
        if (firstIndexById.has(block.id)) {
            issues.push(createIssue(
                'AUTHORING_BLOCK_ID_DUPLICATE',
                `blocks[${index}].id`,
                'Renderable block IDs must be unique before publication preflight.',
                { firstPath: `blocks[${firstIndexById.get(block.id)}].id`, blockId: block.id },
            ));
            return;
        }
        firstIndexById.set(block.id, index);
        if (block.kind !== 'page' && block.kind !== 'flow') {
            issues.push(createIssue(
                'AUTHORING_BLOCK_KIND_UNSUPPORTED',
                `blocks[${index}].kind`,
                'Unknown authoring block kind cannot be published safely.',
                { blockId: block.id, blockKind: block.kind ?? null },
            ));
        }
    });
    if (issues.length) throw new DsfPressPreflightError(issues);
}

function createImageDecision({ fixedPageIndex, deliveryPageIndex, authoringBlockIndex, block, code, reason, details }) {
    return {
        fixedPageIndex,
        deliveryPageIndex,
        authoringBlockIndex,
        blockId: block.id,
        sourceKind: 'fixed',
        renderKind: 'image',
        decisionCode: code,
        ...(reason ? { reason } : {}),
        ...(details === undefined ? {} : { details: deepClone(details) }),
    };
}

function sameFontDeclaration(left, right) {
    const keys = ['family', 'version', 'source', 'href', 'sha256'];
    return isRecord(left)
        && isRecord(right)
        && Object.keys(left).length === keys.length
        && Object.keys(right).length === keys.length
        && keys.every((key) => left[key] === right[key]);
}

function validateFlowPublicationProjection({
    block,
    language,
    currentRevision,
    projection,
    fontRegistry,
    path,
}) {
    const issues = [];
    if (!isRecord(projection)) {
        issues.push(createIssue(
            'FLOW_PUBLICATION_PROJECTION_MISSING',
            path,
            'Flow publication requires a completed projection for the exact language and current authoring revision.',
            { blockId: block.id },
        ));
        return issues;
    }
    if (!Number.isInteger(currentRevision) || currentRevision < 0) {
        issues.push(createIssue(
            'FLOW_PUBLICATION_REVISION_MISSING',
            `${path}.revision`,
            'Flow publication requires the current runtime authoring revision.',
            { blockId: block.id },
        ));
        return issues;
    }
    const manifest = projection.manifest;
    const fontId = projection.font?.id;
    const identityMatches = projection.ok === true
        && projection.renderKind === 'fixedText'
        && projection.flowGroupId === block.id
        && projection.documentId === block.flow?.document?.id
        && projection.language === language
        && projection.revision === currentRevision;
    if (!identityMatches) {
        issues.push(createIssue(
            'FLOW_PUBLICATION_PROJECTION_CONTEXT_MISMATCH',
            path,
            'Flow projection does not match the authoring Group, document, language, or revision contract.',
            { blockId: block.id },
        ));
        return issues;
    }
    const validation = validateDsfLanguageManifest(manifest, {
        expectedLanguage: language,
        fontIds: typeof fontId === 'string' ? [fontId] : [],
    });
    if (!validation.valid
        || !Array.isArray(manifest?.pages)
        || manifest.pages.length < 1
        || projection.summary?.pageCount !== manifest.pages.length) {
        issues.push(createIssue(
            'FLOW_PUBLICATION_PROJECTION_MANIFEST_INVALID',
            `${path}.manifest`,
            'Flow projection does not contain a valid, complete language-manifest fragment.',
            { validationIssues: deepClone(validation.issues || []) },
        ));
        return issues;
    }
    const anchorMismatch = manifest.pages.findIndex((page) => (
        page.renderKind !== 'fixedText'
        || page.sourceAnchor?.kind !== 'flow'
        || page.sourceAnchor.flowGroupId !== block.id
    ));
    if (anchorMismatch >= 0) {
        issues.push(createIssue(
            'FLOW_PUBLICATION_PROJECTION_ANCHOR_MISMATCH',
            `${path}.manifest.pages[${anchorMismatch}].sourceAnchor`,
            'Every generated Flow page must remain anchored to its authoring Group.',
            { blockId: block.id },
        ));
        return issues;
    }
    const styles = Object.values(manifest.styles || {});
    for (const [styleIndex, style] of styles.entries()) {
        if (style?.fontRef !== fontId) {
            issues.push(createIssue(
                'FLOW_PUBLICATION_PROJECTION_FONT_MISMATCH',
                `${path}.manifest.styles[${styleIndex}].fontRef`,
                'Flow projection styles must use its certified publication font.',
                { blockId: block.id, fontId: fontId || null },
            ));
            return issues;
        }
        const fontResolution = resolveDsfProductionFont(fontRegistry, fontId, {
            language,
            writingMode: projection.writingMode,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
        });
        if (!fontResolution.ok
            || !sameFontDeclaration(fontResolution.font?.declaration, projection.font?.declaration)) {
            issues.push(createIssue(
                'FLOW_PUBLICATION_FONT_NOT_CERTIFIED',
                `${path}.font`,
                'Flow projection font is not certified by the current production registry.',
                {
                    blockId: block.id,
                    fontId: fontId || null,
                    fontIssueCode: fontResolution.code || 'FONT_DECLARATION_MISMATCH',
                },
            ));
            return issues;
        }
    }
    return issues;
}

function getFontRequirement(snapshot) {
    return {
        language: snapshot?.evidence?.language,
        writingMode: snapshot?.composition?.writingMode,
        // 9A-3A emits one body style with these exact values.
        fontWeight: 400,
        fontStyle: 'normal',
    };
}

function resolvePageId(pageIds, block, language) {
    const configured = getMappedValue(pageIds, block.id);
    if (typeof configured === 'string' && configured.trim()) return configured;
    return `fixed:${block.id}:${language}`;
}

function getPageLabel(pageLabels, block) {
    const configured = getMappedValue(pageLabels, block.id);
    return typeof configured === 'string' ? configured : undefined;
}

export class DsfPressPreflightError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF Press preflight input.');
        this.name = 'DsfPressPreflightError';
        this.code = 'DSF_PRESS_PREFLIGHT_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Classify the authoring spine without performing publication side effects.
 *
 * `compositionSnapshots` is keyed by Fixed block ID and contains:
 * `{ composition, evidence: { sourceText, layoutVersion, fontId, fontSha256 } }`.
 * `flowPublicationProjections` is keyed by Flow Group ID and contains only
 * completed 9A-5A projection results for this exact language/revision.
 * `flowPublicationRevisions` supplies the current runtime authoring revision;
 * stale or unversioned projections fail closed.
 */
export function createDsfPressPreflight(input = {}) {
    const {
        blocks,
        language,
        compositionSnapshots = {},
        flowPublicationProjections = {},
        flowPublicationRevisions = {},
        fontRegistry = DSF_PRODUCTION_FONT_REGISTRY,
        pageIds = {},
        pageLabels = {},
    } = input;

    requireValidInput(
        blocks,
        language,
        compositionSnapshots,
        flowPublicationProjections,
        flowPublicationRevisions,
    );
    assertValidDsfProductionFontRegistry(fontRegistry);

    const decisions = [];
    const issues = [];
    const requiredFontIds = new Set();
    let fixedPageIndex = 0;
    let deliveryPageIndex = 0;
    let flowGroupCount = 0;
    let flowPageCount = 0;
    const flowBlockIds = new Set();

    blocks.forEach((block, authoringBlockIndex) => {
        if (STRUCTURAL_BLOCK_KINDS.has(block.kind)) return;
        if (block.kind === 'flow') {
            flowGroupCount += 1;
            flowBlockIds.add(block.id);
            const projection = getMappedValue(flowPublicationProjections, block.id);
            const currentRevision = getMappedValue(flowPublicationRevisions, block.id);
            const projectionPath = `flowPublicationProjections.${block.id}`;
            const projectionIssues = validateFlowPublicationProjection({
                block,
                language,
                currentRevision,
                projection,
                fontRegistry,
                path: projectionPath,
            });
            if (projectionIssues.length > 0) {
                issues.push(...projectionIssues);
                return;
            }
            const pageCount = projection.manifest.pages.length;
            requiredFontIds.add(projection.font.id);
            decisions.push({
                deliveryPageIndex,
                authoringBlockIndex,
                blockId: block.id,
                sourceKind: 'flow',
                renderKind: 'fixedText',
                decisionCode: 'FLOW_FIXED_TEXT_CERTIFIED',
                projection,
            });
            deliveryPageIndex += pageCount;
            flowPageCount += pageCount;
            return;
        }

        const currentFixedPageIndex = fixedPageIndex;
        const currentDeliveryPageIndex = deliveryPageIndex;
        fixedPageIndex += 1;
        deliveryPageIndex += 1;
        if (block.content?.pageKind !== 'text') {
            decisions.push(createImageDecision({
                fixedPageIndex: currentFixedPageIndex,
                deliveryPageIndex: currentDeliveryPageIndex,
                authoringBlockIndex,
                block,
                code: 'GRAPHIC_PAGE_WEBP',
                reason: 'Graphic and photo pages remain on the existing WebP delivery path.',
            }));
            return;
        }

        const snapshot = getSnapshot(compositionSnapshots, block.id);
        if (!snapshot || !isRecord(snapshot.composition) || !isRecord(snapshot.evidence)) {
            decisions.push(createImageDecision({
                fixedPageIndex: currentFixedPageIndex,
                deliveryPageIndex: currentDeliveryPageIndex,
                authoringBlockIndex,
                block,
                code: 'FIXED_TEXT_COMPOSITION_MISSING',
                reason: 'A verified composition snapshot is required before fixedText delivery can be selected.',
            }));
            return;
        }

        const requirements = getFontRequirement(snapshot);
        requirements.language = language;
        const fontResolution = resolveDsfProductionFont(fontRegistry, snapshot.evidence.fontId, requirements);
        if (!fontResolution.ok) {
            decisions.push(createImageDecision({
                fixedPageIndex: currentFixedPageIndex,
                deliveryPageIndex: currentDeliveryPageIndex,
                authoringBlockIndex,
                block,
                code: fontResolution.code,
                reason: FONT_FAILURE_REASONS[fontResolution.code] || 'The production font registry rejected this page.',
                details: fontResolution,
            }));
            return;
        }

        const projection = projectFixedTextBlockToDsfV2({
            block,
            language,
            pageId: resolvePageId(pageIds, block, language),
            pageLabel: getPageLabel(pageLabels, block),
            composition: snapshot.composition,
            compositionEvidence: snapshot.evidence,
            certifiedFont: fontResolution.font,
        });
        if (!projection.ok) {
            decisions.push(createImageDecision({
                fixedPageIndex: currentFixedPageIndex,
                deliveryPageIndex: currentDeliveryPageIndex,
                authoringBlockIndex,
                block,
                code: projection.fallback.code,
                reason: projection.fallback.message,
                details: projection.fallback.details,
            }));
            return;
        }

        requiredFontIds.add(projection.font.id);
        decisions.push({
            fixedPageIndex: currentFixedPageIndex,
            deliveryPageIndex: currentDeliveryPageIndex,
            authoringBlockIndex,
            blockId: block.id,
            sourceKind: 'fixed',
            renderKind: 'fixedText',
            decisionCode: 'FIXED_TEXT_CERTIFIED',
            projection,
        });
    });

    for (const [flowGroupId] of getMappedEntries(flowPublicationProjections)) {
        if (!flowBlockIds.has(flowGroupId)) {
            issues.push(createIssue(
                'FLOW_PUBLICATION_PROJECTION_UNUSED',
                `flowPublicationProjections.${flowGroupId}`,
                'Flow projection does not match a Flow Group in the authoring spine.',
                { flowGroupId },
            ));
        }
    }
    for (const [flowGroupId] of getMappedEntries(flowPublicationRevisions)) {
        if (!flowBlockIds.has(flowGroupId)) {
            issues.push(createIssue(
                'FLOW_PUBLICATION_REVISION_UNUSED',
                `flowPublicationRevisions.${flowGroupId}`,
                'Flow revision does not match a Flow Group in the authoring spine.',
                { flowGroupId },
            ));
        }
    }

    const fixedTextPageCount = decisions.reduce((count, decision) => (
        count + (decision.renderKind !== 'fixedText'
            ? 0
            : decision.sourceKind === 'flow'
                ? decision.projection.manifest.pages.length
                : 1)
    ), 0);
    const imagePageCount = decisions.filter((decision) => decision.renderKind === 'image').length;
    const fallbackPageCount = decisions.filter((decision) => (
        decision.renderKind === 'image' && decision.decisionCode !== 'GRAPHIC_PAGE_WEBP'
    )).length;
    const result = {
        schemaVersion: DSF_PRESS_PREFLIGHT_SCHEMA_VERSION,
        language,
        publishable: issues.length === 0,
        decisions,
        issues,
        requiredFonts: [...requiredFontIds].sort(),
        summary: {
            fixedPageCount: fixedPageIndex,
            flowPageCount,
            deliveryPageCount: deliveryPageIndex,
            fixedTextPageCount,
            imagePageCount,
            fallbackPageCount,
            blockedCount: issues.length,
            flowGroupCount,
        },
    };
    return deepFreeze(deepClone(result));
}
