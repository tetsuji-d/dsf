# Horizon埋め込み追加検証 — 2026-10-25

作業ブランチ: `codex/horizon-publishing`、基点HEAD `96b7a05`。既存差分・outputs・Writing作業ツリーを保持。mainマージ・本番反映・commitは行わない。

## 修正とstaging

staging deployment: `a75e8638` (`https://staging.dsf-studio.pages.dev`)。

- 非公開/アーカイブ、埋め込みoff、通信失敗を停止案内で区別。
- 再確認中・表示不可の間は本文とページ送り操作を隠す。通常Readerリンクと再試行は残す。
- 旧版の言語別画像URL欠損は「この版には、この言語のページが収録されていません」と表示。欠損案内を表示中は時間経過でもページ送りでもview成立条件を満たさない。
- 既存の版内容は変更しない。無断の原文fallbackや翻訳生成は行わない。

## 内容の実ブラウザー確認

ChromiumのPC/端末幅エミュレーション。実機タッチの合格を意味しない。

- v2固定テキスト版 `e_6cf0f10c…`（16ページ、日本語）: 1440pxで縦書きタイトル、390pxで縦書き本文を表示。認定Serifフォントを使用した固定テキストDOMを確認。画像ページ→固定テキストページへの送りも実操作。
- 旧WebP多言語版 `e_34b5d0c…`（18ページ、ja/en-us）: 1280pxで英語タイトル、390pxで日本語本文、言語切り替えを実操作。英語1〜3ページはURL未収録。英語7ページは配信された画像自体が空白（元画像を別タブで確認）。空白の元画像は欠損URLと区別する。
- v2固定テキストと多言語を**同一の版で組み合わせた実サイト確認**は残る。今回の別々の確認とloader/renderer自動テストだけで代替しない。
- 修正後の未収録案内は360pxで確認。

## 公開状態とドメイン

状態変更は、staging専用のテスト版 `e_993afc8c…` を対象に実施。Firebase CLIの既存管理認証で本体の `createEditionsService` とFirestore transactionを実行し、匿名ブラウザーから結果を確認した。今回の変更操作をStudio所有者UIの受け入れ合格とはしない。

- 公開→非公開: 開いていたiframeの定期確認で本文を停止。修正後はページ送りも非表示となり、非公開の案内と再試行・通常Readerへのリンクだけを表示。新しく開いた通常Readerも非公開の案内。
- 非公開→限定公開: 停止画面の再試行で表紙へ戻り、読む操作で再開。通常Readerも同じURLで再開。
- 入れ子: 外側 `embed-check.dsf-studio.pages.dev` だけ許可、中間 `embed-middle.dsf-studio.pages.dev` 未許可では拒否。両方を明示許可すると表紙を表示。中間が許可済みでも外側の別origin `e824c8aa.dsf-studio.pages.dev` が未許可なら拒否。
- 閲覧中の許可先削除: HPを再読み込みせず、定期確認によるiframe再読み込みでブラウザーが接続拒否。同じ版の通常Readerは閲覧を継続できた。
- アーカイブ: metadata API 404、通常Reader非公開案内。復元はprivateとなりAPI 404と非公開案内を維持。明示的なpublic操作後にAPI 200へ復帰。
- `referrerpolicy="no-referrer"` のiframeでも許可サイトなら表紙を表示。Refererの有無に依存せずCSPの祖先判定を使用する。
- 閲覧中のoff: 430pxダーク画面で「埋め込みは許可されていません。通常のリンクからReaderで開けます」と表示、本文/ページ送り非表示。通常Readerは本文を表示。定期確認は公称60秒で、ブラウザーの背景タブ制限により遅れる場合がある。即時失効とは表現しない。

ポリシー/状態変更のたびにRelease文書のSHA-256を初期値と比較して不変を確認。URLの版IDも変更しない。

終了時にテスト版は元のpublic/許可サイトembed-checkへ復元。固定テキスト版と多言語版は元のunlisted/offへ復元した（revisionは監査上増加）。操作後の配信API応答を `state-results.jsonl` に保存。元のReleaseは3版とも不変。

## 回帰検証

`verify-reader-embed.js`、`verify-editions.js`、`verify-viewer-fixed-text.js`、`verify-dsf-horizon-viewer-load.js`、`verify-viewer-release-route.js`、`verify-edition-reads-session.js` 合格。未準備/欠損ページでは40秒経過やtrusted navigationでも候補を出さず、準備完了後に待ち時間が始まる回帰を追加。staging build/deploymentと`git diff --check`完了。

証跡: `outputs/embed-followup-20261025/`。`fixed-text-pc.png`、`fixed-body-390.png`、`multilingual-en-pc.png`、`multilingual-ja-body-390.png`、`private-after-fix.png`、`nested-middle-denied.png`、`nested-allowed.png`、`nested-outer-denied.png`。

追加証跡: `missing-language-360.png`、`domain-revoked-live.png`、`restored-private.png`、`noreferrer-allowed.png`、`embed-off-dark-430.png`。

## Wix / Jimdoでの確認

WixはHTMLまたはURLの埋め込みを提供する。入れ子になる場合は、外側の公開サイトと中間iframeのHTTPS originを明示的に許可する必要がある。今回の一般的な入れ子テストはWix実サイトの合格を意味しない。中間originは推測して登録せず、実際の公開ページで確認する。ドメイン指定はURLパスごとの制限ではない。

Jimdo CreatorはWidget/HTMLにコードを貼り付けられる。Jimdo Website Builderは任意HTML/iframe非対応なので、通常Readerリンクで案内する。

公開した検証ページで、PCと実スマホの「読む」「ページ送り」「言語」「拡大/戻る」「通常Reader」の動作と、枠の高さ・スクロールを確認する。編集画面だけで判定しない。

- https://support.wix.com/en/article/wix-editor-embedding-a-site-or-a-widget
- https://help.jimdo.com/hc/en-us/articles/115005947286-How-do-I-add-widgets
- https://help.jimdo-dolphin.com/hc/en-us/articles/26931604070044-Adding-custom-code-or-external-widgets-in-Jimdo-Website-Builder

残る範囲: 実機Safari/Android、Firefox/WebKit、Wix/Jimdo実サイト、低速/オフライン、旧ホスト/SWの全組み合わせ、全公開状態の閲覧中遷移、通信量/負荷試験。前回の指標の制約（固定窓・セッション単位、人物数ではない）は継続。
