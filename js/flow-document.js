/**
 * Semantic authoring model for Flow Layout.
 *
 * This model is deliberately separate from the existing fixed-layout
 * `state.blocks` (`kind: 'page' | ...`). Flow blocks use `type`, and generated
 * pages must never be written back into this source document.
 */

import { validateFlowAnnotations } from './flow-annotations.js';
import { createId, deepClone } from './utils.js';

export const FLOW_DOCUMENT_SCHEMA_VERSION = 1;
export const FLOW_LAYOUT_TYPE = 'flow';
export const FLOW_BLOCK_TYPES = Object.freeze(['heading', 'paragraph', 'pageBreak']);

const FLOW_BLOCK_TYPE_SET = new Set(FLOW_BLOCK_TYPES);
const FLOW_TEXT_BLOCK_TYPE_SET = new Set(['heading', 'paragraph']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeId(value, prefix, idFactory) {
    if (value == null || value === '') return idFactory(prefix);
    return value;
}

function normalizeLocalizedTextMap(value) {
    if (value === undefined) return {};
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value));
}

function normalizeFlowBlock(block, idFactory) {
    const source = deepClone(block);
    const type = Object.prototype.hasOwnProperty.call(source, 'type') ? source.type : '';
    const typeForPrefix = typeof type === 'string' ? type : '';
    const prefix = FLOW_BLOCK_TYPE_SET.has(typeForPrefix)
        ? `flow_${typeForPrefix.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`
        : 'flow_block';
    const out = {
        ...source,
        id: normalizeId(source.id, prefix, idFactory),
        type,
    };

    if (FLOW_TEXT_BLOCK_TYPE_SET.has(type)) out.texts = normalizeLocalizedTextMap(source.texts);
    if (type === 'heading') {
        out.level = Object.prototype.hasOwnProperty.call(source, 'level') ? source.level : 1;
    }
    return out;
}

function normalizeFlowSection(section, idFactory) {
    const source = deepClone(section);
    const blocks = Array.isArray(source.blocks)
        ? source.blocks.map((block) => (isRecord(block) ? normalizeFlowBlock(block, idFactory) : deepClone(block)))
        : source.blocks === undefined ? [] : source.blocks;
    return {
        ...source,
        id: normalizeId(source.id, 'flow_section', idFactory),
        title: normalizeLocalizedTextMap(source.title),
        blocks,
    };
}

function createDefaultFlowSection(idFactory) {
    return normalizeFlowSection({
        title: {},
        blocks: [{ type: 'paragraph', texts: {} }],
    }, idFactory);
}

/**
 * Normalize a Flow document without mutating the input.
 *
 * Unknown keys and unknown block types are retained for forward-compatible
 * round trips. Validation will stop pagination of unsupported block types so
 * content is never silently omitted.
 */
export function normalizeFlowDocument(input = {}, options = {}) {
    if (!isRecord(input)) throw new TypeError('Flow document input must be an object.');
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    const source = deepClone(input);
    const schemaVersion = source.schemaVersion === undefined
        ? FLOW_DOCUMENT_SCHEMA_VERSION
        : source.schemaVersion;
    let sections;
    if (Array.isArray(source.sections)) {
        sections = source.sections.map((section) => (
            isRecord(section) ? normalizeFlowSection(section, idFactory) : deepClone(section)
        ));
    } else {
        sections = source.sections === undefined ? [createDefaultFlowSection(idFactory)] : source.sections;
    }

    return {
        ...source,
        schemaVersion,
        layoutType: source.layoutType === undefined ? FLOW_LAYOUT_TYPE : source.layoutType,
        id: normalizeId(source.id, 'flow_document', idFactory),
        sourceLanguage: source.sourceLanguage === undefined ? 'ja' : source.sourceLanguage,
        sections,
    };
}

export function createFlowDocument(options = {}) {
    const { idFactory, ...source } = options;
    return normalizeFlowDocument(source, { idFactory });
}

export function createFlowSection(options = {}) {
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    const { idFactory: _ignored, ...source } = options;
    const hasBlocks = Object.prototype.hasOwnProperty.call(source, 'blocks');
    if (!hasBlocks) source.blocks = [{ type: 'paragraph', texts: {} }];
    return normalizeFlowSection(source, idFactory);
}

export function createFlowHeading(options = {}) {
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    const { idFactory: _ignored, ...source } = options;
    return normalizeFlowBlock({ ...source, type: 'heading' }, idFactory);
}

export function createFlowParagraph(options = {}) {
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    const { idFactory: _ignored, ...source } = options;
    return normalizeFlowBlock({ ...source, type: 'paragraph' }, idFactory);
}

export function createFlowPageBreak(options = {}) {
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;
    const { idFactory: _ignored, ...source } = options;
    return normalizeFlowBlock({ ...source, type: 'pageBreak' }, idFactory);
}

export function isFlowTextBlock(block) {
    return FLOW_TEXT_BLOCK_TYPE_SET.has(block?.type);
}

/** Resolve an exact persisted language key. No BCP-47 canonicalization occurs. */
export function getFlowBlockText(block, languageKey) {
    if (!isFlowTextBlock(block)) return '';
    const key = String(languageKey || '');
    return Object.prototype.hasOwnProperty.call(block.texts || {}, key)
        && typeof block.texts[key] === 'string'
        ? block.texts[key]
        : '';
}

function addIssue(issues, code, path, message, details = {}) {
    issues.push({ severity: 'error', code, path, message, ...details });
}

function validateId(value, path, seenIds, issues) {
    if (typeof value !== 'string' || !value.trim()) {
        addIssue(issues, 'missing_id', path, 'ID must be a non-empty string.');
        return;
    }
    if (value !== value.trim()) {
        addIssue(issues, 'invalid_id', path, 'IDs cannot have surrounding whitespace.');
        return;
    }
    if (seenIds.has(value)) {
        addIssue(issues, 'duplicate_id', path, 'Flow document IDs must be unique.', {
            firstPath: seenIds.get(value),
        });
        return;
    }
    seenIds.set(value, path);
}

function validateLocalizedTextMap(value, path, issues) {
    if (!isRecord(value)) {
        addIssue(issues, 'invalid_localized_text', path, 'Localized text must be an object map.');
        return;
    }
    for (const [languageKey, text] of Object.entries(value)) {
        if (!languageKey) addIssue(issues, 'invalid_language_key', `${path}.`, 'Language keys cannot be empty.');
        if (typeof text !== 'string') {
            addIssue(issues, 'invalid_text', `${path}.${languageKey}`, 'Localized text values must be strings.');
        }
    }
}

/** Return structured issues without modifying or normalizing the input. */
export function validateFlowDocument(document) {
    const issues = [];
    if (!isRecord(document)) {
        addIssue(issues, 'invalid_document', '', 'Flow document must be an object.');
        return { valid: false, issues };
    }

    if (document.layoutType !== FLOW_LAYOUT_TYPE) {
        addIssue(issues, 'invalid_layout_type', 'layoutType', 'layoutType must be "flow".');
    }
    if (![1, 2, 3].includes(document.schemaVersion)) {
        addIssue(issues, 'unsupported_schema_version', 'schemaVersion', 'Unsupported Flow document schema version.', {
            supportedVersion: FLOW_DOCUMENT_SCHEMA_VERSION,
        });
    }
    if (typeof document.sourceLanguage !== 'string' || !document.sourceLanguage.trim()) {
        addIssue(issues, 'invalid_source_language', 'sourceLanguage', 'sourceLanguage must be a non-empty saved language key.');
    } else if (document.sourceLanguage !== document.sourceLanguage.trim()) {
        addIssue(issues, 'invalid_source_language', 'sourceLanguage', 'sourceLanguage cannot have surrounding whitespace.');
    }

    const seenIds = new Map();
    validateId(document.id, 'id', seenIds, issues);
    if (!Array.isArray(document.sections)) {
        addIssue(issues, 'invalid_sections', 'sections', 'sections must be an array.');
        return { valid: issues.length === 0, issues };
    }

    document.sections.forEach((section, sectionIndex) => {
        const sectionPath = `sections[${sectionIndex}]`;
        if (!isRecord(section)) {
            addIssue(issues, 'invalid_section', sectionPath, 'Section must be an object.');
            return;
        }
        validateId(section.id, `${sectionPath}.id`, seenIds, issues);
        validateLocalizedTextMap(section.title, `${sectionPath}.title`, issues);
        if (!Array.isArray(section.blocks)) {
            addIssue(issues, 'invalid_blocks', `${sectionPath}.blocks`, 'blocks must be an array.');
            return;
        }

        section.blocks.forEach((block, blockIndex) => {
            const blockPath = `${sectionPath}.blocks[${blockIndex}]`;
            if (!isRecord(block)) {
                addIssue(issues, 'invalid_block', blockPath, 'Block must be an object.');
                return;
            }
            validateId(block.id, `${blockPath}.id`, seenIds, issues);
            if (!FLOW_BLOCK_TYPE_SET.has(block.type)) {
                addIssue(issues, 'unsupported_block_type', `${blockPath}.type`, 'Unsupported Flow block type.');
                return;
            }
            if (block.titleRegion !== undefined) {
                const r=block.titleRegion;
                if(document.schemaVersion!==3 || !FLOW_TEXT_BLOCK_TYPE_SET.has(block.type) || !isRecord(r)
                    || typeof r.id!=='string' || !r.id.trim() || r.languageKey!==document.sourceLanguage
                    || !['start','center','end','justify'].includes(r.textAlign)
                    || !['start','center','end'].includes(r.blockAlign)) {
                    addIssue(issues,'invalid_title_region',blockPath,'Invalid title region.');
                }
            }
            if (block.annotations !== undefined) {
                if (![2,3].includes(document.schemaVersion)) addIssue(issues, 'annotation_version_required', blockPath, 'Annotations require FlowDocument v2.');
                try { validateFlowAnnotations(block); } catch { addIssue(issues, 'invalid_annotations', blockPath, 'Invalid text annotations.'); }
            }
            if (isFlowTextBlock(block)) validateLocalizedTextMap(block.texts, `${blockPath}.texts`, issues);
            if (block.type === 'heading' && (!Number.isInteger(block.level) || block.level < 1 || block.level > 6)) {
                addIssue(issues, 'invalid_heading_level', `${blockPath}.level`, 'Heading level must be an integer from 1 to 6.');
            }
        });
    });

    const regions=new Map(),closed=new Set();let currentRegion='';
    for(const section of document.sections) for(const block of (Array.isArray(section?.blocks) ? section.blocks : [])) {
        if(block?.type==='pageBreak')continue;
        const r=block?.titleRegion,id=typeof r?.id==='string'?r.id:'';
        if(id!==currentRegion) {if(currentRegion)closed.add(currentRegion);if(id && closed.has(id))addIssue(issues,'noncontiguous_title_region','sections','Title region must be contiguous.');currentRegion=id;}
        if(id) {
            const signature=JSON.stringify([r.languageKey,r.textAlign,r.blockAlign]);
            if(regions.has(id)&&regions.get(id)!==signature)addIssue(issues,'conflicting_title_region','sections','Title region settings must agree.');
            regions.set(id,signature);
        }
    }
    return { valid: issues.length === 0, issues };
}

export class FlowDocumentValidationError extends Error {
    constructor(issues) {
        const first = issues?.[0];
        super(first ? `Invalid Flow document at ${first.path || '<root>'}: ${first.message}` : 'Invalid Flow document.');
        this.name = 'FlowDocumentValidationError';
        this.code = 'FLOW_DOCUMENT_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export function assertValidFlowDocument(document) {
    const result = validateFlowDocument(document);
    if (!result.valid) throw new FlowDocumentValidationError(result.issues);
    return document;
}
