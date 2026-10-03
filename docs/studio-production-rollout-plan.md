# Studio 本番反映の範囲・設定・権限ルール案

2026-10-03。調査基準: `codex/windows-file-preview` / `8ecbd04`。
作業場所: `C:/Users/tetsu/.codex/worktrees/review-boundaries/dsf`。

## 結論と承認境界

最初の本番候補は「本人の制作・保存・再開とダッシュボード」。所有者用の出版スペース、最近の作業、30日ゴミ箱を依存関係に沿って段階導入する。招待・個人共有・共同編集は含めない。新規発行のスペース所属必須化とレビュー権限修正も別の適用単位にする。

これは本番反映の推奨案。2026-10-03に設定分離と未提供機能の画面制御をローカル実装・検証し、初回ソース候補と段階別Rules候補を抽出した（未配備）。具体的な採用範囲・検証結果は[studio-production-candidate.md](studio-production-candidate.md)を参照。本書の作成は本番設定変更・Rules配備・mainへのマージ・本番デプロイの承認ではない。現行ブランチ全体をそのまま本番へ反映できる状態ではない。

旧Firestore原稿はユーザーの実験用として通常導線から隔離できる。ただし、削除・一括移行・復旧不能化の承認とは扱わない。移行済みprivate R2原稿を含む既存の読込・保存経路は保持する。

## 1. 比較対象と確認の限界

- 直前の本番監査で確認したPages配備: `91db176`、固定URL `https://94fed8ad.dsf-studio.pages.dev`。
- main: `2d957d3862cac461c6371c9d73740a91112f4674`。本番配備とは区別する。
- 本番配備から候補HEADまで185コミット・653ファイル差分。文書・検証・native試作も含む数で、全てが配信される意味ではない。
- ステージング配備済みコード: `ac63861` / `v2026.10.03-124632`。`8ecbd04`は後続文書。
- 作業ツリーは調査開始時に未追跡`outputs/`のみ。検証素材を削除・一括ステージングしない。
- 本書の設定表はリポジトリの設定と実装を照合したもの。2026-10-03に本番Rules本文を読み取り、`91db176`と一致することを確認した。IAM・Secret・設定上書きは再取得していない。実行直前にも実配備と照合する。
- 過去の日付の「未接続」「未配備」はその時点の記録。後続節と現在の実装を優先して判定する。

## 2. 反映範囲

| 単位 | 本番候補に含めるもの | 先送りするもの・条件 |
|---|---|---|
| A: 本人の制作 | 保存状態の表示、未編集の復元原稿に対する更新判定、クラウド読込表示、編集中カード・サムネイル、復元用コピーの専用導線、アプリ更新・インストール案内、本人所有のスペースと最近の作業 | 原稿の自動上書き・自動統合なし。未公開機能の入口を隠す準備が必要 |
| Aの後段: ゴミ箱 | 本人所有原稿の移動・30日期限内復元、公開版の維持と別操作の公開停止 | 保護Rules適用後に利用開始。共同編集原稿、30日後の物理回収は対象外 |
| B: レビューの保護 | 公開期間・対象版の照合、評価票と集計の原子的更新、対応するクライアントとRules | Aと別に検証・承認。Bを後回しにするなら配信コードからも分離する |
| C: 発行条件 | 新規発行・新Release作成のスペース所属条件と案内 | Aの通常編集には不要。対応UI/APIが利用可能になってからRulesを適用 |
| 対象外 | 招待、個人共有、共有編集、参加者の権限変更・脱退、制作チャット | staging限定ガードを外さない。本番の対象者を設定しない |
| 保留 | Windows/Mac配布形態、ファイル関連付け・アイコン・OSプレビュー、モバイルStudio整備 | `windows-file-preview-plan.md`等の検討記録を維持し、今回再開しない |

Viewerの表示・ナビゲーション等にも累積差分がある。Aの依存変更以外を便乗させず、採用する場合はViewerの別の変更単位と実画面検証を明記する。DSP/DSF仕様変更、新保存形式、公開作品の再生成、全作品移行はAに含めない。

現ブランチにはこれらが同居しているため、この表だけでは配信内容は分離されない。承認前にmain基準のリリース候補を作り、変更ファイル・採用コミット・依存モジュールの一覧を確定する。直近の修正コミットだけを無条件に取り出す方法や、全ブランチの一括マージは採らない。現在の成果・未追跡素材を保持する。

## 3. 設定上の結合と必要な事前実装

調査時の`8ecbd04`では`PUBLISHING_SPACES_ENABLED`に次の四つが結合していた。未配備の今回変更で3・4を分離した。

1. 所有者のスペースAPI。
2. 最近開いたクラウド原稿の履歴API。
3. 原稿ゴミ箱API。
4. private authoringの発行用draft生成・新規公開時の所属検証。

本番はリポジトリ上`false`。現在の画面だけを出すと、スペース・ゴミ箱APIは503になる。最近の作業は端末側履歴や一覧の代替表示が残る場合があるが、クラウド履歴APIは使えない。逆に`true`へ変えるだけでは発行条件も変わる。`draft`はこの文脈ではPressの発行用成果物生成であり、通常の本文保存とは別。

必要な最小限の事前実装案:

- スペースAPIの提供と発行時の所属必須条件を別設定にする。`PUBLISHING_SPACE_REQUIRED`を**新設・ローカル実装済み**。本番Aではfalse、Cでtrue。UIの既存`VITE_PUBLISHING_SPACES_REQUIRED`と整合させる。
- ゴミ箱の利用開始を独立制御する。`PROJECT_TRASH_ENABLED`を**新設・ローカル実装済み**。新規移動のAPIとUIを制御し、認証付きcontext/restoreは維持する。無効時に旧式の完全削除へ戻さない。保護Rulesと読取・復元の復旧経路を維持する。
- サーバーが提供する機能と画面の入口を一致させる。共有作品・招待・共有操作・共有通知の入口や不要な問い合わせを停止し、既存アカウント関連のお知らせとは区別する。ボタンを隠すだけでAPIの認可を代替しない。
- 上記の分離を本番相当の設定で検証する。previewの既存挙動は明示設定に置き換えて保持する。
- 段階別のRules候補と配備手順を用意する。最終版`firestore.rules`を早期に丸ごと適用しない。

## 4. 設定表

「未設定」はリポジトリに指定がない意味で、実運用の上書き不在を確認した意味ではない。

| 設定・接続先 | 本番用リポジトリ設定 | Aの推奨値・扱い |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `vmnn-26345` | 維持 |
| `R2_BUCKET` / `R2_PUBLIC_URL` | `dsf-media` / `https://media.dsf.ink` | 維持。公開ページ用 |
| `AUTHORING_BUCKET` | `dsf-authoring-production` | 維持。非公開の原稿・素材・スペース画像用 |
| `AUTHORING_API_ENABLED` | `true` | trueを維持。復旧時も安易に停止しない |
| `AUTHORING_CREATOR_UIDS` / `AUTHORING_TEST_PROJECTS` | 本番1アカウント / 既存2作品 | 値を保持。一般提供や対象者拡大は別判断 |
| `VITE_PRIVATE_AUTHORING_NEW_PROJECTS` | `true` | 維持。API側の許可対象判定も維持 |
| `PUBLISHING_SPACES_ENABLED` | `false` | 事前実装・準備後にtrue。本人所有の利用に限定 |
| `PUBLISHING_SPACE_REQUIRED`（新設） | `false` | Aではfalse。CでUI・Rulesと合わせる |
| `VITE_PUBLISHING_SPACES_REQUIRED` | `false` | Aではfalseを明示。Cでtrueのビルド |
| `PROJECT_TRASH_ENABLED`（新設） | `false` | 最初false。保護Rules適用・確認後true |
| `PERSONAL_SHARING_ENABLED` | `false` | falseを明示 |
| `PUBLISHING_INVITATIONS_ENABLED` / `PUBLISHING_INVITATIONS_ACTIVATION` | `false` | falseを明示 |
| `SHARED_AUTHORING_ENABLED` / `VITE_SHARED_STUDIO_ENABLED` | `false` | falseを明示 |
| 共有actor・scope・招待試験設定 | 本番指定なし | stagingのUID・spaceIdを転記しない |

`VITE_*`はビルド時の値なので、Pages側の設定変更だけでは配信済み画面は変わらない。Pages runtimeの変数・binding・Secretsとは分けて確認する。

招待APIは`server/publishing-invitations-rollout.js`でFirebase projectが`vmnn-26345-stg`であることも要求する。本番でフラグをtrueにするだけでは提供できない。今回この制約を解除しない。

## 5. 必要な権限・Rules・インデックス

### 5.1 既存の基盤を再利用するもの

- AuthはFirebase Auth、保存管理はFirestore、本文正本はprivate R2。D1移行なし。
- Pages Secret `AUTHORING_GOOGLE_SERVICE_ACCOUNT`の存在・対象project・有効性を確認する。秘密値をログや文書へ出さない。
- 本番導入記録のIAMは`roles/datastore.user`と`roles/firebaseauth.viewer`。現IAMを照合し、Aのための追加権限は原則不要。Authユーザー変更・Owner/Admin権限は追加しない。
- このサービスアカウントはFirestore Rulesによる文書別制御を受けない。APIで本人確認、所有者、アカウント停止・失効、対象原稿と所属、revision、再送を検証する。
- 出版スペース・catalogue、`studioActivity/recent`、`project_trash`はサーバー専用。ブラウザーの直接read/writeを新たに許可しない。所属変更は共有アクセス権付与ではない。
- R2の公開・非公開bindingを取り違えない。原稿バケットに公開URLを付けず、署名等を回避した公開画像への代替も行わない。
- `storage.rules`の変更、Firebase Hostingへの配備、新たなAuthプロバイダー・IAM付与は今回不要とする。実環境確認で不足があれば別途限定して判断する。

### 5.2 Rulesを三群に分ける

| 群 | 保証すること | 適用タイミング |
|---|---|---|
| T: ゴミ箱保護 | root/sourceの直接削除を拒否、管理情報の直接変更を拒否、ゴミ箱内の通常保存を拒否。既存公開版の閲覧と別操作の公開停止を保持 | ゴミ箱を利用可能にする前 |
| P: 発行条件 | 新規発行・新Release生成に有効な所属を要求。同じ公開Releaseの維持・閲覧に新条件を後付けしない | 所属設定UIとAPIが正常稼働した後、Cで適用 |
| R: レビュー保護 | 公開境界を確認し、評価票と集計を同一処理で照合。無関係フィールドや他人の票の操作を拒否 | 対応クライアントとセットでBとして適用 |

本番の配備済みRulesを基準に、A0（現状）、T、T+R、T+R+Pの段階ごとの全体ファイルを生成した。Tだけの段階にP/Rを混入させず、既存の他用途Rulesを保持してローカル検証済み。生成物とハッシュは`outputs/production-candidate/rules-manifest.json`。実適用前に再度、本番Rulesの変更有無を照合する。

T適用後、古いタブの旧式完全削除は拒否される。安全な拒否であり、失敗時に別の削除経路へ逃がさず更新案内を出す。未移行Firestore原稿もUIで隔離しただけでは旧タブ・直接アクセスが消えないため保護対象に含める。

### 5.3 インデックス

`firestore.indexes.json`には`spaceMemberships.spaceId`のcollection group用設定がある。Aの本人所有スペース・最近の作業のために一律配備しない。招待側の横断メンバー検索で必要性を判断する。`listJoinedSpaces`は本人配下を読む別経路。

現在の`firebase.json`はこのindexファイルを参照していない。ファイルがあるだけで配備済みとは扱わない。後段で必要になった場合、実環境の既存indexを取得し、保持したうえで必要分を追加する。`indexes: []`を根拠に既存indexを削除しない。

## 6. 推奨適用順序

1. **候補の準備**: Aと対象外コードを分離し、前述の独立設定・画面制御を実装。本番相当設定で検証。T/P/Rの段階別Rules候補、適用対象、元へ戻す配備物を揃える。この段階は開発環境のみ。
2. **直前照合と承認**: 実際のproduction deployment、main、Rules本文とruleset ID、index、変数・binding、Secretの存在、IAMを確認。既存原稿head・公開状態・代表Viewer URLを読み取り記録。確定した差分と設定値、段階別手順について本番反映とRules変更の承認を得る。
3. **Aの画面/API**: 承認済みmainのcleanな配備用checkoutからPagesを反映。スペースと本人履歴を有効化、ゴミ箱・共有・発行所属必須化は無効。通常保存・所属設定・更新復元を確認。
4. **TのRules**: 本番の既存RulesにTだけを加えた候補を適用。旧式完全削除・ゴミ箱管理情報の直接変更を拒否し、通常保存と既存公開閲覧が続くことを確認。
5. **Aのゴミ箱**: API/UIを有効化。専用検証原稿で移動・復元・旧タブの保存拒否・公開継続を確認する。利用者の既存原稿を検証目的で削除しない。
6. **Bは別単位**: レビュー対応クライアントを先に準備し、RのRulesを適用して投稿・評価・取消・非公開化を実通信で検証。互換性のない旧タブには再読込を案内。旧Rulesでの安全性を新クライアントだけで保証したとは扱わない。
7. **Cは別単位**: 所属設定画面とAPIが使える状態で、UI・private APIの必須条件を有効化してPのRulesを適用。新発行と既存公開版の維持を確認。途中の不一致期間に発行させない手順を確定する。

現在の`deploy:prod:safe`はRules→Pagesの順で一括反映するため、今回の初回段階導入にそのまま使用しない。Pagesだけなら既存`deploy:pages`（`--skip-firebase`）を使えるが、実際の実行手順は段階別候補に対して事前確認する。Rulesのみ配備する場合も、作業ブランチの最終Rulesを誤って使わない。

main・clean・remote整合の安全確認は維持する。`--skip-git-check`で回避せず、現作業場所の`outputs/`も消さない。承認された候補を配備専用のclean checkoutで扱う。

## 7. 本番へ進む前の完了条件

直前監査では本番ビルド成功、対象チェック21本中19本成功。残り2本は公開リンク生成の呼出数固定とCRLF依存の検証だった。実装上の障害と同一視しないが、検証を意図に沿って直して再実行するまで全成功とはしない。

- 本番相当のフラグで、所有者の画面に共有機能の使えない入口や常時エラーがない。
- ログインした専用検証原稿でクラウド読込→無編集更新→復元を複数回確認。本文・画像・原稿ID・保存先を保持し、不必要な保存確認を出さない。
- 本当の未保存編集、新規原稿、保存中、通信失敗、別タブ競合では必要な保護が働く。保存成功の偽表示や原稿の自動上書きを起こさない。
- 旧Firestore隔離原稿とprivate R2原稿を別々に確認。移行済み原稿の取得・保存・画像参照を維持する。
- Tの直接アクセス拒否、サーバー時刻の30日境界、期限内復元、本文・画像の一致、公開状態維持を確認する。
- Aに混ざるViewer依存変更は既存の公開／限定公開作品で実操作する。HTTP 200や空の公開一覧だけを合格根拠にしない。
- 既存の公開作品・reviewのデータ形式は変えず、停止中作品や権限のない原稿が閲覧可能にならない。
- 配備後のHTML・JS・Service Workerの版を照合し、旧版からの更新と別タブ共存を確認。ブラウザーデータ削除を復旧方法にしない。

前回の認証付き実画面確認は一覧操作のタイムアウトで完了していない。本番公開一覧は空で、既存作品のViewer URLによる実読書確認も未完了。これらを検証済みとは扱わない。B/Cはそれぞれ実通信の専用検証が別途必要。

## 8. 失敗時の戻し方

- 各段階の直前配備と設定、Rulesを保存し、直前の**互換性を確認した段階**へ戻す。新しい保存管理状態を理解しない`91db176`へ無条件に戻さない。
- 原稿API・非公開binding・既存許可リストを保持する。API停止で移行済み本文を読めなくする復旧は行わない。
- ゴミ箱利用開始後はTの保護を外さない。不具合時は新規移動を止め、保護と読取・復元の修復経路を残す。直接削除へ戻さない。
- 新機能の停止でサーバー上の本文・素材・公開Release・履歴を削除しない。共有停止の場合でも所有者のprivate画像取得を維持する。
- P/Rを戻す必要がある場合は、復旧の必要性と失われる制約を確認して別判断する。以前のRules全体への機械的な巻き戻しはしない。

## 9. 根拠ファイル

- 基本契約: [data-model.md](data-model.md)、[cloud-save-contract.md](cloud-save-contract.md)、[file-format-spec.md](file-format-spec.md)、[page-architecture-plan.md](page-architecture-plan.md)。
- 本番基盤: [environment-topology.md](environment-topology.md)、[private-authoring-production-rollout.md](private-authoring-production-rollout.md)、`wrangler.toml`、`.env.production`、`firebase.json`、`scripts/deploy-prod-safe.js`。
- 所有者運用: [publishing-spaces.md](publishing-spaces.md)、[studio-recents-trash-plan.md](studio-recents-trash-plan.md)、`server/publishing-spaces.js`、`server/project-trash.js`、`server/recent-activity.js`。
- 発行条件: `server/private-authoring/http.js`、`server/private-authoring/actions.js`、`js/publishing-space-policy.js`、`js/publishing-space-publish.js`、`firestore.rules`。
- 共有の保留: [personal-sharing-release-plan.md](personal-sharing-release-plan.md)、[publishing-invitations.md](publishing-invitations.md)、`server/publishing-invitations-rollout.js`、`js/studio-inbox.js`。
- レビュー: [review-boundaries-plan.md](review-boundaries-plan.md)。OS連携の保留: [windows-file-preview-plan.md](windows-file-preview-plan.md)。

## 10. 準備実装の到達点（2026-10-03、未コミット・未配備）

- サーバーの発行所属条件と新規ゴミ箱移動を独立設定にした。productionはfalse、previewは従来相当のtrueをリポジトリで明示。スペース自体の本番有効化はまだ行わない。
- UI側はVITE_PROJECT_TRASH_ENABLED / VITE_PERSONAL_SHARING_ENABLED / VITE_PUBLISHING_INVITATIONS_ENABLEDで提供範囲を明示。productionはfalse、staging/developmentはtrue。共有の入口・招待設定・参加スペース取得・共有通知の定期取得を制御する。既存のアカウント・認証機能は維持。
- 新規移動を止めても、既にゴミ箱にある原稿の一覧・復元を残す。サーバーの本人確認・所有者・停止状態・期限・競合照合は継続。旧式完全削除の代替経路は追加しない。
- 未提供の参加スペースが前回選択として端末に残っている場合は、すべてのクラウド原稿へ表示を戻す。所属情報は変更しない。
- 公開リンク生成の検証を呼出数固定から各操作のWork/Release指定確認へ変更し、レビュー検証の改行差依存を解消した。
- 対象検証13本成功（設定分離、ゴミ箱、private authoring、発行操作、スペース、履歴、未編集復元・更新、再開保護、Dashboard、公開リンク、レビュー）。production/stagingの両ビルド成功。既存の大きなchunk警告あり。
- 実画面: 本番相当のログイン済みfixtureで共有呼出0、共有・新規移動の非表示、編集メニュー・基本設定・保持済みゴミ箱の復元、英語表示を確認。staging相当では共有・通知の表示と通知ダイアログを確認。配布用productionビルドの未ログインDashboardと設定画面も確認。
- fixtureは実アカウントやクラウド原稿を使わない。この確認は本番の認証付き保存・更新・既存公開Viewerの実通信検証の代わりではない。

次の単位として、初回ソース候補とT/P/Rの段階別Rules候補の準備を実施した。詳細は[studio-production-candidate.md](studio-production-candidate.md)。認証付き保存・更新・復元、既存公開Viewer、本番設定・IAM等の照合が残る。本番の権限・設定の適用、コミット、配備はこの準備実装では実行していない。
