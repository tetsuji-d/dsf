# Data Model Documentation

**最終更新**: 2026-04-27
**ステータス**: Architect 管理下（変更には Architect 承認が必要）

> **2026-03-25 方針変更**: DSF Gen 3 として「WebP 画像のみ」方針を採用。
> `bodyKind:'text'`・`content.richText`・`content.layout`・`ar` フィールドは**廃止予定**。
> WebGL / Three.js は使用しない。詳細は `AGENTS.md` 参照。

---

## Firestore コレクション構成

### コレクション一覧

| コレクション | パス | 用途 |
|------------|------|------|
| ユーザー正本 | `users/{uid}` | DSF アカウントの正本。Google 初回ログイン時にブートストラップ |
| ユーザープロジェクト | `users/{uid}/projects/{pid}` | 編集可能なプロジェクト本体 |
| 作品正本 | `users/{uid}/works/{workId}` | 読者に対して継続する作品IDと最新発行情報 |
| 発行履歴 | `users/{uid}/works/{workId}/releases/{releaseId}` | 発行ごとの DSF メタデータ |
| 読者しおり | `users/{uid}/bookmarks/{workId}` | 読者ごとの閲覧位置 |
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
  "handle": "String | null (将来の公開プロフィール用。初期値 null)",
  "roles": {
    "reader": "Boolean",
    "creator": "Boolean",
    "admin": "Boolean",
    "operator": "Boolean",
    "moderator": "Boolean"
  },
  "plan": {
    "tier": "String ('free' | 'starter' | 'pro' | 'enterprise')",
    "status": "String ('active' | 'trialing' | 'grace' | 'past_due' | 'canceled')",
    "provider": "String ('none' | 'stripe' | 'manual')",
    "trialEndsAt": "Timestamp | null",
    "currentPeriodEnd": "Timestamp | null",
    "cancelAtPeriodEnd": "Boolean",
    "updatedAt": "Timestamp | null"
  },
  "entitlements": {
    "canCreateProject": "Boolean",
    "canUsePremiumPaper": "Boolean",
    "canPublishPrivately": "Boolean",
    "canUseAdvancedAnalytics": "Boolean",
    "canManageLabel": "Boolean"
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
- `plan` は権限とは分離する。初期値は `tier='free'`, `status='active'`, `provider='none'`
- `entitlements` は実効機能フラグ。初期値は無料ユーザー相当を入れる
- `storage.authoringRoot` / `storage.publishRoot` は namespace 宣言であり、実フォルダ作成は行わない
- `adminRoleSync.*` は custom claims を Firestore ミラーへ同期した時刻の監査補助情報

#### `plan` と `entitlements` の責務分離

- `roles.*` は「そのユーザーが何者か」
- `plan.*` は「何を契約しているか」
- `entitlements.*` は「今この時点で何が使えるか」

例えば、`creator` であっても `plan.tier='free'` なら premium paper は使えない。
逆に、将来的に運営側付与やキャンペーンで `entitlements.canUsePremiumPaper=true` を直接与えることはありうる。

---

### `users/{uid}/projects/{pid}` — プロジェクトドキュメント

```json
{
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
  "dsfPages": [ "Array (最新 DSF ページ URL 群)" ],
  "blocks": [ "Block[] — Blocks モデル（正規モデル）" ],
  "sections": [ "Section[] — レガシー互換フラット配列（syncBlocksWithSections で同期）" ],
  "pages": [ "Page[] — v5 Page Object（ビューワー出力）" ]
}
```

#### Block Object（`state.blocks` の各要素）

```json
{
  "id": "String (createId('block') で生成)",
  "kind": "'cover_front' | 'cover_back' | 'chapter' | 'section' | 'toc' | 'page'",
  "title": { "ja": "String", "en": "String" },
  "pages": [ "Page[] (kind='page' の Block のみ)" ]
}
```

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
> ⚠️ **廃止予定フィールド（2026-03-25）**:
> - `ar` — WebGL/WebXR 廃止に伴い不要。既存データは無視する。
> - `content.richText` / `content.richTextLangs` — bodyKind:'text' 廃止に伴い不要。
> - `content.layout` — テキスト組版廃止に伴い不要。
> - `content.texts` / `content.text` — テキストページ廃止に伴い不要。
>
> Gen 3 では `content.background`（WebP画像URL）と `content.bubbles`・`content.thumbnail` が主要フィールド。

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
  "dsfPublishedAt": "Timestamp",
  "dsfRenderStamp": "Number",
  "dsfResolution": "String",
  "dsfQuality": "Number",
  "dsfLangs": ["ja"],
  "dsfTotalBytes": "Number",
  "createdAt": "Timestamp"
}
```

当面の Viewer はプロジェクトドキュメント上の最新 `dsfPages` を読む。`releases` は公開履歴、ロールバック、監査、版指定URLのための土台として保持する。

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
  "thumbnail": "String (カバー画像URL)",
  "updatedAt": "Timestamp",
  "dsfStatus": "'public' | 'unlisted'",
  "dsfLangs": ["ja"],
  "pageCount": "Number"
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
| 読み込み | `js/firebase.js` / `js/viewer.js` | `loadWork` / `loadFromFirestore` | 指定 pid を getDoc。Viewer の共有 URL は `dsfPages` がある発行済みデータだけを扱う |
| 保存 | `js/firebase.js` | `performSave` | `setDoc(..., { merge: true })` で編集内容を保存し、公開インデックスは更新しない |
| Work URL 解決 | `js/viewer.js` | `loadWorkFromPublicIndex` | `public_projects/{workId}` から `authorUid` / `projectId` を解決 |
| 削除 | `js/projects.js` | — | deleteDoc |
| draft 作成 | `js/press.js` | publish handler | `releaseId` を採番し、`projects` と `works/{workId}/releases/{releaseId}` に DSF メタデータを保存。既存 `public_projects/{workId}` は削除 |
| 公開登録 | `js/works.js` | `_updateDsfStatus` | `public` / `unlisted` 切り替え時に `public_projects/{workId}` へ setDoc |
| 公開解除 | `js/works.js` | `_updateDsfStatus` | `draft` / `private` 切り替え時に `public_projects/{workId}` を削除 |
| しおり復元 | `js/viewer.js` | `restoreBookmarkIfAvailable` | ログイン済み読者の `users/{uid}/bookmarks/{workId}` を読み、ページと言語を復元 |
| しおり保存 | `js/viewer.js` | `saveBookmark` | ページ移動・言語切替時に `users/{uid}/bookmarks/{workId}` へ merge 保存 |
| 指標イベント送信 | `js/viewer.js` | `trackViewStart` / `trackPageView` / `trackReadCompleteIfNeeded` | `metric_events/{eventId}` に閲覧イベントを addDoc |
| レビュー読み込み | `js/viewer.js` | `loadViewerReviews` | `reviews/{workId}/items` から `status='published'` のレビューを取得 |
| レビュー投稿 | `js/viewer.js` | `submitViewerReview` | ログイン済み読者が `reviews/{workId}/items/{reviewId}` にレビューを作成 |

---

## Firebase Storage

### フォルダ構成

```
users/{uid}/dsf/
├── {timestamp}_{filename}.webp        ← オリジナル画像（WebP変換済み）
└── thumbs/{timestamp}_{filename}.webp ← サムネイル画像
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

users/{uid}/works/{workId}:
  - read/write: 認証済みオーナー (auth.uid == uid)

users/{uid}/works/{workId}/releases/{releaseId}:
  - read/write: 認証済みオーナー (auth.uid == uid)

users/{uid}/bookmarks/{workId}:
  - read/write: 認証済みオーナー (auth.uid == uid)
  - write: request.resource.data.workId == workId

public_projects/{workId}:
  - read: 誰でも可（未認証含む。Portal 側は dsfStatus='public' のみ表示）
  - create/update: 認証済みユーザーが authorUid == auth.uid の場合のみ
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

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-25 | 全面改訂: `works` → `users/{uid}/projects/{pid}` に修正、v5 Page スキーマ追加、AR フィールド追加、Security Rules を実態に更新 |
| 2026-03-25 | DSF Gen 3 方針確定: WebP 画像のみ。`ar`・`richText`・`layout`・`text` 系フィールドを廃止予定に明記 |
| 2026-04-25 | `users/{uid}` をユーザー正本として追加。Google 初回ログイン時のブートストラップ仕様と self read/write ルールを明文化 |
| 2026-04-27 | `projectId` / `workId` / `releaseId` の3層モデル、`public_projects/{workId}` URL 解決、`users/{uid}/bookmarks/{workId}` しおりモデルを追加 |
| 2026-04-27 | `metric_events/{eventId}` 指標イベントモデルを追加。Viewer の `view_start` / `page_view` / `read_complete` を append-only で保存 |
| 2026-04-28 | `reviews/{workId}/items/{reviewId}` レビュー投稿モデルを追加。Viewer の投稿・公開レビュー表示と moderation 用 `status` を定義 |
| 2026-04-28 | レビュー評価を星から good/bad リアクションへ変更。Viewer では good 数のみ表示し、bad 数は投稿者/運営確認用に保持 |
