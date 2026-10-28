# リーズの埋め込みモーダル — 2026-10-25

作業ツリー: `C:/Users/tetsu/.codex/worktrees/horizon-publishing/dsf`、branch `codex/horizon-publishing`、HEAD `96b7a05`。既存変更、outputs、Writing作業ツリーを保持。commit/mainマージ/本番反映なし。

最終staging deployment: `3cca3b0f`、alias `https://staging.dsf-studio.pages.dev`。埋め込みモーダルを含む `studio-CiHZjyLO.js` と `studio-BjKzsQi_.css` の配信bytesが最終distとSHA-256一致（`outputs/embed-modal-20261025/staging-assets.json`）。これは配信確認であり、ログイン後UIの実操作とは区別する。

## 変更

- URLコピーアイコンの隣に埋め込みアイコンを追加。タイトルを含むアクセシブル名とツールチップ。
- `edition-embed-dialog.js` / 専用CSSへ設定・コード・見本を集約。版の設定内の旧埋め込みUI/CSSを除去。
- 非公開/アーカイブの案内、指定サイト時のみドメイン入力、未保存/保存中/保存済み、成功後のコピー、入力検証、失敗時の入力保持と再試行。
- 未保存の破棄確認、ESC/閉じる/背景クリック、Tab/Shift+Tab循環、一覧の開閉状態保持・元のアイコンへのフォーカス復帰。
- 閲覧数は行内の独立した折りたたみ。閲覧数の更新後もその折りたたみを開いて表示。
- PC中央/スマホ全画面/横向き全画面。内部スクロール、44px操作、ライト/ダーク、英語。
- 既存所有者APIを使用し、保存契約/版本文/URL/集計仕様は変更なし。

## ブラウザー確認

本体の `mountEditionReads` とモーダルを直接使うローカルfixtureで確認。クラウドの既存版は変更しない。

|操作|結果|
|URL横のアイコン|各行に表示、対象タイトル/版名を持つモーダルを開く|
|指定サイト|欄が現れる。空欄保存はエラー。2サイト入力で正規化された値を保存|
|保存/コピー|保存済みと成功案内、固定版IDのコードをコピー処理へ渡す|
|未保存で閉じる/ESC|破棄確認。「編集に戻る」で継続、「変更を破棄して閉じる」で戻る|
|保存失敗|入力と未保存状態を保持し、再試行で保存成功|
|フォーカス|閉じた後は元の埋め込みアイコンへ戻る。Tab/Shift+Tabで先頭/末尾を循環|
|背景クリック|保存済みなら閉じる。本文のクリックでは閉じない|
|閲覧数|モーダル外で更新。fixture値12 / 埋め込み4 / Reader8を表示|
|見本|折りたたみを開ける。画像なしでも9:16枠とプレースホルダーを保持|
|英語|Embed/Allow embedding/Saved/Privateなどの表示と対応する操作を確認|
|アーカイブ|対象の初版/アーカイブ表示と現在表示されない案内。設定保存とコードコピーは可能|

PC 1280/1440、中間768、スマホ360/390/430、横向き844×390。画面内の内容までスクロールして撮影。長いドメイン/版名、画像なし、非公開、未保存、入力エラー、保存失敗を確認。これはChromium端末幅エミュレーションで、実機Safari/Androidの合格ではない。

証跡: `outputs/embed-modal-20261025/` の `pc-1440.png`、`modal-1280.png`、`modal-768.png`、`modal-360.png`、`mobile-390-dark.png`、`mobile-preview-390.png`、`mobile-430-long-label.png`、`landscape-844.png`、`list-icons-390.png`。

最終ファイルでの追加証跡: `mobile-final-390.png`（下部までスクロールしてコピー成功）、`pc-final.png`（アーカイブ版の設定全体）。

## 自動検証と環境上の制約

`verify-reader-embed.js`、`verify-edition-reads-session.js`、`verify-editions.js`、`verify-edition-list-presentation.js`、変更JSの構文確認、`git diff --check`、staging buildに合格。

Chromeの操作接続がタイムアウト。Codex内ブラウザーのstaging Studioは未ログインであり、ログイン後の実一覧に対する保存・コピー確認はユーザーのログイン待ち。ローカル操作確認とstaging配信確認を混同しない。

## 追加確認：ログイン後のstaging（同日）

ユーザーのログイン完了後、上記の未確認項目を確認した。元のタブは旧build `20261024231946456` のままで更新できず、Homeには復元した編集中リードの保存確認待ちがあったため、そのタブとデータを保持した。新しいタブでログイン復元と最終build `20261025004136581` / `studio-CiHZjyLO.js` を確認。

- 山口出版の検証用公開版「Horizon通し確認 20261024」（edition ID `e_993afc8c9ac3debd2b171edbd883278df828fb87b52373e96a1bbddb73976378`）を使用。
- 許可範囲を変えず、既存の `https://embed-check.dsf-studio.pages.dev` に改行だけ加えて保存。未保存中のコピー無効、保存成功、正規化された同一ドメインを確認。
- PC・スマホ幅でコードコピー成功。ブラウザーのクリップボードに対象版のiframeと通常Readerリンクが含まれることを確認。
- 閉じる操作で元の埋め込みアイコンへフォーカス復帰。独立した閲覧数パネルの更新は成功し、確認時点で合計12 / 埋め込み3 / Reader9を表示。
- 一覧の「更新」で再取得した後も、指定サイトのみ・同じ許可ドメイン・保存済み表示を確認。
- PC 1440×1000、スマホ390×844で撮影と実操作。スマホでは下部の表示見本までスクロールして確認。実機タッチ試験ではない。確認後に画面サイズ指定を解除。
- 証跡: `staging-pc-saved.png`、`staging-mobile-top.png`、`staging-mobile-preview.png`、`staging-mobile-list-stats.png`（同じoutputsフォルダ）。

追加の実装変更・再デプロイは不要。mainマージ・本番反映なし。
