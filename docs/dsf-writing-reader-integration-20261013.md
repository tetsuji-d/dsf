# Writing: Reader共通操作とページ上の文字入力（2026-10-13）

## 作業範囲

- 作業先: C:\Users\tetsu\Documents\Codex\dsf-writing-w0
- ブランチ: feature/dsf-writing-w0
- 開始HEAD: b16f3fc87575a3c7173984c3677320446f319bf5
- 今回の変更はローカル確認用。コミット・デプロイはしていない。
- 既存のtracked 11ファイルの変更、旧サンプル、既存検証素材、ユーザー原稿を保持した。
- 変更前の対象ファイルとstatus: outputs/writing-w1/reader-integration-20261013/before/ と before-status.txt。

## 実装

1. Writingで隠していたReaderヘッダーの表示・アカウント・全画面を再表示。同じDOMと処理を使う。表示設定をWritingの保存メニューへ移動する処理を取り除いた。狭い画面では道具をヘッダーの下に配置する。全画面ボタンの端末別表示条件はReader共通のまま。
2. 道具の再タップ、長押し、右クリック、F2から設定を開くと、起点のボタン付近に配置する。縦横サイズと可視領域で位置・高さを制限し、中身をスクロールできる。半透明表示とペン画像を維持。
3. preview-sample.dsfを新設。表紙類を含め8枚（Readerの本文カウントは4）で、複数の見開きを確認できる。従来のoriginal.dsfは保持。配信allowlistは新しい架空サンプルのhashを検査する。
4. Reader内Writingの文字入力をページ上の非モーダルなテキストボックスへ変更。文字ツールでクリックまたはドラッグして枠を作り、直接入力する。枠の移動・拡縮、書体・サイズ・色・縦書き、既存文字の再編集に対応。再編集はダブルクリック、文字ツールでのタップ、選択後の設定から行う。

入力は「確定」・Ctrl/Cmd+Enter・枠外の操作で確定し、Esc・キャンセルで取り消す。ページ送りなどは確定の成功後に実行する。枠作成直後のクリックは枠外操作として扱わない。空欄は新規オブジェクトを作らず、枠からはみ出す文字は入力を保持してサイズ調整を案内する。既存の文字を変更せず閉じた場合は履歴を増やさない。

保存には既存の文字オブジェクトのrect・runs・layoutを使う。ファイルのスキーマは変更していない。単独のWriting検証ページの入力ダイアログは従来のまま。

## 確認方法

既存のW0フォント/WASM・W1 catalog準備済み環境で:

```powershell
node scripts/writing-w1/build-preview-sample.mjs
$env:DSF_WRITING_PREVIEW='1'
npm run dev -- --host 127.0.0.1 --port 5393 --strictPort
```

URL: http://127.0.0.1:5393/viewer.html?src=/writing/sample.dsf

「書き込み」へ入り、表示メニューで見開きを選んで次へ進む。8枚中4・5枚目は本文同士の見開き。生成済みサンプルは96,827 bytes、SHA-256 5fdf726363255acdc0cfaa8cbcf5369252d50c84343771b2d99173f224acbfd8。

## 検証

- 実ブラウザー: 320×568、390×844、768×1024、844×390、1440×900、1920×1080で確認。表示設定から単頁・見開き切替、Writing中のアカウントパネル、全画面切替のUI状態を確認した。
- 直接入力、改行、文字の再編集、枠の移動・拡縮、縦書き、ページ送り前の確定、Ctrl+Enter、Undo/Redoを操作した。595文字の枠超過でエラーを出し、入力を保持してキャンセルできることを確認した。
- UIから日本語を入力したDSFを実際にダウンロードし、Readerのファイル選択で開き直した。Writingで同じ文字を表示できた。ファイル読込による検査でもpage3の入力、編集用コピー、履歴2件、原本の全対象エントリのbytes一致を確認。
- verify-inline-text.mjs: 横書き/縦書きの枠内改行、超過、パネル境界、ヘッダーの空き、8枚サンプル、Undo、ZIP再読込、原本不変が成功。
- verify-tools.mjs: 15件成功。
- verify-ux-layout.mjs: 8寸法で道具配置とReader/共通ヘッダーとの衝突、ヒット判定が成功。
- verify-staging.mjs: 69資源、scope /writing/、production除外、アップロード処理除外、失敗時オフラインスナップショット維持が成功。Writing資源version 578b5ca5df92e599fced。
- DSF_WRITING_PREVIEW=1 npm run build:staging: 成功。既存のchunkサイズ警告あり。
- ペン描画を含むreader-writing-tools.jsのSHA-256は開始時と同一: 876D3FB7266CA172718FD8AB9441965652D5D9FEB2D65BEB6FA391A41CF1B90B。

証拠はoutputs/writing-w1/reader-integration-20261013/。主な画像はsettings-side-dock-final.png、settings-near-tool-390.png、inline-text-final.png、inline-text-edit-390.png。実ダウンロードのコピーはbrowser-saved-writing.dsf、確認スクリプトはverify-browser-save.mjs。

## 残る実機確認

iPhone実機のソフトウェアキーボード、IME変換、Safari固有のフォーカス/表示領域変化は未確認。今回はデスクトップブラウザーの画面寸法を変更した検証。アカウントはパネルまで確認し、ログインしていない。localhostには既存Google認証のoriginエラーが出るため、ログイン成功とは判定していない。

ReaderはURLを再読み込みすると指定元のDSFを開く。今回の保存・再読込の検証は、ダウンロードした編集用DSFを明示的に開き直した結果である。

## 続き: 文字書式・矢印・一覧パネル（2026-10-13）

同じworktree、feature/dsf-writing-w0、HEAD b16f3fc87575a3c7173984c3677320446f319bf5で継続。開始時の既存変更と未追跡を維持。コミット・デプロイは行っていない。

- テキストサイズを代表20種（8〜144）、1〜360の直接入力（小数可）、＋−（1刻み）に変更。既定値設定とページ上の入力欄の両方へ適用。0・空欄・範囲外は確定不可。従来のWriting座標単位を維持し、pt換算はしない。
- ページ上のテキスト編集に基本8色のチップと任意色を用意。表示中の文字に反映する。
- 線・矢印の作成前と作成後に、始点／終点の有無と4種類の先端を設定可能。lineに任意のarrowHeadを追加し、描画・選択判定・サムネイルの領域計算・履歴・DSF梱包で保持。未指定は従来のopen。ファイル形式の詳細はfile-format-spec.mdへ追記。
- ペンのSVG形状を保ち、影を強化。道具・履歴・設定入口の背景に薄い輪郭と影を追加。
- レイヤー・履歴は最大420×720px、画面の四辺から8px以上空けて高さを確保。内部スクロールと半透明を維持。履歴はドロップダウンから一覧へ変更。
- 広い画面では5個の履歴操作を道具の左側に同じ中心高さで配置。幅が足りない画面は下部へ配置し、Readerのページ送りバーと重ならないようにした。描画面より上にボタンを配置する。

### 今回の検証

- 実ブラウザー: 1440×900、1920×1080（単頁・見開き）、390×844、844×390。文字サイズ24の選択、17.5入力、＋で18.5、−で17.5、青色、無効値0の確定防止、スマホ幅で既存テキストの再編集とキャンセルを確認。
- 三角・両端の矢印、丸・始点のみの矢印を描画。レイヤーから前者を選択し、ひし形へ変更。UIから編集用DSFを実際にダウンロードした。
- ダウンロードしたファイルをReaderのファイル選択で開き直した。17.5の青い文字、両端ひし形、始点丸、履歴5件が保持され、Undo/Redoでひし形を三角へ戻し、再度ひし形へ復元できた。
- 低い横画面でページ送りバーが履歴ボタンのクリックを受ける問題を検出。バー領域を配置計算へ追加後、クリックでレイヤーが開くことと、374pxの高さで画面内に収まることを再確認。
- verify-format-ui-file.mjs: 実ダウンロードの文字サイズ・色・矢印両端・履歴・原稿全対象entryのbytes一致が成功。
- verify-format-controls.mjs: サイズ検証、8色、4種の先端と各端の有無、bounds/hit判定、未知先端の変更拒否、編集用／共有用ZIP再読込、原稿不変が成功。
- verify-ux-layout.mjs: 8寸法、Readerヘッダー／ページ送りとの重なり、広い画面の上部履歴配置、一覧パネル高さが成功。verify-inline-text、verify-tools（15件）、verify-object-lock、verify-viewport-guardsも成功。
- 最終ステージングビルド成功（既存のchunkサイズ警告あり）。verify-stagingは70資源、68オフライン資源、production除外、version f487834e909906119644。ペンのSVGを含むreader-writing-tools.jsのhashは前節と同一。

証拠: outputs/writing-w1/format-panels-20261013/。text-controls.png、text-mobile.png、layers-desktop.png、layers-mobile.png、layers-landscape.png、layers-spread-wide.png、history-wide.png。browser-downloaded.dsfとbrowser-file-proof.jsonを保存。開始時ファイルのコピーはbefore/。

履歴256状態（初期状態を含む）、全ページ合計4,096オブジェクト、Writing JSON 8MiBは既存の暫定上限を維持。自動的な履歴削除や上限引上げは未実装。履歴が状態全体を保持するため容量が先に上限へ達しうる。製品化前に実機計測・容量警告・明示的な履歴整理・差分履歴を検討する。今回もiPhone実機／SafariのキーボードとIMEは未検証。
