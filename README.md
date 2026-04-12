# DSF Studio & DSF Library

**DSF（Digital Spread Format）** は、スマートフォン向けの**固定レイアウト型**デジタル出版のためのオープンな ZIP ベース仕様です。リフロー型の EPUB とは異なり、「レイアウトはコンテンツである」という前提で、9:16 比率の **WebP** ページなどをマスターとして配信します。

このリポジトリは **DSF Studio**（制作）、**DSF Library（ポータル）**（配信・一覧）、**Viewer**（閲覧）をひとつのクライアント SPA として実装しています。

## ドキュメント

- **[CLAUDE.md](CLAUDE.md)** — フォーマット思想、エコシステム、インフラ、モジュール構成、開発コマンド
- **[PROJECT_STATUS.md](PROJECT_STATUS.md)** — 実装済み機能・既知課題・TODO
- **[docs/file-format-spec.md](docs/file-format-spec.md)** — `.dsp` / `.dsf` ZIP 構造

## 実行方法

ローカルファイルを直接 `file://` で開かず、開発サーバー経由で動かしてください。

```bash
npm install
npm run dev
```

ブラウザで表示された URL（通常 `http://localhost:5173`）を開きます。

## レガシー表記について

資料によっては **DSF** を旧称「Digital Smart Format」、拡張子 **`.dsf`** の説明と併記している箇所があります。現在のプロダクト定義では **Digital Spread Format** を正式名称とします（`.dsf` 拡張子は変更しません）。
