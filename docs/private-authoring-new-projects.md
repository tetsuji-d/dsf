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
- この新規作成機能はmainを起点とする専用ブランチで実装し、先にステージングで検証する。
