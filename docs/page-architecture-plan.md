# Page-Centric Architecture Plan

> Status: partially historical.
> この文書は `pages[]` 単一モデルへの移行計画を記録していますが、現行 runtime canonical は `blocks` です。
> 現在の判断には `docs/data-model.md` と `js/pages.js` の `normalizeProjectDataV5()` を優先してください。

最終更新: 2026-03-25
対象: DSF Studio エディター/ビューワーの `sections/blocks` 混在実装を、`pages` 単一モデルへ整理

> **2026-03-25 方針変更**: DSF Gen 3 として「WebP 画像のみ」方針を採用。
> - `bodyKind:'text'` は**廃止予定**（テキストページは画像化して扱う）
> - `content.richText` 系は**廃止予定**
> - `bodyKind:'image'` と `bodyKind:'theme'` のみ継続
> - 以下のセクション 11.6〜11.8 のうち richText / text 関連仕様は廃案。
> - `role`・`bodyKind` の分離・表紙/裏表紙固定化・TOC自動生成などの構造は継続有効。

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

## 11. 追加要件（2026-02-19）実装計画
以下は、今回の追加要件を安全に段階実装するための計画。

### 11.1 仕様確定（今回の合意）
- 表紙（先頭）/裏表紙（末尾）は位置固定（並び替え不可・削除不可）。
- 表紙/裏表紙のページタイプは `image` と `theme` の2種類。
- 表紙入力項目:
  - `title`（タイトル）
  - `subtitle`（サブタイトル）
  - `author`（著者名）
  - `supervisor`（監修者名）
  - `publisher`（出版社名）
- 裏表紙入力項目（奥付）:
  - `edition`（版）
  - `contacts[]`（URL / メール等）
- `theme` は「画像なしでも装丁できる」テンプレート + カラーコレクションを使用。
- 章/節/項ページは `image` / `text` のどちらでも作成可能。
- 章/節/項ページは必ず `title` を持ち、TOCはこのタイトルを参照。
- テキスト編集は選択範囲に `H1 / H2 / 太字 / 斜体 / 下線 / 取り消し線` を適用可能にする。

### 11.2 データモデル拡張（v5）
- `Project.version = 5` を導入。
- `Page` に `renderMode` を追加:
  - `renderMode: 'image' | 'text' | 'theme'`
- `pageType` は用途（`cover_front` / `chapter` 等）を表し、`renderMode` は見せ方を表す。
- `cover_front.meta` を拡張:
  - `title, subtitle, author, supervisor, publisher: LocalizedText`
- `cover_back.meta` を拡張:
  - `edition: LocalizedText`
  - `contacts: Array<{ type: 'url' | 'email' | 'other'; value: string; label?: string }>`
- `theme` 用フィールド:
  - `content.theme = { templateId: string; paletteId: string; overrides?: Record<string, string> }`
- テキスト装飾データ:
  - `content.richText`（ProseMirror/TipTap JSON互換の簡易スキーマ）を追加
  - 既存 `text/texts` は互換維持し、段階移行

### 11.3 正規化・移行
1. `normalizeProjectDataV5()` を追加。
2. v4→v5:
   - `cover_front/cover_back` に不足メタを補完
   - `renderMode` 未設定時は既存 `pageType` から推定
3. v3/v2→v5:
   - 既存アダプタ経由で `pages` 化後に v5 正規化
4. 保存は v5、読込は v2/v3/v4/v5 すべて受け入れ。

### 11.4 UI/操作実装（段階）
#### Phase A: 表紙/裏表紙の固定化
- `pages` 先頭/末尾を表紙/裏表紙として固定。
- D&Dで移動不可（視覚的にロック表示）。
- 削除ボタン無効化。

#### Phase B: 表紙/裏表紙の `image/theme` UI
- ページ属性パネルに `renderMode` セレクト追加。
- `cover_front` 入力フォーム追加（title/subtitle/author/supervisor/publisher）。
- `cover_back` 入力フォーム追加（edition/contacts）。
- `theme` 選択UI:
  - テンプレート一覧（最初は3〜5種）
  - カラーパレット一覧（最初は8〜12色）
  - プレビュー即時反映

#### Phase C: 章/節/項の image/text 切替
- `chapter/section/item` にも `renderMode` 適用（image/text）。
- 章/節/項共通でタイトル入力欄を表示。
- サムネイル/Viewerの描画分岐を `pageType + renderMode` に統一。

#### Phase D: TOCの再構築
- `buildOutlineFromPages()` を v5仕様へ更新。
- 章/節/項の `title` を優先し、未入力時はフォールバック名を使用。

#### Phase E: リッチテキスト編集
- エディタを `textarea` から `contenteditable + model` へ段階置換。
- 最初の対応コマンド:
  - `H1`, `H2`, `bold`, `italic`, `underline`, `strike`
- 保存は `content.richText` を正とし、暫定で plain text も同期保持。
- Viewer は `richText` レンダラを追加（見出し/装飾を反映）。

### 11.5 実装PR分割（推奨）
1. `v5スキーマ + normalizeProjectDataV5 + 互換移行`
2. `表紙/裏表紙固定化 + D&D制限`
3. `cover_front/cover_back フォーム + 保存`
4. `themeテンプレート/パレット基盤 + 表紙/裏表紙描画`
5. `chapter/section/item の renderMode(image/text)対応`
6. `TOC v5再構築`
7. `リッチテキスト基盤（H1/H2/装飾）`
8. `Viewerのリッチテキスト描画 + 互換最終調整`

### 11.6 受け入れ条件（追加）
- 表紙/裏表紙は常に先頭/末尾に存在し、移動/削除不可。
- 表紙/裏表紙で `image/theme` を切替でき、入力項目が保存・再読込される。
- 章/節/項で `image/text` を切替でき、タイトルがTOCに反映される。
- テキスト選択に `H1/H2/太字/斜体/下線/取り消し線` を適用できる。
- Editor/Viewerで同じ見た目・同じページ解釈になる。

### 11.7 リスクと対策（追加）
- リッチテキスト導入で既存レイアウト計算が崩れる:
  - 対策: `plain text fallback` を維持し、段階的に `richText` 優先化
- theme自由度が増えすぎる:
  - 対策: 初期はテンプレート固定 + カラー差し替えのみ
- 表紙固定化で既存D&D実装に影響:
  - 対策: 移動禁止ルールを `pages` 操作層に集約してUI側分岐を減らす

### 11.8 確定仕様（Q&A反映）
#### 11.8.1 モデル命名と責務
- v5では `pageType` を廃止し、`role` と `bodyKind` に分離する。
- `role` はページの意味のみを表す:
  - `cover_front | cover_back | chapter | section | item | toc | normal`
- `bodyKind` は見せ方のみを表す:
  - `image | text | theme`
- `project.defaultLang` を導入する（編集で変更可）。

#### 11.8.2 role x bodyKind 制約（厳格）
- `cover_front`: `image | theme`
- `cover_back`: `image | theme`
- `chapter | section | item`: `image | text`
- `toc`: `text` 固定
- `normal`: `image | text`
- `theme` は `cover_front/cover_back` のみ許可。

#### 11.8.3 表紙/裏表紙ルール
- 表紙は先頭固定、裏表紙は末尾固定。
- 移動不可、削除不可、`role` 変更不可。
- `bodyKind` のみ切替可（`image/theme`）。
- `image/theme` 切替時は両方のデータを保持する（非選択側は破棄しない）。

#### 11.8.4 必須入力と検証タイミング
- 表紙/裏表紙入力項目は「全言語分」入力必須。
- 章/節/項のタイトルは「全言語分」入力必須。
- ただし検証ブロックは保存時ではなく、公開/エクスポート時に行う。
- エラー表示は一括一覧モーダル（ページジャンプ可能）で提示する。

#### 11.8.5 章/節/項とTOC
- 章/節/項は本文入力を許可する（`bodyKind=text`時）。
- TOC表示名は常に `title` を使用する（本文は参照しない）。
- TOC対象は `chapter/section/item` のみ。
- TOCは編集ごと自動再生成する。
- TOCが溢れた場合は `toc` ページを自動増殖する。
- 自動増殖したTOCページはシステム管理としてロック（ユーザー編集不可）。
- TOCの配置は既存 `toc` の先頭位置を基準とし、追加分は直後へ連続配置。
- TOCのページ番号は物理ページ番号（`pages` 配列順、1始まり）を表示する。

#### 11.8.6 richText 方針
- 保存形式は独自の軽量JSONを採用する。
  - block: `paragraph | h1 | h2`
  - mark: `bold | italic | underline | strike`
- `text/texts` との二重保持は行わない（即時移行、`richText` のみ正）。
- 初期対応対象は `bodyKind=text` の全ページ（`normal/chapter/section/item`）。
- 編集UIは上部固定ツールバー（`H1/H2/B/I/U/S`）。
- 改行ルール:
  - `Enter`: 新段落
  - `Shift+Enter`: 同段落改行
- Undo単位:
  - 文字入力は一定時間でまとまり化
  - 書式操作は1操作単位

#### 11.8.7 テーマ方針
- テンプレート/パレット定義はコード内固定（`js/theme-presets.js` 新設予定）。
- 初期テンプレート数: 4
- 初期カラーパレット数: 10
- 編集自由度は最小（`templateId` / `paletteId` 選択のみ）。

#### 11.8.8 サムネイル表示方針
- すべて同一サイズのサムネイルカードとして扱う。
- 章/節/項はタイトル最優先で表示する。
- サムネイル表示言語は `defaultLang` 優先とする。

#### 11.8.9 連絡先（裏表紙）
- `contacts[]` は型付き:
  - `type: 'url' | 'email' | 'other'`
  - `value: string`（必須）
  - `label?: string`（任意）
- 入力検証は厳格:
  - URLは `http://` または `https://` 必須
  - メールは一般的な形式チェック
  - 公開/エクスポート時に不正値をブロック

#### 11.8.10 内部ページリンク（将来実装の予約）
- 同一プロジェクト内ページへの内部リンク機能を後続で実装する。
- v5段階で予約フィールドを追加:
  - `content.interactions[]`
  - 例: `{ type: 'page_link', source, targetPageId, trigger: 'tap' }`
- 対応範囲（将来）:
  - 要素リンク
  - テキスト範囲リンク
  - Viewerでの遷移履歴（戻る）
