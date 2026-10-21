# Writing ステージングの再ビルド

Writingは専用フラグを付けたstaging／開発ビルドだけで有効になる。productionでは通常無効。明示的な本番リリースは末尾の手順を使用する。
実装コード、検証スクリプト、ライセンス、固定版依存のlockfileをGit管理する。
`outputs/`内のユーザーDSF、ダウンロード、スクリーンショット、検証結果はコミットしない。

## 初回準備

リポジトリーのルートから実行する。Node/npmと公開フォント・ライセンス取得のネット接続が必要。

```powershell
npm ci
npm ci --prefix scripts/writing-w0 --ignore-scripts
node scripts/writing-w0/prepare.mjs
node scripts/writing-w1/prepare-preview.mjs
```

W0準備は固定版フォントとnoticeのSHA-256を照合し、lockfileで固定したライブラリとライセンスを`outputs/writing-w0/`へ用意する。
W1準備は書体metadataを合わせたcatalogと架空の8ページサンプルを生成する。個人の原稿は参照しない。
配信用の`staging-assets.mjs`は明示したファイルだけを読み、サンプル・書体・ライブラリのhashを確認する。

## 検証と公開

```powershell
$env:DSF_WRITING_PREVIEW='1'
node scripts/writing-w1/verify-history-pages.mjs
node scripts/writing-w1/verify-history-file.mjs
node scripts/writing-w1/verify-staging.mjs
npm run build:staging
```

コミット対象を確認し、ステージング公開の指示がある場合だけ、同じ環境変数を設定したシェルで実行する。

```powershell
npm run deploy:staging
node scripts/writing-w1/verify-staging-remote.mjs
```

確認URLは `https://staging.dsf-studio.pages.dev/viewer?src=/writing/sample.dsf`。
配信ファイルの照合に加え、ReaderからWritingへ入り、見開き・別ページのUndo/Redo・編集用DSF書き出しを実操作で確認する。
本番公開、mainマージ、Firebase rules更新はこの手順に含まない。


## 本番リリース（2026-10-21）

累積変更の本番反映が承認された場合、`DSF_WRITING_RELEASE=1` を指定すると本番ReaderのWriting入口と検証済み配信資産を有効にする。PREVIEWフラグのみでは本番は有効にならない。配信許可リスト・ライセンス・SHA-256検証・オフライン範囲は共通で、検証用のファイル書き出し処理は含めない。

クリーンなmainで配信する場合、`DSF_WRITING_BUILD_ASSETS` に事前準備済みの outputs ディレクトリーの絶対パスを指定できる。読み込むのは既存の固定ファイルだけで、個人の原稿や検証画像は配信しない。outputs をコピー・コミットしたりGit安全確認を解除したりする必要はない。

`node scripts/writing-w1/verify-production.mjs` と本番ビルドを確認してから、承認された本番配信手順を実行する。
