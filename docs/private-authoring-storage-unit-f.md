# 非公開R2原稿保存 — Unit F（ステージング接続・実作品検証）

2026-09-20。作業ブランチ `codex/private-authoring-model`。

## 完了したUnit Eの配備

- コミット: `5307559`（移行・復帰・保持候補の処理、16ファイル）
- ステージング配備: https://8de5fcf3.dsf-studio.pages.dev
- 確認URL: https://staging.dsf-studio.pages.dev/studio
- 最新配備がUnit D `bf6b286`であることを確認してから配備した。
- 配備後、固有URLとstaging aliasのStudioがHTTP 200、成果物`studio-BvH10Wxn.js`を確認。
- authoring/actions/operation lookupは両URLとも503 `AUTHORING_API_DISABLED`、`private, no-store`。
- 既存のstaging buildが成功。既存のchunkサイズ・dynamic import警告は残る。
- 実ChromeでDashboard→Editor→Dashboardを操作し、page error 0件を確認。クラウド保存は行っていない。
- ブラウザー操作コネクターが接続失敗したため、既存検証と同じPlaywright/Chromeで上記画面操作を確認した。

## Unit Fの現在地

2026-09-20に下記の具体的な設定についてユーザー承認を取得。
非公開R2、専用サービスアカウントと2ロール、秘密鍵1個、Pages preview secretを準備した。
非公開bucketの公開URL無効とcustom domainなし、Pages production設定不変を再確認した。
公式remote bindingを使い、実R2が空の状態で読めることも確認した。
Unit EのRulesは`vmnn-26345-stg`へ配備済み。
専用テストアカウントと1作品を作成し、実R2への移行が成功。原稿3,910 bytes、バックアップ17,179 bytesを照合した。
この1作品だけでAPIを有効化し、実API・Studio/Press・Firestore復帰の検証を完了した。
検証作品をFirestoreへ復帰した後、previewのAPIをfalseへ戻す最終配備を行う。

最初の環境変更は自動承認審査で停止されたが、具体的な対象と権限を提示し、
ユーザーの「承認します」を受けて実行した。拒否の迂回は行っていない。

## 承認済みの具体的な変更

対象はFirebase **vmnn-26345-stg**、Cloudflare Pages **dsf-studio / preview**だけ。
Cloudflare account ID: `848858bc759252c0f167d4d0ddf788e9`。

| 項目 | 追加・変更する内容 |
|---|---|
| 非公開R2 | 新規 `dsf-authoring-staging`。r2.dev公開・custom domainなし。自動削除設定なし |
| 専用サービスアカウント | `dsf-authoring-staging@vmnn-26345-stg.iam.gserviceaccount.com` |
| IAM | 上記アカウントに`roles/datastore.user`、`roles/firebaseauth.viewer`をstagingプロジェクトで付与。Firestore全体へのデータ読み書き権限とFirebase Authの参照権限。Authユーザー更新権限は付与しない |
| 秘密鍵 | 上記サービスアカウントのRSA鍵を1個作成。Gitに含めず、ログにも出さない |
| Pages secret | `AUTHORING_GOOGLE_SERVICE_ACCOUNT`として**previewだけ**に登録。productionには登録しない |
| R2 binding | previewの`AUTHORING_BUCKET`を新規private bucketへ接続。公開画像用`R2_BUCKET`は従来のまま |
| Firestore Rules | Unit EのRulesを`vmnn-26345-stg`だけに配備 |
| 検証対象 | 専用テストUID `authoring_unit_f_20260920`、Project `unit_f_private_authoring_20260920`、Work `unit_f_work_20260920`。実利用者の既存作品は移行しない |
| 限定有効化 | `AUTHORING_TEST_PROJECTS`を上記UID/Projectの1組に固定し、疎通確認後にpreviewの`AUTHORING_API_ENABLED`をtrueにする |

IAMはFirestoreの文書単位では制限できないため、このサービスアカウントのデータ操作権限は
staging全体に及ぶ。作品単位の制限はサーバーの所有者確認・停止/失効確認・allowlistで行う。
既存のIAM bindingを維持し、etagを使って同時変更を上書きしない。
既存secret値を再送せず、追加するsecretだけをCloudflare APIで更新する。
本番IAM・本番R2・production変数・既存作品の内容は変更しない。

## 承認後の順序

1. バケット／サービスアカウント／必要な権限を準備し、非公開設定を読み直す。
2. preview secret/bindingとstaging Rulesを配備する。APIはまだ無効。
3. 検証専用UIDと1作品を用意し、既存IDがある場合は上書きせず停止する。
4. 一貫したinventory、バックアップ、移行計画を作成し、指定1作品だけを移行する。
5. 限定allowlistを設定してAPIを有効化。実Firebase ID tokenで認証、保存／読込／競合／拒否を確認する。
6. Studio/Pressで保存→読込→公開→非公開を確認する。
7. 最新原稿からFirestoreに復帰し、通常保存と遅延R2要求の拒否を確認する。
8. 検証終了後のAPI状態、テスト作品、保持バックアップ、鍵の保管先を記録する。

APIを無効にするだけでは移行済み作品を読めなくなるため、障害時は現headを確認し、
Firestore復帰またはR2修復を先に確定する。850 KiBを超える原稿は復帰時に停止する。
物理削除executor、quota返却、本番有効化はこの実行範囲に含めない。

## 実接続の検証結果

- Firebaseの専用テストUIDにcustom tokenでログインし、実ID tokenでAPIを通した。
  Googleログイン画面自体の検証ではない。専用SAにAuthユーザー変更権限は付与していない。
- 非公開R2への移行はrevision 1、3,910 bytes。型付きFirestoreバックアップは17,179 bytes。
- 日本語・英語・韓国語・中国語を各10万字、合計40万字、JSON **1,001,149 bytes**で保存・再読込し、
  4言語の本文とSHA-256が一致した。850 KiBを超える状態ではFirestore復帰が安全に拒否された。
- 同一内容の再保存はheadを進めず、古い版からの書込は409。保存要求の結果照会も成功。
  未認証は401、異なるOriginとallowlist外の作品は403。
- 実Chromeで本文を編集して**Cloud保存完了**を待ち、ページ再読込後の本文一致を確認。
  Local保存表示だけでは成功と扱わない。
- Studioの設定画面で検証作品を表紙なしにし、Pressで実WebPとサムネイルをアップロード。
  発行下書き→公開→非公開をUIで操作。APIと画像アップロードは成功、page errorは0件。
  公開行とReleaseに非公開拡張フィールドのsentinelが含まれないこと、非公開化後の公開行削除を確認。
- 最新revision **6**の原稿 **7,112 bytes**をFirestoreに復帰。復帰前バックアップは11,628 bytes。
  原稿SHA-256は`bf16498d4a66dbb546da639c455cf59b366d80f15fd2595542f906336dbb6034`で一致。
  Release `rel_mu93ubkf_uhzgc3`の内容と非公開状態を保持。復帰要求の再送も成功結果を再利用した。
- 復帰後の古いR2 PUTは409 `PROJECT_NOT_MIGRATED`。
  実ChromeでFirestore原稿に追記→Cloud保存→再読込の一致を確認、page errorは0件。
  R2 headはrevision 6のまま、controlは`rolledBack`。
- 実Firestore Rulesで、移行中の旧原稿、control、headの直接読込は403。
  復帰後は旧原稿の読込と通常保存が成功し、controlの直接読込は引き続き403。

### 実環境で検出した修正

Cloudflare Workersは`fetch`の`redirect: 'error'`を受け付けず、上流通信が503になった。
`1db73fa`で`manual`へ変更し、3xxを本文取得前に明示拒否するよう修正した。
認証情報をLocation先へ転送せず、秘密情報を含めない上流診断だけを記録する。
workerdの実Request生成と302拒否の回帰確認、ローカルR2確認、API 24項目が成功。
有効化した状態の実検証配備は https://fcb046e5.dsf-studio.pages.dev 。

検証用データの当初の「表紙あり・全1ページ」は既存の構成検査に正しく拒否されたため、
検証fixtureを「表紙なし」に修正した。製品の構成チェックは変更していない。
復帰検証スクリプトのエラー応答参照を`error.code`から実契約の`error`へ修正し、
復帰済み状態から残りの拒否・画面操作を確認した。復帰処理のやり直しや原稿の再移行はしていない。

### 再現用スクリプトと保管状態

- `operate-private-authoring-staging.js`: 固定した専用UID/Project/Workだけの操作。
  既存fixtureを上書きしない。実R2操作にはGit除外の公式Wrangler remote binding設定を使用。
- `verify-private-authoring-staging.js`: 新規移行直後のrevision 1専用。大きな原稿・競合・拒否を検証。
- `verify-private-authoring-studio-staging.js`: R2状態の専用作品で実Chromeから編集・発行・非公開化。
- `verify-private-authoring-rollback-staging.js`: 上記検証後のR2作品を復帰し、通常保存を確認。
  既に復帰した今回のfixtureへそのまま再実行しない。
- 実接続verifierは`DSF_RUN_STAGING_AUTHORING_TEST=1`が必須。Chrome検証はPlaywrightとChromeが必要。
  Playwrightを共有runtimeから使う場合は`DSF_PLAYWRIGHT_MODULE`でモジュール位置を明示する。
- 鍵は`secrets/authoring-staging.service-account.json`（Git除外）とPages preview secretに保持。
  値・ID token・生のrequest headersをログ／Gitへ出さない。
- 最終状態は**Firestore復帰済み・非公開・API false**。専用Authユーザー、非公開R2の原稿履歴、
  移行と復帰のバックアップ、サーバー台帳、サービスアカウントを保持する。
  R2の物理削除、quota返却、一般利用者への有効化、本番配備は未実施。
- 現状はFirebase Auth＋Firestoreメタデータ／既定原稿保存＋限定R2原稿機能。
  D1移行やFirebase Authだけへの縮小は今回の実装に含まれない。

## 参照

- [Unit Eの移行・保持・復帰契約](private-authoring-storage-unit-e.md)
- [Firebase AuthのIAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)
- [FirestoreのIAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore)
- [Cloudflare公式ツールのremote bindings](https://developers.cloudflare.com/workers/wrangler/api/#parameters-1)
