# 非公開R2原稿保存 — Unit D（公開・削除・復元）

2026-09-19。`codex/private-authoring-model`。Unit A–Cに続く実装。
APIは無効のままステージングへ配備する。実プロジェクト移行、private bucket作成、secret設定、本番配備は行わない。

## writerの接続

| 操作 | 移行済みProject | 従来Project |
|---|---|---|
| Studio本文保存・読込 | Unit B/C API。listing情報のみ必要な場合に追加更新 | 既存Firestore保存 |
| Press v1/v2下書き | 保存済みheadを固定し、実R2配信ファイル検証後にroot/summary/Work/Releaseと公開行削除を同時確定 | 既存batch/transaction |
| Works公開・非公開・公開期間・期限切れ再調整 | 現在のaccount/planとReleaseからサーバーが公開投影を構成 | 既存transaction |
| MyPage公開プロフィール同期 | account.publicProfileを再読込して公開行へ投影 | 既存更新 |
| Works／Project一覧から削除 | root/summary/公開行を同時削除、controlをdeletedへ | 既存削除 |
| 一つ前の原稿へ復元 | previousHeadを読み、通常保存プロトコルで新revisionを作成、再読込 | 対象外 |
| 管理画面の旧式公開snapshot再同期 | 拒否。作者のWorks経由で更新。運営による公開行削除は維持 | 既存権限を維持 |

`GET /api/projects/{projectId}/actions` はhead、metadata mutationRevision、直前revision ID、公開状態を返す。
`POST` は型付き操作のみ。任意のFirestore path/patchやR2 object keyを受け付けない。
requestId/generationId/baseRevision/mutationRevisionで同時更新を検出し、同じ要求の再試行は確定結果を返す。
ただし後続の保存・公開操作がある場合、古い結果を現在の成功状態として返さず409で停止する。
復元要求の再試行は同じsnapshot／保存要求を使い、R2やrevisionを重複作成しない。

## 公開と容量

- 作者の停止・失効・公開制限・プラン権利をサーバーで確認する。
- v1は作者／Work／Releaseに一致する実WebPと管理thumbnailを確認する。
- v2は実R2 metadataとreceipt、content/manifestの実bytes・SHA-256・schema・font宣言、ファイル集合を検証する。
- 検証はR2 bindingを直接使用。caller URLへの任意の外部fetchは行わない。
- 原稿の任意拡張fieldは公開投影に含めない。公開用book/meta等の既存契約は継続する。
- v1の配信ページ一覧との互換性のためroot/操作結果は700 KiB、actions入出力は768 KiBを上限にする。
  Dashboard summaryは32 KiB、非公開原稿JSONは16 MiB。本文をrootへ戻す変更ではない。
- listing容量は原稿JSONの正確なbyteLengthと既存画像サイズ計測の合算。取得不能な画像容量は従来同様0。
  復元直後の一覧集計は次のStudio保存で再計算する。R2予約quotaとは別の表示用値。

## 削除・復元の境界

削除後はcontrolを保持し、古いクライアントのroot再作成をRulesで拒否する。
R2オブジェクト、head、各台帳、Work/Release、旧authoring childは保持する。物理削除と保持期間はUnit E。
公開画像の既知URLからのアクセスを、この論理削除だけで即失効するとは扱わない。
復元は原稿のみの一つ前の保存版が対象。公開済みReleaseを差し戻さない。
通信が未確定の操作は開いている画面内で再試行できる。ブラウザー終了後の操作再開は次の移行運用単位で扱う。

## 検証

- `verify:private-project-actions`: 8シナリオ。v1/v2の下書き・公開・非公開・profile・listing・削除、
  競合、失効、公開制限、owner不一致、復元応答喪失、R2実データ検証、REST deleteを確認。
- 原稿API 24件、client 12件、保存モデル14件、Rules emulator 65項目が成功。
- 関連するProject/summary/Press/Works/公開期限/thumbnail/Viewerロードの検査を実施。
- 既存persistence検査の古いUI selectorを現在の`flow-generated-thumb`に修正。
- staging Vite build、Pages Functions build、workerdで3ルートの既定無効状態を検証。
- ローカル専用ブラウザーfixtureで実firebase.js/client/APIを操作。
  10万字×4言語、1,001,045 bytesを保存してCloud保存済み表示を確認。
  一つ前の「試験原稿」へ復元しrevision 2→3、R2 put 2→3、直接Firestore原稿書込0を確認。
  削除後の再保存は停止し、原稿objectは増えない。
- fixtureのAuth／Firestore／R2はローカル代替。実アカウントでのprivate API有効化・IAM疎通、
  実Press→公開までの外部接続を通した操作検証は未実施。Unit Fで行う。

## 配備順

1. 現在のステージング配備コミットを取り込み、既存UI／WebMCPを維持して再検証。
2. A–Dの変更をコミットし、Cloudflare Pagesのstagingへ配備。
3. preview変数`AUTHORING_API_ENABLED="false"`と実HTTP応答を確認。
4. Unit Eで実データ移行、保持、孤立object処理、rollback手順を実装。
5. その後のUnit FでRules配備・private binding/secret・限定allowlist・実環境疎通を確認して段階的に有効化。

通常の新規プロジェクトは引き続きFirestore保存。D1へのデータ移行はこの実装に含めない。
