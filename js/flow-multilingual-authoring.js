/**
 * Pure multilingual authoring helpers for persisted Project v6 Flow groups.
 *
 * Language keys are always the exact keys saved by the project. These helpers
 * never canonicalize keys and never create translated text entries merely
 * because a language was selected.
 */

import {
    PROJECT_SCHEMA_VERSION,
    assertValidFlowProjectData,
} from './flow-project-model.js';
import { isFlowWritingModeSupported } from './flow-typography.js';
import { deepClone } from './utils.js';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isExactLanguageKey(value) {
    return typeof value === 'string' && !!value && value === value.trim();
}

function requireExactLanguageKey(value) {
    if (!isExactLanguageKey(value)) {
        throw new TypeError('Flow language keys must be non-empty exact saved keys.');
    }
    return value;
}

function assertProjectV6Blocks(blocks) {
    if (!Array.isArray(blocks)) throw new TypeError('Project v6 blocks must be an array.');
    assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks });
    return blocks;
}

function assertFlowGroup(group) {
    assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks: [group] });
    return group;
}

/**
 * Resolve the language shown by the Flow authoring surface.
 *
 * An exact active project language wins. Missing, differently-cased, or
 * otherwise unknown values fall back to the Flow document's source language.
 * The function only selects a key; it does not seed `texts[languageKey]`.
 */
export function resolveFlowAuthoringLanguage(group, activeLanguage, projectLanguages) {
    assertFlowGroup(group);
    const sourceLanguage = group.flow.document.sourceLanguage;
    if (
        isExactLanguageKey(activeLanguage)
        && Array.isArray(projectLanguages)
        && projectLanguages.includes(activeLanguage)
    ) return activeLanguage;
    return sourceLanguage;
}

/**
 * Report translation availability using the same completeness rule as runtime
 * pagination: every Heading and Paragraph must own a string for the exact key.
 * Empty strings count as intentional saved values; PageBreak does not count.
 */
export function getFlowLanguageProgress(group, languageKey) {
    assertFlowGroup(group);
    const key = requireExactLanguageKey(languageKey);
    let total = 0;
    let completed = 0;

    for (const section of group.flow.document.sections || []) {
        for (const block of section.blocks || []) {
            if (block?.type !== 'heading' && block?.type !== 'paragraph') continue;
            total += 1;
            if (
                isRecord(block.texts)
                && Object.prototype.hasOwnProperty.call(block.texts, key)
                && typeof block.texts[key] === 'string'
            ) completed += 1;
        }
    }

    return Object.freeze({
        languageKey: key,
        sourceLanguage: group.flow.document.sourceLanguage,
        isSourceLanguage: key === group.flow.document.sourceLanguage,
        total,
        completed,
        missing: total - completed,
        hasAny: completed > 0,
        complete: total > 0 && completed === total,
    });
}

/**
 * Ensure one exact-key Flow typography profile without modifying input blocks.
 *
 * A new language starts from the source-language style, including future
 * opaque style keys, while the requested writing mode is applied explicitly.
 * An existing target profile keeps its own style when its mode is updated.
 */
export function ensureFlowLanguageTypography(inputBlocks, options = {}) {
    assertProjectV6Blocks(inputBlocks);
    if (!isRecord(options)) throw new TypeError('Flow typography options must be an object.');
    const groupId = typeof options.groupId === 'string' ? options.groupId : '';
    if (!groupId || groupId !== groupId.trim()) {
        throw new TypeError('Flow groupId must be a non-empty exact ID.');
    }
    const languageKey = requireExactLanguageKey(options.languageKey);
    const writingMode = options.writingMode;
    if (typeof writingMode !== 'string' || !writingMode || writingMode !== writingMode.trim()) {
        throw new TypeError('Flow writingMode must be a non-empty exact value.');
    }
    if (!isFlowWritingModeSupported(languageKey, writingMode)) {
        throw new RangeError(`Writing mode ${writingMode} is unsupported for Flow language ${languageKey}.`);
    }

    const groupIndex = inputBlocks.findIndex((block) => block?.kind === 'flow' && block.id === groupId);
    if (groupIndex < 0) throw new RangeError(`Flow group not found: ${groupId}`);
    const group = inputBlocks[groupIndex];
    const sourceLanguage = group.flow.document.sourceLanguage;
    const profiles = group.flow.layout.typographyByLanguage;
    const sourceProfile = profiles[sourceLanguage];
    const existingProfile = profiles[languageKey];

    if (isRecord(existingProfile) && existingProfile.writingMode === writingMode) {
        return Object.freeze({
            blocks: inputBlocks,
            changed: false,
            profile: deepClone(existingProfile),
        });
    }

    const baseProfile = isRecord(existingProfile) ? existingProfile : sourceProfile;
    const profile = { ...deepClone(baseProfile), writingMode };
    const blocks = deepClone(inputBlocks);
    blocks[groupIndex].flow.layout.typographyByLanguage = {
        ...blocks[groupIndex].flow.layout.typographyByLanguage,
        [languageKey]: profile,
    };
    assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks });

    return Object.freeze({ blocks, changed: true, profile: deepClone(profile) });
}

/** Return Flow group IDs whose immutable semantic source uses the exact key. */
export function getFlowSourceLanguageGroupIds(inputBlocks, languageKey) {
    assertProjectV6Blocks(inputBlocks);
    const key = requireExactLanguageKey(languageKey);
    return inputBlocks
        .filter((block) => block?.kind === 'flow' && block.flow.document.sourceLanguage === key)
        .map((block) => block.id);
}
