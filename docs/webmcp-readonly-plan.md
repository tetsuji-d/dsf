# WebMCP 読み取り専用接続：着手準備

確認日：2026-09-15。状態：既存作業の整理・仕様調査済み。WebMCP接続コードは未実装。

## 最初の単位

現在開いている作品について、編集対象の概要取得とFlow原稿検索だけを提供する。
既存 `js/flow-search.js` の `searchFlowText` を再利用し、検索UIのクリックや本文変更を伴わせない。
置換・保存・発行・削除・別作品を開く操作は登録しない。DSP/DSF/Firestoreの形式変更なし。

## 現行APIの確認

一次資料：
- [WebMCP仕様草案（2026-09-14）](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP案内](https://developer.chrome.com/docs/ai/webmcp)
- [公式リポジトリの登録例](https://github.com/webmachinelearning/webmcp)

草案は `document.modelContext.registerTool(tool, {signal})` と AbortController による登録解除を示す。
旧資料の `navigator.modelContext` / `unregisterTool(name)` を前提にしない。草案であり実装時にも署名を照合する。
Chrome公式はローカル開発用 `chrome://flags/#enable-webmcp-testing` とorigin trialを案内している。
通常利用中のChrome設定・拡張機能は変更しない。隔離した検証用ブラウザで確認する。

今回のローカル確認：Playwrightが起動する通常設定Chrome 153.0.8010.36、localhostはsecure context。
`document.modelContext` / `navigator.modelContext` ともに未提供。ユーザーが使用中のChromeやCodex内ブラウザの対応状態を意味しない。
この環境での単体・モック試験を実クライアント接続成功とは扱わない。

## ツール契約案

| ツール名 | 入力 | 出力 |
|---|---|---|
| dsf_get_editor_context | 空オブジェクト | セッションの作品トークン、対象種別・ID、本文言語、原文言語、確実に取得できた選択範囲、busy状態 |
| dsf_search_flow_text | 作品トークン、query、languageKey、scope（currentFlow/work）、caseSensitive、limit | 該当段落ID、UTF-16開始/終了、短い抜粋、truncated |

- queryは1〜512文字、limitは1〜20件。不正な型、未登録言語、範囲値を拒否する。原文fallbackを翻訳検索に混ぜない。
- 抜粋は最大160文字相当でgrapheme境界を守る。段落全文を含む既存結果の `expectedText` は外へ返さない。
- 選択文字列そのものは初期context出力に含めない。ID・範囲のみ。未検証/古い選択を推測で返さずnullと理由を返す。
- source/生成ページ/翻訳の選択経路はapp.jsの既存セッションを参照する専用読み取り関数に集約する。DOM文字列やページ番号だけから原稿範囲を推定しない。
- 作品を切り替えたらランダムなセッショントークンを更新し、古いトークンの検索を拒否する。プロジェクト名・クラウドID・アカウント情報は公開対象に含めない。
- 原稿本文は信頼しないデータとして返し、ツールの説明・指示へ埋め込まない。readOnlyHintは補助情報とし、実処理でも更新経路を呼ばない。
- 短い抜粋制限は1回の応答量の制限であり、繰り返し検索による原稿取得を防ぐDRMではない。有効化するユーザーに、検索対象の本文が接続AIへ渡ることを示す。

## UIと寿命

プロフィールに「AI連携（読み取り専用）」と状態を表示する。初期オフ、タブのセッション内のみ。
「非対応」「オフ」「ツール提供中」「登録失敗」を区別する。登録されたことをクライアント接続済みと表現しない。
オフ、エディターからの退出、作品切替、pagehideで登録解除。実行関数も毎回有効状態・作品トークン・ルームを検証する。
再入場・別作品では自動再許可しない。未対応環境の通常編集・保存・閲覧に影響させない。
IME変換中・原稿反映待ちはbusyを返す。検索のために入力を確定したり再組版・自動保存を実行しない。
複数登録の途中失敗は自分の登録分だけ解除する。他モジュールのツールを一括削除しない。

## 実装順・完了条件

1. ブラウザに依存しないcontext/searchラッパーと引数検証を実装。原稿・注釈・履歴が不変、抜粋制限、言語分離、古い作品トークン拒否を試験。
2. document.modelContextへの薄いadapter、登録解除、ユーザーによるオン/オフを実装。部分失敗、画面退出、連続切替、遅い呼出しを試験。
3. 非対応の通常Chromeで回帰試験。隔離した対応Chromeで登録・列挙・呼出し・解除を確認する。
4. 対応クライアントでの呼出しは別の受け入れ検証。接続先サービスへ実原稿を送信する前に、利用者が選んだサンプルで確認する。

ChatGPT/Claude/Gemini/Apple Intelligenceのすべてから接続できるという保証はしない。
初期検証は合成した原稿のみ。ユーザーの実作品を発行・外部送信しない。commitとstagingデプロイは別の依頼単位。
