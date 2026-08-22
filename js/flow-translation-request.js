/**
 * Pure Flow semantic-unit request and provider-result planning.
 *
 * This module never calls a provider and never mutates Project state. It
 * selects safe Heading/Paragraph/Section-title units and verifies that a
 * provider response can still be applied atomically by the later Studio job.
 */

import { assertValidFlowDocument } from './flow-document.js';
import {
    createFlowBlockSourceFingerprint,
    createFlowSectionTitleSourceFingerprint,
    deriveFlowTranslationStatus,
} from './flow-translation-state.js';
import {
    normalizeTranslationConstraints,
    normalizeTranslationProviderResponse,
    TranslationProviderError,
} from './translation-provider.js';

export const FLOW_TRANSLATION_REQUEST_SCHEMA_VERSION = 1;
export const FLOW_TRANSLATION_UNIT_KINDS = Object.freeze(['sectionTitle', 'heading', 'paragraph']);

const UNIT_KIND_SET = new Set(FLOW_TRANSLATION_UNIT_KINDS);
const UNIT_STATUS_SET = new Set(['missing', 'current', 'stale', 'untracked']);
const DEFAULT_REQUEST_STATUSES = Object.freeze(['missing', 'stale']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function requireExactKey(value, label) {
    const key = String(value || '');
    if (!key || key !== key.trim()) {
        throw new FlowTranslationRequestError('INVALID_FLOW_TRANSLATION_REQUEST', `${label} must be a non-empty exact key.`);
    }
    return key;
}

function requireFlowGroup(group) {
    if (!isRecord(group) || group.kind !== 'flow' || !isRecord(group.flow?.document)) {
        throw new FlowTranslationRequestError('INVALID_FLOW_GROUP', 'Flow translation requires a Flow group.');
    }
    assertValidFlowDocument(group.flow.document);
    return group;
}

function createStatusMap(collection) {
    const statuses = new Map();
    for (const status of UNIT_STATUS_SET) {
        for (const unitId of collection?.ids?.[status] || []) statuses.set(unitId, status);
    }
    return statuses;
}

function listSemanticUnits(group, targetLang) {
    const document = group.flow.document;
    const sourceLang = document.sourceLanguage;
    const status = deriveFlowTranslationStatus(group, targetLang);
    const bodyStatuses = createStatusMap(status.body);
    const outlineStatuses = createStatusMap(status.outline);
    const bodyLocks = new Set(status.body.ids.locked || []);
    const outlineLocks = new Set(status.outline.ids.locked || []);
    const units = [];

    for (const section of document.sections) {
        if (hasOwn(section.title, sourceLang) && typeof section.title[sourceLang] === 'string') {
            const targetPresent = hasOwn(section.title, targetLang) && typeof section.title[targetLang] === 'string';
            units.push({
                unitId: section.id,
                unitKind: 'sectionTitle',
                sectionId: section.id,
                blockId: '',
                text: section.title[sourceLang],
                sourceFingerprint: createFlowSectionTitleSourceFingerprint(section, sourceLang),
                currentStatus: outlineStatuses.get(section.id) || 'missing',
                locked: outlineLocks.has(section.id),
                targetSnapshot: {
                    present: targetPresent,
                    text: targetPresent ? section.title[targetLang] : '',
                },
            });
        }
        for (const block of section.blocks) {
            if (block.type !== 'heading' && block.type !== 'paragraph') continue;
            const text = hasOwn(block.texts, sourceLang) && typeof block.texts[sourceLang] === 'string'
                ? block.texts[sourceLang]
                : '';
            const targetPresent = hasOwn(block.texts, targetLang) && typeof block.texts[targetLang] === 'string';
            units.push({
                unitId: block.id,
                unitKind: block.type,
                sectionId: section.id,
                blockId: block.id,
                text,
                sourceFingerprint: createFlowBlockSourceFingerprint(section.id, block, sourceLang),
                currentStatus: bodyStatuses.get(block.id) || 'missing',
                locked: bodyLocks.has(block.id),
                targetSnapshot: {
                    present: targetPresent,
                    text: targetPresent ? block.texts[targetLang] : '',
                },
            });
        }
    }
    return units;
}

function normalizeRequestedStatuses(value) {
    const input = Array.isArray(value) ? value : DEFAULT_REQUEST_STATUSES;
    const result = [];
    const seen = new Set();
    for (const status of input) {
        const normalized = String(status || '');
        if (!UNIT_STATUS_SET.has(normalized)) {
            throw new FlowTranslationRequestError(
                'INVALID_FLOW_TRANSLATION_STATUS',
                `Unsupported Flow translation status: ${normalized}`,
            );
        }
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function validateRequestIdentity(group, request) {
    if (!isRecord(request) || request.schemaVersion !== FLOW_TRANSLATION_REQUEST_SCHEMA_VERSION) {
        throw new FlowTranslationRequestError('INVALID_FLOW_TRANSLATION_REQUEST', 'Unsupported Flow translation request.');
    }
    if (request.groupId !== group.id || request.documentId !== group.flow.document.id) {
        throw new FlowTranslationRequestError('FLOW_TRANSLATION_REQUEST_MISMATCH', 'Flow translation request targets another document.');
    }
    if (request.sourceLang !== group.flow.document.sourceLanguage) {
        throw new FlowTranslationRequestError('FLOW_TRANSLATION_SOURCE_CHANGED', 'Flow source language changed after translation started.');
    }
}

export class FlowTranslationRequestError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'FlowTranslationRequestError';
        this.code = code;
        Object.assign(this, details);
    }
}

export function createFlowTranslationRequest(group, options = {}) {
    const source = requireFlowGroup(group);
    const document = source.flow.document;
    const sourceLang = document.sourceLanguage;
    const targetLang = requireExactKey(options.targetLang, 'Flow target language');
    if (targetLang === sourceLang) {
        throw new FlowTranslationRequestError('INVALID_LANGUAGE_PAIR', 'Target language must differ from the Flow source language.');
    }
    const requestedStatuses = normalizeRequestedStatuses(options.statuses);
    const statusSet = new Set(requestedStatuses);
    const requestedUnitIds = new Set((Array.isArray(options.unitIds) ? options.unitIds : [])
        .map((unitId) => requireExactKey(unitId, 'Flow translation unit ID')));
    const includeOutline = options.includeOutline !== false;
    const overwriteLocked = options.overwriteLocked === true;
    const units = [];
    const skipped = [];

    const semanticUnits = listSemanticUnits(source, targetLang);
    const knownUnitIds = new Set(semanticUnits.map((unit) => unit.unitId));
    const unknownUnitIds = [...requestedUnitIds].filter((unitId) => !knownUnitIds.has(unitId));
    if (unknownUnitIds.length) {
        throw new FlowTranslationRequestError(
            'FLOW_TRANSLATION_UNIT_NOT_FOUND',
            `Flow translation unit not found: ${unknownUnitIds[0]}`,
            { unitIds: unknownUnitIds },
        );
    }

    for (const unit of semanticUnits) {
        let reason = '';
        if (!includeOutline && unit.unitKind === 'sectionTitle') reason = 'outline-excluded';
        else if (requestedUnitIds.size && !requestedUnitIds.has(unit.unitId)) reason = 'not-requested';
        else if (!statusSet.has(unit.currentStatus)) reason = `status-${unit.currentStatus}`;
        else if (unit.locked && !overwriteLocked) reason = 'locked';
        if (reason) {
            skipped.push({
                unitId: unit.unitId,
                unitKind: unit.unitKind,
                reason,
                currentStatus: unit.currentStatus,
            });
            continue;
        }
        units.push({ ...unit });
    }

    return {
        schemaVersion: FLOW_TRANSLATION_REQUEST_SCHEMA_VERSION,
        groupId: source.id,
        documentId: document.id,
        sourceLang,
        targetLang,
        modelId: String(options.modelId || ''),
        overwriteLocked,
        requestedStatuses,
        units,
        skipped,
        constraints: normalizeTranslationConstraints({
            ...(options.constraints || {}),
            preserveSemanticStructure: true,
            allowTargetPageCountChange: true,
            sharedPageBreaks: true,
        }),
    };
}

export function createFlowTranslationApplyPlan(group, request, response) {
    const source = requireFlowGroup(group);
    validateRequestIdentity(source, request);
    const targetLang = requireExactKey(request.targetLang, 'Flow target language');
    if (targetLang === request.sourceLang) {
        throw new FlowTranslationRequestError('INVALID_LANGUAGE_PAIR', 'Flow translation request cannot target its source language.');
    }

    let normalized;
    try {
        normalized = normalizeTranslationProviderResponse(response, request, {
            allowPartial: response?.cancelled === true,
            cancelled: response?.cancelled === true,
        });
    } catch (error) {
        if (error instanceof TranslationProviderError) {
            throw new FlowTranslationRequestError(error.code, error.message, {
                missingUnitIds: error.missingUnitIds || [],
            });
        }
        throw error;
    }
    if (normalized.cancelled) {
        return { ready: false, reason: 'cancelled', edits: [], issues: normalized.missingUnitIds };
    }

    const currentUnits = new Map(listSemanticUnits(source, targetLang)
        .map((unit) => [unit.unitId, unit]));
    const requestedUnits = new Map(request.units.map((unit) => [unit.unitId, unit]));
    const issues = [];
    const edits = [];

    for (const result of normalized.units) {
        const requested = requestedUnits.get(result.unitId);
        const current = currentUnits.get(result.unitId);
        if (!requested || !UNIT_KIND_SET.has(requested.unitKind)) {
            issues.push({ unitId: result.unitId, reason: 'invalid-request-unit' });
            continue;
        }
        if (!current) {
            issues.push({ unitId: result.unitId, reason: 'unit-removed' });
            continue;
        }
        if (current.sourceFingerprint !== requested.sourceFingerprint) {
            issues.push({ unitId: result.unitId, reason: 'source-changed' });
            continue;
        }
        if (current.targetSnapshot.present !== requested.targetSnapshot?.present
            || current.targetSnapshot.text !== requested.targetSnapshot?.text) {
            issues.push({ unitId: result.unitId, reason: 'target-changed' });
            continue;
        }
        if (current.locked && request.overwriteLocked !== true) {
            issues.push({ unitId: result.unitId, reason: 'target-locked' });
            continue;
        }
        if (result.status === 'error') {
            issues.push({ unitId: result.unitId, reason: 'provider-error', error: result.error });
            continue;
        }
        edits.push({
            unitId: current.unitId,
            unitKind: current.unitKind,
            sectionId: current.sectionId,
            blockId: current.blockId,
            languageKey: request.targetLang,
            text: result.text,
            sourceFingerprint: current.sourceFingerprint,
            providerStatus: result.status,
        });
    }

    if (issues.length || edits.length !== request.units.length) {
        return { ready: false, reason: 'atomic-validation-failed', edits: [], issues };
    }
    return { ready: true, reason: '', edits, issues: [] };
}
