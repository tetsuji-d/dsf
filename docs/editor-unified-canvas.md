# 統合編集キャンバス

Fixedテキスト・画像・見開き画像・Flow生成ページを、作品順の一つの横スクロールキャンバスへ表示する。
Project/FlowDocumentの保存形式、Press、Release、Viewerは変更しない。

## 表示と編集

- 混在作品は既存のFlow page projectionを使用する。Fixedのみの作品も同じprojection builderを使う。
- 言語設定のpageDirectionで左右を決める。本文のwritingModeとは独立させる。
- ページ番号は既存book設定と作品全体の生成ページ数に基づく。Flow本文の前後編集で番号も更新する。
- 隣接する同じspreadImage groupの2面は隙間なく並べる。選択枠は両面に出し、クリックした面を編集する。
- 選択中のFixedページには元のcanvas-stageを一つだけ配置する。画像調整・吹き出し・固定本文・Undoの既存経路を再利用する。
- 他のFixedページは既存の隣ページrendererで描画する。プレビューのイベント・編集属性を除去し、DOM IDとSVG参照を分離する。
- Flow Group内のローカルpage indexは、group IDと組み合わせて作品内indexへ対応させる。直接編集・IME・選択範囲は当該Group内に保つ。
- ページ選択はクリックまたは既存のサムネイル・ページ送りで行う。スクロールだけでは編集対象を変更しない。
- 画面付近と編集中ページだけをDOMへ保持する。見開きの隙間がゼロでも仮想化対象を正しく計算する。
- Flow原稿モードと、明示的に開いた既存の言語比較表示は各専用画面を維持する。

## 検証

- `verify:editor-canvas-projection`: Group内indexの対応、左右方向、見開きの連続配置、仮想化、非破壊性。
- 既存canvas-layout、page-projection、direct-edit、direct-navigation、projection-recovery、history-editor-focus、fixed-page-spine、source-mapping検証。
- development限定の `scripts/fixtures/editor-unified-canvas.js` は混在原稿を生成するだけで、読み込み・保存・uploadを行わない。
- ローカルStudio: Fixed本文変更とUndo、画像上テキスト追加、画像ドラッグ、Flow入力・Enter・Undo、後半Groupの末尾編集、再ページ化による作品内番号更新、左右方向、狭い画面での表示を確認。

複数Blockにまたがる選択、翻訳ページの直接編集、見開きの途中挿入は別単位とする。

## 本文途中への画像ページ挿入

- 原文の生成ページにカーソルを置き、キャンバス右下の「＋ 画像ページ」または編集プロパティの「ここに画像ページを挿入」で画像を選択する。
- 画像準備成功後に、前半Flow・Fixed画像ページ・後半Flowを一度に反映し、画像を選択する。ファイル選択取消・読込失敗では本文を変更しない。
- 境界はsemantic Block IDと文字位置で決める。前半の増減は後半へ流し込まず、後半の本文と組版を維持する。作品通しページ番号だけは変わる。
- 原文のHeading／Paragraphの文字境界に対応する。選択範囲、IME変換中、翻訳側、翻訳処理実行中は挿入しない。
- 分割対象の翻訳は元のBlockに保持して既存のstale判定へ渡す。新しい後半Blockは未翻訳。分割しないBlockの本文・翻訳・lock・fingerprintは所属先へ移す。
- 前後のFlowは同じ組版設定を継承する。Section IDはDocument内のIDとして保ち、Document／Groupには新規IDを付ける。保存schemaは変更しない。
- 段落先頭・末尾での挿入では空の前半／後半を保持する（既存の改ページと同様）。画像削除後のFlow自動結合や、前後を同時に書式変更する操作は含まない。
- 画像準備には既存のWebP変換・サムネイル・guest IndexedDB／Storage処理を共用する。準備中に原稿・project・user・言語が変わった場合は挿入しない。既に保存済みの画像assetの自動削除は行わない。
- Undoは画像と分割をまとめて戻し、元のカーソルを復元する。Redoは画像ページを選択する。

検証: `verify:flow-image-insertion` は縦横・Heading／Paragraph・文字境界・独立reflow・翻訳保持・繰り返し挿入・保存再読込・Undo／Redoを確認する。

ローカルStudio実操作: 横書き／縦書きの画像選択・挿入、ドロワーを閉じた状態の挿入、Undo／Redoとカーソル復元、前半1→5ページへの加筆と後半保持、壊れた画像の拒否を確認。ファイル選択取消はブラウザーのcancelイベントで確認。認証付きStorageへの画像uploadは今回のローカル検証には含めない。

## 原稿への導線とサムネイルのドラッグ

- Flow SOURCEカードを一覧から除き、Flow生成ページの編集プロパティに「原稿を開く」を置く。生成待ちは仮のFlowページを表示し、原稿への導線を保つ。
- 直接編集中は現在の文字位置、ページ選択だけの場合はそのページの最初の本文位置へ移動する。長い段落はカーソルの行までスクロールする。「ページへ戻る」も原稿の現在位置に対応する生成ページを開く。
- 翻訳fallbackには対応する翻訳文字位置がないため、選択中言語の同じBlockの先頭を開く。原文の文字offsetを未翻訳本文に適用しない。
- FlowサムネイルのドラッグはGroup全体を移動する。移動先が別のFlow／見開きの場合は、その単位の外側へ揃える。章などの構造境界は跨がない。
- 既存の単独画像ページは、Flow本文の文字位置、またはFlowサムネイルのページ境界へドロップできる。黄色い目印を表示し、既存の画像挿入transactionへ渡す。先頭／末尾の外側へのドロップは通常の並べ替えとする。
- 画像は複製せずID・言語別asset・吹き出し・切抜き／配置情報を保持して移動する。前後のFlowは独立して再ページ化し、Undo／Redoは移動と分割を一括で扱う。
- IME中・画像準備中・翻訳処理中、古い生成結果、project／user／言語／原稿が変わったドラッグは適用しない。翻訳本文・fallback本文・見開き画像の途中挿入は対象外。
- マウスはサムネイル全体をドラッグ開始点とする。Escape／pointercancelで取消でき、FlowサムネイルはAlt＋左右キーでも移動できる。タッチはスクロールを維持し、ドラッグ用のグリップは表示しない。

検証: `verify:editor-flow-interactions` は文字位置・ページ境界・Group移動・画像asset保持・構造境界の拒否・保存再読込・Undo／Redoを確認する。既存のimage-insertion、canvas-projection、fixed-page-spine、source-mapping、history-editor-focusも通過。

ローカルStudio実操作: SOURCEカード非表示、後半ページから原稿への位置移動、縦書き本文のカーソル位置435での原稿往復、Flow全体のマウス移動、既存画像の文字位置／右から左のサムネイル境界への挿入、Undo、見開き外側の目印、Escape取消を確認。タッチ実機は未確認（検証ブラウザーのCDPはtouch入力に未対応）。


## サムネイルの右クリックメニュー

- ハンドル（:::）を撤去し、右クリックしたページを選択して「この前にページを追加」「この後にページを追加」「ページを削除」を表示する。追加の次のメニューで画像ページ／Flow原稿を選ぶ。
- 画像ページは空のページとして追加し、既存の画像変更操作で画像を設定する。原文Flowの途中は選んだ生成ページの文字境界で前後に分割する。新しいFlow原稿は独立したGroupとして追加し、Flow上では原稿全体の前／後であることをメニュー名に明示する。見開きへの追加位置は2面の外側へ揃える。
- Flowでは通常のページ削除を表示せず、「原稿を開く」「Flow全体を削除…」を表示する。全体削除は既存の確認とUndoを再利用する。見開き・保護対象・残数による既存のFixed削除制約は維持する。
- IME・翻訳処理などの実行中は操作せず、メニュー表示後にproject／user／言語／原稿／選択対象が変わった場合は適用しない。Escapeまたは外側クリックで閉じる。
- ローカル実操作で、非選択画像の右クリック削除とUndo、Flow後半ページの前への画像追加とUndo、画像の後への新規Flow追加とUndo、Flow全体削除の確認取消／実行／Undo、ハンドルなしのFlowドラッグを確認。関連3検証とビルドが成功。

## Flowのまとまり表示と再接続

- 同じFlowのサムネイルを共通枠と薄い背景で囲み、「Flow 1 · 3ページ」のように表示する。番号は作品内のFlowの並び順で、保存データへ追加しない。
- キャンバスは作品通し番号を維持し、その下の帯で同じFlowの範囲とGroup内ページ番号を示す。選択ページは青枠、同じFlowの他ページは薄い青で強調する。帯は仮想化された各ページの表示に従い、全文DOMを増やさない。
- 画像を移動／削除してもFlowは自動結合しない。隣接した後ろ側のFlowを右クリックし「前のFlowとつなぐ」を選ぶ。「段落の区切りを残す」と「境界の段落もつなぐ」を選択できる。
- 共通Section IDの分割境界だけはSection metadataを照合して再統合する。別Sectionは区切りを保持する。原文言語・組版設定が異なる、IDが競合する、未知情報や翻訳metadataが競合する場合は、消去・上書きせず安全な理由を表示して拒否する。
- 段落の接続は共通Section境界のParagraph同士だけに限定し、既存mergeParagraphBackwardを利用する。後段に翻訳・lock・fingerprintがある場合や書式が異なる場合は段落接続を拒否する。区切りを残す接続では本文・翻訳・fingerprint・lockを保持する。
- 接続は1回のUndoで戻る。接続後は接続位置を原稿画面で示し、「ページへ戻る」で一続きの枠と帯を確認できる。Project schema・Rules・Press・Viewerの実装は変更しない。

検証: verify:flow-group-join、editor-flow-interactions、flow-image-insertion、editor-canvas-projection、flow-canvas-layout、fixed-page-spineを実行。ローカルStudioで画像削除後も2枠を維持、右クリック段落接続、文字位置450への移動、1枠への統合、Undo／Redoを確認。

追加の実操作確認: 横書き・左から右でも枠と帯を表示し、枠内サムネイルからFlow全体を移動してUndo、既存画像を枠内のページ境界へ移動してUndoできることを確認。見開きの既存サムネイル間隔とFixedのみの一覧余白は維持する。
