# Data Model Documentation

**最終更新**: 2026-03-01
**ステータス**: Architect 管理下（変更には Architect 承認が必要）

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
  "title": "String (作品タイトル)",
  "lastUpdated": "Timestamp",
  "visibility": "'private' | 'unlisted' | 'public'",
  "uid": "String (オーナーの Firebase Auth UID)",
  "languages": ["String (言語コード: 'ja', 'en' など)"],
  "languageConfigs": {
    "ja": { "writingMode": "vertical-rl" },
    "en": { "writingMode": "horizontal-tb" }
  },
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

> **AR フィールドについて**: `ar` オブジェクト全体が省略可能。未定義時は `ar.mode = 'none'` として扱う（後方互換）。
> WebGL AR ビューワー実装（Phase 1〜2）に伴い追加。詳細: `docs/webgl-ar-viewer-plan.md`

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
  "title": "String (表示用タイトル。defaultLang 優先で解決済み)",
  "subtitle": "String (表示用サブタイトル。defaultLang 優先で解決済み)",
  "titles": { "ja": "String", "en": "String" },
  "subtitles": { "ja": "String", "en": "String" },
  "authorUid": "String (Firebase Auth UID)",
  "authorName": "String (表示用著者名。defaultLang 優先で解決済み)",
  "authors": { "ja": "String", "en": "String" },
  "languages": ["String (言語コード)"],
  "defaultLang": "String (既定言語コード)",
  "thumbnail": "String (カバー画像URL)",
  "publishedAt": "Timestamp (公開一覧の並び順キー)"
}
```

補足:

1. `title/subtitle/authorName` は表示用の解決済みフィールド（互換性維持）
2. `titles/subtitles/authors` はポータル多言語切替で参照する辞書
3. 既存データで辞書がない場合は表示用フィールドへフォールバック

---

### Access Paths

| 操作 | JSファイル | メソッド | 説明 |
|------|-----------|---------|------|
| 一覧取得 | `js/projects.js` | `openProjectModal` | `users/{uid}/projects` を getDocs |
| 読み込み | `js/firebase.js` | `loadWork` | 指定 pid を getDoc |
| 保存 | `js/firebase.js` | `performSave` | setDoc で上書き保存 |
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

### Firestore Rules（`firestore.rules` — staging 運用反映 2026-03-01）

```
users/{uid}/projects/{pid}:
  - read/write: staging 管理者 UID かつ auth.uid == uid
  - read: visibility が 'public' または 'unlisted' の場合は誰でも可

public_projects/{pid}:
  - read: 誰でも可（未認証含む）
  - create/update: staging 管理者 UID かつ authorUid == auth.uid の場合のみ
  - delete: staging 管理者 UID かつ authorUid == auth.uid の場合のみ
```

### Storage Rules（`storage.rules` — staging 運用反映 2026-03-01）

```
users/{uid}/dsf/**:
  - read: 誰でも可（公開画像）
  - write: staging 管理者 UID かつ auth.uid == uid のみ
```

> 注記: 上記は staging の暫定運用（単一管理者書き込み）を反映。  
> 本番向けの一般化ルールは Press Room / Channel RBAC 導入時に再定義する。

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

## 確定事項（未実装設計）

以下は Architect 合意済みだが、現時点では実装前の設計項目。

1. v1 は free-only 運用（課金・請求書/領収書・投げ銭連携は v2 以降）
2. `Press Room` 新設（公開運用を Studio から分離）
3. User と Channel の分離、および RBAC（owner/admin/publisher/editor/viewer）
4. 退会時は owner 不在チャンネルを作らない（最後の owner のまま退会不可）

参照ドキュメント:

1. `docs/press-room-plan.md`
2. `docs/channel-rbac-plan.md`
3. `docs/billing-quota-plan.md`

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-25 | 全面改訂: `works` → `users/{uid}/projects/{pid}` に修正、v5 Page スキーマ追加、AR フィールド追加、Security Rules を実態に更新 |
| 2026-03-01 | `public_projects` の多言語メタ（titles/subtitles/authors, languages/defaultLang）を反映。staging の単一管理者ルールを追記。Press Room / Channel RBAC / Billing の確定方針（未実装）を追記 |
