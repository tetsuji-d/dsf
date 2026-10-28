# Horizon埋め込み — staging実装・検証記録

日付: 2026-10-25。作業場所: `C:/Users/tetsu/.codex/worktrees/horizon-publishing/dsf`。
ブランチ: `codex/horizon-publishing`、HEAD: `96b7a05c178a9c8497de3790b42dcaeebb1fe1d2`。
既存の未コミット変更へ追加。コミット、mainマージ、本番反映は行っていない。Writing作業ツリー・既存outputsは保持。

## 配備

- 最終staging: https://staging.dsf-studio.pages.dev
- 最終デプロイ: `6d13069b`（WranglerのDeployment completeを確認）
- 埋め込み検証HP: https://embed-check.dsf-studio.pages.dev
- 不許可側の検証origin: https://91a5ebcf.dsf-studio.pages.dev
- 検証版: `e_993afc8c9ac3debd2b171edbd883278df828fb87b52373e96a1bbddb73976378`、「Horizon通し確認 20261024」。既存の公開テスト版を使用。本文・Release・URLは変更していない。
- テスト版の最終設定は指定サイトのみ（`https://embed-check.dsf-studio.pages.dev`）。他の版は未設定=off。
- Firestore `vmnn-26345-stg` の `reader_view_sessions.expiresAt` と `reader_rate_limits.expiresAt` はTTL **ACTIVE**。本番へ設定していない。

## 実装

- リーズの「版の設定 → 共有・埋め込み」にoff/全HTTPSサイト/指定サイト、設定保存、コードコピー、表紙見本、owner本文プレビュー、条件付き閲覧数を追加。
- per-edition設定は既存所有者API・revision競合・requestIdの契約で更新。Release本文は更新しない。
- `/embed/{editionId}` の動的HTMLが公開状態と許可設定を検証し、CSP frame-ancestorsで全祖先を制御。失敗時もframe拒否。HTML/metadataはno-store。
- 通常の `/viewer` と `/viewer.html` は外部iframeを拒否。トップレベルの通常リンクは埋め込み設定で制限しない。
- 表紙→読む→既存Readerの固定ページ。ページ送り、ページ数、言語、拡大/戻る、通常Readerリンク。余分な通常Reader UIを隠し、埋め込みでログイン・SW起動を行わない。
- 表紙ロードでは集計しない。本文描画後の50%以上・前面5秒、または読者操作による別ページ表示で候補を送る。旧load由来view_startは送らず、新指標を旧metric_eventsから分離。
- serverの不透明ticket、30分固定窓、transactionで重複排除と版別/日次集計を同時確定。受付上限と保存期限を設定。clientがカウンターを書き換える経路は追加していない。
- 設定変更・公開状態の確認は60秒周期と復帰時。revision変更時は再読み込みし、通信失敗中は本文を隠して再試行を案内。

## 実環境で確認した結果

|確認|結果|
|---|---|
|許可した外部HTTPSサイト|表紙と「読む」が表示され、本文2ページを閲覧できた|
|指定外ドメイン|ブラウザーがiframeを拒否。iframe外の通常Readerリンクは残る|
|全サイト許可|それまで拒否された別HTTPS originでも表紙が表示された|
|off|iframeが拒否され、同じ版の通常URLは本文を表示した|
|通常URLへの置換での迂回|外部iframeへ `/viewer?edition=...` を入れても拒否された|
|HTTPヘッダー|any時frame-ancestors https:、HTML no-store。viewer/viewer.htmlはframe-ancestors self・no-cache|
|読む前|表紙表示を繰り返しても新集計0のまま（初回測定）|
|読む・再読み込み|初回条件成立で1、HP再読み込み後に再び読んでも1。UI状態counted→duplicateとserver集計を突合|
|同じ版を二つのiframe|両方で本文を開き、両方duplicate。server集計へ追加なし|
|ページ送り|1/2→2/2、先頭/末尾の無効状態、固定ページを確認|
|拡大と戻る|埋め込み内から全画面、横向き844×390でもページを比率保持。戻るでHP内へ復帰|
|コードコピー|clipboardに固定版のiframeコードと通常リンクが入る。成功表示「埋め込みコードをコピーしました。」|
|設定表示|390pxで設定・ドメイン入力・コード欄・見本をスクロールして目視。配色問題を発見して修正し、最終版で再確認|
|TTL|両保存面のTTLがACTIVEになったことを管理APIで読み取り確認|

複数タブや30分の境界を含む検証全体で数値は増えるため、最終総数を「初回測定の1」と混同しない。後半の読み取りでは5（embed2/reader3）。同じ固定窓・同じセッションの再送について増分0を確認した。

## 画面確認

Chromiumによる画面幅/端末エミュレーション。PC 1280/1440、中間768、スマホ360/390/430、横向き844×390。本文と操作部が見える位置で画像を確認し、360pxでページ送り、横向きで拡大/戻る、390pxで設定・コピーを実操作。
主要操作はCSS上44px以上（エミュレーションの丸めで計測43.99px）。9:16本文、角丸なしの表紙、狭幅の折り返し、ライト/ダークを確認。DOMのはみ出し検査だけで完了とはしていない。

証跡は `outputs/embed-20261025/` に保存:
- `cover-light-390.png`
- `reader-360.png`
- `reader-dark-430.png`
- `reader-1280.png`, `reader-1440.png`, `reader-768.png`
- `reader-fullscreen-844.png`
- `settings-390-final.png`
- `normal-link-off-390.png`（off中に開いた通常Reader。撮影時の表示倍率は他の端末幅証跡と分けて扱う）

最終の6d13069bでは設定欄の配色とコピー完了文言を変更し、その画面を再検証。埋め込みReaderの画像は同じReaderコードの178f3504で採取。

## 自動検証

以下が合格:
- `scripts/verify-reader-embed.js`: ポリシー正規化、悪意ある値の拒否、HTMLエスケープ、fail-closedヘッダー、可視性リセット、trusted navigation、ticket偽造・早過ぎる送信・期限切れ・非公開の拒否、並行12送信を1確定、offでも通常Readerを許可。
- `scripts/verify-editions.js`: 版とURL固定・ライフサイクル・競合・廃棄再開・API境界。
- `scripts/verify-edition-list-reader.js`, `scripts/verify-edition-reads-session.js`: 一覧取得、認証境界、再試行、古い応答の破棄。
- `scripts/verify-viewer-release-route.js`, `scripts/verify-viewer-fixed-text.js`, `scripts/verify-dsf-horizon-viewer-load.js`: 固定版ルート・固定テキスト・v2公開loaderの回帰。
- 変更JSの構文確認、`git diff --check`、staging build。CRLF変換警告と既存のpreview環境SHARED_AUTHORING_ENABLED警告は別項目として残る。

## 未確認・制約

この記録は初回検証時点。[追加検証](horizon-embed-followup-20261025.md)で固定テキスト、日英切替、状態/許可先の変更、入れ子、Refererなしを追加確認し、停止案内と欠損ページの集計条件を修正した。最新の残項目は追加記録を参照。

- iPhone Safari/Android実機タッチ、Firefox/WebKitは未確認。スマホ幅のChromium確認を実機合格とはしない。
- v2固定テキストのloader/rendererは自動回帰に合格したが、実サイト埋め込みの多言語・混在版は未確認。今回は既存テスト版の2ページで実操作した。
- 入れ子iframe、Refererなし、長いタイトル・欠損表紙、低速・オフライン、全公開状態の実ブラウザー再試験、旧別名ホスト/SWの全組み合わせ、通信量/負荷測定は残る。これらは仕様の全受け入れ試験の完了扱いにしない。
- 30分はepoch基準の固定窓。別タブや保存禁止環境、別サイト、別ブラウザーを人物として統合せず、閲覧数をユニーク読者数とは呼ばない。匿名の不正な自動アクセスを完全には防がない。
- 表紙見本はローカルの見た目確認で、CSPの許可テストではない。本文プレビューは既存owner Readerを使用。
- 新指標の画面はリーズの当該版内。旧ダッシュボードの過去集計への合算や遡及換算はしない。

## 再開時

仕様・保存契約・この検証記録を読み、現在の作業ツリー差分を確認する。未確認事項の実機受け入れを進める。mainへのマージ・本番反映は別途ユーザー指示を待つ。
