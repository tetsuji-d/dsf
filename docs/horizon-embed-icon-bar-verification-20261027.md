# 読むアイコンとページバーの検証（2026-10-27）

## 変更

- 白い線画＋ドロップシャドウの「閉じた本→半開き→開いた本」3コマ。RTLではLTRを左右反転。青い背景・通常時の枠を廃止。キーボードのフォーカス表示は維持。
- 埋め込みバーは中央、表示1ページ幅の90%、高さ3px。未読は黒、既読・現在ページは `#ff0033`。ホバー位置までの未読は灰色。
- 共通ReaderのWebP／固定テキストサムネイルを埋め込みにも接続。見本は72×128px。ホバーでは移動せず、クリック／ドラッグ／キーボードで移動。
- 44pxのバー操作範囲とページ送りボタンを上下に分離。リサイズ・タブ非表示・フォーカス喪失でサムネイルとホバー表示を解除。
- 共通ページバーの色とホバー予告は通常Readerにも適用。バー幅の制限、サムネイルの拡大、ボタン配置は埋め込みに限定。

## 検証結果

- 構文検査: viewer.js / viewer-embed.js / viewer-page-segment-control.js 成功。
- verify-viewer-page-segment-control.mjs、verify-embed-access-refresh.mjs、verify-reader-embed.js 成功。
- build:staging成功。既存のbundle size警告あり。
- 最終staging: `73f6c7f1`。`viewer-DudR8QQ_.js` / `viewer-RFLCPI5g.css` はHTTP 200、ローカルdistとbytes一致。
- IABで実際の潮騒の図書館（RTL）を開き、透明背景・3フレーム・左右反転を確認。読む操作→本文表示、ホバーで固定テキスト見本と灰色部分を表示し、現在ページ1/10の維持を確認。バークリックで6/10へ移動、ページ送りボタンで1/10→2/10、RTLのArrowLeftで1/10→2/10を確認。
- 360／390／430px、720×430横向き、1280×800の画像を目視確認。ページ送りボタンとバーの44px領域は重ならない（浮動小数の境界誤差0.001px未満）。最終版でリサイズ後のpreview hidden=true、灰色マーク0を確認。
- `/icon-directions` の比較fixtureは実装SVG・CSSをそのまま使用。LTRとRTLの3コマすべての表示、方向の反転、reduced-motionで開いた本の静止表示を確認。fixtureは `embed-check` ブランチの `d00a0664` に配置。
- 証跡: `outputs/embed-icon-bar-20261027/`。最終ホバー画像は `final-hover-pc.png`。スマホ幅画像は端末実機ではなくブラウザーのサイズ指定。

## 範囲・未確認

公開されたLTR版の実データは今回使用せず、方向比較fixtureで確認。IABはtouch入力の直接再現に対応しないため、iPhone Safari実機でのタッチ操作は未確認。画面幅とキーボード・クリック操作の確認とは区別する。

出版物の本文、公開状態、許可ドメイン、閲覧数定義は変更していない。mainマージ・本番反映・commitなし。既存作業とoutputsを保持。
