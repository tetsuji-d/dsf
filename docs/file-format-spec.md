# DSF & DSP File Format Specification

## 概要

**DSF（Digital Spread Format）** は、スマートフォン向け固定レイアウト出版のためのフォーマット総称です。リフロー型の EPUB とは対照的に、ZIP コンテナ内の **`manifest.json` / `meta.json` / `content.json`** とアセットにより、ページ構成・多言語・表示メタ（アスペクト比・綴じ方向など）を管理します。

本書は DSF Studio における 2 つの主要アーカイブ（**`.dsf`（配信）** および **`.dsp`（編集用プロジェクト）**）の構造とデータモデルを定義します。どちらも **ZIP アーカイブ** をコンテナとし、Excel（`.xlsx`）や EPUB と同様に、将来の拡張に対して上位/下位互換を保ちやすい設計を目指します。

---

## 1. ファイル拡張子と用途の違い
根本的な内部構造（ZIP圧縮されたJSONと画像群）は同一ですが、用途と含まれるデータ粒度が異なります。

### `.dsp` (Digital Smart Project)
*   **用途**: DSF Studio Pro 上での**編集用プロジェクトファイル**。バックアップや、別の端末・ユーザー間で作業状態をそのまま移行するために使用。
*   **特徴**:
    *   エディタのUI設定（サムネイルの列数、ズーム状態など）、編集途中のメタデータ、未翻訳の言語設定などを全て保持する。
    *   ユーザーが画質調整や切り抜きをやり直せるよう、**無劣化のオリジナル高解像度画像** を含む。
    *   編集履歴（Undo/Redoスタック）などを将来的に含める拡張の余地がある。

### `.dsf`（DSF 配信パッケージ / Digital Spread Format）
*   **用途**: エンドユーザー（読者）へ向けた**配信・配布用ファイル**。ブラウザ Viewer や将来のサードパーティリーダーでの閲覧に特化。（歴史的文脈では「Digital Smart Format」表記の資料もある）
*   **特徴**:
    *   エディタ固有のUI設定や不要なメタデータをパージし、ファイルサイズを最小限まで削ぎ落とす。
    *   画像は閲覧に最適なサイズと品質（WebP等の高圧縮フォーマット）に **事前リサイズ・最適化・切り抜き済み** のもののみを収録する。
    *   ビューアが即座にパースして描画開始できるように、不要なリレーション階層（Sections と Blocks の関係など）をフラット化して軽量化する。

---

## 2. ZIPコンテナ構造とポータビリティ
このフォーマットは**特定のサーバーシステム（FirebaseやAWS等）には一切依存しません。**
画像などのメディアファイルはクラウドのURLではなく、**すべてZIPファイルの中（`assets/` ディレクトリ下）に実体を含みます。** これにより、ネットワーク接続がないオフライン環境であっても、ファイル単体さえあればリーダーやエディタで完全に描画・復元できる「ポータブル」なフォーマットとなります。エクスポート時に画像の再取得に失敗した場合は、URL だけを残して続行せず、書き出し全体を失敗として扱います。

どちらのファイルも、ZIP展開すると以下のようなファイル・ディレクトリ構造を持ちます。

```text
filename.dsf / filename.dsp
 ├── mimetype                // 必須: ファイル形式を定義する識別子（非圧縮配置を推奨）
 ├── manifest.json           // アーカイブ内の全ファイル一覧とそのハッシュ等
 ├── meta.json               // 作品のメタデータ（タイトル、作者、バージョン、言語構成など）
 ├── project.json            // [DSPのみ] エディタが復元するための状態（state）の完全なダンプ
 ├── content.json            // [DSFのみ] リーダーが描画するためのページ構成、セリフ、画像パス
 └── assets/                 // メディアファイル格納庫
      ├── images/            // DSF: 閲覧用最適化済み画像
      ├── originals/         // DSP: 編集用オリジナル高解像度画像
      └── thumbs/            // DSP: エディタ表示用サムネイル画像
```

**メタデータの分担（現行）**: アーカイブ整合性・ファイル一覧は主に **`manifest.json`**、作品タイトル・言語リスト・表示系のルート設定は **`meta.json`**、ビューア向けのフラットな **ページ列** は **`content.json`**（DSF）が担います。**レーティング**など追加の出版メタは、`meta.json` の拡張キーとして解釈不能なら無視する方針で追加していく想定です。

---

## 3. 各ファイルの仕様（JSON スキーマ案）

### `mimetype`
ファイルの先頭に非圧縮で配置するテキストファイル（ePub仕様を参考）。
*   `.dsp` の場合: `application/vnd.dsf.project+zip`
*   `.dsf` の場合: `application/vnd.dsf.content+zip`

### `meta.json`
プロジェクト全体の基本情報。機能追加時はルートにキーを追加し、解釈できないキーは無視する仕組みで拡張性を担保。

```json
{
  "version": "1.0.0",               // フォーマットのバージョン
  "schemaVersion": 1,               // 内部データの構造バージョン番号（後方互換性用）
  "title": "作品タイトル",
  "author": "作者名",
  "languages": ["ja", "en", "zh"],  // 収録されている言語コード
  "defaultLang": "ja",
  "created": "2026-02-21T12:00:00Z",
  "modified": "2026-02-21T15:30:00Z",
  "generator": "DSF Studio Pro v1.2",// 生成したツール
  "presentation": {                 // 【将来拡張用表示設定】
    "orientation": "portrait",      // "portrait" (縦), "landscape" (16:9等の横)
    "aspectRatio": "9:16",          // 基準となるアスペクト比
    "spread": "auto"                // 見開き設定: "none" (単体), "auto" (画面幅で見開き)
  }
}
```

### `project.json` (DSP ファイル専用)
現在の `state.js` が保持しているデータをシリアライズした完全なダンプ。

```json
{
  "projectId": "local_abc123",
  "languageConfigs": {
    "ja": { "writingMode": "vertical-rl", "fontPreset": "mincho" },
    "en": { "writingMode": "horizontal-tb", "fontPreset": "sans" }
  },
  "uiPrefs": { "desktop": { "thumbColumns": 4 } },
  "sections": [ /* state.sections の配列（オリジナル画像への相対パスを含む） */ ],
  "blocks": [ /* state.blocks の配列 */ ],
  "pages": [ /* state.pages の配列 */ ]
}
```

### `content.json` (DSF ファイル専用)
ブラウザやネイティブリーダーが、最小の計算コストでページを描画するための最適化（フラット化）データ。
*   `sections` や `blocks` という編集用概念を統合・破棄し、純粋な `pages` サブシステムの配列へ変換される。
*   画像の `background` などのパスは、FirebaseのURLからZIP内の `assets/images/xxx.webp` のような相対パスに書き換えて格納する。

```json
{
  "pages": [
    {
      "pageId": "page-001",
      "type": "image",
      "assets": {
        "image": "assets/images/page1_optimized.webp"
      },
      "style": { "imagePosition": { "x": 0, "y": 0, "scale": 1 } },
      "bubbles": [
        {
          "id": "b-abc",
          "shape": "ellipse",
          "position": { "x": 50, "y": 30 },
          "localizedData": {
             "ja": { "text": "こんにちは", "writingMode": "vertical-rl" },
             "en": { "text": "Hello", "writingMode": "horizontal-tb" }
          }
        }
      ]
    }
  ]
}
```

---

## 4. 将来拡張（上位・下位互換性）の考え方
Excel（`.xlsx`）が Ooxml ベースで新機能（新しいグラフ、新しい関数のセルなど）を追加し続けても、極端に古いExcelで開くと「未定義の要素」として単に無視（またはフォールバック）されるように、以下のアプローチをとります。

1.  **JSONキーの無視原則**: ビューア / エディタは、自分が知らない JSON キーを見つけた場合、エラーで停止するのではなく、単にスキップ・無視する設計とする。
2.  **`fallback` プロパティの推奨**: 新しい機能（例：動画背景 `type: "video"`）を追加した場合、ビューアが非対応なら代替表示ができるよう、`fallback_image` のようなプロパティを標準化する。
3.  **`schemaVersion` によるマイグレーション**: スキーマが根本的に変わる場合（例：旧来は配列だったものがオブジェクトのMapになる等）は、`schemaVersion` をインクリメントし、アプリ側で旧データを新データ構造にオンザフライで変換するマイグレーション関数を通してから読み込む (`syncModelsFromLegacy` 関数などの拡張)。
