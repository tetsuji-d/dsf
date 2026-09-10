# 画像・図形・テキストボックス統合 — 実装前の保存契約案

状態: UIおよび保存仕様はユーザー承認済み（2026-09-10）。ローカル実装・検証完了。commit・migration・deployは未実施。
作業場所: dsf-dev / feature/flow-layout-foundation

## 今回の完成範囲

Fixedページで複数の配置画像・基本図形・テキストボックスを扱う。右パネルを使わず選択対象に応じた常時表示リボンに統合する。画像・テキスト・図形を重なり一覧で選択、名前変更、並べ替え、表示切替、ロックできる。背景は固定の最下層。Undo/Redo、保存・再読込、DSP同梱、PressでのWebP合成までを一つの完成条件とする。

Flow本文・生成ページは対象にしない。既存のFlow途中への画像ページ挿入を維持する。複数選択・グループ化は次単位。

## 現状から再利用する箇所

- blocks.js: state.blocksを正本とし、Fixed Sectionとの同期時に拡張フィールドを保持する経路。
- project-assets.js / project-asset-panel.js: 画像ライブラリ、WebP化、長辺7680px上限、ファイル検証。
- project-persistence.js: Projectの正規化と保存・読込。
- app.js / bubbles.js / shapes.js: 既存吹き出し、文字・形状、ページ選択、履歴。
- studio-flow-ribbon.js: 元の操作を維持するリボンadapter。
- press.js: 背景画像を含むFixedページのWebP合成。

## 承認を求める編集データの追加

Fixed Blockのcontentに任意の `graphicObjects` と `objectOrder` を追加する。

`graphicObjects`: 新規オブジェクトの配列。各要素は次を持つ。
- id: ページ内で一意な安定ID。
- kind: image / shape / text。
- name: 重なり一覧の表示名。
- visible: falseならキャンバス・サムネイル・発行結果のすべてで非表示。
- locked: 編集操作のみ禁止。発行時の表示には影響しない。
- frame: 正規360×640ページ上のx/y/width/height、rotation。表示倍率から独立。
- 画像: assetIdで既存projectAssetsを参照。画像全体のopacity、flipX/flipY、正規化されたcrop矩形。
- 図形: rect / roundRect / ellipse / line / arrow / speech。塗り色と塗りopacity、枠線色と枠線opacity、線幅。
- 文字: textsの言語別本文と文字書式。必要に応じ言語別frameを保持。塗りのopacityで本文を薄くしない。
- 面のある図形は文字を持てる。線・矢印に本文は持たせない。

`objectOrder`: 背面から前面の安定ID参照列。背景は含めない。既存吹き出しと新規オブジェクトを同じ順序で扱う。
既存吹き出しには、対象ページを初めて重なり編集するときだけIDを付与する。旧bubbles本文・座標・形状は元の場所に保持する。未編集ページを一括変換しない。

欠落時は旧描画・旧重なり順をそのまま使用する。新機能を使ったProjectは旧エディターでの完全再編集を保証しない。新エディターでは旧Project/DSPの読込を継続する。

公開DSFにgraphicObjectsを渡さない。ページをWebPに合成して既存delivery v1/v2の経路を使用する。公開Releaseの既存snapshotは変更しない。Firestoreのcollection/Rules変更、production migrationは行わない。

## 実装単位

1. モデル・検証・永続化。有限座標、サイズ、色、ID、asset参照、crop範囲を検証。旧データの読込と無編集roundtripを確認。
2. 共通描画とリボン。図形アイコンギャラリー、パレット、透明度、文字、配置画像、ドラッグ・拡縮・回転・切り抜き。選択ハンドルとガイドは編集時のみ。
3. 重なり一覧と履歴。キャンバス選択との同期、安定IDによる並べ替え、表示・ロック、名前変更、削除、Undo/Redo。
4. アセットとDSP。配置・差し替えはサムネイルではなく元のWebPを利用。assetIdも使用中判定に含める。DSP export/importで実体と参照を検証。保存時にblob URLだけが残らないことを確認。
5. 発行と回帰。Fixedページの合成にオブジェクトを含める。表示と発行で同じ座標・書式を利用し、重なり・透明度・crop・文字を比較。Flow fixedTextは維持する。

## 変更対象の見込み

新規: graphic-object-model.js、graphic-object-renderer.js、studio-object-toolbar.js、対応CSS、pure検証とブラウザー検証。
既存: blocks.js、project-persistence.js、project-assets.js、project-asset-panel.js、app.js、bubbles.js、studio-flow-ribbon.js、press.js、DSP画像同梱を担当する実際のexport/import経路。
保存契約確定後に docs/file-format-spec.md へ仕様を記載する。CLAUDE.md、AGENTS.md、flow-remaining-implementation-plan.mdは変更しない。

## 検証の合格条件

- 保存・再読込・DSP再読込でID、重なり、元画像、crop、文字書式が一致。
- 旧Fixed/吹き出しの見た目とFlow原稿・翻訳・fixedTextの挙動を維持。
- 透明な塗りと文字色は独立。ロック・非表示の意味がUIと発行で一致。
- 新規追加、ドラッグ、並べ替え、色変更、削除を実操作し、Undo/Redoで復元。
- Press出力でオブジェクトが欠落しない。外部URLや任意HTMLを新規入力から描画へ直接渡さない。
- コミットとstaging deployは個別のユーザー指示後に実施。


## ローカル実装・検証記録（2026-09-10）

新規モジュールは graphic-object-model / graphic-object-renderer / studio-object-toolbar。旧テキスト追加導線も新しいテキストボックスへ接続した。既存吹き出しは従来データを維持し、書式・本文操作をリボンから行える。配置画像の切り抜きは元画像内の範囲を百分率で指定する。複数選択・グループ化は今回の対象外。

確認済み:
- `verify-graphic-objects.js`: 保存・言語別frame・旧形式の無変換読込・asset参照・不正値拒否。
- `verify-graphic-objects-browser.cjs`: 実際の追加、文字編集、色、透明度、移動、複製、削除、Undo/Redo、表示・ロック・並べ替え、元WebP、crop/flip、実DSPダウンロード再読込、Press出力画素、旧吹き出し混在、モバイル操作。
- `verify-project-persistence.js`, `verify-project-assets.js`, `verify-fixed-text-delivery-projection.js`。
- `verify-studio-ribbon-browser.cjs`, `verify-studio-ribbon-followups-browser.cjs`: Flow/翻訳/注釈/旧画像操作の回帰。
- `npm run build:staging`, `git diff --check`。

保存検証に残っていた旧Flow Sourceサムネイルの存在要求は、現行の「生成ページから原稿を開く」仕様に合わせて修正した。Firestore Rules・本番環境の変更、リモート保存・公開操作は行っていない。
