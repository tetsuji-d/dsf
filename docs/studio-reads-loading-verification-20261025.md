# リーズ取得の再修正と検証 — 2026-10-25

## 問題の再確認

iPhoneの添付画像では、フォルダ件数が未確定のまま取得期限に達していた。前日の画面世代・認証判定の修正とタイムアウト表示だけでは解消していなかった。

修正前のstaging `v2026.10.24-145353` をChromeで確認した。通常回線の更新は1,902msで非公開30件を表示したが、遅延300ms・上下64,000 bytes/sの回線制限では、画像と同じ `EDITION_LOAD_TIMEOUT` の案内を再現した。画面は `outputs/reads-load-20261025/before-timeout.png` に保存した。

コード上の問題:

- 一覧に不要な編集本文を含むProject文書と、Release・公開snapshotの全文を取得していた。
- `getDocsFromServer` の待機を外側の期限で打ち切っても、元のFirestore SDK通信は中断できなかった。更新ボタンでも同じSDK通信基盤を再利用していた。
- Homeにある既存の軽量な取得経路と違い、リーズ側は一覧用の項目指定を使用していなかった。

iPhone実機の通信ログは取得していないため、端末固有の停止原因を特定したとはしない。今回確認したのは、同じ時間切れ症状の低速回線での再現と、その条件での修正後の成功である。

## 変更

`js/edition-list-reader.js` を追加し、リーズ／Homeの版一覧をFirestore RESTの項目指定付き読み取りへ切り替えた。

- 編集本文のblocks・pages・sections等を取得せず、タイトル・発行日・状態・表紙選択・旧版互換に必要な項目を取得する。旧v1表紙選択用の `dsfPages` は維持。
- 250文書ずつカーソルで読み切り、部分取得を全件数と表示しない。
- ログイン中のFirebase ID tokenを使用する。従来と同じFirestore Rulesによる読み取りであり、管理者権限・新たな公開API・Rules変更はない。
- 要求ごとに8秒の期限を設け、トークン待機・HTTP要求・応答本文の待機を制限。中断時は実際のfetchをAbortする。
- 通信切れ・一時的なサーバーエラーは1回だけ再試行。401／403は再試行せず、ログイン／権限の案内を出す。
- 取得全体には30秒、画面には35秒の上限を設ける。単に上限を延長した修正ではなく、本文転送の削減と通信中断・新規要求での再試行を合わせて実装。
- 認証セッション・世代の検査、30秒のメモリーキャッシュ、変更時の無効化、現在のスペースによる絞り込みを維持。
- RESTのDateと既存SDK Timestampの双方から発行日を解釈する。
- 通信切れ・認証失敗・権限不足を区別して案内する。

参考仕様: [Firebase REST認証とRules](https://firebase.google.com/docs/firestore/use-rest-api)、[StructuredQueryの項目指定とカーソル](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery)。既存の `js/project-list-reader.js` にも同方式の一覧読み取りがあるが、今回その実装は変更していない。

## 最終staging

- バージョン表示: `v2026.10.24-150909`
- デプロイ: `4f7b6f81`（完了を確認）
- https://staging.dsf-studio.pages.dev/studio?room=works
- 固定URL: https://4f7b6f81.dsf-studio.pages.dev

## 実ブラウザー確認

Chromeで回線と画面幅を変更して操作した。以下の時間は操作開始から行表示の確認までで、操作ツールの費用を含む少数回の観測値。速度保証ではない。

| 条件 | 結果 |
|---|---|
| 修正前・出版スペース・低速条件 | 15秒の取得期限に達し、一覧なし |
| 最終版・同じ出版スペース・同じ低速条件・PC 1440px | 4,333msで非公開30件。公開5／限定公開3／非公開30／アーカイブ0が一致 |
| 最終版・マイスペース・同じ低速条件・スマホ390px・更新3回 | 3,788／3,572／3,463ms。毎回非公開1件、他フォルダ0 |
| 最終版・スマホ幅・オフライン | 通信切れの案内を表示。未取得を0件と表示しない |
| オフラインから低速接続へ戻し「更新」 | ブラウザー再読み込みなしで3,718msで非公開1件へ復帰 |
| スペース切替→Home→リーズ | マイスペースと出版スペースの表示範囲を確認。最後は元の山口出版へ戻した |
| 日時・固定URL | 先頭版の発行日時とURLが修正前の値と一致 |

証跡は `outputs/reads-load-20261025/` に保持:

- `before-timeout.png`
- `slow-refresh-samples.json`
- `offline-message-mobile.png`
- `my-space-mobile-final.png`
- `publishing-space-pc-final.png`
- `build.log`

スマホ幅とPC幅で画像も確認した。今回の主変更は取得処理であり、前日の全幅・明暗テーマ検証をすべて繰り返したものではない。**iPhone実機／Safariでの再確認は未実施**。

## 自動確認と変更境界

合格:

- `verify-edition-list-reader.js`: 項目指定、ページ送り、所有者パスと応答の検査、認証・権限エラー、再試行、実要求のAbort、停止した応答本文、遅れたトークン、セッション変更、Date、旧URL・公開snapshot・廃棄途中を含む一覧組み立て。
- `verify-edition-list.js`
- `verify-edition-list-cache.js`
- `verify-edition-reads-session.js`
- 構文検査、差分の空白検査、stagingビルド。

作業ブランチは `codex/horizon-publishing`、HEADは `96b7a05`。既存の未コミット変更・未追跡outputs・別Writing作業ツリーを保持。公開状態や作品内容の変更、コミット、mainマージ、本番反映、Rulesデプロイは行っていない。
