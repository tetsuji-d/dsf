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
