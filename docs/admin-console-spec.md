# Admin Console Minimal Spec

最終更新: 2026-04-26

## 目的

DSF の運営側が最低限必要とする管理機能を、
実装可能な粒度まで落とした最小仕様。

この段階では「全部入りの CMS」は目指さない。
優先するのは次の 3 つ。

1. ユーザー制御
2. 公開作品制御
3. 将来のレビュー管理の受け皿

---

## 1. 入口

- ルート候補: `/admin/`
- 表示条件:
  - Firebase Auth ログイン済み
  - custom claims で `admin` または `operator` または `moderator` を持つ
- 非権限ユーザー:
  - ルート自体へ入れない
  - 403 相当の簡潔な画面を表示

---

## 2. 想定ロール別の操作範囲

### 2.1 moderator

できること:
- 公開作品の確認
- 将来のレビュー非表示
- moderation hold の確認

できないこと:
- admin/operator 付与
- 課金状態変更
- アカウント停止

### 2.2 operator

できること:
- ユーザー検索
- `status.disabled` / `status.moderationHold` の切替
- 公開作品の非公開化
- plan / entitlements の手動補正

できないこと:
- admin 付与

### 2.3 admin

できること:
- operator / moderator の付与・剥奪
- 全ユーザー状態変更
- 全作品状態変更
- 将来の課金同期障害の手動復旧

---

## 3. 画面構成

最初は 3 画面で十分。

### 3.1 Users

用途:
- ユーザー一覧と状態管理

一覧列:
- displayName
- email
- uid
- roles
- plan.tier
- plan.status
- status.disabled
- status.moderationHold
- lastLoginAt

操作:
- disabled 切替
- moderationHold 切替
- plan/entitlements 補正
- operator / moderator 付与（admin のみ）

### 3.2 Works

用途:
- 公開作品の確認と非公開化

一覧列:
- title
- labelName
- authorUid
- authorName
- dsfStatus
- updatedAt / publishedAt

操作:
- 非公開化
- 一時停止
- 作者プロフィールへ移動

### 3.3 Reviews

この段階では先行で枠だけ定義する。

一覧列:
- workId
- reviewerUid
- createdAt
- flagged
- visibility

操作:
- 非表示
- 削除

---

## 4. データ依存

### 4.1 Users

依存先:
- `users/{uid}`
- custom claims

### 4.2 Works

依存先:
- `public_projects/{pid}`
- 必要なら `users/{uid}/projects/{pid}` の参照

### 4.3 Reviews

将来追加:
- `reviews/{rid}` あるいは `projects/{pid}/reviews/{rid}`

---

## 5. UI 方針

- PC 優先
- Studio とは分離された運営用レイアウト
- モバイル最適化は初期段階では優先しない
- テーブル + 詳細パネルの構成で十分

推奨レイアウト:
- 左: セクションナビ
- 中央: 一覧
- 右: 詳細 / 操作パネル

---

## 6. 実装順

1. route ガード
2. Users 一覧
3. Users の disabled / moderationHold 切替
4. Works 一覧
5. Works の非公開化
6. admin 専用の role 付与 UI
7. Reviews 管理

---

## 7. 今回の結論

最初の運営管理画面は、

- **Users**
- **Works**
- **Reviews（枠のみ）**

の 3 セクションで始める。

課金・権限・モデレーションは混ぜず、

- role
- plan
- entitlements
- status

を分離して扱う。
