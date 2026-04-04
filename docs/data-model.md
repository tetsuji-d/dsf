# Data Model Documentation

**最終更新**: 2026-03-25
**ステータス**: Architect 管理下（変更には Architect 承認が必要）

> **2026-03-25 方針変更**: DSF Gen 3 として「WebP 画像のみ」方針を採用。
> `bodyKind:'text'`・`content.richText`・`content.layout`・`ar` フィールドは**廃止予定**。
> WebGL / Three.js は使用しない。詳細は `AGENTS.md` 参照。

---

## Firestore コレクション構成

### コレクション一覧

| コレクション | パス | 用途 |
|------------|------|------|
| ユーザープロジェクト | `users/{uid}/projects/{pid}` | 編集可能なプロジェクト本体 |
| 公開プロジェクト一覧 | `public_projects/{pid}` | ポータル向け公開インデックス |

> **注意**: 旧仕様の `works` コレクションは廃止済み。コード上は `users/{uid}/projects/{pid}` を使用。

---

### `users/{uid}/projects/{pid}` — プロジェクトドキュメント

```json
{
  "projectName": "String (編集用プロジェクト名。可変)",
  "title": "String (作品タイトル)",
  "lastUpdated": "Timestamp",
  "visibility": "'private' | 'unlisted' | 'public'",
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

#### Page Object v5（`state.pages` の各要素）— **正規スキーマ**

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
    "layout": "Object (組版設定)"
  },

  "ar": {
    "mode":   "'none' | 'gyro' | 'webxr'",
    "scale":  "Number (WebXR 時: 現実空間でのメートル単位幅、デフォルト 1.0)",
    "anchor": { "x": "Number", "y": "Number", "z": "Number" }
  }
}
```

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
  "visibility": "'public' | 'unlisted'"
}
```

---

### Access Paths

| 操作 | JSファイル | メソッド | 説明 |
|------|-----------|---------|------|
| 一覧取得 | `js/projects.js` | `openProjectModal` | `users/{uid}/projects` を getDocs |
| 読み込み | `js/firebase.js` | `loadWork` | 指定 pid を getDoc |
| 保存 | `js/firebase.js` | `performSave` | `setDoc(..., { merge: true })` で編集内容を保存し、DSF発行メタデータは保持 |
| 削除 | `js/projects.js` | — | deleteDoc |
| 公開登録 | `js/firebase.js` | `performSave` 内 | visibility 変更時に public_projects へ setDoc |
| 公開解除 | `js/firebase.js` | `performSave` 内 | deleteDoc from public_projects |

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
users/{uid}/projects/{pid}:
  - read/write: 認証済みオーナー (auth.uid == uid)
  - read: visibility が 'public' または 'unlisted' の場合は誰でも可

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

## デュアルデータモデル（同期構造）

```
state.blocks   ← 正規モデル（編集の起点）
    ↓ syncBlocksWithSections()
state.sections ← レガシー互換（レンダリング互換性のために維持）
    ↓ blocksToPages()
state.pages    ← ビューワー出力（v5 Page Object の配列）
```

**原則**: コンテンツ編集は必ず `state.blocks` を更新し、`syncBlocksWithSections()` で伝播させる。
`state.pages` や `state.sections` を直接変更しない。

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-25 | 全面改訂: `works` → `users/{uid}/projects/{pid}` に修正、v5 Page スキーマ追加、AR フィールド追加、Security Rules を実態に更新 |
| 2026-03-25 | DSF Gen 3 方針確定: WebP 画像のみ。`ar`・`richText`・`layout`・`text` 系フィールドを廃止予定に明記 |
