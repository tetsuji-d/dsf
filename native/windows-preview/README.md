# Windowsファイルプレビュー（開発用・未配布）

## 現在の状態

2026-10-03。2段階の第1段階として、DSFの画像表紙とDSPの検証済み表紙PNGを読み取る
Windows x64用`IThumbnailProvider`を実装。**専用拡張子でのExplorer実表示と導入・解除を確認済み。**
実際の`.dsp`／`.dsf`への常設登録は未実施。署名付きの一般配布版ではない。

- DSF v1: 指定されたC1（なければ最初のページ）の原文言語画像。
- DSF v2: 既定言語の最初のページが画像の場合のみ。manifest、meta、content、言語manifestと
  選択画像のhashを照合する。アーカイブ全体の検証済み表示を保証するvalidatorではない。
- 後続の画像を探して、本文の挿絵を表紙として代用しない。
- DSP: `preview/cover.png`と`preview/cover.json`があり、原稿・PNGのhash、言語・寸法が一致した場合だけ表示する。
  元の背景画像だけを完成表紙と誤認させない。追加前のDSP／DSFの固定テキスト表紙は通常アイコン。
- PNG／JPEGはWIC、WebPは同梱libwebpで縮小する。Storeや外部のWebP decoderには依存しない。
- Windows 11 x64の開発端末で確認。Windows 10／新規PCは未検証。
  ARM64、Mac、iOS、Android用の拡張ではない。

## ビルド

Zig 0.15.2のWindows x64版（システムインストール不要）で検証した。
公式ZIP: https://ziglang.org/download/0.15.2/zig-x86_64-windows-0.15.2.zip

SHA-256: `3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c`

```powershell
./native/windows-preview/build.ps1 -Zig <zig.exeのパス> -FetchDependencies
node scripts/verify-windows-thumbnail.cjs
```

miniz 3.1.2／nlohmann JSON 3.12.0／libwebp 1.6.0は公式リリースを固定し、`dependencies.json`のSHA-256と
毎回照合する。ソースの取得は`-FetchDependencies`指定時のみ。成果物・依存ソース・ライセンスは
既存の未追跡`outputs/windows-preview/`へ置く。ビルドや検証はWindowsへの登録を行わない。

## 読み取り境界

- `IInitializeWithStream`で初期化し、`GetThumbnail`で遅延読込する。`DisableProcessIsolation`は設定しない。
- 元原稿の書込、ZIPのディスク展開、HTTP、HTML／スクリプトの実行は行わない。
- 1 GiB以下の通常ZIP、10,000 entry以下、central directory／JSON各8 MiB以下、画像32 MiB以下。
- ZIP64、分割ZIP、暗号化、STORE／DEFLATE以外の圧縮、unsafe path、大小文字衝突、重複JSON keyを拒否。
- 必要entryのCRCを検証。画像は静止画のみ、各辺16,384px以下・32,000,000px以下。
- 出力は最大1,024px。表示できない原稿は失敗を返し、Shellの通常アイコンに任せる。
- 縮小時に縦横比を保つ。元の画像を拡大・トリミングしない。

## 検証済み／未確認

30件のnative executable検証: v1／v2のPNG・WebP、C1指定、DLLのCOM生成、
読み取り前後の原本hash一致、不正path、大小文字衝突、外部参照、重複JSON key、深いJSON、
過大entry、欠落、言語違い、DSPの誤表示防止、fixedTextの誤表示防止、改ざん、切れたZIP。
破損画像と未知のschemaも拒否する。
DSP snapshotの直接／COM描画、原稿変更後の古い表紙、画像改ざん、言語不一致も確認した。
COM経由と直接描画のPNGも一致。同梱WebP decoderでのCOM描画、アニメーションと切れたWebPの拒否も確認。

### Windows Shell連携の切り分けと解消

検証端末: Windows 11 x64、OS build 26300、ThumbnailExtractionHost 10.0.26100.9278。
同じDLLを使った一時登録で次を確認した。この結果を他の全Windows環境へ一般化しない。

- HKCU登録: 登録COM生成、ShellのBindToHandler、低整合性の診断プロセスからの描画は成功。
  `IShellItemImageFactory`／Thumbnail Cacheからの抽出は`0x80040154`で失敗。実Explorerでも白いアイコン。
- HKLM登録: 通常ユーザーからのShell抽出と実Explorerの表紙表示が成功。
  DSPとWebP表紙のDSFを表示し、原稿hashと不一致の古いDSP表紙は通常アイコンへ戻る。
- Windows標準の隔離を維持。アクセス権／セキュリティポリシー／既定アプリは変更していない。
- 管理者でも`Software\Classes`全体を書込用に開く操作は拒否された。
  登録対象のサブキーだけを開く方式で解消。ACL変更は不要だった。

`verify-shell.ps1 -Scope User|Machine -InspectSeconds 120`は専用拡張子を最大2分保持する。
Machineは事前承認とWindows管理者確認が必要。`run-machine-diagnostic.ps1`は通常のUACを使い、
実行ポリシーを変更しない。一時登録は所有印を確認してfinallyで解除する。
`shell-verification-machine.json`で登録COM・Shell・解除の成功を記録した。

### 導入パッケージ

```powershell
./native/windows-preview/package.ps1
# 承認された一時検証のみ。Windowsの管理者確認は本人が操作する。
./native/windows-preview/run-machine-diagnostic.ps1 -Lifecycle
```

出力先: `outputs/windows-preview/DSF-Windows-Preview-<DLL hash先頭12文字>.zip`。
解凍後の`setup.ps1`はStatus／Install／Uninstallを持つ。使用方法は同梱README.txtを参照。

- Program Filesへhash別にDLLとライセンスを置き、HKLMのthumbnail handlerだけ登録する。
- 既存の別handlerは上書きせず停止。既定アプリ・種類別アイコン・原稿は変更しない。
- package内のファイルhashを照合し、所有する登録・既知のファイルだけを解除する。
- 同じ版の再実行は検証済み。異なる版への更新はhash別配置で実装したが、実機更新試験は未実施。
- 検証用Install→再Install→Shell描画→Uninstallを実行。元原稿・実`.dsp`／`.dsf`の関連付け不変、
  一時キー・Program Files内の検証フォルダーの消去を確認した。
  記録は`outputs/windows-preview/install-verification.json`。
- 同梱WebP版もExplorerで実表示を確認。新規PC、長期利用、署名付き一般配布は未検証。
- 実拡張子への常設登録は一時検証の承認に含めず、完成したパッケージを示して別途確認する。

## 配布前の残作業

1. DSPの任意表紙PNG同梱は承認・実装済み。Flow表紙など現時点で省略している構成への対応を検討する。
2. 実拡張子への常設導入、異なる版への更新、新規Windows端末での再現性を確認する。
3. 署名・一般配布方法を整える。現在は開発用の未署名ZIP。
4. 第2段階の本文プレビューへ進む。固定テキスト・言語・ページ順を既存Viewerと照合し、
   画像だけを抜き出して本文が欠けたプレビューを完成扱いしない。

Microsoftの根拠:
- [Thumbnail handlers](https://learn.microsoft.com/en-us/windows/win32/shell/building-thumbnail-providers)
- [Preview handlers](https://learn.microsoft.com/en-us/windows/win32/shell/building-preview-handlers)
- [In-process extensions](https://learn.microsoft.com/en-us/windows/win32/shell/shell-and-managed-code)
