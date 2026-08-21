# Flow Layout Model

## Status

Commit 2〜5でFlowDocument、pagination、DOM preview、増分リフロー、縦書きpreviewを実装した。
Commit 6AではFixedとFlowを同じ作品順へ配置する純粋なProject v6 authoring modelを追加した。
Commit 6BではProject v6をStudio state、Undo/Redo、IndexedDB、DSP、owner専用Firestore authoring文書へ接続した。
Commit 7Aでは保存済みFlow原稿をruntimeで再ページ化し、EditorとPressの確認用ページ列へ接続した。
Commit 8AではFlow原稿カードを連続semantic editorへ接続し、増分reflow、既存Undo/Redo、autosaveを利用できるようにした。

言語別Flow翻訳、WebP化、DSF／Horizon発行、Viewerにはまだ未接続である。生成ページを
`state.blocks`、`state.sections`、`state.pages`へ書き戻すことも行わない。

## 境界

- 現行Fixed Layoutの正本は従来どおり`state.blocks`。
- Project v6では、順序付き`blocks[]`を作品のauthoring spineとし、既存Fixed Blockと`kind:'flow'`のFlow Groupを混在できる。
- Flow本文の正本はFlow Group内の独立した`FlowDocument`とする。
- Flow内の`sections[].blocks[]`は`type`を使い、既存Blockの`kind`と混在させない。
- ページは編集データではなく、FlowDocumentから毎回導出する一時結果。
- 配信時は導出ページをStudio／Press側でWebP化し、Viewerは既存の画像ページを読む方針を維持する。

## Project v6 authoring spine（Commit 6A）

Project v6の`blocks[]`は、FixedページとFlow原稿の作品内順序を保持する。プロジェクト全体を
`layoutType:'fixed'|'flow'`で排他的に分類しない。

```json
{
  "version": 6,
  "blocks": [
    {
      "id": "fixed_page_before",
      "kind": "page",
      "content": {}
    },
    {
      "id": "flow_group_story",
      "kind": "flow",
      "flow": {
        "document": {
          "schemaVersion": 1,
          "layoutType": "flow",
          "id": "flow_document_story",
          "sourceLanguage": "ja",
          "sections": []
        },
        "layout": {
          "schemaVersion": 1,
          "pagePreset": "dsf-canonical",
          "padding": { "top": 20, "right": 20, "bottom": 20, "left": 20 },
          "typographyByLanguage": {
            "ja": { "writingMode": "vertical-rl" }
          }
        }
      }
    },
    {
      "id": "fixed_page_after",
      "kind": "page",
      "content": {}
    }
  ]
}
```

バージョンは用途ごとに分離する。

- Project authoring schema: v6
- Fixed generated/output Page schema: v5（変更なし）
- FlowDocument schema: v1
- FlowLayout schema: v1
- 配信DSF schema: v1（変更なし）

Project v6 normalizerは既存Fixed Blockをopaqueなauthoring dataとしてdeep cloneし、Flow Groupだけを
識別する。既存`blocks[]`がないlegacy Fixed v5入力だけは`normalizeProjectDataV5()`でcanonical blocksへ
移行するが、Flowを含むmixed spine全体をV5 adapterへ渡さない。`ensurePageBlocks()`や`blocksToPages()`へ
Flowを接続せず、Flow-only作品へ既定Fixedページを追加せず、Fixed／Flowの相対順序を変更しない。

Project v6のFlow Groupに`status`は置かない。authoring spineに存在すること自体を原稿へ接続中とみなし、
将来の「固定レイアウトとして複製」は元Flowプロジェクトを残した別プロジェクトとして扱う。

## Semantic source

```json
{
  "schemaVersion": 1,
  "layoutType": "flow",
  "id": "flow_document_*",
  "sourceLanguage": "ja",
  "sections": [
    {
      "id": "flow_section_*",
      "title": { "ja": "第1章" },
      "blocks": [
        {
          "id": "flow_heading_*",
          "type": "heading",
          "level": 1,
          "texts": { "ja": "第1章" }
        },
        {
          "id": "flow_paragraph_*",
          "type": "paragraph",
          "texts": { "ja": "冬の金沢は静かだった。" }
        },
        {
          "id": "flow_page_break_*",
          "type": "pageBreak"
        }
      ]
    }
  ]
}
```

`texts`と`sourceLanguage`は既存DSFの保存済み言語キーをそのまま使う。`en-us`を`en-US`へ変えるような正規化は行わない。翻訳は同じSection／Block IDに別の言語キーを追加できる。

未知のJSONキーとBlockはnormalizationで保持する。ただし未知Blockを無視して本文を欠落させないため、validationとpaginationは`unsupported_block_type`で停止する。

## Generated pages

`paginateFlowDocument()`は既存Page v5ではない一時的な`pages[]`を返す。

```json
{
  "index": 0,
  "manualBreakBefore": null,
  "fragments": [
    {
      "sectionId": "flow_section_*",
      "blockId": "flow_paragraph_*",
      "blockType": "paragraph",
      "languageKey": "ja",
      "text": "冬の金沢は",
      "sourceRange": {
        "start": 0,
        "end": 5,
        "startGrapheme": 0,
        "endGrapheme": 5
      },
      "isBlockStart": true,
      "isBlockEnd": false
    }
  ]
}
```

- `start/end`は元Block文字列内のUTF-16 offset。
- `startGrapheme/endGrapheme`は書記素単位の範囲。
- `fragment.text`は表示・計測用の派生値で、正本ではない。
- 断片を元Blockのrange順に連結すると、空白・改行を含む元文字列と完全一致する。
- 生成ページへ永続IDは付けない。
- `pageBreak`は可視fragmentではなく、次ページ境界として`manualBreakBefore`へ記録する。

## Measurement contract

Paginatorは文字数固定でページ容量を推測しない。呼び出し側が同期measurerを注入する。

```js
measurePage({ pageBox, pageIndex, languageKey, writingMode, fragments })
// => { fits: boolean }
```

measurerは同じ入力に同じ結果を返し、短いprefixが収まればそれより短いprefixも収まる単調性を持つこと。Commit 2のテストでは決定的な容量measurerを使い、後のUI接続でDOM実測へ差し替える。

ページサイズは`pageBox`として明示的に渡す。`createCanonicalFlowPageBox()`は`js/page-geometry.js`の360×640定数を再利用し、既定padding 20で本文領域を作る。

## PageBreak semantics

- `A, pageBreak, B` → `[A] [B]`
- `pageBreak, A` → `[] [A]`
- `A, pageBreak` → `[A] []`
- 連続PageBreakは間の空ページを保持する。
- 本文中の`===`は通常文字であり、改ページとして解釈しない。

## Commit 2で変更しないもの

- `js/state.js`, `js/blocks.js`, `js/pages.js`, `js/sections.js`
- Fixed Layoutの編集・保存・Undo/Redo
- FlowDocumentのFirestore／DSP保存
- Studioの入力UIとページプレビュー
- Press／Viewer／翻訳provider／graphic layers

保存統合を行うCommitでは、`docs/data-model.md`と`docs/file-format-spec.md`を更新し、schema migrationと後方互換を別途合意する。

## Project v6 normalization invariants（Commit 6A）

- 入力objectを変更せず、出力との参照を共有しない。
- Fixed／Flowの順序、ID、言語キー、空白、未知fieldを保持する。
- 既存Fixed Blockの内部形状へ新しいstrict validationを課さない。ただしspineの外側`id`と`kind`は全Blockで必須とする。
- 未知のtop-level Block kindと未知のFlow semantic Blockは保持するが、validationで停止する。
- 不正または欠落したFlowDocumentを空原稿やFixedページへ置換しない。
- Project v6で`blocks[]`が空なのにlegacy `sections[]`／`pages[]`だけに内容が残る状態は停止する。
- `pages`、`generatedPages`、`fragments`、pagination cacheをFlow Groupへ保存しない。
- normalization中にpaginationを実行しない。
- Project v7以降、FlowDocument v2以降、FlowLayout v2以降をv6／v1へ丸めない。

Commit 6Aの対象外:

- `state.js`、Undo／Redo、Studio UI
- ローカル保存、Firestore、DSP import/export
- runtime page projection、通しページ番号、サムネイル
- Press、DSF、Viewer、多言語Flow発行
- Flow生成ページ上のgraphic layers
- 「固定レイアウトとして複製」

## Project v6 persistence boundary（Commit 6B）

- `state.blocks`はFixed／Flow混在authoring spineの正本として保存・復元する。
- Fixed-onlyの既存作品はProject v5のまま維持し、Flow Groupを含む作品だけが明示的にProject v6を使う。
- FlowDocumentとFlowLayoutは既存のUndo／Redo snapshotに含め、別の履歴システムを作らない。
- `refresh()`はmixed spine内のFlow GroupとFixed拡張fieldを保持する。Fixedページ数と互換Section数が
  一致しない場合は、Flowを跨ぐ挿入位置を推測せず停止する。
- IndexedDB、local recent、DSP、Firestoreの全読込入口はstate mutation前に同じProject validatorを通す。
- DSP Project v6は`meta.json.schemaVersion: 2`と`project.json.version: 6`を使う。legacy DSP v1は継続読込する。
- 公開可能なFirestore project rootへFlow semantic sourceを保存しない。完全なProject v6はowner専用の
  `projects/{pid}/authoring/current`へ保存し、rootと同一batchで更新する。
- 公開rootは明示的な公開field allowlistから構築し、未知のauthoring拡張はowner専用childだけで保持する。
- `authoring/current`は850 KiBのsoft limitを持つ。超過時もlocal/DSP原稿は維持し、cloud writeだけを停止する。
- Firestore RulesはProject versionのdowngradeと、authoring childを残したroot単独削除を拒否する。
- StudioのFlow Group外側は作品順の誤変更を防ぐため位置固定とする。内側のsemantic原稿はCommit 8Aの
  連続原稿面で編集する。Flow Groupを含む作品のPress／DSF発行は欠落を防ぐため停止する。

詳細は`docs/cloud-save-contract.md`を正本とする。

## Studio runtime page projection（Commit 7A）

- `blocks[]`の作品順を走査し、Fixedページを1件、Flow Groupを生成ページ数分のruntime cellへ展開する。
- Flow Group自身は左ページ列で「Flow原稿」として残し、その直下に読取専用の生成ページを表示する。
- 通しページ番号、Editorの前後移動／スライダー、Pressのページ一覧は同じruntime projectionを使う。
- `state.activeIdx`は従来どおりFixed互換Sectionのindexとし、Flow生成ページの選択を代入しない。
- DOM計測と表示は`renderFlowGeneratedPage()`を共有し、横書き／日本語縦書きの同じ結果を使う。
- requested languageの全Text BlockとTypographyが揃う場合だけその言語を表示する。翻訳が未完成なら
  原文へ明示fallbackし、翻訳本文があるのにTypographyだけ欠ける場合は設定エラーとして停止する。
- Project／言語／フォントの変更とroom退室では進行中の生成を中止する。完成した最新snapshotだけを表示する。
- runtime cacheはセッション限定LRUであり、生成page、fragment、選択位置を保存しない。
- Fixed／Flow混在時の見開き表示と言語比較は、統一された見開き契約を実装するまで無効化する。
- Pressは生成ページと通し番号の確認だけを行う。Flowを含む作品のDSF書き出し／Horizon発行は、
  WebP rendererを接続する次工程までUIと最終処理の両方で停止する。

## Studio Flow authoring（Commit 8A）

- Flow原稿カードと生成ページカードはruntime-onlyの別選択とする。原稿カードでは連続編集面、生成ページでは
  既存360×640ページpreviewを表示し、`state.activeIdx`へFlowページ番号を代入しない。
- 編集正本はFlowDocumentのSection／Heading／Paragraph／PageBreakだけで、入力のたびに`state.blocks`を
  検証済みの新しいspineへ置換する。生成page、fragment、cacheはstate／DSP／Firestoreへ保存しない。
- text入力では既存Block ID、他言語、未知fieldを保持する。新しいsemantic BlockだけfactoryでIDを作る。
- semantic sourceはinputごとに更新し、DOM paginationだけを140ms debounceする。IME composition中はreflowと
  autosaveを保留し、compositionend後に最新revisionを1回生成する。
- DOM measurerとincremental paginatorはEditor／Press別のruntime sessionとして保持する。原稿差分では前回の
  checkpointと計測cacheを再利用し、project／layout／font変更では破棄する。
- 連続入力は既存Historyのgrouped snapshotを使い、PageBreak追加・削除・移動・Heading level変更は独立操作とする。
- 保存中に次のautosave要求が来た場合は、進行中保存の完了後に最新版をもう一度保存する。
- 今回編集できるのはFlowDocumentの`sourceLanguage`だけ。Section追加・削除、段落途中のBlock分割、翻訳、
  Flow Group外側の移動・削除、Flow pageのWebP発行は次の実装単位とする。

次の実装単位は言語別Flow翻訳、その後にFlow pageのWebP化／DSF発行を扱う。

## DOM preview boundary（Commit 3）

`flow-preview.html`は、FlowDocumentと生成ページの関係を実ブラウザで確認するための独立画面である。

- Studioの`state`、認証、自動保存、Undo/Redoを読み書きしない。
- Fixed Layoutの旧`autoFlowTextSection()`を呼ばない。
- 入力から生成したFlowDocumentはメモリ内だけに保持し、DSP/DSFへ保存しない。
- 計測用DOMと可視ページは`renderFlowFragments()`を共有する。
- Commit 3時点では入力後120msのdebounceで全文を再ページ化し、生成ページだけを再描画する。
- Webフォントが入力後に追加読込された場合は`FontFaceSet.loadingdone`で再ページ化する。
- 今回のDOM実測は`horizontal-tb`だけを明示対応とし、縦書きは別の検証単位にする。
- 改ページUIの`[[PAGE_BREAK]]`表記は一時的な入力記法であり、pagination前にsemanticな`pageBreak` Blockへ変換する。本文中の`===`は通常文字のまま扱う。
- 連続本文欄の各入力行を1つの`paragraph`へ変換し、先頭・末尾・連続空行も空Paragraphとして保持する。
- Commit 3は正確性確認の全文再計算とし、Commit 4候補でruntime増分処理を追加する。
- `flow-preview.html`はdevelopment／stagingだけのVite entryとし、production buildには含めない。

この画面の受け入れ確認後に、同じFlow core／DOM measurerをStudioのFlow専用編集面へ接続する。保存スキーマやViewer／Pressへの接続はさらに後の合意単位とする。

## Incremental reflow boundary（Commit 4 candidate）

増分リフローは保存されないruntime sessionとして実装し、FlowDocumentを正本とする境界を変えない。

- textareaの行番号をBlock IDとして再利用せず、行内編集では同じID、分割では左側、結合では先頭のIDを維持する。
- 各生成ページの開始／終了位置はruntime checkpointとして保持し、DSP／DSFへ保存しない。
- 前回文書との共通prefixより前のページは計測せず再利用する。
- 再計算後のsource cursor、残りのsemantic source、manual pageBreak、layout variantが一致した場合だけ、旧suffixへ合流する。
- page index依存レイアウトではindexが変わるsuffixを再利用しない。現在のpreviewは全ページ同一版面を明示して再利用する。
- DOM計測cacheはセッション限定LRUとし、本文、Block型、Heading level、Block開始／終了、pageBox、writing mode、言語、Typography、renderer version、font epochをkeyに含める。
- font loading完了／失敗時はDOM cacheとpagination checkpointを全破棄して全文再計算する。
- 入力中は旧previewを`stale`として明示し、最後に要求されたrevisionだけを反映する。日本語IMEのcomposition中は再計算を保留する。
- 見出し／本文の入力イベントごとにsemantic Block IDを調停し、paginationだけを120ms debounceする。
- paginationはページ単位でブラウザーへ制御を返す。新しい入力、font更新、明示invalidateは進行中の旧operationを中止し、完成前の部分snapshotを公開しない。
- 中止／supersede／計測失敗／`maxPages`超過では、最後に成功したpagination snapshotを維持する。DOMへ反映するのは最新revisionの完成結果だけとする。
- preview DOMは変更されたpage rangeだけを作り直し、共通prefix／suffixのpage nodeを維持する。
- 長大Paragraphの探索は残り全文を毎回候補にせず、有界probeから最大適合prefixを探索する。

この単位もStudio state、Undo/Redo、保存、翻訳provider、Press、Viewerへは未接続である。Studio統合前に、Flow sourceと生成固定ページの所有関係および保存schemaを別途合意する。

## Vertical writing preview boundary（Commit 5 candidate）

Flow DOM previewは、日本語原稿について`horizontal-tb`と`vertical-rl`を切り替え、同じsemantic sourceを再ページ化できる。

- 原稿入力欄は横向きの連続textareaのままとし、生成ページの組版方向だけを切り替える。
- 縦書きは`writing-mode: vertical-rl`、`text-orientation: mixed`を用い、文字は上から下、列は右から左へ進む。
- 計測DOMと可視ページは同じwriting mode、Typography、fragment rendererを使う。
- 空Paragraphは物理的な高さではなく論理block sizeを持ち、縦書きでは空の一列として扱う。
- 組版方向の切替時は進行中のreflowを中止し、DOM計測cacheとpagination checkpointを破棄して全文再計算する。
- 現在の縦書き対象は、日本語とFlow typography profileが許可する繁体字中国語である。英語、簡体字中国語、韓国語の縦書きは未対応として停止する。
- 縦中横、ルビ、圏点、割注、行頭・行末禁則の完全実装はこの単位に含めない。
- FlowDocument、生成fragment、source range、manual pageBreakの意味は横書きと共通である。

この単位も独立preview内のruntime検証に限る。Studio state、DSP／DSF保存、Fixed Layout、翻訳provider、Press、Viewerの表示方向には接続しない。
