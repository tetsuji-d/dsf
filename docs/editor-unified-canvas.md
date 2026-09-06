# 統合編集キャンバス

Fixedテキスト・画像・見開き画像・Flow生成ページを、作品順の一つの横スクロールキャンバスへ表示する。
Project/FlowDocumentの保存形式、Press、Release、Viewerは変更しない。

## 表示と編集

- 混在作品は既存のFlow page projectionを使用する。Fixedのみの作品も同じprojection builderを使う。
- 言語設定のpageDirectionで左右を決める。本文のwritingModeとは独立させる。
- ページ番号は既存book設定と作品全体の生成ページ数に基づく。Flow本文の前後編集で番号も更新する。
- 隣接する同じspreadImage groupの2面は隙間なく並べる。選択枠は両面に出し、クリックした面を編集する。
- 選択中のFixedページには元のcanvas-stageを一つだけ配置する。画像調整・吹き出し・固定本文・Undoの既存経路を再利用する。
- 他のFixedページは既存の隣ページrendererで描画する。プレビューのイベント・編集属性を除去し、DOM IDとSVG参照を分離する。
- Flow Group内のローカルpage indexは、group IDと組み合わせて作品内indexへ対応させる。直接編集・IME・選択範囲は当該Group内に保つ。
- ページ選択はクリックまたは既存のサムネイル・ページ送りで行う。スクロールだけでは編集対象を変更しない。
- 画面付近と編集中ページだけをDOMへ保持する。見開きの隙間がゼロでも仮想化対象を正しく計算する。
- Flow原稿モードと、明示的に開いた既存の言語比較表示は各専用画面を維持する。

## 検証

- `verify:editor-canvas-projection`: Group内indexの対応、左右方向、見開きの連続配置、仮想化、非破壊性。
- 既存canvas-layout、page-projection、direct-edit、direct-navigation、projection-recovery、history-editor-focus、fixed-page-spine、source-mapping検証。
- development限定の `scripts/fixtures/editor-unified-canvas.js` は混在原稿を生成するだけで、読み込み・保存・uploadを行わない。
- ローカルStudio: Fixed本文変更とUndo、画像上テキスト追加、画像ドラッグ、Flow入力・Enter・Undo、後半Groupの末尾編集、再ページ化による作品内番号更新、左右方向、狭い画面での表示を確認。

複数Blockにまたがる選択、翻訳ページの直接編集、見開きの途中挿入は別単位とする。

## 本文途中への画像ページ挿入

- 原文の生成ページにカーソルを置き、キャンバス右下の「＋ 画像ページ」または編集プロパティの「ここに画像ページを挿入」で画像を選択する。
- 画像準備成功後に、前半Flow・Fixed画像ページ・後半Flowを一度に反映し、画像を選択する。ファイル選択取消・読込失敗では本文を変更しない。
- 境界はsemantic Block IDと文字位置で決める。前半の増減は後半へ流し込まず、後半の本文と組版を維持する。作品通しページ番号だけは変わる。
- 原文のHeading／Paragraphの文字境界に対応する。選択範囲、IME変換中、翻訳側、翻訳処理実行中は挿入しない。
- 分割対象の翻訳は元のBlockに保持して既存のstale判定へ渡す。新しい後半Blockは未翻訳。分割しないBlockの本文・翻訳・lock・fingerprintは所属先へ移す。
- 前後のFlowは同じ組版設定を継承する。Section IDはDocument内のIDとして保ち、Document／Groupには新規IDを付ける。保存schemaは変更しない。
- 段落先頭・末尾での挿入では空の前半／後半を保持する（既存の改ページと同様）。画像削除後のFlow自動結合や、前後を同時に書式変更する操作は含まない。
- 画像準備には既存のWebP変換・サムネイル・guest IndexedDB／Storage処理を共用する。準備中に原稿・project・user・言語が変わった場合は挿入しない。既に保存済みの画像assetの自動削除は行わない。
- Undoは画像と分割をまとめて戻し、元のカーソルを復元する。Redoは画像ページを選択する。

検証: `verify:flow-image-insertion` は縦横・Heading／Paragraph・文字境界・独立reflow・翻訳保持・繰り返し挿入・保存再読込・Undo／Redoを確認する。

ローカルStudio実操作: 横書き／縦書きの画像選択・挿入、ドロワーを閉じた状態の挿入、Undo／Redoとカーソル復元、前半1→5ページへの加筆と後半保持、壊れた画像の拒否を確認。ファイル選択取消はブラウザーのcancelイベントで確認。認証付きStorageへの画像uploadは今回のローカル検証には含めない。
