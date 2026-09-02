# Data Model Documentation

**最終更新**: 2026-08-23
**ステータス**: Architect 管理下（変更には Architect 承認が必要）

> **2026-08-23 9A-0承認方針**: 既存WebP-only DSF v1の後方互換を維持しつつ、グラフィックはWebP、
> テキスト中心ページは組版済み固定テキストで配信できるDSF delivery v2を段階実装する。
> `bodyKind:'text'`等のFixed authoring dataは廃止しない。Viewerは固定テキストをDOM文字として描画するが、
> 再組版、端末幅リフロー、読者向け本文文字サイズ変更は行わない。WebGL / Three.jsは使用しない。
> 詳細は`docs/fixed-text-delivery-contract.md`を参照。現行runtimeはまだv1 WebP-onlyである。

---

## Firestore コレクション構成

### コレクション一覧

| コレクション | パス | 用途 |
|------------|------|------|
| ユーザー正本 | `users/{uid}` | DSF アカウントの正本。Google 初回ログイン時にブートストラップ |
| ユーザープロジェクト | `users/{uid}/projects/{pid}` | 編集可能なプロジェクト本体 |
| プロジェクト一覧サマリー | `users/{uid}/project_summaries/{pid}` | Dashboard用のowner専用軽量投影。authoring本文やページ配列を含めない |
| 作品正本 | `users/{uid}/works/{workId}` | 読者に対して継続する作品IDと最新発行情報 |
| 発行履歴 | `users/{uid}/works/{workId}/releases/{releaseId}` | 発行ごとの DSF メタデータ |
| 読者しおり | `users/{uid}/bookmarks/{workId}` | 読者ごとの閲覧位置 |
| プラン変更リクエスト | `users/{uid}/planChangeRequests/{requestId}` | ユーザーのプラン変更・解約リクエスト |
| 課金イベント | `billing_events/{eventId}` | Stripe webhook / manual billing operation の冪等処理と監査 |
| 公開作品インデックス | `public_projects/{workId}` | ポータル表示と `workId` URL 解決用インデックス |
| 指標イベント | `metric_events/{eventId}` | Viewer から送信される append-only の閲覧イベント |
| レビュー | `reviews/{workId}/items/{reviewId}` | 作品ごとの読者レビュー |
| レビューリアクション | `reviews/{workId}/items/{reviewId}/reactions/{uid}` | レビューへの good / bad 反応 |
| 運営監査ログ | `admin_audit_logs/{logId}` | custom claims 付与・剥奪などの運営操作監査 |

> **注意**: 旧仕様のトップレベル `works` コレクションは廃止済み。現在の作品正本は `users/{uid}/works/{workId}`。

---

## Project / Work / Release の責務

DSF の公開系IDは、名前や作者名ではなく不変IDで解決する。

| 概念 | ID | 用途 | 可変性 |
|------|----|------|--------|
| Project | `projectId` | Studio で編集する制作単位 | タイトル・説明・内部名は可変 |
| Work | `workId` | 読者に対して継続する作品本体。公開URLの正本 | 不変 |
| Release | `releaseId` | ある時点の発行物。DSF ページ群、画質、言語、発行時刻を持つ | 発行ごとに新規 |

### 採番方針

- `projectId`: 既存どおりクラウド保存時に未採番なら `proj_*` を採番
- `workId`: 新規プロジェクト作成時、または既存データの初回保存時に未採番なら `work_*` を採番
- `releaseId`: Press Room で Horizon 発行するたびに `rel_*` を採番

既存データに `workId` がない場合は、読み込み時に互換フォールバックとして `projectId` を参照する。ただし保存後は `workId` を持つ形へ寄せる。

### URL 解決

公開URLの正本は `workId` とする。

```text
/viewer.html?work=work_abc123
```

互換URLとして `projectId` と `authorUid` を直接渡す形式も当面維持する。

```text
/viewer.html?project=proj_abc123&author={uid}
```

`/viewer.html?work=` は `public_projects/{workId}` を読んで `authorUid` と `projectId` を解決し、最新の発行済み `users/{authorUid}/projects/{projectId}` を表示する。Hosting rewrite がある環境では `/viewer?work=` も互換URLとして扱う。版指定URLは後続で `r={releaseId}` を解決対象に加える。

---

### `users/{uid}` — ユーザー正本ドキュメント

Google サインイン成功時に、Firebase Auth のユーザーとは別に DSF アプリ側の正本として作成する。
Storage/R2 側に空フォルダを作るのではなく、namespace をここで固定する。

```json
{
  "uid": "String (Firebase Auth UID)",
  "authProvider": "String ('google')",
  "displayName": "String",
  "photoURL": "String",
  "email": "String",
  "handle": "String | null (公開ハンドルの互換/検索用ミラー。正本は publicProfile.handle)",
  "publicProfile": {
    "displayName": "String (公開名。Google アカウント名とは独立)",
    "handle": "String | null (4-20 chars: a-z, 0-9, _. 初回設定後は通常ユーザーでは変更不可)",
    "bio": "String (280 chars max)",
    "avatarUrl": "String (任意。R2 上の WebP URL)",
    "backgroundUrl": "String (任意。R2 上の WebP URL)",
    "updatedAt": "Timestamp | null"
  },
  "roles": {
    "reader": "Boolean",
    "creator": "Boolean",
    "admin": "Boolean",
    "operator": "Boolean",
    "moderator": "Boolean"
  },
  "plan": {
    "tier": "String ('free' | 'plus' | 'pro' | 'business')",
    "effectiveTier": "String ('free' | 'plus' | 'pro' | 'business')",
    "status": "String ('active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired')",
    "provider": "String ('none' | 'stripe' | 'manual')",
    "trialEndsAt": "Timestamp | null",
    "currentPeriodStart": "Timestamp | null",
    "currentPeriodEnd": "Timestamp | null",
    "cancelAtPeriodEnd": "Boolean",
    "canceledAt": "Timestamp | null",
    "updatedAt": "Timestamp | null"
  },
  "billing": {
    "provider": "String ('none' | 'stripe' | 'manual')",
    "stripeCustomerId": "String | null",
    "stripeSubscriptionId": "String | null",
    "stripePriceId": "String | null",
    "stripeSubscriptionStatus": "String | null",
    "lastWebhookEventId": "String | null",
    "lastSyncedAt": "Timestamp | null"
  },
  "entitlements": {
    "canCreateProject": "Boolean",
    "canUsePremiumPaper": "Boolean",
    "canPublishPrivately": "Boolean",
    "canUseAdvancedAnalytics": "Boolean",
    "canManageLabel": "Boolean",
    "canUseUnlimitedListing": "Boolean",
    "canSchedulePublicExpiry": "Boolean"
  },
  "status": {
    "disabled": "Boolean",
    "moderationHold": "Boolean"
  },
  "storage": {
    "authoringRoot": "String (users/{uid}/dsp/)",
    "publishRoot": "String (users/{uid}/dsf/)",
    "initialized": "Boolean"
  },
  "adminRoleSync": {
    "source": "String ('custom_claims')",
    "syncedAt": "Timestamp | null"
  },
  "createdAt": "Timestamp",
  "lastLoginAt": "Timestamp"
}
```

#### ブートストラップ方針

- Firebase Auth の初回 Google ログイン直後に `users/{uid}` を自動作成する
- 既存ユーザーは不足フィールドだけ補完し、`lastLoginAt` を更新する
- `roles.admin` / `roles.operator` / `roles.moderator` は後から運営側が付与する。初期値は `false`
- `plan` は権限とは分離する。初期値は `tier='free'`, `effectiveTier='free'`, `status='active'`, `provider='none'`
- `billing` は Stripe / manual billing の projection。初期値は `provider='none'`
- `entitlements` は実効機能フラグ。初期値は無料ユーザー相当を入れる
- `storage.authoringRoot` / `storage.publishRoot` は namespace 宣言であり、実フォルダ作成は行わない
- `adminRoleSync.*` は custom claims を Firestore ミラーへ同期した時刻の監査補助情報
- `publicProfile.*` は公開表示用の正本。メールアドレスは公開プロフィールに含めない
- `publicProfile.handle` は初回設定後に固定し、変更が必要な場合は運営対応に限定する

#### `plan` と `entitlements` の責務分離

- `roles.*` は「そのユーザーが何者か」
- `plan.*` は「何を契約しているか」
- `billing.*` は「決済プロバイダとどう同期しているか」
- `entitlements.*` は「今この時点で何が使えるか」

例えば、`creator` であっても `plan.effectiveTier='free'` なら premium paper は使えない。
逆に、将来的に運営側付与やキャンペーンで `entitlements.canUsePremiumPaper=true` を直接与えることはありうる。

---

### `handles/{handle}` — 公開ハンドル予約

公開ハンドルの一意性を担保する予約コレクション。ドキュメントIDは `@` を除いた lowercase handle。

```json
{
  "handle": "String",
  "uid": "String (Firebase Auth UID)",
  "createdAt": "Timestamp"
}
```

- 通常ユーザーは自分の初回 handle 設定時のみ作成できる
- `users/{uid}.publicProfile.handle` と `users/{uid}.handle` は同じ値にする
- 変更・削除は運営権限に限定する

---

### `users/{uid}/projects/{pid}` — プロジェクトドキュメント

```json
{
  "version": "5 | 6 (Project authoring schema)",
  "projectId": "String (Firestore document ID と同じ。編集単位)",
  "workId": "String (不変の作品ID。公開URLの正本)",
  "releaseId": "String | null (最新発行ID)",
  "projectName": "String (編集用プロジェクト名。可変)",
  "title": "String (作品タイトル)",
  "labelName": "String (作品レーベル名。将来の labels コレクション導入までの暫定フィールド)",
  "rating": "String (レーティング)",
  "license": "String (ライセンス)",
  "meta": {
    "ja": {
      "title": "String",
      "author": "String",
      "description": "String",
      "linerNotes": "String (ライナーノーツ。リンク記法 {{テキスト|URL}} を許可)",
      "copyright": "String"
    }
  },
  "lastUpdated": "Timestamp",
  "visibility": "String (互換フィールド。公開判定の正本は dsfStatus)",
  "uid": "String (オーナーの Firebase Auth UID)",
  "languages": ["String (言語コード: 'ja', 'en' など)"],
  "languageConfigs": {
    "ja": { "writingMode": "vertical-rl" },
    "en": { "writingMode": "horizontal-tb" }
  },
  "dsfPublishedAt": "Timestamp (最新 DSF 発行日時)",
  "dsfRenderStamp": "Number (最新 DSF アセットのレンダリング識別子)",
  "dsfPages": [ "Array (DSF v1互換: 最新WebPページURL群)" ],
  "dsfSchemaVersion": "Number (v1は1、hybrid delivery v2は2)",
  "dsfContentUrl": "String (v2: R2/CDN上のimmutable content.json)",
  "dsfContentHash": "String (v2: content indexのsha256)",
  "dsfPageCounts": { "ja": "Number", "en": "Number" },
  "blocks": [ "Block[] — Blocks モデル（正規モデル）" ],
  "sections": [ "Section[] — レガシー互換フラット配列（syncBlocksWithSections で同期）" ],
  "pages": [ "Page[] — v5 Page Object（ビューワー出力）" ]
}
```

Project v6のrootにはさらに`authoringRef: "authoring/current"`と
`authoringSchemaVersion: 6`を保存する。公開可能なrootの`blocks[]`はFixed互換投影だけであり、
完全なmixed spineの正本ではない。

#### `users/{uid}/project_summaries/{pid}` — Dashboard軽量投影 v1

Dashboardが`users/{uid}/projects`の重いroot文書を全件取得しないためのowner専用投影。
document IDはproject rootと同じ`pid`とし、`projectId`も同じ値を保存する。

```json
{
  "schemaVersion": 1,
  "sourceProjectVersion": 5,
  "projectId": "project_...",
  "workId": "work_...",
  "projectName": "編集用プロジェクト名",
  "title": "作品タイトル",
  "languages": ["ja", "en"],
  "listThumbnail": "https://.../thumb.webp",
  "pageCount": 128,
  "projectBytes": 2000000,
  "lastUpdated": "Timestamp",
  "hasPublishedDsf": true,
  "releaseId": "release_...",
  "dsfStatus": "public",
  "visibility": "public",
  "dsfPublishedAt": "Timestamp",
  "dsfLangs": ["ja", "en"],
  "dsfPageCount": 128,
  "dsfTotalBytes": 8000000,
  "dsfResolution": "1080x1920",
  "dsfQuality": 0.86,
  "publication": {
    "listedFrom": "Timestamp",
    "listedUntil": "Timestamp",
    "publicFrom": "Timestamp",
    "publicUntil": null,
    "expiredAt": null,
    "expireReason": null
  }
}
```

- 最大サイズは32 KiB。`js/project-summary.js`のpure projectionで検証する。
- `blocks`、`sections`、`pages`、`dsfPages`、`meta`、`authoringRef`を保存しない。
- `listThumbnail`は永続的なHTTPS URLだけを許可し、`blob:`／`data:` URLを保存しない。
- `publication.planSnapshot`はDashboard表示に不要なため複製しない。
- owner専用であり、Portal／Viewerの公開インデックスとして使用しない。
- Project root／authoring正本は引き続き既存pathが所有し、この投影からプロジェクトを復元しない。

contractとpure projectionに加えてowner専用Firestore Rulesを定義する。Rulesは厳密なフィールド許可リスト、
document IDと`projectId`の一致、型・件数・文字列長を検証する。Firestore RulesではJSONの正確なbyte数を
計測できないため、32 KiB上限は`js/project-summary.js`でも必ず検証する。

この段階ではRulesはローカル定義・静的検証までとし、Rules deploy、保存時のdual-write、Dashboard read、
既存projectのbackfillは未接続とする。接続順はRules deploy → 全writerのdual-write →
summary優先read＋root fallback → backfill → fallback廃止とする。

#### Block Object（`state.blocks` の各要素）

```json
{
  "id": "String (createId('block') で生成)",
  "kind": "'cover_front' | 'cover_back' | 'chapter' | 'section' | 'toc' | 'page'",
  "title": { "ja": "String", "en": "String" },
  "pages": [ "Page[] (kind='page' の Block のみ)" ]
}
```

#### Project v6 authoring contract（Commit 6A/6B）

Project v6では`blocks[]`を順序付きauthoring spineとし、既存Fixed BlockとFlow Groupを同じ作品内で
混在できる。プロジェクトルートを`layoutType:'fixed'|'flow'`で排他的に分けない。

```json
{
  "version": 6,
  "blocks": [
    { "id": "fixed_page_a", "kind": "page", "content": {} },
    {
      "id": "flow_group_story",
      "kind": "flow",
      "flow": {
        "document": {
          "schemaVersion": 1,
          "layoutType": "flow",
          "id": "flow_document_story",
          "sourceLanguage": "ja",
          "sections": []
        },
        "layout": {
          "schemaVersion": 1,
          "pagePreset": "dsf-canonical",
          "padding": { "top": 20, "right": 20, "bottom": 20, "left": 20 },
          "typographyByLanguage": {
            "ja": { "writingMode": "vertical-rl" }
          }
        },
        "translationState": {
          "schemaVersion": 1,
          "languages": {
            "en-us": {
              "sourceFingerprints": {
                "blocks": { "flow_paragraph_1": "u1AbCdEf012_-" },
                "sectionTitles": {}
              },
              "reviewState": "needs-review",
              "origin": "machine"
            }
          }
        }
      }
    },
    { "id": "fixed_page_b", "kind": "page", "content": {} }
  ]
}
```

所有関係:

- Fixed Blockは従来の固定編集データを所有する。
- Flow Groupの`flow.document`がsemantic sourceを所有する。
- `flow.layout`はDSF標準ページpreset、padding、言語別Typographyを所有する。
- 任意の`flow.translationState` v1は、言語別本文が対応する原文の短いBlock／Section title fingerprintと
  `origin`／`reviewState`／手動保護unitだけを所有する。原文、翻訳文、provider設定、job状態は複製しない。
- Flow生成ページ、fragment、pagination cacheはruntime派生値であり、Project v6へ保存しない。
- Flow生成ページはPage v5ではなく、永続IDを持たない。
- Flow本文を廃止予定のFixed `content.text`／`content.richText`へ複製しない。
- Flow Groupに`status`は置かず、spine内に存在すること自体を原稿へ接続中とみなす。

バージョン境界はProject v6、Page v5、FlowDocument v1、FlowLayout v1、任意のFlowTranslationState v1とする。Commit 6Bで
`state.blocks`、IndexedDB、DSP、Firestoreへ接続した。Fixed-only作品はv5を維持し、Flow Groupを含む作品は
明示的なv6として保存する。

FlowTranslationStateのfingerprintは`u1` + FNV-1a 64-bit base64url 11文字である。Heading／Paragraphは
Block ID、Section titleはSection ID単位で追跡する。target本文、Typography、Heading level、PageBreak、
生成pageはfingerprintへ含めない。`stale` booleanは保存せず、現在の原文fingerprintとの不一致から導出する。
metadataがない8B-1以前のtarget本文は`untracked`として有効かつ自動上書き保護対象とする。
8B-2B以降、既存target値を持つ原文unitを初めて編集する直前に旧fingerprintを一度だけ登録し、原文変更後の
`stale`を検出する。翻訳unitの手動編集はそのunitだけを現在のfingerprintへ更新し、言語全体の明示確認は
値が存在するunitだけを再登録する。これらは本文と同じProject v6 transaction／Undo単位で保存する。

Project v6 normalizerはFixed Blockをopaqueに保持する。未知のauthoring Blockや未知のFlow semantic Blockは
round-tripのため保持するが、対応できない内容を黙って欠落させないようvalidationで編集・paginationを停止する。

#### `users/{uid}/projects/{pid}/authoring/current` — Project v6 owner source

公開済みproject rootは第三者が読めるため、Flow本文、翻訳原稿、FlowLayoutを含む完全なProject v6 envelopeは
owner専用の`authoring/current`子documentへ保存する。rootと子documentは同一Firestore batchで更新する。

- child: 完全なProject v6 `blocks[]`、Fixed互換`sections[]`／`pages[]`、言語・編集metadata（Flow translationStateを含む）
- root: 明示的な公開field allowlistによる一覧／Press／Viewer用metadata、Fixed互換投影、`authoringRef`
- 未知のProject v6 authoring拡張: owner専用childでは保持し、公開rootには投影しない
- child欠落時: rootのFixed投影へfallbackせず読込停止
- Flow生成ページ／fragment／pagination cache: childにもrootにも保存禁止
- child soft limit: UTF-8 JSON 850 KiB
- root削除: childと同一batchで削除

詳細な失敗時契約とversion guardは`docs/cloud-save-contract.md`を参照。

#### Page Object v5（`state.pages` の各要素）— **派生 / 出力スキーマ**

```json
{
  "id": "String (createId('page') で生成)",
  "role": "'cover_front' | 'cover_back' | 'chapter' | 'section' | 'item' | 'toc' | 'normal'",
  "bodyKind": "'image' | 'text' | 'theme'",
  "pageType": "String (互換フィールド: role + bodyKind から導出)",

  "meta": {
    "title":      { "ja": "String", "en": "String" },
    "subtitle":   { "ja": "String", "en": "String" },
    "author":     { "ja": "String", "en": "String" },
    "supervisor": { "ja": "String", "en": "String" },
    "publisher":  { "ja": "String", "en": "String" },
    "edition":    { "ja": "String", "en": "String" },
    "colophon":   { "ja": "String", "en": "String" },
    "contacts": [
      { "type": "'url' | 'email' | 'other'", "value": "String", "label": "String" }
    ]
  },

  "content": {
    "background":      "String (画像URL — getOptimizedImageUrl() 経由で使用)",
    "thumbnail":       "String (サムネイルURL)",
    "bubbles":         [ "Bubble[] (吹き出し配列)" ],
    "imagePosition":   { "x": "Number", "y": "Number", "scale": "Number", "rotation": "Number" },
    "imageBasePosition": { "x": "Number", "y": "Number", "scale": "Number", "rotation": "Number" },
    "theme": {
      "templateId": "String",
      "paletteId":  "String"
    },
    "richText":      "Object (Slate.js 形式のリッチテキスト)",
    "richTextLangs": { "ja": "Object", "en": "Object" },
    "interactions":  "Array",
    "text":   "String (互換フィールド)",
    "texts":  { "ja": "String", "en": "String" },
    "textAlign": "'start' | 'center' | 'end' (テキストページの本文揃え)",
    "layout": "Object (組版設定)"
  },

  "ar": {
    "mode":   "'none' | 'gyro' | 'webxr'",
    "scale":  "Number (WebXR 時: 現実空間でのメートル単位幅、デフォルト 1.0)",
    "anchor": { "x": "Number", "y": "Number", "z": "Number" }
  }
}
```

> 注:
> - authoring canonical は **`blocks`**。`pages` は viewer/export/互換用途の派生面
> - `sections` は editor 互換フローのために残るフラット投影
> - 新しい仕様判断は `blocks` を起点に行い、`pages` 単体を正本として扱わない
>
> `ar`はWebGL/WebXR廃止に伴う廃止予定フィールドであり、既存データは無視する。
> `content.richText` / `richTextLangs` / `layout` / `texts` / `text`はFixed text authoringと互換読込のため維持する。
> 配信DSF v2へauthoring objectをそのまま公開せず、Pressで検証済み`fixedText`行／列projectionへ変換する。

#### Bubble Object（`content.bubbles` の各要素）

```json
{
  "id": "String",
  "shape": "String (shapes.js で定義されたシェイプID)",
  "x": "Number (0〜100, % 座標)",
  "y": "Number (0〜100, % 座標)",
  "width": "Number",
  "height": "Number",
  "text": "String (互換フィールド)",
  "texts": { "ja": "String", "en": "String" }
}
```

---

---

### `users/{uid}/works/{workId}` — 作品正本

読者に対して継続する作品本体。タイトル変更や改訂があっても `workId` は維持する。

```json
{
  "workId": "String",
  "projectId": "String (現在の制作元プロジェクト)",
  "ownerUid": "String",
  "title": "String",
  "labelName": "String",
  "rating": "String",
  "license": "String",
  "meta": { "ja": { "title": "String", "author": "String" } },
  "languages": ["ja"],
  "defaultLang": "ja",
  "latestReleaseId": "String | null",
  "latestProjectId": "String",
  "updatedAt": "Timestamp"
}
```

### `users/{uid}/works/{workId}/releases/{releaseId}` — 発行履歴

Press Room で Horizon 発行するたびに作成する発行スナップショット。

```json
{
  "releaseId": "String",
  "workId": "String",
  "projectId": "String",
  "dsfPages": [ "Array (この release の DSF ページ URL 群)" ],
  "bookMode": "String",
  "book": { "mode": "String", "covers": {} },
  "dsfStatus": "'draft' | 'unlisted' | 'public' | 'private'",
  "publication": {
    "listedFrom": "Timestamp (掲載開始。Press 出力開始時)",
    "listedUntil": "Timestamp (掲載終了。free は listedFrom から最大 14 日)",
    "publicFrom": "Timestamp | null (公開開始。Works で public/unlisted にした時)",
    "publicUntil": "Timestamp | null (公開終了。課金プランで任意設定可能)",
    "expiredAt": "Timestamp | null",
    "expireReason": "'listing' | 'public' | null"
  },
  "dsfPublishedAt": "Timestamp",
  "dsfRenderStamp": "Number",
  "dsfResolution": "String",
  "dsfQuality": "Number",
  "dsfLangs": ["ja"],
  "dsfTotalBytes": "Number",
  "createdAt": "Timestamp"
}
```

DSF delivery v2では長編本文をFirestoreへinline保存せず、R2/CDN上のimmutable content indexを参照する。
既存`dsfPages[]`はv1 WebP-only互換fieldとして維持する。

```json
{
  "dsfSchemaVersion": 2,
  "dsfContentUrl": "String (R2/CDN上のcontent.json)",
  "dsfContentHash": "String (sha256)",
  "dsfLangs": ["ja", "en"],
  "dsfPageCounts": { "ja": 128, "en": 143 },
  "dsfTotalBytes": "Number"
}
```

- `dsfContentUrl`は`releaseId`を含むimmutable pathとし、再発行では新しいReleaseを作る。
- `dsfPageCounts`は言語別Flow reflowによるページ数差を許可する。
- v2 Viewerは`dsfSchemaVersion===2`と完全な`dsfContentUrl` locatorを優先する。v2が宣言済みまたはlocatorが部分的に存在するのに
  検証できない場合は、同じdocumentの旧`dsfPages[]`へfallbackせず停止する。schema未指定／v1だけが既存`dsfPages[]`を読む。
- `public_projects/{workId}`には公開URL解決に必要な同じv2 locatorと、default languageの`pageCount`を投影する。
- authoring用FlowDocument、translationState、pagination cache、Undo／Redoは公開Releaseへ保存しない。

9A-6C-C-C-0のHorizon pure契約では、verified assemblyから
`users/{uid}/dsf/{workId}/{releaseId}/content.json`を起点とするimmutable file planを作る。全JSON／WebPについて予定した
public URL、MIME、byteLength、SHA-256、immutable cache policyと一致するupload receiptが揃うまで、上記Release metadataと
`public_projects`用locatorを生成しない。これによりpartial uploadやstale metadataを公開しない。

9A-6C-C-C-1Aの`POST /upload-release`はそのreceiptを作るbackend境界である。認証UID配下の限定JSON／WebP path、実bytesの
server-side SHA-256／size／MIME／形式を検証し、R2 objectをcreate-only、immutable cacheで保存する。同一metadataの既存objectだけを
idempotent retryとして受理し、不一致は上書きせず409で停止する。このendpointはFirestore documentを作成・更新せず、Pressからも
未接続である。したがって上記Firestore schemaとsecurity rulesに変更はない。

9A-6C-C-C-1Bのclient transportはplan全fileを逐次送信し、全exact receiptが揃った場合だけ既存pure sealを返す。途中まで成功しても
partial receiptからRelease／`public_projects` documentを作らず、retry時も完全planをserverへ再検証させる。この単位もFirestoreを
importせず、document write／security rules／schemaを変更しない。

9A-6C-C-C-1C-AのPress dry-run handoffは、成功planningのassemblyとsession内sealed WebPをHorizon planへexactに結び付けるだけで、
network requestもFirestore importも行わない。結果の`readyForUpload:true`はローカル入力検証済みを示し、upload receipt未取得のため
`readyForMetadataWrite:false`を維持する。Release／`public_projects` documentとsecurity rules／schemaは変更しない。

9A-6C-C-C-1C-Bは現在の認証UID、project／work IDとruntime-only release IDをdry-run path検証に使用するが、state、DSP、Firestoreへ
release IDやhandoff resultを保存しない。Press表示が`ready`でもupload receiptがないためRelease／`public_projects` writeは許可せず、
document schemaとsecurity rulesを変更しない。

現行公開runtimeのViewerはプロジェクトドキュメント上の最新`dsfPages`を読む。v2 public transportの選択契約は
9A-6C-C-C-0でpure実装済みだが、Viewer fetchには未接続である。`releases`は公開履歴、ロールバック、監査、版指定URLのための
土台として保持する。

#### `publication` — 掲載可能期間 / 公開期限

`dsfStatus` は公開状態、`publication` は時間境界を表す。状態と期限は分離する。

- `listedFrom` / `listedUntil`: DSF 出力を始めてから掲出終了までの掲載可能期間。free plan は最大 14 日。
- `listedUntil`: FREE は `listedFrom + 14日`、PLUS / PRO / BUSINESS は有効な課金中に限り `9999-12-31 23:59` 相当のシステム値を入れる。
- `publicFrom` / `publicUntil`: Works で `public` / `unlisted` にした公開開始から公開終了までの期限。`publicUntil` は PRO / BUSINESS でのみ任意設定可能で、必ず `listedUntil` 以下。
- `planSnapshot`: `publication` 再評価時の `tier` / `status` / `cancelAtPeriodEnd` / `evaluatedAt`。最終判定は現在の `users/{uid}.plan` を使い、snapshot は監査・表示補助に使う。
- プランダウングレード・解約時は現在プランで `publication` を再評価する。FREE に戻った場合、発行から14日を超えた `public` / `unlisted` 作品は下書き扱いへ戻す。
- Portal は `dsfStatus='public'` かつ `publication` が有効な作品だけを一覧表示する。
- Viewer は `public` / `unlisted` URL 直アクセス時も `publication` を確認し、期限外なら表示しない。
- metadata ベースの制御であり、R2 の画像 URL を直接知っている場合の物理遮断は別途 proxy / signed URL / 削除ジョブで扱う。

### `users/{uid}/bookmarks/{workId}` — 読者しおり

読者本人の `users/{uid}` 配下に保存する。ドキュメントIDは `workId`。

```json
{
  "workId": "String",
  "releaseId": "String | null",
  "language": "String",
  "pageIndex": "Number (0-based)",
  "progress": "Number (0.0〜1.0)",
  "updatedAt": "Timestamp",
  "completed": "Boolean"
}
```

### `users/{uid}/planChangeRequests/{requestId}` — プラン変更リクエスト

決済連携前のユーザー向けマイページから作成する。ユーザー本人は create/read のみ可能で、実際の `users/{uid}.plan` 変更は運営または決済連携が行う。

```json
{
  "uid": "String",
  "action": "'change' | 'cancel'",
  "requestedTier": "'free' | 'plus' | 'pro' | 'business'",
  "currentTier": "String",
  "currentStatus": "String",
  "status": "'requested' | 'processing' | 'completed' | 'rejected'",
  "note": "String | null",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

### `billing_events/{eventId}` — 課金イベント

Stripe webhook / manual billing operation の冪等処理と監査用。クライアントからは書き込まない。Firebase Admin SDK など backend privileged context で作成する。

```json
{
  "provider": "String ('stripe' | 'manual')",
  "eventId": "String",
  "eventType": "String",
  "uid": "String | null",
  "stripeCustomerId": "String | null",
  "stripeSubscriptionId": "String | null",
  "processedAt": "Timestamp",
  "status": "String ('processed' | 'ignored' | 'failed')",
  "error": "String | null"
}
```

しおりは `workId` 単位で継続する。版更新時は最新 release に寄せて復元し、ページ構成が大きく変わった場合は `pageIndex` を範囲内へ clamp する。より精密なページ対応は、将来 `releaseId` 間のページマッピングを追加して扱う。

---

### `metric_events/{eventId}` — 指標イベント

Viewer の閲覧行動を append-only の raw event として保存する。日次集計、作品別集計、管理画面表示用の集計ドキュメントは後段の派生データとして扱い、このコレクションを正本にする。

```json
{
  "schemaVersion": 1,
  "eventType": "'view_start' | 'page_view' | 'read_complete'",
  "workId": "String",
  "releaseId": "String | empty",
  "projectId": "String | empty",
  "readerUid": "String | empty (未ログイン閲覧は空文字)",
  "isSignedIn": "Boolean",
  "sessionId": "String (ブラウザセッション単位の匿名ID)",
  "language": "String",
  "pageIndex": "Number (0-based)",
  "pageCount": "Number",
  "progress": "Number (0.0〜1.0)",
  "reason": "String ('load' | 'initial' | 'navigation' | 'jump' | 'language_change' | 'bookmark_restore' など)",
  "source": "String ('shared')",
  "viewerPath": "String",
  "referrer": "String",
  "viewportWidth": "Number",
  "viewportHeight": "Number",
  "createdAt": "Timestamp"
}
```

#### イベント種別

| eventType | 発火条件 | 用途 |
|-----------|----------|------|
| `view_start` | 公開 Viewer の読み込み完了時に1回 | 作品単位の閲覧開始数 |
| `page_view` | セッション内で未計上のページへ到達した時 | ページ別到達、読了率の母数 |
| `read_complete` | 最終ページへ到達した時に1回 | 読了数、読了率 |

#### プライバシー方針

- IP アドレス、User-Agent、メールアドレス、表示名は保存しない。
- 未ログイン閲覧では `readerUid` は空文字にする。
- `sessionId` は `sessionStorage` に保存するブラウザセッション単位の匿名IDで、長期追跡用の永続IDとして使わない。
- イベントは追記専用とし、クライアントからの update/delete は許可しない。

---

### `reviews/{workId}/items/{reviewId}` — レビュー

作品ごとの読者レビュー。`workId` を親ドキュメントIDに置き、Viewer は対象作品の `items` だけを読む。将来の管理画面やモデレーションは collection group `items` を `status` で横断する。

```json
{
  "reviewId": "String",
  "workId": "String",
  "releaseId": "String",
  "projectId": "String",
  "authorUid": "String (作品作者 uid)",
  "readerUid": "String (投稿者 uid)",
  "readerName": "String",
  "goodCount": "Number (読者向けに表示する good 数)",
  "badCount": "Number (読者向けには非表示。作品投稿者ダッシュボード/運営確認用)",
  "body": "String (1〜2000 chars)",
  "status": "'published' | 'hidden' | 'removed'",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

`badCount` は公開 Viewer では表示しない。作品投稿者ダッシュボードや運営モデレーションで確認するために保持する。

### `reviews/{workId}/items/{reviewId}/reactions/{uid}` — レビューリアクション

レビュー単位のユーザー反応。1ユーザーにつき1ドキュメントで、`reaction` は `good` または `bad`。Viewer では good ボタンと good 数だけを表示し、bad ボタンは数を表示しない。

```json
{
  "workId": "String",
  "reviewId": "String",
  "uid": "String",
  "reaction": "'good' | 'bad'",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

初期投稿は `status='published'`。staff moderation で `hidden` / `removed` へ変更できる。読者向け Viewer は `published` のみ表示する。

---

### `public_projects/{workId}` — 公開作品インデックス

ポータルの公開一覧表示と `workId` URL 解決用。プロジェクト本体ではなく、表示と解決に必要な最小限のメタデータのみ。

```json
{
  "workId": "String",
  "projectId": "String",
  "releaseId": "String | null",
  "title": "String",
  "authorUid": "String (Firebase Auth UID)",
  "authorName": "String",
  "authorHandle": "String | null",
  "authorAvatarUrl": "String",
  "authorProfile": {
    "displayName": "String",
    "handle": "String | null",
    "avatarUrl": "String",
    "backgroundUrl": "String",
    "bio": "String"
  },
  "thumbnail": "String (カバー画像URL)",
  "updatedAt": "Timestamp",
  "dsfStatus": "'public' | 'unlisted'",
  "publication": {
    "listedFrom": "Timestamp",
    "listedUntil": "Timestamp",
    "publicFrom": "Timestamp",
    "publicUntil": "Timestamp | null",
    "expiredAt": "Timestamp | null",
    "expireReason": "'listing' | 'public' | null"
  },
  "dsfLangs": ["ja"],
  "pageCount": "Number (default language)",
  "dsfSchemaVersion": "Number",
  "dsfContentUrl": "String (DSF v2の場合)",
  "dsfContentHash": "String (DSF v2の場合)",
  "dsfPageCounts": { "ja": "Number", "en": "Number" }
}
```

`public` は Portal に表示する。`unlisted` は Portal には表示しないが、`/viewer.html?work={workId}` の解決には使う。`draft` / `private` では削除する。

---

### `admin_audit_logs/{logId}` — 運営監査ログ

運営スクリプトや将来の管理画面から行った privileged operation を記録する。

```json
{
  "type": "String ('custom_claims_update')",
  "actor": "String (実行者の email / handle / uid)",
  "reason": "String",
  "targetUid": "String",
  "targetEmail": "String | null",
  "before": {
    "admin": "Boolean",
    "operator": "Boolean",
    "moderator": "Boolean"
  },
  "after": {
    "admin": "Boolean",
    "operator": "Boolean",
    "moderator": "Boolean"
  },
  "createdAt": "Timestamp"
}
```

---

### Access Paths

| 操作 | JSファイル | メソッド | 説明 |
|------|-----------|---------|------|
| ユーザー初期化 | `js/firebase.js` | `ensureUserBootstrap` | Google ログイン時に `users/{uid}` を作成/補完し `lastLoginAt` を更新 |
| 一覧取得 | `js/projects.js` | `openProjectModal` | `users/{uid}/projects` を getDocs |
| 読み込み | `js/firebase.js` / `js/viewer.js` | `loadProject` / `loadFromFirestore` | Studioはv6 rootの`authoring/current`をowner正本として読む。Viewerは発行済み投影だけを扱う |
| 保存 | `js/firebase.js` | `performSave` | Fixed v5はrootへmerge保存。v6はowner child完全置換＋公開可能root投影を同一batchで保存 |
| 公開プロフィール保存 | `js/mypage.js` | `savePublicProfile` | `users/{uid}.publicProfile` を更新。初回 handle 設定時は `handles/{handle}` を transaction で予約 |
| Work URL 解決 | `js/viewer.js` | `loadWorkFromPublicIndex` | `public_projects/{workId}` から `authorUid` / `projectId` を解決 |
| 削除 | `js/projects.js` / `js/works.js` | — | `authoring/current`とproject rootを同一batchで削除 |
| draft 作成 | `js/press.js` | publish handler | `releaseId` を採番し、`projects` と `works/{workId}/releases/{releaseId}` に DSF メタデータを保存。既存 `public_projects/{workId}` は削除 |
| 公開登録 | `js/works.js` | `_updateDsfStatus` | `public` / `unlisted` 切り替え時に `public_projects/{workId}` へ setDoc |
| 公開解除 | `js/works.js` | `_updateDsfStatus` | `draft` / `private` 切り替え時に `public_projects/{workId}` を削除 |
| しおり復元 | `js/viewer.js` | `restoreBookmarkIfAvailable` | ログイン済み読者の `users/{uid}/bookmarks/{workId}` を読み、ページと言語を復元 |
| しおり保存 | `js/viewer.js` | `saveBookmark` | ページ移動・言語切替時に `users/{uid}/bookmarks/{workId}` へ merge 保存 |
| 指標イベント送信 | `js/viewer.js` | `trackViewStart` / `trackPageView` / `trackReadCompleteIfNeeded` | `metric_events/{eventId}` に閲覧イベントを addDoc |
| レビュー読み込み | `js/viewer.js` | `loadViewerReviews` | `reviews/{workId}/items` から `status='published'` のレビューを取得 |
| レビュー投稿 | `js/viewer.js` | `submitViewerReview` | ログイン済み読者が `reviews/{workId}/items/{reviewId}` にレビューを作成 |
| 課金 projection 参照 | `js/publication.js` / `js/mypage.js` / `js/admin.js` | `getEffectivePlanTier` / `planAllows*` / account render | `plan.effectiveTier` と `entitlements` を優先してプラン機能を判定 |

---

## Firebase Storage

### フォルダ構成

```
users/{uid}/dsf/
├── {timestamp}_{filename}.webp        ← オリジナル画像（WebP変換済み）
└── thumbs/{timestamp}_{filename}.webp ← サムネイル画像

users/{uid}/profile/
├── avatar_{timestamp}.webp            ← 公開プロフィール画像
└── background_{timestamp}.webp        ← 公開プロフィール背景画像
```

> 旧パス `/dsf/` は廃止。現在は `users/{uid}/dsf/` に格納。

### 画像 URL の取得ルール

**すべての画像 URL は必ず `getOptimizedImageUrl(url)` を通すこと**（`js/firebase.js` エクスポート）。
直接 URL を img タグや Three.js TextureLoader に渡すことを禁止する。

### Access Paths

| 操作 | JSファイル | メソッド | 説明 |
|------|-----------|---------|------|
| アップロード | `js/firebase.js` | `uploadToStorage` | WebP変換・圧縮後にアップロード |
| サムネイル生成 | `js/firebase.js` | `generateCroppedThumbnail` | クロップ済みサムネイルを生成・アップロード |

---

## Security Rules

### Firestore Rules（`firestore.rules` — デプロイ済み 2026-02-25）

```
users/{uid}:
  - read/write: 認証済みオーナー (auth.uid == uid)

users/{uid}/projects/{pid}:
  - read/write: 認証済みオーナー (auth.uid == uid)
  - read: dsfStatus が 'public' または 'unlisted' の場合は誰でも可
  - update: 保存済みProject versionより小さいversionへのdowngradeを拒否
  - delete: authoring/currentが削除後にも残る操作を拒否

users/{uid}/projects/{pid}/authoring/current:
  - read/write: 認証済みオーナーのみ
  - public read: 常に拒否
  - create/update: Project v6のみ

users/{uid}/works/{workId}:
  - read/write: 認証済みオーナー (auth.uid == uid)

users/{uid}/works/{workId}/releases/{releaseId}:
  - read/write: 認証済みオーナー (auth.uid == uid)

users/{uid}/bookmarks/{workId}:
  - read/write: 認証済みオーナー (auth.uid == uid)
  - write: request.resource.data.workId == workId

users/{uid}/planChangeRequests/{requestId}:
  - read/create: 認証済みオーナー (auth.uid == uid)
  - update/delete: 運営スタッフのみ

handles/{handle}:
  - read: 誰でも可
  - create: 認証済みユーザーが自分の初回 handle 予約としてのみ可
  - update/delete: admin のみ

billing_events/{eventId}:
  - read: admin / operator / moderator のみ
  - create/update/delete: クライアントからは不可（backend privileged context のみ）

public_projects/{workId}:
  - read: 誰でも可（未認証含む。Portal / Viewer 側は dsfStatus と publication で表示・閲覧可否を判定）
  - create/update: 認証済みユーザーが authorUid == auth.uid で、publication が有効な場合のみ
  - FREE の listedUntil は listedFrom から最大 14 日
  - `entitlements.canUseUnlimitedListing=true` または有効な PLUS/PRO/BUSINESS projection のみ掲載可能期間なし扱い
  - publicUntil は listedUntil 以下、かつ `entitlements.canSchedulePublicExpiry=true` または有効な PRO/BUSINESS projection のみ設定可
  - delete: authorUid == auth.uid の場合のみ

metric_events/{eventId}:
  - create: 誰でも可。ただし schemaVersion, eventType, workId, releaseId, pageIndex, pageCount, progress, sessionId, createdAt などの型と範囲を検証
  - read: admin / operator / moderator のみ
  - update/delete: 不可

reviews/{workId}/items/{reviewId}:
  - read: status == 'published'、投稿者本人、または staff のみ
  - create: ログイン済み読者のみ。workId / reviewId / readerUid / body / goodCount / badCount / status / timestamps を検証
  - update: staff が status と updatedAt のみ変更可。ログイン済み読者はリアクション集計として goodCount / badCount / updatedAt のみ変更可
  - delete: 投稿者本人または staff

reviews/{workId}/items/{reviewId}/reactions/{uid}:
  - read: 本人または staff のみ
  - create/update/delete: 本人または staff。reaction は good / bad のみ
```

### Storage Rules（`storage.rules` — デプロイ済み 2026-02-25）

```
users/{uid}/dsf/**:
  - read: 誰でも可（公開画像）
  - write: 認証済みオーナー (auth.uid == uid) のみ
```

---

## ランタイムモデル関係

```
state.blocks   ← authoring canonical（編集判断の起点）
    ↓ extract/sync compatibility surfaces
state.sections ← editor/render compatibility surface
    ↓ blocksToPages()
state.pages    ← viewer/export surface（v5 Page Object の配列）
```

**原則**:
- 仕様上の正本は `state.blocks`
- `state.sections` / `state.pages` は互換面として再生成可能であることを優先する
- 現行 editor 実装では `sections` から編集が入る経路が残るが、保存前には必ず `blocks` へ再同期する

Project v6 authoring／runtime関係（Commit 6A/6B/7A）:

```
ProjectV6.blocks[]
    ├─ Fixed Block ─────────────→ 既存Page v5 projection
    └─ kind:'flow' Flow Group ─┬→ FlowDocument ─→ runtime generated pages
                              └→ translationState（authoring-only freshness metadata）
```

Flow生成ページは`state.blocks`、`state.sections`、`state.pages`のいずれにも書き戻さない。
Firestoreでは完全な`ProjectV6.blocks[]`をowner専用`authoring/current`へ保存し、公開可能rootには
Fixed互換投影だけを置く。

Commit 7AのEditor／Pressページ一覧は、mixed authoring spineをセッション内だけで
`Fixed page | Flow generated page`へ展開する。生成page、fragment、runtime選択、cacheは保存せず、
Flowを含む作品のDSF／Horizon発行はhybrid delivery v2の検証済みprojectionとViewer接続まで停止する。

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-08-25 | 9A-6C-C-A: 現在のPress package signatureと一致するround-trip合格済みportable ZIP Blobだけを既存DSF書き出しへ接続。保存前にBlob identity／MIME／size／SHA-256を再照合する。artifactはruntime-onlyで、Firestore、DSP／DSF保存schema、Flow upload、Horizon発行、公開Viewerは未変更 |
| 2026-08-25 | 9A-6C-B: Press sessionのsealed WebPとactive registryから取得・exact検証した使用WOFF2を、既存portable inventory／deterministic ZIPへ接続し全entryをround-trip検証。ZIP Blob、inventory、SHA-256、実測容量はruntime-onlyで、Firestore、DSP／DSF保存schema、download、upload、実発行、公開Viewerは未変更 |
| 2026-08-24 | 9A-6C-A: Flow本番準備、sealed WebP descriptor、既存v2 release assemblyからHorizon／portable payload容量をruntime-onlyで計算しPressへ表示。結果と画像bytesはstateへ保存せず、Firestore、DSP／DSF schema、ZIP、download、upload、実発行、公開Viewerは未変更 |
| 2026-08-24 | 9A-6B-B3-C: Noto Sans JP／Noto Serif JPのactive production registry登録とFlow Press実ブラウザーacceptanceを完了。registryはcode定数であり、runtime FontFace／capture resultは非永続のため、Firestore、DSP／DSF保存schema、実発行、公開Viewerは未変更 |
| 2026-08-23 | 9A-6B-B3-A: Noto Sans JP 2.004-H2／Noto Serif JP 2.003-H1のproduction font候補台帳を追加。source commit、WOFF2実byteLength／SHA-256、no-subset table比較、縦書きfeature、OFL根拠を固定した。candidateはruntime registryと分離し、production R2実体／remote evidence／Architect review未確認のためregistryは空、Firestore、DSP／DSF schema、発行、公開Viewerは未変更 |
| 2026-08-23 | 9A-6B-B1/B2: production WOFF2 exact-byte verifierとverified FontFace runtime leaseを追加。header／実byteLength／SHA-256一致とbrowser loadをFlow capture前に必須化した。evidence／Blob／runtime familyは非永続で、registryは空、Firestore、DSP／DSF schema、実発行、公開Viewerは未変更 |
| 2026-08-23 | 9A-6B-A: fixture非依存のFlow preflight共通処理と本番font registry専用Press準備ゲートを追加。保存言語別に停止理由を表示するが、空registryの実原稿はDOM capture前に`FONT_NOT_CERTIFIED`となる。結果／revision／projectionはruntime-onlyで、Firestore、DSP／DSF schema、発行、公開Viewerは未変更 |
| 2026-08-23 | 9A-6A: development-only Press UIでFlow実DOM capture、publication projection、preflightを接続し、言語別候補page数と停止理由をruntime表示。結果、revision、fixture registryは非永続で、Firestore、DSP／DSF保存schema、staging／production Press、公開Viewerは未変更 |
| 2026-08-23 | 9A-5C: 現在authoring revisionと完全一致する成功Flow projectionをpure Press preflightへ統合し、Fixed／Flow／WebPを作者順の言語別manifestへpure assembly。projection／revision mapと生成pageはruntime-onlyで、Firestore、DSP／DSF保存schema、Press実行runtime、公開Viewerは未変更 |
| 2026-08-23 | 9A-5B: 認定font・no-hyphenationの同一browser sessionでFlow paginationとRange実測snapshotを作り、9A-5Aへno-loss投影するlocal captureを追加。snapshot、生成page、sessionはruntime-onlyで、Firestore、DSP／DSF保存schema、Press、公開Viewerは未変更 |
| 2026-08-23 | 9A-5A: semantic Flow source、成功pagination、認定font実測snapshotをrevision／page／grapheme range／line geometryでno-loss照合し、言語別`fixedText` page fragmentへpure projectionする契約を追加。生成snapshotはruntime-onlyで、Firestore、DSP／DSF保存schema、Press、公開Viewerは未変更 |
| 2026-08-23 | 9A-4D: 9A-4C inventoryから決定的なDSF ZIPをメモリ生成し、local header、CRC、全entryのbyteLength／SHA-256を再展開照合するlocal packageを追加。download、Press UI、R2、Firestore、公開Viewer、保存schemaは未変更 |
| 2026-08-23 | 9A-4C: 9A-4Aの確定JSONと9A-4Bのsealed WebPを再検証し、`mimetype`、archive manifest、metadata、content、言語manifest、画像の完全なlocal file inventoryを追加。ZIP、Press UI、R2、Firestore、公開Viewer、保存schemaは未変更 |
| 2026-08-23 | 9A-4B: 実WebP bytesのRIFF／chunk境界、VP8・VP8L・VP8X寸法、静止画制約を検証し、Web Crypto SHA-256とimmutable Blobを9A-4A descriptorへ結び付けるlocal byte sealingを追加。既存Press render、upload、R2、Firestore、公開Viewer、保存schemaは未変更 |
| 2026-08-23 | 9A-4A: 公開可能な言語別preflightと検証済みWebP descriptorから、DSF v2 content index／言語manifestの確定JSONとhash、衝突しないasset path、Release metadata draftを作るpure assemblerを追加。WebP実bytes、R2、Firestore、Press UI、公開Viewer、保存schemaは未変更 |
| 2026-08-23 | 9A-3C: 本番認定font registryの厳格validatorとFixed pageごとのpure Press preflightを追加。registryは権利・実WOFF2・実hash未確認のため空。Fixed textは理由付きWebP fallbackを維持し、Flowは未接続として公開不可。Press UI、R2、Firestore、実発行、公開Viewer、保存schemaは未変更 |
| 2026-08-23 | 9A-3B: 9A-3A Fixed text projectionをdevelopment-only Pressサムネイルへ接続。正規360×640 DOM pageの0.2倍表示、fixture font load gate、fixedText候補数、WebP fallback code／理由を確認できる。実発行、R2、Firestore、公開Viewer、保存schemaは未変更。fixtureはstaging buildへ含めない |
| 2026-08-23 | 9A-3A: canonical Fixed text blockと同一本文・layout version・認定font ID／hashを結び付けたcomposition snapshotからDSF delivery v2の1ページmanifest fragmentを作るpure projectionを追加。認定font不一致、ruby、縦中横、overlay、overflow、未計測の横書き中央／末尾揃えは理由付きWebP fallback。Press／公開runtime／保存schemaは未変更 |
| 2026-08-23 | 9A-2: DSF delivery v2 fixed-text DOM renderer、認定font gate、WebPとのdual dispatch、slider previewをdevelopment-only Viewer fixtureへ接続。公開v2 loader／Press／Firestore／R2には未接続、schema変更なし |
| 2026-08-23 | 9A-1: DSF delivery v2 index／言語manifestのpure model、strict validation、Fixed／Flow anchorによる言語別page mappingを追加。Viewer／Press／Firestore／R2／UIには未接続 |
| 2026-08-23 | 9A-0: WebP-only v1の互換を維持し、言語別固定ページ列、R2 content index、`image`／`fixedText` page unionを持つDSF delivery v2設計を承認。Viewer内リフローと本文文字サイズ変更は行わない。runtime接続は未実装 |
| 2026-08-23 | Commit 8B-2C-B: Flow翻訳provider／model UI、runtime job、cancel、atomic machine／mixed applyをStudioへ接続。結果は既存FlowDocumentとtranslationStateへ一括保存し、既存Undo／Redo・autosave・reflowを使用。provider設定とjobは非永続、schema versionと公開境界変更なし |
| 2026-08-23 | Commit 8B-2C-A: Chrome Translator／LM Studioのruntime-only provider基盤とFlow semantic unit request／atomic apply planを追加。旧page slot同期は移植せず、provider設定・job・snapshotは非永続、schema version変更なし |
| 2026-08-22 | Commit 8B-2B: Flow翻訳状態をStudio表示とruntime原文fallbackへ接続。原文編集前baseline、翻訳unit単位更新、明示確認を既存Undo／保存経路へ統合。schema versionと公開境界は変更なし |
| 2026-08-22 | Commit 8B-2A: 任意の`flow.translationState` v1、Block／Section title別の短い原文fingerprint、missing／stale／untracked／review状態の純粋導出を追加。Project／Flow／DSP version、公開境界、生成ページ非永続は変更なし |
| 2026-08-22 | Commit 8B-1: 既存`texts[languageKey]`／`title[languageKey]`／`typographyByLanguage`をStudioのFlow言語別編集へ接続。構造とPageBreakは原稿言語で共有し、翻訳言語は独立reflowする。Project／Flow schema versionと保存境界は変更なし |
| 2026-08-21 | Commit 8A: FlowDocumentのsourceLanguage原稿をStudioの連続semantic editorへ接続。Heading／Paragraph／PageBreak編集、既存Undo/Redo・autosave、runtime増分reflowを使用し、生成ページ非永続と発行停止を維持 |
| 2026-08-21 | Commit 7A: 保存済みFlow原稿のruntime paginationをEditor／Pressの読取専用ページ一覧と通し番号へ接続。生成ページ非永続と発行停止を維持 |
| 2026-08-19 | Commit 6B: Project v6をstate／Undo／IndexedDB／DSP／owner専用Firestore authoring childへ接続。公開root分離、850 KiB soft limit、version downgrade guardを追加 |
| 2026-08-18 | Project v6の純粋authoring contractを追加。Fixed BlockとFlow Groupの混在、FlowDocument／FlowLayoutの所有境界、生成ページ非永続化を定義（保存経路は未接続） |
| 2026-02-25 | 全面改訂: `works` → `users/{uid}/projects/{pid}` に修正、v5 Page スキーマ追加、AR フィールド追加、Security Rules を実態に更新 |
| 2026-03-25 | DSF Gen 3 方針確定: WebP 画像のみ。`ar`・`richText`・`layout`・`text` 系フィールドを廃止予定に明記 |
| 2026-04-25 | `users/{uid}` をユーザー正本として追加。Google 初回ログイン時のブートストラップ仕様と self read/write ルールを明文化 |
| 2026-04-27 | `projectId` / `workId` / `releaseId` の3層モデル、`public_projects/{workId}` URL 解決、`users/{uid}/bookmarks/{workId}` しおりモデルを追加 |
| 2026-04-27 | `metric_events/{eventId}` 指標イベントモデルを追加。Viewer の `view_start` / `page_view` / `read_complete` を append-only で保存 |
| 2026-04-28 | `reviews/{workId}/items/{reviewId}` レビュー投稿モデルを追加。Viewer の投稿・公開レビュー表示と moderation 用 `status` を定義 |
| 2026-04-28 | レビュー評価を星から good/bad リアクションへ変更。Viewer では good 数のみ表示し、bad 数は投稿者/運営確認用に保持 |
| 2026-05-05 | `publication` 掲載可能期間 / 公開期限メタデータを追加。free plan の掲載可能期間は最大 14 日 |
| 2026-05-05 | プラン別期限仕様を FREE/PLUS/PRO/BUSINESS に更新し、`planChangeRequests` とマイページ土台を追加 |
| 2026-05-06 | 課金スキーマを正規化。`plan.effectiveTier`、`billing`、`entitlements.canUseUnlimitedListing` / `canSchedulePublicExpiry`、`billing_events` を追加 |
| 2026-05-10 | 公開プロフィール `users/{uid}.publicProfile` と handle 予約 `handles/{handle}` を追加 |
