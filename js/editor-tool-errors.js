// Public, static recovery guidance. Never include manuscript or exception messages.
const guidance = {
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
    WORK_CHANGED: ['The work changed. Ask the user to enable AI tools for this work.', '作品が変わりました。AI連携を有効にし直してください。'],
    NOT_IN_EDITOR: ['Ask the user to return to the editor and enable AI tools.', 'エディターでAI連携を有効にしてください。'],
    EDIT_FAILED: ['An edit failed. Re-read the paragraph to check its current state before retrying.', '編集に失敗しました。現在の本文を取得し直してください。'],
};
export function editorToolErrorMessage(code, language = 'en') {
    return (guidance[code] || ['Recheck the editor state and AI tool permission.', '編集状態とAI連携の許可を確認してください。'])[language === 'ja' ? 1 : 0];
}
export function withEditorToolRecovery(result) {
    return result.error ? { ...result, error: { ...result.error, recovery: editorToolErrorMessage(result.error.code) } } : result;
}
