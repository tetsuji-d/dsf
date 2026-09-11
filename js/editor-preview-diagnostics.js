import { getFlowPressPublicationPreparationIssueMessage } from './flow-press-publication-preparation.js';

export function selectEditorPreviewLanguages(project) {
    return [project.activeLang || project.defaultLang || project.languages?.[0] || 'ja'];
}

const reasons = {
    PREVIEW_CHANGED: ['準備中に原稿が変更されました。編集を終えてから再度プレビューしてください。', 'The manuscript changed during preparation. Finish editing and try again.'],
    FLOW_PUBLICATION_TRANSLATION_NOT_READY: ['翻訳が未作成、または原文変更後の確認が必要です。該当原稿の翻訳を確認してください。', 'Translation is missing or needs review after source changes. Check this manuscript translation.'],
    FLOW_PUBLICATION_BOOK_COMPOSITION_INVALID: ['表紙あり構成では合計を偶数（2ページ以上）にしてください。', 'With covers, the total must be even and at least two pages.'],
    PREVIEW_EMPTY: ['プレビュー用ファイルを生成できませんでした。', 'The preview file could not be generated.'],
};

function reason(code, en) {
    if (Object.hasOwn(reasons, code)) return reasons[code][en ? 1 : 0];
    if (!en) {
        // Never use the legacy helper fallback to issue.message.
        return getFlowPressPublicationPreparationIssueMessage({code});
    }
    if (/^(FONT_|WOFF2_|FLOW_PUBLICATION_CAPTURE_FONT_)/.test(code || '')) return 'The required font could not be verified or loaded. Check the font settings and connection.';
    if (/^FLOW_OBJECT_ANCHOR_/.test(code || '')) return 'Check the paragraph anchors of images and shapes.';
    if (code === 'INVALID_OBJECT_GEOMETRY') return 'An image or shape is outside the text area. Adjust its position or size.';
    if (code === 'FLOW_OBJECT_TITLE_REGION') return 'Image wrapping cannot be applied to a title paragraph.';
    if (/^FLOW_(PUBLICATION_CAPTURE_|PUBLICATION_ANNOTATION_|WRAP_)/.test(code || '')) return 'The text, annotations or image wrapping could not be reproduced within the page. Check this manuscript layout.';
    return 'Preview preparation failed. Check the page layout and image assets, then try again.';
}

export function formatEditorPreviewFailure(error, {project, language, en = false}) {
    const label = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language || '') ? language.toUpperCase() : (en ? 'Selected language' : '選択言語');
    const groups = (project?.blocks || []).filter(block => block?.kind === 'flow');
    const issues = error?.previewIssues?.length ? error.previewIssues : error?.issues?.length ? error.issues : [{code: error?.code || (error?.message === 'PREVIEW_CHANGED' ? 'PREVIEW_CHANGED' : error?.message === 'PREVIEW_EMPTY' ? 'PREVIEW_EMPTY' : '')}];
    const lines = issues.slice(0, 8).map(issue => {
        const index = groups.findIndex(group => group.id === issue.groupId);
        const location = index < 0 ? label : `${label} / ${en ? 'Flow manuscript' : 'Flow原稿'} ${index + 1}`;
        return `${location}: ${reason(issue.code, en)}`;
    });
    return [en ? 'Preview could not be prepared.' : 'プレビューを準備できませんでした。', ...new Set(lines)].join('\n');
}
