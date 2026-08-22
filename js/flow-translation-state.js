/**
 * Pure translation-freshness metadata for persisted Flow authoring groups.
 *
 * The semantic text remains in FlowDocument. This module stores only compact
 * source fingerprints and derives current/stale state without page data,
 * provider settings, runtime jobs, or application state.
 */

import { assertValidFlowDocument } from './flow-document.js';
import { deepClone } from './utils.js';

export const FLOW_TRANSLATION_STATE_SCHEMA_VERSION = 1;
export const FLOW_TRANSLATION_FINGERPRINT_PATTERN = /^u1[A-Za-z0-9_-]{11}$/;

const FLOW_TRANSLATION_ORIGINS = new Set(['manual', 'machine', 'mixed']);
const FLOW_TRANSLATION_REVIEW_STATES = new Set(['needs-review', 'reviewed']);
const TRANSLATION_RUNTIME_KEYS = new Set([
    'pages',
    'generatedPages',
    'fragments',
    'pagination',
    'paginationCache',
    'queued',
    'error',
    'cancelled',
    'progress',
    'job',
    'controller',
    'abortController',
]);
const TRANSLATION_PROVIDER_SETTING_KEYS = new Set([
    'providerId',
    'modelId',
    'baseUrl',
    'endpoint',
    'apiKey',
]);
const FNV_1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV_1A_64_PRIME = 0x100000001b3n;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const UTF8_ENCODER = new TextEncoder();

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isExactKey(value) {
    return typeof value === 'string' && !!value && value === value.trim();
}

function requireExactKey(value, label) {
    if (!isExactKey(value)) throw new TypeError(`${label} must be a non-empty exact saved key.`);
    return value;
}

function requireFlowGroup(group) {
    if (!isRecord(group) || group.kind !== 'flow' || !isRecord(group.flow?.document)) {
        throw new TypeError('Flow translation helpers require a Flow group.');
    }
    assertValidFlowDocument(group.flow.document);
    return group;
}

function getExactText(localizedMap, languageKey) {
    const present = isRecord(localizedMap)
        && hasOwn(localizedMap, languageKey)
        && typeof localizedMap[languageKey] === 'string';
    return Object.freeze({ present, text: present ? localizedMap[languageKey] : '' });
}

function fnv1a64(text) {
    let hash = FNV_1A_64_OFFSET;
    for (const byte of UTF8_ENCODER.encode(text)) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * FNV_1A_64_PRIME);
    }
    return hash;
}

function encodeBase64Url64(value) {
    const bytes = new Uint8Array(8);
    let remaining = value;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }

    let output = '';
    let buffer = 0;
    let bitCount = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bitCount += 8;
        while (bitCount >= 6) {
            bitCount -= 6;
            output += BASE64URL_ALPHABET[(buffer >> bitCount) & 0x3f];
            buffer = bitCount === 0 ? 0 : buffer & ((1 << bitCount) - 1);
        }
    }
    if (bitCount > 0) output += BASE64URL_ALPHABET[(buffer << (6 - bitCount)) & 0x3f];
    return output;
}

function fingerprintCanonicalValue(value) {
    return `u1${encodeBase64Url64(fnv1a64(JSON.stringify(value)))}`;
}

function getSourceText(localizedMap, sourceLanguage) {
    const value = getExactText(localizedMap, sourceLanguage);
    return { sourcePresent: value.present, sourceText: value.text };
}

/** Create one compact fingerprint for a Heading or Paragraph source string. */
export function createFlowBlockSourceFingerprint(sectionId, block, sourceLanguage) {
    const exactSectionId = requireExactKey(sectionId, 'Flow section ID');
    const languageKey = requireExactKey(sourceLanguage, 'Flow source language');
    if (!isRecord(block) || !['heading', 'paragraph'].includes(block.type)) {
        throw new TypeError('Only Flow Heading and Paragraph blocks can be fingerprinted.');
    }
    const blockId = requireExactKey(block.id, 'Flow block ID');
    const { sourcePresent, sourceText } = getSourceText(block.texts, languageKey);
    return fingerprintCanonicalValue([
        'flow-translation-unit-v1',
        'block',
        languageKey,
        exactSectionId,
        blockId,
        block.type,
        sourcePresent,
        sourceText,
    ]);
}

/** Create one compact fingerprint for a Section title source string. */
export function createFlowSectionTitleSourceFingerprint(section, sourceLanguage) {
    const languageKey = requireExactKey(sourceLanguage, 'Flow source language');
    if (!isRecord(section)) throw new TypeError('Flow section must be an object.');
    const sectionId = requireExactKey(section.id, 'Flow section ID');
    const { sourcePresent, sourceText } = getSourceText(section.title, languageKey);
    return fingerprintCanonicalValue([
        'flow-translation-unit-v1',
        'section-title',
        languageKey,
        sectionId,
        sourcePresent,
        sourceText,
    ]);
}

/**
 * Build current source fingerprints. PageBreak, typography, page data, block
 * order within a Section, and Heading level are intentionally excluded.
 */
export function buildFlowTranslationSourceFingerprints(group) {
    const source = requireFlowGroup(group);
    const document = source.flow.document;
    const sourceLanguage = document.sourceLanguage;
    const blockEntries = [];
    const sectionTitleEntries = [];

    for (const section of document.sections) {
        const sourceTitle = getExactText(section.title, sourceLanguage);
        if (sourceTitle.present) {
            sectionTitleEntries.push([
                section.id,
                createFlowSectionTitleSourceFingerprint(section, sourceLanguage),
            ]);
        }
        for (const block of section.blocks) {
            if (block.type !== 'heading' && block.type !== 'paragraph') continue;
            blockEntries.push([
                block.id,
                createFlowBlockSourceFingerprint(section.id, block, sourceLanguage),
            ]);
        }
    }

    const blocks = Object.fromEntries(blockEntries);
    const sectionTitles = Object.fromEntries(sectionTitleEntries);

    return Object.freeze({
        sourceLanguage,
        blocks: Object.freeze(blocks),
        sectionTitles: Object.freeze(sectionTitles),
    });
}

/** Preserve a persisted optional state without seeding or repairing it. */
export function normalizeFlowTranslationState(input) {
    if (input === undefined) return undefined;
    return deepClone(input);
}

function addIssue(issues, code, path, message, details = {}) {
    issues.push({ severity: 'error', code, path, message, ...details });
}

function validateFingerprintMap(value, path, issues, pageBreakIds) {
    if (!isRecord(value)) {
        addIssue(issues, 'invalid_flow_translation_fingerprint_map', path, 'Translation fingerprints must be an object map.');
        return;
    }
    for (const [unitId, fingerprint] of Object.entries(value)) {
        const unitPath = `${path}.${unitId}`;
        if (!isExactKey(unitId)) {
            addIssue(issues, 'invalid_flow_translation_unit_id', unitPath, 'Translation unit IDs must be non-empty exact IDs.');
        }
        if (pageBreakIds.has(unitId)) {
            addIssue(issues, 'unsupported_flow_translation_unit', unitPath, 'PageBreak cannot own translation metadata.');
        }
        if (typeof fingerprint !== 'string' || !FLOW_TRANSLATION_FINGERPRINT_PATTERN.test(fingerprint)) {
            addIssue(issues, 'invalid_flow_translation_fingerprint', unitPath, 'Unsupported Flow translation fingerprint.');
        }
    }
}

/** Validate optional Flow translation metadata without rejecting orphaned old IDs. */
export function validateFlowTranslationState(translationState, document) {
    const issues = [];
    if (translationState === undefined) return { valid: true, issues };
    if (!isRecord(translationState)) {
        addIssue(issues, 'invalid_flow_translation_state', '', 'Flow translationState must be an object.');
        return { valid: false, issues };
    }
    if (translationState.schemaVersion !== FLOW_TRANSLATION_STATE_SCHEMA_VERSION) {
        addIssue(
            issues,
            'unsupported_flow_translation_state_schema_version',
            'schemaVersion',
            'Unsupported Flow translationState schema version.',
            { supportedVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION },
        );
    }
    for (const key of Object.keys(translationState)) {
        if (TRANSLATION_RUNTIME_KEYS.has(key)) {
            addIssue(issues, 'persisted_flow_translation_runtime_data', key, 'Translation job state is runtime-only.');
        }
        if (TRANSLATION_PROVIDER_SETTING_KEYS.has(key)) {
            addIssue(issues, 'persisted_flow_translation_provider_setting', key, 'Translation provider settings must remain local to the device.');
        }
    }
    if (!isRecord(translationState.languages)) {
        addIssue(issues, 'invalid_flow_translation_languages', 'languages', 'Flow translation languages must be an exact-key map.');
        return { valid: issues.length === 0, issues };
    }

    const sourceLanguage = isRecord(document) && isExactKey(document.sourceLanguage)
        ? document.sourceLanguage
        : '';
    const pageBreakIds = new Set();
    if (Array.isArray(document?.sections)) {
        for (const section of document.sections) {
            if (!Array.isArray(section?.blocks)) continue;
            for (const block of section.blocks) {
                if (block?.type === 'pageBreak' && isExactKey(block.id)) pageBreakIds.add(block.id);
            }
        }
    }

    for (const [languageKey, languageState] of Object.entries(translationState.languages)) {
        const languagePath = `languages.${languageKey}`;
        if (!isExactKey(languageKey)) {
            addIssue(issues, 'invalid_language_key', languagePath, 'Translation language keys must be non-empty exact saved keys.');
        }
        if (sourceLanguage && languageKey === sourceLanguage) {
            addIssue(issues, 'source_language_translation_state', languagePath, 'The source language cannot own translation metadata.');
        }
        if (!isRecord(languageState)) {
            addIssue(issues, 'invalid_flow_translation_language_state', languagePath, 'Translation language state must be an object.');
            continue;
        }
        for (const key of Object.keys(languageState)) {
            const keyPath = `${languagePath}.${key}`;
            if (TRANSLATION_RUNTIME_KEYS.has(key)) {
                addIssue(issues, 'persisted_flow_translation_runtime_data', keyPath, 'Translation job state is runtime-only.');
            }
            if (TRANSLATION_PROVIDER_SETTING_KEYS.has(key)) {
                addIssue(issues, 'persisted_flow_translation_provider_setting', keyPath, 'Translation provider settings must remain local to the device.');
            }
        }
        if (!FLOW_TRANSLATION_ORIGINS.has(languageState.origin)) {
            addIssue(issues, 'invalid_flow_translation_origin', `${languagePath}.origin`, 'Unsupported translation origin.');
        }
        if (!FLOW_TRANSLATION_REVIEW_STATES.has(languageState.reviewState)) {
            addIssue(issues, 'invalid_flow_translation_review_state', `${languagePath}.reviewState`, 'Unsupported translation review state.');
        }
        if (!isRecord(languageState.sourceFingerprints)) {
            addIssue(
                issues,
                'invalid_flow_translation_fingerprints',
                `${languagePath}.sourceFingerprints`,
                'Translation sourceFingerprints must be an object.',
            );
        } else {
            validateFingerprintMap(
                languageState.sourceFingerprints.blocks,
                `${languagePath}.sourceFingerprints.blocks`,
                issues,
                pageBreakIds,
            );
            validateFingerprintMap(
                languageState.sourceFingerprints.sectionTitles,
                `${languagePath}.sourceFingerprints.sectionTitles`,
                issues,
                pageBreakIds,
            );
        }
        if (hasOwn(languageState, 'lockedUnitIds')) {
            if (!Array.isArray(languageState.lockedUnitIds)) {
                addIssue(issues, 'invalid_flow_translation_locked_units', `${languagePath}.lockedUnitIds`, 'lockedUnitIds must be an array.');
            } else {
                const seen = new Set();
                languageState.lockedUnitIds.forEach((unitId, index) => {
                    const unitPath = `${languagePath}.lockedUnitIds[${index}]`;
                    if (!isExactKey(unitId)) {
                        addIssue(issues, 'invalid_flow_translation_unit_id', unitPath, 'Locked unit IDs must be non-empty exact IDs.');
                    } else if (pageBreakIds.has(unitId)) {
                        addIssue(issues, 'unsupported_flow_translation_unit', unitPath, 'PageBreak cannot be locked as a translation unit.');
                    } else if (seen.has(unitId)) {
                        addIssue(issues, 'duplicate_flow_translation_unit_id', unitPath, 'Locked unit IDs must be unique.');
                    }
                    seen.add(unitId);
                });
            }
        }
    }

    return { valid: issues.length === 0, issues };
}

export class FlowTranslationStateValidationError extends Error {
    constructor(issues) {
        const first = issues?.[0];
        super(first
            ? `Invalid Flow translationState at ${first.path || '<root>'}: ${first.message}`
            : 'Invalid Flow translationState.');
        this.name = 'FlowTranslationStateValidationError';
        this.code = 'FLOW_TRANSLATION_STATE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export function assertValidFlowTranslationState(translationState, document) {
    const result = validateFlowTranslationState(translationState, document);
    if (!result.valid) throw new FlowTranslationStateValidationError(result.issues);
    return translationState;
}

function listTranslationUnits(document, type) {
    const sourceLanguage = document.sourceLanguage;
    const units = [];
    for (const section of document.sections) {
        if (type === 'sectionTitles') {
            const source = getExactText(section.title, sourceLanguage);
            if (!source.present) continue;
            units.push({
                id: section.id,
                targetMap: section.title,
                sourceFingerprint: createFlowSectionTitleSourceFingerprint(section, sourceLanguage),
            });
            continue;
        }
        for (const block of section.blocks) {
            if (block.type !== 'heading' && block.type !== 'paragraph') continue;
            units.push({
                id: block.id,
                targetMap: block.texts,
                sourceFingerprint: createFlowBlockSourceFingerprint(section.id, block, sourceLanguage),
            });
        }
    }
    return units;
}

/** Create one compact language baseline for target values that already exist. */
export function createFlowTranslationLanguageBaseline(group, languageKey, options = {}) {
    const source = requireFlowGroup(group);
    const targetLanguage = requireExactKey(languageKey, 'Flow target language');
    const sourceLanguage = source.flow.document.sourceLanguage;
    if (targetLanguage === sourceLanguage) throw new RangeError('The Flow source language cannot own a translation baseline.');
    if (!isRecord(options)) throw new TypeError('Flow translation baseline options must be an object.');

    const origin = options.origin ?? 'manual';
    const reviewState = options.reviewState ?? (origin === 'machine' ? 'needs-review' : 'reviewed');
    if (!FLOW_TRANSLATION_ORIGINS.has(origin)) throw new RangeError(`Unsupported translation origin: ${String(origin)}`);
    if (!FLOW_TRANSLATION_REVIEW_STATES.has(reviewState)) {
        throw new RangeError(`Unsupported translation review state: ${String(reviewState)}`);
    }

    const fingerprintEntries = { blocks: [], sectionTitles: [] };
    for (const mapName of ['blocks', 'sectionTitles']) {
        for (const unit of listTranslationUnits(source.flow.document, mapName)) {
            const target = getExactText(unit.targetMap, targetLanguage);
            if (!target.present) continue;
            fingerprintEntries[mapName].push([unit.id, unit.sourceFingerprint]);
        }
    }
    const fingerprints = {
        blocks: Object.fromEntries(fingerprintEntries.blocks),
        sectionTitles: Object.fromEntries(fingerprintEntries.sectionTitles),
    };

    if (hasOwn(options, 'lockedUnitIds') && !Array.isArray(options.lockedUnitIds)) {
        throw new TypeError('Flow translation lockedUnitIds must be an array when provided.');
    }
    const requestedLockedIds = hasOwn(options, 'lockedUnitIds')
        ? deepClone(options.lockedUnitIds)
        : [];
    const baseline = {
        sourceFingerprints: fingerprints,
        reviewState,
        origin,
        ...(requestedLockedIds.length ? { lockedUnitIds: requestedLockedIds } : {}),
    };
    assertValidFlowTranslationState({
        schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
        languages: { [targetLanguage]: baseline },
    }, source.flow.document);
    return deepClone(baseline);
}

function deriveUnitCollection(units, languageKey, storedFingerprints, lockedUnitIds, origin) {
    const ids = { missing: [], current: [], stale: [], untracked: [], locked: [] };
    const explicitLocks = new Set(Array.isArray(lockedUnitIds) ? lockedUnitIds : []);

    for (const unit of units) {
        const target = getExactText(unit.targetMap, languageKey);
        const stored = isRecord(storedFingerprints) && hasOwn(storedFingerprints, unit.id)
            ? storedFingerprints[unit.id]
            : undefined;
        let status;
        if (!target.present) status = 'missing';
        else if (typeof stored !== 'string') status = 'untracked';
        else if (stored !== unit.sourceFingerprint) status = 'stale';
        else status = 'current';
        ids[status].push(unit.id);

        const locked = status === 'untracked'
            || (origin === 'manual' && typeof stored === 'string')
            || explicitLocks.has(unit.id);
        if (locked) ids.locked.push(unit.id);
    }

    const total = units.length;
    const counts = Object.freeze({
        total,
        present: total - ids.missing.length,
        missing: ids.missing.length,
        current: ids.current.length,
        stale: ids.stale.length,
        untracked: ids.untracked.length,
        locked: ids.locked.length,
    });
    return Object.freeze({
        counts,
        ids: Object.freeze(Object.fromEntries(
            Object.entries(ids).map(([key, values]) => [key, Object.freeze(values)]),
        )),
    });
}

function getPrimaryStatus(body, outline, reviewState) {
    const total = body.counts.total + outline.counts.total;
    const missing = body.counts.missing + outline.counts.missing;
    const stale = body.counts.stale + outline.counts.stale;
    const untracked = body.counts.untracked + outline.counts.untracked;
    if (total === 0) return 'empty';
    if (missing === total) return 'missing';
    if (missing > 0) return 'partial';
    if (stale > 0) return 'stale';
    if (untracked > 0) return 'untracked';
    return reviewState === 'needs-review' ? 'needs-review' : 'reviewed';
}

/**
 * Derive target freshness. Existing metadata-free 8B-1 text is untracked and
 * protected, while missing or stale tracked body text requires source fallback.
 */
export function deriveFlowTranslationStatus(group, languageKey) {
    const source = requireFlowGroup(group);
    const targetLanguage = requireExactKey(languageKey, 'Flow translation language');
    const document = source.flow.document;
    const sourceLanguage = document.sourceLanguage;
    const bodyUnits = listTranslationUnits(document, 'blocks');
    const outlineUnits = listTranslationUnits(document, 'sectionTitles');

    if (targetLanguage === sourceLanguage) {
        const bodyFingerprints = Object.fromEntries(bodyUnits.map((unit) => [unit.id, unit.sourceFingerprint]));
        const outlineFingerprints = Object.fromEntries(outlineUnits.map((unit) => [unit.id, unit.sourceFingerprint]));
        const body = deriveUnitCollection(bodyUnits, sourceLanguage, bodyFingerprints, [], 'machine');
        const outline = deriveUnitCollection(outlineUnits, sourceLanguage, outlineFingerprints, [], 'machine');
        return Object.freeze({
            languageKey: sourceLanguage,
            sourceLanguage,
            isSourceLanguage: true,
            status: 'source',
            contentReady: body.counts.missing === 0,
            requiresSourceFallback: false,
            hasOutlineIssues: false,
            body,
            outline,
            reviewState: null,
            origin: null,
        });
    }

    const translationState = source.flow.translationState;
    assertValidFlowTranslationState(translationState, document);
    const languageState = isRecord(translationState?.languages)
        && hasOwn(translationState.languages, targetLanguage)
        && isRecord(translationState.languages[targetLanguage])
        ? translationState.languages[targetLanguage]
        : null;
    const body = deriveUnitCollection(
        bodyUnits,
        targetLanguage,
        languageState?.sourceFingerprints?.blocks,
        languageState?.lockedUnitIds,
        languageState?.origin,
    );
    const outline = deriveUnitCollection(
        outlineUnits,
        targetLanguage,
        languageState?.sourceFingerprints?.sectionTitles,
        languageState?.lockedUnitIds,
        languageState?.origin,
    );
    const status = getPrimaryStatus(body, outline, languageState?.reviewState);

    return Object.freeze({
        languageKey: targetLanguage,
        sourceLanguage,
        isSourceLanguage: false,
        status,
        contentReady: body.counts.missing === 0,
        requiresSourceFallback: body.counts.missing > 0 || body.counts.stale > 0,
        hasOutlineIssues: outline.counts.missing > 0
            || outline.counts.stale > 0
            || outline.counts.untracked > 0,
        body,
        outline,
        reviewState: languageState?.reviewState ?? null,
        origin: languageState?.origin ?? null,
    });
}
