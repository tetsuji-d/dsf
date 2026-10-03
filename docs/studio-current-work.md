# ダッシュボードの作業中原稿とアプリ更新

2026-10-03。実装場所: `review-boundaries/dsf`、ベース: `codex/windows-file-preview` / `bd0b327`。

## 今回の範囲

ダッシュボードに現在開いている原稿名、保存状態、編集へ戻る・保存・閉じる操作を表示する。クラウドとDSPの保存先を区別し、ブラウザー復元コピーだけでは保存完了と扱わない。旧Firestore原稿の隔離、通常一覧からの復元コピー整理、Windowsプレビューは別の作業として残す。

- 保存状態は既存の `getEditorSaveStatus()` と `localDraftStatus` から読む。保存未確認、処理中、未確定入力、保存失敗は更新を止める。
- アプリ更新画面にも原稿名と状態を表示し、既存の保存経路で保存してから更新できる。DSPダウンロード方式では従来どおり利用者の保存確認が必要。キャンセルや確認待ちでは再読み込みしない。
- 保存失敗時は再試行、編集に戻る、個人原稿のDSP退避を選べる。DSP退避をクラウド保存完了とみなさない。
- 保存と更新準備の後に、保存状態および原稿の識別情報を再確認する。待機中の編集や原稿切替があれば再読み込みを止める。
- 個人原稿は保存確認後に閉じられる。保存データと復元コピーは保持する。共有原稿は既存の共同編集セッション終了経路を維持し、このカードには閉じる操作を出さない。

本文・画像、DSP/DSF形式、Firestore/R2保存契約、Viewer、権限ルールは変更しない。既存の保存処理に表示更新通知を追加した。

## 実装箇所

- `js/studio-work-status.js`: 状態の判定とカード表示。
- `js/app.js`: 現在原稿、既存保存処理、閉じる操作との接続。
- `js/firebase.js`: 保存状態の変更通知。
- `js/studio-pwa.js` / `js/studio-update-ui.js`: 更新画面と保存操作の接続。
- `studio.html` / `css/home-workspace.css`: 表示領域とスタイル。

## 検証

- `verify-studio-work-status.js`、既存の `verify-studio-version.js`、`verify-editor-save-status.js`、`verify-home-start.js`、`verify-studio-local-pwa.js`、`verify-dsp-file-session.js`、`verify-safe-resume-integration.js` が成功。対象JS構文検査とstagingビルドも成功。
- localhostの実Studioで新規ローカル原稿「保存状態の検証」を作成し、ダッシュボードの名前・未保存表示、編集への復帰、DSPダウンロードと実ファイル生成、保存確認後の保存済み表示、閉じた後の復元コピー保持を確認。
- `scripts/fixtures/studio-current-work.html` は実際の表示モジュールに保存・更新処理を注入する独立検証画面。DSP/クラウド保存成功、保存キャンセル、保存失敗、更新準備中の追加入力、原稿切替、日英表示を操作確認。失敗・変更時には再読み込み要求が発生しない。
- 実クラウドへの書込み、ネイティブ保存ダイアログの完了、実Service Workerの更新適用は今回の実画面検証に含まない。stagingへのデプロイは行っていない。

## ステージング反映（2026-10-03）

上記はユーザー承認後に `25ba79c` でコミットし、Cloudflare Pages stagingへ反映した。
バージョン `v2026.10.03-101837`、デプロイURL `https://a6c74953.dsf-studio.pages.dev`。
staging aliasのStudio/ViewerはHTTP 200、配信JSはローカルビルドとbyte単位で一致。
固有デプロイURLの実画面でも同バージョンを確認した。

既存staging originの確認ブラウザーは旧版 `v2026.09.29-144253` をService Workerから読み、
旧原稿の保存未確認で更新を停止した。原稿を保持して操作を中止し、強制再読み込みはしていない。
そのため、旧版からのService Worker更新完了は未検証のままである。

## 復元表示と読み込みフィードバック（ローカル実装、未配信）

起動時のautosave復元と独立ローカル原稿の再開が `noteLocalDraftEdit()` を呼び、未編集でもDSP未保存変更と表示していた。
復元専用のruntime状態を追加し、EditorとDashboardに「復元した原稿・保存確認待ち」を表示する。
復元は編集revisionとの差分として扱わず、実編集で未保存変更へ、DSP保存確認で保存済みへ移行する。
`needsSave` は復元確認待ちも含み、離脱警告、外部DSP置換、アプリ更新、原稿を閉じる際の保護を維持する。
保存済みファイルやクラウドとの一致は推測しない。保存形式は変更しない。

所有クラウド原稿の共通ロード入口 `onLoadProject` に読み込みダイアログを接続した。
現在原稿の保護、本文・画像の読込、編集画面準備の段階を表示し、成功・失敗とも必ず解除する。
二重クリックは既存のロードを共有し、別原稿の重複ロードは拒否する。キャンセルできない処理をEscapeで隠さない。

検証: 実Studioの起動復元とEditorへの移動で確認待ち表示を維持し、テスト原稿のタイトル編集で未保存へ変わることを確認。
読み込み表示の実UIは隔離fixtureで確認し、実ロード入口の同時操作・成功・例外・再試行を検証スクリプトで確認。
実アカウントのクラウド通信時間・成功は今回未検証。DSP保存、local PWA、safe-resume、save evidence、recent worksの回帰検査とstagingビルドが成功。
