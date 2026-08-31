# Flow本文と既存テキストページの基準統一

2026-08-31。Flowの基本組版を、既存テキストページの**実際のEditor表示**へ合わせる修正。
保存schema、semantic本文、翻訳、既存Fixedの組版結果は変更しない。

## 本文の既定値

| 項目 | 縦書き | 横書き |
| --- | --- | --- |
| 論理ページ／本文枠 | 360×640／320×600（余白20） | 同左 |
| 本文サイズ | 16px | 16px |
| 列／行送り | 26px（lineHeight 1.625） | 30px（lineHeight 1.875） |
| 字間 | 2.182px | 0px |
| 段落後の追加余白 | 0px | 0px |
| 基準となる容量 | 全角33字×12列 | 20行（行内は実測） |
| 書体 | 言語別fontPresetを継承 | 同左 |

縦書きの列送りは既存Editorと同じ`floor(frame.w / maxLines)`、字間は
`(frame.h / charsPerLine - fontSize).toFixed(3)`から導出する。
`layout.js`の旧presetにある`lineHeight:1.8`／`letterSpacing:0`は、固定ページの最終表示値ではない。
旧FlowのParagraph後12pxは既定値から除き、通常の段落替えだけで次列／次行へ進める。

## 実装と互換性

- `layout.js`の`getTextPageTypographyDefaults()`が既存の版面・文字数・書体presetを共有する。
  Fixedの`getLangPreset()`の挙動は維持し、Flowには明示された縦／横書きを適用する。
- `resolveFlowDomTypography()`が共有既定値を使い、任意の第4引数`{ languageConfigs }`から
  言語別書体を読む。保存済みFlowの明示fontFamily／size／spacing等を優先する。
  CJKには従来のCJK書体選択を維持し、欧文fallbackへ暗黙に変更しない。
- Runtimeのproject snapshot、projection／group／incremental-session cacheにlanguageConfigsを含める。
  renderer versionは5とし、以前の組版cacheを再利用しない。
- Pressのfont選択・DOM capture・strict projectionには同じ設定snapshotを渡す。
  Pressの準備signatureを更新し、書体変更前のpreflight／ZIP readinessを失効させる。
- 本文を文字数だけで切る方式には戻さない。DOM実測とsemantic source rangeに基づく
  pagination、増分reflow、既存Undo／Redo、固定座標のViewer表示を維持する。
- 既定値のみの既存Flowは次の再計算でページ数が変わる。本文や保存設定の一括書き換えは行わない。
  明示的に保存された旧spacing等は作者設定として維持する。

## この単位に含めないもの

見出しは従来のサイズ倍率・weight・見出し後余白を維持するため、本文だけのページより容量を使う。
33×12は全角通常本文の基準であり、空行・約物・英数字・禁則により文字数は変わる。
Fixedの独自禁則、縦中横、ルビoverlayとFlowのブラウザー実測を完全統一する変更は含めない。
元のFlow本文を改変せず、これらはsource mapping／直接編集を含む別単位で扱う。

## 検証

自動検証: 新規`verify:flow-text-page-typography`で既定値・言語設定・override優先・source非変更を確認。
既存のFlow model／preview／page projection／incremental／direct edit／source mapping／authoring、
翻訳状態・適用、project persistence、publication capture／projection／preflight、release／portable ZIP、
固定テキスト・local Viewer系を実行して合格。変更JSの`node --check`、`git diff --check`、
`npm run build:staging`も合格。lint／TypeScript用scriptはこのworktreeに設定されていない。

実ブラウザー（ローカルChromium）では次を確認した。unit testでDOM容量を代用していない。

- 縦書き: 33字は1列、34字は2列、396字は1ページ、397字は2ページ（396＋1）。
- 短いParagraph12個は1ページ、13個は2ページ、1個削除で1ページへ戻る。
- 3000字の単一Paragraphは8ページになり、全fragmentを連結すると3000字を保持。
- 手動PageBreakで次ページ開始。横書きの短いParagraph20個は1ページ、21個は2ページ。
- 通常Editorで同じ明朝396字をFixed／Flowに置き、font16px、lineHeight26px、letterSpacing2.182px、
  33字×12列を確認。字送り・開始位置は一致し、最終列の座標差はブラウザー丸めによる0.16 canonical px未満。
- 満杯のFlowページ最終文字をクリック→Enter→2ページ目の空Paragraph→「追記」入力。
  横棒caretは入力位置へ追従し、Undoで1ページへ戻り、Redoで2ページと追記本文を復元。
- Project設定のゴシック→明朝→ゴシックがEditor／Press双方へ反映。
  本番認定Noto Serif JP／Noto Sans JPで各1 Flowページのpreflightに合格。
  Fixed1ページとの混在ZIPは両書体で7 entryのround-tripに合格し、書体変更でZIP hashも変化。
  検証用の未設定画像ページは先に除外（最初の画像ロード失敗はこのfixture由来）。

実DSFのダウンロードとViewerでの再読込はこの単位では再実施していない。
ローカルZIP／Viewer契約は既存自動検証で確認。クラウド保存、Horizon発行、commit、deployは未実行。
