# CLAUDE.md

このファイルは、このリポジトリの**総合入口**です。  
プロダクト思想、実装方針、インフラ、現在の正本文書への導線をここに集約します。

AI エージェント、人間の開発者ともに、まずこの文書を読み、次に必要な詳細文書へ進んでください。

## 最初に読む順番

### 1. 全体像

- **[CLAUDE.md](CLAUDE.md)**  
  プロダクト思想、実装方針、エコシステム、開発コマンド、文書の読み順

### 2. 実務ルール

- **[AGENTS.md](AGENTS.md)**  
  ブランチ運用、編集方針、参照必須文書、現在の開発運用ルール

### 3. 正本ドキュメント

- **[docs/data-model.md](docs/data-model.md)**  
  Firestore スキーマ、保存面、Security Rules の正本
- **[docs/file-format-spec.md](docs/file-format-spec.md)**  
  `.dsp` / `.dsf` の ZIP 構造仕様
- **[docs/pressroom-spec.md](docs/pressroom-spec.md)**  
  Press / Works / Viewer の公開境界

### 4. 最近の重要テーマ

- **[docs/environment-topology.md](docs/environment-topology.md)**  
  Cloudflare Pages / Firebase / R2 の役割分担
- **[docs/user-account-audit.md](docs/user-account-audit.md)**  
  ユーザーアカウント、Google-only 認証、今後のブートストラップ方針
- **[docs/admin-role-model.md](docs/admin-role-model.md)**  
  admin / operator / moderator の権限モデルと運営管理画面の前提

- **[docs/admin-console-spec.md](docs/admin-console-spec.md)**  
  運営管理画面の最小画面構成・権限別操作・実装順
- **[scripts/set-custom-claims.js](scripts/set-custom-claims.js)**  
  custom claims の付与/剥奪、Firestore roles ミラー更新、監査ログ記録
- **[docs/viewer-info-panel-spec.md](docs/viewer-info-panel-spec.md)**  
  Viewer のハーフモーダル / 右ドロワー仕様
- **[docs/auth-unified-surfaces.md](docs/auth-unified-surfaces.md)**  
  Portal / Studio / Viewer の認証サーフェス整理

### 5. 履歴・計画メモ

以下は補助資料です。現行判断の正本ではありません。

- `DSF_SITEMAP.md`
- `docs/editor-menu-sitemap.md`
- `docs/page-architecture-plan.md`
- `docs/progress.md`
- `docs/implementation-plan-*.md`
- `docs/remediation-roadmap.md`

## 文書の役割分担

| 文書 | 役割 |
|------|------|
| `CLAUDE.md` | 総合入口。読む順番と、どれが正本かを示す |
| `AGENTS.md` | 開発運用ルール。AI/開発者が守る実務ルール |
| `docs/data-model.md` | データ憲法。Firestore / Storage / Security の正本 |
| `docs/file-format-spec.md` | DSF / DSP ファイル仕様の正本 |
| `docs/*.md` | テーマ別仕様、監査、設計メモ |

> 原則として、**全体像は `CLAUDE.md`、実務ルールは `AGENTS.md`、厳密仕様は `docs/`** を見る構成にします。

## DSF（Digital Spread Format）とは

**DSF（Digital Spread Format）** は、スマートフォン向けの**固定レイアウト型**デジタル出版フォーマットです。EPUB のようなリフロー型ではなく、「**レイアウトはコンテンツである**」という前提で、作者が意図したレイアウト・タイポグラフィ・構図をそのまま**マスターバージョン**として配信します。

想定用途は、マンガ・イラスト・小説・写真集・同人誌に限らず、自治体・観光・製品マニュアルなど **B2B の説明・広報コンテンツ**まで幅広く含みます。日本語 UI と英語 UI の両立、および**ページ単位で言語を切り替えられる**多言語作品を前提に、最初から海外読者にも届く構造を目指します。

### 技術的な特徴（フォーマット方針）

- **9:16 固定比率**の **WebP** をページ単位のマスターとして扱う（Gen3）。
- **ページ単位の遅延ロード**等により、先頭から順に読み始めやすくする（低速回線でも閲覧開始を早める設計方針）。
- **パノラマ・見開き**は、表示ユニットを**連結**するモデルで表現する（実装・スキーマは `docs/` および `pages.js` を参照）。
- ZIP コンテナ内の **`manifest.json` / `meta.json` / `content.json`** 等で、ページ構成・多言語・表示メタ（綴じ方向・アスペクト比など）を管理する。詳細は `docs/file-format-spec.md`。

### 思想的・プロダクト上の位置づけ

- **読者向けビューに広告を挟まない**（認知負荷・表現の歪みを避ける）。
- **オープンなファイル仕様**（ZIP + JSON + アセット）を重視し、特定プラットフォームへのロックインではなく**規格としての再利用性**を高める。
- **持続可能なコスト構造**と、短期的な外部圧力に左右されにくい**独立性**を志向する（収益・ティアの考え方は `docs/business-model.md`、インフラは本リポジトリの設定を参照）。
- **UI は日本語と英語**に対応（`i18n-studio.js` 等）。制作物の本文・画像は言語別に持てる。

### エコシステム（製品構成）

| 名称 | 実装上の主たる入口 | 役割 |
|------|-------------------|------|
| **DSF Library（ポータル）** | `index.html` | 読者・利用者向けの配信ポータル（広告なしの前提）。ログイン・プロジェクト一覧など |
| **DSF Studio** | `studio.html` | 制作・管理ツール（ルーム切り替えで Project / Editor / Press / Works を包含） |
| **Project（Home）** | Studio 内 Home Room | 新規作成・既存プロジェクト一覧、`.dsp` 読み込み |
| **Editor** | Studio 内 Editor Room | 編集・プレビュー |
| **Press Room** | Studio 内 Press Room | DSP → DSF レンダリング・公開 URL 発行・審査パイプライン（仕様は `docs/pressroom-spec.md`） |
| **Works** | Studio 内 Works Room | 発行済み DSF のステータス（draft / unlisted / public / private 等） |
| **Viewer** | `viewer.html` | ブラウザベースの閲覧（モバイル最適化） |

DSP（`.dsp`）は直接公開せず、**Press Room で DSF 化 → Works で公開状態を管理**する運用です。

---

## このリポジトリ（実装）の概要

クライアントサイド **SPA**。配信面は **Cloudflare Pages**、認証・DB は **Firebase**（Auth, Firestore）、画像ストレージは本番・staging で **Cloudflare R2** を使います。ローカル開発では **Vite** と Firebase Storage を使う構成です。環境の役割分担と運用は [docs/environment-topology.md](docs/environment-topology.md) を参照。

3 つのエントリーポイント:

- `index.html` — ポータル（DSF Library）
- `studio.html` — DSF Studio（エディター / PC 向けリボン UI）
- `viewer.html` — ビューアー（モバイル最適化）

## コマンド

```bash
npm run dev       # Vite 開発サーバー起動 → http://localhost:5173 (Firebase Storage 使用)
npm run build     # dist/ へ本番ビルド (R2 使用)
npm run preview   # 本番ビルドをローカルでプレビュー
npm run build:staging       # staging ビルド (Cloudflare preview / R2 想定)
npm run dev:pages           # Cloudflare Pages Functions 付きローカル確認
npm run deploy:pages:staging # Cloudflare Pages preview へ staging デプロイ
npm run deploy:staging      # Firebase Hosting staging + rules へ反映

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

補足:
- `staging.dsf-studio.pages.dev` は **Cloudflare Pages staging**
- `vmnn-26345-stg.web.app` は **Firebase Hosting staging**
- 日常の確認先は前者を基本とし、後者は補助確認用

### ストレージ切り替え
`VITE_STORAGE_BACKEND` 環境変数で制御:

- `r2` → 本番（`.env.production`）
- `r2` → staging preview（`.env.staging`）
- `firebase` → ローカル Vite 開発（`.env.development`）

### Cloudflare Pages Function
`functions/upload.js`: Firebase ID トークンを検証し R2 にアップロードする serverless エンドポイント。
`wrangler.toml`: R2 バインディング・環境変数の設定。本番・プレビュー両環境に `R2_BUCKET` バインディングが必要。preview 側は `FIREBASE_PROJECT_ID=vmnn-26345-stg` と staging 用 `R2_PUBLIC_URL` を設定する。

## アーキテクチャ

### Gen3（DSF のページ表現）

**配信ページは WebP 画像として出力する。** テキスト組版はエディターで完結し、結果を WebP に焼き付けてビューアーに渡す。ビューアーは **`<img>` 中心の軽量表示**に専念し、共有 URL では **発行済み DSF（`dsfPages`）のみ**を扱う。

- ビューアー側での SVG レンダリング・WebGL・richText によるリッチ組版は採用しない
- `bodyKind: 'text'` / `richText` フィールドは将来的に廃止方向
- **多言語**: 言語ごとに WebP を生成し、必要な言語のみ遅延ロードする

#### 高度な和欧文組版エンジン（実装済み / 2026-04）

エディタープレビュー（`js/app.js` `renderTextPreview`）は以下の組版機能を実装済み：

| 機能 | 実装方法 | 対象 |
|------|---------|------|
| **縦中横（Tate-Chu-Yoko）** | 2〜4 桁の半角数字を `<span class="tcy">` でマーク、`text-combine-upright: all` で横向き表示 | 日本語縦書き |
| **ぶら下がり禁則** | `hanging-punctuation: allow-end`（CSS、Safari 対応） | 日本語縦書き |
| **和欧文間隔（四分空き）** | `text-autospace: ideograph-alpha` / `text-spacing: ideograph-alpha ideograph-numeric` | 日本語縦書き |
| **均等割付（Justification）** | `text-align: justify; text-justify: inter-word` | 英語横書き |
| **自動ハイフネーション** | `hyphens: auto`（`lang` 属性による言語検出） | 英語横書き |

版面（`layout.js`）:
- `FRAME_PAD_X = FRAME_PAD_Y = 20px`（上下左右対称余白）
- 縦書き: 列幅 = `frame.w / maxLines`、文字ピッチ = `frame.h / charsPerLine`（フレームを等分）
- 横書き: 行高 = `frame.h / maxLines`（フレームを等分、フルページで上下対称）

> Press（WebP 書き出し）側の Canvas 2D テキスト描画は Phase 3 で実装予定。

**正規論理ページ（9:16）**: レイアウト・エディター・ビューワー・Press の基準座標は **`js/page-geometry.js`**（`CANONICAL_PAGE_WIDTH` / `HEIGHT` 等）と **`css/variables.css`** の `--dsf-canonical-page-*` で一致させる。配信用ビットマップの**物理ピクセル最低ラインは 1080×1920**（論理の 3 倍）を前提とする（詳細は `docs/implementation-plan-9-16-layout.md`）。

### モジュール構成 (`js/`)

| ファイル | 役割 |
|---------|------|
| `page-geometry.js` | 正規論理ページ寸法（9:16）・最小エクスポート倍率など、幾何の単一ソース |
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

コンテンツの**仕様上の正本**は Blocks モデルです。`Sections` と `Pages` は互換面 / 消費面として扱い、編集経路が `sections` から入る場合も保存前に `blocks` へ再同期します。

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
- `.dsf`: **DSF（Digital Spread Format）** の配信用パッケージ。JSON + WebP 等を含む ZIP（旧文脈では Digital Smart Format 表記のこともあり）

どちらも ZIP アーカイブです。`meta.json` の `presentation`（`aspectRatio` 等）は **`js/page-geometry.js`** の定数と同期して書き出す（`export.js` の `buildMetadata`）。構造の詳細は `docs/file-format-spec.md` を参照してください。

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
- **公開境界**: 通常保存は `users/{uid}/projects/{pid}` の DSP 本体だけを更新する。`public_projects` の更新は Works Room の `public` 切り替えだけが行い、Press Room は新しい DSF を `draft` として生成する。

## Studio ルーム構成（DSF Studio 内）

| ルーム | 役割 |
|--------|------|
| Home Room | プロジェクト一覧・新規作成・.dsp 読み込み |
| Editor Room | DSP 編集・プレビュー |
| Press Room | DSP → DSF レンダリング・発行 |
| Works Room | 発行済み DSF のステータス管理（draft / unlisted / public / private） |

## ドキュメント

アーキテクチャに関する詳細文書は `docs/` にあります。  
ただし、**どれが正本かは上の「最初に読む順番」と「文書の役割分担」を優先**してください。

主な参照先:

- `file-format-spec.md` — `.dsp`/`.dsf` の ZIP 構造
- `data-model.md` — Firestore スキーマとセキュリティルール
- `pressroom-spec.md` — Press Room / Works / Viewer の公開境界
- `environment-topology.md` — Pages / Firebase / R2 の構成
- `user-account-audit.md` — アカウント周りの棚卸し
- `viewer-info-panel-spec.md` — Viewer 情報パネル仕様
