# Page-Centric Architecture Plan

最終更新: 2026-02-18  
対象: DSF Studio エディター/ビューワーの `sections/blocks` 混在実装を、`pages` 単一モデルへ整理

## 1. 目的
- ユーザー視点で「すべてページ」として理解できる情報設計に統一する。
- `表紙/裏表紙/章/節/項/目次` を独立ブロックではなく、ページの `type` として扱う。
- 後から `章ページ -> 通常ページ` などの変更を1操作で行えるようにする。
- エディター/ビューワーで同一のページ解釈を保証する。

## 2. 合意仕様（新方針）
- モデルの中心は `pages[]`。
- 各ページは `pageType` を持つ（例: `cover_front`, `chapter`, `normal_text` など）。
- 章・節・項も「構造ブロック」ではなく「ページ要素」。
- 表紙/裏表紙はデフォルトで存在するが、必要に応じて通常ページへ変換可能。
- TOC（目次）はページ配列を走査して自動生成する。

## 3. データモデル（v4）
```ts
type LocalizedText = Record<string, string>; // { ja: '...', en: '...' }

type PageType =
  | 'cover_front'
  | 'cover_back'
  | 'chapter'
  | 'section'
  | 'item'
  | 'toc'
  | 'normal_image'
  | 'normal_text';

type Page = {
  id: string;
  pageType: PageType;

  // 共通メタ（言語別）
  meta?: {
    title?: LocalizedText;     // cover/chapter/section/item/toc で使用
    author?: LocalizedText;    // cover_front
    colophon?: LocalizedText;  // cover_back
  };

  // 画像/テキスト本文
  content?: {
    background?: string;
    thumbnail?: string;
    bubbles?: any[];
    text?: string;
    texts?: LocalizedText;
    layout?: Record<string, any>;
    imagePosition?: { x: number; y: number; scale: number; rotation: number };
    imageBasePosition?: { x: number; y: number; scale: number; rotation: number };
  };
};

type ProjectV4 = {
  version: 4;
  projectId: string;
  title: string;
  pages: Page[];
  languages: string[];
  languageConfigs: Record<string, { writingMode: 'horizontal-tb' | 'vertical-rl'; fontPreset: string }>;
  uiPrefs?: any;
};
```

## 4. ページ解釈ルール
- `chapter` ページから次の `chapter` 手前までを同章として扱う。
- `section` は次の `section/chapter` 手前まで有効。
- `item` は次の `item/section/chapter` 手前まで有効。
- `toc` は `pages` を線形走査して章・節・項を自動抽出する。
- `normal_text` / `normal_image` は通常本文ページとして扱う。

## 5. エディターUI設計
### 5.1 ページ追加メニュー
- `通常ページ（画像）`
- `通常ページ（テキスト）`
- `表紙ページ`
- `裏表紙ページ`
- `章ページ`
- `節ページ`
- `項ページ`
- `目次ページ`

### 5.2 ページ属性パネル
- `ページタイプ`（セレクト）
  - 例: `章ページ` を `通常テキストページ` に変更可能
- `cover_front`: タイトル/著者（言語別）
- `cover_back`: 奥付（言語別）
- `chapter/section/item`: 見出しタイトル（言語別）
- `toc`: 表示レベル（章のみ/節まで/項まで）、表紙含有設定
- `normal_*`: 現行の画像/テキスト編集UIを継承

### 5.3 Pages一覧表示
- すべての要素を「ページ」として表示
- バッジでタイプを表示（`表紙`, `章`, `通常Text` など）
- D&D、複製、挿入、削除はページ単位で統一

## 6. 保存・読込・移行
### 6.1 永続化方針
- 保存フォーマットを `version: 4` に更新
- 正式な保存対象は `pages`
- 当面は `blocks` / `sections` 読込互換を維持

### 6.2 旧データ移行
1. `pages` があればそのまま採用
2. `blocks` があれば `pageType` へ変換
   - `cover_front -> cover_front`
   - `cover_back -> cover_back`
   - `chapter/section/item/toc -> 同名 pageType`
   - `page + pageKind=image/text -> normal_image/normal_text`
3. `sections` のみなら
   - 先頭 `cover_front`、末尾 `cover_back` を補完
   - 各 `section` を `normal_image/normal_text` へ変換
4. 次回保存時に v4 で再保存

### 6.3 互換レイヤ
- `normalizeProjectDataV4()` を導入
- Editor/Viewer/Projects 一覧は必ず正規化後データを使用

## 7. 実装ステップ（PR分割）
1. `pages` スキーマと `normalizeProjectDataV4()` を追加
2. `state` の主データを `pages` へ切替（`activePageIdx` 導入）
3. `sections.js/blocks.js` 操作を `pages.js` に統合
4. Editor描画を `pageType` 分岐へ移行
5. Viewer描画を `pageType` 分岐へ移行
6. ページ属性パネル（タイプ変更UI）を実装
7. TOC自動生成を `pages` 走査ベースへ置換
8. 旧 `blocks/sections` 依存コードを段階削除

## 8. 受け入れ条件
- 章・節・項・表紙・裏表紙がすべてページとして追加/編集/移動できる
- 任意ページを `pageType` 変更できる（例: 章 -> 通常テキスト）
- TOCが `pages` 構成を正しく反映する
- 既存 `v2(sections)` / `v3(blocks)` を読める
- Editor/Viewerで同一ページ順・同一解釈になる

## 9. リスクと対策
- リスク: 既存 `state.sections` 依存が広い
  対策: `pages <-> sections` アダプタを一時維持して段階移行
- リスク: タイプ変更時の不要データ残存
  対策: `pageType` 変更時に `content/meta` を型ごとに正規化
- リスク: TOCロジックの回帰
  対策: `buildOutlineFromPages()` を共通モジュール化してEditor/Viewerで共有

## 10. 変更対象ファイル（予定）
- `js/state.js`
- `js/app.js`
- `js/viewer.js`
- `js/firebase.js`
- `js/projects.js`
- `js/pages.js`（新規）
- `js/blocks.js`（移行完了後に縮退または削除）
- `js/sections.js`（移行完了後に縮退または削除）
