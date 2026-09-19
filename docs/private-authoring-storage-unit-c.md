# 非公開R2原稿保存 Unit C — Rules / Studio接続

実装日: 2026-09-19。Unit A/Bと同じ `codex/private-authoring-model` 作業ブランチ。
ローカル実装・検証まで完了。クラウドの設定変更・移行・Rules配備・コミットは行っていない。

## 実装

- `js/private-authoring-client.js`: FirebaseユーザーのID tokenを取得して同一origin APIへ接続。
  応答はサイズを制限して読み、headのscope・SHA-256・サイズ・schemaを検証してから原稿を返す。
  tokenは保持・保存せず、原稿にもAPI操作状態にも埋め込まない。
- `js/firebase.js`: rootに移行markerがある場合だけAPIへ分岐。部分的なmarkerや未知のversionも
  旧Firestore経路へ戻さない。従来の850 KiB制限は旧Firestore v6にのみ適用し、R2はUnit Aの16 MiB制限。
- IndexedDBバックアップを先行。移行済みの本文はクライアントのFirestore batchへ入らない。
  未解決画像は既知の画像fieldのみを解決し、失敗時は参照を空文字へ変えず保存を止める。
  画像URL解決結果は開いているセッション内で再利用し、元のlocalImageMapを維持する。
- 正常にクラウド版を開いたセッションだけが保存可能。世代・版番号・保存要求ID・未確定JSONは
  authoring stateやDSPへ入れず、セッション内に保持する。ローカル復元は新しいクラウドbaseを取得した扱いにしない。
- 応答不明時には元の要求IDを照会し、必要なら同じbody/base/IDを再送。照会結果の現在headが
  既に別の版なら競合として停止する。未確定の保存を片付けるまで次の編集を新規要求で送らない。
  lease切れや競合を新しい要求IDで自動回避しない。
- `js/state.js`の外部カウンターでProject読込・認証変更を区別。同じProjectのローカル復元でも旧応答を破棄。
  読込競合はstate反映前に止める。編集中の変更は直列保存loopで継続し、古いsnapshotの成功だけで保存済み表示にしない。
- `flushSave`はクラウド失敗時にrejectする。呼出元がローカル保存だけをクラウド成功と扱うことを防ぐ。
  競合／再読込が必要／未有効／画像失敗／容量・形式／通信失敗の保存表示を分けた。

## Rules

- migration markerの付与、移行済みrootの更新・削除、旧authoringの読込・書込をクライアントから拒否。
- root markerだけでも、controlだけでも保護する。controlを墓標として残した欠落rootは旧IDで再作成できない。
- head/control/要求台帳/usageは、所有者を含む全クライアントから直接読み書き不可。
- 移行済みsummaryはAPIのみが更新する。関連Work/Release/public listingの通常クライアント書込はUnit Dまで拒否。
  現在と変更後の関連先を確認し、WorkのprojectId差替えで制限を回避できないようにした。
- 未移行v5/v6の保存・読込・atomic削除、公開された配信データの読者アクセス、既存staffの管理権限は維持。
- Rulesはサービスアカウントを認証する仕組みではない。API側の所有・失効・停止チェックとIAMが必要。
  [FirebaseのRules条件とサーバーアクセスの説明](https://firebase.google.com/docs/firestore/security/rules-conditions)を参照。

## 検証

| 検証 | 結果 |
|---|---|
| `verify:private-authoring-client` | 12件。実API handler/serviceと接続し、応答喪失・再送・競合・期限・破損・失効・セッション変更・画像解決・改ざんreceiptを確認 |
| `verify:private-authoring-rules` | 55件。実Firestore emulatorで旧クライアント拒否、他UID、匿名、保護marker、旧形式の正常batchを確認 |
| `verify:private-authoring-api` / `verify:private-authoring-storage` | Unit Bの24件 / Unit Aの14件を再確認 |
| `verify:private-authoring-local` | 実workerdのR2 adapterとPages APIルートを再確認 |
| 一覧summary・Rules静的検査・dual-write・既存summary Rules emulator | 成功 |
| Flow Project / translation state | 成功 |
| staging向けローカルビルド | 成功。既存の静的／動的import重複の警告あり |

### ブラウザー操作

`npm run dev:private-authoring-fixture` で127.0.0.1:8797に起動するローカル専用画面を使用。
実際の `js/firebase.js` とstate、IndexedDB、client、API handler/serviceを使用する。
Firebase SDKの接続境界は検証用に置換し、Authは固定の偽ユーザー、Firestore/R2はメモリー内の検証用store。
製品ページや通常のビルドからこのfixtureを読み込まない。

computer-useで読込・入力・保存ボタンを操作して確認:

1. 10万字×4言語を保存。JSON **1,001,045 bytes**、localの日本語本文100,000字、Cloud保存済み表示。
   もう一度クラウド版を開いて100,000字を確認。原稿の直接Firestore書込0件。
2. commit後に成功応答を失う条件では「クラウド未保存」と表示。再保存は要求照会で復旧し、
   revision 2 / R2 put 2のまま増えずにCloud保存済みへ変化。
3. 他画面相当の更新後は競合で停止。手元の14文字とローカルバックアップを維持。
4. 同じProjectのローカル復元からの保存はRELOAD_REQUIREDで停止。API書込は増えない。
5. 保存中の画面切替後はSESSION_CHANGEDになり、切替先の保存表示は変わらない。

### 再現方法

依存パッケージがインストール済みのcheckoutで:

```text
npm run verify:private-authoring-client
npm run verify:private-authoring-rules
npm run verify:private-authoring-api
npm run verify:private-authoring-storage
npm run verify:private-authoring-local
npm run build:staging
npm run dev:private-authoring-fixture
```

Rules runnerはインストール済みJDK（JAVA_HOMEまたはPATH）と
`~/.cache/firebase/emulators/cloud-firestore-emulator-v*.jar` を利用する。
JARはFIRESTORE_EMULATOR_JARで指定可能。自動download・cloud projectへの接続はしない。
127.0.0.1:8199を使用し、実行後に自分で起動したemulatorを終了する。
WindowsでのJava起動はコンソールを表示しない。日本語localeでのemulatorエラー表示不具合を避けるため英語localeを指定。

## 残る境界

- 実ユーザー／実IAM／実Cloudflareへの疎通、実際のprivate bucket設定、Rules配備、負荷・課金計測は未実施。
- APIは引き続き既定で無効。明示した最大20件の検証用allowlistだけを受け付ける。
  このUnitでプロジェクト作成・移行・世代生成を追加していないため、一般の新規保存は従来形式のまま。
- 一覧thumbnail、画像を含むprojectBytes、pageCountはUnit Bの既存値維持方針を継続。
  JSONの正確なサイズはprivate head.byteLength。公開／一覧投影の残るwriter契約はUnit Dで統一する。
- ローカル復元内容と競合するクラウド版の自動merge、ブラウザー終了をまたぐ未確定要求の再開は実装しない。
  ローカル原稿をDSP等へ退避してからクラウド版を開き直す。
- Press／Works／削除・復元のAPI接続はUnit D、移行とretention/cleanupはUnit E以降。
  それらが完了するまで一般プロジェクトを移行しない。
- 既存 `verify:project-persistence` は、変更前から存在する
  `js/sections.js` の `data-testid="flow-source-card"` 静的検査不整合で失敗する。
  Unit A/Bで記録した同じ失敗であり、本Unitで当該ファイル・検査は変更していない。
