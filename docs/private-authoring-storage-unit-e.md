# 非公開R2原稿保存 — Unit E（移行・保持判定・復帰）

2026-09-20。`codex/private-authoring-model`、Unit D配備済み `bf6b286` からの追加実装。
この単位では移行処理と運用前の検証を実装した。実プロジェクトの移行、R2の物理削除、
Rules配備、private bucket作成、secret設定、API有効化、本番配備は行っていない。

## 実装の入口

- `server/private-authoring/maintenance.js`: 管理者専用の移行・復帰処理。
  HTTPルートやStudioからは呼べない。`authorize(scope, kind)` を必須依存とし、
  操作前とR2検証後に再確認する。実環境の管理者認証・環境固定・対象allowlistとの接続はUnit F。
- `server/private-authoring/maintenance-common.js`: 別の非公開R2 bindingへ、書き換え不可のバックアップを保存・再読込検証。
- `server/private-authoring/retention.js`: オブジェクト一覧と台帳から保持／候補／確認不足を判定する純粋関数。
  ネットワーク、削除、台帳削除、容量予約の返却は行わない。
- `scripts/inspect-private-authoring.js`: 手元のJSONから確認レポートだけを出力する。クラウド接続も適用コマンドも持たない。

## 移行プロトコル

1. Project v6のrootと`authoring/current`、account、summary、control/head、Work、
   現在のRelease、Work ID／Project IDの公開行を一貫したFirestore transactionで読む。
   owner、ID、世代、account状態を確認。v5を自動変換しない。
2. rootの非公開・未知fieldは移行後の公開投影から除外し、バックアップに保持する。
   原稿側の未知拡張、改行、空白、Unicode、多言語は保存モデルの契約で保持する。
   Studioと同じ既知の画像slotを調べ、未解決blob等があれば停止する。
   HTTPS参照の個数を報告するが、画像の実在確認を済ませたとは扱わない。
3. 対象・元データの更新時刻・バックアップ・コピー元を含む`planHash`を報告する。
   適用にはこのhashが必要。確認後に編集されれば再調査が必要になる。
4. 容量・操作数を予約し、10分のlease付きpending台帳を作る。
   Firestoreの型付きfieldと更新時刻を含むバックアップを非公開R2へ保存し、実bytesとSHA-256を再検証する。
5. 原稿JSONを新しい世代の`initial.json`へ保存し、読み直して一致確認する。
6. 再度認可と元データの更新時刻を確認。head/control/root/summary/保存台帳/移行台帳の確定と
   旧`authoring/current`の削除を、同じFirestore transactionで行う。

途中の変更は、内容を変更して元に戻した場合も更新時刻で検知する。
バックアップ・原稿の破損、失効、競合、期限切れ、容量超過では切り替えない。
Work、Release ID、公開状態、公開画像は変更しない。非公開原稿を公開行へ投影しない。
成功応答だけが失われた場合は、同じ世代・planHashから確定台帳を確認できる。

IDは既存APIと同じASCII英数字・`_`・`-`、1〜128文字。
対象外IDを勝手に改名しない。既存世代の再利用も行わない。

## バックアップと予約

R2 key:

```text
users/{uid}/projects/{pid}/migrations/{generationId}/migrate-{generationId}.json
users/{uid}/projects/{pid}/migrations/{generationId}/rollback-{requestId}.json
```

最大8 MiB。`format: dsf-authoring-maintenance-backup`、`version: 1`。
root、旧authoring child、control/head、summary、Work、現在のRelease、2種類の公開行について、
存在しない行も含めて保存する。Firestore timestampの小数秒を含む型付きfieldと更新時刻を保持する。
account全体や全Release履歴のバックアップではない。原稿が既にR2の場合は、検証済みコピー元descriptorを収録する。
バックアップは原稿と同じ非公開bucket内であり、別アカウントの災害復旧用コピーではない。

移行は原稿とバックアップの2件、復帰はバックアップの1件分を予約する。
同じpending要求の再試行は容量を二重予約しないが、試行byte数は日次quotaに加算する。
既存の256 MiB/日、予約1 GiB、操作10,000件/UIDの制限を共用する。
バックアップも保持し、予約を自動返却しない。継続運用前に掃除・返却処理を別途実装する。

期限切れや競合で残ったpending要求を強制確定する機能はない。
現在の正本と台帳を調査し、移行なら新generation、復帰なら新request IDで再調査する。
旧pendingの参照先とバックアップは保持する。

## 最新原稿からのFirestore復帰

`inspectRollback(scope, requestId)` → `rollback(scope, requestId, planHash)`。
昔のFirestoreバックアップをそのまま上書きするのではなく、現在のR2 headを読み直して使う。
最新版がFirestoreの850 KiB上限を超える場合は停止し、切り詰めない。
root metadataにはAPIと同じ700 KiB上限も適用する。
大きい原稿はR2側の修復、またはDSP退避を選ぶ。

復帰の確定は、root・旧authoring child・summary・control・復帰台帳・公開行のbackend marker除去を
一つのtransactionで行う。現在のRelease ID／公開状態は維持する。
`control.status = rolledBack` とrootの`authoringRollbackGeneration`を残し、
同じ世代の遅れて届いたR2保存要求を拒否する。head・R2原稿・台帳は消さない。

Rulesは、このserver確定済み世代の一致を条件に従来のowner保存を許可する。
rootのmarker除去・世代偽装・control直接書込は拒否する。
復帰後にrootとchildを削除してもcontrolを残すため、同じIDでの再作成は拒否する。
再びR2へ移行する際は新しい世代を使う。

このRulesはローカルで検証済みだが未配備。実移行・復帰の前にUnit Fで配備が必要。

## 保持候補の判定

- 現在版＋直前の実保存2版を保持する。内容が同じ保存のreceiptは版数に数えない。
- UTC基準で当日を含む直近30日、それぞれの日の最終版を保持する。
- 48時間以内のobject、保存／receipt再試行対象、有効pendingを保持する。
- 未完了の復元・移行・復帰が参照する原稿と、移行バックアップを保持する。
- `rolledBack`と`deleted`は、この単位では全objectを保持する。
  論理削除からの物理削除には、別途参照を外す確定処理が必要。

通常の履歴枠は最大33版相当だが、48時間猶予、pending、バックアップを含む総数の上限ではない。
一覧・台帳が不完全、参照不整合、別世代、未来の時刻、重複key、必須object欠落等なら
候補を全て`blocked`にする。正しい一覧でも`candidate`は削除許可を意味しない。
将来の削除処理では最新headとpendingをtransactionで再確認し、削除予約を確定してから削除する必要がある。
単純な「R2全体を30日で消す」設定は使用しない。

## オフライン確認の使い方

```powershell
npm run inspect:private-authoring -- migration private-inventory.json new-migration-report.json
npm run inspect:private-authoring -- retention private-retention-inventory.json new-retention-report.json
```

出力先を省略するとstdoutに確認レポートを出す。原稿本文は出力しない。
既存出力ファイルを上書きせず、入力は32 MiB以下に制限する。
入力自体は原稿を含む非公開情報なので、共有用レポートと分けて保管する。

移行入力は`{ scope: { uid, projectId, generationId }, documents: [{ path, document }] }`。
`document`はRESTの`{ fields, updateTime, createTime }`、存在しない場合は明示的な`null`。
`fields`はFirestore RESTの型付き形式。必要な行は`maintenancePaths`のaccount/root/control/head/legacy/
summary/usage/job/initialOperationと、関連Work、現在のRelease、公開行。重複や不足を拒否する。
実環境の一貫したエクスポート接続はUnit Fで追加する。

保持入力は`scope, control, head, nowMs, complete, objects, revisions, actions, migrations, rollbacks`。
`complete`の5一覧フラグは、全ページを読み切った場合だけtrueとする。
objectは`{ key, size, uploadedAtMs }`、各台帳は`{ id, data }`。
current世代に限定した一覧を渡す。旧世代は自動判定で削除せず個別調査する。

## 検証結果

- 移行・復帰11シナリオ：本文と型の保持、変更して戻す競合、障害再試行、応答喪失、
  最新版の復帰、850 KiB超過、同時保存／削除、失効、容量制限、破損、再移行。
- 保持・オフラインCLI 6シナリオ：UTC境界、世代・完全性、pending、48時間、
  削除済み／復帰済み、本文非出力、ファイル上書き拒否。
- Firestore emulator 94項目：実REST transactionによる移行→復帰→ownerの通常保存を含む。
  他人の読込、marker偽装、台帳書込、削除後の再作成を拒否。
- workerd/ローカルR2：条件付き保存・再試行・scope・破損、型付きバックアップの保存／一致確認。
  3つの原稿APIルートが既定で503のままであることを確認。
- 保存モデル14件、API24件、client12件、公開等actions8件、既存Project persistenceが成功。
- staging buildが成功。Studio成果物はUnit Dと同じ `studio-BvH10Wxn.js`。既存の分割・サイズ警告は残る。

実Firestore/R2アカウントのIAM、実ユーザーの認証、有効化後のStudio/Press操作は未検証。
今回の管理処理はUIに接続しておらず、ブラウザー操作で移行を実証したとは扱わない。

## 次のUnit F

Eのレビュー／コミット後、stagingだけを対象とする実接続を準備する。
Rules、private binding、secret、管理者認可、対象allowlist、一貫したinventory取得を接続し、
検証用1作品で移行・保存・読込・公開・復帰を通す。
停止時はAPI無効化だけではR2原稿を読めなくなるため、現headの退避・修復／復帰まで含めて確認する。
削除executor・容量返却・ブラウザー終了後のpending自動復旧は、この単位には含まない。
本番有効化や全作品一括移行は別の実行範囲とする。
