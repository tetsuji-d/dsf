# CLAUDE.md

このファイルは、リポジトリ内のコードを操作する Claude Code (claude.ai/code) へのガイダンスを提供します。

## プロジェクト概要

**DSF Studio Pro** はブラウザベースのデジタル出版編集・閲覧アプリです。ウェブトゥーン／コミック／多言語マニュアルなどに対応します。バックエンドを持たないクライアントサイド SPA で、認証・DB は Firebase (Auth, Firestore)、画像ストレージは **Cloudflare R2**、ホスティングは **Cloudflare Pages (`dsf.ink`)** が担います。

3 つのエントリーポイント:
- `index.html` — ポータル（プロジェクト一覧・ログイン）
- `studio.html` — エディター（PC 向け、リボンメニュー UI）
- `viewer.html` — ビューアー（モバイル最適化）

## コマンド

```bash
npm run dev       # Vite 開発サーバー起動 → http://localhost:5173 (Firebase Storage 使用)
npm run build     # dist/ へ本番ビルド (R2 使用)
npm run preview   # 本番ビルドをローカルでプレビュー
npm run build:staging       # staging ビルド (Cloudflare preview / R2 想定)
npm run dev:pages           # Cloudflare Pages Functions 付きローカル確認
npm run deploy:pages:staging # Cloudflare Pages preview へ staging デプロイ

# デプロイ（Cloudflare Pages）
npx wrangler pages deploy dist --project-name dsf-studio --branch main  # 本番
npx wrangler pages deploy dist --project-name dsf-studio --branch staging # staging preview
```

リンターおよびテストランナーは設定されていません。

## インフラ構成

| 役割 | 本番 | 開発/ステージング |
|------|------|-----------------|
| ホスティング | Cloudflare Pages (`dsf.ink`) | ローカル開発: Vite / staging: Cloudflare Pages preview |
| 画像ストレージ | Cloudflare R2 (`dsf-media` バケット) | ローカル開発: Firebase Storage / staging: Cloudflare R2 (`dsf-media-staging`) |
| 画像アップロード API | Cloudflare Pages Function (`/upload`) | ローカル開発: Firebase Storage SDK / staging: Cloudflare Pages Function (`/upload`) |
| 認証 | Firebase Auth | Firebase Auth |
| データベース | Firestore | Firestore |

### ストレージ切り替え
`VITE_STORAGE_BACKEND` 環境変数で制御:
- `r2` → 本番（`.env.production`）
- `r2` → staging preview（`.env.staging`）
- `firebase` → ローカル Vite 開発（`.env.development`）

### Cloudflare Pages Function
`functions/upload.js`: Firebase ID トークンを検証し R2 にアップロードする serverless エンドポイント。
`wrangler.toml`: R2 バインディング・環境変数の設定。本番・プレビュー両環境に `R2_BUCKET` バインディングが必要。preview 側は `FIREBASE_PROJECT_ID=vmnn-26345-stg` と staging 用 `R2_PUBLIC_URL` を設定する。

## アーキテクチャ

### Gen3 コンテンツ方針
**全ページ WebP 画像として出力する。** テキストの組版はエディターで完結し、結果を WebP に焼き付けてビューアーに配信する。ビューアーは `<img>` で表示するだけ。

- SVG レンダリング・WebGL・richText によるビューアー側レンダリングは採用しない
- `bodyKind: 'text'` / `richText` フィールドは将来的に廃止方向
- 多言語対応: 言語ごとに WebP を生成し、必要な言語のみ遅延ロードする

### モジュール構成 (`js/`)

| ファイル | 役割 |
|---------|------|
| `app.js` | エディターのメインループ、イベント処理、UI レンダリング |
| `viewer.js` | ビューアーのロジック、ページナビゲーション、タッチジェスチャー |
| `firebase.js` | Auth・Firestore の保存/読み込み・画像アップロード（R2 または Firebase Storage） |
| `state.js` | 中央集権的な state オブジェクト + `dispatch(action)` レデューサー |
| `sections.js` | ページ／セクションの CRUD 操作、`getOptimizedImageUrl()` |
| `bubbles.js` | フキダシの作成・編集・配置 |
| `shapes.js` | 全フキダシ種別の SVG シェイプ定義 |
| `pages.js` | ページスキーマ v5 および後方互換マイグレーション |
| `blocks.js` | ブロックモデルの管理（構造化コンテンツノード） |
| `export.js` | ZIP ベースの `.dsp`/`.dsf` ファイルエクスポート |
| `history.js` | アンドゥ／リドゥスタック |
| `layout.js` | 固定幅タイポグラフィとテキスト組版 |
| `i18n-studio.js` | エディター UI の多言語対応 |
| `portal.js` | ポータルページのロジック |
| `projects.js` | プロジェクト一覧モーダル |
| `lang.js` | 言語ユーティリティ |
| `theme-presets.js` | カラー／テーマパレットのテンプレート |

CSS はエントリーポイントごとに分離: `css/studio.css`, `css/viewer.css`, `css/portal.css`, `css/variables.css`（共有トークン）。

### デュアルデータモデル

`syncBlocksWithSections()` によって同期される 2 つのコンテンツモデルが共存しています:

- **Blocks モデル** (`state.blocks`): `kind` フィールド（`chapter`, `section`, `toc`, `page`）を持つ構造化ノード。これが正規モデルです。
- **Sections モデル** (`state.sections`): レンダリング互換性のために残されたレガシーなフラット配列。
- **Pages モデル** (`state.pages`): blocks/sections から導出されるビューアー出力（v5 スキーマ）のフラット配列。

コンテンツを編集する際は必ず Blocks モデルを更新し、`syncBlocksWithSections()` で Sections へ伝播させます。

### 状態管理

すべての状態変更は `state.js` の `dispatch(action)` を経由します。アクションは `type` 文字列を持つプレーンオブジェクトです。主要な state フィールド:

```javascript
{
  user, uid, projectId, title,
  languages, defaultLang, activeLang, languageConfigs,
  blocks, sections, pages,        // デュアルモデルシステム
  activeIdx, activeBlockIdx, activeBubbleIdx,
  thumbColumns, uiPrefs
}
```

### ファイルフォーマット

- `.dsp` (Digital Smart Project): 元画質で編集可能なプロジェクトファイル。JSON + オリジナル画像を含む ZIP
- `.dsf` (Digital Smart Format): 配布用の最適化ファイル。JSON + WebP 画像を含む ZIP

どちらも ZIP アーカイブです。構造の詳細は `docs/file-format-spec.md` を参照してください。

### Vite マルチページビルド

`vite.config.js` は Rollup を通じて 3 つの独立したエントリーポイントを設定しています:
- `index.html` → ポータルバンドル
- `studio.html` → エディターバンドル
- `viewer.html` → ビューアーバンドル

### Firebase / Cloudflare 設定

- Firebase の設定は `js/firebase.js` にハードコード
- Firestore コレクション: `users/{uid}/projects/{pid}`（正規）、`public_projects/{pid}`（公開インデックス）
- R2 パブリック URL: `https://media.dsf.ink`
- Cloudflare Pages ダッシュボードでバインディング設定（本番・プレビュー両環境）

## 重要なパターン

- **画像アップロード**: `firebase.js` の `_storeFile()` を経由。本番・staging preview は R2（`/upload` Function）、ローカル Vite 開発は Firebase Storage に自動振り分け。
- **画像 URL**: R2 URL・Firebase Storage URL ともに `getOptimizedImageUrl()`（`sections.js`）を通して使用。`blob:` URL はそのまま返す。
- **多言語テキスト**: ほとんどのテキストフィールドは言語コードをキーとするオブジェクト `{ ja: "...", en: "..." }`。現在の言語は `state.activeLang` で参照。
- **フキダシシェイプ**: `shapes.js` に SVG パスジェネレーターとして定義。シェイプ ID はサイズ／スタイルパラメーターを受け取る関数にマッピング。
- **タイポグラフィ**: 日本語テキストは `writingMode: "vertical-rl"` の固定幅レイアウト（12 行）。英語は横書きで 21 行。
- **blob: URL**: ゲストモードで発生。Firestore に書き込む前に `resolveBlobUrlsInSections/Blocks()` で解決すること。

## Studio ルーム構成

| ルーム | 役割 |
|--------|------|
| Home Room | プロジェクト一覧・新規作成・.dsp 読み込み |
| Editor Room | DSP 編集・プレビュー |
| Press Room | DSP → DSF レンダリング・発行 |
| Works Room | 発行済み DSF のステータス管理（draft / unlisted / public / private） |

DSP は直接公開不可。Press Room でレンダリング → Works Room でステータス変更の運用。

## ドキュメント

アーキテクチャに関するドキュメントは `docs/` に格納されています:
- `file-format-spec.md` — `.dsp`/`.dsf` の ZIP 構造
- `data-model.md` — Firestore スキーマとセキュリティルール
- `ui-architecture.md` — リボンメニューとサイドバーのレイアウト
- `page-architecture-plan.md` — Blocks v5 スキーマの変遷
- `editor-menu-sitemap.md` — リボンタブごとの機能マップ
- `pressroom-spec.md` — Press Room の仕様
