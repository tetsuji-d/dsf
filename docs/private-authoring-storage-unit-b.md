# 非公開R2原稿保存 — Unit B（認証API・保存adapter）

2026-09-19。Unit Aと同じ `codex/private-authoring-model`、基点main `4c4c8d8`。
[Unit A](private-authoring-storage-unit-a.md) の保存モデルに、サーバー認証、R2、Firestore transactionを接続した。
**APIは既定で無効。クラウド資源の作成、Secret登録、Rules変更、Studio接続、データ移行、配備は行っていない。**
現在の稼働仕様は引き続き [cloud-save-contract.md](cloud-save-contract.md) を参照する。

## 追加した入口

| API | 役割 |
|---|---|
| `GET /api/projects/{projectId}/authoring` | 現在headを検証し、UTF-8原稿JSONを返す |
| `PUT /api/projects/{projectId}/authoring` | 原稿を検証・保存し、確定結果を返す |
| `GET /api/projects/{projectId}/authoring/operations/{requestId}` | 保存要求の結果を照会する |

共通で `Authorization: Bearer <Firebase ID token>` が必要。PUTのbodyはProject v6 JSONそのもの。
PUTには次のheaderを付ける。

- `Content-Type: application/json`
- `X-Authoring-Generation`: 読込済みのgenerationId
- `X-Authoring-Base-Revision`: 読込済みのrevision（初回だけ0）
- `X-Authoring-Request-Id`: 一意な保存要求ID。再送では同じID・本文・baseRevisionを使う

結果照会にも `X-Authoring-Generation` が必要。現在版GETは原稿bytesをそのまま返し、
`X-Authoring-Head` にJSON形式のheadを付ける。PUT／結果照会は `committedHead` と `currentHead` を
分けて返す。遅い応答や過去のreceiptからクライアントの現在版を巻き戻してはいけない。

全応答（エラーを含む）に `private, no-store` とCDN向け `no-store` を付ける。
異なるOriginは拒否し、CORS許可を返さない。query文字列へtokenを渡す方式は用意しない。
原稿やtoken、Google APIのエラー本文をログ・エラー応答に出さない。

## 認証と権限

既存画像uploadの検証関数を変更せず、原稿専用の検証を設けた。
RS256署名、alg／kid、issuer、audience、数値のexp／iat／auth_time、UIDを検証する。
公開鍵は固定されたGoogle JWK endpointから取得し、Cache-Controlのmax-ageに従って保持する。
ユーザー指定の鍵URLは使用しない。テナント付きtokenはこの初期実装では拒否する。

Firebase Authのaccount lookupでdisabledとvalidSince（失効時刻）を確認する。
R2 I/O後にも確認する。Firestoreのユーザー正本はUID一致かつ `status.disabled === false` を必要とする。
`moderationHold` は既存 `accountCanEdit` と同様、編集保存の禁止条件にしない。
利用者がbodyに指定したUID、公開状態、object key、Work ID等をアクセス権として採用しない。

サービスアカウントのOAuth tokenはWeb Cryptoの署名で取得し、期限内だけサーバーに保持する。
Firestore RESTとFirebase Auth account lookupだけに使用する。Firebaseの本番project IDへのfallbackはない。
Secret内のproject_idと明示設定したproject IDが一致しなければ停止する。

## 有効化条件（設定は未実施）

| 設定 | 意味 |
|---|---|
| `AUTHORING_API_ENABLED=true` | 明示的にAPIを有効にする。それ以外は503 |
| `AUTHORING_TEST_PROJECTS` | `["uid/projectId", ...]` 形式の検証専用allowlist、最大20件。全件許可の値はない |
| `FIREBASE_PROJECT_ID` | 環境のFirebase project ID |
| `AUTHORING_GOOGLE_SERVICE_ACCOUNT` | 同一projectの専用サービスアカウントJSONをSecretとして登録する |
| `AUTHORING_BUCKET` | 原稿専用の非公開R2 binding。既存の公開 `R2_BUCKET` と共用しない |

既存の `wrangler.toml` にはbindingやSecretを追加していない。
バケットのr2.dev・公開カスタムドメインを無効にすることは配備時の確認事項。
コードは別bindingであることを確認するが、Cloudflare管理画面上のバケット公開状態は判定しない。

専用サービスアカウントにはFirestoreの必要なread／transaction／create／update権限と
`firebaseauth.users.get` が必要。OAuth scopeはdatastoreとidentitytoolkitに限定する。
実IAM policyの作成と到達範囲の確認は未実施。サービスアカウントはSecurity Rulesを通らないため、
APIの所有者確認を省略できない。SecretはVITE変数、リポジトリ、フロントへ含めない。
鍵更新時は新Secretを登録してruntimeを更新し、疎通確認後に旧鍵を失効させる。

## 対象プロジェクトとサーバー専用document

APIはプロジェクトを新規作成・移行しない。以下を満たす検証用データだけを扱う。
本節は未配備のUnit B契約であり、稼働中Firestore schemaの変更ではない。

rootは `ownerUid`／`projectId` が一致し、以下のmarkerを持つこと。

```json
{
  "version": 6,
  "authoringBackend": "r2-private",
  "authoringStorageVersion": 1,
  "authoringRef": "authoringHeads/current"
}
```

rootに編集用 `blocks`／`sections`／`pages` が残っていれば拒否する。

| パス（project配下） | 内容 |
|---|---|
| `authoringControl/current` | storageVersion=1、generationId、status、initialized |
| `authoringHeads/current` | Unit Aのheadそのもの（確定revisionとimmutable objectのdescriptor） |
| `authoringRevisions/{requestId}` | state、要求descriptor、baseRevision、作成・lease期限・完了時刻、committedHead等 |

controlはheadが無い初期状態にも世代と削除状態を持たせるための別document。
`status === active` のときだけAPIを許可する。初期状態は `initialized:false` とheadなしを組み合わせ、
最初の保存でheadとinitializedを同時に更新する。一度initializedになった後のhead欠落は障害として停止し、
新規保存で原稿を作り直さない。controlや新headをブラウザーから書けるRulesは追加していない。
将来のRulesでは移行marker・root・旧authoring child・control・head・要求台帳・usageを一体として保護する。

UID全体の使用量は `users/{uid}/authoringUsage/current` に保持する。
プロジェクトを変えても使用量をリセットしない。

## 保存の確定

1. tokenを検証し、対象allowlist・account・root・controlを確認する。本文読込前に要求回数を確認する。
2. bodyを最大16 MiBのstreamとして読み、schema・容量・hash・projectIdを検証する。
3. transactionで最新headと同一要求の台帳を読み、世代・baseRevision・容量を確認してpendingを登録する。
4. `If-None-Match: *` とSHA-256付きで非公開R2へ格納する。既存objectも実bytesを読み直して照合する。
5. Authの失効・利用停止を再確認し、次のtransactionでもaccount・root・control・head・pending／leaseを読み直す。
6. head、control初期化、rootの編集由来metadata、一覧summary、関連Work metadata、要求結果を原子的に確定する。

R2 I/OはFirestore transactionの外で行う。R2成功だけでは保存成功にならない。
Firestoreの明確なABORTEDだけ最大3回まで再試行し、通信途絶など確定結果不明のcommitは自動再実行しない。
クライアントは同じ要求IDの結果照会／再送で確認する。

同一要求のpayloadやbaseRevision変更は409。同じ内容の新しい要求はbaseRevision一致時だけ
unchangedとして台帳へ記録し、R2 objectとhead revisionを増やさない。
同時に異なる要求が同じ版から保存した場合、確定できるのは1件だけ。
確認済みの競合はrejectedとして残す。leaseは2分で、再試行でも延長しない。
期限切れ・削除・世代変更後の遅い保存からプロジェクトを復活させない。

公開Release情報は常にtransaction内で読み直し、原稿snapshotから書き戻さない。
root／Workにはタイトル等の小さな明示allowlistだけを投影し、本文・未知拡張・任意metaを複製しない。
既存の画像込み `projectBytes`、生成ページ数、一覧画像は、JSONだけの値や空値で上書きしない。
Unit Bでは直前の値を維持し、Studio連携単位で更新契約を接続する。原稿JSONの正確な容量はhead.byteLength。
関連Workの所有者とprojectIdが変わっていれば全体を確定しない。

現在版取得は、R2 bytesの長さ・hash・schemaを検証し、読み込み後にも権限・世代・headを再確認する。
欠落・破損を空原稿や公開projectionへ置き換えない。

## コスト制御の暫定値

検証用の保守的な値。一般運用へ出す前に実際の保存頻度・CPU時間を計測して調整する。

| UID全体の制約 | 値 |
|---|---:|
| 全API要求 | 120回／分 |
| PUT要求（再試行・同一内容を含む） | 30回／分 |
| R2 upload試行のbytes | 256 MiB／UTC日 |
| 新規objectに予約した累積bytes | 1 GiB |
| 新規要求台帳の件数 | 10,000件 |
| 原稿JSON／head | Unit Aの16 MiB／16 KiB |
| root metadata | Unit B時点32 KiB。Unit Dで既存v1配信ページ互換のため700 KiBへ変更。summaryは32 KiBのまま |

失敗や未参照objectも保守的に予約容量へ計上する。後続の保持・掃除処理が確認して解放するまで、
自動でquotaを返却しない。新規objectを作らないunchangedでも要求台帳件数は制限する。
超過時は429を返す。これらはR2書込・原稿検証の連打を抑える仕組みであり、認証／Firestore確認自体の
全呼び出し費用を上限保証するものではない。一般公開時の入口での頻度制限と実測は後続の配備検証に含める。

## 検証結果と残る境界

- `verify:private-authoring-api`: 24件成功。実際に生成したRSA鍵による署名検証、必要claimの欠落、
  token改変、OAuth assertion、Auth失効・停止、Firestore REST契約、再送・競合・障害・lease・quotaを検証。
- `verify:private-authoring-storage`: Unit Aの14件成功。
- `verify:project-summary` と `verify:dsf-release-upload-endpoint`: 既存の一覧投影・公開画像uploadの検証成功。
- Pages FunctionsのWorkerビルド成功。
- `verify:private-authoring-local`: 実workerd/Miniflare上で両APIルートの無効状態と、
  R2への条件付き保存、同一objectへの再送、読込一致、scope違反、破損・衝突拒否を検証して成功。

ローカル検証は通常 `npm run verify:private-authoring-local` で実行する。
今回の分離worktreeには依存パッケージを重複インストールせず、既存dsf/node_modulesをNODE_PATHで参照した。
Wranglerのmultipart出力を読み解いて実workerへ渡す。R2 adapterもテスト用Worker内部で動かし、
NodeとWorkers間のHeaders型変換を検証結果へ混ぜない。

**実Google／Firebase／Cloudflareアカウントへの疎通、実IAM／Rules、公開バケット設定、ブラウザー保存UI、
Workersの課金対象CPUと16 MiB時の実端末負荷は未検証。**
Firestore transactionとAuth lookupはREST契約のテスト用応答で検証し、本番での成功を主張しない。
Unit Aで記録した既存 `verify:project-persistence` の静的UI検査不整合は今回も変更していない。

既知の画像fieldの未解決 `blob:` 参照はAPIで拒否するが、画像の存在・権利・完全復元を保証しない。
Studioからの画像URL解決、保存済み表示、ログアウト中の応答破棄、競合時のUIはUnit Cの範囲。
次はRules／Studio接続を進め、その後にPress／Works／削除・復元、移行・保持を接続する。
それらが整うまでは一般プロジェクトを移行せず、検証用allowlistを維持する。

## 実装の参照元

- [Firebase ID tokenの検証要件](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Auth account lookupと必要権限](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup)
- [サービスアカウントのOAuth](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Firestore batchGet](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet)、
  [commit](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit)
- [R2 Workers APIと条件付き書込](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
