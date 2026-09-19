import { validateGraphicObjects } from './graphic-object-model.js';
import { validateProjectAssets } from './project-assets.js';
/**
 * Project persistence boundary for legacy Fixed projects and Project v6 Flow.
 *
 * FlowDocument is the only persisted Flow source. Generated pages, fragments,
 * pagination checkpoints, and caches are rejected by the Project v6 validator.
 * This module never paginates and never writes to application state.
 */

import {
    createSectionFromPageBlock,
    syncBlocksWithSections,
} from './blocks.js';
import {
    PAGE_SCHEMA_VERSION,
    blocksToPages,
    normalizeProjectDataV5,
} from './pages.js';
import {
    PROJECT_SCHEMA_VERSION,
    assertValidFlowProjectData,
    hasFlowGroups,
    normalizeFlowProjectData,
} from './flow-project-model.js';
import { deepClone } from './utils.js';

export const DSP_FLOW_META_SCHEMA_VERSION = 2;
export const FIRESTORE_AUTHORING_MAX_BYTES = 850 * 1024;

const FORBIDDEN_PROJECT_RUNTIME_KEYS = Object.freeze([
    'generatedPages',
    'flowGeneratedPages',
    'fragments',
    'pagination',
    'paginationCache',
]);
const FIXED_TEXT_PAPER_PRESETS = Object.freeze({
    white: Object.freeze({ backgroundColor: '#ffffff', textColor: '#000000' }),
    book: Object.freeze({ backgroundColor: '#f7f1df', textColor: '#1f1b16' }),
});

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class ProjectPersistenceError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ProjectPersistenceError';
        this.code = code;
        Object.assign(this, details);
    }
}

function persistenceError(code, message, details = {}) {
    return new ProjectPersistenceError(code, message, details);
}

function assertSupportedPersistedVersion(input) {
    const version = input?.version;
    if (version === undefined || version === null) return;
    if (!Number.isInteger(version) || version < 1 || version > PROJECT_SCHEMA_VERSION) {
        throw persistenceError(
            'UNSUPPORTED_PROJECT_VERSION',
            `Unsupported project version: ${String(version)}`,
            { version, supportedVersion: PROJECT_SCHEMA_VERSION },
        );
    }
}

function assertJsonSafeValue(value, path, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw persistenceError('PROJECT_NOT_JSON_SAFE', `Non-finite number at ${path}.`, { path });
        }
        return;
    }
    if (typeof value !== 'object') {
        throw persistenceError('PROJECT_NOT_JSON_SAFE', `Unsupported JSON value at ${path}.`, { path });
    }
    if (ancestors.has(value)) {
        throw persistenceError('PROJECT_NOT_JSON_SAFE', `Circular reference at ${path}.`, { path });
    }

    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw persistenceError('PROJECT_NOT_JSON_SAFE', `Non-plain object at ${path}.`, { path });
    }

    ancestors.add(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                throw persistenceError('PROJECT_NOT_JSON_SAFE', `Sparse array entry at ${path}[${index}].`, {
                    path: `${path}[${index}]`,
                });
            }
            assertJsonSafeValue(value[index], `${path}[${index}]`, ancestors);
        }
    } else {
        for (const [key, entry] of Object.entries(value)) {
            assertJsonSafeValue(entry, path ? `${path}.${key}` : key, ancestors);
        }
    }
    ancestors.delete(value);
}

export function assertProjectJsonSafe(project) {
    assertJsonSafeValue(project, '<root>', new WeakSet());
    return project;
}

function assertNoProjectRuntimeData(project) {
    for (const key of FORBIDDEN_PROJECT_RUNTIME_KEYS) {
        if (Object.prototype.hasOwnProperty.call(project, key)) {
            throw persistenceError(
                'PERSISTED_PROJECT_RUNTIME_DATA',
                `Runtime-only Project field cannot be persisted: ${key}`,
                { path: key },
            );
        }
    }
}

function getFixedTextPaperPresetKey(project) {
    if (FIXED_TEXT_PAPER_PRESETS[project?.textPaperPreset]) return project.textPaperPreset;
    const textSection = (project?.sections || []).find((section) => section?.type === 'text');
    if (FIXED_TEXT_PAPER_PRESETS[textSection?.paperPreset]) return textSection.paperPreset;
    const backgroundColor = String(textSection?.backgroundColor || '').toLowerCase();
    const textColor = String(textSection?.textColor || '').toLowerCase();
    const match = Object.entries(FIXED_TEXT_PAPER_PRESETS).find(([, preset]) => (
        preset.backgroundColor.toLowerCase() === backgroundColor
        && preset.textColor.toLowerCase() === textColor
    ));
    return match?.[0] || 'white';
}

function applyPersistedProjectRuntimeMigrations(project) {
    const migrated = deepClone(project);
    const languages = Array.isArray(migrated.languages) && migrated.languages.length
        ? migrated.languages
        : ['ja'];
    const languageConfigs = isRecord(migrated.languageConfigs)
        ? deepClone(migrated.languageConfigs)
        : {};
    for (const language of languages) {
        const existing = isRecord(languageConfigs[language]) ? languageConfigs[language] : {};
        if (!existing.pageDirection) {
            existing.pageDirection = existing.writingMode === 'vertical-rl'
                ? 'rtl'
                : (existing.writingMode === 'horizontal-tb' ? 'ltr' : (language === 'ja' ? 'rtl' : 'ltr'));
        }
        languageConfigs[language] = existing;
    }

    const textPaperPreset = getFixedTextPaperPresetKey(migrated);
    const paperStyle = FIXED_TEXT_PAPER_PRESETS[textPaperPreset];
    const sections = (migrated.sections || []).map((section) => (
        section?.type === 'text'
            ? { ...section, paperPreset: textPaperPreset, ...paperStyle }
            : section
    ));
    const blocks = (migrated.blocks || []).map((block) => (
        block?.kind === 'page' && block.content?.pageKind === 'text'
            ? {
                ...block,
                content: {
                    ...block.content,
                    paperPreset: textPaperPreset,
                    ...paperStyle,
                },
            }
            : block
    ));
    const compatibility = deriveFixedCompatibility(blocks);
    return {
        ...migrated,
        textPaperPreset,
        languageConfigs,
        blocks,
        sections,
        pages: compatibility.pages,
    };
}

/**
 * Reconcile the legacy Section editing surface back into Fixed page blocks.
 * Mixed/Project v6 content requires an exact ordinal match because guessing an
 * insertion point across a Flow group could silently reorder the work.
 */
export function reconcileFixedSectionsPreservingExtensions(blocks, sections, options = {}) {
    if (!Array.isArray(blocks)) {
        throw persistenceError('INVALID_PROJECT_BLOCKS', 'Project blocks must be an array.');
    }
    if (!Array.isArray(sections)) {
        throw persistenceError('INVALID_PROJECT_SECTIONS', 'Project sections must be an array.');
    }

    const strictSpine = options.strictSpine === true || hasFlowGroups({ blocks });
    try {
        return syncBlocksWithSections(blocks, sections, ['ja'], { strictSpine });
    } catch (error) {
        if (error?.code === 'MIXED_SPINE_FIXED_PAGE_COUNT_MISMATCH') {
            throw persistenceError(error.code, error.message, {
                fixedPageCount: error.fixedPageCount,
                sectionCount: error.sectionCount,
            });
        }
        throw error;
    }
}

/** Derive only Fixed compatibility surfaces. A Flow-only project stays empty. */
export function deriveFixedCompatibility(blocks) {
    const sourceBlocks = Array.isArray(blocks) ? deepClone(blocks) : [];
    const fixedPageBlocks = sourceBlocks.filter((block) => block?.kind === 'page');
    return {
        sections: fixedPageBlocks.map(createSectionFromPageBlock),
        pages: blocksToPages(sourceBlocks),
    };
}

/**
 * Normalize a persisted ingress before it can mutate state.
 * Legacy Fixed projects remain v5. Project v6 is strict and never falls back.
 */
export function hydrateProjectFromPersistence(input) {
    if (!isRecord(input)) throw new TypeError('Persisted project must be an object.');
    assertProjectJsonSafe(input);
    assertNoProjectRuntimeData(input);
    assertSupportedPersistedVersion(input);
    validateProjectAssets(input.projectAssets);
    validateGraphicObjects(input);
    if (input.projectAssets?.length && input.version !== PROJECT_SCHEMA_VERSION) {
        input = normalizeFlowProjectData(input);
    }

    const containsFlow = hasFlowGroups(input);
    if (input.version === PROJECT_SCHEMA_VERSION) {
        const normalized = normalizeFlowProjectData(input);
        assertValidFlowProjectData(normalized);
        const compatibility = deriveFixedCompatibility(normalized.blocks);
        return applyPersistedProjectRuntimeMigrations({
            ...normalized,
            sections: compatibility.sections,
            pages: compatibility.pages,
        });
    }

    if (containsFlow) {
        const normalized = normalizeFlowProjectData(input);
        assertValidFlowProjectData(normalized);
    }

    const normalizedLegacy = normalizeProjectDataV5(input);
    if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
        return applyPersistedProjectRuntimeMigrations(normalizedLegacy);
    }

    // The v5 adapter predates opaque Fixed extensions and rebuilds blocks from
    // a whitelist. Keep the original canonical blocks when they exist, while
    // still taking its language/default migrations and derived fallbacks.
    const blocks = reconcileFixedSectionsPreservingExtensions(
        deepClone(input.blocks),
        deepClone(normalizedLegacy.sections),
    );
    const compatibility = deriveFixedCompatibility(blocks);
    return applyPersistedProjectRuntimeMigrations({
        ...normalizedLegacy,
        ...deepClone(input),
        version: PAGE_SCHEMA_VERSION,
        languages: normalizedLegacy.languages,
        defaultLang: normalizedLegacy.defaultLang,
        blocks,
        sections: compatibility.sections,
        pages: compatibility.pages,
    });
}

/** Build the canonical snapshot used by local, DSP, and cloud persistence. */
export function prepareProjectForSave(input) {
    if (!isRecord(input)) throw new TypeError('Project snapshot input must be an object.');
    assertProjectJsonSafe(input);
    assertNoProjectRuntimeData(input);
    assertSupportedPersistedVersion(input);
    validateProjectAssets(input.projectAssets);
    validateGraphicObjects(input);
    if (input.projectAssets?.length && input.version !== PROJECT_SCHEMA_VERSION) {
        input = normalizeFlowProjectData(input);
    }

    const containsFlow = hasFlowGroups(input);
    const isProjectV6 = input.version === PROJECT_SCHEMA_VERSION;
    if (containsFlow && !isProjectV6) {
        throw persistenceError(
            'FLOW_REQUIRES_PROJECT_V6',
            'A project containing Flow groups must explicitly use Project version 6.',
        );
    }

    if (isProjectV6) {
        const normalizedInput = normalizeFlowProjectData(input);
        assertValidFlowProjectData(normalizedInput);
    }

    const version = isProjectV6 ? PROJECT_SCHEMA_VERSION : PAGE_SCHEMA_VERSION;
    const inputBlocks = Array.isArray(input.blocks) ? input.blocks : [];
    const existingCompatibility = deriveFixedCompatibility(inputBlocks);
    const hasSections = Object.prototype.hasOwnProperty.call(input, 'sections')
        && Array.isArray(input.sections)
        && (isProjectV6 || input.sections.length > 0 || existingCompatibility.sections.length === 0);
    const sectionsForReconciliation = hasSections
        ? input.sections
        : existingCompatibility.sections;
    const reconciledBlocks = reconcileFixedSectionsPreservingExtensions(
        inputBlocks,
        sectionsForReconciliation,
        { strictSpine: isProjectV6 },
    );
    const compatibility = deriveFixedCompatibility(reconciledBlocks);
    const snapshot = {
        ...deepClone(input),
        version,
        blocks: reconciledBlocks,
        sections: deepClone(sectionsForReconciliation),
        pages: compatibility.pages,
    };

    if (isProjectV6) {
        const normalized = normalizeFlowProjectData(snapshot);
        assertValidFlowProjectData(normalized);
        assertProjectJsonSafe(normalized);
        validateGraphicObjects(normalized);
        return normalized;
    }

    assertProjectJsonSafe(snapshot);
    validateGraphicObjects(snapshot);
    return snapshot;
}

export function serializeProject(project, options = {}) {
    const snapshot = prepareProjectForSave(project);
    try {
        return JSON.stringify(snapshot, null, options.pretty ? 2 : 0);
    } catch (error) {
        throw persistenceError('PROJECT_SERIALIZATION_FAILED', 'Project serialization failed.', { cause: error });
    }
}

export function deserializeProject(json) {
    if (typeof json !== 'string') throw new TypeError('Serialized project must be a string.');
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw persistenceError('PROJECT_PARSE_FAILED', 'Project JSON could not be parsed.', { cause: error });
    }
    return hydrateProjectFromPersistence(parsed);
}

/** Apply metadata that legacy DSP v1 stored outside project.json. */
export function applyDspMetadataFallbacks(projectData, meta = {}) {
    if (!isRecord(projectData)) throw new TypeError('DSP project data must be an object.');
    return {
        ...deepClone(projectData),
        languages: Array.isArray(projectData.languages) && projectData.languages.length
            ? deepClone(projectData.languages)
            : deepClone(meta.languages),
        defaultLang: projectData.defaultLang
            || meta.defaultLang
            || meta.languages?.[0],
    };
}

/** Remove Firestore operational values before the JSON authoring validator. */
export function prepareFirestoreProjectIngress(project) {
    if (!isRecord(project)) throw new TypeError('Firestore project data must be an object.');
    const out = { ...project };
    for (const key of ['lastUpdated', 'updatedAt', 'createdAt', 'dsfPublishedAt', 'publication']) {
        delete out[key];
    }
    const plainify = (value) => {
        if (Array.isArray(value)) return value.map(plainify);
        if (!value || typeof value !== 'object') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value.toDate === 'function') {
            const date = value.toDate();
            if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
        }
        if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
            return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plainify(entry)]));
        }
        return value;
    };
    return plainify(out);
}

export function assertSupportedDspEnvelope(meta, projectVersion) {
    if (!isRecord(meta) || meta.format !== 'dsp') {
        throw persistenceError('INVALID_DSP_METADATA', 'Invalid DSP metadata.');
    }
    const schemaVersion = meta.schemaVersion ?? 1;
    if (![1, DSP_FLOW_META_SCHEMA_VERSION].includes(schemaVersion)) {
        throw persistenceError(
            'UNSUPPORTED_DSP_SCHEMA_VERSION',
            `Unsupported DSP schemaVersion: ${String(schemaVersion)}`,
            { schemaVersion },
        );
    }
    if (projectVersion === PROJECT_SCHEMA_VERSION && schemaVersion !== DSP_FLOW_META_SCHEMA_VERSION) {
        throw persistenceError('DSP_V2_REQUIRED', 'Project v6 requires DSP meta schemaVersion 2.');
    }
    if (schemaVersion === DSP_FLOW_META_SCHEMA_VERSION && projectVersion !== PROJECT_SCHEMA_VERSION) {
        throw persistenceError('DSP_PROJECT_VERSION_MISMATCH', 'DSP meta schemaVersion 2 requires Project v6.');
    }
    if (schemaVersion === DSP_FLOW_META_SCHEMA_VERSION && meta.projectVersion !== projectVersion) {
        throw persistenceError(
            'DSP_PROJECT_VERSION_MISMATCH',
            'DSP meta projectVersion must match project.json version.',
            { metaProjectVersion: meta.projectVersion, projectVersion },
        );
    }
    return schemaVersion;
}

/** Remove private Flow source from the publicly readable project root. */
export function createPublicProjectProjection(project) {
    const snapshot = prepareProjectForSave(project);
    if (snapshot.version !== PROJECT_SCHEMA_VERSION) return snapshot;
    const publicKeys = [
        'version',
        'projectId',
        'workId',
        'releaseId',
        'projectName',
        'title',
        'labelName',
        'rating',
        'license',
        'textPaperPreset',
        'meta',
        'languages',
        'defaultLang',
        'languageConfigs',
        'bookMode',
        'book',
        'sections',
        'pages',
    ];
    const projection = {};
    for (const key of publicKeys) {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) projection[key] = deepClone(snapshot[key]);
    }
    return {
        ...projection,
        blocks: snapshot.blocks
            .filter((block) => block?.kind !== 'flow')
            .map((block) => deepClone(block)),
        authoringRef: 'authoring/current',
        authoringSchemaVersion: PROJECT_SCHEMA_VERSION,
    };
}

export function measureUtf8JsonBytes(value) {
    let json;
    try {
        json = typeof value === 'string' ? value : JSON.stringify(value);
    } catch (error) {
        throw persistenceError('PROJECT_SERIALIZATION_FAILED', 'Project size could not be measured.', { cause: error });
    }
    if (typeof json !== 'string') {
        throw persistenceError('PROJECT_SERIALIZATION_FAILED', 'Project size could not be measured.');
    }
    return new TextEncoder().encode(json).byteLength;
}

export function assertFirestoreAuthoringSize(payload, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes)
        ? Math.max(1, Math.floor(options.maxBytes))
        : FIRESTORE_AUTHORING_MAX_BYTES;
    const actualBytes = measureUtf8JsonBytes(payload);
    if (actualBytes > maxBytes) {
        throw persistenceError(
            'FIRESTORE_AUTHORING_TOO_LARGE',
            `Authoring data is too large for one Firestore document (${actualBytes} bytes; safe limit ${maxBytes} bytes).`,
            { actualBytes, maxBytes },
        );
    }
    return actualBytes;
}

/** Pure mirror of the Firestore schema downgrade guard. */
export function isProjectVersionTransitionAllowed(previousVersion, nextVersion) {
    if (!Number.isInteger(nextVersion) || nextVersion < 1) return false;
    if (!Number.isInteger(previousVersion)) return true;
    return nextVersion >= previousVersion;
}
