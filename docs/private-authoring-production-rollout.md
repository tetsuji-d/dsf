# 非公開R2原稿の本番移行

2026-09-20、ユーザーの「本番・既存作品の移行を進めて」に基づく。

## 配備と対象

現在の本番は`4c4c8d8`、Cloudflare deployment `41a86a5a`。
同じmainを起点に`codex/private-authoring-production`を作成し、Unit A–Eと通信修正だけを取り込んだ。
前回のstagingに含まれる他のFlow/WebMCP/UI変更は今回の本番配備に含めない。
作業ツリーをcleanにし、現行本番commitを祖先に持つことを確認して、
既存のsafe deployの`--skip-git-check`でこの専用配備版を指定する。
mainへの直接コミット・移動はしない。今後mainから配備する前に、このブランチの移行対応を統合する必要がある。

Firestore本番`vmnn-26345`のprojects全件を確認した結果、対象は同一所有者の2件。
ステージングの既存作品は今回の本番データ移行に含めない。

| Project | 保存形式 | 原稿JSON bytes | バックアップbytes | 現在のRelease |
|---|---:|---:|---:|---|
| R2に移行 | v5 root | 33,922 | 77,523 | rel_momt9ewy_i40cg8 |
| テスト１ | v6 authoring/current | 28,432 | 107,839 | rel_mtpvrp67_yfyd2c |

両方公開中。Project/Work ID、既存URL、Release、公開状態を維持する。
所有者と2作品の明示allowlist以外はAPIで拒否。新規作品の自動移行は実装しない。

## 本番専用構成

- private R2: `dsf-authoring-production`、r2.dev公開なし・custom domainなし。
- SA: `dsf-authoring-production@vmnn-26345.iam.gserviceaccount.com`。
- IAM: 本番で`roles/datastore.user`と`roles/firebaseauth.viewer`。Authユーザー変更権限は追加しない。
- RSA鍵1個。`secrets/authoring-production.service-account.json`とPages production secretに保管。
- Pages production `AUTHORING_BUCKET`と`AUTHORING_GOOGLE_SERVICE_ACCOUNT`。
- 公開画像用R2は`dsf-media`のまま。previewの既存設定は保持。
- `AUTHORING_API_ENABLED=true`、allowlistは上記2作品だけ。

## 互換性と復旧

既存IDに日本語が含まれるため、Unicode文字・数字・結合文字と`_-`のみ許可する。
区切り、dot、URL escape、制御文字は拒否し、IDの正規化・改名は行わない。
HTTP head JSONはASCII escapeしてレスポンスヘッダーへ安全に載せる。

v5の本文をv6に暗黙変換しない。元のversionをR2 descriptorにも保持し、読込時に一致確認する。
v5の派生sectionsも含め保存JSONを正規化し、R2で再読込できることを確認する。
既存原稿の全ブロック値（v5:255、v6:296）を原稿JSONと比較して一致を確認済み。

移行は一貫した文書取得、型付きFirestoreバックアップ、SHA-256照合、変更競合検出を経て確定。
コピーとバックアップを確認する前に旧原稿を削除しない。
復旧は最新headから行い、v5はroot、v6はauthoring/currentへ戻す。最新Releaseと公開状態を維持する。
850 KiB超のFirestore復帰は原稿を切り詰めず停止する。
物理削除・保存容量返却は今回行わず、移行前のバックアップと原稿履歴を保持する。

## 実行ツール

`operate-private-authoring-production.js`はFirebase project・所有者・2作品・generationを固定する。
`DSF_RUN_PRODUCTION_AUTHORING=1`と、inspect結果のplanHashがなければ実移行しない。
remote R2には検証済み公式Wrangler 4.135.0を使用し、
`DSF_AUTHORING_WRANGLER_ENTRY`でentryを明示する。Git除外のremote設定でproduction bucketを固定する。
inspect / migrate / inspect-rollback / rollback / statusを用意。
資格情報、原稿、raw API headersは出力・Git登録しない。

## 検証

保存モデル14、API24、client12、actions8、移行復元11、保持6、既存互換3が成功。
Firestore Rulesはローカルemulator 98項目が成功。v5復帰後のowner保存・他人の拒否・marker偽装拒否も含む。
workerd実行環境で日本語ID、v5原稿、R2条件付き保存・改ざん拒否・型付きバックアップが成功。
既存Project persistence確認とproduction buildが成功。
ローカルの実Chromeから、実Studio保存・読込モジュールでv5／日本語IDの本文編集→Cloud保存完了→再読込を確認。
page error 0、直接Firestore原稿書込0、本文一致。接続先はローカルfixtureであり、本番の操作検証ではない。

## 現在の停止位置

配備候補は`47a6fae`。本番配備を実行する直前の自動承認審査が、
本番Pages／Rules更新・API有効化と`--skip-git-check`の明示承認が足りないと判断して拒否した。
拒否されたコマンドは実行されておらず、別経路で配備していない。

停止後の読取確認で、本番deployment `41a86a5a`、Rules ruleset `907a381c-2a44-4c5f-a95d-819fc01793cc`、
2作品のFirestore保存と公開状態がすべて維持されていることを確認。
本番専用private bucket、SA／2ロール、RSA鍵1個、production secretの準備は完了済み。
`AUTHORING_BUCKET` binding、Rules、アプリ、原稿切替は未配備・未実行。

次の明示承認の対象は、この専用配備版から本番RulesとPagesを配備すること、
main限定チェックの例外を適用すること、バックアップ／hash再確認後に本番2作品だけを順次移行すること。
先にAPI疎通を確認し、移行後は原稿hash・既存Release／公開行／Viewerを照合する。
変更競合や不整合が出た作品は切替を進めず、完了作品もAPIを切る前に最新headの修復または復帰を行う。
