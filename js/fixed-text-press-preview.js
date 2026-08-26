/**
 * Development-only Press preview adapter for 9A-3B.
 *
 * The caller must gate this module behind `import.meta.env.DEV`. Its fixture
 * font declarations are never publication certificates and the output is not
 * a release artifact.
 */

import {
    DSF_DELIVERY_LAYOUT_MODEL,
    DSF_DELIVERY_SCHEMA_VERSION,
    validateDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import { projectFixedTextBlockToDsfV2 } from './fixed-text-delivery-projection.js';
import { composeTextPreviewModel } from './text-press-html.js';
import {
    createDsfFixedTextPageElement,
    prepareDsfViewerFixedTextContext,
} from './viewer-fixed-text.js';
import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';
import { getFixedTextPressPreviewFontFixture } from './fixtures/fixed-text-press-preview-fixture.js';

export const FIXED_TEXT_PRESS_PREVIEW_VERSION = 1;

const PREVIEW_MANIFEST_HASH = 'f'.repeat(64);

const FALLBACK_MESSAGES = Object.freeze({
    NOT_FIXED_TEXT_PAGE: 'Fixed textページではありません。',
    FIXED_BLOCK_ID_INVALID: '固定ページIDを確認できません。',
    FIXED_TEXT_LANGUAGE_INVALID: '言語設定を確認できません。',
    DELIVERY_PAGE_ID_INVALID: '配信ページIDを確認できません。',
    RUBY_UNSUPPORTED: 'ルビは初期fixedText形式では未対応です。',
    FIXED_TEXT_OVERLAY_UNSUPPORTED: 'レイヤー・吹き出し・操作要素があるためWebPへ合成します。',
    FIXED_TEXT_COMPOSITION_SOURCE_UNVERIFIED: '本文と組版snapshotの一致を確認できません。',
    FIXED_TEXT_COMPOSITION_INVALID: '組版snapshotが固定テキスト配信条件を満たしません。',
    FIXED_TEXT_OVERFLOW: 'ページから溢れた本文があるためWebP経路を維持します。',
    HORIZONTAL_ALIGNMENT_METRICS_REQUIRED: '横書き中央／末尾揃えの実測位置がまだ未対応です。',
    TATE_CHU_YOKO_UNSUPPORTED: '縦中横は初期fixedText形式では未対応です。',
    FONT_NOT_CERTIFIED: 'このフォントはローカルfixedText fixtureの対象外です。',
    FIXED_TEXT_COMPOSITION_FONT_UNVERIFIED: '組版に使ったフォントとfixtureの一致を確認できません。',
    FONT_COMPOSITION_MISMATCH: '組版フォントと配信フォントが一致しません。',
    FIXED_TEXT_PROJECTION_INVALID: '配信v2検証に失敗しました。',
    FIXED_TEXT_PREVIEW_FONT_UNAVAILABLE: 'ローカルpreview用フォントを読み込めませんでした。',
});

function imageFallback(code, message, blockId, language, details = {}) {
    return {
        ok: false,
        previewVersion: FIXED_TEXT_PRESS_PREVIEW_VERSION,
        renderKind: 'image',
        fallback: { code, message, blockId, language, details },
    };
}

function getRawText(section, language) {
    return typeof section?.texts?.[language] === 'string'
        ? section.texts[language]
        : String(section?.text || '');
}

function quoteFontFamily(family) {
    return `"${String(family || '').replace(/["\\]/g, '')}"`;
}

export function getFixedTextPressPreviewFallbackMessage(result) {
    const code = result?.fallback?.code || 'UNKNOWN';
    return FALLBACK_MESSAGES[code] || result?.fallback?.message || 'WebP経路を維持します。';
}

export function createFixedTextPressPreviewBundle({ projection, pageDirection = 'ltr' }) {
    if (!projection?.ok || projection.renderKind !== 'fixedText') {
        throw new TypeError('A successful fixedText projection is required.');
    }
    const language = projection.manifest.language;
    const fontId = projection.font.id;
    return {
        index: {
            schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
            layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
            canonicalPage: {
                width: CANONICAL_PAGE_WIDTH,
                height: CANONICAL_PAGE_HEIGHT,
                aspectRatio: '9:16',
            },
            defaultLang: language,
            fonts: { [fontId]: { ...projection.font.declaration } },
            languages: {
                [language]: {
                    href: `fixtures/press-${language}.json`,
                    pageCount: 1,
                    sha256: PREVIEW_MANIFEST_HASH,
                    pageDirection: pageDirection === 'rtl' ? 'rtl' : 'ltr',
                },
            },
        },
        manifests: { [language]: projection.manifest },
    };
}

/** Load the fixture font, recompose, project, and prepare the shared Viewer renderer. */
export async function prepareFixedTextPressPreview(options = {}) {
    const {
        block,
        section,
        language,
        pageId,
        pageLabel,
        languageConfigs = {},
        documentRef = globalThis.document,
        composePreview = composeTextPreviewModel,
        resolveFontFixture = getFixedTextPressPreviewFontFixture,
    } = options;
    const blockId = typeof block?.id === 'string' ? block.id : null;
    if (!documentRef?.fonts) {
        return imageFallback(
            'FIXED_TEXT_PREVIEW_FONT_UNAVAILABLE',
            'The browser font loading API is unavailable.',
            blockId,
            language,
        );
    }

    const preliminary = composePreview(section, language, languageConfigs);
    const fixtureFont = resolveFontFixture(preliminary?.composed?.font?.family);
    if (!fixtureFont) {
        return imageFallback(
            'FONT_NOT_CERTIFIED',
            'No local Press preview font fixture matches the composition font.',
            blockId,
            language,
        );
    }

    const family = fixtureFont.declaration.family;
    const descriptor = `${Number(preliminary?.composed?.font?.size) || 16}px ${quoteFontFamily(family)}`;
    try {
        await documentRef.fonts.ready;
        const loaded = await documentRef.fonts.load(descriptor, '永Ag');
        if (!Array.isArray(loaded) || loaded.length < 1 || !documentRef.fonts.check(descriptor, '永Ag')) {
            return imageFallback(
                'FIXED_TEXT_PREVIEW_FONT_UNAVAILABLE',
                `Preview font "${family}" is unavailable.`,
                blockId,
                language,
                { family },
            );
        }
    } catch (error) {
        return imageFallback(
            'FIXED_TEXT_PREVIEW_FONT_UNAVAILABLE',
            `Preview font "${family}" could not be loaded.`,
            blockId,
            language,
            { family, cause: error?.message || String(error) },
        );
    }

    const fresh = composePreview(section, language, languageConfigs);
    const rawText = getRawText(section, language);
    const projection = projectFixedTextBlockToDsfV2({
        block,
        language,
        pageId,
        pageLabel,
        composition: fresh.composed,
        compositionEvidence: {
            sourceText: rawText,
            layoutVersion: fresh.composed?.version,
            fontId: fixtureFont.id,
            fontSha256: fixtureFont.declaration.sha256,
        },
        certifiedFont: fixtureFont,
    });
    if (!projection.ok) {
        return {
            ...projection,
            previewVersion: FIXED_TEXT_PRESS_PREVIEW_VERSION,
        };
    }

    const pageDirection = languageConfigs?.[language]?.pageDirection
        || (fresh.composed.writingMode === 'vertical-rl' ? 'rtl' : 'ltr');
    const bundle = createFixedTextPressPreviewBundle({ projection, pageDirection });
    const validation = validateDsfDeliveryBundle(bundle);
    if (!validation.valid) {
        return imageFallback(
            'FIXED_TEXT_PROJECTION_INVALID',
            'The local Press preview bundle is invalid.',
            blockId,
            language,
            { issues: validation.issues },
        );
    }
    const context = await prepareDsfViewerFixedTextContext({
        bundle,
        language,
        certifiedFonts: { [fixtureFont.id]: { ...fixtureFont.declaration } },
        fontFaceSet: documentRef.fonts,
    });
    return {
        ...projection,
        previewVersion: FIXED_TEXT_PRESS_PREVIEW_VERSION,
        bundle,
        context,
        page: context.manifest.pages[0],
    };
}

export function createFixedTextPressPreviewElement({ documentRef, result }) {
    if (!result?.ok || result.renderKind !== 'fixedText') {
        throw new TypeError('A prepared fixedText Press preview is required.');
    }
    return createDsfFixedTextPageElement({
        documentRef,
        page: result.page,
        context: result.context,
    });
}
