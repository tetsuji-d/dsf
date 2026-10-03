# Windowsファイルプレビュー（開発用・未配布）

## 現在の状態

2026-10-03。2段階の第1段階として、既存DSFの画像表紙を読み取るWindows x64用
`IThumbnailProvider`の試作を追加した。**Explorerへの登録・一般配布はまだ行わない。**

- DSF v1: 指定されたC1（なければ最初のページ）の原文言語画像。
- DSF v2: 既定言語の最初のページが画像の場合のみ。manifest、meta、content、言語manifestと
  選択画像のhashを照合する。アーカイブ全体の検証済み表示を保証するvalidatorではない。
- 後続の画像を探して、本文の挿絵を表紙として代用しない。
- DSP: `preview/cover.png`と`preview/cover.json`があり、原稿・PNGのhash、言語・寸法が一致した場合だけ表示する。
  元の背景画像だけを完成表紙と誤認させない。追加前のDSP／DSFの固定テキスト表紙は通常アイコン。
- WIC経由でPNG／JPEG／WebPを縮小する。WebPはOSの対応decoderに依存する。
  開発端末ではWebPも成功したが、新規端末でのcodec依存の解決・確認は配布前の必須項目。
- Windows 10/11 x64を想定。ARM64、Mac、iOS、Android用の拡張ではない。

## ビルド

Zig 0.15.2のWindows x64版（システムインストール不要）で検証した。
公式ZIP: https://ziglang.org/download/0.15.2/zig-x86_64-windows-0.15.2.zip

SHA-256: `3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c`

```powershell
./native/windows-preview/build.ps1 -Zig <zig.exeのパス> -FetchDependencies
node scripts/verify-windows-thumbnail.cjs
```

miniz 3.1.2／nlohmann JSON 3.12.0は公式リリースを固定し、`dependencies.json`のSHA-256と
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

27件のnative executable検証: v1／v2のPNG・WebP、C1指定、DLLのCOM生成、
読み取り前後の原本hash一致、不正path、大小文字衝突、外部参照、重複JSON key、深いJSON、
過大entry、欠落、言語違い、DSPの誤表示防止、fixedTextの誤表示防止、改ざん、切れたZIP。
破損画像と未知のschemaも拒否する。
DSP snapshotの直接／COM描画、原稿変更後の古い表紙、画像改ざん、言語不一致も確認した。
COM経由と直接描画のPNGも一致。合成WebPの出力画像を目視確認した。

これは開発用プロセスからの実COM呼び出しであり、Explorer／dllhostのプロセス分離や
OS画面上の表示成功とは区別する。一般利用者のPCにはまだ導入しない。

追加で`verify-shell.ps1`を実行。検証専用のランダム拡張子とCLSIDをHKCUへ一時登録し、
`CoCreateInstance`からの描画は成功したが、`IShellItemImageFactory`は`0x80040154`（クラス未登録）で
失敗した。同じDLLの直接呼出とは結果が異なるため、登録位置・Shell別プロセス・実行環境の
切り分けが必要。既存の`.dsp`／`.dsf`は変更せず、一時登録はfinallyで解除する。
結果を`outputs/windows-preview/shell-verification.json`へ保存する。
隔離を無効化して成功扱いにはしない。通常のExplorer確認は引き続き未完了。

追加切り分け（同日）:
- 標準PNGは`IShellItemImageFactory`で成功する。DSFの拡張子からCLSIDの検索も成功する。
- 関連付け変更通知、短い検証拡張子、明示した検証用ProgIDでも同じエラーが残る。
- Windows標準Thumbnail Cacheの生成は成功、そこからの抽出は同じ`0x80040154`。
- 現在の実行環境は64 bit・通常ユーザー・medium integrity・非restricted tokenで、HKCUは通常のuser Classes hive。
  パッケージの仮想レジストリが原因とは確認されていない。
- 一時登録中の実Explorerも、検証ファイルは白いアイコンのままで、隣のPNG／WebPは表示できた。
- `-TestSurrogate`による独立したCOM別プロセス起動も未成功。登録は毎回解除済み。

`verify-shell.ps1 -InspectSeconds 120`は最大2分だけ検証登録を保持してExplorerで確認できる。
既存の`.dsp`／`.dsf`、既定アプリ、Windowsの隔離設定、セキュリティ設定は変更しない。
成功するまで一般配布や実ファイルへの登録へ進めない。

## 配布前の残作業

1. DSPの任意表紙PNG同梱は承認・実装済み。Flow表紙など現時点で省略している構成への対応を検討する。
2. Windows連携ソフトの登録・解除・更新を実装する。既定の「開く」アプリや既存の種類別アイコンは上書きしない。
3. codec依存、署名・配布方法、隔離プロセス、Explorerの実表示、アンインストール復元を確認する。
4. 第2段階の本文プレビューへ進む。固定テキスト・言語・ページ順を既存Viewerと照合し、
   画像だけを抜き出して本文が欠けたプレビューを完成扱いしない。

Microsoftの根拠:
- [Thumbnail handlers](https://learn.microsoft.com/en-us/windows/win32/shell/building-thumbnail-providers)
- [Preview handlers](https://learn.microsoft.com/en-us/windows/win32/shell/building-preview-handlers)
- [In-process extensions](https://learn.microsoft.com/en-us/windows/win32/shell/shell-and-managed-code)
