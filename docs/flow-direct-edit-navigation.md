# Flow直接編集：基本キー操作・選択保持・複数ページキャンバス

2026-08-31。Editor限定。保存schema、Fixedページ、Press／Viewerの配信契約は変更しない。

## 操作

- 縦書き・横書きとも、Paragraph先頭のBackspace／末尾のDeleteで隣接Paragraphを結合する。
  ID・翻訳・未知フィールドに関する既存保護を維持し、結合で削除される側に翻訳があれば拒否する。
- Enterは既存semantic Paragraph分割。Shift+Enterは同じBlock内のLF改行。
  LFの前後でBackspace／Delete、選択置換、複数行貼り付けを受け付ける。
  貼り付けのCRLF／CR／Unicode行区切りはLFに正規化する。
- 縦書きの左右は隣列、上下は文字移動。横書きの上下は隣行、左右は文字移動。
  DOM Rangeの実測位置から次の位置を決める。隣列・行では移動元の行内位置を保つ。
- Home／Endは視覚上の行・列の先頭／末尾、Ctrl+Home／Endは現在のFlow原稿の先頭／末尾。
- Shift+矢印、マウスドラッグ、Shift+クリック、ダブルクリックで同じBlock内を選択できる。
  1つのParagraphが複数ページに跨る場合も選択表示を各ページへ切り分ける。
- 再ページ化・見出し設定変更・Undo／Redoでは選択の両端と方向をruntimeに保持する。
  生成DOMは本文の保存先にしない。既存authoring transactionとHistoryを使用する。

## キャンバス

- Flow生成ページは既存Fixed用stageと分離した横スクロール領域へ表示する。
- 360×640の論理ページを一様に拡大縮小し、本文の字数・組版は変えない。
  高さから表示倍率、幅から同時に収まる枚数を求める。縦書きは右から左、横書きは左から右。
- 横ホイール／トラックパッドで物理的な左右スクロール。通常の縦ホイールは読順のページ送りにする。
- 可視ページと前後の少数ページだけDOMへ描画し、編集中のinputを含むページは保持する。
  遠くへスクロールしても矢印は隣接ページへ移動し、離れた表示ページへ飛ばない。
- 同じ原稿の更新では倍率と読順側からのスクロール距離を維持し、必要時だけcaretのページを表示する。
  原稿・言語の切替や生成エラーでは古い編集面を隠す。

## IME

変換中のsource／pagination凍結、確定時のsetText、実Rangeによるpreedit整列を継続する。
ページ跨ぎの選択では、inputを置換開始側に置き、focus caret／選択表示は各ページへ描く。
IME開始後にinputを別ページへ移すことを避ける。OSの候補ウィンドウそのものは自動テストしない。

## 検証

- `verify:flow-direct-navigation`：縦横の実測座標、行列端、grapheme、affinity、ページ境界、非連続window。
- `verify:flow-canvas-layout`：幅別表示数、RTL、倍率、100ページの限定window、編集中ページpin。
- `verify:flow-authoring`：範囲の方向・再生成復元、対象不一致、文字数縮小時のclamp。
- `verify:flow-direct-edit`：縦横LF編集、縦書き段落結合、翻訳保護、ページ増減とcold pagination一致。
- 通常Studioのローカルguest原稿で縦横の矢印／Enter／Backspace、Shift+Enter→Backspace、
  選択後の書式変更→Undo、ドラッグ・ページ跨ぎ選択、横スクロールを確認。
  900文字の縦書きで396／396／108文字、3ページの選択表示と置換開始側inputを確認。
  5000文字で限定DOM描画、パネル開閉で同時表示数3→5、編集中に遠方へスクロール後も隣列へ移動。

## 残る境界

- 複数のHeading／Paragraphをまたぐ選択・一括置換は未対応。同じBlock内の複数ページ選択とは区別する。
- 選択付きEnter、Heading途中でのEnter、Heading／PageBreak境界を消す結合は既存どおり保護する。
- 翻訳済みBlockの削除を伴う結合、翻訳言語の直接編集は未拡張。翻訳本文を暗黙に捨てない。
- 長いIME変換途中のページ越境、OS候補ウィンドウ、タッチのドラッグ選択は別途実機検証が必要。
- 同時表示は選択中のFlow原稿内。別原稿やFixedページを混ぜた編集キャンバスは今回含めない。

実装時の検証はローカルで行った。ステージングへの反映は別途の明示承認を受けて行う。
