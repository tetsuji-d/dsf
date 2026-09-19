# Flow回り込み：実エディター・保存・発行の接続仕様

状態：保存・発行仕様はArchitect承認済み。実エディター・DSP・固定テキスト発行・Horizon転送計画を接続。未デプロイ。

## 1. 保存する情報

Project v6 / DSP meta schema v2 / FlowDocument v1～v4を維持する。
本機能を使ったFlow Groupだけ `flow.layout.schemaVersion: 2` とし、
`flow.layout.anchoredObjects` を追加する。既存グループはv1のまま。
FlowDocumentへ生成ページやgraphic用Fixed Blockは入れない。

各エントリは次を持つ。

- `id`: グループ内で一意の配置ID。
- `anchorBlockId`: 同じFlowDocument内の段落ID。未解決の参照も保存では保持する。
- `graphic`: 既存graphic-object-modelのimage/shapeオブジェクト。textは初期対象外。
- `wrap`: `square` または `band`。
- `gapEm`: 本文との間隔（0～4字分）。言語別fontSizeで解決する。

`graphic.frame` / `graphic.frames[language]` のx,yは、Flowでは本文領域左上からの論理座標とする。
描画直前にページ余白分を加算し、既存graphic rendererへ渡す。
画像の `assetId`, crop, flipX/flipY, opacity、図形の形状・色・線と四隅の編集は既存モデルを再利用する。
元WebPは既存projectAssetsに一度だけ保存する。サムネイルは配信用・本文用assetに流用しない。

例（graphicの共通styleなどは省略）：

```json
{
  "schemaVersion": 2,
  "pagePreset": "dsf-canonical",
  "padding": {"top": 24, "right": 24, "bottom": 24, "left": 24},
  "typographyByLanguage": {"ja": {"writingMode": "vertical-rl"}},
  "anchoredObjects": [{
    "id": "placement-a",
    "anchorBlockId": "paragraph-a",
    "wrap": "square",
    "gapEm": 0.5,
    "graphic": {
      "id": "graphic-a",
      "kind": "image",
      "assetId": "asset-a",
      "frame": {"x": 180, "y": 32, "width": 132, "height": 176, "rotation": 0}
    }
  }]
}
```

Projectのversion、Firestoreコレクション、Rulesは変更しない。
既存のowner-only `authoring/current` とDSPに保存し、public rootへは出さない。
旧クライアントは未対応FlowLayout v2を拒否して、画像を落として上書きしない。
新クライアントはv1/v2を両方受理する。全objectを削除してもv1へ暗黙降格しない。

## 2. 段落操作

- 分割：元IDを残す前半が画像を保持。画像は自動複製しない。
- 結合：削除される段落の参照を結合先へ付け替える。複数objectが同じ段落へ集まった場合は配置要確認として保持。
- 削除：objectを消さず、未解決anchorとして保持。編集画面から再指定・削除できる。
- 文字を空にする：空段落とobjectを保持。
- Flow Group分割：対象段落とobjectを同じグループへ移す。未解決anchorは元グループに残す。
- Flow Group接続：配列をID衝突検査付きで併合。本文の組版差分と配置配列の差分を混同しない。
- Undo/Redo：本文・参照・配置を同一の既存History transactionで処理する。
- 原文変更：画像の配置変更だけではtranslationStateをstale化しない。

初期版は1物理ページ1object。異なる段落のobjectが同じページに到達した場合は後方の段落/objectを次ページへ送る。
同じ段落に複数objectがある場合は保存を保ち、再指定されるまで発行を停止する。

## 3. 組版・編集

既存iterator・DOM measurerを再利用する。runtime fragmentには文字範囲とregion配置を持たせるが保存しない。
ルビ・圏点は既存注釈DOMとsemantic annotationを再利用し、画像の排除領域との衝突を検査する。
領域で分割されても本文・読み・圏点の全範囲が一度だけ描画されることを検証する。
初期検証の1字安全余白は試験用。実接続では注釈の実測境界に基づく余白を使い、
画像のないページの既存組版が不要に変化しないことを回帰条件にする。

runtimeの更新はobject配置・言語・書体・注釈変更でも無効化する。
回り込みのあるグループはまず全体再組版とし、誤った旧checkpointの再利用を避ける。
大量ページの増分最適化は正しさの確認後に行う。

UIは承認された試作を既存ツールバーへ統合する。
画像選択時にアンカーを表示し、図形は形状アイコンで選択する。
画像・図形の移動でanchorは変えず、明示的な再指定操作にする。
通常/分割、原文/翻訳、原稿モードの既存操作を維持する。
入力中・IME中にobject操作が本文の選択・Undoを奪わないようにする。

## 4. 発行契約

DSF delivery v2の既存 `fixedText.background.imageHref` を使用する。
本文・読み・圏点は固定テキストのまま。画像と図形だけをページサイズの背景WebPへ合成する。
Viewerは再組版しない。公開DSFにFlowDocument、anchor ID、graphic authoring payloadは渡さない。

既存Viewer、Horizon loader、portable loaderにはbackground.imageHrefの参照経路がある。
一方、`dsf-release-assembly.js` と `dsf-release-file-inventory.js` は現状image pageへの結び付きだけを認める。
以下を追加する必要がある。

- Releaseの内部asset planに `purpose: 'fixedTextBackground'` を導入。
  既存planのpurpose省略は従来の画像ページを意味し、旧形式の検証は維持する。
- 言語、Flow Group ID、物理ページindex、背景hrefを一対一で照合。
- 本文projectionと同じrevisionで生成した背景WebPだけをsealして受け付ける。
- hash、byteLength、MIME、WebP実寸を既存のsealer/inventoryで検証する。
- 背景は `assets/images/language-0001/page-00001.webp` とし、同じ物理ページが画像ページと背景を同時に持つことは許可しない。
- 背景を独立ページとして数えない。fixedTextページ数、WebPページ数、背景ファイル数を区別する。
- 背景欠落、別ページへの差し替え、余計なasset、入力更新、hash不一致は発行を止める。
- 既存portable ZIP、Horizon immutable upload、所有者previewへ同じverified assemblyを渡す。

配信JSONは既存v2の表現を使い、公開Firestore/Rulesのschema変更は行わない。
内部asset planの拡張は、実装時にcanonical serialization・strict key検査・各consumerを一緒に更新する。
既存v1/v2 Releaseを移行・再公開しない。

## 5. 実装と合格条件

1. FlowLayout v2 validator、graphic/asset参照、DSPとowner-only保存の往復。
2. 原稿の分割・結合・削除・Undo・翻訳での参照維持。
3. 実エディターの挿入・移動・拡縮・再指定・解除、両言語と原稿モード。
4. 認定fontのcapture、固定テキスト＋背景のassembly/inventory、改ざん拒否。
5. 実DSF ZIPの再展開とViewer表示、元WebP・文字・注釈の照合。
6. 既存Fixed、Flow注釈、画像なしFlow、v1/v2公開/限定公開経路の回帰。

この段階ではcommit、deploy、Rules変更、既存Releaseの更新を行わない。

## 5. 実装と検証

- `flow-object-toolbar-adapter.js` が既存 `studio-object-toolbar.js` の画像・図形操作をFlowに接続する。アセットからの配置、WebPアップロード、形状アイコン、色・透明度、トリミング、拡縮・回転を再利用する。
- Flowでは本文段落を選んで配置する。段落未選択なら選択ページの最初の本文段落を使う。画像・図形一覧から対象を選び、アンカーアイコンで段落を変更できる。紐づけ先が消えた画像も一覧に残る。
- 初期版は1ページ1オブジェクト、1段落1オブジェクト。複数のアンカー段落は必要に応じて別ページになる。Flowの重なり順・複製・Fixedとのオブジェクト切り貼りは初期対象外。Fixed側の操作は継続する。
- 四角形回り込みでオブジェクトが中央にある場合、同じ高さ／列帯では広い側を使う。両側へ同時に文字を流す組版は対象外。画像の前後の領域では本文幅へ戻る。
- 扉領域の段落に画像を回り込ませることは初期対象外。本文領域からはみ出す配置は拒否する。既存データの未解決アンカーや結合後の競合は保存したまま、発行を止めて修復する。
- `flow-wrap-composition.js` は既存iterator・DOM計測を使う。オブジェクト・領域・実測snapshotの一致を検証し、本文や注釈が背景に重なる場合も発行を拒否する。
- Horizonは `fixedTextBackground` の明示された封印済みassetだけを許可する。ファイル数とページ数を分離し、`fixedText` のページ数を維持する。Firestore collection/Rules、既存公開権限は変更しない。

検証コマンド:

```text
node scripts/verify-flow-anchored-objects.js
node scripts/verify-flow-wrap-integration-browser.cjs
node scripts/verify-flow-wrap-editor-browser.cjs
```

ブラウザ検証はローカルViteと独立Chromeを利用する。`DSF_PLAYWRIGHT_MODULE` にPlaywrightのローカルパスを設定する。
統合検証は日本語縦書き（ルビ・圏点を含む）／英語横書き、square／band、2段落の画像・図形を対象に、文字の衝突、認定発行、背景ファイルの不正・欠落、Horizonのread-only handoff、実DSPアーカイブ往復を確認する。
外部のHorizonアップロード・公開操作はテストから実行しない。
