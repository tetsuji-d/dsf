# CLAUDE.md

このファイルは、リポジトリ内のコードを操作する Claude Code (claude.ai/code) へのガイダンスを提供します。

## プロジェクト概要

**DSF Studio Pro** はブラウザベースのウェブトゥーン／コミック編集・閲覧アプリです。バックエンドを持たないクライアントサイド SPA で、サーバー機能はすべて Firebase (Auth, Firestore, Storage) が担います。Firebase Hosting にデプロイされています。

3 つのエントリーポイント:
- `index.html` — ポータル（プロジェクト一覧・ログイン）
- `studio.html` — エディター（PC 向け、リボンメニュー UI）
- `viewer.html` — ビューアー（モバイル最適化）

## コマンド

```bash
npm run dev       # Vite 開発サーバー起動 → http://localhost:5173
npm run build     # dist/ へ本番ビルド
npm run preview   # 本番ビルドをローカルでプレビュー
npx firebase deploy --only hosting  # Firebase へデプロイ
```

リンターおよびテストランナーは設定されていません。

## アーキテクチャ

### モジュール構成 (`js/`)

| ファイル | 役割 |
|---------|------|
| `app.js` | エディターのメインループ、イベント処理、UI レンダリング（~147KB） |
| `viewer.js` | ビューアーのロジック、ページナビゲーション、タッチジェスチャー（~53KB） |
| `firebase.js` | Auth・Firestore の保存/読み込み・Storage への画像アップロード（~27KB） |
| `state.js` | 中央集権的な state オブジェクト + `dispatch(action)` レデューサー |
| `sections.js` | ページ／セクションの CRUD 操作 |
| `bubbles.js` | フキダシの作成・編集・配置 |
| `shapes.js` | 全フキダシ種別の SVG シェイプ定義 |
| `pages.js` | ページスキーマ v5 および後方互換マイグレーション |
| `blocks.js` | ブロックモデルの管理（構造化コンテンツノード） |
| `export.js` | ZIP ベースの `.dsp`/`.dsf` ファイルエクスポート |
| `history.js` | アンドゥ／リドゥスタック |
| `layout.js` | 固定幅タイポグラフィとテキスト組版 |
| `portal.js` | ポータルページのロジック |
| `projects.js` | プロジェクト一覧モーダル |
| `lang.js` | 言語ユーティリティ |
| `theme-presets.js` | カラー／テーマパレットのテンプレート |

`css/main.css` はプロジェクト全体を統合する単一スタイルシートです（~2400 行以上）。

### デュアルデータモデル

`syncBlocksWithSections()` によって同期される 2 つのコンテンツモデルが共存しています:

- **Blocks モデル** (`state.blocks`): `kind` フィールド（`cover_front`, `cover_back`, `chapter`, `section`, `toc`, `page`）を持つ構造化ノード。これが正規モデルです。
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

### Firebase 設定

Firebase の設定は `js/firebase.js` にハードコードされています（`.env` は使用していません）。コレクション:
- `works`: プロジェクトドキュメント（sections、メタデータ、公開設定）
- Firebase Storage: 画像。`getOptimizedImageUrl()` 経由で最適化 URL を取得します。

## 重要なパターン

- **画像最適化**: 画像 URL はすべて使用前に `getOptimizedImageUrl()` を通します（WebP 変換・サイズ調整を担います）。
- **多言語テキスト**: ほとんどのテキストフィールドは言語コードをキーとするオブジェクトです: `{ ja: "...", en: "..." }`。現在の言語は `state.activeLang` で参照します。
- **フキダシシェイプ**: `shapes.js` に SVG パスジェネレーターとして定義されています。シェイプ ID はサイズ／スタイルパラメーターを受け取る関数にマッピングされます。
- **タイポグラフィ**: 日本語テキストは `writingMode: "vertical-rl"` の固定幅レイアウト（12 行）。英語は横書きで 21 行。

## ドキュメント

アーキテクチャに関するドキュメントは `docs/` に格納されています:
- `file-format-spec.md` — `.dsp`/`.dsf` の ZIP 構造
- `data-model.md` — Firestore スキーマとセキュリティルール
- `ui-architecture.md` — リボンメニューとサイドバーのレイアウト
- `page-architecture-plan.md` — Blocks v5 スキーマの変遷
- `editor-menu-sitemap.md` — リボンタブごとの機能マップ
