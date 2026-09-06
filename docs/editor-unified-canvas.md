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

Flow内への画像挿入・semantic分割、複数Blockにまたがる選択、翻訳ページの直接編集は別単位とする。
