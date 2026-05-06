# Billing / Plan Architecture Proposal

**作成日**: 2026-05-06  
**ステータス**: 設計案。実装前に Architect 確認対象。  
**対象**: DSF Horizon / Studio の FREE / PLUS / PRO / BUSINESS と掲載期限・公開期限制御。

---

## 結論

プラン・課金の正本は次の分担にする。

| 領域 | 正本 | 理由 |
|------|------|------|
| 決済契約・請求状態 | Stripe | 支払い成功、失敗、解約、差額充当、期間終了は Stripe 側が最も正確 |
| アプリ内の実効プラン | `users/{uid}.plan` と `users/{uid}.entitlements` | Firestore rules / UI / 公開制御が高速に参照できる projection |
| 課金イベント処理 | サーバーサイド webhook / admin job | クライアントから `plan` を直接変更させない |
| 掲載・公開期限の実効状態 | `publication` metadata + backend reconciler | UI 表示だけでなく、期限到達時に自動で下書きへ戻す必要がある |

ユーザー操作は「プランを直接変更」ではなく、Checkout / Customer Portal / plan change request を開始するだけにする。実際の `plan` 更新は webhook または運営操作だけが行う。

---

## 設計原則

1. クライアントは `users/{uid}.plan` を直接変更できない。
2. Firestore の `plan` は決済プロバイダの同期済みキャッシュであり、課金の真実のソースではない。
3. 機能可否は `plan.tier` だけで判定せず、常に `status` / `currentPeriodEnd` / `entitlements` を含めて判定する。
4. 掲載期限と公開期限は作品 metadata に保持するが、期限切れ処理は backend reconciler が確定させる。
5. FREE へ戻った場合、掲載期限は「発行から14日」で再評価し、期限超過の `public` / `unlisted` は自動で `draft` に戻す。
6. 有料期間中の解約予約は、期間末までは有料 entitlement を維持する。
7. 支払い失敗は即時 FREE 相当に落とす。カード期限切れ等でも公開制御の実効状態は即時反映する。
8. アップグレードは支払い成功時のみ即時反映する。決済できなかった場合、既存プランを維持する。
9. 通常のダウングレード・解約は期間末反映とし、現金返金ではなく Stripe の proration / credit 充当を基本にする。

---

## プラン定義

| プラン | 掲載期限 | 公開期限予約 | 想定用途 |
|--------|----------|--------------|----------|
| FREE | 発行から最大14日 | 不可 | 試用、軽量公開 |
| PLUS | 無期限 | 不可 | 個人の常設公開 |
| PRO | 無期限 | 可 | 公開終了日時を管理したい作者 |
| BUSINESS | 無期限 | 可 | チーム・法人運用 |

`listedUntil` の無期限は UI 上の表現であり、システム値は `9999-12-31 23:59` 相当を使う。

---

## 正規状態モデル

### `plan.tier`

```text
free | plus | pro | business
```

`standard` や `enterprise` など旧名・別名は入力互換として受けても、保存時は `plus` / `business` に正規化する。

### `plan.status`

| status | 意味 | 実効有料扱い |
|--------|------|--------------|
| `active` | 支払い済み・契約期間内 | Yes |
| `trialing` | トライアル期間内 | Yes |
| `past_due` | 支払い失敗、カード期限切れ、追加認証未完了などで最新請求を回収できない | No |
| `canceled` | 契約終了済み | No |
| `unpaid` | Stripe のリトライ後も未払いで、以後の自動回収が停止した状態 | No |
| `incomplete` | Checkout 開始後、支払い未完了 | No |
| `incomplete_expired` | 初回支払いが完了せず期限切れ | No |

解約予約中は `status='active'` のまま `cancelAtPeriodEnd=true` とする。期間末を迎えたら `status='canceled'`、`tier='free'`、`effectiveTier='free'` へ落とす。

### 実効プラン

実効プランは保存してもよいが、必ず backend が計算する。

```text
effectiveTier =
  paid tier if status in active/trialing and period is valid
  otherwise free
```

Firestore rules と UI は原則として `effectiveTier` または `entitlements` を見る。`plan.tier` 単体では判定しない。

---

## 推奨 Firestore スキーマ

### `users/{uid}.plan`

アプリ内で参照する projection。

```json
{
  "tier": "free | plus | pro | business",
  "effectiveTier": "free | plus | pro | business",
  "status": "active | trialing | past_due | canceled | unpaid | incomplete | incomplete_expired",
  "provider": "none | stripe | manual",
  "cancelAtPeriodEnd": false,
  "trialEndsAt": "Timestamp | null",
  "currentPeriodStart": "Timestamp | null",
  "currentPeriodEnd": "Timestamp | null",
  "canceledAt": "Timestamp | null",
  "updatedAt": "Timestamp"
}
```

### `users/{uid}.billing`

決済プロバイダとの同期情報。クライアント更新不可。

```json
{
  "provider": "stripe | manual | none",
  "stripeCustomerId": "String | null",
  "stripeSubscriptionId": "String | null",
  "stripePriceId": "String | null",
  "stripeSubscriptionStatus": "String | null",
  "lastWebhookEventId": "String | null",
  "lastSyncedAt": "Timestamp | null"
}
```

### `users/{uid}.entitlements`

UI / rules / publication logic が参照する実効機能フラグ。

```json
{
  "canCreateProject": true,
  "canUsePremiumPaper": false,
  "canPublishPrivately": false,
  "canUseAdvancedAnalytics": false,
  "canManageLabel": false,
  "canUseUnlimitedListing": false,
  "canSchedulePublicExpiry": false
}
```

`canUseUnlimitedListing` は PLUS / PRO / BUSINESS の有効状態で true。  
`canSchedulePublicExpiry` は PRO / BUSINESS の有効状態で true。

### `billing_events/{eventId}`

Webhook / manual operation の冪等処理と監査用。

```json
{
  "provider": "stripe | manual",
  "eventId": "String",
  "eventType": "String",
  "uid": "String | null",
  "stripeCustomerId": "String | null",
  "stripeSubscriptionId": "String | null",
  "processedAt": "Timestamp",
  "status": "processed | ignored | failed",
  "error": "String | null"
}
```

### `users/{uid}/planChangeRequests/{requestId}`

決済連携前・運営手動処理・サポート用途として残す。Stripe 連携後の通常導線は Checkout / Customer Portal に置き換える。

---

## 状態遷移

### 新規登録

```text
Auth sign-in
  -> users/{uid}.plan = free / active / provider=none
  -> entitlements = FREE 相当
```

### 有料プラン開始

```text
My Page
  -> server creates Checkout Session
  -> payment succeeds
  -> webhook updates users/{uid}.plan and entitlements
  -> publication reconciler re-evaluates works
```

### アップグレード

アップグレードは支払い成功時のみ即時反映する。

```text
request upgrade
  -> Stripe subscription update with proration_behavior=always_invoice
  -> payment succeeds
  -> webhook updates effectiveTier and entitlements immediately
  -> publication reconciler
```

既に課金ユーザーの場合、未使用分は Stripe の proration credit として計算し、新プラン残期間分との差額に充当する。差額請求が発生する場合は即時決済する。決済できなければアップグレードを確定せず、既存プランを維持する。

### ダウングレード

原則として契約期間末に反映する。通常のダウングレードでは現金返金しない。未使用分の扱いは Stripe の credit / proration に寄せ、次回請求への充当を基本にする。

```text
request downgrade
  -> pendingChange = target tier
  -> currentPeriodEnd までは現行 entitlement
  -> period end webhook
  -> target tier へ反映
  -> publication reconciler
```

PLUS から FREE へ落ちる場合、発行から14日を超えた `public` / `unlisted` は `draft` に戻す。

### 解約

即時 FREE ではなく、契約期間末までは有料扱いにする。

```text
cancel
  -> plan.status remains active
  -> cancelAtPeriodEnd = true
  -> currentPeriodEnd までは有料 entitlement
  -> period end
  -> tier/effectiveTier = free
  -> status = canceled or active/free
  -> publication reconciler
```

FREE は支払い契約がない状態なので、最終的な通常形は `tier='free'`, `effectiveTier='free'`, `status='active'`, `provider='none'` でもよい。監査上の直近キャンセルは `billing` / `billing_events` に残す。

### 支払い失敗

支払い失敗は即時 FREE 相当へ反映する。ここでの支払い失敗は、登録カードの期限切れ、限度額超過、カード会社拒否、支払い方法未設定、3D セキュア等の追加認証未完了、初回決済未完了、Stripe の自動リトライ失敗などを含む。

```text
invoice payment failed
  -> status = past_due
  -> effectiveTier = free
  -> publication reconciler
```

`past_due` / `unpaid` / `canceled` / `incomplete_expired` は有料 entitlement を持たない。支払い方法を更新して Stripe 側で支払いが成功し、subscription が `active` に戻った場合のみ、webhook で有料 entitlement を復元する。

---

## 掲載期限・公開期限への影響

| 実効プラン | listedUntil | publicUntil |
|------------|-------------|-------------|
| FREE | `listedFrom + 14 days` | ユーザー予約不可。null |
| PLUS | `9999-12-31 23:59` | ユーザー予約不可。null |
| PRO | `9999-12-31 23:59` | `listedUntil` 以下で任意設定可 |
| BUSINESS | `9999-12-31 23:59` | `listedUntil` 以下で任意設定可 |

期限再評価は次のタイミングで実行する。

1. Press Room で DSF を発行した時。
2. Works で `public` / `unlisted` へ変更した時。
3. プラン変更 webhook を処理した時。
4. 日次または時間単位の scheduled job。
5. Works / Viewer / Portal 読み込み時の補助的な lazy reconciliation。

最終的な自動処理は backend が行う。クライアント読み込み時の補助処理だけに依存しない。

---

## My Page / Admin / Backend の責務

### My Page

- 現在のプラン、実効プラン、請求状態、期間終了日、解約予約状態を表示する。
- PLUS / PRO / BUSINESS への変更は Checkout を開始する。
- 解約・支払い方法変更は Customer Portal を開く。
- 決済連携前は `planChangeRequests` を作成する暫定導線でよい。
- `users/{uid}.plan` を直接 update しない。

### Admin

- ユーザーの `plan` / `billing` / `entitlements` / `planChangeRequests` を確認できる。
- manual plan grant / revoke ができる。
- 操作は `admin_audit_logs` または `billing_events` に記録する。
- 支払い失敗・webhook 失敗・reconciler 失敗を確認できる。

### Backend

- Checkout Session 作成。
- Customer Portal Session 作成。
- Webhook 受信と冪等処理。
- `users/{uid}.plan` / `billing` / `entitlements` 更新。
- プラン変更後の作品 publication 再評価。
- scheduled expiry job。

実装場所は Firebase Cloud Functions / Cloud Run / Cloudflare Workers のいずれでもよいが、Firestore privileged update と scheduled job を扱うため、初期実装は Firebase Cloud Functions が最も単純。

---

## Security Rules 方針

1. `users/{uid}.plan` / `billing` / `entitlements` は owner read 可、owner write 不可。
2. `planChangeRequests` は owner create/read 可、staff update/delete 可。
3. `public_projects` の create/update は当面クライアント許可を維持してもよいが、`entitlements` または backend projection で厳密に検証する。
4. 将来的には `public_projects` 更新も backend 経由へ寄せる。
5. `billing_events` は staff read、backend write、client write 不可。

---

## 現状との差分

### 既に実装済み

- `users/{uid}.plan.tier/status/provider/currentPeriodEnd/cancelAtPeriodEnd` の土台。
- FREE / PLUS / PRO / BUSINESS の tier 正規化。
- FREE は掲載期限最大14日、PLUS/PRO/BUSINESS は無期限相当。
- PRO/BUSINESS のみ `publicUntil` 設定可能という publication logic。
- `publication.planSnapshot` の保存。
- `public_projects` rules で plan と publication の最低限検証。
- Works 読み込み時の lazy reconciliation。
- My Page のプラン表示と `planChangeRequests` 作成。
- Admin でユーザー状態・プラン土台を扱う前提。

### 不足している点

| 項目 | 現状 | 目標 |
|------|------|------|
| 決済 source of truth | なし。Firestore の `plan` が実質正本 | Stripe を正本、Firestore は projection |
| `effectiveTier` | `publication.js` が都度計算 | backend が `plan.effectiveTier` と `entitlements` を更新 |
| 支払い失敗の即時反映 | 未実装 | `past_due` / `unpaid` / `canceled` / `incomplete_expired` で即時 FREE entitlement へ落とす |
| 解約予約 | `cancelAtPeriodEnd` はあるが UI/処理が薄い | 期間末まで有料、期間末で FREE へ reconcile |
| ダウングレード予約 | 未実装 | `pendingChange` または provider schedule を導入 |
| アップグレード課金 | 未実装 | Stripe proration + immediate invoice。支払い成功時のみ即時反映 |
| Checkout / Portal | 未実装 | My Page から backend 経由で開始 |
| Webhook | 未実装 | provider event を冪等処理 |
| billing audit | 未実装 | `billing_events` と admin audit に記録 |
| scheduled expiry | 未実装 | backend job で期限切れを自動 draft 化 |
| publication enforcement | Client lazy reconcile + rules | backend reconciler を正本にする |
| public_projects update | クライアント主導 | 将来的に backend 主導へ寄せる |

---

## 実装順

### Phase 1: スキーマ正規化

- `users/{uid}.plan.effectiveTier` を追加。
- `users/{uid}.billing` を追加。
- `entitlements.canUseUnlimitedListing` / `canSchedulePublicExpiry` を追加。
- `publication.js` の判定を `effectiveTier` / `entitlements` 優先へ変更。
- Firestore rules を新フィールドに合わせる。

### Phase 2: Backend 土台

- Checkout Session 作成 endpoint。
- Customer Portal Session 作成 endpoint。
- Webhook endpoint。
- `billing_events` への冪等記録。
- manual provider 用の admin operation。

### Phase 3: My Page 接続

- プラン変更リクエストの通常導線を Checkout / Portal に置き換える。
- `planChangeRequests` は決済連携前・サポート用に残す。
- 支払い失敗、解約予約、期間終了日、次回変更予定、アップグレード差額請求の結果を表示する。

### Phase 4: Publication Reconciler

- プラン変更時に対象ユーザーの projects / works / public_projects を再評価。
- scheduled job で期限切れ作品を `draft` へ戻す。
- 処理結果を audit log に残す。

### Phase 5: テストと運用

- Firestore rules test を plan status / entitlement ごとに追加。
- Webhook 冪等性テストを追加。
- FREE ダウングレード時の自動 draft 化を E2E smoke に追加。
- Admin から billing state を確認できるようにする。

---

## 決定済み事項と未確定事項

### 決定済み

1. 決済プロバイダは Stripe 前提で確定。
2. 支払い失敗時の猶予期間は設けない。即時 FREE 相当へ反映する。
3. アップグレードは支払い成功時のみ即時反映する。
4. 既存課金ユーザーのアップグレードは Stripe proration / credit により未使用分を差額へ充当する。
5. 通常のダウングレード・解約は期間末反映を基本にする。
6. 通常の現金返金は行わず、Stripe の credit / proration 充当を基本にする。

### 未確定

1. BUSINESS を個人アカウントの上位 tier として扱うか、将来 organization / team モデルへ分けるか。
2. `public_projects` 更新をどの段階で backend 主導へ移すか。
