# Viewer Info Panel Spec

## Goal

Viewer の読書面を壊さずに、作品メタデータを段階的に閲覧できる情報パネルを追加する。

- モバイル: 下からせり上がるハーフモーダル
- PC: 右ドロワー
- 状態モデルは共通化する

## Shared State Model

情報パネルは 4 状態を持つ。

| State | Meaning |
| --- | --- |
| `closed` | 非表示 |
| `peek` | ハンドルと最小情報のみ表示 |
| `summary` | タイトル、レーベル、シリーズ、著者、概要の要約を表示 |
| `full` | ライナーノーツ、レビューなど詳細を含む全表示 |

## State Transitions

### Manual

- info ボタン:
  - `closed -> summary`
  - `peek -> summary`
  - `summary -> closed`
  - `full -> closed`
- パネル内の展開操作:
  - `peek -> summary`
  - `summary -> full`
  - `full -> summary`
- パネル内の縮小操作:
  - `full -> summary`
  - `summary -> peek`
  - `peek -> closed`

### Navigation / Context

- ページ送り:
  - `full -> summary`
  - `summary -> summary`
  - `peek -> peek`
  - `closed -> closed`
- 内部リンク遷移:
  - 遷移後は `summary`
- 外部リンク:
  - 新規タブで開く
  - パネル状態は維持

## Layout by Device

### Mobile / Narrow View (`< 1024px`)

- Bottom sheet
- ヘッダーとフッターは表示可能なまま共存
- 高さの目安:
  - `peek`: 72px
  - `summary`: 220px 前後
  - `full`: `min(76vh, viewport - header - footer - safeArea)`
- 上端にドラッグハンドルを置く
- 1 列表示

### Desktop / Wide View (`>= 1024px`)

- Right drawer
- 左ドロワーは将来の目次用に空ける
- 幅の目安:
  - `peek`: 72px
  - `summary`: 360px
  - `full`: 420px
- 上下は Viewer header / footer を避ける
- 本文は縦スクロール

## Wire Summary

### Common Content Order

1. タイトル
2. レーベル
3. シリーズ
4. 著者
5. 概要
6. ライナーノーツ
7. レビュー

### Minimal Initial Implementation

初期実装では既存データモデルに合わせて以下を優先する。

- タイトル
- レーベル (`labelName`)
- 著者 (`meta.{lang}.author`)
- 概要 (`meta.{lang}.description`)
- ライナーノーツ (`meta.{lang}.linerNotes`)

シリーズとレビューは予約領域とし、値がない場合は非表示または準備中表示にする。

## Links in Liner Notes

- 外部リンク: `{{テキスト|https://...}}`
  - `target="_blank"`, `rel="noreferrer noopener"`
- 内部リンク:
  - 将来はレーベル内作品遷移に使う
  - 初期実装では `http/https` 以外は予約扱い

## Notes for Further Work

- ナビゲーション表示と情報パネルの同時表示時は、スライダー・ページ送りボタン・`Powered by DSF` の位置を再調整する
- 左ドロワーの目次機能を追加する場合も、状態モデル自体は変えない
