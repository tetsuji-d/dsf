# Flow混在作品の固定ページ操作

2026-09-01、安全な第1単位として実装。

## 目的

Project v6でFlow原稿が混在していても、通常の固定テキスト／グラフィックページを
サムネイルから並べ替え、右パネルから削除できるようにする。

## 正本と境界

- 正本は`blocks[]`。`kind:'page'` Block本体をID、graphic layers、未知fieldごと移動する。
- `sections[]`と`pages[]`は操作後の`blocks[]`から再生成する。
- Flow原稿Blockと生成ページは移動・個別削除しない。
- 既存Fixed-only Project v5のDnD経路は変更しない。
- Project v6のタッチDnD／下方向ドラッグ削除は、旧`sections[]`経路を使わない実装へ移すまで無効のまま。
- 見開き画像は、Flowの言語別生成ページ数を含む物理見開き判定を整理するまでUIから移動・削除しない。
- 固定ページは最低1ページ残す。最後の固定ページの削除は無効。

## 実装

`js/fixed-page-spine.js`のpure operationが、移動元・移動先を固定ページとして検証する。
見開きデータを内部で扱う場合は同一groupの2 Blockが完全に連続していることを必須とし、
片側だけの変更や、Flow／構造Blockを挟む壊れたpairを拒否する。

EditorのProject v6 desktop DnDはこのoperationだけを通り、成功時だけ既存Historyへ1件追加し、
派生面更新、Flow runtime無効化、自動保存を行う。no-op／拒否時はHistoryと保存を変更しない。

削除ボタンは実行処理と同じ可否判定を使う。生成Flowページ、表紙／裏表紙、system TOC、
見開き、最後の固定ページでは無効になり、空のUndo履歴を作らない。

## 検証

`npm run verify:fixed-page-spine`で、Flow越しの固定ページ移動、opaque field／layer保持、
Flow不変、見開きの原子的操作と異常pair拒否、最低ページ数、DSP保存往復を検証する。
実ブラウザーでは通常固定サムネイルだけ`draggable=true`、Flow source／生成ページは
`draggable=false`、生成ページの削除ボタンは無効であることを確認する。
