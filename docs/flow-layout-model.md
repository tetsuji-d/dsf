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
