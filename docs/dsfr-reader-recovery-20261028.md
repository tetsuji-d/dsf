# Writing付きDSFRのReader読み込み復旧（2026-10-28）

## 調査対象と結果

- 利用者が提供した `潮騒の図書館-writing.dsfr` を読み取り専用で検査。ファイルは配布成果物へ含めない。
- 1,553,892 bytes。SHA-256: `262c8c6741f8291d332569865c1f5d599f52943505d5b0202ce42faeda730fef`。検証前後で不変。
- strict ZIP/CRC、JSZip CRC、DSF v3のentry hash・フォント・本文・書き込み・履歴検査に合格。
- `writing-editable`、日本語10ページ、書き込みのあるページ2件、履歴31状態（開始時点＋30操作）。
- 旧stagingで `Unsupported DSF archive manifest contract.` を再現。Writing対応のビルド指定がなく、v3をv2 loaderへ渡していた。
- 利用者の画像にあった `Local DSF ZIP could not be opened or failed CRC validation.` は、このファイルでは再現しなかった。今回の修正がすべてのZIP読込障害を解消したとは判断しない。

## 修正

- stagingビルドはWriting/DSFR runtimeとUIを必ず同梱。Viteと配布pluginで同じ判定を使用し、指定忘れによる機能欠落を防止する。
- 必要素材がなければビルドを停止。本番の明示有効化条件、開発プレビューの条件は維持。
- 意図的にWritingを無効にした開発ビルドでv3を選んだ場合、未対応を明示して停止する。CRC/hash等の検査は緩和しない。
- ファイル読み込みエラーのダイアログを出す前に進捗表示と待機カーソルを終了する。
- 既存local package検証の言語ページ対応に関する静的assertionを、現在の引き継ぎ実装の `sourceIndex` に追従。

## 検証

- `node scripts/verify-writing-build-policy.mjs`: 合格。
- `node scripts/verify-dsf-local-viewer-package.js`: 合格（v2の正常系と不正データ拒否を維持）。
- `node scripts/verify-reader-position-link.mjs`: 合格。
- `node --check js/viewer.js`: 合格。
- `npm run build:staging`: 合格。Writing素材は既存Writing作業ツリーの検証済みoutputsを `DSF_WRITING_BUILD_ASSETS` で読み取り、許可リストとハッシュ検査で同梱。
- ローカルおよびstagingのファイル選択から添付DSFRを開き、表紙、ページ送り、固定テキスト、保存済み手書き、Writing起動、履歴一覧を確認。
- PC 1280×720とスマホ幅390×844で目視・操作確認。実機Safariは未確認。
- ローカル5195では古いReaderがキャッシュされていたため、新しい5298の検証用originで確認し直した。stagingでは新しいJSの読込を確認して操作。
- 証跡: `outputs/dsfr-reader-20261028/staging-pc-writing.png`、`staging-mobile-history.png`。

## 反映

- staging: `https://20190c59.dsf-studio.pages.dev` / `https://staging.dsf-studio.pages.dev`
- Viewer: `/assets/viewer-fn1GXnjM.js`
- mainマージ・本番反映・コミットは行っていない。元DSFR、既存作業・outputsは保持。
- 今回はDSFR読み込みの復旧のみ。公開ストリーミングへのWriting接続、Reader UI統一、印刷/PDF、PowerPoint取り込みは別の作業として残る。
