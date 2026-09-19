import {
    DsfDeliveryValidationError,
    normalizeDsfDeliveryBundle,
    validateDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import { applyFixedTextWhiteSpaceStyle, renderFixedTextRunText } from './fixed-text-whitespace.js';

export const DSF_VIEWER_FIXED_TEXT_CONTEXT_VERSION = 1;

const FONT_CERTIFICATE_FIELDS = Object.freeze(['family', 'version', 'source', 'href', 'sha256']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
    return Object.freeze(value);
}

function createViewerError(code, message, details = {}) {
    return new DsfViewerFixedTextError(code, message, details);
}

function quoteFontFamily(family) {
    return `"${String(family).replace(/["\\]/g, '')}"`;
}

function getReferencedFontIds(manifest) {
    return [...new Set(Object.values(manifest.styles || {})
        .map((style) => style?.fontRef)
        .filter((fontRef) => typeof fontRef === 'string' && fontRef))];
}

function certificateMatches(declaration, certificate) {
    return FONT_CERTIFICATE_FIELDS.every((field) => declaration?.[field] === certificate?.[field]);
}

async function loadCertifiedFont(fontId, declaration, certificate, manifest, fontFaceSet) {
    if (!certificateMatches(declaration, certificate)) {
        throw createViewerError(
            'FONT_CERTIFICATE_MISMATCH',
            `Font "${fontId}" does not match the Viewer certificate.`,
            { fontId },
        );
    }
    if (!fontFaceSet || typeof fontFaceSet.load !== 'function' || typeof fontFaceSet.check !== 'function') {
        throw createViewerError('FONT_API_UNAVAILABLE', 'The browser font loading API is unavailable.', { fontId });
    }

    const sampleStyle = Object.values(manifest.styles || {}).find((style) => style?.fontRef === fontId);
    const fontSize = Number(sampleStyle?.fontSize) || 16;
    const descriptor = `${fontSize}px ${quoteFontFamily(declaration.family)}`;
    let loadedFaces;
    try {
        loadedFaces = await fontFaceSet.load(descriptor, '永Ag');
    } catch (error) {
        throw createViewerError('CERTIFIED_FONT_LOAD_FAILED', `Certified font "${fontId}" could not be loaded.`, {
            fontId,
            cause: error?.message || String(error),
        });
    }
    if (!Array.isArray(loadedFaces) || loadedFaces.length < 1 || !fontFaceSet.check(descriptor, '永Ag')) {
        throw createViewerError('CERTIFIED_FONT_UNAVAILABLE', `Certified font "${fontId}" is not available.`, { fontId });
    }
}

export class DsfViewerFixedTextError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'DsfViewerFixedTextError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Validate an immutable local release bundle and fail closed unless every used
 * font exactly matches a host-provided certificate and is loaded by the browser.
 */
export async function prepareDsfViewerFixedTextContext({
    bundle,
    language,
    certifiedFonts,
    fontFaceSet,
}) {
    const normalizedBundle = normalizeDsfDeliveryBundle(bundle);
    const validation = validateDsfDeliveryBundle(normalizedBundle);
    if (!validation.valid) throw new DsfDeliveryValidationError(validation.issues);

    const manifest = normalizedBundle.manifests?.[language];
    if (!manifest) {
        throw createViewerError('LANGUAGE_MANIFEST_MISSING', `Language manifest "${language}" is missing.`, { language });
    }
    if (!isRecord(certifiedFonts)) {
        throw createViewerError('FONT_CERTIFICATES_MISSING', 'Viewer font certificates are required.');
    }

    const certifiedFontRefs = [];
    for (const fontId of getReferencedFontIds(manifest)) {
        const declaration = normalizedBundle.index.fonts?.[fontId];
        const certificate = certifiedFonts[fontId];
        if (!certificate) {
            throw createViewerError('FONT_NOT_CERTIFIED', `Font "${fontId}" is not certified by this Viewer.`, { fontId });
        }
        await loadCertifiedFont(fontId, declaration, certificate, manifest, fontFaceSet);
        certifiedFontRefs.push(fontId);
    }

    deepFreeze(normalizedBundle);
    return Object.freeze({
        contextVersion: DSF_VIEWER_FIXED_TEXT_CONTEXT_VERSION,
        language,
        index: normalizedBundle.index,
        manifest,
        certifiedFontRefs: Object.freeze(certifiedFontRefs),
    });
}

function assertPreparedContext(context) {
    if (
        !isRecord(context)
        || context.contextVersion !== DSF_VIEWER_FIXED_TEXT_CONTEXT_VERSION
        || !Object.isFrozen(context)
        || !isRecord(context.manifest)
        || !isRecord(context.index)
    ) {
        throw createViewerError('FIXED_TEXT_CONTEXT_INVALID', 'A prepared fixed-text Viewer context is required.');
    }
}

function getStyle(context, styleRef) {
    const style = context.manifest.styles?.[styleRef];
    if (!style) throw createViewerError('FIXED_TEXT_STYLE_MISSING', `Style "${styleRef}" is missing.`, { styleRef });
    if (!context.certifiedFontRefs.includes(style.fontRef)) {
        throw createViewerError('FIXED_TEXT_FONT_NOT_READY', `Style font "${style.fontRef}" is not ready.`, {
            styleRef,
            fontRef: style.fontRef,
        });
    }
    return style;
}

function applyTextStyle(element, style, context) {
    const font = context.index.fonts[style.fontRef];
    element.style.fontFamily = quoteFontFamily(font.family);
    element.style.fontSize = `${style.fontSize}px`;
    element.style.fontWeight = String(style.fontWeight);
    element.style.fontStyle = style.fontStyle || 'normal';
    element.style.lineHeight = String(style.lineHeight);
    element.style.letterSpacing = `${style.letterSpacing}px`;
    element.style.color = style.color;
    element.style.textDecoration = style.textDecoration || 'none';
    element.style.textAlign = style.textAlign || 'start';
}

function createBackgroundImage(documentRef, imageHref, resolveAssetHref) {
    const image = documentRef.createElement('img');
    image.className = 'viewer-fixed-text-background';
    image.alt = '';
    image.draggable = false;
    image.src = resolveAssetHref(imageHref);
    image.setAttribute('aria-hidden', 'true');
    return image;
}

/** Build a fixed 360x640 text surface using DOM textContent only. */
export function createDsfFixedTextPageElement({
    documentRef,
    page,
    context,
    resolveAssetHref = (href) => href,
}) {
    if (!documentRef || typeof documentRef.createElement !== 'function') {
        throw new TypeError('A DOM document is required.');
    }
    assertPreparedContext(context);
    if (!isRecord(page) || page.renderKind !== 'fixedText') {
        throw createViewerError('UNSUPPORTED_FIXED_TEXT_PAGE', 'A fixedText delivery page is required.');
    }
    const persistedPage = context.manifest.pages.find((candidate) => candidate.id === page.id);
    if (!persistedPage || persistedPage.renderKind !== 'fixedText') {
        throw createViewerError('FIXED_TEXT_PAGE_NOT_VALIDATED', 'Page is not part of the validated language manifest.', {
            pageId: page.id,
        });
    }

    const root = documentRef.createElement('div');
    root.className = 'viewer-fixed-text-page';
    root.dataset.deliveryPageId = persistedPage.id;
    root.dataset.wrapping = 'forbidden';
    root.setAttribute('lang', context.language);
    root.setAttribute('role', 'document');
    if (persistedPage.pageLabel) root.setAttribute('aria-label', persistedPage.pageLabel);
    root.style.width = `${context.index.canonicalPage.width}px`;
    root.style.height = `${context.index.canonicalPage.height}px`;
    if (persistedPage.background?.color) root.style.backgroundColor = persistedPage.background.color;
    if (persistedPage.background?.imageHref) {
        root.append(createBackgroundImage(documentRef, persistedPage.background.imageHref, resolveAssetHref));
    }

    persistedPage.lines.forEach((line) => {
        const lineElement = documentRef.createElement('div');
        lineElement.className = 'viewer-fixed-text-line';
        const annotation = /-(ruby|emphasis)$/.exec(line.styleRef || '');
        if (!annotation) lineElement.dataset.readingLine = line.writingMode === 'vertical-rl' ? 'vertical' : 'horizontal';
        else lineElement.dataset.readingAnnotation = annotation[1];
        lineElement.dataset.readingStyle = (line.styleRef || '').replace(/-(ruby|emphasis)$/, '');
        lineElement.style.left = `${line.x}px`;
        lineElement.style.top = `${line.y}px`;
        lineElement.style.width = `${line.width}px`;
        lineElement.style.height = `${line.height}px`;
        lineElement.style.writingMode = line.writingMode;
        lineElement.style.textOrientation = line.textOrientation;
        const lineStyle = getStyle(context, line.styleRef);
        applyTextStyle(lineElement, lineStyle, context);
        applyFixedTextWhiteSpaceStyle(lineElement, lineStyle.whiteSpaceMode);

        line.runs.forEach((run) => {
            const runElement = documentRef.createElement('span');
            runElement.className = 'viewer-fixed-text-run';
            if (run.styleRef) applyTextStyle(runElement, getStyle(context, run.styleRef), context);
            renderFixedTextRunText(runElement, run.text, lineStyle.whiteSpaceMode, documentRef);
            lineElement.append(runElement);
        });
        root.append(lineElement);
    });
    return root;
}

export function getDsfViewerPageRenderKind(page) {
    const deliveryPage = page?.deliveryV2;
    if (!deliveryPage) return 'legacyImage';
    if (deliveryPage.renderKind === 'image' || deliveryPage.renderKind === 'fixedText') {
        return deliveryPage.renderKind;
    }
    return 'unsupported';
}

/** Create one page node; callers uniformly scale its canonical parent stage. */
export function createDsfViewerPageContentElement({
    documentRef,
    page,
    context,
    imageUrl,
    imageClassName = 'viewer-page-image',
    resolveAssetHref,
}) {
    const renderKind = getDsfViewerPageRenderKind(page);
    if (renderKind === 'fixedText') {
        return createDsfFixedTextPageElement({
            documentRef,
            page: page.deliveryV2,
            context,
            resolveAssetHref,
        });
    }
    if (renderKind === 'legacyImage' || renderKind === 'image') {
        if (!imageUrl) throw createViewerError('VIEWER_IMAGE_MISSING', 'Image page asset is missing.');
        const image = documentRef.createElement('img');
        image.className = imageClassName;
        image.src = imageUrl;
        image.loading = 'eager';
        image.alt = '';
        return image;
    }
    throw createViewerError('UNSUPPORTED_VIEWER_RENDER_KIND', 'The delivery page render kind is unsupported.');
}
