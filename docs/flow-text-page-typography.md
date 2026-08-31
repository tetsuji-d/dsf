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
  renderer versionは基準統一時に5へ更新。後述の三点リーダー修正で6へ更新し、以前の組版cacheを再利用しない。
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

## 縦三点リーダーの修正（renderer v6）

原稿のU+2026「…」「……」は変換せず、Flow共通rendererの`font-feature-settings`を`normal`にする。
以前の`"vert" 1, "vkna" 1`は、ブラウザーが回転する文字にも縦字形を強制し、三点が横向きになる原因だった。
`normal`は縦組みを無効化する指定ではない。ブラウザーが文字の向きに応じて自動的に縦字形を選ぶ。
[CSS Writing Modesの縦字形と横倒し文字の規定](https://www.w3.org/TR/css-writing-modes-3/#vertical-font-features)、
[CSS Fontsの既定feature処理](https://www.w3.org/TR/css-fonts-4/#feature-variation-resolution)に合わせる。

通常表示・測定・Press captureは同じrendererを使い、入力proxy／変換中表示も同じcomputed styleを継承する。
Renderer versionを6へ上げ、旧測定結果・runtime cache・publication composition evidenceを再利用しない。
本文、source offset、grapheme数、保存schema、翻訳、既存Fixed描画、Viewerコードは変更しない。
`...`（半角ピリオド3個）は別の文字列であり、自動的に「…」へ変換しない。
既発行DSFを書き換える処理や、罫線・インデントの追加はこの単位に含めない。

### この修正の検証

- `verify:flow-text-page-typography`で実rendererのstyle・原文／source range保持・見出し／本文・書字方向切替、
  IME fallbackとversionを検証。関連するFlow／保存／翻訳／固定テキスト／Viewer系を含む25検証scriptが合格。
  変更JSの構文検査、`git diff --check`、`npm run build:staging`も合格。lint／TypeScript scriptは未設定。
- 開発専用`/scripts/fixtures/flow-vertical-punctuation.html`で、認定registryの実WOFF2をSHA-256検証して使用。
  Noto Sans JP／Noto Serif JP × 400／700 × 縦／横の8条件で、実capture→projection→固定テキストViewer、
  原文無損失・project serializer round-tripが合格。縦三点が列中央に並ぶことを両書体・両weightで目視確認。
- 同fixtureで両書体の全角396字は1ページ、397字は396＋1の2ページを確認。
- `flow-direct-composition.html`の「三点リーダー・約物」サンプルで縦横・2書体・見出し／本文・3倍率の24条件を確認。
  通常表示と変換中文字の先頭位置／行列中心差は最大約0.029論理px。Rangeは字形のink中心の証明ではないため、
  字形の向きは別途目視確認した。OSの実IME候補ウィンドウはこのfixtureで再現しない。
- ローカルChromiumの通常Studioで三点リーダー入力、Shift＋矢印選択、選択保持した見出し変更とUndo、
  Ctrl＋Enterによる改ページとUndoを確認。固定レイアウトの既定本文容量は維持。

### v6の追加比較で見つかった別件（下記の修正で対応）

通常Flowと固定テキストViewerのRange相対座標に、縦方向は列のxが約-0.924px、横方向は行のyが約+2.73pxの差がある。
三点リーダーに限らず漢字でも発生し、従来のforced vert描画でも同じ差になるため、この修正による回帰ではない。
Captureの文字外接矩形とViewerのline box／lineHeightの扱いを次の独立単位で調べる。
上のPASSは本文無損失と字形方向を示し、FlowとViewerの全座標一致を意味しない。
罫線を組版基準として追加する前に、この差を切り分け・修正するのが安全。

通常Studioの検証中、Ctrl＋Homeで`handleFlowDirectNavigation()`の`projection.pages`がnull参照になるログも1件記録した。
同関数は今回未変更で、生成ページを開き直して同操作を行うと見出し先頭へ正常移動し、再発しなかった。
このため「console errorなし」とは扱わず、projectionが未取得になる条件と安全な待機／再開を別の小単位で確認する。
三点リーダーの比較fixture／変換中文字fixtureにconsole errorはない。

この修正では実DSFダウンロード→Viewer再読込、クラウド保存、Horizon発行、commit、deployは行っていない。

## Flow配信の行ボックス補正と直接編集の復旧（renderer v7）

Flow captureは従来、文字のRange外接矩形をそのまま配信行の枠としていた。
Viewerは枠の中に改めて行高を適用するため、元のFlowと文字位置に差が生じていた。
既存Fixed配信が使うCSS行／列ボックスに合わせ、Flow capture側だけを修正した。

- 元のHeading／Paragraphの実font・文字サイズ・行高・揃えと、同じ原文を使う非表示probeを測る。
  Viewerと同じ折返し禁止div＋span構造と、元の単位なし行高を使用する。
  枠の寸法にはcomputed行高と元blockの行内寸法を使用し、文字Rangeの差から枠の原点を求める。
- 先頭だけでなく各graphemeの位置・寸法・枠内描画を照合する。固定pxや平均font offsetは使わない。
  計測probeはcapture sessionと一緒に破棄し、通常のキー入力／ページネーションへ計測負荷を加えない。
- 原文・source offsets・配信schema・Viewer・既存Fixedは変更しない。過去の公開DSFも書き換えない。
  rendererVersionを7へ更新し、v5／v6の計測snapshotとruntime cacheの再利用を拒否する。
- フォント完了／自動保存後の直接編集でprojectionが欠落した場合、既存の重複抑止付き再計算へ戻す。
  選択と履歴を保持し、IME変換中はDOMを再描画しない。詳細は`flow-direct-edit-navigation.md`を参照。

### v7の検証

- 実app handlerのnull復旧・連打・IME取消・選択保持を含む31個の関連検証scriptが合格。
  capture／publication／既存Fixed／Viewer／portable ZIP／保存／翻訳／Undoも含む。
  変更JSの構文検査、diff check、ステージング用buildが合格。lint／TypeScript scriptは未設定。
- ローカルChromiumの実認定fontで、Sans／Serif × 400／700 × 縦／横を比較。
  本文、見出し、Heading＋本文＋手動改ページ＋空段落、日本語・英数字・約物混在、3,000字、
  中央／後端揃え、全角字下げ、通常の長い英文で原文・保存再読込・各文字の配信位置を確認した。
  最大差は約0.029 canonical px。3,000字は各条件8ページで全3,000字を保持する。
- 396字は両書体・両weightで縦書き1ページ、397字は396＋1の2ページを維持する。
  通常StudioでもCtrl＋Home／End、入力直後のキー移動、選択付き書式変更とUndo、直接改ページとUndoを確認。
  この単位の通常操作・fixtureにconsole errorは記録されなかった。

### v7時点の空白と再現できない組版の境界（空白は下記v8で更新）

Viewerの既存`nowrap`は行内の連続半角空白やTABを圧縮し、Flowの`pre-wrap`とは挙動が異なる。
同様に、均等揃えで伸長された文字間隔を単一の折返し禁止行では再現できない場合がある。
今回の検査では、こうした違いを無視して発行せず、captureの理由code付きで停止する。
連続半角空白と複数行の均等揃えを実ブラウザーで検出した。解消には別の配信互換性検討が必要。

通常英文の**行末だけ**にある半角spaceは、Viewerでadvanceが0でも可視文字も次行の固定座標も変わらない。
末尾以降がspace／改行だけである場合に限り、その非描画advanceを原点・寸法比較から除外する。
JSONの原文とoffsetは全て保持し、全可視文字の一致を引き続き検査する。途中／先頭の空白を黙って除去しない。
全角spaceによる字下げは通常比較で合格する。

この単位では実DSFダウンロードからの再読込、OS実IME候補ウィンドウ、クラウド保存、Horizon発行は再検証していない。
commit／deployは別の明示承認で行う。罫線・方眼・インデント設定UIは未追加。

### 空白保持の互換拡張（2026-09-01、rendererVersion 8）

Architect承認後、新Flow publicationだけに`whiteSpaceMode:'preserve-v1'`を出力する方式を実装した。
半角space・TAB・NBSP・全角spaceをそのまま保持し、LF／CRは非表示text nodeで保存して二重改行を防ぐ。
作者の中央／後端揃えは実測座標で維持し、配信styleは`start`へ正規化する。原稿の設定は変更しない。
旧v7の「末尾spaceがcollapseしても比較から除外する」例外は廃止し、空白のadvanceも照合する。
既存DSFのmode省略は従来どおり。新指定を含むDSFは対応Viewerが必要で、旧Viewerは安全に拒否する。

実認定fontの縦横128条件、保存再読込と全Range照合（最大差約0.0293px）、関連31検証とstaging buildが合格。
均等揃えの一般対応・RTL・罫線／方眼・インデントUIは別単位。詳細と検証範囲は
[`flow-fixed-text-spacing-plan.md`](flow-fixed-text-spacing-plan.md)を参照。2026-09-01の指示に基づくステージング反映対象。本番反映は別承認。
