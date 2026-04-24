# DSF Environment Topology

DSF は現在、**フロントエンド配信**と**バックエンド基盤**が分かれた構成になっている。

## 結論

- **Cloudflare Pages 単体では動かない**
- **Firebase 単体でも現在の本番想定フロント構成は完結しない**
- 実態は **Cloudflare Pages + Firebase + Cloudflare R2** の組み合わせ

つまり:

- **表のURL** は Cloudflare Pages
- **認証 / DB / ユーザー状態** は Firebase
- **画像アップロード / 配信** は R2（staging / production ビルド時）

---

## 役割分担

| 役割 | 現在の担当 | 備考 |
|------|------------|------|
| 静的フロント配信 | Cloudflare Pages | `index.html`, `studio.html`, `viewer.html`, JS/CSS |
| 認証 | Firebase Auth | Google GIS と連携 |
| データ保存 | Firestore | projects / public_projects など |
| 画像保存（staging / prod） | Cloudflare R2 | Pages Function `/upload` 経由 |
| 画像保存（ローカル開発） | Firebase Storage | `npm run dev` 時のみ |
| 検証用ホスティング | Firebase Hosting | 併設。Cloudflare とは別系統の確認先 |

---

## 現在の環境一覧

### 1. Cloudflare Pages

| 環境 | URL | 用途 |
|------|-----|------|
| production | `https://dsf.ink` 想定 | 本番配信 |
| staging preview | `https://staging.dsf-studio.pages.dev/` | 日常のステージング確認用 |

Cloudflare Pages は **UI の配信面**。  
ただしアプリ内部では Firebase Auth / Firestore を利用するため、Pages だけで閉じたシステムではない。

### 2. Firebase

| 環境 | Project ID | 用途 |
|------|------------|------|
| production | `vmnn-26345` | 本番 Auth / Firestore / Storage 設定の基準 |
| staging | `vmnn-26345-stg` | ステージング Auth / Firestore |

### 3. Firebase Hosting

| 環境 | URL | 用途 |
|------|-----|------|
| staging hosting | `https://vmnn-26345-stg.web.app` | 追加の検証用 URL |

Firebase Hosting は、現時点では **Cloudflare Pages staging の代替ではなく、補助的な確認面** として扱う。

---

## ビルドごとの接続先

### `npm run dev`

- `.env.development` を使う
- Firebase project: **staging** (`vmnn-26345-stg`)
- Storage backend: **firebase**
- 用途: ローカルVite開発。R2 ではなく Firebase Storage を使う

### `npm run build:staging`

- `.env.staging` を使う
- Firebase project: **staging** (`vmnn-26345-stg`)
- Storage backend: **r2**
- 用途: Cloudflare Pages staging / preview 相当の成果物

### `npm run build`

- `.env.production` を使う
- Firebase project: **production** (`vmnn-26345`)
- Storage backend: **r2**
- 用途: 本番向け成果物

---

## デプロイコマンドの意味

### Cloudflare Pages

| コマンド | 反映先 |
|---------|--------|
| `npm run deploy:pages:staging` | `https://staging.dsf-studio.pages.dev/` |
| `npm run deploy:pages` | Cloudflare Pages production |

### Firebase

| コマンド | 反映先 |
|---------|--------|
| `npm run deploy:staging` | Firebase Hosting staging (`vmnn-26345-stg.web.app`) + rules |
| `npm run deploy:prod` | Firebase 側 production 反映 |

重要なのは、

- **`git push` はURLを更新しない**
- **`deploy:*` だけが実際の確認用URLを更新する**

という点。

---

## 運用ルール（現時点の推奨）

### 基本ルール

1. **日常確認のステージングは Cloudflare Pages を正とする**
   - 使うURL: `https://staging.dsf-studio.pages.dev/`

2. **Firebase Hosting staging は補助確認用**
   - 認証導線
   - Firestore / Rules 反映確認
   - Cloudflare 側と挙動差がないかの切り分け

3. **不具合確認時は必ず URL を添える**
   - 例: `staging.dsf-studio.pages.dev` なのか
   - 例: `vmnn-26345-stg.web.app` なのか

4. **ローカル `npm run dev` は staging Firebase を見る**
   - 本番データを直接触らない

### 実務上の解釈

- 「Cloudflare staging で確認」は、**UI配信面の確認**
- 「Firebase staging で確認」は、**ホスティング差分やルール反映の確認**

---

## この構成で問題があるか

**構成自体は問題ない。**  
問題になるのは、どのURLを「正式なステージング」と見なすかが曖昧な場合だけ。

現在は次の整理で運用するのが妥当:

- **Primary staging**: Cloudflare Pages
- **Secondary staging**: Firebase Hosting

---

## 関連ファイル

- `.env.development`
- `.env.staging`
- `.env.production`
- `wrangler.toml`
- `.firebaserc`
- `firebase.json`
- `js/firebase.js`
- `js/firebase-core.js`
- `functions/upload.js`

