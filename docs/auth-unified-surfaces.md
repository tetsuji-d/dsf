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
| **Studio** (`app.js`) | ナビ/モバイル 2 スロットに GIS + フォールバック |
| **Viewer** (`viewer.js`) | 未ログイン時: GIS 公式ボタン + Google アイコン付きフォールバック（Portal と同型、`renderViewerAuthSlot`）。ログイン後: サインアウトのみ。 |

## 運用チェックリスト

1. **ビルド環境** — `npm run dev` / `build:staging` / `build` で **同じ Firebase プロジェクトを指しているか**（`.env.*`）。
2. **承認済みドメイン** — 本番・ステージング・プレビュー用の `*.pages.dev` やカスタムドメインを Firebase に登録。
3. **Google Cloud OAuth** — クライアント ID の「承認済みの JavaScript 生成元」に、上記と同じオリジンを列挙。

## 複数タブでの保存状態維持

`firebase-core.js` は `initializeAuth` の初期設定で `browserLocalPersistence` を指定する。
`getAuth()` の後で `setPersistence()` を呼ぶ方式に戻さないこと。Firebase SDK 10.7.1 では、
既存の localStorage の認証情報が既定の IndexedDB へ移され、再び localStorage へ戻る。
その間の認証情報削除を既存タブが検知すると、一時的に未ログインになり、Studio の保存証拠と
private authoring session が失効する。起動時から保存先を固定してこの移動を避ける。

`authReady` は `auth.authStateReady()`。既存の Google 認証経路を維持するため、
`browserPopupRedirectResolver` も明示する。実際のログアウト・アカウント変更による失効と、
古いセッションの保存応答を拒否する処理は維持する。
[Firebase: Auth dependencies](https://firebase.google.com/docs/auth/web/custom-dependencies)

### ローカル回帰検証

リポジトリ直下から別々のターミナルで実行する。実アカウント・原稿は使用しない。

```sh
npx firebase emulators:start --only auth --project demo-dsf-auth --config scripts/fixtures/auth-persistence-emulator.json
node scripts/serve-auth-persistence-fixture.mjs
```

1. `http://127.0.0.1:8798/?mode=fixed` を開き、「試験ユーザーA」「保存済みセッションを準備」を押す。
2. 同じ URL を別タブで開く。元タブの「保持状態を検査」が PASS になることを確認する。
3. 別タブを再読込し、元タブで再び PASS を確認する。認証保存先の削除・epoch 変更がないこと。
4. 元タブの「遅延した保存応答を検査」を押し、5 秒以内に別タブで「試験ユーザーB」を押す。
   古いセッションの保存応答が拒否され、保存済みにならないことを確認する。
5. B の保存済みセッションを準備し、同じ手順で別タブの「ログアウト」を検証する。
6. 全検証タブを閉じて `?mode=legacy` で 1〜2 を行う。旧初期化では `storage-removed` が記録され、
   保持検査が FAIL になる。環境やタイミングによって未ログイン通知まで発生するかは異なる。

この fixture は実 SDK と DSF の認証・保存証拠処理を使うが、クラウド保存応答はローカルの模擬応答。
ステージング反映後は Studio の実保存、同一オリジンの Portal 別タブ起動・再読込、再保存まで別途確認する。
古い版のタブが残ると旧初期化が実行されるため、反映後は DSF の各タブを新しい版へ再読込する。

## 関連

- Studio 内の room / 認証の地図: [studio-app-room-boundaries.md](./studio-app-room-boundaries.md)
- GIS 実装: `js/gis-auth.js`
