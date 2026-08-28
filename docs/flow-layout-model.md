# Flow Layout Model

## Status

Commit 2〜5でFlowDocument、pagination、DOM preview、増分リフロー、縦書きpreviewを実装した。
Commit 6AではFixedとFlowを同じ作品順へ配置する純粋なProject v6 authoring modelを追加した。
Commit 6BではProject v6をStudio state、Undo/Redo、IndexedDB、DSP、owner専用Firestore authoring文書へ接続した。
Commit 7Aでは保存済みFlow原稿をruntimeで再ページ化し、EditorとPressの確認用ページ列へ接続した。
Commit 8AではFlow原稿カードを連続semantic editorへ接続し、増分reflow、既存Undo/Redo、autosaveを利用できるようにした。
Commit 8B-1では既存作品言語タブをFlow編集言語へ接続し、原稿構造を共有した言語別本文編集と独立reflowを追加した。
Commit 8B-2Aでは原文更新をBlock／Section title単位で検出する任意の`translationState` v1と、
missing／stale／untracked／review状態を導出する純粋ロジックを追加した。
Commit 8B-2Bではその状態をStudioのFlow翻訳面とruntime previewへ接続し、本文がmissing／staleの間は
翻訳文を保持したまま原文ページを表示し、明示確認とUndo／Redoを追加した。
Commit 8B-2C-AではGen4のprovider接続からページスロット依存を除いたruntime-only provider層と、
Flow semantic unitの翻訳request／atomic apply planを追加した。
Commit 8B-2C-BではChrome Translator／LM Studioの選択UI、model discovery、進捗／cancel、
atomic result applyをStudioへ接続し、機械翻訳結果を既存Undo／Redoとautosaveへ統合した。
Commit 8B-2C-Cではatomic apply失敗理由をProvider error／編集競合／不正結果へ分け、
一括適用しなかった理由を原稿を変更せずStudioへ表示するruntime feedbackを追加した。

Commit 9A-0では、グラフィックWebPと組版済み固定テキストを併用するDSF delivery v2の設計契約を確定した。
Commit 9A-1では、配信v2 index／言語manifestのpure normalizerとstrict validator、
Fixed／Flow source anchorによる言語別page mappingを追加した。
Commit 9A-2では、認定font gateと固定座標DOM rendererをViewerのdevelopment-only fixtureへ接続し、
WebPとのdual dispatch、ページ全体zoom、active branchのslider previewを確認した。別branchにある
未統合full minimapは対象に含めていない。
Commit 9A-3Aでは、既存Fixed text blockと認定fontに結び付けたcomposition snapshotから配信v2の1ページfragmentを
作るpure projectionを追加した。未対応表現は理由付きで既存WebP経路へ戻す。
Commit 9A-3Bでは、そのprojectionをdevelopment-only Pressサムネイルへ接続し、fixture fontで
fixedText DOM候補とWebP fallback理由を確認できるようにした。公開v2 loader、実発行、
Flow生成ページの固定テキストprojection、DSF／Horizon発行にはまだ未接続である。
Commit 9A-3Cでは、本番認定font registryの厳格契約とFixed pageごとのpure Press preflightを追加した。
本番registryは権利・実WOFF2・実hash未確認のため空であり、既存Fixed textはWebPを継続する。
Flow Groupを含むpreflightは未接続として公開不可にする。
Commit 9A-4Aでは、公開可能preflightと検証済みWebP descriptorからhash済みcontent index／言語manifestと
asset planを作るpure release assemblerを追加した。Flowのblocked preflight、WebP bytes、R2、実発行には未接続である。
Commit 9A-4Bでは、実WebP bytesのRIFF／chunk／codec寸法と静止画制約を検査し、Web Crypto SHA-256と
immutable Blobを9A-4A descriptorへ結び付けるlocal byte sealingを追加した。Flow発行やuploadには未接続である。
Commit 9A-4Cでは、その確定JSONとsealed WebPを再照合し、DSF archiveを構成する全ファイルのimmutableな
local inventoryを追加した。ZIP生成、Flow発行、Press UI、uploadには未接続である。
Commit 9A-4Dでは、そのinventoryを決定的なDSF ZIPへメモリ生成し、全entryのCRC／byteLength／SHA-256を
再展開照合するlocal packageを追加した。Flow発行、download、Press UI、uploadには未接続である。
Commit 9A-5Aでは、semantic FlowDocument、成功pagination、認定fontで実測済みのcomposition snapshotを
revision／page／grapheme range／line geometryでno-loss照合し、言語別`fixedText` page fragmentへpure projectionする
契約を追加した。文字数から行座標を推測せず、DOM snapshot capture、Press UI、assembly、uploadには未接続である。
Commit 9A-5Bでは、認定fontを明示loadし、単一font family・no-hyphenationの同一browser sessionで
Flowをページ化して`Range.getClientRects()`から行／縦書き列とsource grapheme runを採取し、直後に9A-5Aへ
no-loss投影するlocal captureを追加した。snapshotはruntime-onlyで、Press UI、assembly、uploadには未接続である。
Commit 9A-5Cでは、現在revisionと完全一致する成功Flow projectionだけをpure Press preflightへ通し、
Fixed／Flow／WebPを作者順の言語別manifestへpure assemblyする統合を追加した。Flowが言語ごとに異なるpage数へ
展開されても後続page順を維持し、古いrevision、別言語、未知font、anchor不一致、暗黙WebP fallbackを拒否する。
現在のPress UI／runtime、ZIP、upload、公開Viewerには未接続である。
Commit 9A-6Aではdevelopment-only Press UIから実DOM capture、Flow publication projection、preflightを接続し、
言語別候補page数と停止理由を表示する。missing／stale翻訳は原文fallbackせず停止する。local fixture fontだけを使い、
発行ボタン、容量見積り、release assembly、staging／production runtimeには接続しない。
Commit 9A-6B-Aではfixture非依存の共通preflightへ本番font registry resolverを接続し、staging／productionを含むPressで
本番準備状態を表示する。この時点ではregistryが空のため実原稿は`FONT_NOT_CERTIFIED`でDOM capture前に停止し、発行経路は無効のままにする。
Commit 9A-6B-B1／B2では本番WOFF2の実bytes検証とsession専用verified FontFace leaseを追加し、production Flow captureは
registry hashへ一致したbytesをbrowserがloadできた場合だけ進む。この時点ではregistryが空のためasset request前に停止する。
Commit 9A-6B-B3-AではNoto Sans JP 2.004-H2とNoto Serif JP 2.003-H1のsource／asset hash、full WOFF2 table比較、
縦書きfeature、OFL根拠を技術候補台帳へ固定した。production R2実体とremote evidence、Architect review未確認のため
この時点ではregistryを空にし、Flow発行停止を維持する。
Commit 9A-6B-B3-Cではremote evidenceとArchitect review済みの2候補だけをactive registryへ登録し、Flow Press既定経路で
Sans／Serifの横書き／縦書き、本文400／見出し700、巨大Paragraph、PageBreakを実測した。4ケースとも4ページのprojectionが
`ready`となり、exact hashとsession cleanupを確認した。発行ボタン、release assembly、upload、公開Viewerは未接続である。
Commit 9A-6C-Aでは成功した本番Flow準備とFixed pageのsealed WebP descriptorを既存DSF v2 release assemblyへin-memory接続し、
PressでWebP／fixedText件数、Horizon／portable payload、同梱font容量を確認できる。ZIP container込みの完成file sizeではなく、
ZIP、download、upload、Firestore、Horizon発行、公開Viewerには未接続である。Flow発行guardも維持する。
Commit 9A-6C-Bでは同じPress sessionのsealed WebPとactive registryから取得・exact検証した使用WOFF2を、既存portable planner、
complete file inventory、deterministic ZIP builderへ渡す。全entryを再展開してpath／bytes／SHA-256を照合した後、ローカル検証用
`.dsf`の実測ZIP容量とSHA-256をread-only表示する。Blob／結果はruntime-onlyで、download、upload、Firestore、Horizon発行、
公開Viewerには未接続である。Flow発行guardも維持する。
Commit 9A-6C-C-Aでは現在のPress設定とsignature一致するround-trip合格済みportable ZIP Blobだけを既存DSF書き出しへ渡す。
安全化した作品タイトルの`.dsf`名を使い、保存直前にもBlob identity／MIME／size／SHA-256を再照合し、旧WebP-only builderで再生成しない。入力変更、検証待ち／失敗、
Press離脱時は書き出しを無効化する。semantic Flow sourceはDSP側だけに残り、download artifactへ追加しない。Flow upload、Firestore、
Horizon発行、公開Viewer loadには未接続である。
生成ページを
`state.blocks`、`state.sections`、`state.pages`へ書き戻すことも行わない。
Commit 10A-0ではFlow原稿カードを選択中だけ既存の削除操作を有効化し、確認後にFlow Group全体を
authoring spineから1回のtransactionで削除する。原稿、翻訳metadata、生成ページはまとめて消え、既存Undo／Redo、
autosave、IndexedDB、DSP、owner専用Firestore保存経路をそのまま使う。生成ページの個別削除は引き続き禁止する。

## 境界

- 現行Fixed Layoutの正本は従来どおり`state.blocks`。
- Project v6では、順序付き`blocks[]`を作品のauthoring spineとし、既存Fixed Blockと`kind:'flow'`のFlow Groupを混在できる。
- Flow本文の正本はFlow Group内の独立した`FlowDocument`とする。
- Flow内の`sections[].blocks[]`は`type`を使い、既存Blockの`kind`と混在させない。
- ページは編集データではなく、FlowDocumentから毎回導出する一時結果。
- 配信時はStudio／Pressが導出ページの改行・改ページを確定し、DSF v2の`fixedText`ページへ投影する。
  Viewerは組版済み行／縦書き列を固定座標へ描画し、再組版しない。グラフィックページと固定テキスト非対応の
  フォント／効果を持つページは従来どおりWebPを使う。
- 詳細は`docs/fixed-text-delivery-contract.md`を正本とする。実装完了まではFlow発行停止を維持する。

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
- 配信DSF schema: v1はWebP-only互換、hybrid deliveryはv2（9A-0設計、runtime未接続）

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
  hybrid delivery v2の固定テキストprojectionとViewerを接続するまでUIと最終処理の両方で停止する。

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
  Flow Group外側の移動・削除、Flow pageの固定テキスト発行は次の実装単位とする。

## Studio Flow multilingual authoring（Commit 8B-1）

- 既存の`state.activeLang`をFlow原稿カードの編集言語として使う。保存済みの完全一致言語キーだけを選択し、
  大文字小文字やBCP 47 aliasを暗黙変換しない。
- 原稿言語では従来どおりHeading／Paragraph／PageBreakとHeading levelを編集できる。翻訳言語では
  Section title、Heading text、Paragraph textだけを編集でき、追加・削除・移動・Heading level・PageBreakは
  原稿言語と共有する読取専用構造として表示する。
- 言語タブを選んだだけでは`texts[targetLanguage]`を作らない。部分翻訳は対象言語と原文を同一ページへ混在させず、
  既存runtime契約によりFlow Group全体を原文previewへ明示fallbackする。
- 翻訳言語で最初の本文またはSection titleを編集した時だけ、原稿言語のFlow typographyを基に
  `typographyByLanguage[targetLanguage]`を作成する。既存の対象言語profileは保持する。
- 全Heading／Paragraphに対象言語の文字列キーが揃うと、その言語を独立してDOM実測・増分reflowする。
  原稿と言語別生成ページのページ数は一致を要求しない。PageBreakの位置だけは共有する。
- 翻訳編集も同じ`state.blocks`、Undo／Redo、IndexedDB、DSP、owner専用Firestore authoring childを使う。
  Fixed Blockとその未知field／layerはopaqueに保持し、生成ページは引き続き保存しない。
- FlowDocumentの`sourceLanguage`として使われている作品言語はProject Settingsから削除できない。

8B-1は手動言語別編集の境界である。Gen4の旧翻訳orchestratorは共通ページスロットを前提として翻訳先の
ページ数変更を禁止するため移植しない。8B-2Aでは原文更新後のstale判定をFlow semantic Block向けに追加し、
8B-2BでStudio表示とpreview fallback、8B-2C以降でChrome／LM Studio providerを段階接続する。その後に
Flow pageの固定テキストprojection／DSF delivery v2発行を扱う。

## Flow translation freshness contract（Commit 8B-2A）

`flow.translationState`はFlow本文や組版ではなく、翻訳がどの原文に対応しているかを示す任意のauthoring
metadataである。Project v6、FlowDocument v1、FlowLayout v1、DSP schema v2は変更せず、translationState
だけが独立した`schemaVersion:1`を持つ。

```json
{
  "translationState": {
    "schemaVersion": 1,
    "languages": {
      "en-us": {
        "sourceFingerprints": {
          "blocks": {
            "flow_paragraph_1": "u1AbCdEf012_-"
          },
          "sectionTitles": {
            "flow_section_1": "u1ZyXwVu98765"
          }
        },
        "reviewState": "needs-review",
        "origin": "machine",
        "lockedUnitIds": []
      }
    }
  }
}
```

- `languages`は保存済み言語キーを完全一致で使い、原稿言語自身のentryは持たない。
- fingerprintは`u1` + FNV-1a 64-bitのbase64url 11文字で、原文や翻訳文をmetadataへ複製しない。
- canonical配列、UTF-8化、hash、byte順、encodingのいずれかを変える場合はprefixを`u2`へ上げ、`u1`を再解釈しない。
- Heading／ParagraphはBlock ID、Section titleはSection IDで個別追跡する。
- 原稿言語キー自体がないSection titleは翻訳対象外とし、意図的な空文字キーは追跡対象として区別する。
- fingerprint対象は原稿言語キー、Section所属、ID、Block type、原文キーの有無、原文文字列である。
- target本文、Typography、Heading level、PageBreak、生成page、Blockの同一Section内順序はfingerprintへ含めない。
- 別SectionへBlockを移した場合はSection所属が変わるためstaleになる。
- `stale`は保存せず、保存fingerprintと現在の原文fingerprintの不一致から毎回導出する。
- 既存8B-1翻訳のようにmetadataがない完全なtarget本文は`untracked`として表示可能かつ上書き保護対象とする。
- `origin:'manual'`はfingerprintを持つ既存unitだけを暗黙ロックする。後から追加されたmissing unitはロックしない。
- `lockedUnitIds`は`mixed`等で個別の手動修正unitを保護する任意リストであり、全IDを重複保存しない。
- `origin`は`manual | machine | mixed`、`reviewState`は`needs-review | reviewed`だけを保存する。
- provider／model／接続先、進捗、error、cancel状態はProjectへ保存しない。
- 現在の文書に存在しない古いfingerprint IDは読込を停止せず無視できる。明示更新時に整理する。

statusは本文Heading／ParagraphとoutlineのSection titleを分けて導出する。本文のmissingまたはstaleは後続の
Commit 8B-2Bで原文previewへfallbackさせる。metadataなしの`untracked`は8B-1互換のため、それだけを理由に
fallbackしない。Section titleだけがstaleでも本文ページはfallbackしない。

translationStateはFlow Group内に保存するため、IndexedDB、DSP、owner専用Firestore
`authoring/current`ではround-tripし、公開project rootと配信DSFには出さない。850 KiB制限を守るため、
per-unit provider名、timestamp、原文、翻訳文は保存しない。100 Section／1,000 Paragraph／1対象言語の
検証fixtureではtranslationStateは約45 KiB、Project全体は約280 KiBだった。UUID相当の長いIDと5対象言語を
持つ保守的fixtureではtranslationState約357 KiB、Project全体約902 KiBとなり、現行850 KiB cloud soft limitが
明示拒否することも検証する。この場合もlocal／DSP原稿は維持される。多数言語・長大原稿のcloud保存は、将来の
authoring child分割で解決する必要がある。

Commit 8B-2Aの対象外:

- Studioのbadge、警告、原文preview切替
- source編集時のbaseline登録、手動確認、Undo操作
- Chrome Translator／LM Studio provider
- 翻訳job、進捗、cancel、atomic apply
- Flow pageの固定テキストprojection、DSF／Horizon発行、Viewer

## Studio translation freshness feedback（Commit 8B-2B）

- Studio中央のFlow翻訳面は`deriveFlowTranslationStatus()`の本文とoutline内訳を表示する。未翻訳、原文更新、
  状態未登録、要確認、確認済みを区別し、PageBreakには翻訳状態を付けない。
- 本文Heading／Paragraphにmissingまたはstaleがある場合、`resolveFlowRuntimeLanguage()`は翻訳文を削除せず
  原稿言語へfallbackする。既存8B-1翻訳の`untracked`だけではfallbackせず、Section titleだけの問題でも
  本文ページは翻訳言語を維持する。EditorとPressの確認用runtimeは同じ判定を使う。
- metadataなしの既存翻訳を持つ原文unitが初めて編集される時は、変更直前のfingerprintを一度だけ登録する。
  2文字目以降の入力でbaselineを動かさないため、更新後は確実にstaleとなる。既存fingerprintは上書きしない。
- 翻訳Heading／Paragraph／Section titleを手動編集した場合は、そのunitだけを現在の原文fingerprintへ更新する。
  machine由来のunitは`mixed`へ移し、そのunitを`lockedUnitIds`で保護する。他のstale／missing unitは変えない。
- 状態帯の「現在の原文に対応済みとして確認」は、値が存在するunitだけを現在のfingerprintへ再登録し、
  `reviewState:'reviewed'`とする。missing unitはmissingのままであり、翻訳文を自動生成しない。
- 原文編集前baseline、翻訳unit更新、明示確認は本文変更と同じ`state.blocks` transactionに含める。
  既存History、autosave、IndexedDB、DSP、owner専用Firestore経路を使い、専用Undoや別保存面を作らない。
- runtimeの`stale`とpreview選択は保存しない。Project v6、FlowDocument v1、FlowLayout v1、
  FlowTranslationState v1、DSP schema v2および公開境界は変更しない。

Commit 8B-2Bの対象外:

- Chrome Translator／LM Studio providerとprovider設定UI
- 翻訳job、進捗、cancel、atomic batch apply
- Flow pageの固定テキストprojection、DSF／Horizon発行、Viewer
- Flow編集画面全体の再設計

## Flow translation provider foundation（Commit 8B-2C-A）

- `translation-provider.js`はprovider登録、model一覧、要求／応答validation、cancel対応だけを所有する。
  Project state、History、保存、UI状態は所有しない。
- `browser-translator-provider.js`はChrome Translator APIのlocal sessionを再利用し、URL、テンプレートtoken、
  製品コードと空白を保護する。FlowのPageBreakは独立Blockなので、本文内の改ページmarkerやpage slot同期は扱わない。
- `lm-studio-translator-provider.js`はloopbackのOpenAI互換endpointとmodel discoveryを再利用する。promptは
  翻訳後のページ数変更を明示許可し、旧Gen4の固定page slot数への文字数圧縮を要求しない。
- `flow-translation-request.js`はSection title、Heading、Paragraphを安定ID付きprovider unitへ変換し、
  PageBreakを要求から除外する。既定対象は`missing`／`stale`で、`untracked`および手動lockは上書きしない。
- requestは原文fingerprintとtargetのruntime snapshotを持つ。provider完了までに原文・翻訳文が変わる、
  unitが削除／別Sectionへ移動する、resultが欠ける、unit errorがある、またはcancelされた場合、
  atomic apply planは編集を1件も返さない。
- provider/model/base URL、request、target snapshot、進捗、error、AbortControllerはruntime-onlyであり、
  `flow.translationState`、IndexedDB、DSP、Firestore、DSFへ保存しない。
- Gen4の`translateTextFlows()`、`synchronizeTextFlowPages()`、共通page slot数、target page数変更禁止は移植しない。

Commit 8B-2C-Aの対象外:

- Studioへのprovider登録、provider／model選択UI、翻訳ボタン
- job進捗、cancel表示、retry、同時job制御
- atomic planを`state.blocks`へ適用するmachine／mixed transactionとUndo／Redo
- 実Chrome Translator／実LM Studioへの接続確認
- Flow pageの固定テキストprojection、DSF／Horizon発行、Viewer

## Studio translation job integration（Commit 8B-2C-B）

- Flow翻訳原稿だけにprovider／model選択、model更新、対象件数、翻訳開始／中止を表示する。
  Chrome Translatorが利用できないブラウザーでは選択肢を無効化し、LM Studioはloopbackからmodelを取得する。
- 自動翻訳の既定対象は`missing`／`stale`だけとし、`untracked`、手動訳、明示lockは上書きしない。
  PageBreakはproviderへ送らず、原稿言語と全翻訳言語で共有する。
- 同時実行jobは1件だけとし、進捗、error、cancel、AbortController、provider／model選択はruntime-onlyとする。
  project切替、Undo／Redoでは進行中jobを中止する。
- provider完了後に原文fingerprint、target snapshot、unit identityを再検証する。1件でも変更、欠落、provider errorが
  あれば結果を1件も適用しない。cancel時もFlowDocumentとHistoryを変更しない。
- 成功時は全結果を1回の`state.blocks` transactionで適用する。machine unitだけを現在の原文へ対応付け、
  既存手動訳がある言語は`origin:'mixed'`としてそのunit lockを維持し、全体を`needs-review`にする。
- apply直前に既存Historyへsnapshotを1件だけ積むため、Undo一回で翻訳前へ戻り、Redoで一括結果を復元する。
  適用後は既存autosaveとFlow増分reflowを使い、翻訳後のページ数変更を許可する。
- development専用の`flowTranslationVerification=1`は外部providerを使わずUI接続を検証するためのlocal test hookで、
  productionでは有効にならず、Project／DSP／Firestoreへ保存されない。

Commit 8B-2C-Bの対象外:

- glossary、追加指示、LM Studio endpoint変更の一般向けUI
- unit個別選択、retry queue、複数同時job
- Chrome Translator／LM Studioの翻訳品質評価
- Flow pageの固定テキストprojection、DSF／Horizon発行、Viewer

## Studio translation failure feedback（Commit 8B-2C-C）

- atomic applyの「1件でも失敗すれば全件を適用しない」境界は変更しない。
- `provider-error`は失敗件数と最初のProvider messageを表示し、原文／訳文変更とは区別する。
- unit削除、原文fingerprint変更、target snapshot変更、手動lock追加は編集競合として表示する。
- Provider errorと編集競合が同時に存在する場合は両方の件数を表示する。不明なvalidation issueは
  「翻訳結果を検証できなかった」と表示し、編集競合だったと推測しない。
- failure kind、issue、Provider messageはjobと同じruntime-only情報であり、Project、translationState、
  IndexedDB、DSP、Firestore、DSFへ保存しない。
- Undo／Redo時は完了済みjob messageも破棄し、復元後の翻訳状態と矛盾する成功表示を残さない。
- development専用verification providerはunit errorを再現できるが、本番buildと保存データには入らない。

Commit 8B-2C-Cの対象外:

- failed unitだけのretry、成功unitの部分適用、同時翻訳job
- LM Studioのtimeout値や推論性能の変更
- Chrome Translatorの対応言語ペア拡張
- Flow pageの固定テキストprojection、DSF／Horizon発行、Viewer

## Studio Flow group deletion（Commit 10A-0）

- Flow原稿カードのsource編集面を選択している時だけ、既存Editパネルの削除ボタンを
  「Flow原稿を削除」として有効化する。生成ページ選択中は無効のままとする。
- 確認文は原稿本文、全翻訳、translation metadata、生成ページがまとめて消えることと、Undoで復元できることを明示する。
- 削除はFlow Groupをmixed `blocks[]`から取り除くpure transactionとし、前後のFixed／Flow Block、未知field、
  `sections[]`のFixed互換面を変更しない。Project v6を暗黙にv5へdowngradeしない。
- 削除直前にHistory snapshotを1件だけ積む。UndoはFlowDocument、FlowLayout、翻訳を含むGroup全体を復元し、
  Redoは再度Group全体を削除する。専用Undo systemは作らない。
- 対象Groupの進行中翻訳、reflow、DOM paginationを中止し、runtime cache／selectionを破棄する。
  隣接BlockがFlowならそのsource、Fixedならそのページを選択し、既存autosaveを要求する。
- schema、DSP／Firestore保存形式、Press、Viewer、Horizon公開経路は変更しない。

## Paginated WYSIWYG Flow roadmap（Commit 10A-1以降）

現在のStudioは、semanticなHeading／Paragraph／PageBreakを連続textareaで編集し、生成された9:16ページを
別のread-only previewとして確認する段階である。Wordの印刷レイアウトのように生成ページ上へcaretを置いて
直接編集するには、次の安全単位に分ける。

1. **10A-1 Source mapping**: 生成fragmentのDOM位置とsemantic Block ID／grapheme offsetを双方向に対応付け、
   ページ上のクリックを原稿caretへno-lossで変換する。まだ文字は変更しない。
2. **10A-2 Direct typing**: 横書きの単一Block内で直接入力、選択、IME compositionを受け、semantic source更新後に
   増分reflowする。ページごとの`contentEditable`へ本文を複製しない。
3. **10A-3 Structural editing**: Enter／Backspace、Paragraph分割・結合、Heading、PageBreak、ページ境界を跨ぐ選択を
   既存Undo／Redoとautosaveへ統合する。
4. **10A-4 Production acceptance**: 縦書き、多言語切替、翻訳freshness、font load、長大原稿、caret復元、
   Browser差を確認し、従来の連続原稿面をfallbackとして維持する。

WYSIWYGでも保存正本はFlowDocumentであり、生成ページやページ別HTMLを保存しない。ページ編集は常に
`semantic source -> pagination -> generated fixed pages`を往復するprojectionとして実装する。

## Paginated WYSIWYG Flow source mapping（Commit 10A-1）

- pagination fragmentが既に持つSection ID、Block ID、language key、UTF-16 range、grapheme rangeを
  可視Flow DOMへruntime data属性としてno-loss投影する。Project／DSP／Firestoreには保存しない。
- pure mappingはfragment内DOM caretからsemantic grapheme境界へ変換でき、逆にsemantic source pointから
  対象page／fragment／DOM caret位置を求められる。絵文字ZWJ列や結合文字の途中をsource caretにしない。
- 生成ページ本文のクリックはBrowserのcaret hit-testを使い、同じ言語・Section・Blockの連続原稿textareaへ切り替えて
  UTF-16 caretを置く。本文、History、revision、autosaveを変更しない読み取り専用操作とする。
- 翻訳済みpageは翻訳原稿の同じBlockへ対応する。翻訳欠落／staleにより原文fallbackを表示中のpageでは、
  編集言語との誤対応を避けるためクリックマッピングを有効にしない。多言語fallbackの直接編集は10A-4で扱う。
- 生成pageは`contentEditable`にせず、keydown／beforeinput／IME compositionもまだ受けない。ページ上の直接入力、
  semantic source更新、増分reflowは10A-2へ分離する。
- Fixed Layout、Flow schema、Press、Viewer、Horizon publication contractは変更しない。

## Paginated WYSIWYG Flow direct typing（10A-2）

- 原稿言語の`horizontal-tb`生成ページで、Heading／Paragraph内のクリック位置にruntime caretを表示し、
  同じsemantic Blockの全文を持つ不可視textareaへ入力を受ける。生成DOMと不可視入力は保存しない。
- 新規Flow作成時は保存済み`writingMode`を最優先し、未設定の日本語だけ既存の「縦書き／横書き」
  `pageDirection`をwriting modeへ対応付ける。既存Flow Group内の組版値は自動変更しない。
- 通常入力と削除は、表示時の原稿本文が現在値と一致することをpure contractで再確認してから、既存の
  `setText` transaction、History grouping、autosaveへ渡す。確定後は既存incremental paginatorで即時reflowし、
  semantic caretが移動した生成ページを再選択する。
- IME composition中の未確定文字列はsemantic source、History、autosave、paginationを変更しない。
  composition確定時に最終値を1 transactionとして反映する。変換中文字はruntime overlayだけに表示する。
- Undo／Redo後は保存しないdirect-edit sessionからSection／Block／言語を再解決し、復元後本文の範囲へcaretを
  clampしてから再ページ化する。専用Undo systemは追加しない。
- 10A-2時点ではEnter／改行、複数行paste、Block分割・結合、ページを跨ぐ構造選択を拒否する。
  collapsed caretでのParagraph分割だけは10A-3Aで追加し、それ以外の構造編集は連続原稿面へ案内する。
  翻訳言語、原文fallback、`vertical-rl`も10A-4まで直接編集対象外とし、10A-1の原稿caret移動をfallbackにする。
- Flow schema、DSP／Firestore、Press、Viewer、Horizon publication contractは変更しない。

## Paginated WYSIWYG Paragraph split（10A-3A）

- 原稿言語・`horizontal-tb`・Paragraph内のcollapsed caretでEnterを押した場合だけ、同じSection内で
  現Paragraphを前半と後半の2つへ分割する。先頭／末尾でのEnterも空Paragraphとして保持する。
- 前半は元Block IDと未知fieldを維持し、後半は新しいParagraph IDと原稿言語本文だけを持つ。
  翻訳本文を原文のUTF-16位置で推測分割しない。元Paragraphの翻訳は原文変更によりstale、後半はmissingとなり、
  既存の翻訳freshness／原文fallback契約へ渡す。
- 絵文字ZWJ列や結合文字の途中を分割位置にせず、pure authoring transaction側でもgrapheme境界を再検証する。
- 分割は既存Project Historyへ1 snapshotとして積み、semantic source更新後にautosaveとincremental reflowを即時要求する。
  生成ページ上のcaretは新Paragraph先頭へ移し、再ページ化によるページ数増減に追従する。
- 選択範囲付きEnter、Heading、Shift+Enter、BackspaceによるParagraph結合、複数行paste、ページ跨ぎ選択、
  翻訳ページ、原文fallback、`vertical-rl`はこの単位では変更しない。
- Flow schema、DSP／Firestore、Press、Viewer、Horizon publication contractは変更しない。

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
