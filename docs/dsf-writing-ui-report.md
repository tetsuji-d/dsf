# Writing UI試作の実装・操作検証

## 2026-10-11 既存DSFの取込・アイコン・スマホUI修正

利用者報告の `20290901FLOWテスト.dsf` を読取専用で調査した。6,511,517 bytes、portable delivery v2／archive manifest v1、STOREとDEFLATE混在。形式3のSTORE専用読込へ直接渡していたため `ZIP_UNSUPPORTED` になっていた。CRC検証は成功し、破損ファイルではなかった。

`scripts/writing-w1/import-v2.mjs` に片方向の取込を追加。ZIPの件数・展開サイズを制限してから、製品Readerの既存portable v2検証（CRC、全entry hash、認定font、画像、manifest）を実行する。確認済みの元書体を利用してサブセット化し、形式3コピーを生成して通常のWriting読込へ渡す。原本のファイルは上書きしない。旧v1／DSP／未知の元書体は自動変換しない。形式3が宣言されている壊れたファイルを既存形式へfallbackしない。

実ファイルの取込結果は831,317 bytes、18ページ。全ページmanifest（画像hrefのhash正規化を除く）、文字、スタイル、順序が一致し、画像bytesと元ファイルhashが不変。形式3化のためarchive metadataと原本fontは再構成される。Writing保存で保護するbaseは変換後の原本。取込後の筆跡追加、編集用再保存・再読込、共有用の履歴削除、破損ZIP拒否も自動検証した。証拠: `outputs/writing-w1/import-v2-verification.json`。利用者の原稿はステージング配信資源に追加していない。

道具の選択・文字・線・矢印・四角・楕円をSVGアイコンに変更し、ラベル／tooltip／選択状態を保持した。760px以下ではページ上部にペン先と6道具をまとめ、画面下にUndo／Redo、色・設定、履歴、保存を配置する。設定は同一のフォームをmodal sheetへ移し、閉じると元へ戻す。色ボタンは40px、主要道具・下部操作は44px以上。全体表示と幅いっぱいの拡大を切替可能。拡大時のスクロールは閲覧モードで行う。

実ブラウザーの390×740および320×568指定で、横はみ出しなし、パネル開閉、色選択、文字追加、下部Undo／Redo、履歴、保存、拡大切替を確認。指定された実DSFをファイル選択から開き、2ページ目に確認用Writing文字を追加、編集用DSF（UI表示824.2 KB）を生成し、同一bytesの再読込後に文字1件を確認。reload後の下書き復元も成功。元原稿への変更とクラウド送信は行っていない。実スマホのタッチ・OSキーボードは未確認。OSダウンロード完了の確認とは分ける。

回帰: W1 42件、道具15件、製品portable v2 loader、配信資源検証が成功。現在の修正は同じWriting専用ページの範囲であり、製品Press／Reader既定経路は変更していない。

修正版を同じステージングへ反映した。固定URLは https://a4a9c986.dsf-studio.pages.dev/writing/ 、通常URLは https://staging.dsf-studio.pages.dev/writing/ 。Writing version `22adb57ffb0727ba35e3`、配信61資源・13,493,107 bytesの全hashが手元のbuildと一致。基準HEADは引き続き `b16f3fc`、未コミット変更の配信。コミット・本番反映なし。

実DSFをステージングのファイル選択へ渡すブラウザー操作は、非公開ファイルの外部サイトへの提供許可が明示されていないとして自動承認審査が拒否した。回避操作はしていない。したがって、指定実ファイルのブラウザー受入はローカル5194での結果、公開先は全資源のhash照合とサンプルによる表示確認として区別する。証拠: `staging-import-mobile-deploy.log`、`staging-remote-verification.json`、`mobile-icons-ready.png`、`mobile-settings.png`（outputs/writing-w1配下）。

2026-10-11。W2のうち、ユーザーが実際に書き込みを試せるローカルUIを実装した。W2全受入完了ではない。

作業先: `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`。ブランチ: `feature/dsf-writing-w0`。HEAD: `b16f3fc87575a3c7173984c3677320446f319bf5`。W0／W1の未コミット実装を継続。コミット・デプロイなし。作者原稿・他worktree・既存の未追跡素材は変更していない。

## 試す画面

`http://127.0.0.1:5194/writing.html`

```powershell
cd C:\Users\tetsu\Documents\Codex\dsf-writing-w0
node scripts/writing-w1/serve.mjs 5194
```

起動にはW0の取得済みフォント・WASM、W1のcatalogとoriginal.dsfが必要。新しい環境では先にW0のprepare手順、W1のverifyを実行する。現在の作業先では取得済み。元のW1検証画面は `/` に残した。

1. 「サンプルを開く」、または「DSFを開く」で形式3のファイルを読み込む。
2. 道具を選び、ページ上をドラッグする。文字は配置位置をクリックし、ダイアログに入力する。
3. 「選択・移動」または書き込み一覧で選び、移動・削除・文字の再編集を試す。
4. Undo／Redo、履歴一覧からの復元を試す。過去から新規編集しても既存の枝は残る。
5. 「編集用DSFを作成」→表示されたダウンロードリンクで保管する。共有用は履歴なし・編集ロック付きのコピー。共有用作成だけでは作業中の下書きをロックしない。
6. 「オフライン準備」の完了後は、通信を切って再読込し、端末内の下書きを開いて追記・書出しを試せる。

端末下書きはこのブラウザープロファイル／localhostのorigin内のIndexedDBへ保存する。クラウド保存ではなく、別ブラウザーには引き継がれない。下書き保存完了とDSF作成・ダウンロードをUIで分けた。

## 実装

| ファイル | 内容 |
|---|---|
| `js/reader-writing-model.js` | 原本とは独立した編集状態。変更を検証してから反映、分岐履歴、復元、移動、固定位置のテキスト配置 |
| `js/reader-writing-renderer.js` | 保存済み座標からWritingを重ねる。筆跡の幅・筆圧、蛍光マーカーの透過、線・矢印・図形、縦横書き |
| `js/reader-writing-storage.js` | IndexedDB下書き。versionを同一transaction内で比較し、別タブの新しい保存を上書きしない |
| `scripts/writing-w1/writing.html`, `writing.css`, `reader-writing.mjs` | 実描画・文字入力・選択・移動・削除・履歴・DSF入出力の画面。狭い画面用の道具切替 |
| `scripts/writing-w1/reader-runtime.mjs` | Workerでのfont検証・subset処理、入力用完全版の準備とhash確認、オフラインcache |

原本には既存の `viewer-fixed-text.js` を使用し、Writingは別DOMレイヤーにする。W1のopaque handleから原本bytesを変更する経路を設けない。Writing画面は製品の `viewer.html` とHorizonにはまだ露出させていない。

ボールペン、筆ペン、サインペン、蛍光マーカー、修正液、線、矢印、四角、楕円、文字を実装。筆ペンはPointerEventの筆圧がある場合に点ごとの幅へ反映し、マウスでは速度・方向・始端／終端からの距離を使って入り・送り・抜きを疑似表現する。指の2本目やpointercancelで未確定の筆跡を中止する。実ペンでの品質調整は残る。

文字はNoto Sans JP／Noto Serif JP、14／20／28／36px、400／700、色、縦横をテキストボックス単位で選択できる。単純な折り返し・縦書きセル配置の試作であり、禁則処理・ルビ・文字範囲ごとのリッチ編集はまだない。保存時はW1の実subset生成と検証を通す。取得できない入力用書体や未収録字形はエラーにし、代替書体で保存しない。

共有用documentIdが上限128文字の場合に、接尾辞の追加で保存に失敗するW1の境界条件も修正し、回帰試験を追加した。

## 確認した操作

Windows Chromeで実操作を行った。テスト用の架空2ページ原稿だけを使用。

- ペン／筆ペン／サインペン／蛍光マーカー／線／矢印／四角／楕円をドラッグで描画。
- 横書き日本語、改行入りのメモ、明朝の縦書きメモを追加。既存文字をダイアログで再編集。
- 書き込みを移動。文字を削除→Undo→Redo→Undo。削除履歴と新規の枝が双方残る。
- 2ページを往復し、原本と各ページのWritingを表示。
- 編集用DSFをUIから生成し、検証用のローカル保存ボタンで実ファイル化。「DSFを開く」のファイル選択から読込。
- オフライン準備→Chromeの通信遮断→reload→IndexedDB下書き復元→新しい日本語「通信なしで新しい文字を追記」を入力→編集用DSF生成→生成bytesをUIで再読込。
- オフラインで共有用DSFを生成。通信を戻して実ファイル化。UIで開き直し、履歴0、描画・文字・編集用保存の無効化を確認。
- 幅390pxのviewport指定（スクロールバーを除く本文幅375px）で原本・Writingの重なりと横方向のはみ出しなしを確認。実スマホの受入ではない。
- 最終編集用DSFを再読込。ブラウザーのconsole errorなし。通信とviewportの一時設定は解除済み。

通常のBlobダウンロードリンクは実装したが、ブラウザー操作ツールによるダウンロード完了の取得はW1から制約があるため、OSのDownloadsへの保存完了は未確認。今回の実ファイル検証は、UIで生成した同一Blobをloopbackの専用検証フォルダーへ保存し、ファイル選択から読み込む経路で行った。「作成したDSFを開き直す」はメモリー上の同一bytesをloaderに戻すため、ディスク保存完了の代わりとは扱わない。

## ファイルの独立検証

最終編集用: `outputs/writing-w1/browser-saved/browser-1791687095635-54ec0fa1ca22.dsf`

- 157,136 bytes。SHA-256: `54ec0fa1ca223861fd8e211b9f4e79cd06a9ca8476df088170bcf365c66bb3a5`
- 2ページ、11オブジェクト、15履歴、2書体。全描画道具を収録。
- 原本8 entryの全bytesが通常版と一致。原本hash: `2c49152f0e60f146b5d7b685ec0125f8360b9318dc944202153dabe52a000c3e`
- 完全版font／外部notice取得を禁止して再読込・変更なし再保存が一致。
- 以前の文字、削除した状態、別枝を保持。古い履歴の復元・再保存も外部fontなしで成功。

共有用のUI試験ファイル: `outputs/writing-w1/browser-saved/browser-1791686797434-bd69e6c446c7.dsf`。これは10履歴時点から作った共有用であり、最終15履歴版とは同じ時点のコピーではない。79,234 bytes、履歴0、原本一致、変更なし再保存一致。

検証コマンド:

```powershell
node scripts/writing-w1/verify-ui-model.mjs
node scripts/writing-w1/verify.mjs
node scripts/writing-w1/verify-ui-file.mjs outputs/writing-w1/browser-saved/browser-1791687095635-54ec0fa1ca22.dsf
node scripts/writing-w1/verify-browser-files.mjs
```

モデル試験成功。W1回帰42件成功。UIファイル試験成功。ブラウザー作成の既存分を含む5ファイルの独立照合成功。変更JSの構文確認、`git diff --check` 成功。製品エントリや依存を変更していないため、製品build／deployは実施していない。

証拠: `outputs/writing-w1/ui-file-verification.json`、`browser-verification.json`、`ui-offline-reopened.png`、`ui-mobile-shared.png`、`ui-ready.png`。

## 残るW2受入

製品Readerのメニュー／ページ移動との統合、英語UI、スマホ・Safari／Firefox・実ペンの筆圧、IME変換中の操作、ブラウザープロセスを終了した後の再起動、別プロファイルでの移送、容量不足・タブ競合の実操作、文字範囲書式、ブラシの描画品質、実機の性能と上限。形状の回転・自由頂点編集は未実装。Horizon／Pressへの新形式の接続は後続段階。

## 2026-10-11 道具とポイント編集の更新

- 「読む」を道具から外し、閲覧／書き込みモードに変更。ペン先が下向きの選択トレイをページ上部に追加。
- ボールペンは0.3／0.5／0.7 mm相当、黒赤青を含む12色。線と他のペンは同じ12色、蛍光マーカーは7群×5色の専用35色。道具ごとの設定は画面内で保持。
- 線・矢印は2端点、四角・楕円は8個のサイズ変更ハンドルを実装。Ctrlまたはチェックボックスで正方形・正円。端点は近くの線の端点／図形ハンドルへスナップ。追従接続・自由頂点編集ではない。
- 筆ペンは保存した点ごとの幅から1本の輪郭を描画する。入力時に起筆・送筆・収筆を算出し、再読込では再計算しない。
- 修正液は白・不透明のWriting筆跡。原本bytesは変更しない。書式変更時も色を白に固定する。

Windows Chromeで0.3／0.7の赤いボールペン、くすみ色の蛍光、曲線の筆ペン、修正液を描画。チェックボックスで正方形・正円を作成し、四角のハンドルを動かして再編集、青に変更した。矢印の両端を図形ポイントへスナップし、端点を再編集、両矢印へ変更。閲覧でドラッグしても8件のまま増えないことを確認した。Ctrlフラグの形状制約はロジック試験で確認。CDP経由のCtrl入力は図形追加に至らなかったため、Ctrlキーそのものの実機受入は未確認として分ける。

UIから編集用DSFを作成し、同一Blobを検証保存、生成bytesをUIで再読込。8オブジェクト・13履歴が戻った。実ファイルは `outputs/writing-w1/browser-saved/browser-1791690094701-0bc5a99f110f.dsf`（176,823 bytes、SHA-256 `0bc5a99f110fd78454b231da1e1ca6fcfd2405278c2f85168b7b70d879917ebb`）。今回のファイル選択によるディスクからのUI再読込は未実施だが、Node loaderが実ファイルを独立して読み込み、8件・13履歴、90点の可変幅筆跡、白い修正液、65×65と60×60の図形、両端の一致を照合した。原本8 entryのbytes不変と変更なし再保存の完全一致も確認。

`verify-tools.mjs` 15件、`verify-ui-model.mjs`、W1回帰42件、`verify-ui-tools-file.mjs`、既存を含む6ファイルの `verify-browser-files.mjs` が成功。幅390px（本文375px）の横はみ出しなし・全5ペン先表示を確認し、viewport指定を解除。実スマホは未確認。証拠: `tools-verification.json`、`ui-tools-file-verification.json`、`browser-verification.json`、`ui-tools-mobile.png`、`ui-tools-ready.png`（いずれも outputs/writing-w1/）。
## 2026-10-11 Writing専用ステージング確認ページ

公開URL: https://staging.dsf-studio.pages.dev/writing/

固定デプロイURL: https://d58d20e0.dsf-studio.pages.dev/writing/

作業場所は `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`、ブランチは `feature/dsf-writing-w0`。基準HEADは `b16f3fc87575a3c7173984c3677320446f319bf5`。未コミットのWriting実装をステージングへ反映した。コミット・main統合・本番反映は実施していない。以下は従来のローカル検証に追加した記録。

### 配信と再現

- `DSF_WRITING_PREVIEW=1` を設定して `npm run deploy:staging` を実行。通常buildでは無効、productionでは指定しても除外する。
- Writing version: `7feaf19291e990693bc2`。アプリbuild: `v2026.10.11-053155`。
- 明示した61ファイルだけを `/writing/` に配信。キャッシュ対象59資源、13,107,487 bytesを配信先から取得し、ローカルのSHA-256と全件一致した。MIMEとnoindexも照合。
- 架空原稿、入力用2書体、必要WASM、ライセンス表示を同梱。ローカル検証用のファイル保存POST処理は配信しない。
- Service Workerのscopeは `/writing/`。全資源の取得とhash確認が成功してからオフライン用スナップショットを切り替える。失敗時に直前の準備済みキャッシュを保持する自動試験が成功。

### ステージングでの実操作

Windows Chromeでサンプルを開き、青いボールペンと日本語「ステージングで書き込み確認」を追加。編集用DSF生成（56.3 KB）と生成bytesの再読込に成功した。

「オフライン準備」完了後、ブラウザーの通信を遮断してページを再読込。端末内下書きを復元し、新しい日本語「通信なしで新しい文字を追記」を入力した。通信なしで編集用DSF生成（64.8 KB）と再読込に成功し、3オブジェクト・4履歴を確認。

同じ通信遮断状態で、ディスク上の `outputs/writing-w1/browser-saved/browser-1791690094701-0bc5a99f110f.dsf` をファイル選択から開いた。8オブジェクト・13履歴を復元したため、前節で未実施だった当該ファイルのディスクからのUI読込を今回確認できた。共有用DSF生成（49.0 KB）と生成bytesの再読込に成功し、「履歴なし・編集ロック」、書き込みと編集用保存の無効化を確認した。

通信設定をオンラインへ戻し、編集用下書きの復元完了を確認して終了。検証には架空原稿だけを使い、クラウド原稿は変更していない。

### 確認手順と残る制約

1. 確認ページで「サンプルを開く」を押し、ペン・文字・図形を試す。
2. 「編集用DSFを作成」→ダウンロード→「DSFを開く」で端末から読み直す。
3. オフラインで使う前に「オフライン準備」を完了させる。
4. スマホや実ペンで選択しやすさ、描画、ポイント編集を確認する。

ダウンロードリンクを操作したが、ブラウザー操作ツールで完了を取得できなかった。OSへのダウンロード完了は未確認。生成bytesの再読込、既存ディスクファイルの読込とは明確に区別する。実スマホ・実ペン・Ctrlキー実操作、ブラウザープロセス終了後の再起動、製品Reader／Horizon／Pressへの統合は今回の完了対象に含めない。

証拠: `outputs/writing-w1/staging-verification.json`、`staging-remote-verification.json`、`staging-deploy.log`、`staging-writing-ready.png`。自動試験: `node scripts/writing-w1/verify-staging.mjs`、配信後照合: `node scripts/writing-w1/verify-staging-remote.mjs`。

## 2026-10-11 Studioから保存せずに移動する選択肢

Horizonメニューからの移動を、保存確認待ち・処理中という理由だけで一律に拒否していた。専用ダイアログで「編集を続ける」「保存せずに移動」「保存して移動」を選べるよう変更した。保存失敗や保存処理の応答待ちでも、キャンセルと保存せずに移動は利用できる。

保存せずに移動する選択では、待機中の自動保存だけを停止し、同一原稿・同一編集リビジョンに限って離脱警告を一時的に許可する。保存済みの証拠やdirty状態は書き換えない。クラウドデータと復元用コピーは削除しない。開始済みの保存要求は取り消さない。PWA更新時の復元確認と、ホームの「原稿を閉じる」ボタンの条件は今回の変更対象外。

ローカル実Studioで架空の端末原稿を作成し、キャンセル後に編集画面が保たれること、タイトルを変更して再度表示したダイアログから「保存せずに移動」でReaderへ移動できること、追加の離脱警告が出ないことを確認した。`verify-studio-leave.mjs` は保存失敗、処理中、応答しない保存からの離脱、原稿切替、同時操作、リビジョン限定の許可を検証。`verify-platform-navigation.mjs`、`verify-save-status-ui.mjs`、`verify-editor-save-status.js`、JS構文確認、`git diff --check`、staging buildが成功した。

`DSF_WRITING_PREVIEW=1 npm run deploy:staging` で反映。固定URLは https://a4fd968b.dsf-studio.pages.dev 、ステージングは https://staging.dsf-studio.pages.dev 、アプリ版は `v2026.10.11-104503`。配信後のStudioで3つの選択肢の表示とキャンセルを確認した。既存の復元原稿があったため、ステージングでは保存・破棄・本文編集をしていない。実際の保存せず離脱の検証はローカルの架空原稿で実施した。

作業場所・ブランチ・基準HEADは前節と同じ。コミット・main統合・本番反映は未実施。証拠は `outputs/writing-w1/studio-leave-choice.png`、`studio-leave-staging.png`、`studio-leave-build.log`、`studio-leave-deploy.log`。

Readerはインフォボタンの隣に鉛筆アイコン「書き込み / Writing」を配置する方針を実装計画へ記録した。現在のDSFとページをWritingへ引き継ぐ接続は未実装。

## 2026-10-11 ReaderとWritingの往復・見開き入力

上記の未実装部分を、`DSF_WRITING_PREVIEW=1` の開発・staging build向けに実装した。今回の変更は未コミット・未デプロイ。作業場所 `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`、ブランチ `feature/dsf-writing-w0`、基準HEAD `b16f3fc87575a3c7173984c3677320446f319bf5` は維持。

- Readerの既存インフォボタンは実行時に操作列へ移動されるため、鉛筆も同じ操作列の直後へ置く。スマホでは6ボタン分の配置幅を算出する。
- ローカルで開いたportable v2／形式3のDSF Blob、言語、現在ページ、見開き配置を同一originのWriting iframeへ渡す。送信元window・origin・ランダムnonceを照合する。アップロード・クラウド保存・原本ファイル上書きは行わない。
- 戻る操作ではWriting付き形式3を生成・検証し、Readerへ読み込んで現在ページを復元する。保存済みWritingを原本の上に表示する。Reader復帰後のDSFファイル化はWritingの保存操作で行う。端末下書きと元ファイルは残る。
- Readerで形式3の原本・編集用・共有用を表示できる。共有用の書き込みボタンは無効。Horizonの配信メタデータから勝手にDL許可を推定しない。
- Writingの前後ボタン・左右キーは綴じ方向と見開き単位に対応する。タッチは描画中2本指、閲覧中1本指。紙を曲げるReaderアニメーションはまだ共用していない。
- 見開きをまたぐペン類は各ページ座標へ変換して枠でclipし、1つの履歴で確定する。筆ペンの境界を新しい始端・終端にしない。左右まとめてUndo／Redoできる。線・図形・文字は開始ページ内。データ契約の変更はない。

### 実操作と自動検証

架空の6ページDSFをReaderで開き、先頭以外の見開き（左3・右2）からWritingに入った。タイトル・現在ページ・見開き配置を保持。青いサインペンで中央をまたぐ筆跡を描き、左右それぞれ1オブジェクト・履歴追加1件をDOMとUIで確認した。Undoで両ページが0件、Redoで復元。次の見開き（左5・右4）へ移動後にReaderへ戻ると現在ページindex 3を保持し、前の見開きで青線が連続表示された。

最終buildのReaderでもWriting付きDSFを開き、Writingへの再入場、左右キーによる見開き送り、Readerへ現在ページを返す操作を確認した。390×844のviewportでWritingとReaderの操作が収まることを確認し、viewport指定を解除。タッチ入力はIABがCDPのtouch dispatch非対応のため実操作未確認。イベント試験では1本指の筆記をめくらないこと、2本指の筆記キャンセルと1回のページ送り、閲覧スワイプ、縦移動・pointercancel・ペン入力の除外が成功した。実スマホ・実ペンは引き続き未確認。

共有用DSFのReader実表示でも既存Writingが描画され、インフォ隣の鉛筆が「共有用DSFは書き込みロックされています」として無効になることを確認した。

`verify-reader-bridge.mjs` は見開き方向、複数ページの一括Undo、失敗時の原子性、ZIP再読込、原本全entry bytes不変、320／375／390pxの6ボタン配置を検証する。`verify-ui-model.mjs`、`verify-tools.mjs`（15件）、`verify.mjs`（42件）、`verify-viewer-responsive-layout.mjs` が成功。ユーザー指定の `20290901FLOWテスト.dsf` も `verify-import-v2.mjs` で18ページ・組版・画像・元ファイルhash不変・再保存を再確認した。今回この実ファイルは外部サイトへ送信していない。

`verify-staging.mjs` は明示allowlist、production除外、Writingだけのworker scope、失敗時の既存offline cache保持、Reader nonce付きURLでもoffline shellが一致することを検証。最終staging build成功（既存のchunkサイズ警告あり）。Writing build version `799154bf359770ba4559`。Reader全体を含む再起動後オフライン往復は未検証。

証拠: `outputs/writing-w1/reader-writing-return.png`、`reader-writing-mobile.png`、`reader-bridge-build.log`。ローカルbuild確認先は `http://127.0.0.1:5368/viewer.html`。検証用DSFは `reader-spread-original.dsf` と `reader-spread-writing.dsf`。これらの検証用ファイルを配信allowlistへ追加していない。


## 2026-10-12 Readerの基本UIを使うWritingへの変更

公開見本ではなく、`feature/dsf-writing-w0` のReader本体に組み込んだ。作業場所は `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`、基準HEADは `b16f3fc87575a3c7173984c3677320446f319bf5`。従来の未コミット変更を保持。今回コミット・デプロイは行っていない。

### 実装

- Readerの全画面Writing iframeを廃止し、同じdocument内のShadow DOMへ道具と筆記入力面を配置した。原本はReaderが描画し、Writingは実ページの座標・拡大率・左右順序に追従する。ページ送りボタン、進捗スライダー、ページめくり処理は既存Readerをそのまま使う。
- 道具は右上の1ボタンで「ペン → 道具 → 非表示」と巡回する。非表示は道具だけを隠し、既存の書き込みを消さない。Writing中はReader操作部を維持する。
- ペンは画面上端に配置し、ペンのSVG全体を上下移動する。元の筆先・軸の形を保持し、太さの文字はSVG上16px（スマホの実表示は約14px）。色帯・ペン先・太さを設定に連動させる。長押し500ms、右クリック、F2で設定を開く。
- 左上の既存Horizonメニューに保存、設定、履歴、Reader復帰を追加。既存「表示」の同じDOMもWriting中だけこのメニューへ移し、終了時に元の場所へ戻す。
- 編集用／共有用の書出しと履歴処理は既存実装を使用。原本・ファイル仕様は変更しない。別ファイルを開くときは現在のWritingをReaderへ反映してから切り替える。処理失敗時にはWriting画面を保持する。
- 動くページにも最新のWritingレイヤーを含め、アニメーション中は筆記入力を停止する。見開きをまたぐ筆跡は既存のページごとのclip・一括履歴を使用する。
- `DSF_WRITING_PREVIEW=1` の開発／staging buildのみ。Horizon／PressのDL権限や配信には接続していない。入力用書体の準備は保存パネルから行えるが、Reader全体のオフライン起動を準備済みとは表示しない。

### ブラウザーで確認したこと

ローカルの架空6ページDSFのみを使用。ユーザーの原稿は変更していない。

- デスクトップでReader内Writing起動、ボールペン、見開き横断筆記、Undo／Redo、既存のページ送り。
- 390×844と320×700のviewportでペン・道具・非表示の巡回、画面内配置。上端の透明なReaderヘッダーによる入力遮断と、Writing操作後にReaderの操作部が隠れる問題を修正した。
- マウス650ms長押しで設定を開き、赤・0.7mmへ変更。ペン画像の色と数字へ反映することをDOMで照合。
- 四角と日本語「Readerで確認」を実配置し、Reader復帰後にも表示されることを確認。
- 編集用DSFを実ダウンロードし、そのディスク上のファイルをReaderから再読込。赤い筆跡を表示。保存前後の原本全entry bytes一致を自動照合した。
- 次ページボタンでpage2へ移動し、Writingの表示も「2ページ」に追従。Writing終了後もReaderのpage2／スライダー位置1を保持。

### 検証と証拠

`verify-reader-bridge.mjs`、`verify-tools.mjs`（15項目）、`verify-ui-model.mjs`、`verify.mjs`（42項目）、`verify-staging.mjs`、`verify-viewer-responsive-layout.mjs`、変更JS構文、`git diff --check`、フラグ付きstaging相当ローカルbuildが成功。buildには従来のchunkサイズ警告がある。

追加の `scripts/writing-w1/verify-native-reader-file.mjs [DSFパス]` は、今回UIから保存した検証ファイルの原本不変と赤い筆跡を照合する。引数なしでは `outputs/writing-w1/native-reader-downloaded.dsf` を読む。検証DSFを配信allowlistには追加していない。

証拠: `outputs/writing-w1/native-reader-file-proof.json`、`native-reader-downloaded.dsf`、`native-reader-build.log`、`native-reader-mobile.png`。

確認先: `http://127.0.0.1:5391/viewer.html`。実スマホ／実ペン／2本指での実機操作、Reader全体の再起動後オフライン利用は未確認。タッチの入力競合は既存イベント試験に合格しているが、マウスでの検証と区別する。

### 2026-10-12 スマホ確認用のステージング反映

ユーザーの「スマホでも確認画面を見れるように」に対応し、既存ステージングへ `DSF_WRITING_PREVIEW=1` で反映した。コミット・本番デプロイはしていない。

- 確認URL: https://staging.dsf-studio.pages.dev/viewer?src=/writing/sample.dsf
- 固定デプロイ: https://9050fdd8.dsf-studio.pages.dev
- Writing build: `620eaf4a38d957f5625a`。`verify-staging.mjs` 成功、`verify-staging-remote.mjs` で65配信ファイルの内容・MIME・noindexを照合。
- 既存allowlistの架空2ページサンプルが自動で開く。ユーザーの原稿やローカル検証DSFは公開していない。
- 公開URLを390×844 viewportで開き、Readerの書き込みボタンから起動、ペン→道具→非表示→ペンの巡回を確認。Reader下部操作部も表示。ブラウザーのerrorログなし。実スマホ操作は未確認。
- 証拠: `outputs/writing-w1/native-reader-staging-mobile.png`、`native-reader-staging-deploy.log`、`staging-remote-verification.json`。

スマホでは上記URLを開き、ページ中央をタップして下部の鉛筆ボタンからWritingへ入る。

## 2026-10-12 太さ・マーカー・選択操作・PC配置の修正

同じworktree／branchで既存差分を保持して実装。コミットなし。

- 全ペン類と線・図形の太さ設定をmmへ統一。内部の基準座標は変更せず、96/25.4で換算する。ペンの画像に数値とmmを表示。筆ペン2.5、サインペン1、蛍光マーカー4、修正液4mmを初期値とする。
- 蛍光マーカーを固定方向の長方形ペン先の掃引領域で描画。1本の筆跡を同じopacity groupで合成し、節で濃くなるのを防ぐ。点描も長方形。原本とZIPスキーマは変更しない。
- 選択モードの550ms長押し／右クリックで切り取り、コピー、貼り付け、複製、削除のアイコン。セッション内コピーを別ページへ貼り付け可能。空白長押しでは貼り付けだけ有効。編集は既存履歴・端末下書き保存へ接続し、移動開始・2本指・キャンセルでは長押しを中断する。
- 820px以上では左に6道具、右に5ペンを同時表示。狭い画面は従来の1ボタン巡回を維持。メニュー位置をviewport内へ収める。

### 検証

`verify-tool-refinements.mjs` でmm換算、長方形の点・水平・垂直・斜め軌跡、グループ不透明度、各objectの複製と境界、切り取りUndo、別ページ貼り付け、ZIP再読込、原本bytes不変が成功。既存 `verify-tools.mjs` 15項目、`verify-reader-bridge.mjs`（見開き、一括Undo、タッチのページ送り分離等）、`verify-staging.mjs`、変更JS構文、ビルド、`git diff --check` も成功。

実ブラウザーでは架空サンプルのみ使用。PCの11道具同時表示、マーカーの水平・斜め・点描、長押し／右クリック、コピー・複製（3→4件）・切り取り（4→3件）・Undo（4件復元）、別ページの空白長押しから貼り付け（0→1件）、削除（0件）とUndo（1件）、4→4.1mm設定がペン画像へ反映、Writing終了／再入場後の1件保持を確認。390×844と320×700で操作メニューの収まり、820pxで全道具への切り替えを確認。errorログなし。

長押しはマウス650msで確認。検証ブラウザーがCDPのタッチ入力送信に対応していないため、実スマホのタッチ長押し・実ペンは未確認。

証拠: `outputs/writing-w1/tool-refinements-desktop.png`、`tool-refinements-mobile.png`、`tool-refinements-verification.json`、`tool-refinements-build.log`。ローカル確認は `http://127.0.0.1:5392/viewer.html?src=/writing/sample.dsf`。

ステージング反映: https://366a5081.dsf-studio.pages.dev （alias: https://staging.dsf-studio.pages.dev）。Writing build `c610630228160b6ce30c`。65ファイルのリモートhash・MIME・noindex照合に合格。デプロイログ: `outputs/writing-w1/tool-refinements-staging-deploy.log`。本番は未反映。
公開URLでもWriting起動、全11道具とmm表記、マーカー筆記、選択長押しの5アイコンを実操作で確認した。証拠: `outputs/writing-w1/tool-refinements-staging.png`。

## 2026-10-12 Writingの操作性修正（連続描画・設定・選択・スマホ）

- 線・矢印・四角・楕円を描いた後も使用中の道具を維持し、続けて描画できるようにした。選択操作へは明示的に切り替える。
- 設定は道具別に表示。ボールペンは12色と0.3/0.5/0.7mmのみ。図形用Ctrl制約、線用スナップ、文字用の書体・サイズ等を関係する道具だけに出す。設定パネルから履歴／オブジェクト一覧を除き、履歴メニューは維持。
- 図形・線・筆跡の選択を、描画済み形状のアルファ輪郭に沿う青い外形表示へ変更。矢印・可変幅筆跡・長方形マーカーも同じ描画から抽出する。編集ハンドルを維持。文字は文字領域の選択枠を維持。
- Writing開始時にReaderのページ拡大を解除し、Writing中はReaderのピンチ／旧ポインターズーム経路を除外。Safariのgestureと複数touchmove、Ctrl-wheelによるブラウザー拡大をWritingの紙面・余白に限定して抑制。Reader通常時・ダイアログ内には適用しない。フォームは16px以上にしてSafariの入力時自動拡大を回避。Writing用の「ページ全体を表示」ボタンを追加。
- Undo／Redoを44pxの常設ボタンとして追加。スマホではReaderのページ操作の上、PCでは左下。道具を収納しても残る。
- 道具は約3.5秒で上へ収納し、上端24pxのタップ／マウスオーバー、キーボードフォーカスから復帰。道具上でのマウス操作中や設定ダイアログ中は収納しない。上端のタッチ領域を固定して、復帰時のサイズ変化による誤描画を防いだ。

検証: 変更JS構文、verify-tool-refinements、verify-reader-bridge、verify-viewport-guards、verify-staging、verify-viewer-responsive-layout、staging相当build、git diff --checkが成功。node_modulesリンクのsandboxアクセス制限により配信検証を同じコマンドで昇格再実行し成功した。検証用データだけを使用し、原稿は変更していない。

実ブラウザー: PCと390×844で楕円2個の連続描画、道具選択維持、外形選択、ボールペン設定に色と太さのみ表示、Undo 2→1件／Redo 1→2件、3.5秒後の収納と常設操作、上端から再表示しても2件を維持することを確認。証拠: outputs/writing-w1/usability-pen-settings.png、usability-mobile-stowed.png、tool-usability-build.log。

拡大抑制はイベント単体試験でWritingだけに効き、Readerとダイアログを除外することを確認した。ユーザー画像のiPhone Safariの拡大そのものは実機再現できていないため、実スマホでの再確認が必要。コミットなし。
ステージング反映: https://9a5fc3eb.dsf-studio.pages.dev （alias: https://staging.dsf-studio.pages.dev）、Writing build `f62d68470e9b10220f2d`。65配信ファイルのhash・MIME・noindex照合に合格。本番未反映。

## 2026-10-12 墨量・設定順・収納の改善

- 線幅、筆ペンの墨量、図形／文字設定を色より前へ移動。色名はパレット先頭に「ブラック / 12色」「コーラル / 35色」で表示。
- 筆ペンに墨量0〜100%を追加。geometryVersion:2 / inkAmount:0〜1 を筆跡ごとに保存し、少量では筆筋のカスレ、多量では淡い輪郭による滲みを疑似表示。共有用も同じ模様を保持。物理的な紙・墨のシミュレーションではない。
- スマホのペン／道具／非表示は1つのSVGアイコンで循環し、アクセシブル名は現在と次の状態を説明。
- Undo／Redo／全体表示は上部道具と同じ3.5秒で収納。上端の再表示に連動し、操作中は収納タイマーを止める。スマホで手動「非表示」を選んだ場合も一緒に隠す。
- verify-brush-ink.mjs：決定的描画、移動・複製・見開きの連続性、不正墨量の原子的拒否、編集用／共有用ZIP再保存、原本bytes保持を確認。既存42形式検証、15道具検証、mm／マーカー／コピー、Reader往復／ジェスチャー、viewport、レスポンシブ検証も通過。
- 実UI：390×844とデスクトップ幅で設定順とアイコン切替、実描画（墨量5%／100%）、収納後のUndo／Redo、Readerに戻って再入場後の筆跡保持を確認。iPhone実機Safariの確認ではない。
- ステージング https://a1f3d51c.dsf-studio.pages.dev 、alias https://staging.dsf-studio.pages.dev 、Writing build 1eef1d2e734a38458356。配信65ファイルのhash/MIME/noindex検証通過。コミットと本番反映なし。
- 証跡：outputs/writing-w1/ink-settings-mobile.png、brush-ink-verification.json、ink-ui-build.log、ink-ui-staging-deploy.log、staging-remote-verification.json。

## 2026-10-12 筆跡見本・後編集・レイヤー

- 不規則な途切れと太さの筆筋、淡い不規則輪郭による筆ペン方式3。既存方式1/2の表示を維持。描画は最大24pathにまとめ、再描画時のDOM負荷を抑制。
- 筆ペン設定に同一rendererの見本を追加。墨量・色・太さに即時追従。
- 切替ボタンは次に表示する状態のSVG。現在ペンなら道具、現在道具なら非表示、非表示ならペン。
- オブジェクトメニューに設定を追加。線・筆跡・図形は現在値を読み込み「選択に設定を適用」で変更、文字は既存文字編集へ接続。
- Undo/Redo付近にレイヤーアイコン。現在ページを前面から一覧表示し、最前面／一つ手前／一つ奥／最背面に移動。原本は別層で固定。履歴・DSFに配列順を保持。
- レイヤーから設定への切替時にdialog closeイベントが遅れて新パネルを戻してしまう不具合も修正。閉じる処理で同期的にパネルを復帰させ、再表示中の古いcloseイベントは無視。
- verify-natural-ink-layers.mjs：筆跡の決定性、複製と見開きの模様保持、保存・再読込・共有、原本bytes保持、重ね順の各操作とUndo/Redo、保存順の復元を確認。従来42形式検証、15道具検証、墨量2、マーカー・コピー、Reader bridge検証も通過。
- 実ブラウザ：墨量5/25/35/100%で見本の変化、筆跡とマーカー作成、前後順変更、既存筆跡を赤・8mmに変更、右クリックメニュー設定、順序と設定のUndo/Redoを確認。390×844で次の状態アイコン、レイヤー一覧、設定見本を確認。実機タッチ検証ではない。
- 配信 https://0af9633a.dsf-studio.pages.dev、alias https://staging.dsf-studio.pages.dev、Writing build 42873e6f8e60fd280c32。初回は配信切替中の旧CSSが返り、再確認で65ファイルhash/MIME/noindex一致。コミット・本番反映なし。
- 証跡：natural-brush-mobile.png、natural-brush-preview.png、layers-mobile.png、natural-ink-verification.json、natural-ink-format.log、natural-ink-build.log、natural-ink-staging-deploy.log（outputs/writing-w1内）。

## 2026-10-12 サムネイル・ドラッグ・運筆カスレ・透過設定

- 一覧の各項目に実rendererによるオブジェクト単体サムネイル。右端のつまみからドラッグして配列順を変更。挿入線、端スクロール、範囲外ドロップ無効、上下キーの代替操作。原稿は対象外。
- 新しい筆ペン方式4は点ごとにdrynessを保存。始端は墨が残り、距離と速度でカスレが増える。旧方式1〜3は再描画を保持し、旧筆跡の再設定時は距離から補完（当時の入力速度は復元できない）。
- 設定と文字編集の背景を白76%＋弱いぼかし、backdrop10%にし、ページが透けるよう変更。
- verify-dynamic-ink-layers.mjs：同一経路の高速入力が低速入力よりカスレ、始端より終端がカスレ、保存点列の不正値を原子的拒否、コピー・見開き・編集用／共有用ZIP再読込・原本保持、重ね順の保存を検証。既存42形式チェック、15道具チェック、旧墨量描画、Reader bridge、mm／マーカー／コピー検証も通過。
- 実UI：筆ペン、蛍光マーカー、楕円のサムネイル確認。PCで最背面→最前面ドラッグとUndo、390×844で最前面→最背面ドラッグ、範囲外ドロップで順序不変、上下キー操作を確認。透過設定と見本も目視確認。物理スマホのタッチ操作は未検証。
- ステージング https://dd2e4c4b.dsf-studio.pages.dev、alias https://staging.dsf-studio.pages.dev、Writing build ac3541ff8266f92aca2f。配信65ファイルhash/MIME/noindex一致。
- 証跡：outputs/writing-w1/layer-thumbnails-mobile.png、dynamic-ink-glass-mobile.png、dynamic-ink-verification.json、drag-dynamics-format.log、drag-dynamics-build.log、drag-dynamics-staging-deploy.log。コミット・本番反映なし。

## 2026-10-12 半透明レイヤーとオブジェクトロック

- レイヤーパネル背景を白66%＋弱いぼかし、backdrop8%へ変更。パネルを開いたまま背後の描画と重ね順が更新される。
- 一覧の行に選択・ロック/解除・削除を追加。ロックは選択可能だが、編集・移動・削除・切り取り・その対象の並べ替えを禁止。操作メニューにもロックを追加。ロック中はリサイズハンドルを非表示。
- 任意locked:booleanを全objectに導入（省略=false）。modelにも内容変更・削除ガードを実装。共有用全体ロックは維持。解除のみの操作を経て編集する。Undoはロック状態ごと復元。
- verify-object-lock.mjs：ロック中の編集/削除と解除同時変更の拒否、並べ替えhelper、解除後削除、Undo、型検証、編集用/共有用ZIP、原本bytes保持。既存42形式、運筆/レイヤー、マーカー/複製、Reader bridge検証通過。
- 実UI：一覧選択、ロック、削除・ドラッグの無効化、紙上をドラッグしても位置不変、解除→削除→Undo2回でロック込み復元、Reader往復後の保持、半透明パネルを開いたまま非ロック対象の並べ替えを確認。390×844で行の操作が収まることも確認。物理スマホタッチは未検証。
- 配信 https://f9e03385.dsf-studio.pages.dev、alias https://staging.dsf-studio.pages.dev、build 272b234c88b173ffcaf4。配信65ファイル照合済み。コミット・本番反映なし。
- 証跡 outputs/writing-w1/layer-lock-glass-mobile.png、layer-lock-glass-desktop.png、object-lock-verification.json、object-lock-format.log、object-lock-build.log、object-lock-staging-deploy.log。
