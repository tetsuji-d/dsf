# 非公開R2原稿保存 — Unit A（純粋モデル）

2026-09-19。基点: main `4c4c8d8`。

後続のAPI実装と最新の検証結果は [Unit B](private-authoring-storage-unit-b.md) を参照。

## 現在の実装範囲

`js/private-authoring-storage.js` に、原稿snapshot、保存先descriptor、版更新の比較判定を追加した。
Studio、Firebase、Pages Functionsにはまだ接続していない。現在の保存仕様は引き続き
[cloud-save-contract.md](cloud-save-contract.md) と [data-model.md](data-model.md) が正本。
R2バケット、Firestore schema／Rules、既存原稿、DSP／DSF、Viewerの動作は変更しない。

方針はFirebase Authを維持し、移行対象のProject v6の完全な編集JSONを非公開R2へ置くこと。
管理metadataはFirestoreに残す。D1への全移行はこの実装に含まない。

## 保存データ

`createPrivateAuthoringSnapshot(project)` は明示的なProject v6だけを受け入れる。
事前にJSONの容量・深さ・件数を検査し、既存 `prepareProjectForSave()` で検証・正規化する。
`blocks` のFixed／Flow順序、FlowDocument v1/v2、注釈、翻訳本文とtranslationState、
言語key、本文の空白・改行・Unicode、許容される未知拡張を保持する。
Fixedの互換 `sections`／`pages` は既存の保存契約に従う。v5の自動変換は行わない。

snapshotの `json` はuploadする正確な文字列で、`sha256` はそのUTF-8 bytesのSHA-256、
`byteLength` はその長さ。ETagとは別物。objectのkeyを辞書順、arrayを元の順序で直列化し、
同じ保存内容ならプロパティ挿入順が違っても同じhashになる。RFC 8785形式を名乗るものではない。
戻り値は入力から切り離して再帰的にfreezeし、hash計算中に次の編集が混入しない。
アップロード時には `project` を再直列化せず、`json` のUTF-8 bytesを使用する。

原稿rootにある以下の運用fieldだけを明示的に除く。ネストされた同名のauthoring拡張は保持する。

- `lastUpdated`, `updatedAt`, `createdAt`, `dsfPublishedAt`, `publication`
- `authoringBackend`, `authoringStorageVersion`, `authoringRef`, `authoringSchemaVersion`
- `generationId`, `revision`, `revisionId`, `objectKey`, `sha256`, `byteLength`
- `storageVersion`, `projectSchemaVersion`, `baseRevision`, `committedAt`, `leaseExpiresAt`

原稿rootの `auth`, `currentUser`, `idToken`, `accessToken`, `refreshToken` と生成ページ等は拒否する。
Flow内のruntime／翻訳provider情報は既存のvalidatorに従って拒否する。
これは任意のstate全体から秘密情報を探して除去する仕組みではない。呼び出し側は既存の
authoring envelopeを構築すること。未知拡張を保持するため、入力全体をstateとして渡してはいけない。

JSON以外の値、循環参照、sparse array、array拡張、getter、symbol、非列挙データ、
`__proto__`／`constructor`／`prototype` keyは明示的に拒否する。
保存上限案をモデル内で次のとおり固定する。旧Firestore経路の850 KiB guardは維持する。

| 対象 | Unit Aの上限 |
|---|---:|
| 非圧縮UTF-8 JSON | 16 MiB（16,777,216 bytes） |
| descriptor／headのJSON | 16 KiB |
| JSON深さ（root=0） | 64 |
| JSON値の訪問数（object／arrayも1件） | 250,000 |

これらは運用上限の候補であり、R2サービスの上限ではない。
Workersと実端末の負荷測定前に本番の保存上限として有効化しない。

## 保存先と読込

trusted scope `{ uid, projectId, generationId }` と保存要求IDから次のkeyを生成する。

```text
users/{uid}/projects/{projectId}/generations/{generationId}/revisions/{revisionId}.json
```

各IDは英数字・`_`・`-`の1〜128文字に限定する。`revisionId`は将来のAPIの`requestId`と同じ値。
既存IDとの適合とサーバー側のID採番はUnit Bで確認する。
任意URLやobject keyを採用しない。snapshotのprojectIdとscopeも一致を要求する。
UIDの認証・所有者確認はこのモデルでは行わず、将来の認証済みサーバーcontextから渡す。

保存descriptorは `storageVersion:1`, `projectSchemaVersion:6`, `generationId`,
`revisionId`, `objectKey`, `sha256`, `byteLength` の厳密な集合。headはこれに正整数の
`revision` を加えた純粋な値。時刻、lease、削除状態などのFirestore document全体は
まだ定義しない。descriptorの形式検査は、実データのhash確認やアクセス権検査の代わりにはならない。

`readPrivateAuthoringSnapshot(bytes, descriptor, scope)` は、scope、長さ、SHA-256、
UTF-8、JSON、既存schema、正規化済み表現を検証してから原稿を返す。途中失敗で原稿を返さず、
空原稿や公開用projectionへのfallbackをしない。読込途中のbytes／descriptor／scope変更にも影響されない。

## 版更新の純粋判定

`planPrivateAuthoringCommit()` は、candidate descriptor、現在head、baseRevision、
信頼済みscope、projectStatusから、次のいずれかを返す。入力の更新やI/Oはしない。

| 条件 | 判定 |
|---|---|
| active、新規保存、baseRevision=0、headなし | revision=1のcommit候補 |
| active、baseRevision=現在revision、内容変更あり | 次revisionのcommit候補 |
| 現在headと同じrequest ID・descriptor・元baseRevision | replay（同じhead） |
| 新request ID、baseRevision一致、SHA-256とサイズ一致 | unchanged（同じhead） |
| 同じrequest IDで内容／baseRevisionが異なる | 拒否 |
| 古いbaseRevision、世代不一致、削除中／削除済み | 拒否 |
| 安全な整数の範囲を超えるrevision | 拒否 |

異なる2要求が同じbaseRevisionから保存しようとした場合、片方のhead更新後にはもう片方を拒否する。
同じhashでも古いbaseRevisionは拒否する。削除後の再作成は新generationにし、旧要求を拒否する。

これはトランザクションの代わりではない。**Unit B以降でFirestore transaction内から
最新のhead・世代・削除状態を読み直してこの判定を行う必要がある。**
過去headに対する再試行の結果照会、同一request IDの永続的な再利用防止、unchanged要求の受付記録、
lease失効、遅いR2書込と削除の競合は、後続のoperation台帳・adapterが担当する。
過去のcommit receiptを返す場合も、現在headを古い版に戻してはいけない。

## 検証と次の実装単位

`npm run verify:private-authoring-storage` で以下を実データで検証する。

- Fixed／Flow混在、注釈、翻訳状態、未知拡張、改行／Unicodeの往復と非変更性
- hashの決定性、非同期処理中の編集からの分離、運用fieldの除外
- 日本語10万字＋英語／韓国語／中国語それぞれ10万字（合計約100万bytes）の復元
- 16 MiBちょうどと1 byte超過、多バイト容量、深さ・件数・不正JSON
- 未知schema、runtime混入、scope違い、欠落／破損、古い版・世代・削除状態

Unit Bではサーバー認証、非公開bucket adapter、原稿API、operation台帳、R2条件付き書込と
Firestore transactionを実装・検証する。画像の `blob:` URL解決はその接続前に既存の
asset処理と整合させる。このJSONモデルは画像の存在・URL有効性・所有権を保証しない。
続いてRules／Studioへの接続、公開・削除・復元、既存原稿の移行・保持期間を別単位で扱う。

今回のUI変更はなく、実ブラウザーでの保存操作／R2接続／配備は未検証。

### 実行結果（2026-09-19）

- 新規 verifier: 14件すべて成功。長文fixtureは1,002,633 UTF-8 bytesで復元一致。
- `verify:flow-project-model`, `verify:flow-model`, `verify:flow-translation-state`: 成功。
- 追加JavaScriptの構文検査と差分の空白検査: 成功。
- `verify:project-persistence`: line 325の `data-testid="flow-source-card"` を
  `js/sections.js` に要求する静的UI検査で失敗。main `4c4c8d8` の既存検査と実装が
  一致していない。今回、既存JavaScriptと当該verifierには差分がなく、新規moduleを
  既存runtimeへimportしていないことを確認した。この検査全体の成功は主張しない。
- build／UI操作／ネットワーク接続は実行していない。Unit Aはruntime未接続の純粋モデル。
