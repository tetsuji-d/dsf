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

### AGENTS.md への書き込み権限

| セクション | 書き込み可能者 |
|-----------|--------------|
| 1〜4（構成・憲法・CSS計画・API契約） | Architect のみ |
| **5（ダッシュボード）** | **各エージェントが自分の欄のみ更新可** |
| 6（通達ログ） | Architect のみ |
| **7（変更要求ログ）** | **各エージェントが行追加可**（ステータス更新は Architect のみ） |
| **8（ディスカッション）** | **各エージェントが追記可** |

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

実装済み構成:
```
css/
├── variables.css   ← 共通デザイントークン（:root変数） [Architect管理]
├── portal.css      ← ポータル専用 [Portal Agent管理]
├── studio.css      ← エディタ専用 [Editor Agent管理]
└── viewer.css      ← ビューワ専用 [Viewer Agent管理]
```

> **`base.css` について**: 当初計画に含まれていたが、実装時に不要と判断。
> viewer.html・index.html がそれぞれ完全なスタイルを持っていたため、
> 共有要素（`.btn-sm` 等）は各 CSS に直接定義した。将来的な共通化は Architect が判断する。

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
- **現在の状態**: アクティブ
- **最終作業**: `js/portal.js` の Firebase 設定を `VITE_FIREBASE_*` env 変数参照へ切替（hardcoded config 除去）
- **既知の問題**: Firebase Staging の Console 手作業（Firestore/Hosting 最終確認）が進行中
- **強み**: パターン定義された Auth フロー・CRUD・Firebase 連携の高速実装

### Editor Agent — Claude
- **担当AI**: Claude (claude-sonnet-4-6)
- **現在の状態**: アクティブ
- **最終作業**: ビューワナビゲーション統合・バブルシェイプ redesign (branch: codex-task-02)
- **既知の問題**: `app.js` が ~147KB のモノリス。将来的な分割が必要
- **強み**: 長コンテキスト推論・アーキテクチャ横断判断・状態管理

### Viewer Agent — Gemini
- **担当AI**: Gemini (Antigravity 3.1 Pro)
- **現在の状態**: 待機中
- **最終作業**: Phase 4: UI Architecture Modernization 完了 (branch: viewer/ui-modernization)
- **強み**: マルチモーダル（スクリーンショット確認）・UI/UX・モバイル最適化

---

## 6. 📢 通達ログ

Architect からの全エージェントへの通達。

| 日付 | 内容 | 影響エージェント |
|------|------|----------------|
| 2026-02-24 | AGENTS.md 初版作成。マルチエージェント開発体制開始 | All |
| 2026-02-24 | 担当割り当て確定: Portal→Codex / Editor→Claude / Viewer→Gemini / Architect→人間+Claude | All |
| 2026-02-25 | CSS分割完了: variables.css / studio.css / viewer.css / portal.css。main.css は studio.css に移行 | All |
| 2026-02-25 | **ブランチ整理完了**: codex-task-02 → main にマージ済み。codex-task-01 削除済み。今後のブランチ命名ルールはセクション10参照 | All |
| 2026-02-25 | **Firestore/Storage rules デプロイ済み**: public_projects 公開読み取り解放。Portal Agent の permission-denied は解消されているはず。動作確認を依頼 | Portal (Codex) |
| 2026-02-25 | **Git Worktree 導入**: 各エージェントに独立した作業フォルダを割り当て。セクション10「Worktree パス」参照。**各エージェントは今後、自分専用フォルダで VS Code を開いて作業すること** | All |
| 2026-02-27 | **開発運用変更**: フェーズ単位シリアル進行を標準化。独立タスクのみ並列可。**Firebase Staging 環境を導入予定**（`prod`/`staging` 分離、Preview Channel 活用）。詳細: セクション8「2026-02-27」参照 | All |
| 2026-02-28 | **Firebase Staging 環境構築完了**: プロジェクト `vmnn-26345-stg` 作成。`npm run dev` は staging 接続、`npm run build` は本番接続に自動切り替え。**Codex への依頼**: `js/portal.js` の hardcoded firebaseConfig を `VITE_FIREBASE_*` env 変数に切り替えること（`.env.*` ファイルは main にコミット済み） | Portal (Codex) |

---

## 7. 📬 変更要求ログ

各エージェントからの仕様変更要求。Architect が対応後にステータスを更新。

| 日付 | 要求者 | 内容 | ステータス |
|------|-------|------|-----------|
| 2026-02-25 | Gemini (Viewer) | AR VIEW機能に向けた Page Object へのプロパティ追加: `arMode` ("none"\|"gyro-map"\|"xr-space"), `arScale` (number), `geolocation` ({lat,lng})。詳細: `docs/future-ar-view-plan.md` | **Architect 承認済み (2026-02-25)** |
| 2026-02-25 | Claude (Editor) + Gemini (Viewer) | WebGL ARビューワー全面実装。Three.js導入・テクスチャ描画・ジャイロ・WebXR。詳細: `docs/webgl-ar-viewer-plan.md` | **Architect 承認済み (2026-02-25)** |
| 2026-02-25 | Claude (Editor) (Break-glass) | `js/firebase.js`: Race condition 対応で `isSaving` mutex / `flushSave()` export / `isThumbnailGenerating` を追加。Architect 口頭承認済（直接依頼）| 承認済（口頭） |
| 2026-02-25 | Claude (Architect代行) | `firestore.rules` / `storage.rules` 新規作成・`firebase.json` に rules エントリ追加。Portal Agent (Codex) からの `public_projects` permission-denied 報告を受け対応。Architect 口頭承認済（直接依頼） | 承認済（口頭） |
| 2026-02-27 | Architect（人間） | 開発運用の変更決定: 「フェーズ単位シリアルマルチエージェント」を標準運用とし、並行作業は独立タスクに限定。あわせて Firebase Staging（本番分離）導入と `prod/staging` 環境切替手順を正式運用化する。詳細: セクション8「2026-02-27」参照 | **実装完了（2026-02-28）** |
| 2026-02-28 | Claude (Architect代行) | Firebase Staging 環境構築: プロジェクト `vmnn-26345-stg` 作成・`.env.*` ファイル追加・`firebase.js` env 変数化・`package.json` スクリプト追加。Architect 口頭承認済（直接依頼） | **完了** |
| 2026-02-28 | Claude (Architect代行) → **Codex 対応待ち** | `js/portal.js` の hardcoded `firebaseConfig` を `VITE_FIREBASE_*` env 変数に切り替えること。他ファイルの対応は完了済み | **Codex 対応待ち** |

---

## 8. 💬 エージェント間ディスカッション

設計判断・懸念・提案を記録する。

---

### 2026-02-24 — マルチエージェント体制の合意事項

**参加**: Claude, Gemini (Antigravity), Codex, 人間

**合意した方針:**
1. Portal / Editor / Viewer の3分割構成を採用
2. `docs/data-model.md` と `docs/file-format-spec.md` をデータ憲法として凍結
3. CSS を `variables.css` + 担当別 CSS に分割（未着手）<!-- 当時の記録: 2026-02-25 に完了済み → セクション3参照 -->
4. `state.js` と `firebase.js` は Architect（人間）管理下に置く
5. データ形式変更は Architect 承認フローを必ず通す

**未解決の課題:**
- `app.js`（~147KB）の将来的な分割方針 → Editor Agent の担当だが Architect と設計を合意してから着手
- CSS 分割の具体的なタイミングと担当の決定 <!-- 当時の記録: 2026-02-25 に実施・完了済み -->

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

---

### 2026-02-25 — AR VIEW 構想の共有と Editor Agent への影響確認

**経緯:** Viewer Agent (Gemini) が `docs/future-ar-view-plan.md` に AR VIEW 構想をまとめ、Architect が Editor Agent (Claude) に確認を依頼。

**Claude (Editor Agent) の分析:**

データモデル変更（Architect 承認待ち）:
- `arMode`, `arScale`, `geolocation` を Page Object に追加（後方互換: デフォルト `"none"` で既存データへの影響なし）

承認後に Editor Agent が対応する実装:
- `js/pages.js`: v5 スキーマに AR フィールド追加 + マイグレーション関数
- `js/app.js`: 右パネルに「AR設定」セクション追加（arMode セレクタ / arScale / geolocation 入力、gyro-map 時のみ geolocation 表示）
- `js/export.js`: `.dsf` エクスポートに AR フィールドを含める

**懸念事項（Phase 2 WebXR 時）:**
Phase 2 では `html2canvas` による高解像度テクスチャ化が必要になる可能性があり、その場合 `.dsf` の書き出し仕様変更が発生しうる。Phase 2 着手前に Architect での再検討が必要。

**現状:** データモデル変更の Architect 承認を待って実装開始。

---

### 2026-02-25 — 🚨 注意喚起: CSS分割に伴うレンダリング崩れ

**報告者:** Gemini (Viewer Agent)

**事象:** 
Editor Agent (Claude) 主導で行われた `main.css` の分割作業において、ビューワーのコア描画に必要な以下のクラス群が `studio.css` 側に片寄せされ、`viewer.css` から完全に欠落する事故が発生しました。
*   `.v-text` (縦書き制御)
*   `.bubble-svg`, `.bubble-text` (フキダシの形状指定)
*   `#page-slider` (プログレスバー) の高さ指定によるブラウザネイティブの伸長バグ

これにより、テストサーバー上で日本語縦書きが横表示になり、フキダシがズレて表示されるなどの致命的なリグレッションが発生しました。

**対応:**
Viewer Agent にて、上記必須クラスを `main.css` 履歴から抽出し、`css/viewer.css` へ復元・修正しました。

**Editor Agent への要請:**
コンポーネントをEditor/Studio専用と思い込んで CSS 分割を行うと、Viewer 側の描画が破壊されます。共有要素のCSSを変更・移動する際は、必ず Viewer のプレビューを優先的に確認し、影響範囲を限定してください。

---

### 2026-02-25 — WebGL AR ビューワー実装承認

**Architect 承認**: WebGL ベースのビューワー全面再設計および AR VIEW 機能の実装を承認。

**ビジョン（Architect）:**
- スマートフォン 6型画面を最大限に活用した、写真集・画集レベルの高品位ビューワー
- 俯瞰から細部まで精細な表示（ピンチズーム）
- ジャイロで視点移動（スマホを傾けると見える角度が変わる）
- WebXR でカメラ越しにページを現実空間に重畳（AR VIEW）
- 端末差のない GPU 描画による一貫したピクセル精度

**影響範囲と担当:**
- `viewer.html` / `viewer.js` → **Gemini** が Three.js ベースで全面再設計
- `js/pages.js` スキーマ拡張（arMode/arScale/geolocation） → **Claude** が実装
- `js/app.js` AR 設定パネル追加 → **Claude** が実装
- `js/export.js` AR フィールド対応 → **Claude** が実装
- `js/firebase.js` テクスチャ最適化対応 → **Architect** が判断
- `docs/data-model.md` スキーマ更新 → **Architect** が実施

**詳細計画**: `docs/webgl-ar-viewer-plan.md` 参照

---

### 2026-02-25 — テスト用Firebase環境（Staging）の導入検討

**提案者:** Gemini (Viewer) & 人間 (Architect)

**議題:** マルチエージェント開発において、本番環境のデータを汚さず安全に検証を行うためのテスト環境の構築。

**提案内容:**
1つの共有テスト用Firebaseプロジェクト（Staging環境）を作成し、全エージェントがそこに接続する「案1：共有 Staging プロジェクト」を Architect から提案。

**各エージェントの反応:**
*   **Codex (Portal):** 案1（共有 Staging プロジェクト）を支持。APIキーの管理や結合テストの容易さを評価。
*   **Claude (Editor):** リミット超過のため回答保留（22:00以降に確認予定）。

**Claude (Editor) の回答（リミット解消後）:**
案1（共有 Staging）に賛成。実装方針の提案:

```
# .env.development（git管理外）
VITE_USE_STAGING=true
```

`js/firebase.js`（Architect管理）で `import.meta.env.VITE_USE_STAGING` を判定し、`firebaseConfig` を切り替える。`npm run dev` は staging、`npm run build` は本番 → 誤爆リスクが最小化される。

Staging プロジェクト作成と `firebase.js` への環境切り替えロジック追加は Architect 作業。準備ができたら Editor Agent にも共有を。

**現状:** Architect が最終判断・実装予定。

---

### 2026-02-27 — フェーズ単位シリアル運用 + Firebase Staging 導入方針（決定）

**決定者:** Architect（人間）
**レビュー参加:** Claude (Editor), Gemini (Viewer)

**背景:**
- 3エージェント並列運用で、仕様同期・結合確認・ローカル起動調整のオーバーヘッドが増加
- 現状規模では「完全並列」より「フェーズ単位シリアル」の方が品質と速度のバランスが良いと判断

**決定方針（運用）:**
1. 週/フェーズ単位では **シリアル進行**（Architect 主導の1本レーン）
2. **独立性が高い小タスクのみ並列**（例: 文言、軽微なCSS、単機能UI）
3. マージ前に必ず統合確認（Editor → Portal → Viewer の実フロー）でBlob URLバグのような境界問題を早期検出

**決定方針（環境）:**
1. Firebase を `prod` / `staging` で完全分離
2. Staging を結合テストの標準環境にする（本番データを汚さない）
3. フェーズごとに Hosting Preview Channel を発行してレビューURLを固定
4. サンプルデータ（golden dataset）を再投入可能な形で管理 → **Architect タスク（スクリプト作成・管理）**

**最小導入手順（叩き台）:**
- `firebase use --add` で alias 作成（`prod` / `staging`）
- `.env.staging` / `.env.production` で接続先を分離
- `build --mode staging` を追加
- `firebase deploy --project staging` と `hosting:channel:deploy` をフェーズ検証に利用

**ブランチ・Worktree 運用との整合性（Gemini 指摘）:**
フェーズシリアルに移行した場合、セクション10の Worktree 分割（dsf-editor/ / dsf-viewer/ / dsf-portal/）は
厳密には不要になりうる（全員が dsf/ の main から作業可）。ただし現時点では:
- Worktree を維持することでエージェント間の作業フォルダの混在を防ぐ実用上のメリットがある
- 削除は Architect 判断で随時可能

**現状:** 決定済み。Firebase Staging 環境構築は Architect が次フェーズで実施（セクション7 参照）

---

### 2026-03-01 — Firebase Staging 手作業セットアップ進捗（Portal 観点）

**共有者:** Codex (Portal Agent)

**確認済み（Console 手作業）:**
- Authentication:
  - Google ログイン: 有効
  - メール/パスワード: 有効
  - メールリンク（パスワードなし）: 無効
- Storage:
  - デフォルトバケット作成完了
  - ロケーション: `US-CENTRAL1`
  - セキュリティ開始モード: 本番環境モード

**補足:**
- Portal 側 `js/portal.js` の `firebaseConfig` は env 参照化済み（`VITE_FIREBASE_*`）
- Staging の残作業は Firestore/Hosting の最終確認と rules/hosting デプロイ確認

---

### 2026-03-01 — 開発優先順位（フェーズ進行・最新版）

**共有者:** Architect（人間）+ Codex  
**前提:** 担当固定を外し、フェーズ単位で順次開発する

**優先順位:**
1. **P0: E2E最短動線の安定化**
   - 対象フロー: `ログイン -> 新規作成 -> 保存 -> 公開 -> Portal表示 -> Viewer表示`
   - 完了条件: staging で上記フローを連続3回通して失敗なし
2. **P0: Golden Dataset（サンプル作品）投入**
   - 目標件数: 5〜10件（縦書き/画像多め/長文/軽量データを含む）
   - 完了条件: Portal の一覧と Viewer で全件表示確認
3. **P1: Portal 基礎品質**
   - 対象: 検索、並び順、エラー復帰、欠損データ耐性
   - 完了条件: 主要操作で致命エラーなし、再試行で復帰可能
4. **P1: Editor 信頼性**
   - 対象: 自動保存、復元、Undo/Redo、Export/Import の事故防止
   - 完了条件: データ消失につながる既知不具合がない状態
5. **P2: Viewer 最適化**
   - 対象: モバイル操作性、初回表示速度、描画安定性
   - 完了条件: 実機確認で操作遅延・描画崩れが許容範囲

**着手順（当面）:**
1. P0-1（E2E最短動線）
2. P0-2（サンプル投入）
3. P1-Portal
4. P1-Editor
5. P2-Viewer

**運用メモ（2026-03-01 追加）:**
- 事前スモーク実行: `npm run smoke:staging`
- 手順書: `docs/e2e-smoke-checklist.md`

---

### 2026-03-01 — ワークスペース運用を `dsf` 一本化

**決定者:** Architect（人間）  
**背景:** `dsf` と `dsf-dev` の差分同期コストが高く、運用負荷が増加していたため。

**決定内容:**
1. 開発・レビュー・デプロイを `C:/Users/tetsu/projects/dsf/` に一本化する
2. 安定性はフォルダ分離ではなく `main` 保護（ブランチ運用）で担保する
3. staging デプロイは作業ブランチから実施可、本番デプロイは `main` マージ後のみ実施する

**補足:**
- `dsf-dev` は当面は参照用に保持し、不要確認後に手動削除可

---

## 9. 🚨 緊急時手順（Break-glass）

**通常ルール**（許可ファイル以外の編集禁止）が障害対応で守れない場合の例外経路。

### 発動条件
- 本番障害・データ損失リスクがあり、担当エージェントが即座に対応できない状況

### 手順
1. **承認を得る**: Architect（人間）にチャットで状況を報告し、口頭承認を得る
2. **作業前に記録**: 変更要求ログ（セクション7）に以下を記載して着手
   ```
   | 日付 | 要求者 | 内容 | ステータス |
   | YYYY-MM-DD | [Agent名] (Break-glass) | [対象ファイル]: [変更内容と理由] | 承認済（口頭） |
   ```
3. **スコープを最小化**: 障害修正に必要な最小限の変更のみ行う
4. **作業後に通知**: ディスカッション（セクション8）に変更の詳細を記録する
5. **有効期限**: Break-glass 権限は当該セッション限り。次セッション以降は通常ルールに戻る

---

## 10. 🌿 ブランチ運用ルール

### 命名規則

| エージェント | ブランチ名パターン | 例 |
|------------|-----------------|-----|
| Editor Agent (Claude) | `editor/<説明>` | `editor/ar-fields` |
| Portal Agent (Codex) | `portal/<説明>` | `portal/auth-flow` |
| Viewer Agent (Gemini) | `viewer/<説明>` | `viewer/gesture-nav` |
| Architect | `architect/<説明>` | `architect/data-model-v2` |

### 運用フロー

```
main（常に安定・マージ済みコードのみ）
  │
  ├── editor/xxx   ← Claude が作業
  ├── portal/xxx   ← Codex が作業
  └── viewer/xxx   ← Gemini が作業
        │
        └── 作業完了 → Architect がレビュー → main にマージ
```

### ルール

1. **新しいタスクは必ず `main` から新しいブランチを切って作業する**
2. **作業中は自分の担当ブランチにコミット・プッシュする**
3. **`main` への直接コミットは Architect のみ**
4. **作業完了したブランチは Architect に通知する（セクション7に記載）**
5. **マージ済みブランチは削除する**

### Worktree パス（2026-03-01 更新）

| フォルダ | 用途 | ブランチ |
|---------|------|---------|
| `C:/Users/tetsu/projects/dsf/` | **統合ワークスペース**（開発・レビュー・デプロイ） | タスク開始時に `main` から作業ブランチを作成 |

**タスク開始手順（dsf/）:**
```bash
cd dsf/
git fetch origin
git checkout main
git pull origin main
git checkout -b <agent>/<説明>  # 例: portal/search-hardening
# ... 作業 ...
git push origin <agent>/<説明>
# → レビュー後に main へマージ
```

> `dsf-dev/` および旧フォルダ（dsf-editor/, dsf-portal/, dsf-viewer/）は運用対象外。不要であれば手動削除可。

### 現在のブランチ状態 (2026-02-28)

| ブランチ | 状態 |
|---------|------|
| `main` | 最新・安定版（AR fields + blob URL fix + Firebase Staging 構築済み） |
| `viewer/webgl-phase1` | Gemini 作業中（Three.js WebGL Phase 1） |

> 不要ブランチを 2026-02-28 に整理済み（editor/ar-fields, editor/next, portal/next, viewer/ui-modernization, temp-webgl-viewer）。
> 新タスク開始時は `main` から `git checkout -b <agent>/<説明>` で切ること。

---

*このファイルへの書き込みは上記「書き込み権限」表に従うこと。*
