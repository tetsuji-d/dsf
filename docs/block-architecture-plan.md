# Block Architecture Plan

最終更新: 2026-02-18  
対象: DSF Studio エディター/ビューワーの `sections` 中心実装を `blocks` 中心へ移行

## 1. 目的
- 既存の `image/text section` ベースを、拡張可能な `block` モデルに置き換える。
- すべてのプロジェクトに `表紙(front cover)` と `裏表紙(back cover)` を標準装備する。
- `章・節・項` を構造ブロックとして扱い、`目次(toc)` を自動生成可能にする。
- 将来の新ブロック追加を容易にする。

## 2. 合意済み仕様
- `cover_front` は先頭固定、`cover_back` は末尾固定。
- `cover_front` の次ブロックは「表紙扱いページ」。
- `chapter` は次の `chapter` まで有効。
- `section` は次の `section` または `chapter` まで有効。
- `item` は次の `item/section/chapter` まで有効。
- `item` のみ任意で `item_end` を置ける（未設置でも暗黙終了）。
- `toc` は任意位置に配置でき、ブロック構成から章・節・項を自動表示。

## 3. ブロックスキーマ（v3）
```ts
type LocalizedText = Record<string, string>; // { ja: "...", en: "..." }

type BaseBlock = {
  id: string;
  kind: string;
};

type CoverFrontBlock = BaseBlock & {
  kind: 'cover_front';
  meta: {
    title: LocalizedText;    // 言語別タイトル
    author: LocalizedText;   // 言語別著者名
    langs: string[];         // 対応言語
  };
};

type CoverBackBlock = BaseBlock & {
  kind: 'cover_back';
  meta: {
    colophon: LocalizedText; // 言語別奥付
  };
};

type ChapterBlock = BaseBlock & {
  kind: 'chapter';
  meta: { title: LocalizedText };
};

type SectionBlock = BaseBlock & {
  kind: 'section';
  meta: { title: LocalizedText };
};

type ItemBlock = BaseBlock & {
  kind: 'item';
  meta: { title: LocalizedText };
};

type ItemEndBlock = BaseBlock & {
  kind: 'item_end';
};

type TocBlock = BaseBlock & {
  kind: 'toc';
  meta?: { title?: LocalizedText };
};

type PageBlock = BaseBlock & {
  kind: 'page';
  content: {
    pageKind: 'image' | 'text';
    background?: string;
    thumbnail?: string;
    bubbles?: any[];
    text?: string;
    texts?: Record<string, string>;
    layout?: Record<string, any>;
    imagePosition?: { x: number; y: number; scale: number; rotation: number };
    imageBasePosition?: { x: number; y: number; scale: number; rotation: number };
  };
};
```

## 4. 構造解釈ルール
- 線形スキャンで `chapter/section/item` の現在コンテキストを更新する。
- `item_end` が出たら直近の未クローズ `item` を閉じる。
- `item_end` が無い `item` は次の `item/section/chapter/cover_back` 直前で暗黙終了。
- `toc` は現在言語の `title` を優先し、なければ既定言語/空文字でフォールバック。
- `cover_front` の次ブロックは `cover` セグメントとして扱う（TOC表示対象に含めるかは設定可能にする）。

## 5. エディターUI設計
### 5.1 ブロック追加メニュー
- `ページ(画像)`
- `ページ(テキスト)`
- `章`
- `節`
- `項`
- `項終了`（詳細メニュー内）
- `目次`

### 5.2 プロパティパネル
- `cover_front`: タイトル(言語別)、著者名(言語別)、対応言語
- `chapter/section/item`: 見出しタイトル(言語別)
- `cover_back`: 奥付(言語別)
- `page`: 既存の画像/テキスト編集UIを流用
- `toc`: 表示設定（章のみ/節まで/項まで、表紙・裏表紙を含めるか）

### 5.3 サムネイル表示
- `cover_front`: タイトル + 著者名（上限文字数で省略）
- `chapter/section/item`: 該当レベル名 + タイトル
- `cover_back`: 奥付先頭行
- `toc`: 「目次」プレビュー
- `page`: 現行サムネイル描画を流用

## 6. 保存・読込・移行
### 6.1 永続化方針
- 保存フォーマットを `version: 3` に更新。
- 正式な保存対象は `blocks`。
- 当面は読み込み互換のため `sections` を受理する。

### 6.2 旧データ移行（`sections` -> `blocks`）
1. `cover_front` を先頭に挿入（初期 `title/author` は空）
2. 各 `section` を `page` ブロックへ変換
3. `cover_back` を末尾に挿入（初期 `colophon` は空）
4. `languages/languageConfigs/uiPrefs` はそのまま引継ぎ
5. 次回保存で v3 として再保存

### 6.3 互換レイヤ
- `onLoadProject` / `viewer loadProjectData` で `normalizeProjectData()` を通す。
- `projects.js` の表紙取得は `cover_front` の次ブロックを優先。

## 7. 実装ステップ（PR分割）
1. `blocks` 型・初期化・正規化ユーティリティ追加（UI変更なし）
2. `sections.js` 相当を `blocks.js` に置換（追加/挿入/複製/移動/削除）
3. Editor描画を `activeBlock` ベースへ置換（`page` は既存描画再利用）
4. Viewer描画を `blocks` ベースへ置換
5. `chapter/section/item/item_end/toc` の解釈エンジン実装
6. プロパティパネル/サムネイルの block 対応
7. 旧 `sections` 参照の削除とクリーンアップ

## 8. 受け入れ条件
- 新規プロジェクトで `cover_front` と `cover_back` が必ず存在する。
- `item_end` の有無にかかわらず、項の範囲が決定できる。
- `toc` が任意位置で正しく自動生成される。
- 既存 `.dsf`（v2, `sections`）を読み込める。
- Editor と Viewer で同じ構造解釈結果になる。
- 主要操作（Undo/Redo、D&D並び替え、保存、共有）が回帰しない。

## 9. リスクと対策
- リスク: `state.sections` 依存が広く回帰が出やすい  
  対策: `normalize + adapter` を先に導入し段階移行する。
- リスク: TOC解釈差異（Editor/Viewer）  
  対策: 共通モジュール `block-structure.js` を両方から利用する。
- リスク: サムネイル生成の対象ブロック判定ミス  
  対策: `page` ブロックのみ画像サムネイル対象に限定する。

## 10. 変更対象ファイル（予定）
- `js/state.js`
- `js/app.js`
- `js/viewer.js`
- `js/firebase.js`
- `js/projects.js`
- `js/sections.js`（置換または廃止）
- `js/block-structure.js`（新規）
- `js/blocks.js`（新規）

