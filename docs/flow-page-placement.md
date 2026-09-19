# Flowの扉・ページ内配置

右クリックのページ追加から扉用の独立Flowを追加する。Flowを選択している場合はグループ全体の前後へ挿入し、本文途中の自動分割は行わない。初期状態はタイトル見出しと副題用の空段落、行内・行のまとまりとも中央。長文を入力すると通常どおり複数ページになる。

編集プロパティ「Flowのページ内配置」は選択言語のFlow全体に適用する。`textAlign`は行内の文字揃え、`blockAlign`は行のまとまりを行送り方向のstart/center/endへ配置する。縦書きは右/中央/左、横書きは上/中央/下。本文と扉は別Flowで保持する。

Project v6の既存`flow.layout.typographyByLanguage[language]`に任意の`blockAlign`を保存する。省略値はstart。不正値はvalidationで拒否する。DSP・owner authoring保存は既存の経路を利用し、Firestore Rulesは変更しない。旧Studioはこの新しい配置設定を描画しないため、扉の編集・再発行は対応版Studioで行う。

Editor・測定・Press captureは共通DOM描画で位置を確定する。配信は既存fixedTextの座標で表現し、Viewerに新しい組版処理や原稿を渡さない。renderer versionを13に更新して古い組版証拠とcacheを無効化する。本文の文字列、翻訳、注釈は配置変更で書き換えない。Undo/Redoは既存authoring spine transactionを利用する。

## Flow内の扉区間（現行）

「このページを扉にする」は現在の原文ページのfragment範囲を検証し、必要な段落境界だけを既存splitTextBlockで作る。FlowとFlowDocumentのID・数は変えない。対象テキストBlockに同じ`titleRegion: {id, languageKey, textAlign, blockAlign}`を保存する。生成ページ番号は保存しない。

FlowDocument v3はこの任意属性に対応する。v1/v2の読込は維持する。v3を知らない旧Studioは原稿検証で停止する。ルビ・圏点編集もv3を維持する。同じ区間の設定は一致し、原稿内で連続している必要がある。

ページ化は通常本文と扉区間、異なる扉区間の境界で改ページする。区間が増量すると複数ページに継続する。手動pageBreakは保持する。解除は区間属性だけを取り除き、区間による改ページを解除する。分割された段落は残し、文字列・翻訳・注釈・IDを保持する。Undoは指定前の状態へ戻す。

配置は原文言語へ適用する。翻訳済み段落を途中で切る場合は位置対応を推測せず拒否する。翻訳のページ列でも区間境界は保持する。発行では区間と原稿の一致を検証し、既存fixedText座標だけを配信する。renderer versionは14。

旧方式の`flow.pageRole: 'title'`付き独立Flowも読込・解除可能。既存の分割済み原稿の自動結合は行わない。新規指定はFlowを分割しない。目次登録・目次ページ生成・リンクは別段階。
