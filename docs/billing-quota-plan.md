# Billing & Quota Plan

更新日: 2026-03-01  
ステータス: Draft v0.1

## 1. 目的

本ドキュメントは、DSF の課金・容量制限を `Channel` 単位で管理する設計方針を定義する。

目的は次の3点。

1. 課金責任を明確化する
2. ストレージ乱用を防止する
3. 将来のプラン拡張に耐える

## 2. 基本方針

1. 課金単位は `Channel`（ユーザー単位ではない）
2. 容量上限も `Channel` 単位で評価する
3. 支払い責任者は Channel の `owner`
4. 有料 Channel の Owner には支払設定必須

## 3. v1 スコープ制約（確定）

v1 は運用難易度を下げるため free-only で開始する。

1. v1 は無料チャンネルのみ提供
2. 有料プラン・請求・領収書・未払い管理は v2 以降
3. 投げ銭入金先など決済連携は v2 以降
4. 本ドキュメント内の有料設計は将来仕様として保持

## 4. 課金モデル（将来）

### 3.1 プラン

1. `free`
2. `pro`（将来拡張可）

### 3.2 課金対象

1. ベースプラン料金（Channel単位）
2. 追加シート料金（必要な場合）
3. 追加容量料金（必要な場合）

## 5. 容量モデル（v1）

### 4.1 主要パラメータ

1. `baseStorageBytes`（プラン固定）
2. `seatCount`（課金対象ユーザー数）
3. `storagePerSeatBytes`（1シートあたり追加容量）

### 4.2 計算式

1. `quotaBytes = baseStorageBytes + seatCount * storagePerSeatBytes`
2. `usedBytes` は Channel 内全アセット合計

### 4.3 超過時挙動

1. 読み取りは許可
2. 新規アップロードと公開操作を制限
3. 管理画面に超過警告を表示

## 6. 無料チャンネル乱用対策

複数無料チャンネルによる実質無制限利用を防ぐため、次の制約を導入する。

1. 無料チャンネル作成上限は 3
2. 有料チャンネル1つごとに無料上限 +1
3. 計算式: `freeLimit = 3 + paidOwnedCount`
4. 判定対象は「owner として所有するチャンネル数」

## 7. 作成可否ルール

無料チャンネル作成時の判定:

1. `freeOwnedCount < freeLimit` なら作成可
2. それ以外は作成不可（有料化を案内）

有料チャンネル作成時の判定:

1. 支払設定が有効なら作成可
2. 無効なら作成不可（支払設定画面へ誘導）

## 8. 支払責任と Owner 移譲（将来）

### 7.1 原則

1. 有料チャンネルの Owner は請求責任者
2. 支払設定なしの User は有料 Channel の Owner になれない

### 7.2 移譲フロー

1. `pending_owner` を設定
2. 新 Owner 候補が支払設定を完了
3. 次回請求日から請求先を切替
4. 期限切れ時は移譲キャンセル

## 9. システム実装責務

### 8.1 Firestore Rules で担保

1. 書き込み権限（role 判定）
2. 一般的な read/write 制限

### 8.2 Cloud Functions で担保

1. 無料チャンネル作成上限判定
2. 課金状態確認
3. Owner 移譲の状態遷移
4. `usedBytes` 集計更新

重要: 課金・上限判定は必ずサーバー側で実施する。

## 10. 監視とアラート

1. 80% 到達で warning 通知
2. 100% 到達で write 制限通知
3. 決済失敗時は owner/admin に通知
4. 一定期間未解決ならチャンネル制限レベルを段階的に強化

## 11. データモデル草案

### 10.1 channels

`channels/{channelId}`

主要フィールド:

1. `plan` (`free` | `pro`)
2. `billingOwnerUid`
3. `quotaBytes`
4. `usedBytes`
5. `seatCount`
6. `billingStatus` (`active` | `past_due` | `suspended`)
7. `nextBillingAt`

### 10.2 billing events

`channels/{channelId}/billingEvents/{eventId}`

主要フィールド:

1. `type`（invoice_paid / invoice_failed / plan_changed 等）
2. `amount`
3. `currency`
4. `occurredAt`
5. `meta`

## 12. 段階導入

フェーズ1:

1. Channel 単位の `quotaBytes/usedBytes` 導入
2. 超過時アップロード停止

フェーズ2:

1. 無料チャンネル上限ロジック導入
2. 有料チャンネル作成導線導入

フェーズ3:

1. Owner 移譲と請求切替の完全自動化
2. 詳細課金ダッシュボード

## 13. 未決事項

1. seat の定義（active member 全員か、特定ロールのみか）
2. 公開操作を超過時に禁止するか（v1で有効化するか）
3. 決済失敗時の猶予期間
4. 通貨・税処理の方針
