# DSF Studio & DSF Library

**DSF（Digital Spread Format）** は、スマートフォン向けの**固定レイアウト型**デジタル出版のためのオープンな ZIP ベース仕様です。リフロー型の EPUB とは異なり、「レイアウトはコンテンツである」という前提で、9:16 比率の **WebP** ページなどをマスターとして配信します。

このリポジトリは **DSF Studio**（制作）、**DSF Library（ポータル）**（配信・一覧）、**Viewer**（閲覧）をひとつのクライアント SPA として実装しています。

## ドキュメント

- **[CLAUDE.md](CLAUDE.md)** — 総合入口。フォーマット思想、エコシステム、インフラ、モジュール構成、開発コマンド、読む順番
- **[AGENTS.md](AGENTS.md)** — 開発運用ルール
- **[PROJECT_STATUS.md](PROJECT_STATUS.md)** — 実装済み機能・既知課題・TODO
- **[docs/file-format-spec.md](docs/file-format-spec.md)** — `.dsp` / `.dsf` ZIP 構造
- **[docs/remediation-roadmap.md](docs/remediation-roadmap.md)** — 中期の減債と分割の進め方
- **[docs/security-hardening.md](docs/security-hardening.md)** — API key / auth / Functions の hardening メモ
- **[docs/environment-topology.md](docs/environment-topology.md)** — Cloudflare Pages / Firebase / R2 の役割分担と環境運用
- **[docs/user-account-audit.md](docs/user-account-audit.md)** — Google-only 認証、ユーザーアカウント棚卸し、今後のブートストラップ方針
- **[docs/admin-role-model.md](docs/admin-role-model.md)** — admin / operator / moderator の権限モデルと運営管理画面の前提
- **[docs/viewer-info-panel-spec.md](docs/viewer-info-panel-spec.md)** — Viewer のハーフモーダル / 右ドロワー仕様

### 読む順番

1. **[CLAUDE.md](CLAUDE.md)** — 全体像と文書構造
2. **[AGENTS.md](AGENTS.md)** — 実務ルール
3. **[docs/data-model.md](docs/data-model.md)** / **[docs/file-format-spec.md](docs/file-format-spec.md)** — 正本仕様
4. テーマ別 docs

### Current source of truth

- **[CLAUDE.md](CLAUDE.md)** — 総合入口・プロダクト方針・実装原則
- **[AGENTS.md](AGENTS.md)** — 開発運用ルール
- **[docs/data-model.md](docs/data-model.md)** — ランタイム canonical / compatibility 関係
- **[docs/file-format-spec.md](docs/file-format-spec.md)** — 配信フォーマット仕様
- **[docs/pressroom-spec.md](docs/pressroom-spec.md)** — 公開境界と Press / Works の責務

### Historical / planning docs

`DSF_SITEMAP.md`、`docs/editor-menu-sitemap.md`、`docs/implementation-plan-text-editor-typography.md`、`docs/progress.md`、`docs/page-architecture-plan.md` は履歴資料または計画メモを含みます。現行アーキテクチャの判断には上の source of truth を優先してください。

## 実行方法

ローカルファイルを直接 `file://` で開かず、開発サーバー経由で動かしてください。

```bash
npm install
npm run dev
```

ブラウザで表示された URL（通常 `http://localhost:5173`）を開きます。

## 環境の考え方

DSF は現在、単一ホスティングではなく次の構成です。

- **Cloudflare Pages**: `studio.html` / `viewer.html` / `index.html` などの配信面
- **Firebase**: 認証、Firestore、ユーザー状態
- **Cloudflare R2**: staging / production の画像保存

つまり、`staging.dsf-studio.pages.dev` で動いていても、裏では Firebase を使っています。  
環境の詳細は [docs/environment-topology.md](docs/environment-topology.md) を参照してください。

## よく使うコマンド

```bash
# ローカル開発（Vite + staging Firebase + Firebase Storage）
npm run dev

# staging ビルド
npm run build:staging

# Cloudflare Pages staging へ反映（通常の確認先）
npm run deploy:pages:staging
# alias
npm run deploy:cf:staging

# Firebase Hosting staging へ反映（補助確認用）
npm run deploy:staging
# alias
npm run deploy:firebase:staging
```

## ステージング運用ルール

- **日常のステージング確認先**: `https://staging.dsf-studio.pages.dev/`
- **補助確認先**: `https://vmnn-26345-stg.web.app`
- バグ報告や確認依頼では、**どのURLで見たか**を必ず添える

`git push` はコードを GitHub に送るだけで、確認用URLは更新しません。  
確認先を更新するには `deploy:*` 系コマンドが必要です。

## レガシー表記について

資料によっては **DSF** を旧称「Digital Smart Format」、拡張子 **`.dsf`** の説明と併記している箇所があります。現在のプロダクト定義では **Digital Spread Format** を正式名称とします（`.dsf` 拡張子は変更しません）。
