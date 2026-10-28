# 埋め込みの定期確認による点滅対策（2026-10-27）

## 原因と変更

`viewer-embed.js` は60秒ごと・タブ復帰時に公開状態を再確認する。従来は応答を待つ前に `embed-checking` を付けて本文と操作を隠していたため、閲覧可能なままでも点滅した。

通常の背景確認では直前に許可されたページを表示し続ける。拒否・通信失敗が確定した場合に隠し、一度隠した後は再試行中も隠したまま、許可を再確認できた場合だけ表示を戻す。設定revision変更時は非表示にしてdocument reloadを行い、CSPを再適用する。

## 検証

- `node scripts/verify-embed-access-refresh.mjs`: 成功。実際のcheckAccess関数をVMで実行し、応答待ち中の表示維持、同時確認の抑制、403/404/通信失敗、再試行中の非表示維持、復旧、連続失敗、revision変更時reloadを確認。
- `node scripts/verify-reader-embed.js`: 成功。
- `node --check js/viewer-embed.js`、`npm run build:staging`、`git diff --check`: 成功。既存のbundle size警告あり。
- staging deployment: `56046e59`。`viewer-D4W-Th8i.js` と `viewer-nDDPeIJb.css` はstaging GET 200かつdistとbytes一致。
- Chrome、1280×800、潮騒の図書館の `/embed/e_414b640db451798f8e76c22e29b67ec444656b0259b5dfef253b90cc9f30310f` で読む操作。Networkに4000ms latencyを設定し、実際の60秒timerによる `/api/embed` GET中に `embed-checking` がなく、canvas visibilityがvisible、エラー表示なしであることを確認。約4.1秒後に200応答、ページの表示継続を画像でも確認。
- IABの外部test host `https://embed-check.dsf-studio.pages.dev/fullscreen-check` の390px iframeで読む操作、表紙・3px赤バー・全画面不許可時のボタン非表示を目視確認。画像: `outputs/embed-refresh-20261027/390-reading.png`。

## 未確認・制約

- Chromeでオフライン時の実表示確認を開始したが、イベント取得中に操作接続がtimeoutし、その後 `Debugger unattached` となった。実ブラウザーでの失敗→再試行の結果は未確認。自動テスト結果とは区別する。
- この検証はChrome/IABであり、iPhone Safari実機の点滅解消は未確認。
- 出版物の公開状態・許可ドメインは変更していない。mainへのマージ、本番反映、commitは行っていない。
