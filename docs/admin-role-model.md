# Admin / Operator / Moderator 権限モデル

最終更新: 2026-04-25

## 目的

DSF の運営管理画面、レビュー投稿、公開作品のモデレーションを支えるための
**最小の権限モデル**を定義する。

この文書は UI 仕様ではなく、**権限と正本の責務分離**を決めるための設計文書。

---

## 1. 原則

### 1.1 一般ユーザーの正本

一般ユーザーのアプリ正本は `users/{uid}`。

- `displayName`
- `photoURL`
- `email`
- `handle`
- `storage.*`
- `createdAt`
- `lastLoginAt`

を保持する。

### 1.2 昇格権限は self-write させない

`admin` / `operator` / `moderator` は、将来的に運営権限を持つため、
**ユーザー自身が Firestore へ直接書ける形にしてはならない**。

したがって、

- `users/{uid}.roles.admin`
- `users/{uid}.roles.operator`
- `users/{uid}.roles.moderator`
- `users/{uid}.status.disabled`
- `users/{uid}.status.moderationHold`

は **運営側か server-side 処理のみが変更可能** とする。

### 1.3 権限判定の正本

昇格権限の**判定正本**は Firebase Auth の **custom claims** を基本とする。

Firestore の `users/{uid}` 内 `roles.*` は:

- UI 表示
- 検索
- 監査
- 管理画面の一覧表示

のための**ミラー情報**として保持する。

つまり、

- **権限の効力** → custom claims
- **権限の可視化** → Firestore

の分担にする。

---

## 2. ロール定義

### 2.1 reader

すべてのログインユーザー。

できること:
- 作品閲覧
- 自分のプロフィール表示
- 将来的なレビュー投稿

### 2.2 creator

Studio を使って制作するユーザー。初期値 `true`。

できること:
- `users/{uid}/projects/{pid}` の作成・編集・削除
- Press / Works での発行
- 自分の公開作品管理

### 2.3 moderator

コミュニティ投稿物の審査担当。レビューや公開作品の可視性制御を担当。

できること:
- レビューの非表示 / 削除
- 公開作品の一時停止
- `moderationHold` の付与

できないこと:
- 他人のアカウントに admin/operator を付与
- 課金やシステム設定の変更

### 2.4 operator

運営実務担当。主にアカウント・作品・公開状態の運用を担う。

できること:
- ユーザー一覧閲覧
- 公開作品一覧閲覧
- 作品公開状態の変更
- `disabled` / `moderationHold` の付与解除
- レーベル / シリーズ / 将来の運営マスタ管理

できないこと:
- 他人へ admin を付与
- セキュリティ設定の最終変更

### 2.5 admin

最上位の運営権限。

できること:
- operator / moderator の付与・剥奪
- 運営画面全体アクセス
- 将来の billing / abuse / registry 管理
- システム設定変更

---

## 3. 推奨データモデル

### 3.1 Firebase Auth custom claims

```json
{
  "dsfRoles": {
    "admin": true,
    "operator": false,
    "moderator": false
  }
}
```

補足:
- `reader` / `creator` は初期状態で全員に付与されるため、claims に持たせなくてもよい
- claims は昇格権限だけを持つ方が安全

### 3.2 Firestore `users/{uid}` ミラー

```json
{
  "roles": {
    "reader": true,
    "creator": true,
    "admin": false,
    "operator": false,
    "moderator": false
  },
  "status": {
    "disabled": false,
    "moderationHold": false
  }
}
```

---

## 4. self-write 可能な項目と禁止項目

### 4.1 self-write 可能

ユーザー本人が変更できる項目:

- `displayName`
- `photoURL`
- `handle`
- 将来的な `bio`
- `lastLoginAt`（クライアント更新可でもよいが、server-side 寄せが望ましい）

### 4.2 self-write 禁止

ユーザー本人が変更してはならない項目:

- `roles.admin`
- `roles.operator`
- `roles.moderator`
- `status.disabled`
- `status.moderationHold`
- `storage.authoringRoot`
- `storage.publishRoot`
- `createdAt`

---

## 5. Firestore Rules の次段階

現在 staging では `users/{uid}` を self read/write にしているが、
これは bootstrap を通すための最小形。

レビューや運営画面に進む前に、次段階として以下へ移行する。

### 5.1 推奨ルール方針

- 本人はプロフィール系だけ更新可能
- `roles.*` と `status.*` は本人更新不可
- admin / operator / moderator は custom claims で例外許可

例:

```text
users/{uid}
  self read: allowed
  self update: limited field set only
  admin/operator read: allowed
  admin update: allowed
```

---

## 6. 運営管理画面の最小スコープ

最初の運営管理画面は以下で十分。

### 6.1 Users

- ユーザー一覧
- 表示名 / email / uid
- role 表示
- status 表示
- `disabled` / `moderationHold` 切替

### 6.2 Works

- `public_projects` 一覧
- author / updatedAt / status
- 非公開化 / 一時停止

### 6.3 Reviews

- 作品別レビュー一覧
- 通報状態
- 非表示 / 削除

---

## 7. 実装順

1. `users/{uid}` bootstrap を導入
2. custom claims を前提にした role モデルを確定
3. Firestore Rules を self-write 制限付きへ改訂
4. 運営管理画面の最小 UI を実装
5. その後にレビュー投稿システム

---

## 8. 今回の判断

現段階では以下を採用する。

- 一般ユーザーの正本は `users/{uid}`
- 昇格権限の正本は custom claims
- Firestore の `roles.*` はミラー
- `admin` / `operator` / `moderator` を採用
- レビュー投稿より先に、この権限モデルを固定する
