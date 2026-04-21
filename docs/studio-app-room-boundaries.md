# Studio (`app.js`) — Room 境界と認証の地図

Phase 1「room 境界の明文化」用。実装の正本は `js/app.js`・`js/gis-auth.js`・`js/email-auth.js`・`js/press.js`・`js/works.js`。

## Room モデル

| Room | `body[data-room]` | 主な初期化・更新 |
|------|-------------------|-------------------|
| **home** | `home` | `renderHomeDashboard()` — クラウド／ローカルプロジェクト一覧 |
| **editor** | `editor`（省略時も editor 扱いに注意） | `refresh()` 系・キャンバス／サムネ |
| **press** | `press` | `enterPressRoom()`（`press.js`） |
| **works** | `works` | `openWorksRoom()` / `loadWorksRoom()`（`works.js`） |

- **現在 room の取得**: `getCurrentRoom()` → `document.body.dataset.room || 'editor'`
- **切り替え**: `window.switchRoom(room)` が `dataset.room` を更新し、room ごとに上記を呼ぶ。

## `switchRoom` の副作用（要メンテ時はここ）

```text
switchRoom('home')  → renderHomeDashboard()
switchRoom('press') → enterPressRoom()
switchRoom('works') → loadWorksRoom()（= openWorksRoom(true)）
switchRoom('editor')→ 専用 hook なし（シェル同期のみ）
```

深いエディタ状態は `state` 側。room を跨ぐときは `works` / `press` が `works.js`・`press.js` 側で DOM を差し替える。

## Google ログインが「複数経路」になる理由

実装は **レイヤー分け**されています。

1. **`gis-auth.js`（GIS + Firebase）**
   - `initGIS`: Google Identity Services を読み込み、`initialize` +（非 localhost では）One Tap `prompt`
   - `renderGISButton(containerId)`: ドロップダウン内の「公式 Google ボタン」を描画
   - `signInWithGoogle`: 可能なら GIS の prompt → ダメなら Firebase `signInWithPopup` / `signInWithRedirect`
   - `handleRedirectResult`: リダイレクト戻りの処理（`bootstrapApp` 冒頭）
   - `onAuthChanged` → Firebase の `onAuthStateChanged` をそのまま公開

2. **`app.js`（Studio UI）**
   - `getStudioAuthMarkup` / `renderStudioAuthSlot`: ナビ用・モバイル用の **2 スロット**に同じパターンを描画
   - **GIS スロット**（`#gis-btn-studio-nav` 等）+ **フォールバック** `data-auth-signin-fallback` → `signInWithGoogle()`
   - **ステージング限定** `email-auth.js`: `isStagingEmailLoginEnabled()` のときフォーム表示 → `signInWithEmail`
   - `updateAuthUI`: ログイン状態で `[data-auth-required]` の disabled と `auth-guest` クラス
   - `onAuthChanged` コールバック（`app.js` 末尾）: `state.user` / `state.uid` 更新、`renderHomeDashboard`、URL `?id=` からの `loadProject`

3. **後方互換**
   - `window.toggleAuth`: シンプルに Google サインイン／サインアウト（ナビ以外から）

**読み順の目安**: 認証まわりを追うときは `gis-auth.js` の `signInWithGoogle` → `app.js` の `bindStudioAuthSlot` → `bootstrapApp` の `handleRedirectResult` + `initGIS()`。

## ブート順序（`bootstrapApp`）

1. `initUIChrome`（リボン・モバイルバー等）
2. `handleRedirectResult`（リダイレクトログイン完了）
3. `initGIS()`（GIS 初期化 — ボタンはまだコンテナが無い場合もあるので、以降 `renderStudioAuthSlot` で `renderGISButton`）
4. ローカル autosave 復元（`?id=` が無いとき）
5. `refresh` / `renderHomeDashboard`
6. URL `?room=` があれば `switchRoom`

## Library / Viewer とのログイン一貫性

同一 Firebase `auth`・同一オリジンでのセッション共有の前提と、画面ごとの UI 差は **[auth-unified-surfaces.md](./auth-unified-surfaces.md)** を参照。

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `js/gis-auth.js` | GIS・Firebase 認証の実体 |
| `js/email-auth.js` | ステージング用メールログイン |
| `js/firebase-core.js` | `auth` インスタンス |
| `js/press.js` | Press room の中身 |
| `js/works.js` | Works room の中身 |

## 次のリファクタ候補（Phase 2）

- `switchRoom` と `getCurrentRoom` を `studio-shell.js` 等へ抽出
- `renderStudioAuthSlot` 周りを `studio-auth-ui.js` へ抽出（`app.js` から認証マークアップを分離）
