# Channel & RBAC Plan

更新日: 2026-03-01  
ステータス: Draft v0.1

## 1. 目的

本ドキュメントは、DSF の `User` と `Channel` を分離し、複数人運用に耐えるロール管理（RBAC）を定義する。

目的は次の3点。

1. 作品の著者と配布主体（Channel）を分離する
2. 複数人・役割別で安全に運用できる権限制御を作る
3. 将来の課金・容量管理を Channel 単位で拡張可能にする

## 2. 用語定義

1. `User`: 個人アカウント
2. `Channel`: 配布主体（YouTubeのチャンネル相当）
3. `Membership`: User が Channel 内で持つロール情報
4. `Release`: 公開版（URL、公開状態、版情報）

## 3. 基本方針

1. User と Channel は独立エンティティ
2. User は複数 Channel に所属可能
3. Channel は複数 User をロール付きで管理可能
4. 権限判定は「User単体」ではなく「Membership」で行う

## 4. ロール定義

基本ロールは以下の5段階を採用する。

1. `owner`
2. `admin`
3. `publisher`
4. `editor`
5. `viewer`

## 5. 権限マトリクス（v1）

1. Channel設定変更: owner, admin
2. メンバー招待/削除: owner, admin
3. ロール変更: owner, admin（owner の付与/剥奪は owner のみ）
4. 公開操作（publish/archive）: owner, admin, publisher
5. 作品編集: owner, admin, publisher, editor
6. 閲覧のみ: viewer

## 6. Owner 運用ルール

Owner は事故耐性のため複数許可とする。

1. Owner は複数人を許可
2. 最後の Owner は降格/削除不可
3. Owner 不在状態を作らない
4. 個人運用時も backup として 2人目 Owner を推奨

## 7. Owner 移譲ルール（有料チャンネル）

有料チャンネルでは請求責任を明確化する。

1. 支払設定が有効な User のみ Owner 就任可
2. 移譲は `pending_owner` 状態で開始
3. 新Owner候補が支払設定完了後に移譲確定
4. 期限内に未完了なら移譲キャンセル
5. 請求切替タイミングは次回請求日

## 8. 招待フロー（v1）

1. admin/owner がメール招待を発行
2. 招待トークンに期限を設定（例: 7日）
3. 招待承認時に Membership を作成
4. 期限切れトークンは無効化

## 9. ユーザー管理画面（v1）

v1 のユーザー管理画面は最小機能に限定する。

1. 自分が所属するチャンネル一覧
2. 各チャンネルでの自分のロール表示
3. チャンネルの状態表示（active/suspended）

v1 で対象外:

1. 請求書/領収書表示
2. 未払いステータス詳細表示
3. 支払方法変更UI

## 10. 退会フロー（v1）

退会時はオーナー不在チャンネルを作らないことを必須条件とする。

1. User が退会要求
2. owner として所属するチャンネルを検査
3. 「最後の owner」状態のチャンネルが1つでもあれば退会拒否
4. owner 移譲完了後に再申請可能
5. 条件を満たした場合のみ退会確定

## 11. データモデル（草案）

### 9.1 channels

`channels/{channelId}`

主要フィールド:

1. `name`
2. `slug`
3. `status` (`active` | `suspended`)
4. `billingPlan` (`free` | `pro` | ...)
5. `createdAt`, `updatedAt`

### 9.2 channel members

`channels/{channelId}/members/{uid}`

主要フィールド:

1. `role`
2. `state` (`active` | `invited` | `removed`)
3. `invitedBy`
4. `joinedAt`

### 9.3 user channel refs

`users/{uid}/channelRefs/{channelId}`

主要フィールド:

1. `role`
2. `channelName`
3. `lastVisitedAt`

### 9.4 releases

`channels/{channelId}/releases/{releaseId}`

主要フィールド:

1. `projectId`
2. `status` (`draft` | `published` | `archived`)
3. `publishedUrl`
4. `publishedAt`, `updatedAt`
5. `locales`

## 12. Security Rules 方針

Rules は最小限を担保し、複雑判定は Functions に寄せる。

Rules で担保:

1. Membership がない User のアクセス拒否
2. role ごとの read/write 制限
3. release の publish 操作は publisher 以上に限定

Functions で担保:

1. Owner 最後の1人制約
2. Owner 移譲の状態遷移
3. 招待トークン発行/検証

## 13. 監査ログ方針（v2以降）

最低限、以下の操作は監査対象。

1. ロール変更
2. Owner 移譲
3. 公開/非公開操作
4. メンバー追加/削除

## 14. 未決事項

1. Owner を複数必須にするか（推奨のみか）
2. 招待リンク方式とメール方式の併用可否
3. ロール階層の固定化（カスタムロールを許可するか）
4. 監査ログの保持期間
