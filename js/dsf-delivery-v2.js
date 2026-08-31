/**
 * Pure DSF delivery v2 model.
 *
 * This module validates and normalizes immutable release projections only. It
 * intentionally has no dependency on Viewer, Press, Firebase, R2, DOM, state,
 * or authoring models. It also maps reading positions between language-specific
 * fixed page sequences without repagination.
 */

import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';
import { deepClone } from './utils.js';

export const DSF_DELIVERY_SCHEMA_VERSION = 2;
export const DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION = 1;
export const DSF_DELIVERY_LAYOUT_MODEL = 'fixed-page-hybrid-1';

export const DSF_DELIVERY_RENDER_KINDS = Object.freeze(['image', 'fixedText']);
export const DSF_DELIVERY_PAGE_DIRECTIONS = Object.freeze(['ltr', 'rtl']);
export const DSF_DELIVERY_WRITING_MODES = Object.freeze(['horizontal-tb', 'vertical-rl']);

export const DSF_DELIVERY_LIMITS = Object.freeze({
    maxLanguages: 32,
    maxFonts: 32,
    maxPagesPerLanguage: 10_000,
    maxStylesPerLanguage: 256,
    maxLinesPerPage: 512,
    maxRunsPerLine: 256,
    maxTextCodeUnitsPerRun: 8_192,
    maxTextCodeUnitsPerPage: 262_144,
    maxIdLength: 256,
    maxLabelLength: 512,
    maxHrefLength: 4_096,
    maxImageDimension: 32_768,
});

const RENDER_KIND_SET = new Set(DSF_DELIVERY_RENDER_KINDS);
const PAGE_DIRECTION_SET = new Set(DSF_DELIVERY_PAGE_DIRECTIONS);
const WRITING_MODE_SET = new Set(DSF_DELIVERY_WRITING_MODES);
const TEXT_ORIENTATION_SET = new Set(['mixed', 'upright']);
const FONT_SOURCE_SET = new Set(['registry', 'embedded']);
const FONT_STYLE_SET = new Set(['normal', 'italic', 'oblique']);
const TEXT_DECORATION_SET = new Set(['none', 'underline', 'line-through', 'underline line-through']);
const TEXT_ALIGN_SET = new Set(['start', 'center', 'end', 'justify']);
const FORBIDDEN_MAP_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FORBIDDEN_EXECUTABLE_KEYS = new Set([
    'html',
    'innerHTML',
    'outerHTML',
    'script',
    'css',
    'style',
    'styleText',
    'eventHandlers',
]);
const ALLOWED_STYLE_KEYS = new Set([
    'fontRef',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'color',
    'textDecoration',
    'textAlign',
    'whiteSpaceMode',
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
        const next = {
            ...issue,
            path: issue.path ? `${prefix}.${issue.path}` : prefix,
        };
        if (typeof issue.firstPath === 'string') {
            next.firstPath = issue.firstPath ? `${prefix}.${issue.firstPath}` : prefix;
        }
        issues.push(next);
    }
}

function validateString(value, path, issues, options = {}) {
    const allowEmpty = options.allowEmpty === true;
    const maximumLength = options.maximumLength ?? DSF_DELIVERY_LIMITS.maxLabelLength;
    if (typeof value !== 'string') {
        addIssue(issues, options.code || 'invalid_string', path, options.message || 'Value must be a string.');
        return false;
    }
    if ((!allowEmpty && !value) || value.length > maximumLength) {
        addIssue(
            issues,
            options.code || 'invalid_string',
            path,
            options.message || `String must contain between ${allowEmpty ? 0 : 1} and ${maximumLength} code units.`,
        );
        return false;
    }
    if (options.trimmed !== false && value !== value.trim()) {
        addIssue(issues, options.code || 'invalid_string', path, options.message || 'String cannot have surrounding whitespace.');
        return false;
    }
    return true;
}

function validateMapKey(value, path, issues, kind = 'Map key') {
    const valid = validateString(value, path, issues, {
        code: 'invalid_map_key',
        maximumLength: DSF_DELIVERY_LIMITS.maxIdLength,
        message: `${kind} must be a non-empty exact key without surrounding whitespace.`,
    });
    if (valid && FORBIDDEN_MAP_KEYS.has(value)) {
        addIssue(issues, 'forbidden_map_key', path, `${kind} is reserved and cannot be used.`);
        return false;
    }
    return valid;
}

function validateStrictId(value, path, issues, kind = 'ID') {
    return validateString(value, path, issues, {
        code: 'invalid_id',
        maximumLength: DSF_DELIVERY_LIMITS.maxIdLength,
        message: `${kind} must be a non-empty string without surrounding whitespace.`,
    });
}

function validateFiniteNumber(value, path, issues, options = {}) {
    const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
    const maximum = options.maximum ?? Number.POSITIVE_INFINITY;
    const valid = typeof value === 'number'
        && Number.isFinite(value)
        && value >= minimum
        && value <= maximum
        && (!options.integer || Number.isInteger(value));
    if (!valid) {
        addIssue(
            issues,
            options.code || 'invalid_number',
            path,
            options.message || 'Value must be a finite number in the supported range.',
        );
        return false;
    }
    return true;
}

function validateSha256(value, path, issues) {
    if (typeof value !== 'string' || !(
        /^[a-f0-9]{64}$/i.test(value)
        || /^sha256-[A-Za-z0-9_-]{43,86}$/.test(value)
    )) {
        addIssue(issues, 'invalid_sha256', path, 'Hash must be a 64-character SHA-256 hex value or sha256- base64url value.');
        return false;
    }
    return true;
}

function validateColor(value, path, issues) {
    if (typeof value !== 'string' || !(
        value === 'transparent'
        || /^#[0-9a-f]{3,4}$/i.test(value)
        || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)
    )) {
        addIssue(issues, 'invalid_color', path, 'Color must be transparent or a supported hexadecimal color.');
        return false;
    }
    return true;
}

function validateResourceHref(value, path, issues, options = {}) {
    const valid = validateString(value, path, issues, {
        code: 'invalid_resource_href',
        maximumLength: DSF_DELIVERY_LIMITS.maxHrefLength,
        message: 'Resource href must be a non-empty URL or relative path without surrounding whitespace.',
    });
    if (!valid) return false;
    if (/[\x00-\x1F\x7F]/.test(value) || value.includes('\\')) {
        addIssue(issues, 'invalid_resource_href', path, 'Resource href contains unsupported control characters or separators.');
        return false;
    }
    let parsed;
    try {
        parsed = new URL(value, 'https://dsf.invalid/release/content.json');
    } catch {
        addIssue(issues, 'invalid_resource_href', path, 'Resource href cannot be parsed.');
        return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        addIssue(issues, 'unsafe_resource_href', path, 'Only relative, HTTP, or HTTPS resource references are supported.');
        return false;
    }
    if (options.requireHttps && parsed.protocol !== 'https:') {
        addIssue(issues, 'unsafe_resource_href', path, 'Registry resources must use HTTPS.');
        return false;
    }
    return true;
}

function findForbiddenExecutableKeys(value, path, issues, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (FORBIDDEN_EXECUTABLE_KEYS.has(key) || /^on[a-z]/i.test(key)) {
            addIssue(issues, 'forbidden_executable_content', childPath, 'HTML, CSS, script, and event-handler payloads are forbidden.');
            continue;
        }
        findForbiddenExecutableKeys(child, childPath, issues, seen);
    }
}

function validateCanonicalPage(value, path, issues) {
    if (!isRecord(value)) {
        addIssue(issues, 'invalid_canonical_page', path, 'canonicalPage must be an object.');
        return;
    }
    if (value.width !== CANONICAL_PAGE_WIDTH) {
        addIssue(issues, 'unsupported_canonical_page', `${path}.width`, `Canonical width must be ${CANONICAL_PAGE_WIDTH}.`);
    }
    if (value.height !== CANONICAL_PAGE_HEIGHT) {
        addIssue(issues, 'unsupported_canonical_page', `${path}.height`, `Canonical height must be ${CANONICAL_PAGE_HEIGHT}.`);
    }
    if (value.aspectRatio !== '9:16') {
        addIssue(issues, 'unsupported_canonical_page', `${path}.aspectRatio`, 'Canonical aspectRatio must be "9:16".');
    }
}

function validateFont(font, path, issues) {
    if (!isRecord(font)) {
        addIssue(issues, 'invalid_font', path, 'Font entry must be an object.');
        return;
    }
    validateString(font.family, `${path}.family`, issues, {
        code: 'invalid_font',
        maximumLength: 256,
        message: 'Font family must be a non-empty string.',
    });
    validateString(font.version, `${path}.version`, issues, {
        code: 'invalid_font',
        maximumLength: 128,
        message: 'Font version must be a non-empty string.',
    });
    if (!FONT_SOURCE_SET.has(font.source)) {
        addIssue(issues, 'unsupported_font_source', `${path}.source`, 'Font source must be registry or embedded.');
    }
    validateResourceHref(font.href, `${path}.href`, issues, { requireHttps: font.source === 'registry' });
    validateSha256(font.sha256, `${path}.sha256`, issues);
}

function validateLanguageDescriptor(descriptor, path, issues) {
    if (!isRecord(descriptor)) {
        addIssue(issues, 'invalid_language_descriptor', path, 'Language descriptor must be an object.');
        return;
    }
    validateResourceHref(descriptor.href, `${path}.href`, issues);
    validateFiniteNumber(descriptor.pageCount, `${path}.pageCount`, issues, {
        code: 'invalid_page_count',
        integer: true,
        minimum: 1,
        maximum: DSF_DELIVERY_LIMITS.maxPagesPerLanguage,
        message: `pageCount must be an integer between 1 and ${DSF_DELIVERY_LIMITS.maxPagesPerLanguage}.`,
    });
    validateSha256(descriptor.sha256, `${path}.sha256`, issues);
    if (!PAGE_DIRECTION_SET.has(descriptor.pageDirection)) {
        addIssue(issues, 'unsupported_page_direction', `${path}.pageDirection`, 'pageDirection must be ltr or rtl.');
    }
}

/** Preserve a persisted index exactly enough for validation and round trips. */
export function normalizeDsfDeliveryIndex(input) {
    if (!isRecord(input)) throw new TypeError('DSF delivery index must be an object.');
    return deepClone(input);
}

export function validateDsfDeliveryIndex(index) {
    const issues = [];
    if (!isRecord(index)) {
        addIssue(issues, 'invalid_delivery_index', '', 'DSF delivery index must be an object.');
        return { valid: false, issues };
    }
    findForbiddenExecutableKeys(index, '', issues);
    if (index.schemaVersion !== DSF_DELIVERY_SCHEMA_VERSION) {
        addIssue(issues, 'unsupported_delivery_schema_version', 'schemaVersion', 'Unsupported DSF delivery schema version.', {
            supportedVersion: DSF_DELIVERY_SCHEMA_VERSION,
        });
    }
    if (index.layoutModel !== DSF_DELIVERY_LAYOUT_MODEL) {
        addIssue(issues, 'unsupported_layout_model', 'layoutModel', `layoutModel must be "${DSF_DELIVERY_LAYOUT_MODEL}".`);
    }
    validateCanonicalPage(index.canonicalPage, 'canonicalPage', issues);

    if (!isRecord(index.fonts)) {
        addIssue(issues, 'invalid_font_map', 'fonts', 'fonts must be an object map.');
    } else {
        const fonts = Object.entries(index.fonts);
        if (fonts.length > DSF_DELIVERY_LIMITS.maxFonts) {
            addIssue(issues, 'font_limit_exceeded', 'fonts', `A release supports at most ${DSF_DELIVERY_LIMITS.maxFonts} fonts.`);
        }
        for (const [fontId, font] of fonts) {
            const path = `fonts.${fontId}`;
            validateMapKey(fontId, path, issues, 'Font ID');
            validateFont(font, path, issues);
        }
    }

    if (!isRecord(index.languages)) {
        addIssue(issues, 'invalid_language_map', 'languages', 'languages must be an exact-key object map.');
    } else {
        const languages = Object.entries(index.languages);
        if (languages.length < 1 || languages.length > DSF_DELIVERY_LIMITS.maxLanguages) {
            addIssue(
                issues,
                'language_limit_exceeded',
                'languages',
                `A release must contain between 1 and ${DSF_DELIVERY_LIMITS.maxLanguages} languages.`,
            );
        }
        for (const [languageKey, descriptor] of languages) {
            const path = `languages.${languageKey}`;
            validateMapKey(languageKey, path, issues, 'Language key');
            validateLanguageDescriptor(descriptor, path, issues);
        }
    }

    const defaultLangValid = validateMapKey(index.defaultLang, 'defaultLang', issues, 'defaultLang');
    if (defaultLangValid && isRecord(index.languages) && !hasOwn(index.languages, index.defaultLang)) {
        addIssue(issues, 'missing_default_language', 'defaultLang', 'defaultLang must exactly match a language descriptor key.');
    }

    return { valid: issues.length === 0, issues };
}

function validateStyle(style, path, issues, fontIds) {
    if (!isRecord(style)) {
        addIssue(issues, 'invalid_text_style', path, 'Text style must be an object.');
        return;
    }
    for (const key of Object.keys(style)) {
        if (!ALLOWED_STYLE_KEYS.has(key)) {
            addIssue(issues, 'unsupported_text_style_property', `${path}.${key}`, 'Text style contains an unsupported property.');
        }
    }
    const validFontRef = validateStrictId(style.fontRef, `${path}.fontRef`, issues, 'fontRef');
    if (validFontRef && fontIds && !fontIds.has(style.fontRef)) {
        addIssue(issues, 'unknown_font_ref', `${path}.fontRef`, 'fontRef is not declared by the delivery index.');
    }
    validateFiniteNumber(style.fontSize, `${path}.fontSize`, issues, {
        code: 'invalid_text_style', minimum: 1, maximum: 256,
    });
    if (!(
        (Number.isInteger(style.fontWeight) && style.fontWeight >= 100 && style.fontWeight <= 900)
        || style.fontWeight === 'normal'
        || style.fontWeight === 'bold'
    )) {
        addIssue(issues, 'invalid_text_style', `${path}.fontWeight`, 'fontWeight must be 100-900, normal, or bold.');
    }
    if (hasOwn(style, 'fontStyle') && !FONT_STYLE_SET.has(style.fontStyle)) {
        addIssue(issues, 'invalid_text_style', `${path}.fontStyle`, 'fontStyle is unsupported.');
    }
    validateFiniteNumber(style.lineHeight, `${path}.lineHeight`, issues, {
        code: 'invalid_text_style', minimum: 0.5, maximum: 10,
    });
    validateFiniteNumber(style.letterSpacing, `${path}.letterSpacing`, issues, {
        code: 'invalid_text_style', minimum: -20, maximum: 100,
    });
    validateColor(style.color, `${path}.color`, issues);
    if (hasOwn(style, 'textDecoration') && !TEXT_DECORATION_SET.has(style.textDecoration)) {
        addIssue(issues, 'invalid_text_style', `${path}.textDecoration`, 'textDecoration is unsupported.');
    }
    if (hasOwn(style, 'textAlign') && !TEXT_ALIGN_SET.has(style.textAlign)) {
        addIssue(issues, 'invalid_text_style', `${path}.textAlign`, 'textAlign is unsupported.');
    }
    if (hasOwn(style, 'whiteSpaceMode') && style.whiteSpaceMode !== 'preserve-v1') {
        addIssue(issues, 'invalid_text_style', `${path}.whiteSpaceMode`, 'whiteSpaceMode must be preserve-v1 when specified.');
    }
}

function validateSourceAnchor(anchor, path, issues) {
    if (!isRecord(anchor)) {
        addIssue(issues, 'invalid_source_anchor', path, 'sourceAnchor must be an object.');
        return;
    }
    if (anchor.kind === 'fixed') {
        validateStrictId(anchor.blockId, `${path}.blockId`, issues, 'Fixed source Block ID');
        return;
    }
    if (anchor.kind === 'flow') {
        validateStrictId(anchor.flowGroupId, `${path}.flowGroupId`, issues, 'Flow Group ID');
        validateStrictId(anchor.firstBlockId, `${path}.firstBlockId`, issues, 'Flow Block ID');
        if (hasOwn(anchor, 'sectionId')) validateStrictId(anchor.sectionId, `${path}.sectionId`, issues, 'Flow Section ID');
        validateFiniteNumber(anchor.blockProgress, `${path}.blockProgress`, issues, {
            code: 'invalid_source_anchor', minimum: 0, maximum: 1,
            message: 'Flow blockProgress must be between 0 and 1.',
        });
        return;
    }
    addIssue(issues, 'unsupported_source_anchor', `${path}.kind`, 'sourceAnchor kind must be fixed or flow.');
}

function validatePageBase(page, path, issues, seenPageIds) {
    const validId = validateStrictId(page.id, `${path}.id`, issues, 'Delivery page ID');
    if (validId) {
        if (seenPageIds.has(page.id)) {
            addIssue(issues, 'duplicate_delivery_page_id', `${path}.id`, 'Delivery page IDs must be unique within a language.', {
                firstPath: seenPageIds.get(page.id),
            });
        } else {
            seenPageIds.set(page.id, `${path}.id`);
        }
    }
    if (!RENDER_KIND_SET.has(page.renderKind)) {
        addIssue(issues, 'unsupported_render_kind', `${path}.renderKind`, 'renderKind must be image or fixedText.');
    }
    validateSourceAnchor(page.sourceAnchor, `${path}.sourceAnchor`, issues);
    if (hasOwn(page, 'pageLabel')) {
        validateString(page.pageLabel, `${path}.pageLabel`, issues, {
            allowEmpty: true,
            trimmed: false,
            code: 'invalid_page_label',
            maximumLength: DSF_DELIVERY_LIMITS.maxLabelLength,
        });
    }
}

function validateImagePage(page, path, issues) {
    if (!isRecord(page.image)) {
        addIssue(issues, 'invalid_image_page', `${path}.image`, 'Image page must contain an image descriptor.');
        return;
    }
    validateResourceHref(page.image.href, `${path}.image.href`, issues);
    validateFiniteNumber(page.image.width, `${path}.image.width`, issues, {
        code: 'invalid_image_dimension', integer: true, minimum: 1, maximum: DSF_DELIVERY_LIMITS.maxImageDimension,
    });
    validateFiniteNumber(page.image.height, `${path}.image.height`, issues, {
        code: 'invalid_image_dimension', integer: true, minimum: 1, maximum: DSF_DELIVERY_LIMITS.maxImageDimension,
    });
    if (page.image.mimeType !== 'image/webp') {
        addIssue(issues, 'unsupported_image_mime_type', `${path}.image.mimeType`, 'Image pages must use image/webp.');
    }
}

function validateRunSource(source, path, issues) {
    if (!isRecord(source)) {
        addIssue(issues, 'invalid_text_source_range', path, 'Text run source must be an object.');
        return;
    }
    validateStrictId(source.blockId, `${path}.blockId`, issues, 'Source Block ID');
    const validStart = validateFiniteNumber(source.startGrapheme, `${path}.startGrapheme`, issues, {
        code: 'invalid_text_source_range', integer: true, minimum: 0,
    });
    const validEnd = validateFiniteNumber(source.endGrapheme, `${path}.endGrapheme`, issues, {
        code: 'invalid_text_source_range', integer: true, minimum: 0,
    });
    if (validStart && validEnd && source.endGrapheme < source.startGrapheme) {
        addIssue(issues, 'invalid_text_source_range', path, 'endGrapheme cannot be smaller than startGrapheme.');
    }
}

function validateTextRun(run, path, issues, stylesById, lineStyle) {
    if (!isRecord(run)) {
        addIssue(issues, 'invalid_text_run', path, 'Text run must be an object.');
        return 0;
    }
    const validText = validateString(run.text, `${path}.text`, issues, {
        allowEmpty: true,
        trimmed: false,
        code: 'invalid_text_run',
        maximumLength: DSF_DELIVERY_LIMITS.maxTextCodeUnitsPerRun,
        message: `Text run must contain at most ${DSF_DELIVERY_LIMITS.maxTextCodeUnitsPerRun} code units.`,
    });
    if (hasOwn(run, 'styleRef')) {
        const validStyleRef = validateStrictId(run.styleRef, `${path}.styleRef`, issues, 'Run styleRef');
        if (validStyleRef && !stylesById.has(run.styleRef)) {
            addIssue(issues, 'unknown_style_ref', `${path}.styleRef`, 'Run styleRef is not declared by the language manifest.');
        }
        const runStyle = validStyleRef ? stylesById.get(run.styleRef) : undefined;
        const lineMode = isRecord(lineStyle) && hasOwn(lineStyle, 'whiteSpaceMode')
            ? lineStyle.whiteSpaceMode : undefined;
        // An omitted run mode inherits its fixed line's mode. An explicit mode
        // cannot change whitespace handling within a single composed line.
        if (isRecord(runStyle) && hasOwn(runStyle, 'whiteSpaceMode') && runStyle.whiteSpaceMode !== lineMode) {
            addIssue(issues, 'incompatible_white_space_mode', `${path}.styleRef`, 'Run whiteSpaceMode must match its line style.');
        }
    }
    if (hasOwn(run, 'source')) validateRunSource(run.source, `${path}.source`, issues);
    return validText ? run.text.length : 0;
}

function validateTextLine(line, path, issues, stylesById, pageWidth, pageHeight) {
    if (!isRecord(line)) {
        addIssue(issues, 'invalid_text_line', path, 'Text line must be an object.');
        return 0;
    }
    const validX = validateFiniteNumber(line.x, `${path}.x`, issues, { code: 'invalid_text_line', minimum: 0, maximum: pageWidth });
    const validY = validateFiniteNumber(line.y, `${path}.y`, issues, { code: 'invalid_text_line', minimum: 0, maximum: pageHeight });
    const validWidth = validateFiniteNumber(line.width, `${path}.width`, issues, { code: 'invalid_text_line', minimum: Number.EPSILON, maximum: pageWidth });
    const validHeight = validateFiniteNumber(line.height, `${path}.height`, issues, { code: 'invalid_text_line', minimum: Number.EPSILON, maximum: pageHeight });
    if (validX && validWidth && line.x + line.width > pageWidth + 1e-6) {
        addIssue(issues, 'text_line_out_of_bounds', path, 'Text line exceeds the canonical page width.');
    }
    if (validY && validHeight && line.y + line.height > pageHeight + 1e-6) {
        addIssue(issues, 'text_line_out_of_bounds', path, 'Text line exceeds the canonical page height.');
    }
    if (!WRITING_MODE_SET.has(line.writingMode)) {
        addIssue(issues, 'unsupported_writing_mode', `${path}.writingMode`, 'writingMode must be horizontal-tb or vertical-rl.');
    }
    if (!TEXT_ORIENTATION_SET.has(line.textOrientation)) {
        addIssue(issues, 'unsupported_text_orientation', `${path}.textOrientation`, 'textOrientation must be mixed or upright.');
    }
    const validStyleRef = validateStrictId(line.styleRef, `${path}.styleRef`, issues, 'Line styleRef');
    if (validStyleRef && !stylesById.has(line.styleRef)) {
        addIssue(issues, 'unknown_style_ref', `${path}.styleRef`, 'Line styleRef is not declared by the language manifest.');
    }
    if (!Array.isArray(line.runs) || line.runs.length < 1 || line.runs.length > DSF_DELIVERY_LIMITS.maxRunsPerLine) {
        addIssue(issues, 'invalid_text_runs', `${path}.runs`, `Line must contain between 1 and ${DSF_DELIVERY_LIMITS.maxRunsPerLine} runs.`);
        return 0;
    }
    return line.runs.reduce((total, run, runIndex) => (
        total + validateTextRun(run, `${path}.runs[${runIndex}]`, issues, stylesById,
            validStyleRef ? stylesById.get(line.styleRef) : undefined)
    ), 0);
}

function validateFixedTextPage(page, path, issues, stylesById, pageWidth, pageHeight) {
    if (hasOwn(page, 'background')) {
        if (!isRecord(page.background)) {
            addIssue(issues, 'invalid_text_background', `${path}.background`, 'Text page background must be an object.');
        } else {
            if (hasOwn(page.background, 'color')) validateColor(page.background.color, `${path}.background.color`, issues);
            if (hasOwn(page.background, 'imageHref')) validateResourceHref(page.background.imageHref, `${path}.background.imageHref`, issues);
        }
    }
    if (!Array.isArray(page.lines) || page.lines.length > DSF_DELIVERY_LIMITS.maxLinesPerPage) {
        addIssue(issues, 'invalid_text_lines', `${path}.lines`, `Text page must contain at most ${DSF_DELIVERY_LIMITS.maxLinesPerPage} lines.`);
        return;
    }
    let pageTextLength = 0;
    page.lines.forEach((line, lineIndex) => {
        pageTextLength += validateTextLine(
            line,
            `${path}.lines[${lineIndex}]`,
            issues,
            stylesById,
            pageWidth,
            pageHeight,
        );
    });
    if (pageTextLength > DSF_DELIVERY_LIMITS.maxTextCodeUnitsPerPage) {
        addIssue(issues, 'text_page_limit_exceeded', `${path}.lines`, `Text page exceeds ${DSF_DELIVERY_LIMITS.maxTextCodeUnitsPerPage} code units.`);
    }
}

/** Preserve a persisted language manifest exactly enough for validation and round trips. */
export function normalizeDsfLanguageManifest(input) {
    if (!isRecord(input)) throw new TypeError('DSF language manifest must be an object.');
    return deepClone(input);
}

export function validateDsfLanguageManifest(manifest, options = {}) {
    const issues = [];
    if (!isRecord(manifest)) {
        addIssue(issues, 'invalid_language_manifest', '', 'DSF language manifest must be an object.');
        return { valid: false, issues };
    }
    findForbiddenExecutableKeys(manifest, '', issues);
    if (manifest.schemaVersion !== DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION) {
        addIssue(issues, 'unsupported_language_manifest_schema_version', 'schemaVersion', 'Unsupported language manifest schema version.', {
            supportedVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
        });
    }
    const languageValid = validateMapKey(manifest.language, 'language', issues, 'Language key');
    if (languageValid && options.expectedLanguage !== undefined && manifest.language !== options.expectedLanguage) {
        addIssue(issues, 'language_manifest_mismatch', 'language', 'Language manifest key does not match the delivery index.');
    }

    const validateFontRefs = options.fontIds !== undefined;
    const fontIds = options.fontIds instanceof Set
        ? options.fontIds
        : new Set(Array.isArray(options.fontIds) ? options.fontIds : []);
    const stylesById = new Map();
    if (!isRecord(manifest.styles)) {
        addIssue(issues, 'invalid_style_map', 'styles', 'styles must be an object map.');
    } else {
        const styles = Object.entries(manifest.styles);
        if (styles.length > DSF_DELIVERY_LIMITS.maxStylesPerLanguage) {
            addIssue(issues, 'style_limit_exceeded', 'styles', `A language supports at most ${DSF_DELIVERY_LIMITS.maxStylesPerLanguage} styles.`);
        }
        for (const [styleId, style] of styles) {
            const path = `styles.${styleId}`;
            if (validateMapKey(styleId, path, issues, 'Style ID')) stylesById.set(styleId, style);
            validateStyle(style, path, issues, validateFontRefs ? fontIds : null);
        }
    }

    if (!Array.isArray(manifest.pages)) {
        addIssue(issues, 'invalid_delivery_pages', 'pages', 'pages must be an ordered array.');
        return { valid: issues.length === 0, issues };
    }
    if (manifest.pages.length < 1 || manifest.pages.length > DSF_DELIVERY_LIMITS.maxPagesPerLanguage) {
        addIssue(
            issues,
            'page_limit_exceeded',
            'pages',
            `A language must contain between 1 and ${DSF_DELIVERY_LIMITS.maxPagesPerLanguage} pages.`,
        );
    }
    if (options.expectedPageCount !== undefined && manifest.pages.length !== options.expectedPageCount) {
        addIssue(issues, 'page_count_mismatch', 'pages', 'Language manifest page count does not match the delivery index.', {
            expectedPageCount: options.expectedPageCount,
            actualPageCount: manifest.pages.length,
        });
    }

    const pageWidth = Number.isFinite(options.pageWidth) && options.pageWidth > 0
        ? options.pageWidth
        : CANONICAL_PAGE_WIDTH;
    const pageHeight = Number.isFinite(options.pageHeight) && options.pageHeight > 0
        ? options.pageHeight
        : CANONICAL_PAGE_HEIGHT;
    const seenPageIds = new Map();
    manifest.pages.forEach((page, pageIndex) => {
        const path = `pages[${pageIndex}]`;
        if (!isRecord(page)) {
            addIssue(issues, 'invalid_delivery_page', path, 'Delivery page must be an object.');
            return;
        }
        validatePageBase(page, path, issues, seenPageIds);
        if (page.renderKind === 'image') {
            validateImagePage(page, path, issues);
            if (hasOwn(page, 'lines')) {
                addIssue(issues, 'ambiguous_page_payload', `${path}.lines`, 'Image pages cannot contain fixed-text lines.');
            }
        }
        if (page.renderKind === 'fixedText') {
            validateFixedTextPage(page, path, issues, stylesById, pageWidth, pageHeight);
            if (hasOwn(page, 'image')) {
                addIssue(issues, 'ambiguous_page_payload', `${path}.image`, 'Fixed-text pages cannot contain an image page descriptor.');
            }
        }
    });

    return { valid: issues.length === 0, issues };
}

export function normalizeDsfDeliveryBundle(input) {
    if (!isRecord(input)) throw new TypeError('DSF delivery bundle must be an object.');
    const source = deepClone(input);
    if (isRecord(source.index)) source.index = normalizeDsfDeliveryIndex(source.index);
    if (isRecord(source.manifests)) {
        source.manifests = Object.fromEntries(Object.entries(source.manifests).map(([languageKey, manifest]) => [
            languageKey,
            isRecord(manifest) ? normalizeDsfLanguageManifest(manifest) : manifest,
        ]));
    }
    return source;
}

export function validateDsfDeliveryBundle(bundle) {
    const issues = [];
    if (!isRecord(bundle)) {
        addIssue(issues, 'invalid_delivery_bundle', '', 'DSF delivery bundle must be an object.');
        return { valid: false, issues };
    }
    const indexResult = validateDsfDeliveryIndex(bundle.index);
    prefixIssues(issues, 'index', indexResult.issues);
    if (!isRecord(bundle.manifests)) {
        addIssue(issues, 'invalid_manifest_map', 'manifests', 'manifests must be an exact-key language map.');
        return { valid: issues.length === 0, issues };
    }

    const indexLanguages = isRecord(bundle.index?.languages) ? bundle.index.languages : {};
    const fontIds = new Set(isRecord(bundle.index?.fonts) ? Object.keys(bundle.index.fonts) : []);
    for (const languageKey of Object.keys(indexLanguages)) {
        if (!hasOwn(bundle.manifests, languageKey)) {
            addIssue(issues, 'missing_language_manifest', `manifests.${languageKey}`, 'Delivery bundle is missing a language manifest.');
            continue;
        }
        const result = validateDsfLanguageManifest(bundle.manifests[languageKey], {
            expectedLanguage: languageKey,
            expectedPageCount: indexLanguages[languageKey]?.pageCount,
            fontIds,
            pageWidth: bundle.index?.canonicalPage?.width,
            pageHeight: bundle.index?.canonicalPage?.height,
        });
        prefixIssues(issues, `manifests.${languageKey}`, result.issues);
    }
    for (const languageKey of Object.keys(bundle.manifests)) {
        validateMapKey(languageKey, `manifests.${languageKey}`, issues, 'Manifest language key');
        if (!hasOwn(indexLanguages, languageKey)) {
            addIssue(issues, 'unexpected_language_manifest', `manifests.${languageKey}`, 'Language manifest is not declared by the delivery index.');
        }
    }

    return { valid: issues.length === 0, issues };
}

export class DsfDeliveryValidationError extends Error {
    constructor(issues) {
        const first = issues?.[0];
        super(first ? `Invalid DSF delivery v2 at ${first.path || '<root>'}: ${first.message}` : 'Invalid DSF delivery v2.');
        this.name = 'DsfDeliveryValidationError';
        this.code = 'DSF_DELIVERY_V2_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export function assertValidDsfDeliveryIndex(index) {
    const result = validateDsfDeliveryIndex(index);
    if (!result.valid) throw new DsfDeliveryValidationError(result.issues);
    return index;
}

export function assertValidDsfLanguageManifest(manifest, options = {}) {
    const result = validateDsfLanguageManifest(manifest, options);
    if (!result.valid) throw new DsfDeliveryValidationError(result.issues);
    return manifest;
}

export function assertValidDsfDeliveryBundle(bundle) {
    const result = validateDsfDeliveryBundle(bundle);
    if (!result.valid) throw new DsfDeliveryValidationError(result.issues);
    return bundle;
}

function resolveNormalizedReadingProgress(sourceIndex, sourceCount, targetCount) {
    if (targetCount < 1) return -1;
    if (sourceCount <= 1 || targetCount <= 1) return 0;
    const progress = sourceIndex / (sourceCount - 1);
    return Math.max(0, Math.min(targetCount - 1, Math.round(progress * (targetCount - 1))));
}

function findClosestFlowAnchorPage(targetPages, sourceAnchor) {
    let best = null;
    targetPages.forEach((page, pageIndex) => {
        const anchor = page?.sourceAnchor;
        if (
            anchor?.kind !== 'flow'
            || anchor.flowGroupId !== sourceAnchor.flowGroupId
            || anchor.firstBlockId !== sourceAnchor.firstBlockId
        ) return;
        const distance = Math.abs((Number(anchor.blockProgress) || 0) - (Number(sourceAnchor.blockProgress) || 0));
        if (!best || distance < best.distance) best = { pageIndex, distance };
    });
    return best?.pageIndex ?? -1;
}

/**
 * Map a page selection between two already-paginated language sequences.
 * This never mutates, measures, composes, or repaginates text.
 */
export function mapDsfLanguagePage(sourceManifest, targetManifest, sourcePageIndex) {
    if (!isRecord(sourceManifest) || !Array.isArray(sourceManifest.pages)) {
        throw new TypeError('Source language manifest must contain pages.');
    }
    if (!isRecord(targetManifest) || !Array.isArray(targetManifest.pages)) {
        throw new TypeError('Target language manifest must contain pages.');
    }
    if (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0 || sourcePageIndex >= sourceManifest.pages.length) {
        throw new RangeError('Source page index is outside the source language sequence.');
    }
    if (!targetManifest.pages.length) {
        return { pageIndex: -1, strategy: 'empty-target', sourceAnchor: null };
    }

    const sourcePage = sourceManifest.pages[sourcePageIndex];
    const anchor = sourcePage?.sourceAnchor;
    if (anchor?.kind === 'fixed' && typeof anchor.blockId === 'string') {
        const targetIndex = targetManifest.pages.findIndex((page) => (
            page?.sourceAnchor?.kind === 'fixed'
            && page.sourceAnchor.blockId === anchor.blockId
        ));
        if (targetIndex >= 0) {
            return { pageIndex: targetIndex, strategy: 'fixed-anchor', sourceAnchor: deepClone(anchor) };
        }
    }

    if (
        anchor?.kind === 'flow'
        && typeof anchor.flowGroupId === 'string'
        && typeof anchor.firstBlockId === 'string'
    ) {
        const targetIndex = findClosestFlowAnchorPage(targetManifest.pages, anchor);
        if (targetIndex >= 0) {
            return { pageIndex: targetIndex, strategy: 'flow-block-progress', sourceAnchor: deepClone(anchor) };
        }
    }

    return {
        pageIndex: resolveNormalizedReadingProgress(
            sourcePageIndex,
            sourceManifest.pages.length,
            targetManifest.pages.length,
        ),
        strategy: 'reading-progress',
        sourceAnchor: isRecord(anchor) ? deepClone(anchor) : null,
    };
}

export function getDsfDeliveryV2Versions() {
    return Object.freeze({
        delivery: DSF_DELIVERY_SCHEMA_VERSION,
        languageManifest: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
        layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
    });
}
