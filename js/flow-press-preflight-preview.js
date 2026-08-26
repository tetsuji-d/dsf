/** Development-only 9A-6A Flow Press adapter. */

import { prepareFlowPressPreflight } from './flow-press-preflight-preparation.js';
import {
    FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY,
    resolveFlowPressPreflightFixtureFont,
} from './fixtures/flow-press-preflight-fixture.js';

export const FLOW_PRESS_PREFLIGHT_PREVIEW_VERSION = 1;

const ISSUE_MESSAGES = Object.freeze({
    FLOW_PUBLICATION_TRANSLATION_NOT_READY: '翻訳本文にmissingまたはstaleがあるため、原文へ代替せず停止しました。',
    FLOW_PUBLICATION_PREVIEW_FONT_UNAVAILABLE: 'この言語・組方向・fontはローカル固定テキスト候補確認の対象外です。',
    FLOW_PUBLICATION_CAPTURE_LANGUAGE_INCOMPLETE: 'この言語のFlow本文が揃っていません。',
    FLOW_PUBLICATION_CAPTURE_TYPOGRAPHY_MISSING: 'この言語のFlow組版設定がありません。',
    FLOW_PUBLICATION_CAPTURE_FONT_UNAVAILABLE: 'ローカル確認用fontをブラウザで読み込めませんでした。',
    FLOW_PUBLICATION_CAPTURE_PAGE_OVERFLOW: '認定条件で再計測するとページ内に収まりません。',
    FLOW_PUBLICATION_PROJECTION_MISSING: '固定テキストprojectionを作成できませんでした。',
    MAX_PAGES_EXCEEDED: 'Flowページ数が安全上限を超えました。',
});

export function getFlowPressPreflightPreviewIssueMessage(issue) {
    return ISSUE_MESSAGES[issue?.code] || issue?.message || 'Flow固定テキスト候補の確認に失敗しました。';
}

export async function prepareFlowPressPreflightPreview(options = {}) {
    const dependencies = options.dependencies || {};
    const resolveFixtureFont = dependencies.resolveFixtureFont
        || resolveFlowPressPreflightFixtureFont;
    const result = await prepareFlowPressPreflight({
        ...options,
        preparationKind: 'development-fixture',
        fontRegistry: options.fontRegistry || FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY,
        resolveFont(fontFamily, language, writingMode) {
            const resolved = resolveFixtureFont(fontFamily, language, writingMode);
            return resolved?.fontId
                ? resolved
                : {
                    ok: false,
                    code: 'FLOW_PUBLICATION_PREVIEW_FONT_UNAVAILABLE',
                    message: 'No local certified-font fixture matches this Flow typography.',
                };
        },
        dependencies,
    });
    return Object.freeze({
        ...result,
        previewVersion: FLOW_PRESS_PREFLIGHT_PREVIEW_VERSION,
    });
}
