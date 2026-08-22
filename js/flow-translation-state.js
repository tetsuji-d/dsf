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

const FLOW_TRANSLATION_UNIT_MAPS = new Set(['blocks', 'sectionTitles']);

function replaceExactMapEntry(value, key, entryValue) {
    const entries = isRecord(value)
        ? Object.entries(value).filter(([entryKey]) => entryKey !== key)
        : [];
    entries.push([key, entryValue]);
    return Object.fromEntries(entries);
}

function appendUniqueExactId(value, unitId) {
    const ids = Array.isArray(value) ? [...value] : [];
    if (!ids.includes(unitId)) ids.push(unitId);
    return ids;
}

function resolveFlowTranslationUnit(group, unitMap, unitId) {
    const source = requireFlowGroup(group);
    if (!FLOW_TRANSLATION_UNIT_MAPS.has(unitMap)) {
        throw new RangeError(`Unsupported Flow translation unit map: ${String(unitMap)}`);
    }
    const exactUnitId = requireExactKey(unitId, 'Flow translation unit ID');
    const document = source.flow.document;
    const sourceLanguage = document.sourceLanguage;

    if (unitMap === 'sectionTitles') {
        const section = document.sections.find((entry) => entry?.id === exactUnitId);
        if (!section) throw new RangeError(`Flow Section title not found: ${exactUnitId}`);
        const sourceTitle = getExactText(section.title, sourceLanguage);
        return Object.freeze({
            unitMap,
            unitId: exactUnitId,
            targetMap: section.title,
            trackable: sourceTitle.present,
            sourceFingerprint: sourceTitle.present
                ? createFlowSectionTitleSourceFingerprint(section, sourceLanguage)
                : '',
        });
    }

    for (const section of document.sections) {
        const block = section.blocks.find((entry) => entry?.id === exactUnitId);
        if (!block) continue;
        if (block.type !== 'heading' && block.type !== 'paragraph') {
            throw new TypeError('Only Flow Heading and Paragraph blocks are translation units.');
        }
        return Object.freeze({
            unitMap,
            unitId: exactUnitId,
            targetMap: block.texts,
            trackable: true,
            sourceFingerprint: createFlowBlockSourceFingerprint(section.id, block, sourceLanguage),
        });
    }
    throw new RangeError(`Flow translation Block not found: ${exactUnitId}`);
}

function getValidatedTranslationState(group) {
    const state = group.flow.translationState;
    assertValidFlowTranslationState(state, group.flow.document);
    return state;
}

function createMutableTranslationState(group) {
    const existing = getValidatedTranslationState(group);
    return existing === undefined
        ? { schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION, languages: {} }
        : deepClone(existing);
}

function getTranslationLanguageState(state, languageKey) {
    return isRecord(state?.languages)
        && hasOwn(state.languages, languageKey)
        && isRecord(state.languages[languageKey])
        ? state.languages[languageKey]
        : null;
}

function createManualLanguageState() {
    return {
        sourceFingerprints: { blocks: {}, sectionTitles: {} },
        reviewState: 'reviewed',
        origin: 'manual',
    };
}

function upsertTranslationLanguageState(state, languageKey, languageState) {
    state.languages = replaceExactMapEntry(state.languages, languageKey, languageState);
}

function setLanguageUnitFingerprint(languageState, unit, options = {}) {
    const next = deepClone(languageState || createManualLanguageState());
    const fingerprints = isRecord(next.sourceFingerprints)
        ? deepClone(next.sourceFingerprints)
        : { blocks: {}, sectionTitles: {} };
    fingerprints.blocks = isRecord(fingerprints.blocks) ? fingerprints.blocks : {};
    fingerprints.sectionTitles = isRecord(fingerprints.sectionTitles) ? fingerprints.sectionTitles : {};
    fingerprints[unit.unitMap] = replaceExactMapEntry(
        fingerprints[unit.unitMap],
        unit.unitId,
        unit.sourceFingerprint,
    );
    next.sourceFingerprints = fingerprints;

    if (next.origin === 'machine') next.origin = 'mixed';
    if (next.origin === 'mixed') {
        next.lockedUnitIds = appendUniqueExactId(next.lockedUnitIds, unit.unitId);
    }
    if (options.reviewState) next.reviewState = options.reviewState;
    return next;
}

function createTranslationStateMutationResult(group, nextState) {
    const previous = group.flow.translationState;
    assertValidFlowTranslationState(nextState, group.flow.document);
    const changed = JSON.stringify(previous) !== JSON.stringify(nextState);
    return Object.freeze({
        changed,
        translationState: changed ? nextState : previous,
    });
}

/**
 * Capture only previously untracked target values immediately before editing
 * their source unit. Existing fingerprints never move, so repeated source
 * keystrokes remain stale against the first pre-edit source.
 */
export function captureFlowTranslationUnitBeforeSourceEdit(group, options = {}) {
    const source = requireFlowGroup(group);
    if (!isRecord(options)) throw new TypeError('Flow translation capture options must be an object.');
    const unit = resolveFlowTranslationUnit(source, options.unitMap, options.unitId);
    const previous = getValidatedTranslationState(source);
    if (!unit.trackable || !isRecord(unit.targetMap)) {
        return Object.freeze({ changed: false, translationState: previous });
    }

    const sourceLanguage = source.flow.document.sourceLanguage;
    const targetLanguages = Object.entries(unit.targetMap)
        .filter(([languageKey, value]) => languageKey !== sourceLanguage && isExactKey(languageKey) && typeof value === 'string')
        .map(([languageKey]) => languageKey);
    if (!targetLanguages.length) {
        return Object.freeze({ changed: false, translationState: previous });
    }

    const nextState = createMutableTranslationState(source);
    let changed = false;
    for (const languageKey of targetLanguages) {
        const existing = getTranslationLanguageState(nextState, languageKey);
        const storedMap = existing?.sourceFingerprints?.[unit.unitMap];
        if (isRecord(storedMap) && hasOwn(storedMap, unit.unitId)) continue;
        upsertTranslationLanguageState(
            nextState,
            languageKey,
            setLanguageUnitFingerprint(existing, unit, { reviewState: 'needs-review' }),
        );
        changed = true;
    }
    if (!changed) return Object.freeze({ changed: false, translationState: previous });
    return createTranslationStateMutationResult(source, nextState);
}

/** Register one manually edited target unit against the current source. */
export function recordFlowManualTranslationUnitEdit(group, languageKey, options = {}) {
    const source = requireFlowGroup(group);
    const targetLanguage = requireExactKey(languageKey, 'Flow target language');
    const sourceLanguage = source.flow.document.sourceLanguage;
    if (targetLanguage === sourceLanguage) {
        throw new RangeError('The Flow source language cannot be recorded as a translation edit.');
    }
    if (!isRecord(options)) throw new TypeError('Flow translation edit options must be an object.');
    const unit = resolveFlowTranslationUnit(source, options.unitMap, options.unitId);
    const previous = getValidatedTranslationState(source);
    const target = getExactText(unit.targetMap, targetLanguage);
    if (!unit.trackable || !target.present) {
        return Object.freeze({ changed: false, translationState: previous });
    }

    const nextState = createMutableTranslationState(source);
    const existing = getTranslationLanguageState(nextState, targetLanguage);
    upsertTranslationLanguageState(
        nextState,
        targetLanguage,
        setLanguageUnitFingerprint(existing, unit),
    );
    return createTranslationStateMutationResult(source, nextState);
}

/**
 * Register one atomic machine-translation batch against the current source.
 *
 * The translated text must already be present in the semantic document. This
 * function only updates compact freshness metadata; provider/job details never
 * enter FlowTranslationState. Existing manual units become explicit locks when
 * a language changes from manual to mixed ownership.
 */
export function recordFlowMachineTranslationUnitBatch(group, languageKey, units) {
    const source = requireFlowGroup(group);
    const targetLanguage = requireExactKey(languageKey, 'Flow target language');
    const sourceLanguage = source.flow.document.sourceLanguage;
    if (targetLanguage === sourceLanguage) {
        throw new RangeError('The Flow source language cannot be recorded as a machine translation.');
    }
    if (!Array.isArray(units) || units.length === 0) {
        throw new TypeError('Flow machine translation units must be a non-empty array.');
    }

    const previous = getValidatedTranslationState(source);
    const nextState = createMutableTranslationState(source);
    const existing = getTranslationLanguageState(nextState, targetLanguage);
    const seen = new Set();
    const resolvedUnits = units.map((entry) => {
        if (!isRecord(entry)) throw new TypeError('Flow machine translation unit must be an object.');
        const unit = resolveFlowTranslationUnit(source, entry.unitMap, entry.unitId);
        if (seen.has(unit.unitId)) throw new RangeError(`Duplicate Flow translation unit: ${unit.unitId}`);
        seen.add(unit.unitId);
        const target = getExactText(unit.targetMap, targetLanguage);
        if (!unit.trackable || !target.present) {
            throw new RangeError(`Machine translation target is missing: ${unit.unitId}`);
        }
        if (entry.sourceFingerprint !== unit.sourceFingerprint) {
            throw new RangeError(`Flow source changed before machine translation apply: ${unit.unitId}`);
        }
        return unit;
    });

    const fingerprints = isRecord(existing?.sourceFingerprints)
        ? deepClone(existing.sourceFingerprints)
        : { blocks: {}, sectionTitles: {} };
    fingerprints.blocks = isRecord(fingerprints.blocks) ? fingerprints.blocks : {};
    fingerprints.sectionTitles = isRecord(fingerprints.sectionTitles) ? fingerprints.sectionTitles : {};
    for (const unit of resolvedUnits) {
        fingerprints[unit.unitMap] = replaceExactMapEntry(
            fingerprints[unit.unitMap],
            unit.unitId,
            unit.sourceFingerprint,
        );
    }

    const existingOrigin = existing?.origin || '';
    const nextOrigin = existingOrigin === 'manual' || existingOrigin === 'mixed'
        ? 'mixed'
        : 'machine';
    let lockedUnitIds = Array.isArray(existing?.lockedUnitIds)
        ? [...existing.lockedUnitIds]
        : [];
    if (existingOrigin === 'manual') {
        for (const unitId of Object.keys(existing?.sourceFingerprints?.blocks || {})) {
            lockedUnitIds = appendUniqueExactId(lockedUnitIds, unitId);
        }
        for (const unitId of Object.keys(existing?.sourceFingerprints?.sectionTitles || {})) {
            lockedUnitIds = appendUniqueExactId(lockedUnitIds, unitId);
        }
    }

    upsertTranslationLanguageState(nextState, targetLanguage, {
        ...(existing ? deepClone(existing) : {}),
        sourceFingerprints: fingerprints,
        reviewState: 'needs-review',
        origin: nextOrigin,
        ...(lockedUnitIds.length ? { lockedUnitIds } : {}),
    });
    return createTranslationStateMutationResult(source, nextState);
}

/**
 * Explicitly accept every currently present target value against the current
 * source while preserving origin, locks, other languages, and unknown fields.
 */
export function confirmFlowTranslationAgainstCurrentSource(group, languageKey) {
    const source = requireFlowGroup(group);
    const targetLanguage = requireExactKey(languageKey, 'Flow target language');
    const sourceLanguage = source.flow.document.sourceLanguage;
    if (targetLanguage === sourceLanguage) {
        throw new RangeError('The Flow source language cannot be confirmed as a translation.');
    }
    const previous = getValidatedTranslationState(source);
    const existing = previous === undefined ? null : getTranslationLanguageState(previous, targetLanguage);
    const statusBeforeConfirmation = deriveFlowTranslationStatus(source, targetLanguage);
    const previouslyUntrackedIds = [
        ...(statusBeforeConfirmation.body.ids.untracked || []),
        ...(statusBeforeConfirmation.outline.ids.untracked || []),
    ];
    const existingLockedIds = Array.isArray(existing?.lockedUnitIds) ? existing.lockedUnitIds : [];
    const nextLockedIds = (existing?.origin === 'machine' || existing?.origin === 'mixed')
        ? previouslyUntrackedIds.reduce(appendUniqueExactId, [...existingLockedIds])
        : [...existingLockedIds];
    const nextOrigin = existing?.origin === 'machine' && previouslyUntrackedIds.length
        ? 'mixed'
        : existing?.origin || 'manual';
    const baseline = createFlowTranslationLanguageBaseline(source, targetLanguage, {
        origin: nextOrigin,
        reviewState: 'reviewed',
        ...(nextLockedIds.length ? { lockedUnitIds: nextLockedIds } : {}),
    });
    const presentCount = Object.keys(baseline.sourceFingerprints.blocks).length
        + Object.keys(baseline.sourceFingerprints.sectionTitles).length;
    if (presentCount === 0) {
        return Object.freeze({ changed: false, translationState: previous });
    }

    const nextState = createMutableTranslationState(source);
    const preservedFingerprintFields = isRecord(existing?.sourceFingerprints)
        ? Object.entries(existing.sourceFingerprints)
            .filter(([key]) => key !== 'blocks' && key !== 'sectionTitles')
        : [];
    const sourceFingerprints = Object.fromEntries([
        ...preservedFingerprintFields,
        ['blocks', baseline.sourceFingerprints.blocks],
        ['sectionTitles', baseline.sourceFingerprints.sectionTitles],
    ]);
    upsertTranslationLanguageState(nextState, targetLanguage, {
        ...(existing ? deepClone(existing) : {}),
        ...baseline,
        sourceFingerprints,
    });
    return createTranslationStateMutationResult(source, nextState);
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
