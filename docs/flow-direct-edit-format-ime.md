# Flow直接編集：見出し・段落の変更とIME文字位置

2026-08-31。Flow原稿の直接編集に限定した変更。保存schema、Fixed描画、Press／Viewerの契約は変更しない。

## 操作

- 原稿言語の生成ページ本文をクリックすると、右パネルに「見出し・段落」が表示される。
- 段落（本文）／見出し1〜6を、横書き・縦書きとも切り替えられる。
- 設定対象はカーソルがあるsemantic block全体。ページをまたぐ段落も分割・再作成しない。
- Block ID、全言語本文、未知フィールドを保持する。見出しから段落へ戻す場合は既知のlevelだけ除く。
- 型変更時は既存translation fingerprintを保存し、翻訳本文を保持したまま要確認へ移す。
  見出しレベルのみの変更は翻訳を古くしない。
- 既存authoring transaction、History、autosave、reflowを使う。設定後は入力位置へ戻る。
- IME変換中・reflow待ちは設定を無効化する。非接続proxy、別Group、別言語からの古い操作を拒否する。
- Escで直接編集を終えるとパネルを隠す。文字サイズ・個別段落の揃え／行間UIは今回の対象外。

## IME補正

従来の仮表示は、Rangeで得た文字の外接矩形をCSSの行ボックス左上として使っていたため、
行間の余白とpaddingが二重に加わっていた。新しい`flow-direct-composition.js`は、仮表示を置いた後に
先頭graphemeの実際のRangeを測り、元の文字列の行／列中心と入力開始位置へ補正する。
ページの表示倍率を論理座標へ戻すため、縮小・拡大時も同じ基準になる。

入力proxyも文字矩形の幅ではなく実際のlineHeightを使い、行／列中心へ配置する。
範囲選択後の変換では選択末尾ではなく選択開始位置を固定し、変換中のselectイベントによる移動を防ぐ。
変換中のsemantic source／paginationは更新せず、確定時に既存setText経路で反映する。

## 検証と境界

- 新規`verify:flow-direct-format`／`verify:flow-direct-composition`、既存authoring／direct-edit等の回帰検証。
- 通常Studioで縦書きの段落→見出し2→Undo→Redo→段落と、その後の文字入力を確認。
  横書きも段落→見出し3→Undo→Redoを確認。本文、入力位置を保持し、新しいconsole errorなし。
- 開発専用`/scripts/fixtures/flow-direct-composition.html`で、本番renderer／source mapping／補正helperを使用。
  縦横×明朝／ゴシック×見出し／本文×50／100／150%の24条件を実測し、先頭位置・行列中心の差は
  各0.5論理px以下（確認値は約0〜0.015px）。書体名・方向・倍率が条件と一致することも照合した。
  空段落の縦書き入力開始位置も合格。fixtureはbuild inputに含めず、DEV以外で実行しない。
- `npm run build:staging`合格。lint／TypeScript専用scriptは未設定。
- これはOSの変換候補ウィンドウを再現するテストではない。Windows日本語IMEの実候補位置・確定操作は
  次のステージング反映後に実機確認が必要。仮表示の長文折返し／ページ越境は今回変更していない。
- 当初は設定後にfocus側の単一caretへ戻っていたが、後続の
  [基本キー操作・選択保持](flow-direct-edit-navigation.md)で同じBlock内の範囲保持へ修正。
  複数Blockの範囲書式変更は未対応。
- この単位ではcommit／deployを実行していない。
