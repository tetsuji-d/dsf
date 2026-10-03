# Studioのデスクトップ配布方針（検討記録・実装保留）

2026-10-03。Studioのインストール案内とOS連携についてのユーザーとの検討を記録する。
本書は実装済み仕様ではなく、優先順位と再開時の検討事項を示す。

## ユーザーと確認した方針

- Studioはクリエイターの制作環境としてWindows・Macを優先する。
- iOS・Android向けStudioの専用アプリ化・OS連携の整備は後回しにする。現行Web版を維持する。
- スマートフォン向けViewerは読者の主要な利用環境として引き続き重視する。Studioの優先順位と混同しない。
- インストールの主な利点は、デスクトップ等の起動用アイコンからすぐStudioを開けること。クラウド中心の編集・保存を継続する。
- ネットなし編集は移動中や通信できない場所への任意の備えとし、通常利用の必須手順として案内しない。
- 今は検討を記録してエディターの整備へ戻る。アプリ化、インストーラー作成、Windows部品の登録変更は再開しない。

## 検討した提供形態

| 対象 | 提供案 | 現在地 |
|---|---|---|
| Windows | Studio本体、ショートカット、DSP/DSFファイル連携、サムネイル・表紙プレビューを1本の署名付きEXE/MSIで導入 | Studioは現在Web/PWA。表紙表示部品はWindows x64用開発検証版。一体型インストーラーは未実装 |
| Mac | StudioアプリをDMG等で配布し、ファイル形式の登録・Quick Look拡張を同梱 | 専用アプリ・拡張は未実装。署名・公証、実機検証が必要 |
| iOS/iPadOS | 当面Web版／ホーム画面追加を維持。専用版はApp Store等とファイル拡張を別途検討 | 優先度を下げて保留。Windows用部品は転用できない |
| Android | 当面Web版／ホーム画面追加を維持。専用版はGoogle Playや署名付きAPKを別途検討 | 優先度を下げて保留。ファイル管理アプリ全体で一律の表紙表示は保証しない |

Windowsでは、既存PWAのブラウザー側インストールへ案内するセットアップと、Studioを専用デスクトップアプリとして包装する方式を区別する。
前者はブラウザー側の導入操作が残る。後者はユーザーが求める一体型の導入体験を作りやすいが、単にEXEを生成すれば完成するものではない。

Tauri等を候補として話題にしたが、採用技術は未決定。Windows先行・Macへ展開する順序は実装候補であり、両OSを重視する優先方針とは区別する。
Web版の編集画面・データモデルを共用する方向で、描画の一致、認証、ファイル操作を小さく検証してから決定する。

## 再開時に先に検証すること

1. Googleログイン、同じアカウントのクラウド原稿の読込・保存。デスクトップ実行環境からのAPI接続、認証の戻り先を確認する。
2. フォント・組版・改ページ・画像出力のWeb版との一致。作者の本文・画像・確定レイアウトを保持する。
3. DSP読込・上書き・名前を付けて保存、OSからのファイル起動、キャンセル・失敗・保存中の追加入力。
4. 復元コピーとログイン状態の扱い。ブラウザーと専用アプリの保存領域が自動共有されると仮定しない。原稿の移行方法を先に設計する。
5. 未保存原稿がある場合の終了・アプリ更新と、失敗時の復旧。初期の配布は新版インストーラーによる更新を候補とし、自動更新方式は未決定。
6. OS拡張の導入・更新・解除、他の既定アプリとの共存、署名・配布元表示、新規端末での実表示。

DSP/DSF形式、private R2/Firestoreの保存契約は本検討では変更しない。変更が必要になった場合は影響を先に説明する。
本文のページ送りを含むOSプレビューは未実装で、現在のWindows部品は表紙表示に限る。
OneDrive内のサムネイル取得待ちとダウンロード原稿のWindows保護は別の制約で、インストーラー化だけで解決するとは扱わない。

## 作業の引継ぎ

- 記録時の作業場所: `C:\Users\tetsu\.codex\worktrees\review-boundaries\dsf`
- ブランチ／HEAD: `codex/windows-file-preview` / `6e35363`
- ダッシュボードの原稿カード・発行作品への導線・インストール説明はローカル変更として存在し、未コミット・未配信。
- 未追跡`outputs/`は検証素材として保持する。別の`C:\Users\tetsu\projects\dsf`と混同しない。
- [Windows部品の保留・再開記録](windows-file-preview-plan.md)を合わせて確認する。
- [エディター整備と次の作業候補](studio-current-work.md)へ戻る。
- 本番デプロイ、mainマージ、権限ルール変更は別途明示承認が必要。

## 検討時に確認した公式資料

以下は2026-10-03の調査先。採用時には最新の対応範囲を再確認する。

- [TauriのWindowsインストーラー](https://tauri.app/distribute/windows-installer/)
- [Tauriの各OSへの配布](https://tauri.app/distribute/)
- [Appleの独自形式サムネイル拡張](https://developer.apple.com/documentation/quicklookthumbnailing/providing-thumbnails-of-your-custom-file-types)
- [Apple Quick Look](https://developer.apple.com/documentation/QuickLook)
- [Androidのドキュメント提供機能](https://developer.android.com/guide/topics/providers/create-document-provider)
- [Appleのアプリ審査基準](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)
- [Windowsの配布機能・署名とSmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status)
