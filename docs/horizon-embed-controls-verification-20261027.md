# 全画面の利用可否・赤いページバー（2026-10-27）

- ユーザー実機確認: 前回の対策後、iPhone SafariでReaderが別タブに開き、戻る操作で元のJimdoタブへ戻れる。
- 対象作業ツリーは `horizon-publishing/dsf`、branch `codex/horizon-publishing`、HEAD `96b7a05`。既存未コミット変更を維持。
- 埋め込みの全画面ボタンを、Fullscreen APIとdocument.fullscreenEnabledの両方が使える場合だけ表示。表紙・読書中に適用。実際のリクエストが拒否された場合も以後非表示。全画面中の終了操作は保持する。
- ボタンのhidden属性が既存inline-flexに上書きされないようCSSで明示。ページ送りの固定位置は維持。
- 共通ページバーの既読・表示中・現在ページを赤系へ変更。未読は灰色、見た目3px・操作領域44pxを維持。

## 配信

- staging deployment: `ddcf428a`。
- `viewer-hbfOmpcK.js` / `viewer-nDDPeIJb.css` は配信実体とdistのバイト一致。
- 検証用ホストの `fullscreen-check.html` を追加し、iframeのfullscreen許可あり／なしと360・390・430・720pxの切替を提供。ホストdeployment `0f1483c4`、既存検証ページを保持。
- mainマージ、本番反映、コミット、発行データ・許可ドメイン変更なし。

## 検証

- verify-embed-reader-navigation: APIなし、許可なし、利用可能、全画面中の終了、拒否などが成功。verify-reader-embed、verify-viewer-page-segment-control、構文、staging build成功。
- IABで実際にfullscreenを禁止した390px iframeを表示。表紙と読書中に全画面ボタンがAX tree・画面の両方から消え、ロゴとページ送りが残ることを確認。
- キーボードで読む→次へを操作して1/2→2/2へ移動。赤いバーが更新。360・390・430pxで画像確認。現在ページはrgb(218,16,38)、高さ約2.997pxを直接表示のDOMでも確認。
- 720px iframeでfullscreen許可を有効にするとボタンが表示され、全画面開始・終了が実際に成功。
- 画像: `outputs/embed-controls-20261027/390-no-fullscreen-red-bar.png`、`430-red-bar.png`、`720-fullscreen-available.png`。
- Chromeの検証iframeは読み込みが進まなかったため、Chromeでは合格とせずIABで検証した。iPhone Safariの今回のボタン非表示・赤色は実機未確認。幅変更は実機タッチ検証ではない。
