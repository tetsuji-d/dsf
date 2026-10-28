# 埋め込み自動切替 — staging反映 2026-10-26

## 同日追加: iPhone Safariの通常タップで元ページが残らない報告への対策

- ユーザー実機: iPhone Safariでロゴ／全画面からReaderへ移るとJimdoタブが残らない。ロゴ長押し「新規タブで開く」では残る。二重読み込みによるタブ再利用は実装しておらず、旧ロゴもtarget=_blank。Safariでの根本原因は未確定。
- ロゴなどのReaderリンクは通常クリックの同期処理でabout:blankの新しいタブを確保し、openerを切ってから絶対URLのReaderを読み込む。preventDefaultで元リンクとの二重起動を防ぐ。開けない場合は元ページへフォールバックせず案内を出す。長押しと修飾キー操作は通常のリンク動作を維持。
- 全画面は引き続き現在の埋め込みを全画面化。非対応・失敗時の非同期window.openを削除し、「Readerを別タブで開く」リンクを提示。明示クリックで新たなユーザー操作を受ける。案内は閉じる／Escと起点へのフォーカス復帰に対応。
- staging deployment `be05fd43`。`viewer-CwJej3qx.js` / `viewer-CghnOJ9N.css` と配信実体のバイト一致を確認。main・本番・発行データ・許可ドメインは未変更。
- 自動検証: verify-embed-reader-navigationで同期open→opener切断→navigate、ブロック／例外／既存context保護、修飾クリック維持、全画面成功／非対応／拒否を確認。verify-reader-embed、構文、build成功。
- 実UI: ChromeでJimdo内のロゴを通常クリックし、元のJimdoタブ185858424を保持したままReaderタブ185858431が新規作成されることを確認。IABでも直接表示した埋め込み22からReader23が作成され元画面保持、全画面開始・終了を確認。
- 未確認: iPhone Safariでの症状解消、実機長押し継続、非対応／ブロック時案内のスマホ画像・実操作。検証用read-only DOM APIはwindow.openerを提供せずundefinedを返すため、実ブラウザーでのopener切断をこのAPIから確認したとはしない（ユニット検証は実施）。

## 同日追加: 共通の細いページバー・1操作1送り・しなり

- 最終staging deployment: `428617ff`。`viewer-CtHRTGZY.js` / `viewer-D1awpDGn.css` はdistと配信実体のバイト一致を確認。
- 最終配信版で次ボタンから1/10→3/10の見開き送りと3pxバーを画像確認。証跡: `outputs/embed-responsive-20261026/shared-page-bar-pc.png`。
- 通常Readerと埋め込みのページバーを共通化。従来の長方形ページ表示を高さ3pxの区切りに変更し、既読・現在・表示中のページを色で識別する。RTL/LTRを反映し、見開きの組と大量ページの省略を維持。最下部に残し、操作表示中は44pxの操作領域からクリック・ドラッグ・キーボードで移動できる。通常Readerのプレビューは維持。
- 埋め込み左右矢印はReaderと同じSVGを使用。中央ページ送り・左右操作の固定位置と約3秒の自動非表示は維持。
- 強いスワイプから連続めくりへ移る経路を除去。単ページは1ページ、見開きは1見開き単位で送る。キー長押しなど別入力の既存動作は変更しない。
- 埋め込みでも本文中央からのドラッグで指に追従するしなりを開始できる。途中で指を戻すとキャンセル。通常の送りは短いアニメーションで、動きを減らす設定ではしなりを省略する。
- PC1280pxの通常Reader／埋め込みでバーからの移動、通常ReaderでHome／Endによる先頭・末尾移動を確認。10ページの区切りが実測約3px、UI非表示でも表示を維持。
- Chrome390×844タッチエミュレーションで、埋め込みのドラッグ途中のしなり、逆戻りキャンセル、大きなスワイプで3→4の1ページ送りと停止、バーから3ページ目への移動を確認。通常Readerでも2→3のindex変化で停止、動きを減らす設定でも3→4のindex変化を確認。430pxと横向き相当のバー幅もDOM確認。
- モバイル読書中の画像取得はChrome capture timeoutのため目視合格としない。実機タッチも未確認。360px切替直後は古い寸法が返ったため、今回の確認寸法に算入しない。
- 構文検査、ページバー・peek geometry・見開き・埋め込みの既存回帰、staging buildが成功。mainマージ・本番反映・コミットなし。既存の未コミット変更とoutputsは保持。

## 同日再調整: 影の強化・ロゴ同時非表示・進捗バー

- 最終staging deployment: `0f058c8d`。`viewer-DZuhcJ5k.js` / `viewer-XqgH8EQL.css` は配信実体とdistのバイト一致を確認。
- タイトルは2層のtext-shadow、ロゴ・ボタンは2層のdrop-shadowへ強化。角丸背景は復活させない。
- Horizonロゴも他のボタンと同じ約3秒タイマー／中央タップで非表示にする。以前の「常設」は本項で置き換え。
- ロゴは既存のtarget=_blank / rel=noopenerを維持し、通常Readerが新しいタブに開くことと作品表示を実確認。元の埋め込みタブは保持。
- 最下部に高さ3pxの表示専用進捗バーを追加。ページ表示数と同じindex+1 / totalで更新し、RTLは右起点、LTRは左起点。操作非表示時も残し、公開状態の再確認中／閲覧不可時は隠す。aria progressbarで現在ページと総数を提供。
- PC1280pxで1→3→4の更新、4/10で右端から512/1280pxの塗り、ロゴopacity=0と進捗の維持を確認。画像 `controls-progress-pc.png`。
- Chrome390×844で1→2→3→4のボタン操作と20%／40%の進捗更新、ロゴ非表示を確認。2/10（空白ページ）で最下部3pxの画像確認は成功したが、本文4/10の画像取得は再びtimeoutのため目視未確認。実機タッチではない。
- 同一URLの確認用ブラウザーが前版HTMLを保持していたため、検証用query付きURLで新bundleの読み込みを確認。公開データ・ドメイン設定は変更なし。
- 構文検査、verify-reader-embed、verify-embed-layout、staging buildが成功。mainマージ・本番反映なし。

## 同日再調整: 影のみ・連続操作を妨げない非表示

- 最終staging deployment: `f11c2953`。下記の局所的な角丸背景／即時非表示の仕様は本項で置き換える。
- タイトル・ロゴ・ページ送り・全画面・言語アイコンの背景を撤去し、薄いtext-shadow／drop-shadowのみ使用。中央の読むボタンと開いた言語メニューは従来どおり。
- 表示中のページ送りは非表示タイマーを約3秒へ更新し、続けて押せる。非表示中のキー・スワイプは表示を復活させない。中央タップで再表示、左下ロゴは常設。
- マウス／タッチでクリックした後のfocusは非表示を妨げない。キーボードのfocus-visibleと開いた言語メニューは操作保護のため表示を維持する。
- 埋め込みボタンのclickが通常Readerの汎用click処理に伝わって即時非表示になる干渉を除去。
- staging実操作: PCで次ボタンを2回連続クリックし1→3→4、各クリック直後hidden=false、待機後hidden=true。中央で復帰。`controls-shadow-pc.png`。
- Chrome390×844端末エミュレーションで次を2回連続操作し1→2→3、直後hidden=false、待機後hidden=true。非表示中のタッチスワイプで3→4、hidden=trueを維持。実機タッチではない。
- 外部ホストの390px iframeで影のみの表紙・ロゴ・全画面を画像確認（`controls-shadow-narrow.png`）。端末エミュレーション読書画面のスクリーンショット不調は継続し、その範囲は目視未確認。
- 構文、verify-reader-embed、verify-embed-layout、verify-viewer-spread-navigation、staging buildを確認。mainマージ・本番反映・公開データ変更なし。

## 同日追加: 局所背景・ページ送り中の操作非表示

- 最終staging deployment: `621084e5`（完了）。`viewer-BXViL97j.js` / `viewer-iZrHR3sZ.css`。
- 上下全幅のグラデーションを撤去し、タイトル・ページ送り・ロゴ・全画面・言語の周囲だけに半透明背景を配置。
- 埋め込みの次／前ボタン、矢印キー、ページカール、単ページ内の見開きスワイプで操作を隠す。通常Readerの挙動は維持。
- マウス移動や矢印キーは再表示の契機にしない。中央タップ／クリックとTabで復帰。Horizonロゴは左下に常設。
- 実検証でpointer capture後の中央タップが通常Readerの表示状態と干渉する問題を発見し、埋め込みのクリック経路を分離して修正。
- PC1280px: 次ボタンで非表示、ページ1→3、中央クリックで再表示、左矢印で非表示と本文4へ移動、中央で復帰を確認。`controls-local-pc.png`。
- Chrome390×844タッチエミュレーション: 右スワイプでRTLページ1→2、操作非表示、ロゴopacity=1、中央クリックで再表示を確認。実機タッチではない。
- スマホ寸法の読書画面は検証ツールの画像取得不調（IAB縮尺不整合／Chrome capture timeout）のため目視合格とはしない。外部ホストの実幅390px iframeで表紙・局所背景・下部ロゴ・全画面の配置を画像確認。`controls-narrow-host.png`。
- 構文、verify-reader-embed、verify-embed-layout、verify-viewer-spread-navigation、staging build、diff検査が成功。main・本番・公開データ・許可ドメイン変更なし。

## 同日追加: 操作位置固定・背景透過・Reader別タブ

- 最終staging deployment: `26a4a580`。新コードはiframe外のReaderリンクを出力しない。既存HPに貼られたリンクはHTMLの貼り替えで除去する。
- ページ周囲を透過。発行済みページの背景・画像・固定テキストは変更しない。
- Horizonロゴはiframe左下に常設し、クリックで通常Readerを別タブへ。ページ送りはiframe下部中央、全画面は右端へ固定。表紙／見開きでcanvas寸法が変わってもボタン位置は変わらない。タイトル・ページ送りの自動非表示時もロゴは残る。
- ReaderへのPWAリンク受信通知に「別タブで開く」を追加。同じ画面へ移る選択肢は従来の編集保護を維持。インストール済みPWAをどの窓で開くかはブラウザー側にも依存するため、強制別タブを保証しない。
- 埋め込み中央の透明な操作領域からtitle属性を除去し、「メニュー表示/非表示」のブラウザーツールチップを出さない。aria-labelは保持。
- 自動回帰: verify-reader-embed / verify-embed-layout / verify-platform-navigation / verify-platform-identity、構文検査、staging build、diffチェックが成功。
- 実UI: PC1280pxで表紙1/10・見開き3/10・本文4/10の次ボタン位置が同じ（x=571.0065,y=674.0098）。背景rgba(0,0,0,0)、タイトル属性なし。隠した状態でロゴopacity=1／ページ送りopacity=0。
- Horizonロゴをクリックしてstaging通常Readerが別タブに開き、固定テキスト本文が表示されることを確認。
- URL受信を模擬したローカルUIで別タブが実際に開き、元のテキストを保持。「この画面で開く」は移動ガードがfalseのとき移動しないこと、キャンセルで通知が閉じることを確認。実インストール済みPWAへのOS起動は未確認。
- スマホ390pxでDOM幅・ボタン非重複を確認。デバイス幅変更時の画像取得に不整合があり、その読書画面スクリーンショットは合格証跡に使用しない。外部検証ホストで実際に幅390pxのiframeを作り、表紙・左下ロゴ・全画面・透過を画像で確認（`transparent-narrow.png`）。実機タッチは未確認。
- main・本番・既存発行データ・許可ドメインは変更なし。

## 反映

- Worktree: `horizon-publishing/dsf`、branch `codex/horizon-publishing`、基点 `96b7a05`。既存未コミット変更を維持。
- staging deployment: `a8484a10`（完了）。mainマージ、コミット、本番反映なし。
- 配信された `viewer-CXL5INpa.js` と `studio-DKRvBjW-.js` はローカルdistとバイト一致。
- 検証用外部ホスト: `https://embed-check.dsf-studio.pages.dev/responsive`（生成コードをそのまま配置）。

## 今回の実装

- 新しい埋め込みコードは親幅に追従し、最大720px、最大高さ640px／画面高80%に制限。幅640px以上とページ可読幅の両方を満たす場合に見開きを使用。狭い列や低い横向き画面では1ページ。表示中のページを保持して再計算。
- 表紙は9:16を維持し、題名・正式Horizonロゴ・中央の読むアイコン・全画面アイコンを重ねる。読む操作時にLTR／RTLに対応する本の開くアニメーション。動きを減らす設定を尊重。
- 小口はReaderの既存描画を使用。コード単位でフラット表示も選択できる。詳細設定は自動／1ページ／見開き優先と小口の有無。公開・ドメイン権限の保存とは分離。
- 読書操作を本文上へ重ね、自動非表示とキーボードフォーカス維持を実装。表紙へ戻すボタンなし。
- mobileのlayout viewportが旧PC幅を引きずる問題を検証中に発見し、iframe自身のdocument client寸法を基準として修正。
- 旧コードも読めるが、旧HTMLに固定された480px・9:19の外枠は変更できない。自動外枠には新コードを一度貼り直す必要がある。

## 確認済み

- 構文検査、verify-embed-layout、verify-reader-embed、verify-viewer-release-route、verify-edition-reads-session、verify-viewer-fixed-text、verify-dsf-horizon-viewer-load、staging build。
- staging実ブラウザー: 写真表紙と白い表紙、アイコンから読書開始、固定テキストのRTL作品で本文2ページ見開きとページ送り。
- 1280×720／1440×900のPC表示、360×800／390×844／430×932のスマホ幅、844×390の横向き。画像による目視とDOM寸法を併用。390pxでscrollWidth=clientWidth=390、360pxでも横はみ出しなし。
- 同じ読書画面をPC→スマホ→PCへ変更して表示ページ4/10を維持。スマホでは1ページ、PCでは見開きへ復帰。
- 全画面への移行と終了、その他メニューの開閉、Escapeで閉じる操作。
- ログイン済みStudioの埋め込みモーダルで自動設定と新コードの出力を確認。既存許可ドメインは変更していない。
- 外部ホストのiframe読み込みと、親列390px／720pxへのサイズ追従。許可された外部ホストで表紙を表示。

## 残る確認と区別

- ブラウザーのスマホ幅検証であり、iOS／Android実機タッチ確認ではない。
- JIMDO公開ページの既存コードは読み取りのみ。新コードへの貼り替えやJIMDO編集画面の変更は行っていない。
- 外部iframe内のクリックはブラウザー操作接続が対象を失うため、今回は完了扱いにしていない。読書開始・見開き・全画面は同じstaging埋め込みURLを直接開いて検証。
- 今回は多言語切替、LTR実作品、公開状態変更中の実ブラウザー試験を再実施していない。既存権限・閲覧数の自動回帰は合格。実view数や実機性能の改善は主張しない。
- Studioの静的な表示見本は既存の表紙見本であり、全操作を再現するモックではない。

画像: `outputs/embed-responsive-20261026/cover.png`、`pc-spread.png`、`pc-1440.png`、`mobile-390.png`。
