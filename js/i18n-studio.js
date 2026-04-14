/**
 * i18n-studio.js
 * Studio UI言語切替（JA / EN）
 * ポータルと同じdata-i18n属性システムを採用。
 */

const STORAGE_KEY = 'dsf_studio_ui_lang';

export const STRINGS = {
    ja: {
        // Room Nav
        nav_projects:         'プロジェクト',
        nav_editor:           'エディター',
        nav_press:            'プレス',
        nav_works:            '作品',
        logo_title:           'DSF Portal を開く',

        // Home Room
        home_title:           'プロジェクト',
        home_section_cloud:   'クラウド',
        home_section_local:   'ローカル',
        home_loading:         '読み込み中...',
        home_cloud_error:     'クラウド一覧を取得できませんでした',
        home_cloud_login:     'ログインするとクラウドのプロジェクトを表示します',
        home_cloud_empty:     'クラウドに保存されたプロジェクトはありません',
        home_local_empty:     '最近読み書きしたローカルプロジェクトはありません',
        home_local_open_error:'ローカルプロジェクトを開けませんでした: {message}',
        home_delete_confirm:  '「{name}」を削除しますか？',
        home_delete_error:    '削除に失敗しました: {message}',
        home_source_cloud:    'クラウド',
        home_source_local:    'ローカル',
        home_pages_count:     '{count}ページ',
        btn_new_project:      '新規プロジェクト',
        btn_open_local:       'ローカルから開く',
        btn_open_cloud:       'クラウドから開く',
        home_empty_1:         'プロジェクトがありません',
        home_empty_2:         '新規作成またはファイルを開いてください',

        // Ribbon Tabs
        tab_home:             'ホーム',
        tab_insert:           '挿入',
        tab_arrange:          '配置',
        tab_export:           '書き出し',

        // Ribbon – Home
        btn_undo:             '元に戻す',
        btn_redo:             'やり直す',
        btn_save:             '保存',
        btn_share:            '共有',
        btn_assets:           'アセット',
        btn_edit_panel:       '編集',
        btn_project_settings: 'プロジェクト設定',
        mobile_home_undo:     '元に戻す',
        mobile_home_redo:     'やり直す',
        mobile_home_save:     '保存',
        mobile_home_project_settings: 'プロジェクト設定',
        placeholder_work_title: '作品タイトル',

        // Ribbon – Insert
        btn_add_section:      '画像ページ',
        btn_add_text_section: 'テキストページ',
        btn_add_bubble:       'テキスト追加',
        btn_add_image:        '画像追加',
        label_text_overflow:  '溢れあり',
        hint_ruby_syntax:     'ルビ: {漢字|かんじ} または ｛漢字｜かんじ｝',
        placeholder_drop_image: '画像をドロップ',
        placeholder_or_click: 'またはクリックして選択',

        // Ribbon – Arrange
        btn_fit_view:         '全体表示',
        btn_adjust_img:       '画像調整',
        label_canvas:         'キャンバス',
        btn_fit:              'フィット',

        // Ribbon – Export
        btn_save_dsp:         'DSP 保存',
        btn_press_room:       'Press Room →',

        // Auth
        auth_warning:         'ログインでクラウド機能が有効化されます',
        btn_signin:           'Googleでサインイン',
        btn_signout:          'サインアウト',
        themeLabel:           '表示モード',
        modeDevice:           'デバイス',
        modeLight:            'ライト',
        modeDark:             'ダーク',
        restrictedMode:       '制限付きモード',
        location:             '言語・地域',
        settings:             '設定',
        help:                 'ヘルプ',
        feedback:             'フィードバック',

        // Sidebar – Assets
        panel_assets:         'アセット',
        btn_close:            '閉じる',
        btn_upload_image:     '画像をアップロード',

        // Sidebar – Pages (mobile)
        panel_pages:          'ページ',
        label_columns:        '列数:',
        label_thumb_size:     'サイズ:',
        btn_add_section_sm:   '+ セクション追加',
        thumb_delete_drop:    'ここにドロップで削除',

        // Icon bar
        icon_assets:          'アセット',

        // Right Panel
        panel_edit:           '編集',
        label_bg_image:       '背景画像変更 / 位置調整',
        btn_change_image:     '画像変更',
        btn_adjust:           '調整',
        label_bubble_shape:   'テキストボックス形状',
        shape_speech:         '角丸フキダシ',
        shape_oval:           '楕円フキダシ',
        shape_rect:           '四角フキダシ',
        shape_cloud:          '雲フキダシ',
        shape_wave:           '波フキダシ',
        shape_thought:        '思考フキダシ',
        shape_explosion:      '💥 爆発フキダシ',
        shape_digital:        '📡 電子音フキダシ',
        shape_shout:          '⚡ ギザギザフキダシ',
        shape_flash:          '✨ フラッシュフキダシ',
        shape_urchin:         '🦔 ウニフラッシュフキダシ',
        label_stroke:         '外形線',
        label_fill:           '塗り',
        label_font_color:     '文字色',
        label_recent_colors:  '最近使った色',
        btn_delete:           '削除',

        // Page strip
        page_strip_label:     'ページ',

        // Project Settings Modal
        ps_modal_title:          'プロジェクト設定',
        ps_section_project_name: 'プロジェクト名',
        ps_project_name_hint:    'プロジェクト管理用の内部名称です（ファイル名・一覧表示に使用）。',
        ps_section_lang:         '言語設定',
        ps_active_langs:         '対応言語',
        btn_add_lang:            '＋ 追加',
        ps_section_basic_info:   '基本情報',
        ps_section_global:       'グローバル設定',
        ps_rating_label:         'レーティング（対象年齢）',
        rating_all:              '全年齢',
        ps_license_label:        'ライセンス',
        btn_cancel:              'キャンセル',
        btn_save:                '保存',
        ps_default_badge:        '★ デフォルト',

        // Meta field labels (PS table)
        field_title:             'タイトル',
        field_author:            '著者',
        field_description:       '説明文',
        field_copyright:         '著作権',

        // Press Room
        press_subtitle:          'DSP → DSF レンダリング・発行',
        btn_back_editor:         '← Editor に戻る',
        press_pages:             'ページ一覧',
        press_settings:          'レンダリング設定',
        press_target_lang:       '対象言語',
        press_webp_quality:      'WebP 品質',
        press_output_size:       '出力サイズ',
        press_res_360:           '360×640（プレビュー・開発）',
        press_res_720:           '720×1280（プレビュー）',
        press_res_1080:          '1080×1920（FHD・既定）',
        press_res_1440:          '1440×2560（WQHD）',
        press_res_2160:          '2160×3840（4K）',
        press_render_note:       'レンダリングはエクスポート時に実行されます',
        press_estimating_size:   'サイズ計測中...',
        press_preparing:         '準備中...',
        press_rendering_progress:'レンダリング中 {done}/{total}',
        press_saving_firestore:  'Firestoreに保存中...',
        press_publish:           '発行',
        btn_export_dsf:          'DSF 書き出し',
        btn_export_dsf_sub:      '.dsf ファイルを保存',
        btn_publish_cloud:       'クラウドに発行',
        btn_publish_cloud_sub:   'Firebase に保存して公開',
        btn_goto_works:          'Works Room へ',
        btn_goto_works_sub:      '発行済み作品のステータス管理',

        // Works Room placeholder
        works_note:              '発行済み作品のステータス管理（実装予定）',
        btn_open_works:          'Works を開く',

        // Modals
        modal_works_title:       '📚 Works Room',
        modal_projects_title:    'プロジェクト一覧',
        btn_new_project_modal:   '＋ 新規プロジェクト',
        btn_modal_close:         '閉じる',

        // Mobile
        mobile_title:            'DSF Studio',
        btn_auth_mobile:         'サインイン',
        bottom_home:             'ホーム',
        bottom_pages:            'ページ',
        bottom_add:              '追加',
        bottom_edit:             '編集',
        bottom_export:           '書き出し',
        bottom_new_project:      '新規',
        bottom_open_local:       'ローカル',
        bottom_menu:             'メニュー',
        bottom_lang:             '言語',
        mobile_save_cloud:       'クラウド保存',
        mobile_open_local:       'ローカルから開く (.dsp)',
        mobile_export_dsp:       'Project (.dsp)',
        mobile_export_dsf:       'Publish (.dsf)',
        mobile_projects:         'プロジェクト一覧',

        // Dynamic strings (used in app.js via t())
        confirm_remove_lang:     '「{lang}」を削除しますか？\nこの言語のすべてのテキストが失われます。',
        guest_label:             'ゲスト',
        login_prompt:            'ログインでクラウド保存',
        login_required:          'ログインすると利用できます',
        project_title_default:   '新規プロジェクト',
        saving:                  '保存中...',
        saved:                   '保存済み',
        save_error:              '保存失敗',
        zip_generating:          '⏳ ZIP生成中...',
    },
    en: {
        // Room Nav
        nav_projects:         'Projects',
        nav_editor:           'Editor',
        nav_press:            'Press',
        nav_works:            'Works',
        logo_title:           'Open DSF Portal',

        // Home Room
        home_title:           'Projects',
        home_section_cloud:   'Cloud',
        home_section_local:   'Local',
        home_loading:         'Loading...',
        home_cloud_error:     'Failed to load cloud projects',
        home_cloud_login:     'Sign in to view cloud projects',
        home_cloud_empty:     'No cloud projects yet',
        home_local_empty:     'No recent local projects yet',
        home_local_open_error:'Could not open the local project: {message}',
        home_delete_confirm:  'Delete "{name}"?',
        home_delete_error:    'Delete failed: {message}',
        home_source_cloud:    'Cloud',
        home_source_local:    'Local',
        home_pages_count:     '{count} pages',
        btn_new_project:      'New Project',
        btn_open_local:       'Open Local',
        btn_open_cloud:       'Open Cloud',
        home_empty_1:         'No projects yet',
        home_empty_2:         'Create a new project or open a file',

        // Ribbon Tabs
        tab_home:             'Home',
        tab_insert:           'Insert',
        tab_arrange:          'Arrange',
        tab_export:           'Export',

        // Ribbon – Home
        btn_undo:             'Undo',
        btn_redo:             'Redo',
        btn_save:             'Save',
        btn_share:            'Share',
        btn_assets:           'Assets',
        btn_edit_panel:       'Edit',
        btn_project_settings: 'Project Settings',
        mobile_home_undo:     'Undo',
        mobile_home_redo:     'Redo',
        mobile_home_save:     'Save',
        mobile_home_project_settings: 'Project Settings',
        placeholder_work_title: 'Work title',

        // Ribbon – Insert
        btn_add_section:      'Image Page',
        btn_add_text_section: 'Text Page',
        btn_add_bubble:       'Add Text',
        btn_add_image:        'Add Image',
        label_text_overflow:  'Overflow',
        hint_ruby_syntax:     'Ruby: {base|reading}',
        placeholder_drop_image: 'Drop image here',
        placeholder_or_click: 'or click to select',

        // Ribbon – Arrange
        btn_fit_view:         'Fit View',
        btn_adjust_img:       'Adjust Image',
        label_canvas:         'Canvas',
        btn_fit:              'Fit',

        // Ribbon – Export
        btn_save_dsp:         'Save DSP',
        btn_press_room:       'Press Room →',

        // Auth
        auth_warning:         'Sign in to enable cloud features',
        btn_signin:           'Sign in with Google',
        btn_signout:          'Sign out',
        themeLabel:           'Theme',
        modeDevice:           'Device',
        modeLight:            'Light',
        modeDark:             'Dark',
        restrictedMode:       'Restricted Mode',
        location:             'Language & Region',
        settings:             'Settings',
        help:                 'Help',
        feedback:             'Feedback',

        // Sidebar – Assets
        panel_assets:         'Assets',
        btn_close:            'Close',
        btn_upload_image:     'Upload Image',

        // Sidebar – Pages (mobile)
        panel_pages:          'Pages',
        label_columns:        'Columns:',
        label_thumb_size:     'Size:',
        btn_add_section_sm:   '+ Add Section',
        thumb_delete_drop:    'Drop here to delete',

        // Icon bar
        icon_assets:          'Assets',

        // Right Panel
        panel_edit:           'Edit',
        label_bg_image:       'Change Background / Adjust',
        btn_change_image:     'Change Image',
        btn_adjust:           'Adjust',
        label_bubble_shape:   'Text Box Style',
        shape_speech:         'Rounded',
        shape_oval:           'Oval',
        shape_rect:           'Rectangle',
        shape_cloud:          'Cloud',
        shape_wave:           'Wave',
        shape_thought:        'Thought',
        shape_explosion:      '💥 Explosion',
        shape_digital:        '📡 Electronic',
        shape_shout:          '⚡ Shout',
        shape_flash:          '✨ Flash',
        shape_urchin:         '🦔 Urchin Flash',
        label_stroke:         'Stroke',
        label_fill:           'Fill',
        label_font_color:     'Text Color',
        label_recent_colors:  'Recent Colors',
        btn_delete:           'Delete',

        // Page strip
        page_strip_label:     'Pages',

        // Project Settings Modal
        ps_modal_title:          'Project Settings',
        ps_section_project_name: 'Project Name',
        ps_project_name_hint:    'Internal name for project management (used in file name and list view).',
        ps_section_lang:         'Language Settings',
        ps_active_langs:         'Active Languages',
        btn_add_lang:            '+ Add',
        ps_section_basic_info:   'Basic Info',
        ps_section_global:       'Global Settings',
        ps_rating_label:         'Rating (Age Rating)',
        rating_all:              'All Ages',
        ps_license_label:        'License',
        btn_cancel:              'Cancel',
        btn_save:                'Save',
        ps_default_badge:        '★ Default',

        // Meta field labels (PS table)
        field_title:             'Title',
        field_author:            'Author',
        field_description:       'Description',
        field_copyright:         'Copyright',

        // Press Room
        press_subtitle:          'DSP → DSF Rendering & Publishing',
        btn_back_editor:         '← Back to Editor',
        press_pages:             'Pages',
        press_settings:          'Render Settings',
        press_target_lang:       'Target Language',
        press_webp_quality:      'WebP Quality',
        press_output_size:       'Output Size',
        press_res_360:           '360×640 (preview / dev)',
        press_res_720:           '720×1280 (preview)',
        press_res_1080:          '1080×1920 (FHD, default)',
        press_res_1440:          '1440×2560 (WQHD)',
        press_res_2160:          '2160×3840 (4K)',
        press_render_note:       'Rendering happens on export',
        press_estimating_size:   'Estimating size...',
        press_preparing:         'Preparing...',
        press_rendering_progress:'Rendering {done}/{total}',
        press_saving_firestore:  'Saving to Firestore...',
        press_publish:           'Publish',
        btn_export_dsf:          'Export DSF',
        btn_export_dsf_sub:      'Save .dsf file',
        btn_publish_cloud:       'Publish to Cloud',
        btn_publish_cloud_sub:   'Save to Firebase and publish',
        btn_goto_works:          'Go to Works Room',
        btn_goto_works_sub:      'Manage published work status',

        // Works Room placeholder
        works_note:              'Manage published works (coming soon)',
        btn_open_works:          'Open Works',

        // Modals
        modal_works_title:       '📚 Works Room',
        modal_projects_title:    'Projects',
        btn_new_project_modal:   '+ New Project',
        btn_modal_close:         'Close',

        // Mobile
        mobile_title:            'DSF Studio',
        btn_auth_mobile:         'Sign in',
        bottom_home:             'Home',
        bottom_pages:            'Pages',
        bottom_add:              'Add',
        bottom_edit:             'Edit',
        bottom_export:           'Export',
        bottom_new_project:      'New',
        bottom_open_local:       'Local',
        bottom_menu:             'Menu',
        bottom_lang:             'Lang',
        mobile_save_cloud:       'Save to Cloud',
        mobile_open_local:       'Open Local (.dsp)',
        mobile_export_dsp:       'Project (.dsp)',
        mobile_export_dsf:       'Publish (.dsf)',
        mobile_projects:         'Projects',

        // Dynamic strings (used in app.js via t())
        confirm_remove_lang:     'Remove "{lang}"?\nAll text in this language will be lost.',
        guest_label:             'Guest',
        login_prompt:            'Sign in to save to cloud',
        login_required:          'Sign in to use this feature',
        project_title_default:   'New Project',
        saving:                  'Saving...',
        saved:                   'Saved',
        save_error:              'Save failed',
        zip_generating:          '⏳ Generating ZIP...',
    },
};

// ── 言語の初期化 ──────────────────────────────────────────
let _lang = localStorage.getItem(STORAGE_KEY)
    || (navigator.language?.startsWith('ja') ? 'ja' : 'en');
if (!STRINGS[_lang]) _lang = 'ja';

export function getUILang() { return _lang; }

export function setUILang(lang) {
    if (!STRINGS[lang]) return;
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyI18n();
}

/**
 * 翻訳関数。変数は {key} 形式で埋め込み。
 * 例: t('confirm_remove_lang', { lang: '日本語' })
 */
export function t(key, vars = {}) {
    const str = STRINGS[_lang]?.[key] ?? STRINGS.ja?.[key] ?? key;
    return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/**
 * DOM全体にi18nを適用する。
 * data-i18n          → textContent
 * data-i18n-placeholder → placeholder属性
 * data-i18n-title    → title属性
 * data-i18n-aria     → aria-label属性
 */
export function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    // 言語スイッチャーのactive状態を更新
    document.querySelectorAll('.ui-lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === _lang);
    });
    // <html lang>属性を更新
    document.documentElement.lang = _lang;
}
