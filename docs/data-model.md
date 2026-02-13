# Data Model Documentation

## Firestore Database

### Collections & Documents
- **`works` Collection**
    - **Document ID**: `projectId` (ユーザーが入力したユニークなプロジェクトID文字列)
    - **用途**: プロジェクトの全データ（設定、セクション、テキスト、画像URL）を格納。

### `works` Document Structure
```json
{
  "title": "String (作品タイトル)",
  "lastUpdated": "Timestamp (最終更新日時)",
  "languages": ["String (言語コード: 'ja', 'en' など)"],
  "languageConfigs": {
    "ja": { "writingMode": "vertical-rl" },
    "en": { "writingMode": "horizontal-tb" }
  },
  "sections": [
    {
      "type": "String ('image' | 'text')",
      "background": "String (画像のURL - Storage)",
      "thumbnail": "String (サムネイル画像のURL - Storage / Optional)",
      "imagePosition": {
        "x": "Number",
        "y": "Number",
        "scale": "Number"
      },
      "text": "String (デフォルトテキスト)",
      "texts": {
        "ja": "String (日本語テキスト)",
        "en": "String (英語テキスト)"
      },
      "bubbles": [
        { // 吹き出し (Imageセクションのみ)
          "shape": "String ('speech' | 'thought' | 'shout')",
          "x": "Number (0-100%)",
          "y": "Number (0-100%)",
          "text": "String",
          "texts": {
             "ja": "String",
             "en": "String"
          }
        }
      ]
    }
  ]
}
```

### Access Paths (Read/Write)
| Operation | JS File | Method | Description |
| :--- | :--- | :--- | :--- |
| **List** | `js/projects.js` | `openProjectModal` | `works` コレクションを全件取得 (`getDocs`) |
| **Load** | `js/firebase.js` | `loadProject` | 特定のプロジェクトIDで1件取得 (`getDoc`) |
| **Save** | `js/firebase.js` | `performSave` | プロジェクトIDをキーに上書き保存 (`setDoc`) |
| **Delete** | `js/projects.js` | `openProjectModal` (inner) | プロジェクトIDを指定して削除 (`deleteDoc`) |

---

## Firebase Storage

### Folder Structure
- **`/dsf/`**: オリジナル画像 (WebP変換後)
- **`/dsf/thumbs/`**: サムネイル画像 (WebP)

### Naming Convention
- Original: `{timestamp}_{original_filename}.webp`
- Thumbnail: `{timestamp}_{original_filename}_thumb.webp`

### Access Paths
| Operation | JS File | Method | Description |
| :--- | :--- | :--- | :--- |
| **Upload** | `js/firebase.js` | `uploadToStorage` | 画像選択時にWebP変換・圧縮してアップロード |
| **Thumb Gen** | `js/firebase.js` | `generateCroppedThumbnail` | 画像調整完了時にクロップ済みサムネイルを生成・アップロード |

---

## Security Rules (Inferred & Risks)

### 推測される現状
コード上に認証ロジック (`signInWith...`) が存在せず、APIキーのみで初期化されているため、**Firestore / Storage ともに「誰でも読み書き可能」な状態 (Test Mode等)** であると推測されます。

### 注意点 (Risks)
1.  **認証なし**: 誰でも任意のプロジェクトIDを知っていれば（あるいは推測できれば）データを上書き・削除可能。
2.  **全件取得**: `js/projects.js` で `works` コレクションを全件取得しているため、アクセス制御が効いていない。
3.  **Storage**: ファイル名を知っていれば誰でも画像にアクセス可能（通常、画像は公開前提だが、削除権限などはリスク）。

### 推奨される改善
- **Authentication**: ユーザー認証を導入し、`ownerId` 等をドキュメントに持たせる。
- **Firestore Rules**: `request.auth.uid == resource.data.ownerId` のようなルールを設定する。
