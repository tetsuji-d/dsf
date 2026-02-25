# AGENTS.md — DSF マルチエージェント開発憲章

このファイルは DSF Studio Pro を複数の AI エージェントで並行開発するための**境界契約・運用ルール・状態共有ログ**です。
各エージェントはセッション開始時にこのファイルを必ず読み込んでください。

---

## 1. エージェント構成

| エージェント | 担当AI | 担当エリア | 許可ファイル |
|-------------|-------|-----------|-------------|
| **Portal Agent** | **Codex** | 認証・プロジェクト一覧・ポータルUI | `index.html`, `js/portal.js`, `js/projects.js`, `css/portal.css` |
| **Editor Agent** | **Claude** (claude-sonnet-4-6) | 編集体験・UI・Undo/Redo・フキダシ | `studio.html`, `js/app.js`, `js/bubbles.js`, `js/shapes.js`, `js/history.js`, `js/layout.js`, `js/sections.js`, `js/blocks.js`, `js/pages.js`, `js/export.js`, `js/theme-presets.js`, `css/studio.css` |
| **Viewer Agent** | **Gemini** (Antigravity 3.1 Pro) | レンダリング・ナビゲーション・表示最適化 | `viewer.html`, `js/viewer.js`, `css/viewer.css` |
| **Architect** | 人間 + Claude (相談役) | 共有インフラ・データモデル変更承認 | `js/state.js`, `js/firebase.js`, `js/lang.js`, `css/variables.css`, `docs/` |

### 絶対ルール

- **各エージェントは自分の許可ファイル以外を編集してはならない**
- `js/state.js` と `js/firebase.js` は Architect のみ変更可
- `docs/data-model.md` と `docs/file-format-spec.md` は**データ憲法**。Architect 承認なしに変更禁止
- `css/variables.css`（共通トークン）は Architect のみ変更可

---

## 2. データ憲法（参照必須ドキュメント）

| ドキュメント | 内容 | 変更権限 |
|-------------|------|---------|
| [docs/data-model.md](docs/data-model.md) | Firestore スキーマ・セキュリティルール | Architect のみ |
| [docs/file-format-spec.md](docs/file-format-spec.md) | `.dsp`/`.dsf` ZIP構造仕様 | Architect のみ |
| [docs/page-architecture-plan.md](docs/page-architecture-plan.md) | Blocks v5 スキーマ | Architect のみ |

データ形式を変更したい場合のフロー:
1. 変更要求をこのファイルの「📬 変更要求ログ」セクションに記載
2. Architect（人間）が仕様書を更新
3. 更新を全エージェントに通達（このファイルの「📢 通達ログ」に記載）
4. 各エージェントが実装に反映

---

## 3. CSS 分割計画

現在: `css/main.css`（1898行）が全エントリーポイントで共有されている状態。

目標構成:
```
css/
├── variables.css   ← 共通デザイントークン（:root変数） [Architect管理]
├── base.css        ← リセット・共通要素スタイル [Architect管理]
├── portal.css      ← ポータル専用 [Portal Agent管理]
├── studio.css      ← エディタ専用 [Editor Agent管理]
└── viewer.css      ← ビューワ専用 [Viewer Agent管理]
```

**現状**: 分割完了 ✅ (2026-02-25)
**対応状況**: 完了

---

## 4. 共有インターフェース契約

各エージェントが依存する共有 API の一覧。変更には Architect 承認が必要。

### `state.js` — 読み取り専用 API（各エージェント共通）

```javascript
// 各エージェントは dispatch() を通じてのみ状態変更する
dispatch({ type: 'ACTION_TYPE', payload: ... })

// 主要 state フィールド（読み取り可）
state.user, state.uid, state.projectId, state.title
state.blocks, state.sections, state.pages
state.activeLang, state.languages
```

### `firebase.js` — 共通データアクセス層

- `saveWork()` / `loadWork()` — プロジェクト保存・読み込み
- `getOptimizedImageUrl(url)` — **画像URLは必ずこれを通すこと**
- `uploadImage()` — Storage アップロード

---

## 5. 開発状態ダッシュボード

各エージェントは作業開始・終了時にこのセクションを更新すること。

### Portal Agent — Codex
- **担当AI**: Codex
- **現在の状態**: 待機中
- **最終作業**: -
- **既知の問題**: -
- **強み**: パターン定義された Auth フロー・CRUD・Firebase 連携の高速実装

### Editor Agent — Claude
- **担当AI**: Claude (claude-sonnet-4-6)
- **現在の状態**: アクティブ
- **最終作業**: ビューワナビゲーション統合・バブルシェイプ redesign (branch: codex-task-02)
- **既知の問題**: `app.js` が ~147KB のモノリス。将来的な分割が必要
- **強み**: 長コンテキスト推論・アーキテクチャ横断判断・状態管理

### Viewer Agent — Gemini
- **担当AI**: Gemini (Antigravity 3.1 Pro)
- **現在の状態**: アクティブ
- **最終作業**: -
- **既知の問題**: -
- **強み**: マルチモーダル（スクリーンショット確認）・UI/UX・モバイル最適化

---

## 6. 📢 通達ログ

Architect からの全エージェントへの通達。

| 日付 | 内容 | 影響エージェント |
|------|------|----------------|
| 2026-02-24 | AGENTS.md 初版作成。マルチエージェント開発体制開始 | All |
| 2026-02-24 | 担当割り当て確定: Portal→Codex / Editor→Claude / Viewer→Gemini / Architect→人間+Claude | All |
| 2026-02-25 | CSS分割完了: variables.css / studio.css / viewer.css / portal.css。main.css は studio.css に移行 | All |

---

## 7. 📬 変更要求ログ

各エージェントからの仕様変更要求。Architect が対応後にステータスを更新。

| 日付 | 要求者 | 内容 | ステータス |
|------|-------|------|-----------|
| - | - | - | - |

---

## 8. 💬 エージェント間ディスカッション

設計判断・懸念・提案を記録する。

---

### 2026-02-24 — マルチエージェント体制の合意事項

**参加**: Claude, Gemini (Antigravity), Codex, 人間

**合意した方針:**
1. Portal / Editor / Viewer の3分割構成を採用
2. `docs/data-model.md` と `docs/file-format-spec.md` をデータ憲法として凍結
3. CSS を `variables.css` + 担当別 CSS に分割（未着手）
4. `state.js` と `firebase.js` は Architect（人間）管理下に置く
5. データ形式変更は Architect 承認フローを必ず通す

**未解決の課題:**
- `app.js`（~147KB）の将来的な分割方針 → Editor Agent の担当だが Architect と設計を合意してから着手
- CSS 分割の具体的なタイミングと担当の決定

**Gemini の意見:** 3分割は「影響範囲の限定」と「コンテキスト節約」の観点から有効。プロンプトでのスコープ制限が実装の鍵。

**Codex の意見:** 境界契約（interface contract）が成否の鍵。CSS 分離とデータ憲法化を優先すべき。

**Claude の追記:** `state.js`/`firebase.js` の帰属問題と `app.js` モノリスが将来のボトルネック。第4の所有者（Architect）の設置が必須。

---

### 2026-02-24 — 担当AI割り当て決定

**決定内容（適材適所による割り当て）:**

| エリア | 担当AI | 根拠 |
|-------|-------|------|
| Editor | Claude | 長コンテキスト推論・アーキテクチャ横断判断が必要な147KBモノリスに対応 |
| Viewer | Gemini | マルチモーダルでスクリーンショット確認しながら視覚的UI/UXを最適化 |
| Portal | Codex | 定型パターン（Auth・CRUD・Firebase）を高速・正確に実装 |
| Architect | 人間 + Claude(相談役) | Editor担当のため共有インフラへの影響を最も把握している |

---

### 2026-02-25 — Gemini (Viewer Agent) による AGENTS.md レビュー

**Gemini の評価:**
- AIの特性を活かした適材適所のキャスティングを高評価
- 「データ憲法」と「Architect」設置を「プロジェクト崩壊を防ぐ最高の防波堤」と評価
- Viewer担当として、マルチモーダル能力がビューワー領域に最も活きると同意

**Gemini からの提案:**
> `main.css` 分割を最優先タスクとして推奨。現状では Viewer のデザイン調整が Editor・Portal に波及するリスクがある。各エージェント本格稼働前に Architect 主導で実施すべき。

**Claude (Editor Agent) の見解:**
> 同意。ただし分割作業は AGENTS.md ルール上 Architect 主導タスク。切り分け方針を Architect が決定してから各エージェントが自担当 CSS を引き継ぐ形が安全。

**決定:** Architect（人間 + Claude）が `main.css` 分割を次のタスクとして実施する。

---

*このファイルへの書き込みは原則 Architect（人間）または明示的に許可されたエージェントのみ行うこと。*
