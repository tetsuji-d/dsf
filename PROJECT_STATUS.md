# PROJECT_STATUS

## 目的

**DSF（Digital Spread Format）** は、スマートフォン向けの**固定レイアウト型**デジタル出版フォーマットです。EPUB のようなリフローではなく、「**レイアウトはコンテンツである**」という哲学に基づき、意図したタイポグラフィと構図をマスターとして配信します。

このリポジトリはそのエコシステムの中核として、**DSF Studio**（`studio.html`：Project / Editor / Press Room / Works）、**DSF Library（ポータル）**（`index.html`）、**Viewer**（`viewer.html`）をブラウザ SPA として実装しています。想定用途はマンガ・写真集・小説レイアウトから、自治体・観光・マニュアルなど **B2B** まで広く含みます。

## 現状

- **ステータス**: 開発・稼働中（ローカル Vite、本番は Cloudflare Pages / R2 想定。従来の Firebase Hosting 単体運用から移行済みの記述が残る資料あり）
- **本番ホスティング（想定）**: Cloudflare Pages — `https://dsf.ink`（詳細は `CLAUDE.md`）
- **メディア CDN（想定）**: `https://media.dsf.ink`（R2）
- **ローカル開発**: `npm run dev` → 通常 `http://localhost:5173`（画像は Firebase Storage バックエンド）
- **利用想定**: PC（Studio / 編集）、スマートフォン（Viewer / 閲覧）

## 実装済み・確認できている主な内容

### 認証・クラウド・配信パイプライン

- Firebase Authentication（Google 等）によるログイン／ログアウト
- Firestore への保存／読込、画像アップロード（本番・staging は **R2 + Pages Function `/upload`**、ローカルは **Firebase Storage** を `VITE_STORAGE_BACKEND` で切替）
- 共有 URL・公開インデックス（`public_projects`）に関する実装
- **Press Room / Works Room**: DSP を直接公開せず、DSF レンダリングとステータス管理（draft / unlisted / public / private）の運用（仕様: `docs/pressroom-spec.md`）

### エディター・ページ管理

- Pages パネル: サムネイル列数 `8/5/4/2/1`、プロジェクト単位＋デバイス別（PC/モバイル）保存、アクティブ強調、D&D／長押し並べ替え、`+` 挿入、ページ複製
- **Gen3 方針**: 配信ページは **WebP** をマスターとし、ビューアーは画像表示中心（WebGL 系は廃止方針）
- 固定組版モジュール（`js/layout.js`）、言語別制約（例: 日本語縦 12 行、英語横 21 行）、オーバーフロー検知と「次ページへ分割」
- エディター UI 文言の **日本語／英語**（`i18n-studio.js`）。作品コンテンツは **ページ単位・言語別** に保持可能

### ビューアー・オフライン

- 未ログイン時の案内・サインイン導線
- 日本語縦書き時のナビ方向連動など、閲覧 UX の調整
- **Guest モード**（ログイン不要で編集・閲覧の試行）
- **`.dsp`**（編集用 ZIP）のエクスポート／ローカルインポート、**`.dsf`**（配信用 ZIP）のエクスポートと **オフライン表示**（ZIP 内にアセット実体を含むポータブル設計。`docs/file-format-spec.md`）
- 保存・エクスポート時のバリデーション緩和（警告を無視した強制書き出し）

### UI

- Edit パネル（右サイドバー）のリサイズ、タイトル入力位置の調整、モバイルドロワー挙動の修正 など

## ローカル起動

```bash
npm install
npm run dev
```

## デプロイ（本番想定）

```bash
npm run build
npx wrangler pages deploy dist --project-name dsf-studio --branch main
```

（staging / preview は `CLAUDE.md` の `deploy:pages:staging` 等を参照。Firebase Hosting のみへのデプロイはレガシー手順として残存し得る。）

## 既知の問題（優先度の目安）

1. **運用 / ガバナンス**: コンテンツ監査、利用規約、違反時の停止・削除フローの整備が未完
2. **スケール**: プロジェクト一覧（`js/projects.js`）は全件取得でページング未対応
3. **組版品質**: 禁則・単語境界のチューニング余地
4. **権限モデル**: 公開ビューアとプライベート閲覧の境界を明文化する必要

## 次の TODO（優先度の目安）

1. **Cloudflare 本番運用の一本化**（Pages / R2 / 環境変数・プレビュー環境の確定）
2. Firestore / Storage（および Functions 前提の）セキュリティルールの最終確定
3. プロジェクト一覧のページネーション
4. コンテンツ監査の最小運用（通報、停止フラグ、削除フロー）
5. 固定組版プリセットの精緻化（禁則、言語別テンプレ）
6. 設定の `.env` 化（Firebase 設定のハードコード解消）と移植手順
7. PWA 化、エクスポート拡張（画像一括 / PDF 等）
