# Flow画像の複数配置とキャプション

2026-09-11。ユーザー承認済みの上下左右配置仕様を実装。ローカル検証対象。commit/deployは別指示。

## 保存

新しいオブジェクト操作を行ったFlow GroupだけFlowLayout v3へ移行する。v1/v2を読み込み、保存時の一括変換・自動降格はしない。
Project v6、FlowDocument、Firestore collection/Rulesは変更しない。独立したFlowテキストボックスは追加しない。

既存`anchoredObjects[].graphic`のimageに任意の`caption`を持つ。

- `position`: top/bottom（横書き）、left/right（縦書き）。
- `texts`: 言語キー別の文字列。手動改行はLF。
- `fontSize`: 6–48論理px。画像の拡縮では変えない。
- `gap`: 画像との間隔、0–48論理px。
- `color`: #rrggbb。
- `align`: left/center/right。縦書きでは先頭/中央/末尾に相当。

言語未設定の場合は原稿言語へfallbackして描画・計測を一致させる。caption自体は画像と一緒に保存・複製する。
元WebPはprojectAssetsの同一assetIdを参照し、複製や貼り付けで再圧縮しない。
生成された描画用members/objectsや回り込み領域はruntimeだけの情報で保存しない。

## 編集

画像ダブルクリック、右クリック「キャプションを追加・編集」、またはツールバーのキャプションアイコンでキャンバス内に入力欄を開く。
Enterで改行、Ctrl/Command+Enterまたはフォーカスを外して確定、Escで取消。IME変換中のEnterは確定操作にしない。
上下左右のアイコンに日本語/英語tooltipを付ける。文字サイズ、間隔、色、揃え、キャプション削除を画像選択時に操作する。
画像枠の移動・拡縮・回転にキャプションが追従する。上下では画像幅、左右では画像高で自動折り返す。
本文領域からはみ出す設定は拒否し、入力中の文章は修正できるよう保持する。

複製は同じ段落のまま12pxずらし、配置IDとgraphic IDを新規作成する。
コピーと貼り付けは同一プロジェクト内で対応する。Flowへの貼り付けは選択段落に紐づく。
Ctrl/Command+C/V/Dと右クリックから操作する。入力欄・本文選択は文字操作を優先する。
Flowの切り取りは今回の対象外。Fixedの既存切り取り動作を維持する。

## 組版と発行

同じ段落に複数画像・図形を許可する。別段落の画像も双方の段落開始が収まる場合は同じ物理ページに置く。
初期実装は複数配置を囲む矩形全体を除外する。画像同士の狭い隙間へ本文を流す精密な複数輪郭回り込みは行わない。
収まらない場合は後続のアンカー段落から次ページへ送る。同じ段落の一群を別ページへ分解しない。
扉段落への配置は従来通り対象外。紐づけ先を失った画像は保持し、発行前に修復が必要。

画像とキャプションは既存背景WebPへ一体で描画する。Flow本文・ルビ・圏点はfixedTextを維持する。
Viewerではキャプションの文字選択・コピーはできない。DSPには言語別テキストのまま保持する。
背景のhash・byteLength・revision・ページ対応は既存sealed asset検証を通す。公開DSFにauthoring情報は出さない。

## 検証

- `node scripts/verify-image-caption.js`: 4配置、手動改行、拡縮、fallback、不正設定。
- `node scripts/verify-flow-anchored-objects.js`: 保存版、段落編集、紐づけ維持。
- `DSF_TEST_CAPTIONS=1 node scripts/verify-flow-wrap-integration-browser.cjs`: 16組版ケース、同一/別段落の複数配置、本文・注釈衝突、DSP往復、fixedText背景発行、Horizonの読み取り専用handoff。
- `DSF_TEST_CAPTIONS=1 node scripts/verify-flow-wrap-editor-browser.cjs`: 入力・縦キャプション・複製/Undo・Ctrl+C/V・元アセット共有・Viewerプレビュー。

ブラウザ検証は独立したテスト状態を使用し、ユーザーのプロジェクトや公開状態を変更しない。
