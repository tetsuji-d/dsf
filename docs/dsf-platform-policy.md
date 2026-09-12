# DSFプラットフォーム基本方針

更新日: 2026-09-12
実装確認基準: `dsf-dev` / `feature/flow-layout-foundation` / `f1c5aa3`

## 1. この文書の役割

Web提供、Horizon、Viewer、portable DSF、PWA、版管理についての製品方針を一元化する。
実装手順やフィールド定義を重複させず、以下の担当文書へ委譲する。
本書の作成は、コード変更、schema変更、デプロイ、保存済みデータの移行・削除の承認を意味しない。

| 表記 | 意味 |
|---|---|
| 確定方針 | 既存の製品原則またはユーザーが明示した運営方針。実装済みとは限らない |
| 設計案 | 会話で提案・検討した内容。具体的な契約と実装範囲を決める必要がある |
| 実装確認済み | 上記チェックアウトのコードで確認した範囲。全端末・本番での検証済みを意味しない |
| 未実装 | 上記チェックアウトでは機能として未接続、または実装を確認できない |

### 文書の担当範囲

| 文書 | 正本とする内容 |
|---|---|
| 本書 | 製品の提供方針、対象範囲、オンライン／オフラインの境界、将来設計の位置づけ |
| [CLAUDE.md](../CLAUDE.md) | リポジトリ入口、製品概要、開発コマンド |
| [AGENTS.md](../AGENTS.md) | 開発運用と承認境界 |
| [file-format-spec.md](file-format-spec.md) | DSP／DSFアーカイブの構造と既存メタデータ |
| [fixed-text-delivery-contract.md](fixed-text-delivery-contract.md) | WebP／fixedText、フォント、固定レイアウトの配信契約 |
| [data-model.md](data-model.md) | Firestoreの既存schemaとRules |
| [pressroom-spec.md](pressroom-spec.md) | Press／Worksの発行操作、公開状態、公開期間 |
| [dsf-release-operations-hardening.md](dsf-release-operations-hardening.md) | Release検査・履歴・R2棚卸しと現在の安全境界 |
| [environment-topology.md](environment-topology.md) | Pages／Firebase／R2と環境の役割 |
| [auth-unified-surfaces.md](auth-unified-surfaces.md) | 現在の認証共有と画面ごとのログイン導線 |
| [viewer-info-panel-spec.md](viewer-info-panel-spec.md) | Viewer作品情報の表示UI |
| [flow-remaining-implementation-plan.md](flow-remaining-implementation-plan.md) | Flowの実装単位、進捗と継続検証 |

新しい製品判断は本書へ集約する。技術契約を変更する場合は担当文書も更新する。
過去の実装単位に付いた「未接続」等は当時の記録であり、現在地は実コード・最新コミット・実装計画を照合する。
本書は既存のschemaや公開制御を暗黙に上書きしない。矛盾する契約は実装前に解決する。

## 2. 製品として守ること（確定方針）

- リンクからアプリのインストールなしで読めるWeb体験を中心とする。
- 主な運用前提はChromeブラウザとGoogleアカウント。公開読書のすべてをログイン必須にする意味ではない。
- 一人で維持・検証・更新できる範囲を優先する。Windows／Mac／iPhone／Android専用アプリやWebViewラッパーの開発・ストア運営を現在の対象に含めない。
- PWAは同じWebサービスを便利に起動する任意の入口として検討する。インストールを閲覧条件にしない。
- 9:16固定レイアウト、多言語、広告を挟まない読書、オープンなファイル仕様を維持する。
- Studio／Pressで組版を確定する。ViewerはfixedTextとWebPの固定ページを表示し、端末幅による再組版をしない。
- 公開ViewerへDSPやsemantic FlowDocumentを渡さない。fixedText本文を便宜的に画像へ置き換えない。
- v1の既存ファイル・公開閲覧経路との後方互換を守る。

## 3. Project／Work／Releaseと配信

Projectは編集用、Workは作品の公開管理、Releaseは発行時点のimmutableな配信snapshotとして扱う。
同じ作品の再発行は、読者からは作品の更新に見えても、過去Release実体の上書きにはしない。
同じプロジェクトからの発行が常に同じWorkを更新するとは推測せず、更新対象を明確にする。

実装確認済みのHorizon v2は、JSON・言語manifest・画像などを個別リソースとして配信する。
単一DSF ZIPを常時サーバーで展開してページを取り出す構成ではない。
Horizonでは認定フォントの共有配信を利用し、portable DSFでは必要な埋込許可済みフォントを同梱する。
両者は同じRelease内容を元にしても、参照方法とアーカイブ構造が異なるため、hashの同一性は仮定しない。

設計案として、オンライン配信を維持したまま、同じReleaseからダウンロード用DSFを生成する。
最新の編集原稿から作り直して公開版と内容が食い違うことを避ける。
発行時に一度生成してR2へ保存する案を第一候補とするが、保存path、receipt、失敗時の扱い、配信許可の契約は未確定。

## 4. DSFダウンロード（設計案・Horizon読者向けは未実装）

- PressのHorizon発行操作の近くに「DSFファイルのダウンロードを許可」を配置する。
- 新規発行はオンを既定とする案。再発行では前回の選択を引き継ぐ。
- 既存Releaseを自動で許可へ変更しない。未設定時の扱いと移行は別途決める。
- 下書き保存の段階では読者へ提供せず、公開／限定公開と公開期間、ファイル準備完了を照合する。
- Viewerの取得対象は閲覧中のReleaseと一致させる。過去版を見ているときに最新版を渡さない。
- UIでボタンを隠すだけをアクセス制御とみなさない。ダウンロード用URLの直接アクセスも設計対象とする。
- ダウンロード不可はコピー防止ではなく、既に保存されたDSFを回収することもできない。

許可の保存先をWork／Releaseのどちらに置くか、発行後の変更と過去版への適用範囲は未決定。
これらを決める前にFirestoreフィールドやRulesを追加しない。
現在のR2/CDN直接URLの物理的失効の限界は、[Release運用契約](dsf-release-operations-hardening.md)を参照する。

## 5. 版番号・ファイル名・内部情報（設計案）

- 作者向けの版番号「第1版、第2版…」と、DSF形式のv1／v2を分ける。
- 版番号は自動採番を候補とする。採番する時点、並行発行、retry時の重複防止、既存版の扱いは未決定。
- 更新メモは任意。発行日時はダウンロード日時で置き換えない。
- ファイル名の例は `作品名_第3版.dsf`。言語別提供を選ぶ場合の例は `作品名_第3版_ja.dsf`。
- プロジェクト名や内部IDを通常のファイル名に露出させず、禁止文字・長さを調整する。
- 作品タイトル、著者、言語、版、発行日時、更新メモ、Work／Release識別、形式version、権利表示を内部情報の候補とする。
- 上記は新しいフィールド定義ではない。既存項目を再利用し、不足項目の形式変更は[file-format-spec.md](file-format-spec.md)と合意する。
- ファイル名を変えても版の同一性を識別できるようにする。同一版の再生成に必要な入力を固定する。

OSのプロパティ表示や表紙サムネイル拡張は対象外。まずViewerの作品情報で確認できる形を優先する。

## 6. 容量管理・保持（検討案、削除は未承認）

版の記録と大容量の実ファイルの保持を分けて検討する。
現行のR2棚卸しは読み取り専用であり、正規の過去Releaseは保持する。
本書に記載した案によってcleanupや削除を開始してはならない。

- 現在公開中・現在参照中のReleaseを保護する。残す指定、参照検査、削除対象と容量の事前提示を検討する。
- 「直近3版＋30日以内」は会話中の例であり、確定した保持ルールではない。上限・料金・保持期間は未決定。
- 削除した版番号を詰め直さない案とし、履歴を残す場合のmetadata保持契約も別途決める。
- 実体削除により版指定URL、ダウンロード、再公開が使えなくなることを作者に明示する。
- portable DSFのみ削除して再生成する案は、元Releaseの画像・JSON・正確なフォント等を保持できる場合に限る。
- 再生成、重複排除、自動削除は別の実装単位。未参照というだけで削除可能とは判定しない。

## 7. PWAとオフラインViewer（設計案・未実装）

PWAの名称・起動入口はDSF Horizonを候補とし、Viewerを通信とGoogle認証から独立して起動できる構造にする。
インストール案内の表示はブラウザ判断であり、URL欄のボタンを常時表示できるとは約束しない。
同一のWebコード・デプロイを利用し、OS別ストア配布は行わない。

| 機能 | 通信／認証の目標境界 |
|---|---|
| Horizon一覧・検索 | 通信が必要 |
| 発行・クラウド保存・所有者向け操作 | 通信と認証が必要 |
| 公開URLのViewer | 原則通信が必要。公開条件を照合する |
| 手元のportable DSFを開く | ログイン不要、サーバーへファイルをアップロードしない |
| オフラインViewer起動 | 必要な起動ファイルの保存完了後に利用可能にする |

### 起動用キャッシュと作品保存を分離する

- ViewerのHTML／JS／CSS／アイコン／UIフォントと依存コードを、検証した起動用一式として保存する。
- CDN上にしかない必須依存、認証初期化の待機、オンラインfont registry依存を調査して解消する。portable DSFの自己完結性だけでオフライン起動を保証しない。
- 起動用キャッシュに認証情報、Firestore/API応答、非公開作品、読書中の画像を一律キャッシュしない。
- 初回準備はオンラインが必要。「オフライン閲覧の準備完了」は必要な一式の保存を確認して表示する。
- 新版の一式を保存し終えてから更新を切り替える。読書中の強制切替や新旧コード混在を避け、失敗時は旧版を保つ。
- ブラウザのデータ削除・容量制約・保存領域の消去を考慮し、準備状態を再確認する。永久保存は保証しない。
- オフラインでHorizonを起動した場合は「DSFファイルを開く」「再接続」を表示する案。
- 「Horizon作品をオフライン本棚へ保存する」は別機能。容量、公開期間、アクセス権、削除、保存状態の設計が必要。

### OSごとの対応目標

| 対象 | 共通の基本経路 | 追加候補 |
|---|---|---|
| Windows／MacのChrome | Viewerのファイル選択 | インストール済みPWAのFile Handlingによる関連付け |
| AndroidのChrome | Viewerのファイル選択 | インストール済みPWAの共有先登録 |
| iPhone／iPad | Viewerからファイル選択 | OSファイルからPWA直接起動は保証範囲にしない |

関連付け、初回許可、共有元のMIME、独自拡張子の選択可否は実機で確認する。
対応するブラウザAPIは実装時に再確認し、機能検出とファイル選択へのfallbackを行う。
参考: [Chrome File Handling](https://developer.chrome.com/docs/capabilities/web-apis/file-handling)、
[Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)、
[PWAインストール要件](https://web.dev/articles/install-criteria)。

## 8. 実装確認と次の単位

| 項目 | 基準コミットでの状態・根拠 |
|---|---|
| WebP／fixedTextのHorizon配信 | 接続済み。[remote loader](../js/dsf-horizon-viewer-load.js) |
| portable DSF生成 | 実装あり。[portable plan](../js/dsf-portable-release.js)、[local package](../js/flow-press-local-release-package.js) |
| ローカルDSF読込 | 実装あり。[Viewer](../viewer.html)、[local loader](../js/dsf-local-viewer-package.js) |
| 過去Releaseの読取・版指定preview | 実装あり。[Release運用契約](dsf-release-operations-hardening.md) |
| Horizon読者向けDL許可UI・保存DSF提供 | 未実装。ローカル書き出しがあることと区別する |
| 自動版番号・更新メモ・世代保持ポリシー | 本書の設計案として未実装 |
| PWAインストール・Viewerオフライン起動 | 現ブランチでmanifest／service worker接続を確認できない。過去の別ブランチでの実装記録を完成根拠にしない |
| OS関連付け・共有先登録 | 現ブランチで未実装 |

次の候補は「HorizonのPWA化＋Viewerオフライン起動＋ローカルDSF閲覧」。
実装前に起動依存とキャッシュ対象を調べ、UIを提示し、オンライン認証・匿名閲覧・オフライン起動・更新を検証する。
DL提供・版番号は保存契約とアクセス制御を決める別単位、保持・削除はさらに別単位とする。
文書化だけで各単位の実装を開始しない。commit、staging、Rules、本番は既存の個別承認境界に従う。
