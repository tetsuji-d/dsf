# AGENTS.md — DSF 開発ガイド

このファイルはDSF Studio Pro の開発ルールと状態を記録します。

**開発体制**: Claude (claude-sonnet-4-6) 単体 + 人間（Architect）

> マルチエージェント体制（Claude/Gemini/Codex 分担）は 2026-03-25 に廃止。
> 調整コストが人間の負担になるため、Claude 単体で全ファイルを担当する。

---

## 1. ファイル担当

Claude はスコープ制限なく全ファイルを編集可。

| エリア | ファイル |
|--------|---------|
| エディター | `studio.html`, `js/app.js`, `js/bubbles.js`, `js/shapes.js`, `js/history.js`, `js/layout.js`, `js/sections.js`, `js/blocks.js`, `js/pages.js`, `js/export.js`, `js/theme-presets.js`, `css/studio.css` |
| ビューワー | `viewer.html`, `js/viewer.js`, `css/viewer.css` |
| ポータル | `index.html`, `js/portal.js`, `js/projects.js`, `css/portal.css` |
| 共有インフラ | `js/state.js`, `js/firebase.js`, `js/lang.js`, `css/variables.css` |
| ドキュメント | `docs/` |

---

## 2. データ憲法（参照必須ドキュメント）

| ドキュメント | 内容 |
|-------------|------|
| [docs/data-model.md](docs/data-model.md) | Firestore スキーマ・セキュリティルール |
| [docs/file-format-spec.md](docs/file-format-spec.md) | `.dsp`/`.dsf` ZIP構造仕様 |
| [docs/page-architecture-plan.md](docs/page-architecture-plan.md) | Page v5 スキーマ |

データ形式変更は人間（Architect）と合意してから実装する。

---

## 3. DSF フォーマット方針（2026-03-25 確定）

**Gen 3: WebP 画像のみ**でページを構成する。

| 世代 | 方式 | 状態 |
|------|------|------|
| Gen 1 | Webテキスト組版 + 画像の混在 | 廃止 |
| Gen 2 | WebGL によるフォント・画像統合レンダリング | **廃止**（複雑・重い・端末差） |
| Gen 3 | **WebP 画像のみ** | ✅ 現行方針 |

- すべてのページは WebP 画像として扱う
- テキスト組版はエディタ側でレンダリングして画像化
- ビューワーは WebP 画像の高速表示に専念
- `bodyKind:'text'` / richText 系は廃止方向
- WebGL / Three.js は使用しない

---

## 4. ブランチ運用ルール

### 命名規則

| 種別 | パターン | 例 |
|------|---------|-----|
| 機能追加 | `feature/<説明>` | `feature/webp-viewer` |
| バグ修正 | `fix/<説明>` | `fix/thumbnail-race` |
| リファクタ | `refactor/<説明>` | `refactor/app-split` |
| ドキュメント | `docs/<説明>` | `docs/update-schema` |

### 運用フロー

```
main（常に安定・マージ済みコードのみ）
  └── feature/xxx など → 作業完了 → 人間がレビュー → main にマージ
```

- 新タスクは必ず `main` から切る
- `main` への直接コミットは人間（Architect）のみ
- マージ済みブランチは削除する

### Worktree パス

| フォルダ | 用途 |
|---------|------|
| `C:/Users/tetsu/projects/dsf/` | Architect ワークスペース（常に `main`） |
| `C:/Users/tetsu/projects/dsf-dev/` | 開発ワークスペース（作業ブランチ） |

---

## 5. 開発状態

| 項目 | 状態 |
|------|------|
| main ブランチ | AR fields + blob URL fix + Firebase Staging 構築済み |
| viewer/webgl-phase1 | **破棄予定**（WebGL 廃止に伴い） |
| portal.js firebaseConfig | env 変数化 未対応（要対応） |

---

## 6. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-24 | マルチエージェント体制で開発開始 |
| 2026-02-25 | CSS分割・Firebase Staging・AR fields 等を実装 |
| 2026-03-25 | マルチエージェント廃止 → Claude 単体開発に移行。WebGL 廃止・WebP 統一方針を確定 |
