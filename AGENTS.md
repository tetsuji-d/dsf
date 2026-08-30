# AGENTS.md — DSF 開発運用ルール

このファイルは、**DSF Studio / Viewer / Library の開発運用ルール**をまとめたものです。  
プロダクト全体像や文書の読み順は **[CLAUDE.md](CLAUDE.md)** を起点にしてください。

**プロダクト前提（要約）**: DSF はスマホ向け固定レイアウト出版。「レイアウトはコンテンツ」。
9:16固定ページをグラフィックWebPまたは組版済み固定テキストで配信し、ZIPコンテナ（`manifest.json` 等）、
広告なしの読書体験、低コストな大規模Web配信、オープンなファイル仕様を重視する。詳細は`CLAUDE.md`を参照。

**開発体制**: Claude (claude-sonnet-4-6) 単体 + 人間（Architect）

> マルチエージェント体制（Claude/Gemini/Codex 分担）は 2026-03-25 に廃止。
> 調整コストが人間の負担になるため、Claude 単体で全ファイルを担当する。

---

## 1. ファイル担当

Claude はスコープ制限なく全ファイルを編集可。

| エリア | ファイル |
|--------|---------|
| エディター | `studio.html`, `js/app.js`, `js/bubbles.js`, `js/shapes.js`, `js/history.js`, `js/layout.js`, `js/sections.js`, `js/blocks.js`, `js/pages.js`, `js/export.js`, `js/theme-presets.js`, `css/studio.css` |
| ビューワー | `viewer.html`, `js/viewer.js`, `css/viewer.css` |
| ポータル | `index.html`, `js/portal.js`, `js/projects.js`, `css/portal.css` |
| 共有インフラ | `js/state.js`, `js/firebase.js`, `js/lang.js`, `css/variables.css` |
| ドキュメント | `docs/` |

---

## 2. データ憲法（参照必須ドキュメント）

| ドキュメント | 内容 |
|-------------|------|
| [docs/data-model.md](docs/data-model.md) | Firestore スキーマ・セキュリティルール |
| [docs/file-format-spec.md](docs/file-format-spec.md) | `.dsp`/`.dsf` ZIP構造仕様 |
| [docs/page-architecture-plan.md](docs/page-architecture-plan.md) | Page v5 スキーマ |

データ形式変更は人間（Architect）と合意してから実装する。

## 2.5 読み順

新しく参加した人間 / AI は、以下の順で読む。

1. [CLAUDE.md](CLAUDE.md)
2. [AGENTS.md](AGENTS.md)
3. 必要に応じて:
   - [docs/data-model.md](docs/data-model.md)
   - [docs/file-format-spec.md](docs/file-format-spec.md)
   - [docs/environment-topology.md](docs/environment-topology.md)
   - [docs/user-account-audit.md](docs/user-account-audit.md)
   - [docs/viewer-info-panel-spec.md](docs/viewer-info-panel-spec.md)

---

## 3. DSF 固定ページフォーマット方針（2026-08-23更新）

**DSF（Digital Spread Format）** の配信ページは、作者が確定した9:16固定レイアウトを保持したまま、
ページ特性に応じて **WebP画像** または **組版済み固定テキスト** で表現する。

| 世代 | 方式 | 状態 |
|------|------|------|
| Gen 1 | Webテキスト組版 + 画像の混在 | 廃止 |
| Gen 2 | WebGL によるフォント・画像統合レンダリング | **廃止**（複雑・重い・端末差） |
| Gen 3 | **WebP 画像のみ（固定レイアウトのマスター）** | 既存runtime／DSF v1として後方互換維持 |
| DSF delivery v2 | **WebP + 組版済み固定テキスト** | 9A-6C-C-C-1C-B Press read-only Horizon readinessまで実装、実upload・R2・Firestore・公開／共有URL runtime未接続 |

- 組版・タイポグラフィ・ページ分割はStudio／Press側で完結し、Viewerは公開済み固定projectionの描画に専念する
- EPUB的リフローではなく、**作者意図のレイアウトをそのまま配信**する
- Viewerは端末や画面幅で改行・改ページせず、読者向け本文文字サイズ変更も提供しない
- `bodyKind:'text'`等の既存固定テキストauthoring dataは維持する。配信v2では`renderKind:'fixedText'`へ投影する
- WebGL / Three.js は使用しない
- 多言語は言語別固定ページ列で表現し、Flow翻訳では言語ごとのページ数差を許可する
- グラフィック／写真／自由配置レイヤーは従来どおりWebPへ合成する
- 詳細は`docs/fixed-text-delivery-contract.md`を正本とする。実装完了までは現行WebP-only公開経路を壊さない

---

## 4. ブランチ運用ルール

### 命名規則

| 種別 | パターン | 例 |
|------|---------|------|
| 機能追加 | `feature/<説明>` | `feature/webp-viewer` |
| バグ修正 | `fix/<説明>` | `fix/thumbnail-race` |
| リファクタ | `refactor/<説明>` | `refactor/app-split` |
| ドキュメント | `docs/<説明>` | `docs/update-schema` |

### 運用フロー

```
main（常に安定・マージ済みコードのみ）
  └── feature/xxx など → 作業完了 → 人間がレビュー → main にマージ
```

- 新タスクは必ず `main` から切る
- `main` への直接コミットは人間（Architect）のみ
- マージ済みブランチは削除する

### Worktree パス

| フォルダ | 用途 |
|---------|------|
| `C:/Users/tetsu/projects/dsf/` | Architect ワークスペース（常に `main`） |
| `C:/Users/tetsu/projects/dsf-dev/` | 開発ワークスペース（作業ブランチ） |

---

## 5. 開発状態

| 項目 | 状態 |
|------|------|
| main ブランチ | AR fields + blob URL fix + Firebase Staging 構築済み |
| viewer/webgl-phase1 | **破棄予定**（WebGL 廃止に伴い） |
| portal.js firebaseConfig | env 変数化 未対応（要対応） |

---

## 6. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-24 | マルチエージェント体制で開発開始 |
| 2026-02-25 | CSS分割・Firebase Staging・AR fields 等を実装 |
| 2026-03-25 | マルチエージェント廃止 → Claude 単体開発に移行。WebGL 廃止・WebP 統一方針を確定 |
| 2026-04-12 | プロダクト叙述を DSF（Digital Spread Format）・固定レイアウト前提に更新（ドキュメント） |
| 2026-08-23 | WebP-only方針を後方互換として維持し、グラフィックWebPと組版済み固定テキストを併用するDSF delivery v2設計を承認 |
| 2026-08-23 | 9A-2: development-only Viewer fixtureで固定テキストDOM renderer、認定font gate、WebP dual dispatch、slider previewを検証。公開runtimeは未接続 |
| 2026-08-23 | 9A-3A: 既存Fixed text blockと本文・layout version・認定font ID／hashを結び付けたcomposition snapshotを配信v2へpure projection。未対応表現は理由付きWebP fallbackとし、Press／公開runtimeには未接続 |
| 2026-08-23 | 9A-3B: 9A-3A projectionをdevelopment-only Pressサムネイルへ接続し、fixedText DOM候補、WebP fallback理由、fixture font gateを検証。実発行／staging成果物／公開runtimeは未変更 |
| 2026-08-23 | 9A-3C: 本番認定font registryの厳格契約とFixed pageごとのpure Press preflightを追加。本番registryは権利・実WOFF2・hash未確認のため空で開始し、既存textはWebPを継続。Flow／R2／実発行／公開runtimeは未接続 |
| 2026-08-23 | 9A-4A: 公開可能preflightと検証済みWebP descriptorから、hash済みDSF v2 content index／言語manifest、衝突しないasset path、Release metadata draftを作るpure assemblerを追加。WebP bytes、R2、Firestore、Press UI、公開runtimeは未接続 |
| 2026-08-23 | 9A-4B: 実WebP bytesのRIFF／chunk／VP8・VP8L・VP8X寸法／静止画制約を検証し、Web Crypto SHA-256とimmutable Blobを9A-4A descriptorへ結び付けるlocal byte sealingを追加。既存upload／Press UI／R2／公開runtimeは未接続 |
| 2026-08-23 | 9A-4C: 9A-4Aの確定JSONと9A-4Bのsealed WebPをpath・寸法・byteLength・SHA-256で再照合し、`mimetype`、archive manifest、metadata、content、言語manifest、画像の完全なlocal file inventoryを追加。ZIP／download／Press UI／R2／Firestore／公開runtimeは未接続 |
| 2026-08-23 | 9A-4D: 9A-4C inventoryから固定entry順・固定日時・`mimetype` STOREで決定的なDSF ZIPをメモリ生成し、local header、CRC、全entryのbyteLength／SHA-256を再展開照合するlocal packageを追加。download／Press UI／R2／Firestore／公開runtimeは未接続 |
| 2026-08-23 | 9A-5A: semantic Flow source、成功pagination、認定font実測snapshotのrevision／page／grapheme range／line geometryをno-loss照合し、言語別`fixedText` manifest fragmentへpure projectionする契約を追加。DOM capture／Press UI／assembly／R2／Firestore／公開runtimeは未接続 |
| 2026-08-23 | 9A-5B: 認定fontを明示loadし、単一family・no-hyphenationの同一browser sessionでFlowをページ化。Range実測の行／縦書き列とsource grapheme runを9A-5Aへno-loss投影するlocal captureを追加。Press／assembly／R2／Firestore／公開runtimeは未接続 |
| 2026-08-23 | 9A-5C: 現在revisionと完全一致する成功Flow projectionをpure preflightへ統合し、Fixed／Flow／WebPを作者順の言語別manifestへpure assembly。言語別page数差を保持し、古いprojection／未知font／anchor不一致／暗黙WebP fallbackを拒否。Press実行runtime／ZIP／R2／Firestore／公開runtimeは未接続 |
| 2026-08-23 | 9A-6A: development-only Press UIでFlow実DOM capture、9A-5A projection、9A-5C preflightを接続し、言語別候補page数と停止理由を表示。missing／stale翻訳は原文fallbackせず停止。local fixture fontのみで、発行ボタン／容量見積り／staging／production runtimeは未接続 |
| 2026-08-23 | 9A-6B-A: fixture非依存のFlow preflight共通処理と、本番font registry専用のPress準備ゲートをdevelopment／staging／production UIへ接続。空registryでは`FONT_NOT_CERTIFIED`でDOM capture前に停止し、発行ボタン／容量見積り／release assembly／upload／公開runtimeは未接続 |
| 2026-08-23 | 9A-6B-B1/B2: 本番WOFF2のheader・実byteLength・SHA-256をregistryへ完全照合するpure verifierと、credentialなし固定URL取得・response検査・session専用verified FontFace familyのload/disposeをFlow production capture前へ接続。registryは空のまま、実font登録／発行／保存／公開runtimeは未接続 |
| 2026-08-23 | 9A-6B-B3-A: Noto Sans JP 2.004-H2とNoto Serif JP 2.003-H1のfull variable WOFF2候補を固定。source commit、source／asset hash・length、OFL、縦書きfeature、no-subset table比較を記録した。production R2実体とremote evidence、Architect review未確認のためregistryは空、発行停止を維持 |
| 2026-08-23 | 9A-6B-B3-A2: Horizonは共有immutable CDN font、ダウンロード用`.dsf`は使用fontを`fonts/<sha256>.woff2`へ必須同梱するartifact分離を確定。portable planner、inventory、ZIP round-tripで外部font依存と欠落を拒否。download UI／R2／公開runtimeは未接続 |
| 2026-08-23 | 9A-6B-B3-B staging: Noto Sans JP／Serif JP候補を`dsf-media-staging`へ配置。MIME／CORS／immutable cache／remote exact bytes、Chromium横書き・縦書き・400/700、portable ZIP同梱を確認。production registry／発行／download UIは未接続 |
| 2026-08-24 | 9A-6B-B3-B production asset: 両Noto WOFF2と書体別OFL noticeを`dsf-media`へ配置。remote exact bytes、MIME、CORS `*`、immutable cache、OriginなしGET、production Chromium横書き・縦書き・400/700を確認し、ArchitectのWeb配信／portable embedding承認を記録。active registry／発行／download UIは未接続 |
| 2026-08-24 | 9A-6B-B3-C registry activation: 候補projection gateを通したNoto Sans JP／Serif JPだけをactive production registryへ登録。Flow Press既定経路で両書体の横書き／縦書き、本文400／見出し700、巨大Paragraph、PageBreak、exact hash、cleanupをChromium確認。実発行／download UI／Firestore／公開Viewerは未接続 |
| 2026-08-24 | 9A-6C-A: 成功した本番Flow準備結果と実WebP descriptorを既存DSF v2 assemblyへin-memory接続。PressにWebP／fixedText件数、Horizon payload、portable payload、同梱font容量を表示する。ZIP overhead、download、upload、Firestore、Horizon発行、公開Viewerは未接続でFlow発行guardを維持 |
| 2026-08-25 | 9A-6C-B: Press session内のsealed WebPとactive registryから取得・exact検証した使用WOFF2を、既存portable planner／file inventory／deterministic ZIPへ接続。全entryの再展開・hash照合後にローカル検証用`.dsf`の実測容量とSHA-256をread-only表示する。download、upload、Firestore、Horizon発行、公開Viewerは未接続でFlow発行guardを維持 |
| 2026-08-25 | 9A-6C-C-A: 現在のPress設定と署名一致するround-trip合格済みportable ZIP Blobだけを既存DSF書き出しへ接続。安全化した作品タイトルの`.dsf`名を使い、Blob identity／size／SHA-256／signatureを再照合してローカル保存する。Flow upload、Firestore、Horizon発行、公開Viewerは未接続でcloud guardを維持 |
| 2026-08-26 | 9A-6C-C-B: portable v2 `.dsf`をViewerのローカルファイル選択へ接続。CRC、canonical JSON、manifest完全entry集合、全entry hash、active production registryと同梱WOFF2、WebP寸法をfail closed検証し、WebP／fixedText混在ページと言語列を既存Viewerで表示する。session専用FontFace／object URLを破棄し、v1／DSP fallbackを維持。公開／共有URL、upload、Firestore、Horizon発行は未接続 |
| 2026-08-26 | 9A-6C-C-C-0: verified v2 assemblyからimmutable Horizon file planを作り、全JSON／WebPのURL・MIME・byteLength・SHA-256・cache policyが一致するreceipt完了後だけRelease／public locatorをsealするpure契約を追加。公開Viewerはvalid v2を優先し、宣言済み／部分v2の失敗時にv1へfallbackしない。Press、Works、Viewer、upload API、Firestore、R2は未接続 |
| 2026-08-26 | 9A-6C-C-C-1A: 既存画像用`/upload`と分離したrelease専用`/upload-release`を追加。限定JSON／WebP path、認証UID、server-side SHA-256、byteLength、MIME、形式、immutable cacheを検証し、create-only writeと同一内容の再送だけを許可してexact receiptを返す。mock R2のみで検証し、Press、実R2、Firestore、Works、公開Viewer、deployは未接続 |
| 2026-08-26 | 9A-6C-C-C-1B: verified Horizon planのcanonical JSON／exact WebP Blobをclientで再hashし、requestごとにtokenを取得して全fileを逐次送信するtransportを追加。全response／receipt一致後だけpure sealを返し、partial failure、通信失敗、token欠落、abort、改ざん時は後続停止。mock fetchのみで検証し、Press、実token／R2、Firestore、Works、公開Viewer、deployは未接続 |
| 2026-08-26 | 9A-6C-C-C-1C-A: Pressの成功planningとsealed WebP集合をimmutable Horizon planへ再照合し、画像ごとの実Blob構造、寸法、byteLength、SHA-256を検証したnetwork-idle handoffを追加。mock transport統合のみ確認し、Press UI、fetch／token、実R2、Firestore、Works、公開Viewer、deployは未接続 |
| 2026-08-26 | 9A-6C-C-C-1C-B: network-idle Horizon handoffをPress既存ローカル配信設計summaryへread-only接続。認証／cloud作品identity、working／blocked／error／ready、file数、exact bytes、WebP照合数、upload未実行を表示し、Flow発行buttonはready後もdisabled。実transport／token／R2、Firestore、Works、公開Viewer、deployは未接続 |
| 2026-08-26 | 10A-0: Flow原稿source選択時だけ既存削除操作を有効化。確認後に原稿・翻訳を含むFlow Group全体を1 transactionで削除し、生成ページ個別削除は禁止。対象runtimeを中止・破棄し、既存Undo／Redoとautosaveで復元・保存する。schema／Press／Viewerは未変更 |
| 2026-08-26 | 10A-1: 生成Flow fragment DOMとsemantic Block／grapheme caretを双方向に対応付け、生成ページ本文クリックから同じ言語の連続原稿textareaへno-lossで移動するread-only source mappingを追加。原文fallback page、直接入力、schema／Press／Viewerは未変更 |
| 2026-08-27 | 10A-2: 原稿言語・横書きHeading／Paragraphの生成ページへruntime caretと不可視input proxyを追加。通常入力とIME確定をsemantic `setText`、既存Undo／Redo・autosave・増分reflowへ接続。日本語の新規Flowは明示writingMode未設定時だけ既存の縦／横設定を継承。Enter／構造編集、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-28 | 10A-3A: 原稿言語・横書きParagraphのcollapsed caretでEnterを受け、元IDを保つ前半と原稿のみの新Paragraphへ1 transactionで分割。翻訳は推測分割せずstale／missingへ移行し、既存Undo／Redo・autosave・増分reflowで新Paragraph先頭へcaretを復元。Heading、選択付きEnter、段落結合、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-28 | 10A-3B: 原稿言語・横書きParagraph先頭のcollapsed caretでBackspaceを受け、直前ParagraphのID／未知fieldを維持して1 transactionで結合。結合元に翻訳本文があればデータ保護のため拒否し、結合先翻訳は保持してstale化。既存Undo／Redo・autosave・増分reflowで結合位置へcaretを復元。Heading／PageBreak境界、選択付き結合、Delete、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-28 | 10A-3C-A: 原稿言語・横書きParagraph末尾のcollapsed caretでDeleteを受け、既存`mergeParagraphBackward`へ次Paragraph IDを渡して現在ParagraphのID／未知fieldを維持したまま1 transactionで結合。次Paragraphに翻訳本文があれば拒否し、現在Paragraphの翻訳は保持してstale化。既存Undo／Redo・autosave・増分reflowで結合位置へcaretを維持。Heading／PageBreak境界、選択付き結合、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-29 | 10A-3C-B: 1つのsemantic Paragraphが複数生成ページへ分割された状態で、後半caretのEnterによりページ数が2→3へ増え、新Paragraphへ追従することをpure回帰で固定。直後のBackspace／Deleteはいずれも同じ境界を削除して3→2へ戻り、cold paginationと一致。新規編集仕様、schema／Press／Viewerは未変更 |
| 2026-08-29 | 10A-3D-A: 原稿言語・横書きHeading末尾のcollapsed caretでEnterを受け、Heading直後へ原稿のみの空Paragraphを1 transactionで追加。HeadingのID／level／翻訳／未知fieldを維持し、既存Undo／Redo・autosave・増分reflowで新Paragraph先頭へcaretを移す。Heading途中／選択付きEnter、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-29 | 10A-3D-B: Heading直後に10A-3D-Aと同じ形の原稿のみ空Paragraphがある場合だけ、先頭BackspaceでそのParagraphを削除してHeading末尾へcaretを戻す。空文字を含む翻訳key、未知field、translation metadataがあれば削除を拒否し、既存Undo／Redo・autosave・増分reflowへ接続。本文、Heading、PageBreak、縦書き、翻訳直接編集、schema／Press／Viewerは未変更 |
| 2026-08-30 | 10A-4A: 原稿言語・縦書き生成ページのclick位置を既存semantic grapheme mappingへ通し、writing mode対応のpure geometryで文字間へ横棒caretを表示。折返し列境界はclick側のvisual affinityをruntimeだけで保持。非focusable runtime anchorだけを置き、縦書きinput proxyと本文変更は引き続き拒否する。History／revision／autosave／pagination、schema／Press／Viewerは未変更 |
| 2026-08-30 | 10A-4B: 原稿言語・縦書きHeading／Paragraphの通常入力と日本語IME確定を、10A-4Aの横棒caretから既存semantic `setText`、Undo／Redo、autosave、増分reflowへ接続。IME変換中はsourceとprojectionを変更せず、確定時だけ反映する。Enter／Block境界Backspace・Deleteの縦書き構造編集はpure／UIの両方で拒否し10A-4Cへ分離。schema／Press／Viewerは未変更 |
