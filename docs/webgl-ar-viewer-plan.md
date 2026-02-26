# WebGL AR ビューワー実装計画

**作成日**: 2026-02-25
**Architect 承認**: 済
**ステータス**: 設計フェーズ

---

## ビジョン

スマートフォン 6型画面を最大限に活用した、写真集・画集レベルの高品位ビューワー。

- 端末差のない GPU 描画（iOS / Android / PC で同一ピクセル精度）
- 俯瞰から細部まで精細なズーム（ミップマップ）
- ジャイロで視点移動（スマホを傾けると見える角度が変わる）
- WebXR でカメラ越しにページを現実空間に重畳（AR VIEW）

---

## 技術選定

### レンダリングエンジン: Three.js

| 候補 | 理由 |
|------|------|
| **Three.js** ✅ | WebXR 対応・エコシステム最大・ドキュメント豊富 |
| Babylon.js | WebXR 強いが bundle 大 |
| Raw WebGL | 学習コスト高・メンテ困難 |

### AR 実装: WebXR Device API

```
navigator.xr.requestSession('immersive-ar')
  → カメラ映像を背景に Three.js シーンをオーバーレイ
```

**対応ブラウザ:**
- Android Chrome 81+ ✅
- iOS Safari 17+ ✅（制限あり）
- デスクトップ Chrome（カメラなし・gyro のみ）

---

## フェーズ計画

### Phase 1: WebGL ビューワー基盤（Gemini 担当）

**目標**: 現行 HTML/CSS ビューワーを Three.js ベースに置換

#### 1-1. Three.js 統合
```
npm install three
```
- `viewer.html` の `<canvas>` 要素に Three.js レンダラーをマウント
- WebGLRenderer → `antialias: true`, `alpha: true`

#### 1-2. ページテクスチャ描画
```
pages[].imageUrl → TextureLoader → PlaneGeometry → MeshBasicMaterial
```
- 各ページを `PlaneGeometry` に貼り付けたメッシュとして配置
- WebP 画像を `getOptimizedImageUrl()` 経由で取得（既存ルール維持）
- ミップマップ自動生成（`texture.generateMipmaps = true`）

#### 1-3. カメラ操作
```
OrthographicCamera（俯瞰）↔ PerspectiveCamera（パース）切り替え
```
- ピンチズーム: `TouchEvent` → カメラ Z 軸移動
- スワイプ: 慣性スクロールでページ間移動
- ダブルタップ: 詳細ビュー（最大解像度ズーム）

#### 1-4. ジャイロ連動（gyro モード）
```javascript
window.addEventListener('deviceorientation', (e) => {
  camera.rotation.x = e.beta  * DEG;
  camera.rotation.y = e.gamma * DEG;
});
```
- iOS: `DeviceOrientationEvent.requestPermission()` が必要
- フォールバック: マウスドラッグで代替

#### 1-5. パフォーマンス設計
| 課題 | 対策 |
|------|------|
| 高解像度画像の GPU メモリ | 画面外ページのテクスチャを dispose() |
| 初期ロード時間 | 表示ページ±2 枚だけ事前ロード（既存プリロード踏襲） |
| フレームレート | `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` |

---

### Phase 2: AR VIEW（Gemini + Claude 担当）

**目標**: WebXR でカメラ越しにページを現実空間に重畳

#### 2-1. データモデル拡張（Claude / Architect）

`pages.js` の Page Object に追加:
```javascript
{
  // 既存フィールド...
  arMode: "none" | "gyro" | "webxr",  // デフォルト "none"
  arScale: 1.0,                        // 現実空間でのメートル単位幅
  arAnchor: {                          // WebXR アンカー座標（省略可）
    x: 0, y: 0, z: -1.5
  }
}
```

後方互換: `arMode` 未定義 → `"none"` として扱う

#### 2-2. WebXR セッション管理（Gemini）
```javascript
// AR ボタン押下時
const session = await navigator.xr.requestSession('immersive-ar', {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['dom-overlay'],
});
renderer.xr.setSession(session);
```

#### 2-3. ページの空間配置（Gemini）
- Hit-test でタップした実世界面にページメッシュをアンカー
- `arScale` をメートル換算でメッシュのスケールに適用
- ページ送りは空中スワイプジェスチャーで実装

#### 2-4. エディター AR 設定パネル（Claude / `js/app.js`）
```
右パネル > ページ設定 > AR設定
├── AR モード: [なし / ジャイロ / WebXR]
├── 実世界サイズ (m): [____]
└── (WebXR 時) アンカー位置: [自動 / 手動]
```

#### 2-5. エクスポート対応（Claude / `js/export.js`）
- `.dsf` の `manifest.json` に `arMode`, `arScale`, `arAnchor` を含める
- `.dsp` も同様に保存

---

## ブレイキングチェンジと移行計画

### 現行ビューワーとの差分

| 項目 | 現行 | WebGL 版 |
|------|------|---------|
| 描画方式 | HTML/CSS + img タグ | Three.js テクスチャ |
| テキスト | DOM テキスト | Canvas 2D テクスチャ or HTML overlay |
| スタイル | `css/viewer.css` | Three.js マテリアル（CSS は UI のみ） |
| ナビゲーション | スクロール / タッチ | カメラ移動 |

### テキスト・フキダシの扱い

WebGL でのテキスト描画は複雑なため、**ハイブリッド方式**を推奨:
```
<canvas>（Three.js レンダラー）  ← 画像ページ
<div id="overlay">（DOM）       ← フキダシ・テキスト・UI
```
CSS `pointer-events: none` で overlay を canvas の上に重ねる。

### 移行ステップ
1. Phase 1 完了まで `viewer.html` の旧版を `viewer-legacy.html` として保持
2. Phase 1 完了後、レビューして `viewer.html` に昇格
3. `viewer-legacy.html` は Phase 2 完了まで残す

---

## 担当マトリクス

| 作業 | 担当 | ブランチ | 依存 |
|------|------|---------|------|
| Three.js 統合・テクスチャ描画 | Gemini | `viewer/webgl-phase1` | なし |
| カメラ操作・ジャイロ | Gemini | `viewer/webgl-phase1` | なし |
| arMode/arScale フィールド追加 | Claude | `editor/ar-fields` | Architect の pages.js 承認 |
| AR 設定パネル (app.js) | Claude | `editor/ar-fields` | arMode フィールド追加後 |
| export.js AR 対応 | Claude | `editor/ar-fields` | arMode フィールド追加後 |
| WebXR セッション管理 | Gemini | `viewer/webgl-phase2` | Phase 1 完了後 |
| firebase.js テクスチャ最適化 | Architect | - | Phase 1 完了後に要検討 |
| docs/data-model.md 更新 | Architect | - | Phase 1 前に実施 |

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| iOS Safari WebXR 制限 | gyro モードを先行リリース。WebXR は Android 優先 |
| Three.js bundle サイズ (~600KB) | Vite の dynamic import で viewer のみに分離 |
| GPU メモリ不足（低スペック端末） | テクスチャ解像度の上限設定 + dispose() の徹底 |
| 既存 .dsf ファイルの互換性 | arMode デフォルト "none" で後方互換を保証 |
| CSS viewer.css の扱い | UI 部分（ナビボタン等）は残す。描画系は Three.js に移行 |

---

## 開始条件

- [ ] Architect が `docs/data-model.md` の Page Object スキーマを更新
- [ ] Gemini が `viewer/webgl-phase1` ブランチを `main` から切る
- [ ] Claude が `editor/ar-fields` ブランチを `main` から切る（Gemini Phase 1 と並行可）
- [ ] Three.js を `package.json` に追加（`npm install three`）

---

*このドキュメントは Architect 管理下。変更は Architect 承認が必要。*
