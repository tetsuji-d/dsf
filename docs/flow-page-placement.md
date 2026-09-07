# Flowの扉・ページ内配置

右クリックのページ追加から扉用の独立Flowを追加する。Flowを選択している場合はグループ全体の前後へ挿入し、本文途中の自動分割は行わない。初期状態はタイトル見出しと副題用の空段落、行内・行のまとまりとも中央。長文を入力すると通常どおり複数ページになる。

編集プロパティ「Flowのページ内配置」は選択言語のFlow全体に適用する。`textAlign`は行内の文字揃え、`blockAlign`は行のまとまりを行送り方向のstart/center/endへ配置する。縦書きは右/中央/左、横書きは上/中央/下。本文と扉は別Flowで保持する。

Project v6の既存`flow.layout.typographyByLanguage[language]`に任意の`blockAlign`を保存する。省略値はstart。不正値はvalidationで拒否する。DSP・owner authoring保存は既存の経路を利用し、Firestore Rulesは変更しない。旧Studioはこの新しい配置設定を描画しないため、扉の編集・再発行は対応版Studioで行う。

Editor・測定・Press captureは共通DOM描画で位置を確定する。配信は既存fixedTextの座標で表現し、Viewerに新しい組版処理や原稿を渡さない。renderer versionを13に更新して古い組版証拠とcacheを無効化する。本文の文字列、翻訳、注釈は配置変更で書き換えない。Undo/Redoは既存authoring spine transactionを利用する。
