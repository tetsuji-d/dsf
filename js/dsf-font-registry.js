/**
 * Pure production font registry contract for DSF fixed-text delivery.
 *
 * Every active entry is projected from a human-reviewed certification
 * candidate after its immutable production WOFF2 and actual byte hash pass.
 */

import { deepClone } from './utils.js';
import { createDsfProductionFontEntryFromCandidate } from './dsf-font-certification-candidates.js';

export const DSF_FONT_REGISTRY_SCHEMA_VERSION = 1;
export const DSF_FONT_REGISTRY_KIND = 'production';

const FONT_SOURCE = 'registry';
const FONT_FORMAT = 'woff2';
const FONT_MIME_TYPE = 'font/woff2';
const WRITING_MODES = new Set(['horizontal-tb', 'vertical-rl']);
const FONT_STYLES = new Set(['normal', 'italic', 'oblique']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_FONT_BYTES = 50 * 1024 * 1024;

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'registryKind', 'fonts']);
const ENTRY_KEYS = new Set(['declaration', 'asset', 'license', 'capabilities']);
const DECLARATION_KEYS = new Set(['family', 'version', 'source', 'href', 'sha256']);
const ASSET_KEYS = new Set(['format', 'mimeType', 'byteLength', 'immutable']);
const LICENSE_KEYS = new Set([
    'spdxId',
    'licenseHref',
    'rightsHolder',
    'reviewedAt',
    'reviewedBy',
    'allowsWebDistribution',
    'allowsPortableEmbedding',
]);
const CAPABILITY_KEYS = new Set(['languages', 'writingModes', 'fontWeights', 'fontStyles']);

const PRODUCTION_FONT_ACTIVATIONS = Object.freeze({
    'noto-sans-jp-2.004-h2': Object.freeze({
        assetHref: 'https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2',
        assetBytesVerified: true,
        corsVerified: true,
        mimeTypeVerified: true,
        immutableCacheVerified: true,
        licenseReviewed: true,
        allowsWebDistribution: true,
        allowsPortableEmbedding: true,
        reviewedAt: '2026-08-24',
        reviewedBy: 'DSF Architect',
    }),
    'noto-serif-jp-2.003-h1': Object.freeze({
        assetHref: 'https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2',
        assetBytesVerified: true,
        corsVerified: true,
        mimeTypeVerified: true,
        immutableCacheVerified: true,
        licenseReviewed: true,
        allowsWebDistribution: true,
        allowsPortableEmbedding: true,
        reviewedAt: '2026-08-24',
        reviewedBy: 'DSF Architect',
    }),
});

const ACTIVE_PRODUCTION_FONTS = Object.freeze(Object.fromEntries(
    Object.entries(PRODUCTION_FONT_ACTIVATIONS).map(([fontId, activation]) => [
        fontId,
        createDsfProductionFontEntryFromCandidate(fontId, activation),
    ]),
));

export const DSF_PRODUCTION_FONT_REGISTRY = Object.freeze({
    schemaVersion: DSF_FONT_REGISTRY_SCHEMA_VERSION,
    registryKind: DSF_FONT_REGISTRY_KIND,
    fonts: ACTIVE_PRODUCTION_FONTS,
});

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues, code, path, message) {
    issues.push({ severity: 'error', code, path, message });
}

function validateExactKeys(value, allowedKeys, path, issues) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            addIssue(issues, 'unsupported_font_registry_property', `${path}.${key}`, 'Unsupported registry property.');
        }
    }
}

function validateNonEmptyString(value, path, issues, maximumLength = 256) {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximumLength) {
        addIssue(issues, 'invalid_font_registry_string', path, 'Value must be a non-empty trimmed string.');
        return false;
    }
    return true;
}

function validateId(value, path, issues) {
    const valid = validateNonEmptyString(value, path, issues, 256);
    if (valid && FORBIDDEN_KEYS.has(value)) {
        addIssue(issues, 'forbidden_font_registry_id', path, 'Registry ID is reserved.');
        return false;
    }
    return valid;
}

function validateHttpsUrl(value, path, issues, options = {}) {
    if (!validateNonEmptyString(value, path, issues, 4096)) return null;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        addIssue(issues, 'invalid_font_registry_url', path, 'URL cannot be parsed.');
        return null;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        addIssue(issues, 'unsafe_font_registry_url', path, 'Production registry URLs must use HTTPS without credentials.');
    }
    if (options.immutableAsset) {
        if (!parsed.pathname.toLowerCase().endsWith('.woff2')) {
            addIssue(issues, 'invalid_font_asset_url', path, 'Production font asset must be a direct WOFF2 URL.');
        }
        if (parsed.search || parsed.hash) {
            addIssue(issues, 'mutable_font_asset_url', path, 'Immutable font asset URL cannot contain a query or fragment.');
        }
        const hostname = parsed.hostname.toLowerCase();
        if (
            hostname === 'localhost'
            || hostname.endsWith('.localhost')
            || hostname.endsWith('.test')
            || hostname.endsWith('.invalid')
            || hostname.endsWith('.example')
        ) {
            addIssue(issues, 'non_production_font_asset_url', path, 'Fixture and local hostnames cannot be production font assets.');
        }
    }
    return parsed;
}

function validateStringArray(value, path, issues, validateEntry) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
        addIssue(issues, 'invalid_font_capability', path, 'Capability must be a non-empty bounded array.');
        return;
    }
    const seen = new Set();
    value.forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        if (!validateEntry(entry, entryPath, issues)) return;
        if (seen.has(entry)) {
            addIssue(issues, 'duplicate_font_capability', entryPath, 'Capability values must be unique.');
        }
        seen.add(entry);
    });
}

function validateIsoDate(value, path, issues) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        addIssue(issues, 'invalid_font_license_review_date', path, 'Review date must use YYYY-MM-DD.');
        return;
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        addIssue(issues, 'invalid_font_license_review_date', path, 'Review date is not a real calendar date.');
    }
}

function validateFontDeclaration(declaration, path, issues) {
    if (!isRecord(declaration)) {
        addIssue(issues, 'invalid_font_declaration', path, 'Font declaration must be an object.');
        return;
    }
    validateExactKeys(declaration, DECLARATION_KEYS, path, issues);
    validateNonEmptyString(declaration.family, `${path}.family`, issues);
    validateNonEmptyString(declaration.version, `${path}.version`, issues, 128);
    if (declaration.source !== FONT_SOURCE) {
        addIssue(issues, 'unsupported_production_font_source', `${path}.source`, 'Production web fonts must use the registry source.');
    }
    validateHttpsUrl(declaration.href, `${path}.href`, issues, { immutableAsset: true });
    if (typeof declaration.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(declaration.sha256)) {
        addIssue(issues, 'invalid_font_asset_sha256', `${path}.sha256`, 'Font hash must be the 64-character SHA-256 hex of WOFF2 bytes.');
    }
}

function validateFontAsset(asset, path, issues) {
    if (!isRecord(asset)) {
        addIssue(issues, 'invalid_font_asset', path, 'Font asset metadata must be an object.');
        return;
    }
    validateExactKeys(asset, ASSET_KEYS, path, issues);
    if (asset.format !== FONT_FORMAT) addIssue(issues, 'unsupported_font_asset_format', `${path}.format`, 'Font format must be woff2.');
    if (asset.mimeType !== FONT_MIME_TYPE) addIssue(issues, 'unsupported_font_asset_mime_type', `${path}.mimeType`, 'Font MIME type must be font/woff2.');
    if (!Number.isInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > MAX_FONT_BYTES) {
        addIssue(issues, 'invalid_font_asset_byte_length', `${path}.byteLength`, 'Font byteLength is outside the production limit.');
    }
    if (asset.immutable !== true) {
        addIssue(issues, 'mutable_font_asset', `${path}.immutable`, 'Production font asset must be explicitly immutable.');
    }
}

function validateFontLicense(license, path, issues) {
    if (!isRecord(license)) {
        addIssue(issues, 'invalid_font_license', path, 'Font license metadata must be an object.');
        return;
    }
    validateExactKeys(license, LICENSE_KEYS, path, issues);
    if (!validateNonEmptyString(license.spdxId, `${path}.spdxId`, issues, 64)
        || !/^[A-Za-z0-9.+-]+$/.test(license.spdxId || '')) {
        addIssue(issues, 'invalid_font_license_spdx', `${path}.spdxId`, 'Font license requires an SPDX identifier.');
    }
    validateHttpsUrl(license.licenseHref, `${path}.licenseHref`, issues);
    validateNonEmptyString(license.rightsHolder, `${path}.rightsHolder`, issues, 512);
    validateIsoDate(license.reviewedAt, `${path}.reviewedAt`, issues);
    validateNonEmptyString(license.reviewedBy, `${path}.reviewedBy`, issues, 256);
    if (license.allowsWebDistribution !== true) {
        addIssue(issues, 'font_web_distribution_not_approved', `${path}.allowsWebDistribution`, 'Web distribution must be explicitly approved.');
    }
    if (typeof license.allowsPortableEmbedding !== 'boolean') {
        addIssue(issues, 'invalid_font_portable_embedding_right', `${path}.allowsPortableEmbedding`, 'Portable embedding permission must be an explicit boolean.');
    }
}

function validateFontCapabilities(capabilities, path, issues) {
    if (!isRecord(capabilities)) {
        addIssue(issues, 'invalid_font_capabilities', path, 'Font capabilities must be an object.');
        return;
    }
    validateExactKeys(capabilities, CAPABILITY_KEYS, path, issues);
    validateStringArray(capabilities.languages, `${path}.languages`, issues, (entry, entryPath, nestedIssues) => (
        validateNonEmptyString(entry, entryPath, nestedIssues, 64)
    ));
    validateStringArray(capabilities.writingModes, `${path}.writingModes`, issues, (entry, entryPath, nestedIssues) => {
        if (!WRITING_MODES.has(entry)) {
            addIssue(nestedIssues, 'unsupported_font_writing_mode', entryPath, 'Unsupported writing mode.');
            return false;
        }
        return true;
    });
    if (!Array.isArray(capabilities.fontWeights) || capabilities.fontWeights.length < 1) {
        addIssue(issues, 'invalid_font_capability', `${path}.fontWeights`, 'At least one font weight is required.');
    } else {
        const seen = new Set();
        capabilities.fontWeights.forEach((weight, index) => {
            const entryPath = `${path}.fontWeights[${index}]`;
            if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) {
                addIssue(issues, 'invalid_font_weight_capability', entryPath, 'Font weight must be 100-900 in 100 increments.');
            }
            if (seen.has(weight)) addIssue(issues, 'duplicate_font_capability', entryPath, 'Capability values must be unique.');
            seen.add(weight);
        });
    }
    validateStringArray(capabilities.fontStyles, `${path}.fontStyles`, issues, (entry, entryPath, nestedIssues) => {
        if (!FONT_STYLES.has(entry)) {
            addIssue(nestedIssues, 'unsupported_font_style_capability', entryPath, 'Unsupported font style.');
            return false;
        }
        return true;
    });
}

export function normalizeDsfProductionFontRegistry(input) {
    if (!isRecord(input)) throw new TypeError('DSF production font registry must be an object.');
    return deepClone(input);
}

export function validateDsfProductionFontRegistry(registry) {
    const issues = [];
    if (!isRecord(registry)) {
        addIssue(issues, 'invalid_font_registry', '', 'DSF production font registry must be an object.');
        return { valid: false, issues };
    }
    validateExactKeys(registry, TOP_LEVEL_KEYS, '', issues);
    if (registry.schemaVersion !== DSF_FONT_REGISTRY_SCHEMA_VERSION) {
        addIssue(issues, 'unsupported_font_registry_schema_version', 'schemaVersion', 'Unsupported font registry schema version.');
    }
    if (registry.registryKind !== DSF_FONT_REGISTRY_KIND) {
        addIssue(issues, 'unsupported_font_registry_kind', 'registryKind', 'Registry kind must be production.');
    }
    if (!isRecord(registry.fonts)) {
        addIssue(issues, 'invalid_font_registry_map', 'fonts', 'fonts must be an object map.');
        return { valid: issues.length === 0, issues };
    }
    for (const [fontId, entry] of Object.entries(registry.fonts)) {
        const path = `fonts.${fontId}`;
        validateId(fontId, path, issues);
        if (!isRecord(entry)) {
            addIssue(issues, 'invalid_font_registry_entry', path, 'Font registry entry must be an object.');
            continue;
        }
        validateExactKeys(entry, ENTRY_KEYS, path, issues);
        validateFontDeclaration(entry.declaration, `${path}.declaration`, issues);
        validateFontAsset(entry.asset, `${path}.asset`, issues);
        validateFontLicense(entry.license, `${path}.license`, issues);
        validateFontCapabilities(entry.capabilities, `${path}.capabilities`, issues);
    }
    return { valid: issues.length === 0, issues };
}

export class DsfFontRegistryValidationError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF production font registry.');
        this.name = 'DsfFontRegistryValidationError';
        this.code = 'DSF_FONT_REGISTRY_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export function assertValidDsfProductionFontRegistry(registry) {
    const result = validateDsfProductionFontRegistry(registry);
    if (!result.valid) throw new DsfFontRegistryValidationError(result.issues);
    return registry;
}

export function resolveDsfProductionFont(registry, fontId, requirements = {}) {
    const validation = validateDsfProductionFontRegistry(registry);
    if (!validation.valid) {
        return { ok: false, code: 'FONT_REGISTRY_INVALID', issues: validation.issues };
    }
    const entry = registry.fonts?.[fontId];
    if (!entry) return { ok: false, code: 'FONT_NOT_CERTIFIED', fontId: fontId || null };
    const capabilities = entry.capabilities;
    if (requirements.language && !capabilities.languages.includes(requirements.language)) {
        return { ok: false, code: 'FONT_LANGUAGE_UNSUPPORTED', fontId, language: requirements.language };
    }
    if (requirements.writingMode && !capabilities.writingModes.includes(requirements.writingMode)) {
        return { ok: false, code: 'FONT_WRITING_MODE_UNSUPPORTED', fontId, writingMode: requirements.writingMode };
    }
    const fontWeight = requirements.fontWeight ?? 400;
    if (!capabilities.fontWeights.includes(fontWeight)) {
        return { ok: false, code: 'FONT_WEIGHT_UNSUPPORTED', fontId, fontWeight };
    }
    const fontStyle = requirements.fontStyle || 'normal';
    if (!capabilities.fontStyles.includes(fontStyle)) {
        return { ok: false, code: 'FONT_STYLE_UNSUPPORTED', fontId, fontStyle };
    }
    return {
        ok: true,
        font: {
            id: fontId,
            declaration: deepClone(entry.declaration),
        },
        registryEntry: deepClone(entry),
    };
}

function primaryFontFamily(value) {
    return String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

/**
 * Resolve authoring typography to one production registry entry.
 *
 * Authoring currently stores a CSS font family rather than a registry ID. A
 * family is accepted only when exactly one certified version exists; choosing
 * between multiple production versions implicitly would make pagination
 * evidence non-deterministic.
 */
export function resolveDsfProductionFontByFamily(registry, fontFamily, requirements = {}) {
    const validation = validateDsfProductionFontRegistry(registry);
    if (!validation.valid) {
        return { ok: false, code: 'FONT_REGISTRY_INVALID', issues: validation.issues };
    }
    const family = primaryFontFamily(fontFamily);
    if (!family) return { ok: false, code: 'FONT_FAMILY_REQUIRED', family };
    const matches = Object.entries(registry.fonts || {})
        .filter(([, entry]) => entry?.declaration?.family === family);
    if (matches.length === 0) {
        return { ok: false, code: 'FONT_NOT_CERTIFIED', family };
    }
    if (matches.length > 1) {
        return {
            ok: false,
            code: 'FONT_FAMILY_AMBIGUOUS',
            family,
            fontIds: matches.map(([fontId]) => fontId),
        };
    }
    const [fontId] = matches[0];
    return resolveDsfProductionFont(registry, fontId, requirements);
}
