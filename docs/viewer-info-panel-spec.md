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
- 閉じた状態からは、ページ下端の上スワイプで開く
- シートは画面全幅、下端密着
- 角丸は上端のみ残し、下端は角丸なし
- ヘッダーとフッターは表示可能なまま共存
- シート表示中はフッターナビゲーションを下へ退避させ、シートの下に隠す
- 高さの目安:
  - `peek`: 72px
  - `summary`: 220px 前後
  - `full`: `min(76vh, viewport - header - footer - safeArea)`
- 上端にドラッグハンドルを置く
- シート全体をドラッグ対象にする
- ドラッグ中は無段階で追従し、指を離した時に `peek / summary / full / closed` にスナップする
- `full` で本文領域から操作した場合は、本文スクロールを優先し、本文が先頭まで戻った状態で下方向へ引いた時だけシートを縮小する
- 1 列表示

### Desktop / Wide View (`>= 1024px`)

- Right drawer
- 左ドロワーは将来の目次用に空ける
- 状態は `closed / full` のみ
- info ボタンを押したら常に `full` で開く
- ドロワーはページの上に重ねず、読書面と同じレイヤーで右側に並ぶ
- 表示時は読書面の利用幅を縮め、ページを左へ押し出す
- 右端は画面端に密着させる
- 高さは 100%
- 左上 / 左下のみ角丸、右側は角丸なし
- info ボタン押下で右側からせり出すように表示する
- 幅の目安:
  - `full`: 420px
- 本文は縦スクロール
- 段階表示用のハンドルと展開/縮小ボタンは表示しない

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
