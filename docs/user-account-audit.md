# User Account Audit

最終更新: 2026-04-25

## 結論

- 認証の正規導線は **Google アカウントのみ**
- 現状の DSF は **Firebase Auth UID をキーにした所有権管理** はある
- ただし **ユーザーアカウントの Firestore 正本** はまだ無い
- 初回登録時の「保存領域確保」は、R2 に物理フォルダを作る話ではなく、
  **`users/{uid}` のブートストラップ作成** と **以後使う namespace の確定** として実装するのが正しい
- レビュー、レーベル運営、運営管理画面は、このブートストラップの上に乗せるべき

---

## 1. 現在あるもの

### 1.1 認証

- 実装本体: [js/gis-auth.js](../js/gis-auth.js)
- Surface:
  - Studio: [js/app.js](../js/app.js)
  - Viewer: [js/viewer.js](../js/viewer.js)
  - Portal: [js/portal.js](../js/portal.js)

現状の認証方式:

- Google Identity Services + Firebase Auth
- `signInWithPopup` / `signInWithRedirect` のフォールバックあり
- `browserLocalPersistence` でセッション保持

### 1.2 所有権管理

Firestore / R2 の所有権キーは `uid`。

- プロジェクト: `users/{uid}/projects/{pid}`
- 画像保存: `users/{uid}/dsf/**`
- R2 upload 制御: [functions/upload.js](../functions/upload.js)
- asset proxy 制御: [functions/asset-proxy.js](../functions/asset-proxy.js)

### 1.3 作品公開面

- 公開インデックス: `public_projects/{pid}`
- 作品 owner の公開情報は現在ここに埋め込み
  - `authorUid`
  - `authorName`

生成箇所:
- [js/works.js](../js/works.js)

---

## 2. 現在ないもの

### 2.1 ユーザープロファイル正本

現状、以下は **Firebase Auth の `user` オブジェクト頼り**。

- 表示名
- アイコン
- email

つまり、アプリ独自の正本である

- `users/{uid}` ドキュメント

がまだ存在しない。

### 2.2 初回登録時のブートストラップ

現状はサインイン後に即 `uid` を使っているだけで、

- ユーザー初期化
- 利用開始日時
- role 初期値
- 保存領域メタデータ
- moderation 状態

を作る処理がない。

### 2.3 運営管理用の権限モデル

現状コード上に admin 専用モデルは無い。

不足しているもの:

- admin / operator / moderator の role
- 運営画面の入口
- Firestore rules / Functions 側の権限制御

---

## 3. ステージングの Email/Password 認証

2026-04-25 時点で、Studio staging 専用だった Email/Password UI 導線はコードから削除した。

削除内容:

- [js/email-auth.js](../js/email-auth.js) を削除
- [js/app.js](../js/app.js) の email/password フォームを削除

残作業:

- Firebase Console の staging project で **Email/Password provider を無効化**

これはコードではなく運用作業。

---

## 4. 初回登録時の「保存領域確保」の考え方

R2 / Firebase Storage の「フォルダ」は実体ディレクトリではなく prefix。
したがって、先に空フォルダを作る必要はない。

必要なのは次の 2 つ。

1. **Firestore にユーザーの正本を作る**
2. **以後使う保存 namespace を固定する**

### 推奨

#### `users/{uid}`

```json
{
  "uid": "string",
  "authProvider": "google",
  "displayName": "string",
  "photoURL": "string",
  "email": "string",
  "handle": "string|null",
  "roles": {
    "reader": true,
    "creator": true,
    "admin": false
  },
  "storage": {
    "authoringRoot": "users/{uid}/dsp/",
    "publishRoot": "users/{uid}/dsf/",
    "initialized": true
  },
  "status": {
    "disabled": false,
    "moderationHold": false
  },
  "createdAt": "serverTimestamp",
  "lastLoginAt": "serverTimestamp"
}
```

### 補足

- DSP 編集データ自体は引き続き `users/{uid}/projects/{pid}` でよい
- ただし `users/{uid}` ができることで、
  - プロフィール
  - role
  - 運営制御
  - レビュー投稿者情報
  - レーベル運営権
  を一元化できる

---

## 5. 今後の保存面の整理案

### 現在

- 編集中プロジェクト: Firestore `users/{uid}/projects/{pid}`
- 素材 / authoring image: `users/{uid}/dsf/...`
- 発行画像: `users/{uid}/dsf/{projectId}/{renderStamp}/{lang}/page_###.webp`

### 整理案

将来的には prefix を分けた方がよい。

- `users/{uid}/dsp/`  
  編集素材、cover、structure、thumb など authoring 用
- `users/{uid}/dsf/`  
  発行済み配信用アセット

今すぐ必須ではないが、ユーザーブートストラップ時に
`storage.authoringRoot` と `storage.publishRoot` を持たせておくと移行しやすい。

---

## 6. レビュー投稿を始める前に必要な最低限

レビューより先に必要なのは:

1. `users/{uid}` の導入
2. public profile に使う表示名 / icon の正本化
3. role の初期設計
4. disabled / moderation hold の導入

理由:

- 投稿者識別
- 投稿制限
- 通報 / 凍結
- レビュー表示時の名前解決

---

## 7. 運営管理画面の前提

運営管理画面を作るなら、最低限必要なのは:

- `users/{uid}.roles.admin`
- できれば custom claims か server-side check
- 管理対象:
  - users
  - public_projects
  - reviews
  - labels

現状の Firestore rules は owner/public 前提なので、
admin 例外ルールはまだ入っていない。

つまり、管理画面は **UI より先に権限モデル設計** が必要。

---

## 8. 推奨実装順

1. **Google-only 認証へ固定**
   - コード導線削除
   - staging Firebase Console で Email/Password 無効化

2. **ユーザーブートストラップ**
   - `users/{uid}` 作成 / 更新
   - `createdAt`, `lastLoginAt`, `roles`, `storage.*`

3. **Firestore rules 更新**
   - `users/{uid}` 自己参照
   - admin 余地の追加

4. **運営管理画面の最小仕様**
   - users 一覧
   - project / public_projects の可視化

5. **レビュー設計**
   - 作品単位
   - 1 user 1 review か複数可か

---

## 9. 今回の判断

今回の判断としては、

- Email/Password staging 認証は廃止
- 認証方式は Google のみに一本化
- 次に実装すべきはレビューではなく **ユーザーブートストラップ**

が妥当。
