# DSFのユーザー向け用語体系

更新: 2026-10-06。ユーザー向け表示の変更。コミット・配備は未実施。

## 正式名称

| 名称 | 意味 |
|---|---|
| DSF Studio | リードの原稿を作成・編集する |
| DSF Reader | リードを読むための標準閲覧環境。旧表示名 DSF Viewer |
| Horizon | リードを探す・公開する・集めるプラットフォーム |
| リード / Read | DSFで作成・公開されるコンテンツ1件。小説、雑誌、観光パンフレット、自治体広報、マニュアル、写真集、漫画、ノート、スケジュール帳などを含む |
| リーズ / Reads | リードの複数形。一覧やカテゴリの名称に使う |
| DSF / .dsf | 配布フォーマットとファイル形式 |

日本語画面は「リード」「リーズ」。用語説明だけ Read / Reads を併記する。原稿・プロジェクト・ページ・本文・素材はそれぞれの対象を指すときに維持する。「最近の作業」は作業履歴なので維持する。実際の製本・紙・表紙・背表紙・冊子・書籍カテゴリ・本棚・EPUBの説明を指す Book は維持する。本文データを指す Content も維持する。OSのファイルプレビューは Preview と呼び、Readerと区別する。

Horizon・Studio・Reader共通メニューの「使い方」に「Horizonの用語」を設けた。通常のボタンに説明文は繰り返さない。将来の注釈・手書き等は今回追加せず、未実装機能の提供をUIで約束しない。

## 調査分類と変更境界

| 分類 | 調査対象・対応 |
|---|---|
| ユーザー向け表示 | Horizon一覧、Studioナビ・公開・共有・招待・タイトル、Reader情報・エラー・空状態、My Page・管理画面を更新 |
| 内部実装 | viewer*、work*、book*、content* の関数・変数・DOM ID・CSS・イベント名は維持 |
| URL | /viewer、/viewer.html と work/r/draft/editorPreview 等の引数を維持 |
| API | 公開・下書き・共有のエンドポイントとpayloadは維持。人に表示するReaderエラー文だけ更新 |
| DB・データモデル | workId、Project/Work/Release参照、Firestoreコレクション、保存処理・権限ルールは維持 |
| DSF/DSP仕様 | book/content/meta/manifest等のフィールド、ZIP内容、本文・画像・言語別データは維持。変換・移行なし |
| ドキュメント | README、CLAUDEの製品表、現行メニュー方針、この用語集を更新。歴史資料・仕様内の技術名は維持 |
| テスト | 用語・印刷翻訳・旧URL・PWA識別子の回帰確認追加。既存タイトル検証を現在のUI言語別placeholderに対応 |
| PWA / manifest | 現在の登録名はDSF Studio。id=/studio、起動URL、scope、Service Workerパスを維持。Readerという別PWAへの再登録はしない |
| SEO / metadata | 読書画面title=DSF Reader。Horizon/Readerにdescription、og:title、og:descriptionを追加。canonical・共有URLは変更なし |
| i18n | JA/ENのキーを保ち値を更新。印刷の日本語検索キーと英訳の対応を保持。中国語等の原稿入力例は今回のJA/EN名称変更対象外 |

調査はコード・HTML・設定・文書・テストを横断。検索ヒットを一括変更せず、人向け文字列を選別した。今回変更前のソースとの構文比較で、文言以外の差は共通ヘルプの追加、検索入力の翻訳済み読み上げ名、印刷の日本語文言処理に限定。保存・描画ロジックは変更なし。

## 検証

- stagingビルド成功（既存の大きいbundle警告あり）。このリポジトリに独立したlint/typecheckスクリプトはない。
- verify-product-terminology: 日英名称、印刷辞書、本・本文の意味、公開/下書き旧URL、PWA識別子。
- verify-menu-language、verify-flow-multilingual-authoring、verify-press-readiness-i18n、verify-project-title-surfaces。
- verify-portal-public-feed、verify-viewer-release-route、verify-owner-draft-viewer、verify-dsf-local-viewer-package。
- verify-platform-update-build、verify-ui-icon-build。git diff --check。
- ローカル完成ビルドの実画面: Horizonに公開リーズ一覧、日英切替・共通用語説明、StudioのRead title/Reads/Preview in Reader、ローカル原稿のReader表示・2ページ目への移動・情報パネル。メニュー言語切替後もZH-TWと読書位置を維持。390px幅のメニューも確認。
- 未完の実機確認: Horizonから従来URLに遷移できるが、localhostからの公開本文取得はRemote DSF JSON request failedで中断。Studioのプレビューボタンは検証ブラウザーでポップアップ警告となり、転送完了は未確認。インストール済みPWAの再起動は未実施。いずれも配備後に実環境で再確認する。URL・パッケージ・PWA構成の自動検証は通過。
- 通常devサーバーは既存PWAプラグインのconfigureServer起動エラーで使えず、完成ビルドのpreviewサーバーを利用。今回、用語変更と無関係なプラグイン挙動は変更していない。

## 将来 /reader に変える場合

今回実装しない。別途、/viewerと/viewer.htmlからのredirectで全query/hashを保持し、canonical/OG URL、共有リンク生成、deep link、PWA scope/start_url、Service Workerのoffline cache、旧ブックマーク・editorPreviewの同一origin通信をまとめて検証する。内部APIやデータキーを同時に変える必要はない。

## この用語変更で編集したファイル

前段の共通メニュー・作品言語整理は未コミットで残っていたため、その成果を保持した上で追記した。下記は今回の用語変更分（既存の他の未追跡素材は対象外）。

- [CLAUDE.md](../CLAUDE.md)
- [README.md](../README.md)
- [admin/index.html](../admin/index.html)
- [docs/product-terminology.md](../docs/product-terminology.md)
- [docs/shared-menu-language-policy.md](../docs/shared-menu-language-policy.md)
- [docs/viewer-menu-navigation.md](../docs/viewer-menu-navigation.md)
- [index.html](../index.html)
- [js/account-notifications.js](../js/account-notifications.js)
- [js/admin.js](../js/admin.js)
- [js/app.js](../js/app.js)
- [js/authoring-destination-dialog.js](../js/authoring-destination-dialog.js)
- [js/authoring-guide.js](../js/authoring-guide.js)
- [js/dsf-horizon-release-contract.js](../js/dsf-horizon-release-contract.js)
- [js/dsf-horizon-viewer-load.js](../js/dsf-horizon-viewer-load.js)
- [js/dsf-local-viewer-package.js](../js/dsf-local-viewer-package.js)
- [js/dsp-open-status.js](../js/dsp-open-status.js)
- [js/editor-flow-labels.js](../js/editor-flow-labels.js)
- [js/editor-print-i18n.js](../js/editor-print-i18n.js)
- [js/editor-tool-errors.js](../js/editor-tool-errors.js)
- [js/editor-viewer-preview.js](../js/editor-viewer-preview.js)
- [js/editor-work-bar.js](../js/editor-work-bar.js)
- [js/export.js](../js/export.js)
- [js/firebase.js](../js/firebase.js)
- [js/flow-canvas-view.js](../js/flow-canvas-view.js)
- [js/home-start.js](../js/home-start.js)
- [js/home-workspace.js](../js/home-workspace.js)
- [js/i18n-studio.js](../js/i18n-studio.js)
- [js/joined-space-works.js](../js/joined-space-works.js)
- [js/lang.js](../js/lang.js)
- [js/member-access-dialog.js](../js/member-access-dialog.js)
- [js/member-exit-dialog.js](../js/member-exit-dialog.js)
- [js/mypage.js](../js/mypage.js)
- [js/personal-sharing-ui.js](../js/personal-sharing-ui.js)
- [js/platform-menu.js](../js/platform-menu.js)
- [js/portal.js](../js/portal.js)
- [js/press.js](../js/press.js)
- [js/project-actions-ui.js](../js/project-actions-ui.js)
- [js/project-copy-ui.js](../js/project-copy-ui.js)
- [js/publishing-invitations-ui.js](../js/publishing-invitations-ui.js)
- [js/publishing-space-create-dialog.js](../js/publishing-space-create-dialog.js)
- [js/publishing-space-publish-dialog.js](../js/publishing-space-publish-dialog.js)
- [js/publishing-spaces-ui.js](../js/publishing-spaces-ui.js)
- [js/recent-works-ui.js](../js/recent-works-ui.js)
- [js/shared-studio-ui.js](../js/shared-studio-ui.js)
- [js/space-members-settings.js](../js/space-members-settings.js)
- [js/studio-flow-search.js](../js/studio-flow-search.js)
- [js/studio-help-registry.js](../js/studio-help-registry.js)
- [js/studio-history-panel.js](../js/studio-history-panel.js)
- [js/studio-install-guide.js](../js/studio-install-guide.js)
- [js/studio-webmcp.js](../js/studio-webmcp.js)
- [js/viewer-fixed-text.js](../js/viewer-fixed-text.js)
- [js/viewer-reader-chrome.js](../js/viewer-reader-chrome.js)
- [js/viewer.js](../js/viewer.js)
- [js/works.js](../js/works.js)
- [scripts/verify-product-terminology.mjs](../scripts/verify-product-terminology.mjs)
- [scripts/verify-project-title-surfaces.js](../scripts/verify-project-title-surfaces.js)
- [studio.html](../studio.html)
- [viewer.html](../viewer.html)

## Horizonホームの簡素化

ユーザー向けの名称は Horizon とし、ヘッダーロゴ・ページタイトル・OG・マイページ・Studioからのリンク名も揃える。Readerへの共通メニューは「リードを読むアプリ — Reader」（英語: Reading app — Reader）。ホームの大きなキャッチコピー枠と、その中のStudio起動ボタンを削除し、新着・注目リーズを先頭に表示する。Studioへの導線は共通メニューに維持する。フォーマット名DSF、Reader/Studioの正式名称、保存形式は今回変更しない。

## Horizonロゴ（2026-10-07）

ユーザー原案の9:16の本を斜めから見た輪郭を保ち、控えめに角を丸めた案を採用。基本色はインクの紺 #263C56。Horizon・マイページ・Readerの戻るリンクで共通SVGを利用する。暗い背景では同じ形の白抜き。再生三角形と紫の角丸マークは撤去。URL・PWA登録名・アプリインストール用アイコンはこの変更の対象外。
