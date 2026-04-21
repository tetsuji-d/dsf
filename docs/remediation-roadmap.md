# DSF Remediation Roadmap

## Purpose

出荷速度を落とさずに、Gen3 の実装原則へ段階的に寄せるための中期リファクタ計画。
この文書は「今すぐ壊す」のではなく、「どの順番なら壊さず減債できるか」を固定するためのもの。

前提:

- 公開境界の正本は `Press -> draft` / `Works -> public`
- authoring canonical は `state.blocks`
- Viewer の共有 URL は `dsfPages` を消費する

## Phase 1: Post-launch stabilization

対象期間: リリース直後 2-4 週間

目的:

- 既存フローを壊さず、変更の発火点を減らす
- publish / viewer / text layout の事故率を下げる

主要タスク:

1. `app.js` の room 境界を明文化する
   - 対象: `js/app.js`, `studio.html`
   - `Home`, `Editor`, `Press`, `Works` の初期化責務を関数単位で分ける
   - グローバル `window.*` の棚卸しを行う

2. 保存用 snapshot を pure に近づける
   - 対象: `js/firebase.js`, `js/state.js`, `js/blocks.js`, `js/pages.js`
   - autosave 時に「どの state を正本として保存したか」を追えるようにする

3. テキスト組版の変更点を 1 箇所に寄せる
   - 対象: `js/text-press-html.js`, `js/press.js`, `js/app.js`
   - composition と rasterization の責務境界を維持する

4. 画像アセットの 3 層分離を進める
   - 対象: `js/firebase.js`, `js/press.js`, `docs/file-format-spec.md`
   - authoring asset / thumbnail / published DSF を分けて考える
   - 当面はバランス案として、editor 保存用画像を「中品質マスター」、thumbnail を「軽量派生」にする
   - 目安: authoring asset は長辺 1920-2560 / quality 0.88-0.92、thumbnail は小サイズ維持

Exit criteria:

- publish バグ修正が `firebase.js` / `works.js` / `viewer.js` にまたがらない
- 文字組み修正が preview / spread / press で別々に実装されない
- Press の再レンダリングで、編集用背景が先に潰れすぎて品質上限を決めてしまわない

## Phase 2: Runtime decoupling

対象期間: 1-3 か月

目的:

- `app.js` monolith を room-oriented controller へ分割する
- state mutation の規律を導入する

主要タスク:

1. Room controller の分離
   - 候補:
     - `js/studio-home.js`
     - `js/studio-editor.js`
     - `js/studio-press.js`
     - `js/studio-works.js`
   - `app.js` は shell / routing / shared orchestration に縮小する

2. DOM inline handler の削減
   - 対象: `studio.html`, `js/app.js`, `js/works.js`, `js/sections.js`
   - `onclick` を段階的に `addEventListener` へ置換する

3. state mutation rule の導入
   - `dispatch` で扱う変更
   - 許容する直接 mutation
   - save 前 normalize
   - undo 対象 / 非対象

Exit criteria:

- `app.js` が room ごとの実装詳細を抱えすぎない
- 新規 UI 操作が `window.*` を追加せずに実装できる

## Phase 3: Model retirement

対象期間: 3-6 か月

目的:

- `sections` / `pages` の互換層を縮小する
- viewer を shared schema consumer に寄せる

主要タスク:

1. `sections` write-path の縮小
   - editor 変更が `blocks` を先に更新する経路へ寄せる
   - `sections` は adapter / cache として限定する

2. viewer の shared model 化
   - 対象: `js/viewer.js`, `js/pages.js`
   - viewer 独自 normalize を減らし、共有の page/book 解釈を使う

3. edge function 共通モジュール化
   - 対象: `functions/upload.js`, `functions/asset-proxy.js`
   - Firebase token verify と CORS policy を共通化する

4. asset tier policy の導入
   - 無料/標準/高品質プランで authoring asset 上限を分けられるようにする
   - 課金前提が決まるまでは固定の「バランス案」を運用し、実測コストを取る

Exit criteria:

- `blocks` 以外を正本として扱う新規コードが増えない
- viewer が第二の schema 実装者にならない

## Guardrails

- 出荷フローに触る変更は `Press`, `Works`, `viewer`, `firestore.rules` をまとめて確認する
- ドキュメント更新を伴わないアーキテクチャ変更は行わない
- 「互換のために残す」と「将来消す」は必ず分けて書く

## Current source of truth

- `CLAUDE.md`
- `docs/data-model.md`
- `docs/file-format-spec.md`
- `docs/pressroom-spec.md`
