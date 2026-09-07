/**
 * Pure Project v6 authoring model for mixed Fixed and Flow content.
 *
 * This module is intentionally disconnected from state, persistence, Page v5,
 * Press, and Viewer. Existing Fixed blocks are opaque authoring data. Only a
 * top-level `kind: 'flow'` block is interpreted here; generated pages are never
 * part of the persisted Flow group.
 */

import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';
import { DEFAULT_FLOW_PAGE_PADDING } from './flow-pagination.js';
import {
    FLOW_DOCUMENT_SCHEMA_VERSION,
    createFlowDocument,
    validateFlowDocument,
} from './flow-document.js';
import {
    FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    normalizeFlowTranslationState,
    validateFlowTranslationState,
} from './flow-translation-state.js';
import {
    DEFAULT_FLOW_WRITING_MODE,
    isFlowWritingModeSupported,
} from './flow-typography.js';
import { normalizeProjectDataV5 } from './pages.js';
import { createId, deepClone } from './utils.js';

export const PROJECT_SCHEMA_VERSION = 6;
export const FLOW_GROUP_KIND = 'flow';
export const FLOW_LAYOUT_SCHEMA_VERSION = 1;
export const FLOW_CANONICAL_PAGE_PRESET = 'dsf-canonical';

export const FIXED_PROJECT_BLOCK_KINDS = Object.freeze([
    'cover_front',
    'cover_back',
    'chapter',
    'section',
    'item',
    'item_end',
    'toc',
    'page',
]);

const FIXED_PROJECT_BLOCK_KIND_SET = new Set(FIXED_PROJECT_BLOCK_KINDS);
const PROJECT_BLOCK_KIND_SET = new Set([...FIXED_PROJECT_BLOCK_KINDS, FLOW_GROUP_KIND]);
const TEXT_ALIGN_SET = new Set(['start', 'center', 'end', 'justify']);
const FORBIDDEN_FLOW_RUNTIME_KEYS = Object.freeze([
    'pages',
    'generatedPages',
    'fragments',
    'pagination',
    'paginationCache',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(issues, code, path, message, details = {}) {
    issues.push({ severity: 'error', code, path, message, ...details });
}

function prefixIssues(issues, prefix, nestedIssues) {
    for (const issue of nestedIssues || []) {
        const prefixed = {
            ...issue,
            path: issue.path ? `${prefix}.${issue.path}` : prefix,
        };
        if (typeof issue.firstPath === 'string') {
            prefixed.firstPath = issue.firstPath ? `${prefix}.${issue.firstPath}` : prefix;
        }
        issues.push(prefixed);
    }
}

function validateStrictId(value, path, issues) {
    if (typeof value !== 'string' || !value.trim()) {
        addIssue(issues, 'missing_id', path, 'ID must be a non-empty string.');
        return false;
    }
    if (value !== value.trim()) {
        addIssue(issues, 'invalid_id', path, 'IDs cannot have surrounding whitespace.');
        return false;
    }
    return true;
}

function validateFiniteNumber(value, path, issues, options = {}) {
    const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || (options.positive && value <= 0)) {
        addIssue(issues, 'invalid_layout_number', path, 'Layout value must be a finite number in the supported range.');
        return false;
    }
    return true;
}

function validateOptionalTypographyNumber(profile, key, path, issues, options = {}) {
    if (hasOwn(profile, key)) validateFiniteNumber(profile[key], `${path}.${key}`, issues, options);
}

/**
 * Create a complete FlowLayout v1 value. This is a factory for new content,
 * not a persisted-data repair function.
 */
export function createFlowLayoutSettings(options = {}) {
    if (!isRecord(options)) throw new TypeError('Flow layout options must be an object.');
    const source = deepClone(options);
    const sourceLanguage = typeof source.sourceLanguage === 'string' && source.sourceLanguage
        ? source.sourceLanguage
        : 'ja';
    const writingMode = source.writingMode === undefined
        ? DEFAULT_FLOW_WRITING_MODE
        : source.writingMode;
    const typographyByLanguage = source.typographyByLanguage === undefined
        ? {}
        : deepClone(source.typographyByLanguage);
    if (isRecord(typographyByLanguage)) {
        const sourceProfile = typographyByLanguage[sourceLanguage];
        typographyByLanguage[sourceLanguage] = isRecord(sourceProfile)
            ? { writingMode, ...sourceProfile }
            : { writingMode };
    }
    const padding = source.padding === undefined
        ? {
            top: DEFAULT_FLOW_PAGE_PADDING,
            right: DEFAULT_FLOW_PAGE_PADDING,
            bottom: DEFAULT_FLOW_PAGE_PADDING,
            left: DEFAULT_FLOW_PAGE_PADDING,
        }
        : deepClone(source.padding);

    delete source.sourceLanguage;
    delete source.writingMode;

    return {
        ...source,
        schemaVersion: FLOW_LAYOUT_SCHEMA_VERSION,
        pagePreset: source.pagePreset ?? FLOW_CANONICAL_PAGE_PRESET,
        padding,
        typographyByLanguage,
    };
}

/** Preserve a persisted layout exactly enough for validation and round trips. */
export function normalizeFlowLayoutSettings(input) {
    if (!isRecord(input)) throw new TypeError('Flow layout input must be an object.');
    return deepClone(input);
}

export function validateFlowLayoutSettings(layout) {
    const issues = [];
    if (!isRecord(layout)) {
        addIssue(issues, 'invalid_flow_layout', '', 'Flow layout must be an object.');
        return { valid: false, issues };
    }

    if (layout.schemaVersion !== FLOW_LAYOUT_SCHEMA_VERSION) {
        addIssue(issues, 'unsupported_flow_layout_schema_version', 'schemaVersion', 'Unsupported Flow layout schema version.', {
            supportedVersion: FLOW_LAYOUT_SCHEMA_VERSION,
        });
    }
    if (layout.pagePreset !== FLOW_CANONICAL_PAGE_PRESET) {
        addIssue(issues, 'unsupported_flow_page_preset', 'pagePreset', 'Flow layout must use the canonical DSF page preset.');
    }

    if (!isRecord(layout.padding)) {
        addIssue(issues, 'invalid_flow_padding', 'padding', 'Flow padding must be an object.');
    } else {
        const validTop = validateFiniteNumber(layout.padding.top, 'padding.top', issues, { minimum: 0 });
        const validRight = validateFiniteNumber(layout.padding.right, 'padding.right', issues, { minimum: 0 });
        const validBottom = validateFiniteNumber(layout.padding.bottom, 'padding.bottom', issues, { minimum: 0 });
        const validLeft = validateFiniteNumber(layout.padding.left, 'padding.left', issues, { minimum: 0 });
        if (validTop && validBottom && layout.padding.top + layout.padding.bottom >= CANONICAL_PAGE_HEIGHT) {
            addIssue(issues, 'invalid_flow_padding', 'padding', 'Vertical padding leaves no usable page area.');
        }
        if (validLeft && validRight && layout.padding.left + layout.padding.right >= CANONICAL_PAGE_WIDTH) {
            addIssue(issues, 'invalid_flow_padding', 'padding', 'Horizontal padding leaves no usable page area.');
        }
    }

    if (!isRecord(layout.typographyByLanguage)) {
        addIssue(issues, 'invalid_flow_typography_map', 'typographyByLanguage', 'Typography must be an exact-key language map.');
    } else {
        for (const [languageKey, profile] of Object.entries(layout.typographyByLanguage)) {
            const profilePath = `typographyByLanguage.${languageKey}`;
            if (!languageKey || languageKey !== languageKey.trim()) {
                addIssue(issues, 'invalid_language_key', profilePath, 'Language keys must be non-empty and cannot have surrounding whitespace.');
            }
            if (!isRecord(profile)) {
                addIssue(issues, 'invalid_flow_typography', profilePath, 'Typography profile must be an object.');
                continue;
            }
            if (typeof profile.writingMode !== 'string' || !isFlowWritingModeSupported(languageKey, profile.writingMode)) {
                addIssue(issues, 'unsupported_flow_writing_mode', `${profilePath}.writingMode`, 'Writing mode is unsupported for this language key.');
            }
            if (hasOwn(profile, 'fontFamily') && typeof profile.fontFamily !== 'string') {
                addIssue(issues, 'invalid_flow_typography', `${profilePath}.fontFamily`, 'fontFamily must be a string.');
            }
            if (
                hasOwn(profile, 'fontWeight')
                && (
                    !['string', 'number'].includes(typeof profile.fontWeight)
                    || (typeof profile.fontWeight === 'number' && !Number.isFinite(profile.fontWeight))
                )
            ) {
                addIssue(issues, 'invalid_flow_typography', `${profilePath}.fontWeight`, 'fontWeight must be a string or finite number.');
            }
            validateOptionalTypographyNumber(profile, 'fontSize', profilePath, issues, { positive: true });
            validateOptionalTypographyNumber(profile, 'lineHeight', profilePath, issues, { positive: true });
            validateOptionalTypographyNumber(profile, 'letterSpacing', profilePath, issues);
            validateOptionalTypographyNumber(profile, 'paragraphSpacing', profilePath, issues, { minimum: 0 });
            validateOptionalTypographyNumber(profile, 'headingSpacing', profilePath, issues, { minimum: 0 });
            if (hasOwn(profile, 'textAlign') && !TEXT_ALIGN_SET.has(profile.textAlign)) {
                addIssue(issues, 'invalid_flow_typography', `${profilePath}.textAlign`, 'textAlign is unsupported.');
            }
            if (hasOwn(profile, 'blockAlign') && !['start','center','end'].includes(profile.blockAlign)) {
                addIssue(issues, 'invalid_flow_typography', `${profilePath}.blockAlign`, 'blockAlign is unsupported.');
            }
            for (const colorKey of ['textColor', 'paperColor']) {
                if (hasOwn(profile, colorKey) && typeof profile[colorKey] !== 'string') {
                    addIssue(issues, 'invalid_flow_typography', `${profilePath}.${colorKey}`, `${colorKey} must be a string.`);
                }
            }
        }
    }

    return { valid: issues.length === 0, issues };
}

/** Create a new top-level Flow group for the Project v6 authoring spine. */
export function createFlowGroupBlock(options = {}) {
    if (!isRecord(options)) throw new TypeError('Flow group options must be an object.');
    if (options.document !== undefined && !isRecord(options.document)) {
        throw new TypeError('Flow group document options must be an object.');
    }
    if (options.layout !== undefined && !isRecord(options.layout)) {
        throw new TypeError('Flow group layout options must be an object.');
    }
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    if (
        typeof options.sourceLanguage === 'string'
        && typeof options.document?.sourceLanguage === 'string'
        && options.sourceLanguage !== options.document.sourceLanguage
    ) {
        throw new RangeError('Flow group sourceLanguage conflicts with document.sourceLanguage.');
    }
    const requestedSourceLanguage = options.document?.sourceLanguage ?? options.sourceLanguage;
    const sourceLanguage = typeof requestedSourceLanguage === 'string' && requestedSourceLanguage
        ? requestedSourceLanguage
        : 'ja';
    const document = options.document === undefined
        ? createFlowDocument({ sourceLanguage, idFactory })
        : createFlowDocument({
            ...deepClone(options.document),
            sourceLanguage: options.document.sourceLanguage ?? sourceLanguage,
            idFactory,
        });
    const layout = options.layout === undefined
        ? createFlowLayoutSettings({ sourceLanguage, writingMode: options.writingMode })
        : createFlowLayoutSettings({
            ...deepClone(options.layout),
            sourceLanguage,
            writingMode: options.writingMode ?? options.layout?.writingMode,
        });
    const extensions = isRecord(options.extensions) ? deepClone(options.extensions) : {};
    const flowExtensions = isRecord(options.flowExtensions) ? deepClone(options.flowExtensions) : {};

    return {
        ...extensions,
        id: options.id || idFactory('flow_group'),
        kind: FLOW_GROUP_KIND,
        flow: {
            ...flowExtensions,
            document,
            layout,
        },
    };
}

/**
 * Normalize a persisted Flow group without inventing missing source content.
 * Invalid and future values are retained so validation can stop safely.
 */
export function normalizeFlowGroupBlock(input) {
    if (!isRecord(input)) throw new TypeError('Flow group input must be an object.');
    const normalized = deepClone(input);
    if (isRecord(normalized.flow) && hasOwn(normalized.flow, 'translationState')) {
        normalized.flow.translationState = normalizeFlowTranslationState(normalized.flow.translationState);
    }
    return normalized;
}

function isKnownLocalizedMapPath(path) {
    return /^flow\.document\.sections\[\d+\]\.title$/.test(path)
        || /^flow\.document\.sections\[\d+\]\.blocks\[\d+\]\.texts$/.test(path);
}

function findForbiddenRuntimeKeys(value, path, issues) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findForbiddenRuntimeKeys(item, `${path}[${index}]`, issues));
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, nestedValue] of Object.entries(value)) {
        const nestedPath = path ? `${path}.${key}` : key;
        // translationState has its own validator. Treat its language/unit maps
        // as metadata maps so exact keys such as "pages" remain valid IDs.
        if (nestedPath === 'flow.translationState') continue;
        if (FORBIDDEN_FLOW_RUNTIME_KEYS.includes(key)) {
            addIssue(
                issues,
                'persisted_flow_runtime_data',
                nestedPath,
                'Generated Flow pages and pagination caches are runtime-only.',
            );
            continue;
        }
        // Known localized maps contain exact saved language keys, not structural keys.
        if (isKnownLocalizedMapPath(nestedPath)) continue;
        findForbiddenRuntimeKeys(nestedValue, nestedPath, issues);
    }
}

export function validateFlowGroupBlock(block) {
    const issues = [];
    if (!isRecord(block)) {
        addIssue(issues, 'invalid_flow_group', '', 'Flow group must be an object.');
        return { valid: false, issues };
    }
    validateStrictId(block.id, 'id', issues);
    if (block.kind !== FLOW_GROUP_KIND) {
        addIssue(issues, 'invalid_flow_group_kind', 'kind', 'Flow group kind must be "flow".');
    }
    findForbiddenRuntimeKeys(block, '', issues);

    if (!isRecord(block.flow)) {
        addIssue(issues, 'invalid_flow_group_payload', 'flow', 'Flow group payload must be an object.');
        return { valid: issues.length === 0, issues };
    }
    if (!isRecord(block.flow.document)) {
        addIssue(issues, 'invalid_flow_document', 'flow.document', 'Flow group must contain a FlowDocument.');
    } else {
        prefixIssues(issues, 'flow.document', validateFlowDocument(block.flow.document).issues);
    }

    if (!isRecord(block.flow.layout)) {
        addIssue(issues, 'invalid_flow_layout', 'flow.layout', 'Flow group must contain FlowLayout settings.');
    } else {
        prefixIssues(issues, 'flow.layout', validateFlowLayoutSettings(block.flow.layout).issues);
    }
    if (hasOwn(block.flow, 'translationState')) {
        prefixIssues(
            issues,
            'flow.translationState',
            validateFlowTranslationState(block.flow.translationState, block.flow.document).issues,
        );
    }

    const sourceLanguage = block.flow.document?.sourceLanguage;
    const typographyByLanguage = block.flow.layout?.typographyByLanguage;
    if (
        typeof sourceLanguage === 'string'
        && sourceLanguage.trim()
        && isRecord(typographyByLanguage)
        && !hasOwn(typographyByLanguage, sourceLanguage)
    ) {
        addIssue(
            issues,
            'missing_source_typography',
            `flow.layout.typographyByLanguage.${sourceLanguage}`,
            'Flow layout must contain an exact-key typography profile for the source language.',
        );
    }

    return { valid: issues.length === 0, issues };
}

/** Create a new Project v6 envelope without deriving pages or sections. */
export function createFlowProjectData(options = {}) {
    if (!isRecord(options)) throw new TypeError('Project options must be an object.');
    const source = deepClone(options);
    const blocks = Array.isArray(source.blocks)
        ? source.blocks.map((block) => (
            isRecord(block) && block.kind === FLOW_GROUP_KIND
                ? normalizeFlowGroupBlock(block)
                : deepClone(block)
        ))
        : [];
    return {
        ...source,
        version: PROJECT_SCHEMA_VERSION,
        blocks,
    };
}

/**
 * Normalize Project v5/v6 authoring data into the pure Project v6 envelope.
 * Fixed blocks and all unknown fields remain opaque and in their original order.
 */
export function normalizeFlowProjectData(input = {}) {
    if (!isRecord(input)) throw new TypeError('Project input must be an object.');
    const source = deepClone(input);
    const sourceHasFlow = hasFlowGroups(source);
    const isLegacyVersion = source.version === undefined
        || (Number.isInteger(source.version) && source.version >= 1 && source.version <= 5);
    let routedSource = source;
    if (isLegacyVersion && !sourceHasFlow && (!Array.isArray(source.blocks) || source.blocks.length === 0)) {
        routedSource = normalizeProjectDataV5(source);
    }
    let version = routedSource.version;
    if (isLegacyVersion && !sourceHasFlow) version = PROJECT_SCHEMA_VERSION;
    const blocks = Array.isArray(routedSource.blocks)
        ? routedSource.blocks.map((block) => (
            isRecord(block) && block.kind === FLOW_GROUP_KIND
                ? normalizeFlowGroupBlock(block)
                : deepClone(block)
        ))
        : routedSource.blocks;
    return {
        ...routedSource,
        version,
        blocks,
    };
}

export function hasFlowGroups(project) {
    return Array.isArray(project?.blocks)
        && project.blocks.some((block) => isRecord(block) && block.kind === FLOW_GROUP_KIND);
}

export function validateFlowProjectData(project) {
    const issues = [];
    if (!isRecord(project)) {
        addIssue(issues, 'invalid_project', '', 'Project must be an object.');
        return { valid: false, issues };
    }
    if (project.version !== PROJECT_SCHEMA_VERSION) {
        addIssue(issues, 'unsupported_project_schema_version', 'version', 'Unsupported Project schema version.', {
            supportedVersion: PROJECT_SCHEMA_VERSION,
        });
    }
    if (!Array.isArray(project.blocks)) {
        addIssue(issues, 'invalid_project_blocks', 'blocks', 'Project blocks must be an array.');
        return { valid: issues.length === 0, issues };
    }
    if (
        project.blocks.length === 0
        && (
            (Array.isArray(project.sections) && project.sections.length > 0)
            || (Array.isArray(project.pages) && project.pages.length > 0)
        )
    ) {
        addIssue(
            issues,
            'legacy_content_without_blocks',
            'blocks',
            'Project v6 cannot contain legacy page content without canonical authoring blocks.',
        );
    }

    const seenOuterIds = new Map();
    const seenFlowDocumentIds = new Map();
    project.blocks.forEach((block, blockIndex) => {
        const blockPath = `blocks[${blockIndex}]`;
        if (!isRecord(block)) {
            addIssue(issues, 'invalid_project_block', blockPath, 'Project block must be an object.');
            return;
        }
        const isFlowGroup = block.kind === FLOW_GROUP_KIND;
        const validOuterId = isFlowGroup
            ? typeof block.id === 'string' && !!block.id.trim() && block.id === block.id.trim()
            : validateStrictId(block.id, `${blockPath}.id`, issues);
        if (validOuterId) {
            if (seenOuterIds.has(block.id)) {
                addIssue(issues, 'duplicate_project_block_id', `${blockPath}.id`, 'Project block IDs must be unique.', {
                    firstPath: seenOuterIds.get(block.id),
                });
            } else {
                seenOuterIds.set(block.id, `${blockPath}.id`);
            }
        }

        if (!PROJECT_BLOCK_KIND_SET.has(block.kind)) {
            addIssue(issues, 'unsupported_project_block_kind', `${blockPath}.kind`, 'Unsupported project block kind.');
            return;
        }

        if (FIXED_PROJECT_BLOCK_KIND_SET.has(block.kind)) return;

        prefixIssues(issues, blockPath, validateFlowGroupBlock(block).issues);
        const documentId = block.flow?.document?.id;
        if (typeof documentId === 'string' && documentId.trim()) {
            if (seenFlowDocumentIds.has(documentId)) {
                addIssue(issues, 'duplicate_flow_document_id', `${blockPath}.flow.document.id`, 'Flow document IDs must be unique within a project.', {
                    firstPath: seenFlowDocumentIds.get(documentId),
                });
            } else {
                seenFlowDocumentIds.set(documentId, `${blockPath}.flow.document.id`);
            }
        }
    });

    return { valid: issues.length === 0, issues };
}

export class FlowProjectValidationError extends Error {
    constructor(issues) {
        const first = issues?.[0];
        super(first ? `Invalid Project v6 at ${first.path || '<root>'}: ${first.message}` : 'Invalid Project v6.');
        this.name = 'FlowProjectValidationError';
        this.code = 'FLOW_PROJECT_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export function assertValidFlowProjectData(project) {
    const result = validateFlowProjectData(project);
    if (!result.valid) throw new FlowProjectValidationError(result.issues);
    return project;
}

export function getFlowProjectModelVersions() {
    return Object.freeze({
        project: PROJECT_SCHEMA_VERSION,
        flowDocument: FLOW_DOCUMENT_SCHEMA_VERSION,
        flowLayout: FLOW_LAYOUT_SCHEMA_VERSION,
        flowTranslationState: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    });
}
