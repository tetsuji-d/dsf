# Data Model Documentation

**最終更新**: 2026-04-26
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
| 公開プロジェクト一覧 | `public_projects/{pid}` | ポータル向け公開インデックス |

> **注意**: 旧仕様の `works` コレクションは廃止済み。コード上は `users/{uid}/projects/{pid}` を使用。

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

### `public_projects/{pid}` — 公開プロジェクトインデックス

ポータルの公開一覧表示用。プロジェクト本体ではなく、表示に必要な最小限のメタデータのみ。

```json
{
  "title": "String",
  "authorUid": "String (Firebase Auth UID)",
  "authorName": "String",
  "thumbnail": "String (カバー画像URL)",
  "updatedAt": "Timestamp",
  "dsfStatus": "'public'"
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
| 削除 | `js/projects.js` | — | deleteDoc |
| draft 作成 | `js/press.js` | publish handler | `dsfPages` を保存し `dsfStatus='draft'` にする。既存 `public_projects` は削除 |
| 公開登録 | `js/works.js` | `_updateDsfStatus` | `public` 切り替え時に `public_projects` へ setDoc |
| 公開解除 | `js/works.js` | `_updateDsfStatus` | `public` 以外へ切り替えたとき `public_projects` を削除 |

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

public_projects/{pid}:
  - read: 誰でも可（未認証含む）
  - create/update: 認証済みユーザーが authorUid == auth.uid の場合のみ
  - delete: authorUid == auth.uid の場合のみ
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
