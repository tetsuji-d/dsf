/**
 * 9A-6B production Flow preparation gate.
 *
 * This adapter uses only the production-certified font registry. It does not
 * assemble, estimate, persist, upload, download, or publish a DSF release.
 */

import {
    DSF_PRODUCTION_FONT_REGISTRY,
    resolveDsfProductionFontByFamily,
} from './dsf-font-registry.js';
import { fetchDsfProductionFontRuntimeLease } from './dsf-production-font-runtime.js';
import { prepareFlowPressPreflight } from './flow-press-preflight-preparation.js';

export const FLOW_PRESS_PUBLICATION_PREPARATION_VERSION = 1;

const ISSUE_MESSAGES = Object.freeze({
    FLOW_OBJECT_ANCHOR_MISSING: '画像・図形の紐づけ先がありません。Flow画像一覧から本文段落を指定してください。',
    FLOW_OBJECT_ANCHOR_CONFLICT: '同じ段落に複数の画像・図形があります。紐づけ先を別の段落へ変更してください。',
    FLOW_OBJECT_TITLE_REGION: '扉の段落には画像を回り込ませられません。通常の本文段落を選んでください。',
    INVALID_OBJECT_GEOMETRY: '画像・図形が本文領域の外にあります。配置か大きさを調整してください。',
    FLOW_WRAP_ANCHOR_MISMATCH: '画像と本文の組版結果が一致しないため発行を停止しました。再度準備してください。',

    FLOW_PUBLICATION_ANNOTATION_MISMATCH: '原稿と配信用のルビ・圏点が一致しないため発行を停止しました。',
    FLOW_PUBLICATION_CAPTURE_ANNOTATION_MISMATCH: 'ルビ・圏点の表示と原稿が一致しないため発行を停止しました。',
    FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH: '文字や注釈の配置を固定テキストで再現できないため発行を停止しました。',
    FONT_NOT_CERTIFIED: 'このFlow原稿のフォントは本番配信用としてまだ認定されていません。',
    FONT_FAMILY_REQUIRED: 'Flow原稿の本番配信用フォントを指定してください。',
    FONT_FAMILY_AMBIGUOUS: '同じfont familyに複数の本番版があるため、配信版を一意に決められません。',
    FONT_REGISTRY_INVALID: '本番フォント登録情報に不整合があります。',
    FONT_LANGUAGE_UNSUPPORTED: '本番フォントがこの言語を認定範囲に含んでいません。',
    FONT_WRITING_MODE_UNSUPPORTED: '本番フォントがこの組方向を認定範囲に含んでいません。',
    FONT_WEIGHT_UNSUPPORTED: '本番フォントが本文または見出しの太さを認定範囲に含んでいません。',
    FONT_STYLE_UNSUPPORTED: '本番フォントがこの文字スタイルを認定範囲に含んでいません。',
    FONT_ASSET_FETCH_FAILED: '本番フォントの固定URLからWOFF2を取得できませんでした。',
    FONT_ASSET_RESPONSE_MIME_MISMATCH: '本番フォントの配信MIMEがfont/woff2ではありません。',
    FONT_ASSET_RESPONSE_LENGTH_MISMATCH: '本番フォントの配信byteLengthがregistryと一致しません。',
    FONT_ASSET_BYTE_LENGTH_MISMATCH: '本番フォントの実byteLengthがregistryと一致しません。',
    FONT_ASSET_SHA256_MISMATCH: '本番フォントの実SHA-256がregistryと一致しません。',
    WOFF2_SIGNATURE_INVALID: '本番フォントassetがWOFF2形式ではありません。',
    FONT_RUNTIME_API_UNAVAILABLE: 'このブラウザーでは検証済みフォントの一時読込を実行できません。',
    FONT_RUNTIME_FACE_LOAD_FAILED: '検証済みWOFF2をブラウザーがfontとして解析できませんでした。',
    FONT_RUNTIME_FACE_CHECK_FAILED: '検証済みWOFF2を組版用fontとして選択できませんでした。',
    FONT_RUNTIME_LEASE_INVALID: '検証済みfont runtimeの準備結果が不正です。',
    FLOW_PUBLICATION_TRANSLATION_NOT_READY: '翻訳本文にmissingまたはstaleがあるため、原文へ代替せず停止しました。',
    FLOW_PUBLICATION_CAPTURE_FONT_UNAVAILABLE: '認定フォントをこのブラウザーで読み込めませんでした。',
    FLOW_PUBLICATION_CAPTURE_PAGE_OVERFLOW: '本番認定条件で再計測するとページ内に収まりません。',
    FLOW_PUBLICATION_PROJECTION_MISSING: '本番配信用の固定テキストprojectionを作成できませんでした。',
});

export function getFlowPressPublicationPreparationIssueMessage(issue) {
    return ISSUE_MESSAGES[issue?.code] || issue?.message || 'Flow配信の本番準備を完了できませんでした。';
}

export async function prepareFlowPressPublication(options = {}) {
    const fontRegistry = options.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const dependencies = options.dependencies || {};
    const resolveProductionFont = dependencies.resolveProductionFont
        || ((fontFamily, language, writingMode, context) => {
            const resolution = resolveDsfProductionFontByFamily(fontRegistry, fontFamily, {
                language,
                writingMode,
                fontWeight: context.typography.fontWeight ?? 400,
                fontStyle: 'normal',
            });
            return resolution.ok
                ? { ...resolution, fontId: resolution.font.id }
                : resolution;
        });
    const prepareProductionFont = dependencies.prepareProductionFont
        || ((context) => {
            const bodyWeight = Number(context.typography.fontWeight ?? 400);
            const requiredWeights = new Set([bodyWeight]);
            if (context.group.flow?.document?.sections?.some((section) => (
                section.blocks?.some((block) => block.type === 'heading')
            ))) requiredWeights.add(700);
            return fetchDsfProductionFontRuntimeLease({
                registry: fontRegistry,
                fontId: context.fontResolution.fontId,
                documentRef: context.ownerDocument,
                fontWeights: [...requiredWeights],
                fontStyle: 'normal',
                signal: context.signal,
                fetchImpl: options.fetchImpl,
                cryptoRef: options.cryptoRef,
                FontFaceCtor: options.FontFaceCtor,
            });
        });
    const result = await prepareFlowPressPreflight({
        ...options,
        preparationKind: 'production',
        fontRegistry,
        resolveFont: resolveProductionFont,
        prepareFont: prepareProductionFont,
        dependencies,
    });
    return Object.freeze({
        ...result,
        publicationPreparationVersion: FLOW_PRESS_PUBLICATION_PREPARATION_VERSION,
        productionFontCount: Object.keys(fontRegistry.fonts || {}).length,
    });
}
