# DSF Writing W1 ファイル処理

2026-10-11。W0に続き、形式3の実DSFを梱包・読込・再保存するファイルAPIと専用のブラウザー検証画面を実装した。製品Press／Readerメニューへの切り替え、描画道具と作者の範囲フォントUI、Horizon接続は含まない。正式公開前のローカル実装である。

作業先 `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`、branch `feature/dsf-writing-w0`、HEAD `b16f3fc87575a3c7173984c3677320446f319bf5`。W0の未コミット作業を継続。作者原稿、既存worktreeの未追跡素材、mainは変更していない。commit／deployなし。

## 実装したAPI

| ファイル | 役割 |
|---|---|
| `js/dsf-writing-package.js` | `createDsfV3Original`、`loadDsfV3`、`resaveDsfV3`。原本の確定、全entryの検証、編集用・共有用への保存 |
| `js/dsf-writing-zip.js` | サイズ制限付きZIP32 STOREの生成・読込。CRC、central／local header一致、完全entry集合、重複・不正path・未知方式の拒否 |
| `js/dsf-writing-font-engine.js` | WASMアダプター。サブセット生成、必要字形と余剰字形、内部name、横縦・400／700のshaping、可変軸を検査 |
| `js/dsf-writing-contract.js` | W0契約に原本resources entryと固定位置／style範囲の整合を追加 |
| `scripts/writing-w1/` | 実フォントのNode試験、Worker、ファイル選択・保存・履歴復元・共有用化のブラウザー試験 |

`createDsfV3Original` は確定したdelivery v2のbundleと書誌meta、画像bytesを受け取り、原本用フォントをsubset化して形式3の通常版を返す。既存Press UIへ自動適用する変更ではない。言語ページの順序、固定座標、run、ページリンクは保持し、font参照と関連hashだけを確定する。

`loadDsfV3` は検証完了後だけopaque handleを返す。原本bytesは内部所有、外へのgetterはコピー。`resaveDsfV3` に原本のsetterを渡さず、Writing変更だけを受け付ける。共有用入力はAPIでも編集・ロック解除を拒否する。通常版→編集用、編集用→共有用、および同じ種別の再保存を許可する。編集用→通常版への黙った切り捨ては許可しない。

変更なしの再保存は、検証済みのWriting font bytesもそのまま保持する。対象文字が変わった場合は必要な字形へ再subset化する。既存subsetで足りなければ、準備済みの完全版を取得して検証する。準備不足は保存失敗にし、開いていたhandleと元ファイルを保つ。

## W1で具体化した形式3

```text
mimetype                         application/vnd.dsf.content+zip
format.json                      formatVersion 3 / copyKind / base参照
manifest.json                    schema 2 / dsf-archive-manifest-2 / files
base.json                        原本の全entry descriptor
meta.json                        workId / releaseIdを含む原本書誌情報
content.json                     delivery schema 2
content/<language>.json          言語manifest schema 1
resources.json                   原本の派生font descriptor一覧
fonts/<sha256>.woff2             原本subset
licenses/fonts/<sha256>.txt      原本notice
assets/images/<sha256>.webp      原本画像
writing/document.json            現在状態（Writing付きのみ）
writing/history.json             全枝のsnapshot履歴（編集用のみ）
writing/resources.json           保存対象Writingの派生font一覧
writing/fonts/<sha256>.woff2      Writing subset
writing/licenses/fonts/<sha256>.txt
```

resourcesは `{schemaVersion:1,fonts:[...]}`。文書の中へfont bytesや完全版font参照を混ぜず、`writing/resources.json` へ分離した。W0案のdocument.resourcesは実装していない。descriptorの各fieldはW0の`validateDerivedFont`と一致する。

外側manifestは `{schemaVersion:2,format:"dsf-archive-manifest-2",files:[...]}`。filesはmanifest自身以外の全entryをpath順で列挙し、それぞれpath／mimeType／byteLength／sha256を持つ。canonical UTF-8 JSONを必須とし、余剰entry、欠落、重複、hash違いを拒否する。`base.json` の原本entry集合も別に厳密照合する。workIdとreleaseIdは原本metaに含まれ、baseHashでWritingと結び付く。

現実装はZIP32のSTORE（無圧縮格納）、ASCIIの規定path、先頭mimetype、commentなし。WOFF2／WebP自体は圧縮済み。DEFLATE、ZIP64、暗号化、data descriptor、余分なheader fieldを推測読込せず拒否する。ZIPの再圧縮やJSONへのDEFLATE対応は今回実装していない。標準ZIPとして外部ライブラリーでも展開可能なファイルを出力する。

原本meta／ページ／font／notice／画像はWriting保存時に再組版・再生成しない。原本hashの一致に加え、試験では原本全entryの展開bytesを直接比較する。共有用の生成対象は現在の状態だけ。未使用font、notice、履歴JSONを持ち越さない。

## フォント検証

W0で確認したNoto Sans JP／Serif JPと固定版WASMを使用。内部name情報は `writing-w1-font-metadata.json` に固定記録した。本文を勝手に正規化せず、元のrunごとにNFC／NFDで必要になる字形も集める。

HarfBuzzは縦書き等に必要な鏡像文字を追加することがある。そのため余剰字形検査は単純な入力文字集合との等値ではなく、埋込fontを同じrecipeで再subsetしたcmapと照合する。共有用に完全版fontを偽装同梱し、内部・外側hashを全て更新したケースも拒否した。hashは作者の真正性を証明する署名ではない。

読込は完全版fontもnoticeも外部取得しない。埋込bytesを検証する。共有用への絞り込みや既存履歴の復元も、収録済みsubsetだけで行える。ブラウザーの重いfont処理はWorkerに隔離し、操作完了・失敗・timeoutで終了する。

## 自動試験

`node scripts/writing-w1/verify.mjs` は41項目成功。`outputs/writing-w1/verification.json` に結果を保存した。

- 実Noto subsetを含む通常版・編集用・共有用の作成、ファイル書込、読込、再保存。
- 変更なしの3種再保存でZIP bytes一致。全コピーで原本全entry一致。
- 削除済み文章と別枝を編集用で保持し、共有用では履歴と履歴専用資源を除外。
- 編集用から過去snapshotを復元し、再保存後もheadと状態を維持。
- 完全版font／notice取得を禁止した読込、再保存、履歴復元、共有用化。
- 新規字形の準備不足では失敗して旧状態を保護。完全版準備ありでは成功。
- 2言語＋固定text／WebPの混在を往復。画像はschema検査用1px fixtureであり、Pressの出版画質検証ではない。
- 循環、未知field、notice欠落、余剰entry、壊れたhash／font、CRC、サイズ、header不整合、unsafe path、共有用ロック等を拒否。
- 既存W0の46項目、delivery v2 validator、固定text rendererの回帰試験も成功。
- 独立したPython標準 `zipfile` でも3種のZIPを展開し、CRC・全entryのhash・原本bytes一致を確認。`independent-zip-verification.json` に記録。

基本の架空原稿の原本hash:
`2c49152f0e60f146b5d7b685ec0125f8360b9318dc944202153dabe52a000c3e`

| ファイル | 初回検証時の容量 |
|---|---:|
| original.dsf | 35,813 B |
| editable.dsf | 86,309 B |
| shared.dsf | 75,359 B |

これは2ページの短い架空原稿。一般の作品の容量見積りとしては使わない。生成物は `outputs/writing-w1/` に保持し、既存検証素材を消さない。

## ブラウザー受入

Windows Chrome 154、専用画面 `http://127.0.0.1:5193/`。元ページの表示は既存 `viewer-fixed-text.js` を再利用し、原本用・Writing用で異なるFontFace familyを使う。

通常版の生成、ファイル選択からの読込、Writing追加、原本一致、履歴保持、再保存を確認した。検証ツールがBlobのdownload完了／保存先の取得をサポートせず、通常のdownload受入は未完了。そのためブラウザーが作成した同じZIP Blobを、明示ボタンからloopback専用の `/record-file` へ保存して検証した。保存先は生成された名前の `outputs/writing-w1/browser-saved/` のみ。外部送信、任意path指定、既存ファイル上書きはない。

オフライン試験では、アプリ・WASM・認定情報のみをservice workerへ準備する。完全版fontとnoticeの取得URLはcache対象外。通信をofflineへ切替後にreloadし、ローカルサーバーも停止して保存済みDSFを開く。ファイル選択、履歴復元、共有用生成、再保存のZIP生成を確認する。ディスクへの検証保存は通信とサーバーを戻した後に行い、オフライン中の通常downloadが確認できたとは扱わない。

最終の操作ログ・画面・ブラウザー生成ファイルの再照合結果を `outputs/writing-w1/` に記録した。`verify-browser-files.mjs` で両ファイルを再読込し、完全版font取得禁止で原本全bytes一致とZIP bytesが同一の再保存を確認した。

| 証拠 | 内容 |
|---|---|
| `browser-offline-events.json` | `online:false` の読込・履歴復元・共有用化・再保存ZIP生成 |
| `browser-offline-restore.png` | 編集用4履歴からr1へ復元、原本hash一致 |
| `browser-offline-shared.png` | 共有用0履歴、原本hash一致、編集操作が無効 |
| `browser-verification.json` | ブラウザー生成2ファイルの外部再読込・再保存照合 |
| `browser-saved/browser-1791685336033-21f0951c5a6a.dsf` | 編集用、86,309 B、head r2、4履歴 |
| `browser-saved/browser-1791685915414-f1df7dcdb59a.dsf` | オフラインで生成した共有用、75,359 B、履歴なし |

ブラウザーの通信設定は最後にonlineへ戻した。検証用service workerは5193番の専用originだけに残している。

## 再現と次段階

W0のfont／WASM準備済みworktreeで:

```powershell
node scripts/writing-w1/verify.mjs
node scripts/writing-w1/serve.mjs
# ブラウザーの「検証フォルダーへ保存」で実ファイルを作成後:
node scripts/writing-w1/verify-browser-files.mjs
```

W1のファイルAPIは実装したが、製品Pressの出力切替、製品Readerの読込導線、製品版service workerへの組込は未実施。W2ではこのAPIを道具・選択・Undo／Redo・永続化へ接続する。描画やテキスト入力の実用UI、組版確定操作、スマホ実機の上限・ピークメモリ、Safari／Firefox、ブラウザープロセス終了後の起動は別途確認する。Horizon配布はW3以降。
