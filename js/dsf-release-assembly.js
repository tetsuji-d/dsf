/**
 * Pure DSF delivery v2 release assembly.
 *
 * This boundary consumes already-created Press preflight results and verified
 * WebP asset descriptors. It deterministically creates language manifests,
 * content.json, hashes their exact UTF-8 bytes through an injected SHA-256
 * function, and returns an immutable upload plan. It never renders images,
 * reads authoring state, writes files, or talks to Press UI, Viewer, R2, or
 * Firestore.
 */

import {
    DSF_DELIVERY_LAYOUT_MODEL,
    DSF_DELIVERY_SCHEMA_VERSION,
    DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    assertValidDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import { DSF_PRESS_PREFLIGHT_SCHEMA_VERSION } from './dsf-press-preflight.js';
import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';
import { deepClone } from './utils.js';

export const DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION = 1;

const MAX_IMAGE_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_RELEASE_BYTES = 10 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^(?:[a-f0-9]{64}|sha256-[A-Za-z0-9_-]{43,86})$/i;
const PAGE_DIRECTIONS = new Set(['ltr', 'rtl']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INPUT_KEYS = new Set(['defaultLang', 'hashBytes', 'languages']);
const LANGUAGE_INPUT_KEYS = new Set(['language', 'pageDirection', 'preflight', 'imageAssets']);
const IMAGE_ASSET_KEYS = new Set([
    'sha256',
    'byteLength',
    'width',
    'height',
    'mimeType',
    'pageId',
    'pageLabel',
]);

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

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function validExactKey(value) {
    return typeof value === 'string'
        && !!value
        && value === value.trim()
        && value.length <= 256
        && !FORBIDDEN_KEYS.has(value);
}

function validSha256(value) {
    return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function canonicalizeJson(value) {
    if (Array.isArray(value)) return value.map(canonicalizeJson);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, canonicalizeJson(value[key])]),
    );
}

function stableJson(value) {
    return JSON.stringify(canonicalizeJson(value));
}

/** Canonical JSON bytes contract shared by later local release stages. */
export function serializeDsfReleaseJson(value) {
    return stableJson(value);
}

function validateExactKeys(value, allowedKeys, path, issues) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            issues.push(createIssue(
                'RELEASE_INPUT_PROPERTY_UNSUPPORTED',
                path ? `${path}.${key}` : key,
                'Release assembly input contains an unsupported property.',
            ));
        }
    }
}

function toUtf8(json) {
    return new TextEncoder().encode(json);
}

async function hashJson(hashBytes, json, path) {
    const bytes = toUtf8(json);
    let sha256;
    try {
        sha256 = await hashBytes(bytes);
    } catch (error) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_HASH_FAILED', path, 'SHA-256 calculation failed.', {
                cause: error?.message || String(error),
            }),
        ]);
    }
    if (!validSha256(sha256)) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_HASH_INVALID', path, 'SHA-256 function returned an unsupported digest format.'),
        ]);
    }
    return { bytes, sha256 };
}

function validatePreflight(preflight, language, path, issues) {
    if (!isRecord(preflight)) {
        issues.push(createIssue('RELEASE_PREFLIGHT_INVALID', path, 'Language release requires a Press preflight result.'));
        return;
    }
    if (preflight.schemaVersion !== DSF_PRESS_PREFLIGHT_SCHEMA_VERSION) {
        issues.push(createIssue('RELEASE_PREFLIGHT_VERSION_UNSUPPORTED', `${path}.schemaVersion`, 'Unsupported Press preflight version.'));
    }
    if (preflight.language !== language) {
        issues.push(createIssue('RELEASE_PREFLIGHT_LANGUAGE_MISMATCH', `${path}.language`, 'Preflight language must exactly match its release language.'));
    }
    if (preflight.publishable !== true || (Array.isArray(preflight.issues) && preflight.issues.length > 0)) {
        issues.push(createIssue(
            'RELEASE_PREFLIGHT_BLOCKED',
            path,
            'Blocked preflight results cannot be assembled into a release.',
            { preflightIssues: deepClone(Array.isArray(preflight.issues) ? preflight.issues : []) },
        ));
    }
    if (!Array.isArray(preflight.decisions) || preflight.decisions.length < 1) {
        issues.push(createIssue('RELEASE_PREFLIGHT_DECISIONS_INVALID', `${path}.decisions`, 'Preflight must contain an ordered Fixed page decision list.'));
        return;
    }
    const seenBlockIds = new Map();
    let expectedDeliveryPageIndex = 0;
    let expectedFixedPageIndex = 0;
    preflight.decisions.forEach((decision, index) => {
        const decisionPath = `${path}.decisions[${index}]`;
        if (!isRecord(decision)) {
            issues.push(createIssue('RELEASE_DECISION_INVALID', decisionPath, 'Preflight decision must be an object.'));
            return;
        }
        const sourceKind = decision.sourceKind;
        const deliveryPageIndex = hasOwn(decision, 'deliveryPageIndex')
            ? decision.deliveryPageIndex
            : sourceKind === 'fixed'
                ? decision.fixedPageIndex
                : null;
        if (!Number.isInteger(deliveryPageIndex) || deliveryPageIndex !== expectedDeliveryPageIndex) {
            issues.push(createIssue(
                'RELEASE_DECISION_ORDER_INVALID',
                `${decisionPath}.deliveryPageIndex`,
                'Delivery page decisions must preserve authoring order without gaps or overlap.',
                { expectedDeliveryPageIndex },
            ));
        }
        if (!validExactKey(decision.blockId)) {
            issues.push(createIssue('RELEASE_DECISION_BLOCK_ID_INVALID', `${decisionPath}.blockId`, 'Decision block ID is invalid.'));
        } else if (seenBlockIds.has(decision.blockId)) {
            issues.push(createIssue('RELEASE_DECISION_BLOCK_ID_DUPLICATE', `${decisionPath}.blockId`, 'Decision block IDs must be unique.', {
                firstPath: seenBlockIds.get(decision.blockId),
            }));
        } else {
            seenBlockIds.set(decision.blockId, `${decisionPath}.blockId`);
        }
        if (sourceKind !== 'fixed' && sourceKind !== 'flow') {
            issues.push(createIssue('RELEASE_DECISION_SOURCE_UNSUPPORTED', `${decisionPath}.sourceKind`, 'Release decision source must be Fixed or Flow.'));
        }
        if (sourceKind === 'fixed') {
            if (decision.fixedPageIndex !== expectedFixedPageIndex) {
                issues.push(createIssue(
                    'RELEASE_FIXED_DECISION_ORDER_INVALID',
                    `${decisionPath}.fixedPageIndex`,
                    'Fixed page indexes must remain contiguous within the authoring spine.',
                    { expectedFixedPageIndex },
                ));
            }
            expectedFixedPageIndex += 1;
        } else if (hasOwn(decision, 'fixedPageIndex')) {
            issues.push(createIssue(
                'RELEASE_FLOW_FIXED_INDEX_FORBIDDEN',
                `${decisionPath}.fixedPageIndex`,
                'Flow decisions cannot claim a Fixed page index.',
            ));
        }
        if (decision.renderKind === 'fixedText') {
            const projectionPages = decision.projection?.manifest?.pages;
            const pageCount = Array.isArray(projectionPages) && projectionPages.length > 0
                ? projectionPages.length
                : 1;
            if (sourceKind === 'fixed' && (decision.decisionCode !== 'FIXED_TEXT_CERTIFIED'
                || decision.projection?.ok !== true
                || decision.projection?.renderKind !== 'fixedText'
                || pageCount !== 1)) {
                issues.push(createIssue('RELEASE_FIXED_TEXT_PROJECTION_INVALID', `${decisionPath}.projection`, 'fixedText decision requires a successful certified projection.'));
            }
            if (sourceKind === 'flow') {
                const flowProjectionValid = decision.decisionCode === 'FLOW_FIXED_TEXT_CERTIFIED'
                    && decision.projection?.ok === true
                    && decision.projection?.renderKind === 'fixedText'
                    && decision.projection?.flowGroupId === decision.blockId
                    && decision.projection?.language === language
                    && decision.projection?.manifest?.language === language
                    && Array.isArray(projectionPages)
                    && projectionPages.length > 0
                    && projectionPages.every((page) => (
                        page?.renderKind === 'fixedText'
                        && page.sourceAnchor?.kind === 'flow'
                        && page.sourceAnchor.flowGroupId === decision.blockId
                    ));
                if (!flowProjectionValid) {
                    issues.push(createIssue(
                        'RELEASE_FLOW_TEXT_PROJECTION_INVALID',
                        `${decisionPath}.projection`,
                        'Flow decision requires a successful multi-page projection for the exact Group and language.',
                    ));
                }
            }
            expectedDeliveryPageIndex += sourceKind === 'flow' ? pageCount : 1;
            return;
        }
        if (decision.renderKind === 'image') {
            if (sourceKind !== 'fixed') {
                issues.push(createIssue(
                    'RELEASE_FLOW_IMAGE_UNSUPPORTED',
                    decisionPath,
                    '9A-5C does not accept generated Flow pages as implicit WebP assets.',
                ));
            }
            if (typeof decision.decisionCode !== 'string' || !decision.decisionCode) {
                issues.push(createIssue('RELEASE_IMAGE_DECISION_INVALID', `${decisionPath}.decisionCode`, 'Image decision requires an explicit reason code.'));
            }
            expectedDeliveryPageIndex += 1;
            return;
        }
        issues.push(createIssue('RELEASE_RENDER_KIND_UNSUPPORTED', `${decisionPath}.renderKind`, 'Release decision must use image or fixedText.'));
    });
}

function validateImageAsset(asset, path, issues) {
    if (!isRecord(asset)) {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_MISSING', path, 'Every image decision requires a verified WebP asset descriptor.'));
        return;
    }
    validateExactKeys(asset, IMAGE_ASSET_KEYS, path, issues);
    if (!validSha256(asset.sha256)) {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_HASH_INVALID', `${path}.sha256`, 'Image asset requires its verified SHA-256 digest.'));
    }
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > MAX_IMAGE_ASSET_BYTES) {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_SIZE_INVALID', `${path}.byteLength`, 'Image asset byteLength is outside the release limit.'));
    }
    if (!Number.isInteger(asset.width) || asset.width < 1 || asset.width > 32_768) {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_DIMENSION_INVALID', `${path}.width`, 'Image asset width is invalid.'));
    }
    if (!Number.isInteger(asset.height) || asset.height < 1 || asset.height > 32_768) {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_DIMENSION_INVALID', `${path}.height`, 'Image asset height is invalid.'));
    }
    if (asset.mimeType !== 'image/webp') {
        issues.push(createIssue('RELEASE_IMAGE_ASSET_MIME_UNSUPPORTED', `${path}.mimeType`, 'Release image assets must use image/webp.'));
    }
    if (hasOwn(asset, 'pageId') && !validExactKey(asset.pageId)) {
        issues.push(createIssue('RELEASE_IMAGE_PAGE_ID_INVALID', `${path}.pageId`, 'Optional image page ID is invalid.'));
    }
    if (hasOwn(asset, 'pageLabel') && typeof asset.pageLabel !== 'string') {
        issues.push(createIssue('RELEASE_IMAGE_PAGE_LABEL_INVALID', `${path}.pageLabel`, 'Optional image page label must be a string.'));
    }
}

function validateAssemblyInput(input) {
    const issues = [];
    if (!isRecord(input)) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_INPUT_INVALID', '', 'Release assembly input must be an object.'),
        ]);
    }
    validateExactKeys(input, INPUT_KEYS, '', issues);
    if (!validExactKey(input.defaultLang)) {
        issues.push(createIssue('RELEASE_DEFAULT_LANGUAGE_INVALID', 'defaultLang', 'defaultLang must be an exact non-empty language key.'));
    }
    if (typeof input.hashBytes !== 'function') {
        issues.push(createIssue('RELEASE_HASH_FUNCTION_MISSING', 'hashBytes', 'Release assembly requires an injected SHA-256 byte function.'));
    }
    if (!Array.isArray(input.languages) || input.languages.length < 1 || input.languages.length > 32) {
        issues.push(createIssue('RELEASE_LANGUAGES_INVALID', 'languages', 'Release requires between 1 and 32 language inputs.'));
    } else {
        const seenLanguages = new Map();
        input.languages.forEach((entry, index) => {
            const path = `languages[${index}]`;
            if (!isRecord(entry)) {
                issues.push(createIssue('RELEASE_LANGUAGE_INVALID', path, 'Language release input must be an object.'));
                return;
            }
            validateExactKeys(entry, LANGUAGE_INPUT_KEYS, path, issues);
            if (!validExactKey(entry.language)) {
                issues.push(createIssue('RELEASE_LANGUAGE_KEY_INVALID', `${path}.language`, 'Language key is invalid.'));
            } else if (seenLanguages.has(entry.language)) {
                issues.push(createIssue('RELEASE_LANGUAGE_DUPLICATE', `${path}.language`, 'Language keys must be unique.', {
                    firstPath: seenLanguages.get(entry.language),
                }));
            } else {
                seenLanguages.set(entry.language, `${path}.language`);
            }
            if (!PAGE_DIRECTIONS.has(entry.pageDirection)) {
                issues.push(createIssue('RELEASE_PAGE_DIRECTION_INVALID', `${path}.pageDirection`, 'pageDirection must be ltr or rtl.'));
            }
            validatePreflight(entry.preflight, entry.language, `${path}.preflight`, issues);
            if (!isRecord(entry.imageAssets)) {
                issues.push(createIssue('RELEASE_IMAGE_ASSET_MAP_INVALID', `${path}.imageAssets`, 'imageAssets must be an object keyed by Fixed block ID.'));
                return;
            }
            const imageBlockIds = new Set(
                Array.isArray(entry.preflight?.decisions)
                    ? entry.preflight.decisions
                        .filter((decision) => decision?.renderKind === 'image' && validExactKey(decision.blockId))
                        .map((decision) => decision.blockId)
                    : [],
            );
            for (const blockId of imageBlockIds) {
                validateImageAsset(
                    hasOwn(entry.imageAssets, blockId) ? entry.imageAssets[blockId] : undefined,
                    `${path}.imageAssets.${blockId}`,
                    issues,
                );
            }
            for (const assetBlockId of Object.keys(entry.imageAssets)) {
                if (!imageBlockIds.has(assetBlockId)) {
                    issues.push(createIssue(
                        'RELEASE_IMAGE_ASSET_UNUSED',
                        `${path}.imageAssets.${assetBlockId}`,
                        'Image asset does not match an image decision and cannot be included silently.',
                    ));
                }
            }
        });
        if (validExactKey(input.defaultLang) && !seenLanguages.has(input.defaultLang)) {
            issues.push(createIssue('RELEASE_DEFAULT_LANGUAGE_MISSING', 'defaultLang', 'defaultLang must exactly match one language input.'));
        }
    }
    if (issues.length) throw new DsfReleaseAssemblyError(issues);
}

function equalJson(left, right) {
    return stableJson(left) === stableJson(right);
}

function registerFont(fonts, projection, path) {
    const fontId = projection?.font?.id;
    const declaration = projection?.font?.declaration;
    if (!validExactKey(fontId) || !isRecord(declaration)) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_FONT_INVALID', path, 'Certified projection is missing its release font declaration.'),
        ]);
    }
    if (hasOwn(fonts, fontId) && !equalJson(fonts[fontId], declaration)) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_FONT_CONFLICT', path, 'The same font ID has conflicting release declarations.', { fontId }),
        ]);
    }
    if (!hasOwn(fonts, fontId)) fonts[fontId] = deepClone(declaration);
}

function allocateStyleId(baseId, styles) {
    if (!hasOwn(styles, baseId)) return baseId;
    let suffix = 2;
    while (hasOwn(styles, `${baseId}_${suffix}`)) suffix += 1;
    return `${baseId}_${suffix}`;
}

function mergeProjectionStyles(styles, projectionManifest) {
    const styleIdMap = new Map();
    for (const [sourceStyleId, sourceStyle] of Object.entries(projectionManifest.styles || {})) {
        const matching = Object.entries(styles).find(([, existingStyle]) => equalJson(existingStyle, sourceStyle));
        if (matching) {
            styleIdMap.set(sourceStyleId, matching[0]);
            continue;
        }
        const targetStyleId = allocateStyleId(sourceStyleId, styles);
        styles[targetStyleId] = deepClone(sourceStyle);
        styleIdMap.set(sourceStyleId, targetStyleId);
    }
    return styleIdMap;
}

function rewritePageStyleRefs(page, styleIdMap) {
    for (const line of page.lines || []) {
        if (styleIdMap.has(line.styleRef)) line.styleRef = styleIdMap.get(line.styleRef);
        for (const run of line.runs || []) {
            if (styleIdMap.has(run.styleRef)) run.styleRef = styleIdMap.get(run.styleRef);
        }
    }
}

function createImagePage({ decision, asset, assetPath, language }) {
    return {
        id: asset.pageId || `fixed:${decision.blockId}:${language}`,
        renderKind: 'image',
        sourceAnchor: { kind: 'fixed', blockId: decision.blockId },
        ...(typeof asset.pageLabel === 'string' ? { pageLabel: asset.pageLabel } : {}),
        image: {
            href: `../${assetPath}`,
            width: asset.width,
            height: asset.height,
            mimeType: 'image/webp',
        },
    };
}

function getDecisionDeliveryPageIndex(decision) {
    return Number.isInteger(decision.deliveryPageIndex)
        ? decision.deliveryPageIndex
        : decision.fixedPageIndex;
}

function assembleLanguage(entry, languageIndex, fonts) {
    const styles = {};
    const pages = [];
    const assets = [];
    entry.preflight.decisions.forEach((decision, decisionIndex) => {
        const deliveryPageIndex = getDecisionDeliveryPageIndex(decision);
        if (pages.length !== deliveryPageIndex) {
            throw new DsfReleaseAssemblyError([
                createIssue(
                    'RELEASE_DECISION_ORDER_INVALID',
                    `languages[${languageIndex}].preflight.decisions[${decisionIndex}].deliveryPageIndex`,
                    'Decision does not begin at the next delivery page index.',
                    { expectedDeliveryPageIndex: pages.length },
                ),
            ]);
        }
        if (decision.renderKind === 'fixedText') {
            registerFont(fonts, decision.projection, `languages[${languageIndex}].preflight.decisions[${decisionIndex}].projection.font`);
            const projectionManifest = decision.projection.manifest;
            if (projectionManifest?.language !== entry.language
                || !Array.isArray(projectionManifest?.pages)
                || projectionManifest.pages.length < 1
                || (decision.sourceKind === 'fixed' && projectionManifest.pages.length !== 1)) {
                throw new DsfReleaseAssemblyError([
                    createIssue(
                        'RELEASE_FIXED_TEXT_FRAGMENT_INVALID',
                        `languages[${languageIndex}].preflight.decisions[${decisionIndex}].projection.manifest`,
                        'A fixedText projection must contain the expected pages for the release language.',
                    ),
                ]);
            }
            const styleIdMap = mergeProjectionStyles(styles, projectionManifest);
            projectionManifest.pages.forEach((projectionPage, projectionPageIndex) => {
                const page = deepClone(projectionPage);
                const fixedAnchorMatches = decision.sourceKind === 'fixed'
                    && page.sourceAnchor?.kind === 'fixed'
                    && page.sourceAnchor.blockId === decision.blockId;
                const flowAnchorMatches = decision.sourceKind === 'flow'
                    && page.sourceAnchor?.kind === 'flow'
                    && page.sourceAnchor.flowGroupId === decision.blockId;
                if (!fixedAnchorMatches && !flowAnchorMatches) {
                    throw new DsfReleaseAssemblyError([
                        createIssue(
                            decision.sourceKind === 'flow'
                                ? 'RELEASE_FLOW_TEXT_ANCHOR_MISMATCH'
                                : 'RELEASE_FIXED_TEXT_ANCHOR_MISMATCH',
                            `languages[${languageIndex}].preflight.decisions[${decisionIndex}].projection.manifest.pages[${projectionPageIndex}].sourceAnchor`,
                            'Fixed text source anchor must match its authoring decision.',
                        ),
                    ]);
                }
                rewritePageStyleRefs(page, styleIdMap);
                pages.push(page);
            });
            return;
        }

        const asset = entry.imageAssets[decision.blockId];
        const assetPath = `assets/images/language-${String(languageIndex + 1).padStart(4, '0')}/page-${String(deliveryPageIndex + 1).padStart(5, '0')}.webp`;
        pages.push(createImagePage({ decision, asset, assetPath, language: entry.language }));
        assets.push({
            path: assetPath,
            language: entry.language,
            blockId: decision.blockId,
            pageIndex: deliveryPageIndex,
            sha256: asset.sha256,
            byteLength: asset.byteLength,
            width: asset.width,
            height: asset.height,
            mimeType: 'image/webp',
            decisionCode: decision.decisionCode,
        });
    });
    return {
        manifest: {
            schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
            language: entry.language,
            styles,
            pages,
        },
        assets,
    };
}

export class DsfReleaseAssemblyError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF release assembly.');
        this.name = 'DsfReleaseAssemblyError';
        this.code = 'DSF_RELEASE_ASSEMBLY_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Build an immutable, upload-ready metadata plan without performing I/O.
 *
 * `hashBytes(Uint8Array)` must return the digest of those exact bytes as
 * 64-character hex or `sha256-` base64url. Image bytes are deliberately not
 * accepted here; their descriptors must already contain a verified digest.
 */
export async function assembleDsfV2Release(input = {}) {
    validateAssemblyInput(input);

    const fonts = {};
    const manifests = {};
    const manifestFiles = {};
    const languageDescriptors = {};
    const assetPlan = [];

    for (let languageIndex = 0; languageIndex < input.languages.length; languageIndex += 1) {
        const entry = input.languages[languageIndex];
        const assembled = assembleLanguage(entry, languageIndex, fonts);
        const manifestPath = `content/language-${String(languageIndex + 1).padStart(4, '0')}.json`;
        const manifestJson = stableJson(assembled.manifest);
        const hashedManifest = await hashJson(input.hashBytes, manifestJson, manifestPath);
        manifests[entry.language] = assembled.manifest;
        manifestFiles[entry.language] = {
            path: manifestPath,
            json: manifestJson,
            byteLength: hashedManifest.bytes.byteLength,
            sha256: hashedManifest.sha256,
        };
        languageDescriptors[entry.language] = {
            href: manifestPath,
            pageCount: assembled.manifest.pages.length,
            sha256: hashedManifest.sha256,
            pageDirection: entry.pageDirection,
        };
        assetPlan.push(...assembled.assets);
    }

    const index = {
        schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
        layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
        canonicalPage: {
            width: CANONICAL_PAGE_WIDTH,
            height: CANONICAL_PAGE_HEIGHT,
            aspectRatio: '9:16',
        },
        defaultLang: input.defaultLang,
        fonts,
        languages: languageDescriptors,
    };
    const bundle = { index, manifests };
    try {
        assertValidDsfDeliveryBundle(bundle);
    } catch (error) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_BUNDLE_INVALID', 'bundle', 'Assembled release failed the DSF delivery v2 contract.', {
                validationIssues: deepClone(error?.issues || []),
            }),
        ]);
    }

    const indexJson = stableJson(index);
    const hashedIndex = await hashJson(input.hashBytes, indexJson, 'content.json');
    const totalBytes = hashedIndex.bytes.byteLength
        + Object.values(manifestFiles).reduce((sum, file) => sum + file.byteLength, 0)
        + assetPlan.reduce((sum, asset) => sum + asset.byteLength, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_RELEASE_BYTES) {
        throw new DsfReleaseAssemblyError([
            createIssue('RELEASE_TOTAL_SIZE_EXCEEDED', 'summary.totalBytes', 'Release exceeds the 9A-4A metadata plan limit.'),
        ]);
    }

    const result = {
        schemaVersion: DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
        bundle,
        files: {
            index: {
                path: 'content.json',
                json: indexJson,
                byteLength: hashedIndex.bytes.byteLength,
                sha256: hashedIndex.sha256,
            },
            manifests: manifestFiles,
            assets: assetPlan,
        },
        releaseMetadata: {
            dsfSchemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
            dsfContentHash: hashedIndex.sha256,
            dsfLangs: input.languages.map((entry) => entry.language),
            dsfPageCounts: Object.fromEntries(input.languages.map((entry) => [
                entry.language,
                manifests[entry.language].pages.length,
            ])),
            dsfTotalBytes: totalBytes,
        },
        summary: {
            languageCount: input.languages.length,
            pageCount: Object.values(manifests).reduce((sum, manifest) => sum + manifest.pages.length, 0),
            fixedTextPageCount: Object.values(manifests).reduce((sum, manifest) => (
                sum + manifest.pages.filter((page) => page.renderKind === 'fixedText').length
            ), 0),
            imagePageCount: assetPlan.length,
            externalFontCount: Object.keys(fonts).length,
            totalBytes,
        },
    };
    return deepFreeze(deepClone(result));
}
