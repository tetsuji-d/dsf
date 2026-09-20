# 新規作品の非公開R2保存

2026-09-20。Firebase Authは維持し、Firestoreには作品メタデータと保存管理だけを置く。
既存Firestore作品は自動移行しない。Project v5/v6と公開Releaseの形式は変えない。

## 作成と再試行

- Studioの最初のクラウド保存は、rootがまだ存在しない場合に限りPOST authoringを使用。
  ローカルバックアップと画像URLの解決を先に行う。通信エラーからFirestoreへ切り替えない。
- サーバーはFirebaseトークン、停止・失効、作成権限、明示したUID、Origin、16 MiB上限、
  原稿形式、IDの未使用、ユーザー別要求・容量制限を検証する。
- controlをstatus: creatingとして予約し、非公開R2に原稿を保存・再読込・ハッシュ照合する。
  root/head/summary/Workと作成結果は、その後の一つのFirestore transactionで確定する。
  途中失敗で空の作品を一覧に出さない。本文・拡張フィールドはrootやWorkへコピーしない。
- 初回の要求IDと原稿を開いているStudio内に保持する。応答を失った再試行も同じ内容を使う。
  その間の編集は初回確定後の通常保存で送る。他の保存が進んだ結果を自動採用しない。
- 既存root、Work、旧authoring、削除済みcontrolのIDは使用不可。公開状態は常にprivate/draftから開始。
- 作成予約の有効時間は既存保存と同じ120秒。期限切れの予約や履歴を自動削除する処理は未実装。
  クラウド確定前に画面を閉じた場合、ローカル原稿を保持し、必要なら新しい作品として保存する。

## 有効化

VITE_PRIVATE_AUTHORING_NEW_PROJECTS=trueをstaging/productionビルドに設定。
AUTHORING_API_ENABLEDとAUTHORING_CREATOR_UIDSをサーバーで確認する。
UIDリストはワイルドカードを認めず、現存する開発用アカウントに限定する。
既存の作品単位allowlistも維持する。ローカルViteの既定は変更しない。

Firestore Rulesの追加変更は不要。既存のcontrol保護がcreating状態も覆い、
旧クライアントが予約中のIDへ原稿を直接作成することも拒否する。

## 検証

新規作成10項目（v5/v6、850 KiB超、権限、旧ID、通信断、競合、削除、失効・期限、容量）、
既存API24項目、client12項目、storage14項目、legacy3項目、actions8項目、
maintenance11項目、retention6項目とProject persistenceの検証を実施。
ステージングcd6453a / https://5a5e6177.dsf-studio.pages.dev で実Chrome確認済み。
専用検証ユーザーの新規作品proj_mu9grnul_lwhfseをUIで作成し、v5の初回R2保存、
Flow追加によるv6保存、本文完全一致、再読込後の本文表示、旧authoring文書なし、
headの直接読込403、page error 0を確認。Pressの非公開下書き
rel_mu9gucm6_x0faneも保存成功。読者向け公開行は作られていない。
APIは既存アカウントの新規保存に使用するため、有効な状態を維持する。

## 統合

- 本番移行済みコード1c6c2dfをmain/origin/mainへfast-forward済み。
- ステージング固有の編集機能を保持して本番互換修正を取り込み、
  ad876fcをbb5c7926へ配備。専用テスト作品の通常保存・再読込と本文一致を実Chromeで確認。
- 新規作成機能をmain起点の専用ブランチで実装し、ステージング検証後にmainへ統合・本番反映済み。

## 本番反映と最終状態

- 2026-09-20、本番用変更をmain / origin/mainへ統合し、クリーンなmainから通常の
  deploy-prod-safeを実行。main限定チェックの例外は使っていない。
- 本番runtime: `91db176b5bd617e1ed870d4ba5f5446124b8e575`。
  配備: https://94fed8ad.dsf-studio.pages.dev / https://dsf.ink 。
  Firestore Rulesは既存本番と同一のため、今回は再配備していない。
- ステージングruntime: `cd6453a`、https://5a5e6177.dsf-studio.pages.dev 。
  後続の文書取り込みと`8403f7f`でmainの統合履歴も記録済み。
  本番と異なるFlow / WebMCP / UI機能はステージング側に保持する。
- 本番の検証作品`proj_mu9gxpbg_u5jxg8`を実Chromeの新規作成から保存。
  初回POST成功、文字の追加・保存・再読込後の画面表示と本文完全一致、
  Project v5維持、Firestore本文なし、head直接読込403、page error 0を確認。
  ステージングでは前節のとおりv6への変更とPress下書きも確認済み。
- 本番とステージングは保存表示・追加メニューが異なる。
  検証手順をそれぞれの実UIに合わせて確認し、製品コードの追加修正は不要だった。
- 既存2作品はStudioで読み込み、公開状態を確認。匿名Viewerでは各8ページの表示と
  実ページ送りを確認し、page error 0。本文はrevision 1のまま、SHA-256、
  Work / Release / public_projectsは移行前の比較用スナップショットと一致。
- 本番検証作品は通常の削除APIでrootと一覧summaryから除去済み。
  controlはdeleted、非公開の原稿・復旧履歴は保持。公開・再発行はしていない。
- 本番の新規作成は既存所有者1 UID、previewは既存3 UIDの明示リストに限定し、
  さらにアカウントの作成権限を確認する。APIは両環境で有効なまま維持する。
  新しく登録する利用者への自動有効化はしていない。
- R2は公開URL無効・custom domainなし、専用サービスアカウントの鍵は1個。
  既存2作品の原稿・型付きバックアップは実オブジェクトの容量とSHA-256を照合済み。

### 残っている別スコープ

- ステージング等の未移行Firestore作品はそのまま。今回、自動移行はしていない。
- 古い原稿履歴・期限切れ作成予約の物理削除とquota返却は未実装。
- Firebase AuthとFirestoreのメタデータ／保存管理は継続。D1移行はしていない。
