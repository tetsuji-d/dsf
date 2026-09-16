# WebMCP 接続・段落編集

確認日：2026-09-16。追加実装：段落書き込み（ローカル、未デプロイ）。下記の読み取り専用段階に加え、末尾の書き込み契約を参照。従来の状態：共通読み取りツール・Studioの状態reader・ブラウザ登録adapter・プロフィールUIを実装済み。隔離Chromeの実API検証済み。Codex内蔵ブラウザから合成原稿の検証ページへのWebMCP呼出しも確認済み（下記参照）。

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

## ツール契約

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

## 共通処理の実装（2026-09-15）

- `js/editor-readonly-tools.js` の `createEditorReadonlyTools` が2つのツール定義（名称・説明・JSON Schema・readOnlyHint・execute）を供給する。DOM、document.modelContext、ネットワーク、保存・履歴モジュールには依存しない。
- `readState` は信頼するStudio専用の同期readerとして後続単位で接続する。契約は `{ room, workIdentity, blocks, languageKeys, languageKey, sourceLanguage, activeGroupId, selection, busy }`。workIdentityは永続IDではなく、作品の新規作成・開き直し・importごとに変わる内部識別子とする。
- 初期無効。`enable()` ごとにランダムなworkTokenを発行し、`disable()` で破棄する。`getTools()` は有効化後に呼ぶ。返されたexecuteはその有効化世代に固定され、再有効化後も古い登録から新作品を読み出せない。
- 毎回、ルーム・作品identity・有効状態を検査する。ホスト側で退出／切替／pagehideイベントからdisableを呼ぶ必要がある（呼出し間に退出して戻るケースをポーリングだけで検知しない）。
- contextは現在のFlowを特定できるときだけtargetを返す。Fixed／画像など他対象と、未検証の翻訳・DOM選択はnull。原文の既存Flow selectionはsignatureと範囲・文字境界を照合し、本文を含めず返す。100段落超の選択はunverified扱い。
- 検索は1〜20件、各抜粋160grapheme以内。抜粋と一致範囲のUTF-16オフセットを別に返し、長い一致も原稿位置を失わない。内部expectedText・署名・アカウント・作品名・クラウドIDは出力しない。
- エラーは `{error:{code}}` の機械可読結果。原稿を含む可能性のある例外メッセージを公開しない。登録APIが要求するエラー表現への変換はadapter側で行う。
- `npm run verify:editor-readonly-tools` と既存 `node scripts/verify-flow-search.cjs` で、凍結した原稿・ルビ・履歴の不変、英語原文、日本語翻訳、空翻訳、grapheme、件数制限、busy、古い選択／作品トークン／登録世代を検証。

### ブラウザ接続へ引き継ぐ点

ChromeとEdgeは試験対応。ChatGPT内蔵ブラウザは「サイトツール」としてJavaScript登録方式の一部に対応するため、まずトップレベルページの命令的登録を共通経路とする。
[Chrome公式](https://developer.chrome.com/docs/ai/webmcp)／[Edge試験](https://developer.microsoft.com/en-us/microsoft-edge/origin-trials/trials/0b76fe60-b266-458e-a285-04e375c0c31a)／[ChatGPTサイトツール](https://learn.chatgpt.com/docs/webmcp)。
共通モジュールは `js/studio-webmcp.js` を通じてStudioへ接続済み。Codexからの読み取り呼出しは下記の範囲で確認済み。本文書込み・画像挿入は未実装。

## Studioへの接続・実API検証（2026-09-15）

- プロフィールにJA/EN対応の「AI連携（読み取り専用）」を追加。初期オフ、タブ内のみ。検索した本文の抜粋を接続AIへ提供する旨を表示する。非対応／オフ／登録中／ツール提供中／登録失敗を区別する。
- トップレベルのsecure contextにある `document.modelContext.registerTool` のみ使用する。本文・保存形式は変更しない。無効化・画面退出・作品変更・pagehideでAbortControllerを中断し、2つの自分のツールだけ解除する。登録途中の失敗と再有効化の競合も処理する。
- `js/state.js` に保存対象外のproject session identityと購読を追加。LOAD_PROJECT（同一作品の再読込を含む）と既存の新規／読込準備で世代を更新する。履歴や通常の本文編集では更新しない。
- `readStudioAIState` は確定済みのstateと既存direct-editセッションを参照する。対象indexが不明ならnullとし、既存getActiveBlockの選択補正dispatchを呼ばない。原文のdirect／複数段落選択を検証して返し、未検証の原稿textarea／翻訳の選択は推測しない。IME・原稿反映待ちはbusy。
- `verify:studio-webmcp-browser`: 実プロフィールの操作、英語原文検索、JA/EN、モバイル幅、登録途中失敗、他ツール保持、画面退出、同一作品再読込、pagehide、遅い登録の競合を合成原稿＋注入registryで検証。
- `verify:studio-webmcp-native`: 隔離Chrome 153で `--enable-experimental-web-platform-features` を使用。実際のregisterTool／getTools／executeTool／abort解除、UI検索で選択した範囲、古いツール拒否、無効indexの不変を検証。通常ChromeではAPI未提供でスイッチが無効になることも確認。
- 検証用のChrome 153はexecuteToolの引数・結果がJSON文字列。この差は検証用の呼出し側に限定し、DSFが登録するexecuteはオブジェクト引数・結果を維持する。[Chrome実装の変更記録](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/refs/tags/merge_pr_62069)により、今後のバージョンでは呼出し側がオブジェクト形式へ移行する。ツール登録の共通処理に旧呼出し方式を持ち込まない。
- 通常利用中のChrome設定は変更していない。外部AIへの実原稿送信、ChatGPT等のクライアントからの受け入れ試験、commit／デプロイは実施していない。


## 外部AIクライアント受け入れ確認（2026-09-15）

Codex内蔵ブラウザで `scripts/fixtures/studio-webmcp-client.html` を開き、サイトツールの `fetchTools()` / `call()` を通じて、この会話のAIから実際に呼び出した。ページ内のexecuteToolを直接実行する試験ではない。

検証ページは本番と同じ `js/studio-webmcp.js` と共通読み取りツールを使用し、readStateのみを凍結した合成原稿に置き換える。Studioの実作品・認証・保存モジュールは読み込まない。

| 確認項目 | 結果 |
|---|---|
| AI連携オンでツール発見 | context/searchの2ツールを取得 |
| 編集対象の取得 | ja原文、sample-aのFlow、作品トークンを取得 |
| 日本語「灯台」 | currentFlowで2件、workで3件 |
| 英語「lighthouse」 | en-GBのworkで3件 |
| 未入力翻訳 | en-USで0件、原文へfallbackしない |
| 合成作品の切替 | 連携がオフになり、サイトツール一覧から消える |
| 再有効化 | 新しい作品トークンを発行 |
| 古い作品トークンで検索 | DSF_STALE_WORK_TOKENで拒否 |
| 最後にオフ | ツール一覧が空になり、原稿不変：OK |

確認範囲はCodex内蔵ブラウザと合成原稿ページの組合せ。実エディターのstate reader・選択範囲との接続は前節のブラウザ試験で確認しており、今回の外部AI呼出しでは実作品を使っていない。ChatGPT、Claude、Gemini等の各クライアントでの接続成功を意味しない。外部AIへの書込み操作・保存・発行は今回の対象外。

再確認する場合は上記fixtureをlocalhostで開き、AI連携をオンにする。contextで取得したworkTokenを検索へ渡し、最後にオフへ戻す。ブラウザが非対応と表示された場合、通常利用中のブラウザ設定を変更せず対応クライアントで確認する。


## ChromeのGeminiへの相談準備（2026-09-16）

プロフィール内の「Geminiに相談」から、現在のFlow原稿・表示中の本文言語と依頼文を確認してコピーし、Chrome右上のGeminiに貼り付けて送信する導線を追加。

- WebMCPの有効化、拡張機能、APIキーは不要。WebMCP非対応環境でも利用できる。
- これは手動の受け渡し。Geminiの起動・送信、原稿の自動編集は行わず、接続済みとは表示しない。
- 対象は現在のFlow内の見出し・段落本文。画像・ルビの読み・書式、他のFlow、他作品は含めない。翻訳未入力箇所を原文で補わない。
- 12,000書記素を超える場合は冒頭のみ。抜粋であることを画面と依頼文に明記する。
- コピー前に対象・言語・原稿を再照合。変更があれば取り込み直しを要求し、作品切替・Editor退出・言語UI切替では相談画面を閉じる。
- 依頼内容は保存しない。DSFから外部へ送信しない。利用者がGeminiに貼り付けて送信した時点でGoogleへ渡ることを画面に表示する。
- コピー失敗時は依頼全文を選択して手動コピーできる。

Google公式のWebMCPツール検証拡張とGemini in Chromeは別機能。DSFからGemini in Chromeを直接起動・送信する公開インターフェースは確認できていない。自動操作との接続は対応クライアントが確認できた段階で別途検証する。

参照: [WebMCP](https://developer.chrome.com/docs/ai/webmcp)、[Gemini in Chrome](https://support.google.com/gemini/answer/16283624)。

検証: 合成原稿を用いた通常Chromeでの画面表示・コピー・空依頼の無効化。Gemini側への送信と回答は未検証。


## 段落書き込み（2026-09-16）

プロフィールの読み取り連携をオンにした後、「段落の書き込みを許可」を明示的にオンにする。初期オフ、作品切替・Editor退出・pagehide・連携オフで失効。書き込み許可の切替時には登録世代と作品トークンを更新する。読み取りだけでは従来の2ツールのみ。

書き込み時は次の2ツールを追加する。

| ツール | 契約 |
|---|---|
| `dsf_read_flow_paragraph` | context/searchで得たworkToken・groupId・sectionId・blockId・languageKeyを指定。現在のFlow・表示中の本文言語の1見出し/段落全文とeditTokenを返す。翻訳がなければ空文字とmissingTranslation=true。原文fallbackなし。 |
| `dsf_replace_flow_paragraph` | workToken・editToken・textを指定。取得時のFlow全体と現在の対象・言語・busy状態を再照合してから変更。1段落の平文、最大12,000 UTF-16 code units、改行なし。 |

- 編集券はメモリ内で最新1件のみ。他段落の取得は古い券を失効させる。成功後の同一引数再送は直前の結果にreplayed=trueを付けて返すだけで、再適用・履歴追加しない。
- 段落ID、種類、分割、他言語本文を維持する。既存の注釈更新・配置anchor再対応・原文変更時の翻訳状態記録／翻訳手動更新を使う。ルビ対象文字の変更はneeds-reviewとなり、画面で確認が必要。
- 純粋な編集結果を生成・検証してからStudioのapplyEditorSpineChangeへ渡し、既存Undo/Redo、再組版、通常の自動保存へ接続する。AIだけの別保存経路や公開操作は追加しない。
- 原稿反映待ちや組版処理中はBUSY。古い編集券はSTALE_EDIT_TOKEN、原稿変更はSTALE_TEXT、対象変更はTARGET_CHANGED。エラーには原稿を含む例外文字列を返さない。
- 書き込みツールにはreadOnlyHint=false、consequentialHint=trueを付ける。ただし注釈だけに依存せず実装でも境界を検証する。
- 画像挿入・段落追加/削除・一括置換・スタイル変更・AIからのUndo・発行は未提供。DSP/DSF/Firestore形式変更なし。

### 検証

`npm run verify:editor-write-tools`：対象と言語の分離、古い券/作品の拒否、重複再送、空翻訳への入力、長さ・改行制限、Unicode、注釈維持、翻訳状態、履歴1件・Undo/Redoを確認。既存readonlyとFlow置換の検証も通過。

`/scripts/fixtures/studio-webmcp-write.html` は合成原稿専用で、本番と同じ登録adapter・編集処理・Undo履歴を使う。Chrome実APIで段落取得・更新・再送・Undo・手動変更後の拒否を確認。検証ページは保存せず、通常のビルド成果物には含まれない。

Chrome内ChatGPTの会話から実際にツールを選択すること、Studio上での実作品編集・クラウド自動保存は今回のChrome検証範囲に含めない。対応UIが表示されても、そのクライアントからの呼出し成功は別途確認する。
