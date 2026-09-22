# 出版スペースの招待とアプリ内お知らせ — 第1単位

2026-09-22。ユーザー承認の順序: 招待と通知の保存・承諾を先に実装し、作品取得・保存の認可を揃えてから実サービスの参加を有効にする。

## 現在地

- `server/publishing-invitations.js` は永続ストアを注入するサーバー処理。既存の Firestore transaction adapter の getMany/set 契約を使用する。
- 招待、受信通知、一覧インデックス、監査記録を同一トランザクションで保存する。失敗時に通知だけ／招待だけを残さない。
- 本番・staging の Pages route、Firestore接続、Rules、Studio/Horizon本体のベルはまだ追加していない。既存の個人原稿APIは所有者専用のまま。
- `allowActivation` は既定 false。実サービスの共有認可が完成するまで承諾を拒否する。環境変数だけで実サービスの共有を開放する実装はない。
- localhost:5200 の確認画面のみ、専用テストアカウントで参加・メンバー保存まで確認できる。保存は outputs/invitation-fixture-5200.json。再起動しても復元する。
- このJSONはクラウド正本でも配信物でもない。検証アカウント切替、検証用ハンドル、Bearer fixture-* はローカル検証専用。実サービスへ転用しない。
- メール送信、メールリンク、メールアドレス検索、汎用メッセージ／返信、公式投稿、課金通知は未実装。

## 利用者の操作

1. 登録済みの招待先を確認し、閲覧／編集と対象範囲、有効期限を選ぶ。
2. 確認画面から招待を確定する。相手の個人受信箱へ通知が届く。
3. ベルの数字は未読数。ベルの一覧を開くだけでは既読にしない。個別の通知を開くと既読になる。
4. 招待内容を確認し「承諾して開く」または「辞退する」を選ぶ。既読は承諾を意味しない。
5. 送信者はメンバー管理の招待一覧で参加待ち／参加済み／辞退済み／取り消し済み／期限切れを確認する。

通知と招待は別の正本。招待状態は通知閲覧時に正本から取得し、古い通知から期限切れ・取り消し済み招待を承諾できない。
現在は受信者への招待通知のみ。送信者への承諾通知は後続のイベント種類として追加可能。

## 保存契約（実クラウド未接続）

既存DSP/DSF形式、原稿の所有者、保存パス、公開作品には変更しない。

| パス | 内容 |
|---|---|
| publishing_invitations/{invitationId} | 宛先UID、招待者UID、spaceId、role/grants、表示名snapshot、有効期限、状態、確定者／日時、冪等署名 |
| users/{uid}/notifications/{invitationId} | 宛先UID、category: invitation、type: space.invited、招待参照、作成日時、readAt |
| users/{uid}/notificationState/inbox | 新しい順の通知ID、未読数 |
| publishing_invitation_indexes/{spaceId} | 新しい順の送信招待ID |
| users/{uid}/spaceInvites/{spaceId} | 同じスペース・宛先の直近招待ID。同時に複数の参加待ち招待を作らない |
| users/{uid}/spaceMemberships/{spaceId} | 承諾時のUID、役割／範囲、参加日時、元の招待ID |
| users/{uid}/invitationUsage/current | 日単位の作成回数 |
| publishing_invitation_audit/{invitationId}_{event} | created/accepted/declined/cancelled の操作者・宛先・時刻 |

表示文は任意HTMLとして保存しない。typeと参照先からJA/ENのUIで生成する。個別ユーザーの既読状態は端末をまたいで共通。
受信箱はスペースを切り替えても同じ個人受信箱。宛先はGoogleメール文字列ではなくDSF UIDに固定する。

## サーバーの検証

- 呼び出しごとにトークン検証とlive identityを確認し、usersの停止／保留状態をtransaction内で確認する。
- 招待作成は現在の所有者／管理者のみ。管理者が別の管理者を作ることは不可。
- 宛先の有効アカウント、自己招待禁止、既存active membership、未処理の重複招待を確認する。
- 作品・レーベルはサーバーの `validateScopeTargets` で当該スペース所属を照合する。ブラウザーの名前やtargetIdだけを信用しない。
- 承諾は宛先本人だけ。招待者の現在の権限／停止状態、期限、対象の所属を再検証する。既存のactive権限を上書きしない。
- 作成の再試行は同じidと同じ内容のみ。同じidの異なる内容は競合。同じ確定操作の再試行は重複membership／監査を作らない。
- 承諾と取り消しの競合はtransactionで先に確定した側のみ成功する。
- read操作は本人のreadAtと未読数のみ更新する。通知の作成や宛先の書き換えをクライアントへ許可しない。
- HTTP入口は既定無効、同一Origin、POST JSON、Bearer、16KiB制限、no-store。検証用認証は本体サーバーに含めない。

## 初期の運用上限

招待の期限は1〜30日または無期限。UIは1日・3日・7日・14日・30日・無期限から選び、既定7日を維持する。APIの `expiryDays: null` が明示的な無期限指定で、保存する `expiresAt` も `null`。省略・0・文字列は受け付けない。無期限でも取り消し・辞退ができ、承諾時の最新権限照合は通常どおり行う。確認用Viewerリンクの最大180日とは別の期限。
招待作成は1アカウント1日30回、同じスペース・宛先の参加待ちは1件まで。
一覧は20件ずつ。第1単位のIDインデックス上限は受信箱／スペース各1,000件。超過時は黙って古い記録を消さず、新規作成を停止する技術上限であり料金プランではない。
通知・監査の自動削除はまだ実施しない。一般提供前にインデックスの分割／保持処理を追加する。通知の整理と招待・権限の監査保持は分ける。
表示中・ダイアログを閉じている場合の30秒更新、ウィンドウへの復帰、ベルを開く操作で再取得する。OS通知・Web Pushは使わない。

## 次の接続単位

1. 既存の handles/{handle} を使う完全一致の招待先確認を実装済み。実アカウント接続は後述の認可経路完成後。全利用者／メールアドレスの検索を公開しない。
2. members/labels/work所属のサーバー正本を確定し、共有作品の一覧・本文・画像・保存・履歴・書き出し・WebMCPを同じ権限で保護する。
3. 実Firebase認証とFirestoreへ接続。readAtを含めAPI管理とし、既存Rulesの拒否境界を検証する。
4. 実Studio/Horizonの共通ヘッダーへベルを接続し、承諾後に許可されたスペース／作品を開く。検証アカウント切替を含めない。
5. 複数の実テストアカウントで拒否・失効・既存原稿保持を確認してから共有を有効にする。

## 検証

- `npm run verify:publishing-invitations`: 保存原子性、復元、本人以外の拒否、未読独立、期限、権限再検証、競合、再試行、上限、ページ送り、既定の承諾禁止。
- `npm run verify:publishing-invitations-browser`: 実Chromeで作成・確認・受信・既読・辞退・取り消し・承諾後画面・reload、JA/EN、キーボード、390/320px。
- `npm run dev:publishing-invitations`: localhost:5200 の確認画面。


## 第2単位: ハンドル照合・共有原稿の認可（2026-09-22）

`server/publishing-space-directory.js` と `server/shared-authoring.js` を追加。

- 招待先は既存の `handles/{handle}` と `users/{uid}.publicProfile.handle` を突き合わせる。完全一致のみ、公開名・handle・UIDだけを返し、Google名・メール・課金状態などを返さない。成功・未検出とも毎分20回の照合上限へ計上する。
- ユーザーが固定候補を選ぶ試作を、@sato/@suzuki の入力・相手確認・招待内容確認へ変更。
- 参加後は実際のmembershipに基づき対象作品だけを一覧する。非許可作品は件数・ページングにも含めない。サムネイル・本文・R2キーはこの一覧に含めない。
- 新しい作品対応表は `publishing_work_scopes/{workId}` の spaceId/ownerUid/projectId/workId/labelId。レーベルは `publishing_labels/{labelId}`、一覧は `publishing_space_catalogues/{spaceId}` の workIds。
- 対応表だけを信用せず、既存の所有者のpublishing/catalogue.assignments、Project root、Work rootも突き合わせる。移動や削除で古くなった対応表からはアクセスできない。
- 現段階で対応表の書込み・レーベル管理・スペース移管を一般ユーザーへ公開しない。fixture以外で正本を作成する管理APIは後続。
- `createAuthoringService` にサーバー内部限定のresolveAccessを追加。既存の所有者専用APIは渡さないため従来の境界を維持する。
- 共有側でもAuthチェックは実際の操作アカウントを確認する。保存先は所有者UIDのまま。原稿を参加者の保存先へ複製しない。
- 閲覧者の保存は拒否。保存予約時とR2 I/O後の確定時に権限を再検証し、途中の権限失効ではheadを更新しない。既にアップロードした未確定オブジェクトは公開せず、既存の孤立オブジェクト保持方針に従う。
- 取得時もR2 I/Oの前後で権限を再確認する。途中で失効したら本文を返さない。既に端末へ取得したデータまで取り戻す機能ではない。
- 共有保存の要求台帳にはactorUidを記録し、別人の要求IDによる確定結果の取得・再利用を拒否する。公開済みReleaseのsnapshotは本文保存で変更しない。

実クラウド接続は引き続き無効。現在の画像アップロードは公開R2 URLを返すため、これを非公開共有画像と見なして有効化しない。
次は画像の非公開取得・保存、対応表の管理と権限変更API、Studioの共有セッション／保存先、実認証の結合検証。
その後、作品の会話も同じworkId認可を使用する。チャットはこの段階ではまだ追加しない。

検証: `verify:shared-authoring` は招待承諾後の対象一覧と、実際のauthoring service + 検証R2による原稿取得・保存、I/O前後の失効、対象移動、保存先・公開状態保持、一覧の権限適用後ページングを確認する。


## 第3単位: 非公開画像と共有編集セッション（2026-09-22）

`server/shared-assets.js`、`server/shared-authoring-http.js`、`js/shared-authoring-session.js` を追加。
招待確認画面の参加後一覧に「原稿を開く」を接続し、検証専用の簡易エディターで本文・画像を保存／再取得する。
実Studioの全機能への接続・実Firebase／R2・デプロイ済みPages routeはまだ有効化しない。

- 共通HTTP入口は `SHARED_AUTHORING_ENABLED` が明示trueのときだけ動作。現在この入口を呼ぶのはローカルfixtureのみ。
- サーバーがspaceId/workIdから所有者・projectId・原稿世代を解決する。クライアントからR2キーや所有者UIDを受け取らない。
- 画像は専用の非公開bucketへWebPだけ保存。実RIFF構造・静止画・寸法・SHA-256を確認し、create-only保存後に実体を読み直す。最大25MiB・長辺7680px。
- 保存中も取得中も、R2 I/Oの前後で本人・所属・作品権限・原稿世代を再照合。失効したアップロードをreadyへ確定せず、画像を原稿から参照できないようにする。
- 画像は作品／原稿世代単位の参照。同じhashが別作品にあっても、その作品のready記録がなければ取得できない。
- 保存原稿の既知画像スロットでは `assets/private/<sha256>.webp` のみ許可。公開URL・外部URL・未解決blob・別作品／旧世代の画像は共有原稿の取得／保存を拒否する。本文中のURL文字列は変更しない。
- クライアントはBearer付きno-store取得後の実SHA-256を照合してobject URLへ変換する。保存時は専用参照へ戻し、blob URLをクラウドへ保存しない。
- 共有保存は既存の原稿保存・revision競合・要求ID再試行の仕組みを使用。所有者と操作者を分離し、個人領域へ複製しない。既存所有者APIの経路・既定値は維持。
- 画像リクエスト上限は所有者単位で毎分120回、アップロード毎分30回・日256MiB、予約容量1GiB／1万件。失敗した予約も容量へ計上し、一般提供前に回収処理を追加する。料金プランではない。
- 確認UIはPNG/JPEG/WebPを既存のCanvas WebP encoderで変換（長辺2160px、quality0.9）して追加。画像貼り付けにも対応。
- 閲覧者は原稿・画像の参照のみ。編集可から閲覧のみへの変更は保存前・権限確認時に検出。閲覧権限失効時は原稿を閉じてobject URLを破棄する。確認UIは表示中10秒ごとにも再確認する。
- 既に閲覧者が取得したデータの回収を保証する機能ではない。第3単位時点では競合保存を拒否するのみ。一人編集ロック／交代は第5単位で追加。リアルタイム同時編集は提供しない。
- fixtureの非公開画像・原稿オブジェクトは `outputs/invitation-private-objects-<port>.json` に永続化。HTTPからこのファイルを配信しない。

検証: `verify:shared-images`（認可、保存復元、作品分離、失効、破損、競合）、
`verify:shared-editor-browser`（招待から開く、本文保存、WebP画像追加、別閲覧者で再読込、権限変更、モバイル）。

次の段階: 実Studioの全編集・画像アセット・Undo/Redo・書き出し・WebMCPへ共有セッションを接続し、
私有画像のDSP/DSF書き出し時の実体解決、公開済み画像を持つ既存原稿の明示的な移行、
対応表／権限管理API・一人編集ロック・実アカウント結合検証を行う。
公開画像の旧URLは、この処理だけで非公開にはならないため自動移行しない。


## 第4単位: 実Studioへの共有セッション接続（2026-09-22）

`studio.html` / `app.js` の実エディターに共有原稿の読込・保存経路を接続。
`VITE_SHARED_STUDIO_ENABLED=true` とサーバー側の共有APIの両方が必要。
現時点で有効化するのは `npm run dev:shared-studio` のlocalhost検証のみ。
staging/productionのフラグ、Pages route、Rules、実アカウントの所属は変更していない。

- URLは `/studio?room=editor&sharedSpace=<spaceId>&sharedWork=<workId>`。
  サーバーで所有者／projectIdを解決し、ログイン中UIDは参加者のまま保持する。
- Flow本文、ページ・画像操作、Undo/Redoは既存Studioの処理を使用。
  読込・アカウント切替・権限変更の状態は保存原稿とは別のruntimeで管理する。
- 共有保存は所有者の非公開原稿APIだけを通る。参加者のFirestore原稿、
  `dsf_autosave`、端末内の最近の原稿へは複製しない。通信不能時も個人保存へ切り替えない。
  未保存変更の永続的な端末回復はまだ提供しない。
- 画像は既存Canvas WebP変換後、共有作品のprivate assetsへ保存する。
  貼り付け／AI取り込みが個人原稿用の `uid:null` を渡しても共有画像経路を優先する。
- 閲覧のみでは編集UI、本文入力、画像取り込み、Undo/Redo、保存を止める。
  ページ送り・ズーム・言語切替は利用できる。WebMCPは閲覧ツールだけを登録し、
  権限変更後の古いツール呼出も拒否する。AI側の編集許可では作品の権限を上書きできない。
- 表示中10秒ごと／復帰時／保存前に権限を確認。読み取り不能時、アカウント変更、
  ページ終了時は画像URLを破棄し、共有本文・履歴・AIツールを閉じる。
  個人原稿の読込失敗で共有原稿が個人の保存経路へ流れないよう、失効ガードを保持する。
- 共有セッション中の新規作成、DSP取込、別名保存、DSP/DSF書き出し、
  共有URL生成、過去クラウド版復元、Pressへの移動は今回提供しない。
  原稿を個人領域へコピーする操作・非公開画像の書き出し・公開フローは別単位。
- `scripts/serve-shared-studio-fixture.js` は実Studioの入口を使い、Auth/Firestore通信だけを
  ローカルfixtureへ置換する。テスト用UID・権限操作・状態読取はこのlocalhostサーバー限定。
  検証データはメモリー上で、再起動すると初期化する。

検証: `verify:shared-studio-browser` は実ChromeでFlow入力／保存／再読込、Undo/Redo、
PNG貼り付けからprivate WebP保存・復元、閲覧専用、旧AI呼出拒否、失効時の原稿消去、
390px幅を確認。外部AIクライアントや実Firebase/R2の結合検証を代替するものではない。

次の第5単位で一人編集ロックと交代を接続。実アカウントへの提供前に、所属・作品対応表を更新するAPI、
私有画像の書き出し／発行、既存公開画像の明示的移行も別途整備する。


## 第5単位: 一人編集と交代（2026-09-22、ローカル検証）

共有原稿は最初に閲覧専用で開き、「編集を開始」で編集権を取得する。
編集者がいる場合は名前を表示し、「編集の交代を依頼」から依頼できる。
編集者は「保存して交代」または「保存して編集を終了」を選ぶ。
保存失敗・保存中の追加変更がある場合は交代しない。受け取る側は「最新原稿を開いて編集」で
保存済みの最新原稿を読み直してから編集可能になる。未保存内容を持つ旧タブの再取得には破棄確認が必要。

- 編集権はアカウント + タブのランダムsessionId単位。同じアカウントの別タブも排他対象。
- 接続leaseは90秒。表示中10秒ごとのheartbeatは接続期限だけを延長する。
  本文などの変更時は`edited`を通知し、最後の編集から30分経過すれば他の編集可能メンバーが取得できる。
  閉じた／停止したタブは90秒後に再取得可能。ブラウザーの休止・バックグラウンド制限でも期限切れになりうる。
- 一つの依頼を5分間保持。依頼IDを指定して交代し、依頼先の編集権限も再照合する。
  古い依頼や権限を失った依頼者には交代しない。
- `/api/spaces/{spaceId}/works/{workId}/lock`のPOSTで
  acquire / heartbeat / edited / request / grant / cancel / release を受け付ける。
  `X-Shared-Session`と、保持者には`X-Shared-Lock`（fencing token）を要求する。
  tokenは保持者自身の該当タブだけに返す。共有の原稿PUT／画像POSTでは予約・I/O後の確定ともに照合する。
- ローカルfixtureのサーバー管理情報は
  `users/{ownerUid}/projects/{projectId}/authoringLocks/current`。
  schemaVersion、spaceId、workId、generationId、holder(uid/sessionId/name)、fence、expiresAt、
  lastEditAt、request(id/uid/sessionId/name/requestedAt)、lastEvent(action/uid/at)を保持。
  DSP/DSF原稿には含めない。lastEventは最終操作だけであり、完全な監査履歴ではない。
- 切断時はタブ内の本文・非公開画像URLを保持したまま閲覧専用にする。
  読み取り権限自体の失効・ログアウト時は従来どおり消去。端末再起動後の下書き復旧は未提供。
- 第5単位時点では個人owner-only保存APIの統合は未実施。第6単位で共有対象の個人経路からの変更を拒否する。
  現在は従来どおりlocalhost専用。実Firebase/R2、Rules、staging/production設定は変更しない。
- 作品内チャット、一覧のアクティブユーザー表示、編集者へのベル通知は別単位。
  今回の依頼／交代は原稿上部の操作欄で行う。

検証: `verify:shared-edit-lock`（競合取得、別タブ、token非開示、期限・30分未編集、権限、
R2保存中の交代拒否）、`verify:shared-lock-browser`（実Studioの別アカウントで保存・交代、
最新読込、旧タブ拒否、切断後の下書き保持・引継ぎ・破棄確認）、従来の共有原稿／画像／招待テスト。

## 第6単位: 所有者の旧経路からの上書き防止（2026-09-22）

- canonicalな `publishing_work_scopes/{workId}` の対応表で共有管理となった作品は、所有者も共有Studioで開く。
  個人原稿用URLから開いた場合、サーバーが照合したspaceId/workIdへ引き継ぎ、最初は閲覧専用になる。
  編集開始・交代・最新原稿の再読込は参加者と同じ経路を使い、所有者も自動取得しない。
- owner-only APIは共有原稿のsource取得・保存、新規作成要求の再試行、復元・下書き登録・公開変更・削除・
  プロフィール・一覧更新を拒否する。処理開始だけでなく、R2 I/OやRelease検証後の確定時にも照合する。
  共有用の発行・復元機能はまだ提供しない。
- 境界は現在の編集者の有無ではなく、共有作品の対応表。編集終了・lease切れでも個人経路へ戻さない。
  過去のlockが残り対応表が欠落／不整合の場合も拒否する。旧来の個人catalogueへのスペース所属指定だけでは
  共有管理へ切り替わらず、通常の個人原稿は従来どおり保存できる。
- 本番用Firestore REST adapterも、対応表・スペース・レーベルの照合に必要なルートを明示的に許可する。
  汎用adapterの既定の許可範囲は拡張しない。
- データ形式、Rules、staging/productionの設定、実作品の対応表は変更しない。
  実クラウド用の共有API公開、既存画像の非公開移行、対応表管理、実アカウント結合検証は引き続き別単位。
  管理者用の移行／復旧CLIはこの利用者向け制御の対象外。

検証: `verify:shared-owner-boundary`（途中の共有化、旧要求の再試行、対応表欠落、REST adapter）、
`verify:shared-owner-browser`（実Studioの旧URL、所有者から参加者へ保存・交代、旧所有者タブの拒否）。
ローカルfixtureの確認URL例: `/studio?room=editor&id=book_library&actor=owner`。
