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
| データ保存 | Firestore | users / projects / public_projects / reviews など |
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

## 非公開原稿の本番限定移行（2026-09-20）

既存2作品の編集原稿を専用private R2 `dsf-authoring-production`へ移行済み。
認証はFirebase Auth、公開情報と保存管理情報はFirestore、公開画像は従来のR2。
新規作品の既定保存はFirestoreのままで、D1移行はしていない。
本番runtimeは`d3be1a3`（`codex/private-authoring-production`）。
mainから次回配備する前にこの対応を統合し、移行済み作品のAPI／Rules／private bindingを保持する。
対象、バックアップ、検証結果、復旧手順は[本番移行記録](private-authoring-production-rollout.md)を参照。
