# DSF Environment Topology

DSF は **Cloudflare Pages + Firebase + Cloudflare R2** で運用する。

## 結論

- **フロントエンド配信は Cloudflare Pages に一本化する**
- **Firebase Hosting は通常運用から外す**
- **Firebase は Auth / Firestore / Storage rules のバックエンドとして使う**
- **画像アップロード / 配信は staging / production とも Cloudflare R2 を使う**

---

## 役割分担

| 役割 | 担当 | 備考 |
|------|------|------|
| 静的フロント配信 | Cloudflare Pages | `index.html`, `studio.html`, `viewer.html`, `mypage.html`, JS/CSS |
| 認証 | Firebase Auth | Google GIS と連携 |
| メタデータ・保存管理 | Firestore | users / projects / public_projects / reviews、原稿の版・要求台帳など |
| 編集原稿 | 非公開Cloudflare R2 | 移行済み作品と許可済みアカウントの新規作品。未移行原稿はFirestore |
| Security Rules | Firebase | `firestore.rules`, `storage.rules` |
| 画像保存（staging / prod） | Cloudflare R2 | Pages Function `/upload` 経由 |
| 画像保存（ローカル開発） | Firebase Storage | `npm run dev` 時のみ |
| Firebase Hosting | 通常運用外 | emergency fallback / 明示検証時のみ |

---

## 環境一覧

### Cloudflare Pages

| 環境 | URL | 用途 |
|------|-----|------|
| production | `https://dsf.ink` 想定 | 本番フロント配信 |
| staging | `https://staging.dsf-studio.pages.dev/` | 日常のステージング確認先 |

Cloudflare Pages は UI の唯一の正面。アプリ内部では Firebase Auth / Firestore を利用するため、Pages だけで閉じたシステムではない。

### Firebase

| 環境 | Project ID | 用途 |
|------|------------|------|
| production | `vmnn-26345` | 本番 Auth / Firestore / rules |
| staging | `vmnn-26345-stg` | ステージング Auth / Firestore / rules |

Firebase Hosting の URL は通常確認先にしない。必要なときだけ `deploy:firebase:hosting:*` を明示して使う。

---

## ビルドごとの接続先

### `npm run dev`

- `.env.development` を使う
- Firebase project: staging (`vmnn-26345-stg`)
- Storage backend: Firebase Storage
- 用途: ローカル Vite 開発

### `npm run build:staging`

- `.env.staging` を使う
- Firebase project: staging (`vmnn-26345-stg`)
- Storage backend: Cloudflare R2
- 用途: Cloudflare Pages staging 用成果物

### `npm run build`

- `.env.production` を使う
- Firebase project: production (`vmnn-26345`)
- Storage backend: Cloudflare R2
- 用途: Cloudflare Pages production 用成果物

---

## デプロイコマンド

### フロント配信（Cloudflare Pages）

| コマンド | 反映先 |
|---------|--------|
| `npm run deploy:staging` | Cloudflare Pages staging |
| `npm run deploy:pages:staging` | Cloudflare Pages staging |
| `npm run deploy:prod` | Cloudflare Pages production |
| `npm run deploy:pages` | Cloudflare Pages production |

### Firebase backend rules

| コマンド | 反映先 |
|---------|--------|
| `npm run deploy:firebase:rules:staging` | staging Firestore rules |
| `npm run deploy:firebase:rules:prod` | production Firestore rules |
| `npm run deploy:firebase:storage-rules:staging` | staging Storage rules（Firebase Storage を明示的に使う場合のみ） |
| `npm run deploy:firebase:storage-rules:prod` | production Storage rules（Firebase Storage を明示的に使う場合のみ） |

### Firebase Hosting（通常運用外）

| コマンド | 用途 |
|---------|------|
| `npm run deploy:firebase:hosting:staging` | emergency fallback / 明示検証 |
| `npm run deploy:firebase:hosting:prod` | emergency fallback / 明示検証 |

---

## 運用ルール

1. 日常の staging 確認 URL は `https://staging.dsf-studio.pages.dev/` のみ。
2. 「staging へ出して」と言われたら `npm run deploy:staging` を使う。
3. Firestore rules を変えた場合だけ、別途 `npm run deploy:firebase:rules:staging` を使う。
4. Firebase Storage rules は通常運用外。明示的に Firebase Storage を使う場合のみ `deploy:firebase:storage-rules:*` を使う。
5. Firebase Hosting には通常デプロイしない。
6. 不具合確認では Cloudflare Pages URL を基準にする。

---

## 本番デプロイ手順

本番は `npm run deploy:prod:safe` を正とする。

このコマンドは次を順番に実行する。

1. `main` ブランチであることを確認
2. 未コミット差分がないことを確認
3. `main` が `origin/main` とずれていないことを確認
4. 主要 JS ファイルの `node --check`
5. `npm run build`
6. `npx firebase deploy --project prod --only firestore:rules`
7. `npx wrangler pages deploy dist --project-name dsf-studio`

今後は storage rules も変更対象なら safe deploy に含める。

---

## 関連ファイル

- `.env.development`
- `.env.staging`
- `.env.production`
- `wrangler.toml`
- `.firebaserc`
- `firebase.json`
- `firestore.rules`
- `storage.rules`
- `js/firebase.js`
- `js/firebase-core.js`
- `functions/upload.js`

## 非公開原稿の保存（2026-09-20）

本番の既存2作品の編集原稿は専用private R2 `dsf-authoring-production`へ移行済み。
本番・ステージングとも、許可された既存アカウントの新規作品は初回保存から非公開R2を使う。
ステージングは`dsf-authoring-staging`。両環境の原稿APIを有効にし、
UIDリストとアカウントの作成権限で対象を制限する。既存の未移行Firestore作品は変更しない。

認証はFirebase Auth、アカウント・作品／公開情報・保存管理情報はFirestore、
画像／公開ページは従来の公開R2。D1移行はしていない。
本番runtimeはmainへ統合済みの`91db176`、配備はhttps://94fed8ad.dsf-studio.pages.dev 。
ステージングruntimeは`cd6453a`、配備はhttps://5a5e6177.dsf-studio.pages.dev 。
文書だけの後続コミットはruntimeの再配備を必要としない。

[新規原稿の作成・検証結果](private-authoring-new-projects.md)、
[既存2作品の移行・バックアップ・復旧手順](private-authoring-production-rollout.md)を参照。
今後の配備でも原稿API／Rules／非公開bindingを保持する。
APIを停止するだけでは移行済み作品を読めなくなるため、復旧方針を先に確認する。
