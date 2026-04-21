# 実装計画: テキスト入力 → エディタープレビュー → WebP レンダリング

> Status: historical implementation plan.
> この文書はテキスト組版実装前の計画メモです。現状と一致しない「未接続」記述を含みます。
> 現行の実装判断には `js/layout.js`、`js/app.js`、`js/press.js`、`js/text-press-html.js` を優先してください。

## 0. 現状と目標

### 現在のパイプライン（未接続）

```
layout.js          ✅ composeText() 完成
                      → lines[], frame, font, writingMode, overflow
app.js             ❌ テキストセクション入力 UI なし
                      （textarea はメタ用のみ）
press.js           ❌ _renderPageToWebP は画像セクションのみ
                      fillText なし
```

### 目標（3 フェーズで接続する）

```
[入力]  右パネル textarea  →  section.texts[lang]
[計算]  composeText()       →  lines[], frame, font
[表示]  HTML オーバーレイ   →  エディターキャンバス上にプレビュー
[焼込]  Canvas fillText     →  press.js → WebP ビットマップ
```

---

## 1. フェーズ概要

| # | フェーズ | 成果 | リスク |
|---|----------|------|--------|
| **1** | テキスト入力 UI | `section.texts[lang]` に保存できる | dispatch/sync 忘れ |
| **2** | エディタープレビュー | 入力と同時に組版結果を HTML で重ねる | フォント未ロードでの計測ずれ |
| **3** | Press → WebP 焼込 | テキストページが WebP に書き出される | 縦書き (`vertical-rl`) の Canvas 描画 |

フェーズ 1 → 2 → 3 の順で進める。各フェーズは単独でコミット可能。

---

## 2. フェーズ 1 — テキスト入力 UI

### 前提知識

- `section.type === 'text'` のセクションが組版対象（`layout.js` §288）
- テキスト本体: `section.texts[lang]`（`composeCanonicalLayoutsForSections` が参照）
- state 更新は必ず `dispatch` → `syncBlocksWithSections` の順

### タスク

| # | 作業 | 受け入れ条件 |
|---|------|-------------|
| 1-A | `sections.js` の `createDefaultSection()` に `type: 'image'` はそのまま。別途 **`createTextSection()`** を追加 | `{ type:'text', texts:{}, layout:{}, bubbles:[] }` が返る |
| 1-B | `app.js` のサイドパネル描画（セクション選択時）で `section.type === 'text'` のとき **テキスト用 HTML** を出力する。`<textarea data-lang="...">` に `section.texts[lang]` を流し込む | 言語切り替えで textarea の内容が切り替わる |
| 1-C | textarea の `input` イベントで `dispatch({ type: 'UPDATE_SECTION_TEXT', idx, lang, text })` を呼ぶ。reducer で `sections[idx].texts[lang] = text` し、`syncBlocksWithSections` を呼ぶ | Firestore 保存後に再読込しても内容が復元できる |
| 1-D | セクション種別切り替え UI（「テキストページとして追加」ボタンまたは既存セクションの type 変換） | テキストセクションが最低 1 つ追加・削除できる |

### dispatch アクション追加（`state.js`）

```javascript
case 'UPDATE_SECTION_TEXT': {
  const secs = state.sections.map((s, i) =>
    i === action.idx
      ? { ...s, texts: { ...s.texts, [action.lang]: action.text } }
      : s
  );
  syncBlocksWithSections(secs, state.blocks);
  return { ...state, sections: secs };
}
```

---

## 3. フェーズ 2 — エディタープレビュー（HTML オーバーレイ）

### 方針: HTML オーバーレイ（Canvas 描画ではなく）

Press での WebP 焼込は Canvas だが、エディタープレビューは **DOM + CSS** で行う。
理由: フォントの `writing-mode: vertical-rl` を Canvas で忠実に再現するより CSS のほうが信頼性が高く、速い。

```
#canvas-transform-layer
  └── #editor-canvas          （画像ページ用 <canvas>）
  └── #text-preview-overlay   ← ここを新設（テキストページ時のみ表示）
        └── .text-preview-frame
              └── .text-preview-lines（CSS vertical-rl / horizontal-tb）
```

### タスク

| # | 作業 | 受け入れ条件 |
|---|------|-------------|
| 2-A | `studio.html` に `#text-preview-overlay` を追加（`#editor-canvas` と同じ親・同じ座標系） | CSS で `position:absolute; inset:0` に配置できる |
| 2-B | `app.js` に `renderTextPreview(section, lang)` を実装。`composeText()` を呼び、返った `lines[]` / `frame` / `font` / `writingMode` を使って `.text-preview-lines` に行要素を埋め込む | テキストが `frame` 内に収まって表示される |
| 2-C | `section.type === 'text'` のとき `#editor-canvas` を非表示にして `#text-preview-overlay` を表示。逆も然り | 画像ページとテキストページを切り替えても表示が崩れない |
| 2-D | textarea `input` の debounce（300 ms）で `renderTextPreview` を再実行 | タイピング中もプレビューが追従する |
| 2-E | `overflow === true` のとき **「溢れあり」バッジ**をオーバーレイ上に表示 | 作者が保存前に気づける |

### CSS スケルトン（`css/studio.css` に追加）

```css
#text-preview-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;   /* クリックは下の要素に透過 */
  overflow: hidden;
}
.text-preview-frame {
  position: absolute;
  /* frame.x/y/w/h を JS でインラインスタイルとして設定 */
  display: flex;
  gap: 0;
}
.text-preview-lines[data-writing-mode="vertical-rl"] {
  writing-mode: vertical-rl;
  flex-direction: row-reverse;
}
.text-preview-lines[data-writing-mode="horizontal-tb"] {
  writing-mode: horizontal-tb;
  flex-direction: column;
}
```

---

## 4. フェーズ 3 — Press → WebP テキスト焼込

### 方針

`_renderPageToWebP` を**オーバーロード**する形で、`section.type === 'text'` のとき Canvas 2D `fillText` でテキストを描画するパスを追加する。

### 縦書き描画の方針

CSS の `writing-mode: vertical-rl` は Canvas 2D では直接使えない。  
各行を **90° 回転した座標系** で右から左へ描画する。

```
縦書きの場合:
  col = 0 → 右端の列（x = frame.x + frame.w - lineWidth）
  col 増加ごとに左へ移動
  各文字は通常の fillText で上から下へ
```

### タスク

| # | 作業 | 受け入れ条件 |
|---|------|-------------|
| 3-A | `press.js` に `_renderTextPageToWebP(section, lang, targetW, targetH, quality)` を追加 | Canvas に `fillRect` + `fillText` で白地にテキストが描画される |
| 3-B | 発行ループで `section.type === 'text'` のとき `_renderTextPageToWebP` に切り替え。`type === 'image'` は従来通り `_renderPageToWebP` | テキストページと画像ページが混在するプロジェクトを発行できる |
| 3-C | `layout.js` の `composeText()` を press.js 側でも呼ぶ（import 追加） | 組版は同一関数から生成される（二重実装なし） |
| 3-D | Press のサイズ推定（`_updateSizeEstimate`）にテキストページを含める | テキストのみプロジェクトでも容量が 0 MB にならない |
| 3-E | **フォント ready 待機**: `document.fonts.load('16px FontName')` を呼んでから `fillText` する | 初回発行でテキストが文字化けしない |

### `_renderTextPageToWebP` スケルトン

```javascript
import { composeText, getWritingModeFromConfigs, getFontPresetFromConfigs } from './layout.js';

async function _renderTextPageToWebP(section, lang, targetW, targetH, quality) {
  const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
  const fontPreset  = getFontPresetFromConfigs(lang, state.languageConfigs);
  const composed    = composeText(section.texts?.[lang] ?? '', lang, writingMode, fontPreset);

  // 論理座標 → 物理ピクセルのスケール
  const { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } = await import('./page-geometry.js');
  const sx = targetW / CANONICAL_PAGE_WIDTH;
  const sy = targetH / CANONICAL_PAGE_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width  = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');

  // 背景色
  const bg = section.backgroundColor || '#ffffff';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, targetW, targetH);

  // フォント設定
  const fontSize = composed.font.size * sx;
  const fontStr  = `${fontSize}px ${composed.font.family}`;
  await document.fonts.load(fontStr);
  ctx.font = fontStr;
  ctx.fillStyle = section.textColor || '#000000';

  const { frame, lines, writingMode: wm } = composed;
  const fx = frame.x * sx;
  const fy = frame.y * sy;
  const lineH = composed.font.size * composed.font.lineHeight * sy;

  if (wm === 'vertical-rl') {
    // 縦書き: 右から左へ列を並べる
    const colW = composed.font.size * sx;
    lines.forEach((line, col) => {
      const x = fx + frame.w * sx - colW * (col + 1);
      Array.from(line).forEach((ch, row) => {
        ctx.fillText(ch, x, fy + row * lineH + fontSize);
      });
    });
  } else {
    // 横書き
    lines.forEach((line, row) => {
      ctx.fillText(line, fx, fy + row * lineH + fontSize);
    });
  }

  return new Promise(resolve =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );
}
```

> **注**: `vertical-rl` の場合 `lines[]` は「列」単位で行が並ぶ（`charsPerLine` が「1 列の文字数」）。`composeText` の挙動と上記スケルトンが整合しているか、フェーズ 3 着手前に `layout.js` の出力を確認すること。

---

## 5. スケジュール目安

```
フェーズ 1（入力）  ─ 半日〜1 日
フェーズ 2（プレビュー）  ─ 1〜2 日
フェーズ 3（WebP 焼込）  ─ 1〜2 日
```

---

## 6. 完了の定義（DoD）

- テキストセクションで文字を入力 → 保存 → 再読込で内容が復元される
- エディターキャンバスにプレビューが表示される（縦書き・横書き両方）
- Press → 発行でテキストページが WebP として書き出される
- 画像ページとテキストページが混在するプロジェクトが正常に発行される

---

## 7. 後続課題（このフェーズ以降）

| 課題 | 理由 |
|------|------|
| フォントファイル自ホスト | Google Fonts CDN 依存を外す（オフライン・安定性） |
| `overflow` → 次ページ送り | 本文が 1 ページに収まらない場合の UX |
| 禁則精緻化・プリセット | 文庫・マニュアル向け |
| Press テキストページの背景色設定 UI | 白地以外のデザイン対応 |

---

*作成: 2026-04-13*
