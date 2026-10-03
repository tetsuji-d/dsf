DSF / DSP 右側の表紙プレビュー — Windows x64 開発検証版

このZIPは解凍して使います。署名付き一般配布版ではありません。
一覧のサムネイルとは別の部品で、Explorer右側のプレビュー欄へ表紙を表示します。
DSFの画像表紙と、確認用の表紙PNGを含むDSPが対象です。
本文のページ送りは含みません。表紙がない古いDSPや未対応の形式には案内を表示します。
原稿、表紙画像、既定アプリ、種類アイコン、サムネイル用ラベルは変更しません。
外部通信や原稿中のプログラム実行はありません。

管理者PowerShellで、解凍したフォルダーへ移動して実行します。
確認のみ: .\setup-cover-preview.ps1 -Action Status
導入:     .\setup-cover-preview.ps1 -Action Install
解除:     .\setup-cover-preview.ps1 -Action Uninstall

Program Filesへ部品を配置し、.dsf/.dspのプレビュー欄だけに登録します。
別のプレビューが登録されている場合は上書きせず停止します。
Windowsの管理ポリシーで導入が禁止されている場合はポリシーを変更せず停止してください。
導入後、Explorerで「表示」→「表示」→「プレビュー ウィンドウ」を有効にし、ファイルを選択します。
表示を切り替えるショートカットは Alt+P です。

ダウンロードした原稿でWindowsの警告が出る場合:
Windowsは、インターネット由来の印があるファイルのプレビューを止めることがあります。
この部品はその保護を解除しません。入手元と内容を信頼できるファイルに限り、
本人がファイルの「プロパティ」→「許可する」を判断してください。
反映に次回のサインインが必要な場合があります。警告の一括解除は不要です。
Microsoftの説明:
https://support.microsoft.com/en-us/servicing/os/windows/docs/2025/10/file-explorer-automatically-disables-the-preview-feature-for-files-downloaded-from-the-internet

2026-10-03、このPCのExplorerでローカル生成のDSF・DSPの表紙、旧DSPと異常ファイルの案内を確認しました。
ダウンロード済みの原稿はWindows側の警告で止まり、表示確認とは区別しています。
Windows 11 x64での開発確認用です。新規PC、OneDrive等の同期フォルダーは別途確認が必要です。
Mac / iOS / Android / Windows ARM64用の部品ではありません。
Windowsが部品を使用中の場合、解除後にDLLだけ残ることがあります。解放後にUninstallを再実行してください。
同梱ライセンス: miniz / nlohmann JSON / libwebp
