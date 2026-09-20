# 非公開R2原稿の本番移行

2026-09-20、ユーザーの「本番・既存作品の移行を進めて」に基づく。

## 配備と対象

移行開始時の本番は`4c4c8d8`、Cloudflare deployment `41a86a5a`。
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

## 配備前の承認記録

配備候補は`47a6fae`。本番配備を実行する直前の自動承認審査が、
本番Pages／Rules更新・API有効化と`--skip-git-check`の明示承認が足りないと判断して拒否した。
拒否されたコマンドは実行されておらず、別経路で配備していない。

停止後の読取確認で、本番deployment `41a86a5a`、Rules ruleset `907a381c-2a44-4c5f-a95d-819fc01793cc`、
2作品のFirestore保存と公開状態がすべて維持されていることを確認。
本番専用private bucket、SA／2ロール、RSA鍵1個、production secretの準備は完了済み。
`AUTHORING_BUCKET` binding、Rules、アプリ、原稿切替は未配備・未実行。

ユーザーに明示確認した範囲は、この専用配備版から本番RulesとPagesを配備すること、
main限定チェックの例外を適用すること、バックアップ／hash再確認後に本番2作品だけを順次移行すること。
先にAPI疎通を確認し、移行後は原稿hash・既存Release／公開行／Viewerを照合する。
変更競合や不整合が出た作品は切替を進めず、完了作品もAPIを切る前に最新headの修復または復帰を行う。

## 本番移行完了

上記の具体的な配備・main限定チェックの例外・2作品の移行について、ユーザーの「承認します」を受けて実行。
本番RulesとPagesを配備した後、原稿切替前の接続確認でPagesのroute parameterがURLエンコードされたまま
渡されることを検出。`d3be1a3`で1回だけデコードしてからIDを検証するよう修正した。
encoded separator、二重エンコード、不正escapeの拒否も回帰確認。

- 本番runtimeコミット: `d3be1a351de5a778dbf4e109d6301002f94810fe`
- 配備: https://5a46eef8.dsf-studio.pages.dev / https://dsf.ink
- Rulesは本作業ツリーの`firestore.rules`と本番配備内容の一致を読み取りで確認。
- 「テスト１」→「R2に移行」の順に、inspect済みplanHashを照合して1作品ずつ移行。
- 両方`authoringBackend: r2-private`、control active、revision **1**。元のv5/v6と日本語IDを維持。
- 実APIで移行前原稿と移行後原稿のSHA-256が一致。
  - R2に移行: `dcae3bd3ffb03d3ce43464e7d0fb742e9f76790815f9fcb97192b82215ed3a45`
  - テスト１: `5ed4be58d9524957829ad98e8b263850d8e2b11b81865d50495da7189f883c82`
- 両方の同内容PUTが`unchanged`で成功、revisionは進めない。未認証401、別Origin403、head直接読込403。
- 旧Firestore本文を除去し、rootにblocks/sections/pagesを持たせない。
  Work、Release、public_projectsの全内容を移行前スナップショットと照合し、一致を確認。
  公開行にblocks/sections/pagesは含まれず、引き続きpublic。
- 実Chromeで本番Studioの2作品を読込み、Worksの公開表示を確認。
- ログインなしの別ブラウザーcontextから既存のRelease付き公開URLを開き、両方**8ページ**を読込み。
  左右の読み方向に合わせた実キー操作でページを送り、画像読み込みも確認。page error **0件**。
- ブラウザー確認後も原稿はrevision 1。原稿編集・再発行・公開状態変更はしていない。
- R2内の移行前バックアップを再読込してbyteLengthとSHA-256を確認。
  バックアップは上表の77,523／107,839 bytesで保持。元の原稿オブジェクトも読み直し確認。
- 本番R2はr2.dev無効・custom domainなし、user-managed RSA keyは1個。
  本番APIは2作品だけ有効、preview APIは無効のまま。

ローカルの`secrets/production-live-before.json`に公開情報の比較用スナップショットを保持し、
`secrets/verify-production-project.mjs`、`verify-production-browser.mjs`、`audit-production-complete.mjs`で照合した。
これらの補助スクリプトは本作業の所有者・本番接続を扱うため、Git管理の固定対象operatorと区別する。

既に開いている旧版Studioは再読込して新しい保存経路を使用する。
本番既存2作品の移行は完了したが、新規作品の自動R2保存とmainへの統合は今回含めない。
今後の本番更新では必ずこの移行対応を保持する。API停止だけでは移行済み原稿を読めなくなるため、
障害時は最新headの修復／Firestore復帰を先に行う。

## 後続作業の完了

上記は既存2作品の切替時点の記録。その後、mainへの統合と新規作品のR2保存対応を完了し、
本番runtimeは91db176へ更新済み。preview APIも許可UIDに限定して有効化済み。
現在の配備・実画面検証・検証作品の片付けは[新規原稿保存の完了記録](private-authoring-new-projects.md)を参照。
