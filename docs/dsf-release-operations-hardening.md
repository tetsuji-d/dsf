# DSF Release Operations Hardening

最終更新: 2026-09-05

この文書は、DSF delivery v1/v2 の公開運用を安全にする Unit P3 の契約をまとめる。Project／Work／Release schema、Firestore Rules、R2 object はこの単位では変更しない。

## 1. 所有者用 R2 棚卸し

- 棚卸しは Works の所有者が明示的に実行したときだけ開始する。Works 表示だけでは R2 一覧や Release 履歴を取得しない。
- `GET /release-inventory` は Firebase ID token を検証し、token から得た uid の `users/{uid}/dsf/` だけを R2 `list()` する。呼び出し側から prefix や uid は指定できない。
- response は path、byte数、upload時刻、許可した MIME／cache／DSF hash metadata に限定する。object body、token、任意custom metadataは返さない。
- cursorを使って上限付きでページングする。一覧が最後まで取得できていない場合は `complete:false` とし、「保存実体が無い」という判定を行わない。
- endpoint と UI のどちらにも R2 object の削除、更新、上書き操作を置かない。

## 2. 分類と保持方針

棚卸しは R2 path を Project／Work／Release／`public_projects` と照合し、次のように分類する。

| 分類 | 意味 | 現在の扱い |
|---|---|---|
| `published` | 公開indexが現在のReleaseを参照 | 保持。欠損やmetadata不整合は修復対象 |
| `current` | ProjectまたはWorkが現在のReleaseを参照 | 保持 |
| `historical-release` | Release履歴として正規に残る | 保持 |
| `detached-release-history` | ReleaseはあるがProject／Workとの接続が失われている | 人による確認 |
| `referenced-release-missing` | 参照はあるがRelease documentが無い | 削除せず修復 |
| `recent-untracked-upload` | Release documentが無く、uploadから7日未満 | partial uploadの可能性があるため待機 |
| `aged-untracked-upload` | Release documentが無く、uploadから7日以上 | 人による確認 |
| `untracked-upload-unknown-age` | Release documentも安全なupload時刻も無い | 人による確認 |

分類結果は常に `safeToDelete:false` である。「確認候補」は削除許可を意味しない。

将来削除を追加する場合は別の承認単位とし、少なくとも完全な再棚卸し、server側での参照再検証、十分な保持期間、対象一覧の人間承認、監査記録、失敗時の再開設計を必須とする。

## 3. 公開URLのRelease固定

- 新しい共有URLは `/viewer?work={workId}&r={releaseId}` を生成する。
- `r` は `public_projects/{workId}.releaseId` と完全一致する「現在公開中のReleaseの固定値」である。
- 不一致、不正ID、公開indexにRelease IDが無い場合は fail closed とし、別Releaseやowner専用履歴へfallbackしない。
- `r` の無い既存URLは v1/v2 後方互換のため維持する。
- 匿名の過去Release閲覧やrollbackはこの公開URL契約に含めない。所有者専用の過去版プレビューは下記P3-2Aとして分離する。再公開には current／active Release と監査の設計が必要である。

## 4. 再試行診断

Press／Works の失敗表示には、生のError message、stack、token、payload、receipt本文を出さない。表示可能な診断は次に限定する。

- `retry-safe` / `refresh-required` / `blocked`
- 検証済みcodeとpath
- 完了file数／総file数
- 検証済みrelease storage path
- 接続先の許可済みerror code

`retry-safe` のみ同じ操作を再実行できる。`refresh-required` は最新状態を読み直してから、`blocked` は原因を解消してから実行する。

## 5. private／draftのR2境界

`draft`／`private` は `public_projects` を削除してHorizon一覧と通常Viewer URLから閉じる。ただし現在のR2/CDNは immutable public URLを知っている者への物理的な失効を保証しない。この棚卸し機能もその境界を変更しない。

物理遮断が必要になった場合は、signed URL、認証proxy、または参照を再検証する削除jobを別設計する。production migrationもstaging acceptanceと人間の明示承認後に別途行う。

## 6. P3-2A: 読み取り専用のRelease履歴

- Worksの各Workで履歴を開いた時だけ、`users/{uid}/works/{workId}/releases`を取得する。ProjectがなくてもWorkに残る履歴を表示する。
- 日時のない旧Releaseを落とさないためdocument ID順で25件ずつ取得し、取得済みの範囲を発行日時の降順に表示する。全件取得前の全履歴の日時順は保証しない。
- Release ID、日時、version、言語・言語別ページ数、容量、記録されたhash、Release由来のサムネイル、最新発行版と現在公開中の版を区別する。Projectの可変サムネイルを過去版へ流用しない。
- 「保存実体を検証」は選んだReleaseだけを対象とする。既存inventory client／storage audit／v2 loader／byte・font verifierを組み合わせる。Viewer loaderのJSON検証をDOM不要の`loadDsfHorizonReleaseBundle`として共用する。
- 完全なinventory取得後、参照file集合、byte数、MIME、v2のimmutable cache・保存hash metadata、JSONのRelease hash、WebP実体・寸法・保存hash、利用font実体を検証する。言語別fixedText／WebP数は検証したmanifestから求める。固定テキスト本文は画像へ置換しない。
- 取得は最大2,000リクエスト／256 MiB。上限、通信失敗、旧v1の根拠不足は判定保留とし、欠損に読み替えない。中止、パネル閉鎖、所有者変更、Works再読込時には古い結果を破棄する。
- 容量はDSF配信fileのみで、サムネイル・共有fontを除く。v2の表示hashはcontent indexのSHA-256でありZIP全体のhashではない。サムネイルの実体可用性は画像表示に委ね、整合性検証の対象に含めない。
- v1は既存URL・言語別容量・WebP実体を照合する。発行時のhashがないためv2と同等のhash保証を表示しない。旧URLや容量情報が不足したReleaseを更新・補完しない。

`projectReleaseHistory`はIO・時計を持たないpureな判定で、明示された時刻、Account、Project、Work、Release、公開index、対象metadataに結び付いた検証結果を入力とする。所有者・ID対応、現在のアカウント条件、Workの作品タイトル、v2サムネイル契約、発行当初の掲載開始日を維持した現在の公開期間条件も照合する。結果は「再公開可能な候補」「不可能」「判定保留」と許可リスト内の理由だけである。Projectがない履歴は実体確認できるが、再公開候補・プレビューにはしない。P3-2Bでは操作直前に再取得・再判定し、競合防止と監査を別途実装する必要がある。

所有者プレビューは`/viewer?draft={projectId}&r={releaseId}`。所有者認証後にProject／Work／Releaseの対応を検証して指定版を読み、最新Releaseへfallbackしない。`r`なしの所有者preview、匿名の現在公開版URL、v1配信は維持する。過去版にはReleaseの配信snapshotだけを渡し、DSPやFlowDocumentは渡さない。所有者変更時に本文・font session・プレビューを消去する。

履歴モジュールのFirestore操作はserver readのみで、account bootstrapや公開期間reconcileを呼ばない。Worksを開く際の既存bootstrap／期限調整処理とは別である。既存Rulesのowner readを使用し、schema／Rulesは変更しない。再公開・active切替・rollback・削除ボタンは追加しない。

ローカル検証: `verify:works-release-history`、既存owner preview／public release route／v1-v2 loader／Works transitionを確認。開発専用`/scripts/fixtures/works-release-history.html`では実UIの正常・空・通信失敗・不完全結果・所有者変更後の消去を確認した。fixtureの検証結果は模擬値であり、stagingの実Firestore／R2を通したacceptanceは別途必要。fixtureはVite build inputに含まれず、DEV以外では実行しない。
