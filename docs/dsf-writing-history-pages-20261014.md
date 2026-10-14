# Writing：本全体30操作の履歴とページ管理

2026-10-14。作業場所 `C:\Users\tetsu\Documents\Codex\dsf-writing-w0`、branch `feature/dsf-writing-w0`、HEAD `b16f3fc87575a3c7173984c3677320446f319bf5`。既存の未コミット変更を保存したまま、追加修正した。コミット・デプロイはしていない。

## 実装

- 本全体で一本のUndo／Redo。基準時点 + 直近30操作。履歴上限を超えても現在の書き込みは消えない。
- Undo後に編集するとRedoを破棄。見開きをまたぐ一筆は左右の変更を一括で扱う。別ページのUndo／RedoではReaderも対象ページへ移動する。
- 全ページsnapshotを操作ごとに複製せず、変更objectのbefore／afterとページ内順序を記録。ページID索引と不変objectを使い、編集中の検証は変更ページに限定。全体の件数・容量制限はキャッシュ済み集計で確認する。
- IndexedDB v2は原本bytes、ページ、履歴metadataを分離。原本は初回だけ保存し、その後は変更ページと履歴を同じCAS transactionで保存する。空になったページも反映する。
- 表示中の1〜2ページ + 前後各2ページ、最大6ページのWriting描画cache。古い先読み予約を取り消し、範囲外のDOMを解放。専用確認画面では原本DOM／画像decodeも先読みし、不要な画像URLを解放する。
- Reader統合では原本DOMを二重に生成しない。変更していないobjectの描画DOMを再利用し、閉じたレイヤーパネルのサムネイル作り直しを停止する。
- 履歴一覧には保持範囲と対象ページを表示。Readerの基本メニューとペン画像は維持。

## 形式

DSF formatVersion 3、Writing document schemaVersion 1は維持し、historyだけschemaVersion 2へ更新。現在documentと双方向差分から全保持状態を検証する。旧試作snapshot履歴は読込時に現在の枝へ線形化する。

保持範囲内の削除済み文字／Redo文字はfont subsetに含める。共有用は現在状態だけとし、履歴を含めない。元の本のbytesは変更しない。

## 検証

### モデル・保存

- `verify-history-pages.mjs`：45操作の上限整理、30回Undo／Redo、言語をまたぐ履歴、Redo破棄、見開き一括Undo、変更のないページの参照維持、変更ページだけの保存差分、無変更操作の除外、不正差分／重複IDの拒否、旧履歴移行、先読みの取消と解放を通過。
- `verify-history-file.mjs`：30操作、Redoを残した状態のZIP再読込、削除済み文字のfont、外部font取得を禁止した再保存、共有用、原本全entry一致を通過。
- `verify-storage.html`：実際のIndexedDBの専用検証DBで、変更ページだけのput、原本の再putなし、未変更ページ保持、再読込とUndo、空ページ削除、同時CASの片方拒否を通過。ユーザーの下書きDBを検証用に書き換えていない。
- 既存の道具15項目、直接テキスト、ロック、Reader接続／ページジェスチャー、viewport guard、8寸法の配置計算も通過。

### Reader実操作

1. 新しい検証タブでサンプルを開き、Writingへ切替。
2. 表紙に一筆、見開きをまたいで一筆。別の見開きからUndoすると対象見開きへ戻り、左右の筆跡が同時に消え、Redoで両方戻った。
3. さらに32筆を描いた。合計34操作に対して保持操作は30、現在objectは本全体35個。30回Undo後は5個が残り、さらに戻すボタンは無効。30回Redoで全35個を復元。
4. UIから編集用DSFを生成・ダウンロード。実ファイル `C:\Users\tetsu\Downloads\Writing 操作サンプル-writing (2).dsf` をReaderのファイル選択で読み直した。Writingへ戻ると30操作の履歴が表示され、別ページからのUndo／Redoも動作した。
5. ダウンロードbytesを独立したファイルAPIで検査し、35個／30操作、30回Undo後5個、原本全entry一致、変更なしの再保存bytes一致を確認。

ブラウザーの寸法変更ツールが指定値どおりのlayout viewportを再現しなかったため、今回のスマホ実機相当の確認は未完了。試験の一時設定は解除し、寸法検証用タブも閉じた。`mobile-history.png`は実際にはdesktop viewportであり、モバイル合格の証拠として扱わない。

### 軽量化の測定範囲

60ページ、各ページ100点の筆跡1個という合成データで、同じ直近30操作分の全体snapshot JSONは6,028,633 bytes、現在documentを含む差分envelopeは396,893 bytes。約93%減。モデルの追加処理は本端末で中央値約0.76ms、最大約3.32ms。これはJSON量とモデル処理の測定であり、画面全体の応答時間・スマホのメモリ量・ZIP圧縮後の削減率を示すものではない。

### ビルド

`DSF_WRITING_PREVIEW=1 npm run build:staging` と `verify-staging.mjs` 成功。Writing version `37df52742eae7921fcf2`、72配信ファイル／70オフライン対象。production除外、検証用保存endpoint除外、オフライン準備失敗時に前のsnapshot保持を確認。公開処理は未実行。

## 残る範囲

ZIPは引き続き全体を検証・展開する。今回のページ先読みはWriting表示の準備が対象で、ZIPから必要ページだけを部分取得する実装ではない。Reader原本側のcache方針も今回の変更対象外。長い本・大量の筆跡のスマホ実機計測は別途必要。

## 証拠

`outputs/writing-w1/history-pages-20261014/` に編集前snapshot、`model-proof.json`、`file-proof.json`、`storage-proof.json`、`browser-downloaded.dsf`、`history-roundtrip.dsf`、`reader-history-reopened.png`を保存。

主な変更ファイルは `reader-writing-model.js`、`reader-writing-history.js`、`reader-writing-page-cache.js`、`reader-writing-storage.js`、`reader-writing-renderer.js`、`reader-writing-bridge.js`、`dsf-writing-contract.js`、`dsf-writing-package.js`、`scripts/writing-w1/reader-writing.mjs`。`viewer.js`の今回の追加は履歴から対象ページへ移動する5行のみ。
