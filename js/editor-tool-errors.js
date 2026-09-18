// Public, static recovery guidance. Never include manuscript or exception messages.
const guidance = {
    INVALID_IMAGE_DATA: ['Supply real PNG/JPEG/WebP bytes as raw base64 with the matching MIME type, or ask the user to upload the image.', '実際のPNG・JPEG・WebP画像のBase64と対応する形式を指定してください。画像アップロードも利用できます。'],
    IMAGE_TOO_LARGE: ['Use an image of at most 8 MiB, 16384px per edge and 40 million pixels, or use the normal image upload UI.', '画像受け渡しの上限は8MiB・各辺16384px・4000万画素です。縮小するか通常の画像アップロードを利用してください。'],
    IMAGE_IMPORT_FAILED: ['Image conversion failed. Check the image and local storage, then prepare it again.', '画像変換に失敗しました。画像とローカル保存領域を確認して再度準備してください。'],
    STALE_IMAGE_TOKEN: ['Call dsf_prepare_image_page again and review the placement before adding.', '配置を確認して画像ページの追加準備をやり直してください。'],
    INVALID_IMAGE_ASSET: ['Use an assetId from dsf_list_image_assets; import the image in Assets first.', '画像素材一覧にあるIDを指定してください。画像は先にアセットへ取り込んでください。'],
    INVALID_IMAGE_TARGET: ['Select a page or Flow, or use start/end for the whole work.', 'ページかFlowを選択するか、作品の先頭・末尾を指定してください。'],
    SOURCE_LANGUAGE_REQUIRED: ['Switch to the original manuscript language before appending blocks.', '見出し・段落の追加は原文言語に切り替えて行ってください。'],
    PROJECT_CREATE_FAILED: ['Project creation failed. Check local storage and the current project before retrying.', '新規作成に失敗しました。ローカル保存領域と現在の作品を確認してください。'],
    INVALID_ARGUMENTS: ['Check the tool input schema and supply only the declared fields.', '入力項目と型を確認してください。'],
    BUSY: ['Wait for typing/composition and layout to finish, then retry.', '入力・組版の完了後に再試行してください。'],
    STALE_TEXT: ['Read the paragraph again and review its current text before editing.', '本文が変わりました。段落を取得し直してください。'],
    STALE_EDIT_TOKEN: ['Read the paragraph again to obtain a new editToken.', '段落を取得し直してください。'],
    STALE_WORK_TOKEN: ['Get the editor context again to obtain a new workToken.', '編集対象を取得し直してください。'],
    STALE_CURSOR: ['Restart dsf_list_flow_paragraphs without cursor.', '原稿一覧を先頭から取得し直してください。'],
    TARGET_CHANGED: ['Get the current context and confirm the intended Flow and language with the user.', '対象のFlow・本文言語を確認してください。'],
    LINE_BREAKS_CHANGED: ['Preserve the original line break count, types and order; retry with the full paragraph.', '既存の改行を保った段落全文を指定してください。'],
    NO_CURRENT_FLOW: ['Ask the user to select a Flow manuscript in the editor.', 'エディターでFlow原稿を選択してください。'],
    UNKNOWN_LANGUAGE: ['Use a languageKey returned by dsf_get_editor_context.', '作品に設定されている本文言語を指定してください。'],
    TEXT_TOO_LONG: ['This paragraph exceeds the 12000 UTF-16 code unit limit. Use manual editing.', 'この段落はAI編集の文字数上限を超えています。'],
    INVALID_TARGET: ['List current Flow paragraphs and use an exact heading or paragraph ID.', '原稿一覧から対象の段落を確認してください。'],
    DISABLED: ['Ask the user to enable AI tools in the profile menu.', 'プロフィールでAI連携を有効にしてください。'],
    WORK_CHANGED: ['The work changed. Wait for reconnection, obtain fresh tools and get a new editor context.', '作品が変わりました。再接続後にツールと編集対象を取得し直してください。'],
    NOT_IN_EDITOR: ['Return to the editor. Saved AI access resumes automatically when enabled.', 'エディターに戻ってください。保存済みのAI連携設定で自動再開します。'],
    EDIT_FAILED: ['An edit failed. Re-read the paragraph to check its current state before retrying.', '編集に失敗しました。現在の本文を取得し直してください。'],
};
export function editorToolErrorMessage(code, language = 'en') {
    return (guidance[code] || ['Recheck the editor state and AI tool permission.', '編集状態とAI連携の許可を確認してください。'])[language === 'ja' ? 1 : 0];
}
export function withEditorToolRecovery(result) {
    return result.error ? { ...result, error: { ...result.error, recovery: editorToolErrorMessage(result.error.code) } } : result;
}
