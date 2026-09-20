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
APIはまだ無効。検証用作品の準備と実操作確認を進行中。

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

## 参照

- [Unit Eの移行・保持・復帰契約](private-authoring-storage-unit-e.md)
- [Firebase AuthのIAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)
- [FirestoreのIAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore)
- [Cloudflare公式ツールのremote bindings](https://developers.cloudflare.com/workers/wrangler/api/#parameters-1)
