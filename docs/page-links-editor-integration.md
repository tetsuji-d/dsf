# ページリンクの本体統合：実装・検証記録

2026-10-10。作業場所 `C:/Users/tetsu/Documents/Codex/dsf-page-links-editor`。
ブランチ `feature/page-links-editor`、起点 main `70e44be`。未コミット。2026-10-10にステージング反映・実保存確認済み。本番未反映。
既存の `reader-route` のURL移行差分、他の作業場所、実原稿には変更しない。

## 実装したUI

実際の `app.js` / Studioリボン / Flow文字選択 / graphic object selectionへ接続した。
通常のStudioにも「移動先アンカー」「ページへのリンク」を表示する。
既存ルビ・圏点と同じダイアログ様式を使う。アンカー登録表示を本文へ挿入しない。

- Flowの段落・見出しの選択位置を引き継ぎ、設定画面の読み取り専用本文で範囲を選び直せる。
- Fixedテキストオブジェクト／画像オブジェクト、Flow配置画像の選択アダプターを接続。
- 画像の参照番号見本は既存キャプションに付ける。可視キャプションがないリンクは拒否。
- アンカー指定／絶対ページ指定。表紙を除く既存の `getPageDisplayLabel` に合わせる。
- 6書式。縦書き漢数字は103→一〇三。
- 対象前後の編集では範囲を追跡し、対象文字自体の変更・削除で解決できなくなった場合は未解決にする。
- 別言語のアンカーは表示しない。

保存形式案へのArchitectの承認（y）後、原稿の保存・再読込、Undo/Redo、本文への番号挿入、
印刷・DSF出力経路、Readerのサムネイル・連続移動へ接続した。
旧Fixed本文／吹き出しの文字範囲、複数段落範囲は未対応。Flow配置画像の実ブラウザ操作は未検証。
ローカル試作。実環境のクラウド保存・デプロイ前検証は別途必要。

## 操作確認

`http://127.0.0.1:5192/studio?pageLinksReview=1&pageLinksFixture=1`

専用の架空原稿を作る。fixtureはDEV限定、サインイン済み・id/sharedWork付きURLでは実行しない。
初期化では自動保存しない。リンクの設定操作は通常の変更履歴・端末復元コピーの更新を呼ぶ。

1. 1ページ目の「波の仕組み」をクリックし「移動先アンカー」を開く。
2. 対象文字欄をドラッグまたはキーボードで範囲選択し、名前を入れて登録を試す。
3. 5ページ目の画像を選び「ページへのリンク」を開く。
4. アンカーまたは絶対番号を選び、キャプションに添える番号の見本を確認する。

## 承認済みの保存形式

`AGENTS.md`の「データ形式変更は人間（Architect）と合意してから実装する」に従い、
以下の形式案は承認済み。保存・出力経路に実装した。

### 原稿 DSP

Projectの独立した `pageNavigation` 欄を追加する。生成ページDOMやサムネイルは保存しない。
リンク機能を初めて使う原稿を明示的に新しいProject versionへ移す案（現行6→7）。
リンク未使用の旧原稿は変換しない。旧Studioによる無言の情報欠落を避ける。

```js
pageNavigation: {
  version: 1,
  anchors: [{ id, name, target: {
    kind: 'text' /* or 'image' */,
    language, ownerId, sectionId, objectId,
    start, end // text only; grapheme境界に一致するUTF-16 offset
  }}],
  links: [{ id, source: { /* targetと同じ対象情報 */ },
    destination: { kind: 'anchor', anchorId },
    // または { kind: 'page', pageNumber: 103 }
    reference: { format: 'plain' /* lower/paren/upper/suffix/kanji */ }
  }]
}
```

- `ownerId`はFixed page IDまたはFlow group ID。Flow本文ではsection/blockの安定IDも保存。
- 文字リンクの番号は対象末尾の参照欄、画像リンクの番号は既存キャプション末尾の参照欄。
  既存の組版・印刷経路へ載せるため、本文内に生成番号キャッシュを置く。
  referenceにstart/end/text/contextTextを保持し、正本はdestinationとする。数字を移動先IDに使わない。
  手動で番号を削除・改変したリンクは未解決にする。説明文は保持。
- 言語ごとに対象と範囲を保持し、別言語へoffsetを使い回さない。
- 文字の置換・段落分割・結合を既存の編集transactionと同時に追跡し、Undo/Redoに含める。
  対象削除はリンク切れとして保持。別オブジェクトへ自動置換しない。
- アンカーはページ移動に追従、絶対指定は既存の印刷上の本文番号を維持。
  C1/C2/C3/C4は数値ページとみなさず、番号だけのリンク先にはしない。
- アンカー自体はレイアウトを変えない。**リンクの可視番号**はレイアウト内容になるため、
  桁数変化を含めて再組版と番号を収束させる必要がある。

### 配信 DSF

配信の言語manifestに任意のnavigation拡張を加え、発行時に解決したsource page ID、
クリック領域（正規化座標）、destination page ID、表示番号、書式、短いアンカー名を保持する案。
原稿本文・編集offset・非公開DSPは配信しない。
番号はページWebP／fixedTextそのものに含め、印刷にも残す。
JSON hash、ZIP inventory、upload receipt、ローカル/公開Reader検証の対象に含める。
既存の本文形式は維持し、旧Readerでは可視番号を読める状態を保つ。拡張なし作品は従来どおり。

### 発行前検証

1. 現在の言語別ページ割りと番号参照が収束・一致している。
2. 画像キャプションと番号がページ内にあり、隠されず欠けていない。
3. リンク先が存在し、クリック領域と描画番号が一致している。
4. 未解決、キャプション非表示、番号の欠落、未対応出力経路では出力を止め、対象を示す。

### 保存契約承認後の実装

原稿schema/validator/serializer、編集時の範囲追跡、History、番号を含む組版、
印刷/Press/DSF、Readerの枠なしサムネイルと連続めくりを接続した。
実原稿へ自動設定は行わず、架空原稿の保存・再読み込みで確認する。

## 検証記録

- `node scripts/verify-page-link-draft.js`: 6書式、103→一〇三、範囲境界、元本文変更、言語境界、caption gate、アンカー/絶対番号の解決。
- 変更JSの構文検証。
- `npm run build:staging`: 成功（既存のchunk size警告あり）。デプロイ未実施。
- 実Chrome/Studio: Flow見出しをクリック→対象全文選択→アンカー登録→画像選択→アンカー参照を確認。
- 実Chrome/Studio: 6書式を切替え、絶対2ページのキャプション見本 `(p.2)` と設定操作を確認。
- この検証はUI確認段階。永続保存/実際のページジャンプの合格を意味しない。


## 2026-10-10 保存・Reader接続後の検証

- 実Studioで文字アンカー、画像キャプション番号、1文字の絶対番号リンク、Undo/Redoを操作。
- 段落移動と本文増量で見出しがp.1からp.3へ移動。キャプションは(p.1)から(p.3)へ自動更新し、絶対リンク(p.5)は維持。
- buildDSPで35645 bytesの実ZIPを作成。Project v7、アンカー1件／リンク2件。DSP入力から再読込しUIで保持を確認。
- ダウンロード開始は確認したが自動化では保存先を取得できず、端末保存完了ボタンは押していない。往復試験には同じbuildDSPの実ZIPをoutputsへ保存したものを使用。
- Readerで1→5→1の連続移動、初回タッチではプレビューだけ表示、サムネイル確認後の遷移を確認。
- 390px幅で矩形測定と画像確認。プレビューはviewport内。
- 印刷プレビューを5ページ生成し、本文の可視番号 `(p.5)` が残ることを確認。OS印刷・PDF保存は未実施。証拠は outputs/page-link-print.png。
- outputs/page-links-integration.dsp は架空原稿。outputs/page-link-mobile.png は操作証拠。

DSPはProject v7 / meta schemaVersion 2。未使用原稿は従来形式。
Undoで最初のアンカーを取り消してもv7を維持し保存済み版の降格を防ぐ。
private pageNavigationはpublic rootへ含めない。DSF v2各pageのpageLinksには
id/targetPageId/number/format/label/textRegions/rectsだけを付け、hashとZIP inventoryの対象にする。
textRegionsは公開run内の範囲、rectsは360×640座標。private本文スナップショットは配信しない。
Fixed文字の範囲は描画と共有のcanvas line layoutで計算。番号欠落・未解決・クリッピングでは出力を止める。
再組版の番号更新は連続8回まで。本番フォントで番号が異なる場合も、不一致を黙って発行しない。
漢数字は各桁（一〇三）で、向きは本文／キャプションの書字方向に従う。

本番／ステージングへのデプロイ、実アカウントでのクラウド保存は未実施。
導入前にフロント、private authoring API、Firestore rulesをまとめて確認する。
当初javaが見つからずrules emulatorは未実行だったが、下記の追加検証で解消した。
保存APIの認証・競合・v7保存／読込と非公開性はmock I/Oで検証済み。
複数段落にまたがる1リンク、旧Fixed本文／吹き出しの文字範囲は対象外。
Flow配置画像・複数言語・印刷用紙の全組み合わせは実機未検証。

## 2026-10-10 保存互換性の追加検証

- 検証専用の公式Temurin JRE 21.0.12.1+1を `C:/Users/tetsu/Documents/Codex/dsf-validation-tools` に展開。公式配布metadataのSHA256と照合済み。システム設定は変更せず、実行プロセスだけJAVA_HOMEを指定。
- `verify-private-authoring-rules.js`: ローカルdemoプロジェクトで110項目成功。v7の保存・読込、他ユーザー／匿名の拒否、不正navigation形式、v6への降格拒否、summary保存、移行後の復元を確認。
- 未実行テストの変数名重複と、旧仕様の直接削除成功の期待値を修正。現行Trash API境界に従い、直接削除を拒否することを確認。
- R2からFirestoreへの保守用復元処理がv7の原稿子documentを復元しない対応漏れを修正。v7の移行判定も対応。
- `verify-private-authoring-maintenance.js`: 12/12成功。リンク付き原稿の移行→R2で更新→最新原稿を復元→別generationへ再移行して、リンクと本文の保持、公開rootからの除外を確認。
- `verify-private-authoring-local.js`: 実workerd/MiniflareのローカルR2で、v7リンク・漢数字参照を含む原稿の書込・再読込、hash検証、再試行、scope拒否、破損検出が成功。
- 証拠ログ: `outputs/rules-check.log`、`outputs/maintenance-check.log`、`outputs/local-r2-check.log`。
- クラウドへの反映や実アカウントの保存は行っていない。次の工程はステージングへフロント/API/Rulesを反映して架空原稿で実保存を確認すること。コミット・デプロイは未実施。

## 2026-10-10 ステージング反映・実保存

直前の「次はステージングへ反映し実保存を確認」に対する「進めて」に従って実施。
上記の未デプロイ／実保存未実施という記録は、この工程より前の状態。

- 反映前のstaging: `af7a000e-9d46-439b-958e-cf6a782f0f2d` / `b7ecc2a`。今回の起点に含まれる。
- Firestore: `npm run deploy:firebase:rules:staging` → `vmnn-26345-stg` 成功。ルールSHA256 `DAEE50EA0A1A93F3166E9754B35AB11AFC96F91A8899CA685BD64F30D1E8354D`。
- Pages + Functions: `npm run deploy:staging` 成功。`https://8a66d61e.dsf-studio.pages.dev`、alias `https://staging.dsf-studio.pages.dev`。
- 表示version: `v2026.10.10-092708`。未コミット差分を含む検証ビルドであり、HEADだけでは再現できない。
- 検証用の新規クラウド原稿: `proj_mv271rlp_8qvqa6`、タイトル「ページリンク実保存検証 2026-10-10（架空原稿）」。既存原稿の本文は変更していない。
- 以前の起動時復元コピーはアプリの `fileLaunch=dsp` 経路で保持。OSファイル選択を自動操作できなかったため、架空DSPのbytesを通常の `window.importDSP(...,{external:true})` に渡して取り込んだ。アプリの保存前保護・形式検証は維持。
- 「保存の詳細」→「クラウド保存先を選ぶ」→「マイスペース（クラウド）」→「保存して進む」を実操作。authoring/actions API 200と「クラウドに保存済み」を確認。
- 別タブで上記idを指定してクラウドから再読込。アンカー「波の仕組み — p.1」、可視番号 `(p.5)` を確認。
- リードタイトルを検証用名称へ変更→「クラウドに保存」→完了→reload。変更したタイトルと保存済み表示が保持。
- 再読込した原稿からReaderプレビューを生成。絶対リンクp.5と画像キャプションのアンカーp.1が保持され、サムネイル確認による1→5→1の連続移動が成功。
- Reader操作中もStudioの「クラウドに保存済み」を維持。
- 証拠: `outputs/staging-rules-deploy.log`、`outputs/staging-pages-deploy.log`、`outputs/staging-page-link-reader.png`、`outputs/staging-cloud-saved.png`。
- 未実施: コミット、本番反映、公開Releaseの発行、紙への実印刷、全言語／配置の組み合わせ。ステージングの検証原稿は確認用に保持。

## 2026-10-10 サムネイルの非表示操作

- マウスオーバー／タップで開いたサムネイルは3秒後に自動で閉じる。
- 同じリンクを再タップすると閉じる。pointerup後の互換clickを消費し、閉じた直後に再表示しない。
- 自動非表示後、同じリンク上の微小なマウス移動では再表示しない。一度離れて戻ると表示。
- サムネイル上のマウス操作／キーボードフォーカス中は表示を保ち、離れると3秒の計時を再開。
- 実Chromeのmouse/touch入力で自動非表示、微小移動、初回タップ表示、再タップ非表示、サムネイル上の表示保持、クリックでの移動を確認。
- `node --check js/reader-page-links.js`、`git diff --check`、staging build成功。
- ステージング更新: `https://9abd13cf.dsf-studio.pages.dev` / `v2026.10.10-121302`。ルール変更なし。未コミット・本番未反映。
- 更新後のステージングでも、hover表示→自動非表示、タッチ初回表示→再タップ非表示を確認。証拠画像 `outputs/staging-preview-before-dismiss.png` / `outputs/staging-preview-after-dismiss.png`。

## 2026-10-10 読書補助の一時非表示（ローカル）

- 読書補助をメニューから外し、保存済みの有効設定があっても起動しないようにした。今後の再検討に備えて実装と保存済み設定は保持。
- 共用モジュールの初期化は維持し、スマホのページ操作への影響を避けた。
- 実Chromeで拡大鏡の有効設定を一時的に入れて起動し、メニュー非表示・チェック解除・補助状態offを確認。検証後は元の設定へ復元。
- 390×844のReaderでページ移動操作とスライダーを確認し、1ページから2ページへ移動できた。
- 構文検証、差分検証、staging向けローカルビルド成功。証拠: `outputs/reader-menu-without-assistance.png`、`outputs/reading-assistance-hidden-build.log`。
- 直前の表示名称変更と今回の非表示変更はローカルのみ。コミット・ステージング更新・本番反映は行っていない。
