# Flow Layout Core Model（Commit 2）

## Status

Internal foundation only. Studio UI、`state`、Firestore、DSP/DSF export、Press、Viewerには未接続。
この文書は保存スキーマの変更ではなく、接続前の純粋モデル契約を定義する。

## 境界

- Fixed Layoutの正本は従来どおり`state.blocks`。
- Flow Layoutは独立した`FlowDocument`を正本とする。
- Flow内の`sections[].blocks[]`は`type`を使い、既存Blockの`kind`と混在させない。
- ページは編集データではなく、FlowDocumentから毎回導出する一時結果。
- 配信時は導出ページをStudio／Press側でWebP化し、Viewerは既存の画像ページを読む方針を維持する。

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
