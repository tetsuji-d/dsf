# Library / Viewer / Studio — ログインの一貫性（YouTube 的 UX の前提）

## いまコード上で共有しているもの

- **単一の Firebase アプリ** — `js/firebase-core.js` の `initializeApp(firebaseConfig)` が 1 回だけ走り、`auth` / `db` / `storage` がシングルトン。
- **同一の `auth` インスタンス** — Library（`portal.js`）、Studio（`app.js`）、Viewer（`viewer.js`）はすべて `firebase.js` 経由または `gis-auth.js` のデフォルトで、この **`auth`** を使う（Studio/Viewer のブートでは `initGIS({ authInstance: auth })` を明示）。
- **GIS + Firebase** — `gis-auth.js` が Google Identity Services と Firebase Auth を橋渡し。Library / Studio / Viewer は同じ `VITE_GOOGLE_CLIENT_ID` と `VITE_FIREBASE_*` に依存。

このため、**同一オリジン**（下記）であれば、**どこでログインしても同じ Firebase セッション**が効く設計になる。

## ブラウザがセッションを共有する条件（重要）

Firebase Auth の永続化は **オリジン単位**（スキーム + ホスト + ポート）。

| デプロイ例 | セッション共有 |
|------------|----------------|
| `https://example.pages.dev/`（Library）と `https://example.pages.dev/viewer`（Viewer）と `https://example.pages.dev/studio.html`（Studio） | **共有される**（パス違いは同一オリジン） |
| `https://library.example.com` と `https://studio.example.com` | **既定では共有されない**（別オリジン） |

YouTube のように「別サブドメインでも一本化」するには、**Firebase Console → Authentication → 設定 → 承認済みドメイン**に全ホストを入れることに加え、**Auth の cookie をサブドメイン間で共有する構成**（カスタムドメイン、`authDomain` の設計、必要なら Hosting のリライト）を別途決める必要がある。

## 画面ごとの UI 差（体験の一貫性）

| Surface | 未ログイン時の UI |
|---------|-------------------|
| **Library** (`portal.js`) | GIS 公式ボタン + SVG フォールバック + テーマ |
| **Studio** (`app.js`) | ナビ/モバイル 2 スロットに GIS + フォールバック +（ステージングのみ）メール |
| **Viewer** (`viewer.js`) | 未ログイン時: GIS 公式ボタン + Google アイコン付きフォールバック（Portal と同型、`renderViewerAuthSlot`）。ログイン後: サインアウトのみ。 |

## 運用チェックリスト

1. **ビルド環境** — `npm run dev` / `build:staging` / `build` で **同じ Firebase プロジェクトを指しているか**（`.env.*`）。
2. **承認済みドメイン** — 本番・ステージング・プレビュー用の `*.pages.dev` やカスタムドメインを Firebase に登録。
3. **Google Cloud OAuth** — クライアント ID の「承認済みの JavaScript 生成元」に、上記と同じオリジンを列挙。

## 関連

- Studio 内の room / 認証の地図: [studio-app-room-boundaries.md](./studio-app-room-boundaries.md)
- GIS 実装: `js/gis-auth.js`
