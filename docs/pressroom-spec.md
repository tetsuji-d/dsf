# プレスルーム 仕様

## 概要

プレスルームはエディター（.dsp編集）とポータル（公開閲覧）の間にある**発行管理の場**。
ユーザーはここでプロジェクトを選択してレンダリングし、Works Room で公開ステータスを管理する。

## フロー

```
Studio (Editor)          Press Room                     Portal
.dsp を編集  ──選択──→  レンダリング (.dsp → .dsf)  ──公開──→ 公開フィード
                         ステータス管理
```

## ステータス定義（.dsf 単位）

| ステータス | 説明 | ポータル表示 | URL アクセス |
|-----------|------|------------|------------|
| `draft`      | 下書き。レンダリング済みだが未公開 | ✗ | 作者のみ |
| `unlisted`   | 限定公開。URLを知っている人だけ閲覧可 | ✗ | ✓ |
| `public`     | 公開。ポータルのフィードに表示 | ✓ | ✓ |
| `private`    | 非公開。作者が一度公開したものを取り下げ | ✗ | ✗ |
| `rejected`   | リジェクト。運営による強制非公開。作者は再公開不可 | ✗ | ✗ |

`draft` / `private`の作者確認は通常の`?work=`共有URLではなく、`/viewer?draft={projectId}`の所有者プレビューを使う。
ViewerはURLからUIDを受け取らず、ログイン中のFirebase Auth UID配下にあるProject／Work／Releaseだけを読む。

## 掲載可能期間 / 公開期限

`dsfStatus` は公開状態、`publication` は時間境界を表す。

| 項目 | 起点 | 終了 | 初期方針 |
|------|------|------|----------|
| 掲載可能期間 | Press Room で DSF 出力を始めた時 | 掲出終了 | FREE は最大 14 日。PLUS / PRO / BUSINESS は有効な課金中のみ無期限 |
| 公開期限 | Works Room で `public` / `unlisted` にした時 | 公開終了日時 | PRO / BUSINESS のみ予約設定可能。必ず掲載可能期間内 |

- Press Room は draft 作成時に `publication.listedFrom` / `listedUntil` を保存する。
- Works Room は `public` / `unlisted` への変更時に `publication.publicFrom` を保存する。
- FREE / PLUS は公開期限予約不可。FREE の公開可能期間は掲載可能期間で制御する。
- プランダウングレード・解約時は `publication` を現在プランで再評価する。期限外の公開/限定公開作品は下書き扱いに戻す。
- Portal は `public` かつ期限内の作品だけを一覧表示する。
- Viewer は `public` / `unlisted` URL の直アクセスでも期限外なら表示しない。
- この段階は metadata ベースの制御であり、R2 の直接 URL 物理遮断は別課題とする。

## エディターとの関係

- `.dsp` はプレスルームを経由せずポータルに公開できない
- エディター内プレビューは `.dsp` のまま表示（ローカルレンダリング）
- 制作言語一覧と発行言語は分離する。Press入室時は`defaultLang`だけを選び、翻訳済み言語は作者が追加選択する
- 発行言語の選択はPress内の一時状態であり、DSPへ保存しない。未選択言語のmissing／stale翻訳や未対応fontは発行判定へ含めない
- 発行処理 = ページ単位の配信方式判定（グラフィックWebP／組版済み固定テキスト）→ 言語別固定ページ列をCloudflare R2へ保存
- 選択言語に1ページ以上の`fixedText`があれば、画像assetが0件の作品も有効とする。明示的な画像ページのasset欠落は従来どおり停止する
- Viewer の共有URLは **発行済みDSF projectionだけ**を読む。v1は`dsfPages`、v2は`dsfContentUrl`から読み、未発行の`.dsp`本体を直接表示しない
- Viewerは固定テキストをDOM文字として描画するが、再組版、端末幅リフロー、本文文字サイズ変更は行わない

## レンダリング処理（概要）

1. ユーザーがプレスルームでプロジェクト（.dsp）を選択
2. 各言語でFixed／Flowを最終paginationし、ページごとに`image`または`fixedText`の配信能力を検証する
3. グラフィックページと未対応テキスト効果はWebP化し、対応テキストページは組版済み行／列projectionへ変換する
4. R2へimmutableな`content.json`、言語manifest、WebP assetsを保存する
5. Firestoreへlocator、言語別ページ数、容量等のRelease metadataを書き込む
6. ステータスを`draft`で作成し、既存の公開インデックスは外す
7. その後ユーザーがWorks Roomでステータスを変更して公開する

## データモデル

| コレクション | 内容 |
|------------|------|
| `users/{uid}/projects/{pid}` | .dsp データ（編集中のプロジェクト） |
| `public_projects/{workId}` | `public` / `unlisted` DSFのURL解決とポータル表示に必要な最小metadata |
| Cloudflare R2 | immutable DSF content index、言語別固定ページ列、WebP画像assets |

DSF delivery v2の配信データとViewer契約は`docs/fixed-text-delivery-contract.md`を正本とする。
現行runtimeはWebP-only v1であり、9A実装完了まではFlowを含む作品の発行を停止する。

9A-3Bでは、開発サーバーのPressページ一覧だけにFixed text配信候補previewを表示する。
正規`360×640`のDOM pageをサムネイルへ一様縮小し、未対応ページはWebP fallback codeと理由を表示する。
ここで使うfont declarationはローカルfixtureであり、本番証明書ではない。`DSF書き出し`、`Horizonに発行`、
容量見積り、Firestore／R2、staging buildには接続しない。

9A-3Cでは、権利、version、immutable WOFF2 URL、実bytes SHA-256、対応言語／writing modeを要求する
本番認定font registry契約と、Fixed pageを`fixedText`／理由付きWebPへ分類するpure Press preflightを追加した。
本番registryは確認済みfontがないため空であり、現時点の既存Fixed textは安全なWebP経路を継続する。
9A-3C時点ではFlowを未接続として停止した。9A-5C後もstaging／production Press runtimeはFlow projectionを渡さないため、
実作品は`FLOW_PUBLICATION_PROJECTION_MISSING`で停止する。9A-6Aのdevelopment-only確認は別であり、容量見積り、R2、実発行へ接続しない。

9A-4Aでは、公開可能preflightと検証済みWebP descriptorから、DSF v2 content index、言語manifest、
衝突しないasset path、hash／byte数を持つupload planをpure assemblyする。言語manifestとindexのhashは、
assemblerが確定したUTF-8 JSON bytesへ注入SHA-256関数を適用した値である。呼び出し元指定のasset `href`／`path`は
受け付けない。これはPress Roomの実行経路ではなく、WebP実bytes、R2、Firestore、UI、公開Viewerには未接続である。

9A-4Bでは、実WebP bytesのRIFF size、chunk境界、VP8／VP8L／VP8X寸法、静止画制約を検査し、
Web Crypto SHA-256、immutable Blob、9A-4A descriptorを結び付ける。アニメーション、壊れたchunk、
Press期待寸法／既知hashとの不一致は拒否する。これはlocal moduleだけであり、現在のPress render／upload／R2経路は変更しない。

9A-4Cでは、9A-4Aの確定JSONと9A-4Bのsealed WebPを再照合し、`mimetype`、archive manifest、`meta.json`、
`content.json`、言語manifest、WebPの完全なfile inventoryをメモリ上で作る。画像page／asset plan／sealed Blobの
欠落・重複・余剰・対応違いを拒否する。ZIP生成、download、Press UI、R2、Firestore、公開Viewerには接続しない。

9A-4Dでは、9A-4C inventoryを固定entry順・固定日時・`mimetype` STOREでDSF ZIPへメモリ生成し、
local headerとCRC付き再展開後の全entryをbyteLength／SHA-256で照合する。一致しないZIP Blobは返さない。
download、既存`exportDSF()`、Press UI、R2、Firestore、公開Viewerには接続しない。

9A-5Aでは、semantic Flow source、成功pagination、認定fontで実測済みのcomposition snapshotを
revision／page／grapheme range／line geometryで照合し、1つのFlow Group／1言語の`fixedText` manifest fragmentへ
pure projectionする。文字数から行／列位置を推測しない。DOM snapshot capture、Flow preflight、9A-4A assembly、
Press UI、R2、Firestore、公開Viewerには接続しないため、Flow作品の発行停止は継続する。

9A-5Bでは、認定fontの本文weight／Heading 700を明示loadし、fallbackなしの単一familyと
`hyphenation:'none'`を固定したlocal browser sessionでFlowをページ化する。同じsessionのpaginationだけを
DOM Range実測し、行／縦書き列とsemantic source grapheme runを採取して直後に9A-5Aへ渡す。
Press UI、Flow preflight、9A-4A assembly、R2、Firestore、公開Viewerには未接続であり、発行停止は継続する。

9A-5Cでは、9A-5Aの成功Flow projectionと現在のauthoring revisionをpure preflightで再検証し、Fixed／Flow／WebPを
作者順の言語別manifestへpure assemblyする。Flow Groupは1つのdecisionのまま、検証済みprojectionの複数pageへ展開される。
翻訳言語ごとにFlow page数が異なっても、後続Fixed pageは各manifest内で連続する。古いrevision、別言語、未知font、
anchor不一致、暗黙のFlow WebP fallbackはfail closedにする。9A-5C単体はPressへprojectionとrevisionを渡さず、
後続9A-6Aもdevelopment-only確認に限定する。容量見積り、ZIP、download、R2、Firestore、公開Viewerへ接続しないため、
Flow作品の発行停止は継続する。

9A-6Aではdevelopment serverのPress Roomだけが`flow-press-preflight-preview.js`を動的に読み込み、保存言語ごとに
Flow実DOM capture、projection、preflightを実行する。候補Flow page数、作品全体page数、停止code／理由を表示する。
missing／stale翻訳は原文fallbackで発行候補にせず、既定font設定も実効typographyで厳密に照合する。
synthetic local fixture fontだけを使い、staging／production buildへ含めない。DSF書き出し、Horizon発行、容量見積りは
Flowを含む間無効のままであり、ZIP、R2、Firestore、公開Viewerも変更しない。

9A-6B-Aでは`flow-press-preflight-preparation.js`へfixture非依存の共通処理を分離し、
`flow-press-publication-preparation.js`が空を含む本番font registryだけを使ってdevelopment／staging／production Pressの
準備判定を行う。authoring font familyは本番registry内の一意な完全一致entryだけへ解決し、未登録または複数versionは
理由code付きで停止する。9A-6B-A時点は認定font 0件のためDOM capture前に`FONT_NOT_CERTIFIED`となる。

9A-6B-Aは発行可能化ではない。結果をstate／DSP／DSF／Firestoreへ保存せず、容量見積り、release assembly、ZIP、download、
R2、公開Viewerへ渡さない。`exportDSF`、`publishToCloud`、Press発行ボタンのFlow停止は維持する。

9A-6B-B1／B2では、本番registry entryの固定URLからcredentialなしで取得したWOFF2を、header、response MIME／length、
実byteLength、SHA-256で照合する。成功したbytesだけをsession専用の別family名でFontFaceへ一時登録し、FlowのDOM paginationと
Range実測に使う。publication snapshotには認定family／hashを保持し、runtime aliasを配信dataへ保存しない。lease終了時は
FontFaceを削除する。9A-6B-B1／B2時点は本番registryが空のためfetchを開始せず、`FONT_NOT_CERTIFIED`を表示する。

9A-6B-B3-AではNoto Sans JP 2.004-H2とNoto Serif JP 2.003-H1を、subsettingなしのfull variable WOFF2として
技術候補へ固定した。source commit、source／WOFF2 SHA-256、実byteLength、weight axis、縦書きfeature、OFL根拠は
`docs/production-font-certification.md`に記録する。9A-6B-B3-A時点はproduction R2の実URL、CORS、MIME、immutable cache、
remote bytes、Architect reviewが未確認なのでregistryを空のまま維持し、Pressの発行停止も変更しない。

9A-6B-B3-A2では発行artifactを分ける。Horizon閲覧用はregistryの共有immutable CDN fontを参照できるが、
ダウンロード用`.dsf`は使用fontを`fonts/<sha256>.woff2`へ必須同梱し、portable `content.json`を`source:'embedded'`へ
書き換える。片方のartifactをもう片方へ流用せず、download packageに外部font URLが残れば書き出しを停止する。

9A-6B-B3-Bのstaging確認では、両Noto候補を`dsf-media-staging`へ配置し、remote exact bytes、MIME、CORS、
immutable cache、Chromiumの横書き／縦書きとweight 400／700、portable ZIP同梱round-tripを確認した。
これはproduction registry activationではなく、Pressの発行停止、download UI未接続、production未配置を維持する。

2026-08-24に両Noto WOFF2と書体別OFL noticeをproduction R2へ配置し、remote exact bytes、CORS `*`、
immutable cache、OriginなしGET、`dsf.ink` Chromiumの横書き／縦書きと400／700、ArchitectのWeb配信／portable embedding
承認を確認した。その後、候補projection gateを通した2書体をactive registryへ登録し、Flow Press既定経路で両書体の
横書き／縦書き、本文400／見出し700、巨大Paragraph、PageBreak、exact hash、FontFace／capture DOM cleanupを確認した。
Flow発行ボタン、容量見積り、release assembly、upload、Firestore、公開Viewer runtimeはまだ接続しない。

9A-6C-Aでは、上記の本番準備が全選択言語で成功した場合だけ、Fixed pageを既存Press rendererで実WebP化して
byte sealingし、Flowの`fixedText` projectionとともに既存DSF v2 release assemblyへin-memoryで渡す。Pressは
WebP／fixedText件数、Horizon payload、portable download payload、同梱font byte数をread-only表示する。portable値は
確定JSON、sealed WebP byte数、active registryの認定font byte数を合計したpayload見積りで、ZIP header等のcontainer
overheadは含まない。結果はstate／DSP／DSF／Firestoreへ保存せず、ZIP、download、upload、Horizon発行、公開Viewerへ
渡さない。発行ボタン、`exportDSF`、`publishToCloud`のFlow guardは維持する。

9A-6C-Bでは、Press sessionに保持したsealed WebPと、active registry URLからcredentialなしで取得してMIME／length／
SHA-256を再検証した使用WOFF2を、既存portable planner、file inventory、deterministic ZIP builderへ渡す。生成ZIPは同じ
session内で再展開し、全entryのpath／bytes／SHA-256をinventoryと照合する。合格後にローカル検証用`.dsf`の実測ZIP容量、
展開時容量、SHA-256をread-only表示する。これは9A-6C-Aのpayload見積りとは別の実container検証だが、公開release metadataを
確定する本番発行ではない。Blob／結果はruntime-onlyで、download、upload、Firestore、Horizon発行、公開Viewerには接続しない。

9A-6C-C-Aでは、9A-6C-Bが返したround-trip合格済みZIP Blobだけを既存「DSF書き出し」ボタンへ渡す。package signatureが
現在の原稿、選択言語、方向、解像度、metadataと一致し、Blob MIME、size、SHA-256が検証結果と一致する場合だけFlow時の
ローカル書き出しを有効にする。作品タイトルをNFC正規化し、OS禁止文字・予約名・長さを安全化した`.dsf`名を使い、保存直前にも
同じBlob identityと検証値を再照合する。再ZIP化や旧WebP-only`buildDSF()`へのfallbackを行わない。入力変更、検証待ち／失敗、
Press離脱では即時無効化する。

ゲスト／未保存作品はpackage内の`workId`／`releaseId`にlocal preview用IDを持つ。これはportable fileを識別するための
ローカル値で、Horizon Release IDではない。Flow upload、Firestore、Horizon発行、公開Viewer loadは未接続のまま維持する。

9A-6C-C-Bでは、このローカル保存物をViewerのファイル選択から読み戻す経路を接続した。packageのCRC、canonical JSON、
manifest完全entry集合、全entryのbyteLength／SHA-256、同梱fontのproduction registry証明とWOFF2実bytes、WebP寸法を
検証した後だけ、言語別WebP／`fixedText`ページを既存Viewerへ渡す。fontはsession専用family、画像はobject URLとして保持し、
別ファイル読込／unloadで破棄する。v1／DSPのローカル読込は従来経路を維持する。この単位はPressのpackage生成契約を変更せず、
公開／共有URL、Flow upload、Firestore、Horizon発行、Release metadataへ接続しない。

9A-6C-C-C-0では、Horizon発行を有効化する前の二段階pure契約を追加した。第1段階はverified v2 assemblyから
`users/{uid}/dsf/{workId}/{releaseId}`配下のJSON／WebP file planを作る。第2段階は全fileについてstorage path、public URL、
MIME、byteLength、SHA-256、immutable cache policyが一致するupload receiptを照合し、合格後だけRelease metadataと
`public_projects` locatorをsealする。missing／duplicate／stale receiptが1つでもあればmetadata writeへ進まない。

公開Viewerはschema未指定／v1だけを既存`dsfPages`へ渡し、valid schema v2は`dsfContentUrl`を使う。schema v2が宣言済み、
またはv2 locator fieldが部分的に存在する場合、検証失敗からstaleな`dsfPages`へfallbackしない。この単位はpure module／testだけで、
現行`publishToCloud`、`/upload`、Works、Viewer、Firestore、R2へ接続しない。

9A-6C-C-C-1Aでは、既存画像用`/upload`と分離した`POST /upload-release`を追加した。release planのJSON／WebPだけを対象に、
認証UIDを含む限定path、server-side SHA-256、byteLength、MIME、形式、immutable cache metadataを照合し、create-only R2 writeと
同一内容のidempotent retryだけを許可する。成功時はC-C-C-0 sealへ渡せるexact receiptを返す。ただしPressの発行操作、upload loop、
実R2 traffic、Firestore、Works、公開Viewerにはまだ接続しない。

9A-6C-C-C-1Bでは、verified planのcanonical JSONとexact WebP Blobを送信前に再hashし、全fileをrelease endpointへ逐次送信する
client transportを追加した。HTTP／JSON responseとreceiptをstrictに照合し、partial failure、通信失敗、token欠落、abort、改ざん時は
後続を止めてsealを返さない。retryはpartial receiptをskipせず完全planを再実行する。mock fetchのみで検証し、Press button／progress UI、
実Firebase token／R2、Firestore、Works、公開Viewerにはまだ接続しない。

9A-6C-C-C-1C-Aでは、Pressが保持する成功planningとsealed WebP集合をHorizon planへ再照合するnetwork-idle handoffを追加した。
全assembly imageにexactly oneのBlobを要求し、構造、寸法、byteLength、inspection、SHA-256を再検証してplan fileへ結び付ける。
mock transport統合後もhandoffは`readyForMetadataWrite:false`であり、Press UI、実token／endpoint／R2、Firestore、Works、公開Viewerは
未接続のままである。

9A-6C-C-C-1C-Bでは、そのhandoffをPressの既存ローカル配信設計summaryへread-only接続した。ログイン、所有者、クラウド保存済み
project／work、環境別HTTPS public originが揃う場合だけruntime release IDでexact pathを検証し、file数／bytes／WebP照合数と
「アップロード未実行」を表示する。Flow Horizon発行buttonはready後もdisabledで、client transport、token、R2、Firestore、Works、
公開Viewerは呼ばない。

9A-6C-C-C-1C-Cでは、検証済みhandoffを`/upload-release` client transportへ渡すPress runtime executorを追加した。
実行開始時と各fileのtoken取得時にcurrent userとhandoff ownerを照合し、進捗、abort、入力変更、result identityを監視する。
全receiptが揃った場合だけ後続のdraft保存へ渡せるsealを保持し、Firestore／Works／公開状態は変更しない。この段階では
Flow Horizon発行buttonからexecutorを呼ばないため、通常UI操作によるR2 uploadとHorizon発行はまだ発生しない。

9A-6C-C-C-1C-Dでは、upload sealからowner用Project／Work／ReleaseのDSF v2 draft metadataを作るpure contractと
Press runtime writerを追加した。Projectの旧`dsfPages`は空配列へ明示更新し、v2 locator不整合時にViewerが旧v1へfallback
しないようにする。同じrelease IDのretryはimmutable locatorが完全一致する場合だけ許可する。Project、Dashboard summary、
Work、Releaseの更新と、存在確認・owner照合済み`public_projects/{workId|projectId}`削除は単一transactionにまとめ、成功後も状態は`draft`／`private`とする。
Worksのv2 draft一覧／公開切替は次の単位で対応するため、Flow Horizon発行buttonは引き続きdisabledとする。

9A-6C-C-C-1C-Eでは、Worksのrelease判定をv1 `dsfPages`専用からv1／v2共通のpure projectionへ移した。
v2 draftは既定配信言語の`dsfPageCounts`でページ数を表示し、制作中の`pageCount`や空の`dsfPages`へ依存しない。
公開payload候補はconfigured R2 HTTPS origin、owner、work、releaseを含むimmutable `content.json` pathとhashを再検証し、
部分的なv2 locatorを旧v1へfallbackしない。公開Viewerのv2読込は次単位であるため、Worksのv2「公開／限定公開」と
PressのFlow Horizon発行buttonはまだdisabledを維持する。

9A-6C-C-C-1C-Fでは、公開Viewerが匿名read可能な`public_projects`のexact v2 locatorを起点に、許可R2 origin上の`content.json`／
言語manifestをcanonical JSON・SHA-256・release配下hrefで検証する。active registry fontは既存のexact-byte runtime leaseで読み込み、
owner専用Release文書は公開Viewerから読まない。
合格したWebP／`fixedText`混在ページ列だけを既存Viewerへ渡す。v1公開作品は従来どおり表示し、v2検証失敗はv1やProjectへfallbackしない。
Flow Horizon発行buttonとWorks v2公開／限定公開操作はまだ無効のため、実共有URL確認は次の発行UI接続後に行う。

9A-6C-C-C-1C-Gでは、FlowのPress操作を「Horizonへ下書き保存」として明示し、ready済みhandoffに限って既存のverified upload executorと
owner-only draft writerへ接続した。操作前に読者非公開であることを確認し、upload中はfile進捗とabortを提供する。全receipt seal後だけ
Project／Dashboard summary／Work／Releaseを単一transactionで`draft`／`private`保存し、owner確認済みの古い`public_projects`は削除する。
保存成功後はWorksへ移動するが、Worksのv2公開／限定公開操作は引き続き無効であり、読者公開と実共有URL確認は行わない。

## Studio ナビゲーション構造

```
studio.html
├── 🏠 Home Room        ← 起動時に表示・全ルームへの起点
│   ├── 新規作成            → Editor Room
│   ├── クラウドから読み込み  → Editor Room
│   ├── .dsp ファイルを開く  → Editor Room
│   └── Works Room へ      → Works Room
│
├── ✏️ Editor Room      ← プロジェクト選択後に移動
│   ├── キャンバス編集
│   ├── プレビュー
│   └── [プレスルームへ] ボタン → Press Room へ
│
├── 📢 Press Room       ← Editor Room のボタンから移動（動画編集の書き出しに相当）
│   ├── レンダリング (.dsp → .dsf)
│   └── draft 作成（公開一覧への反映は行わない）
│
└── 📚 Works Room       ← 発行済み DSF の一覧・ステータス管理
    ├── 公開ステータス変更 (draft / unlisted / public / private)
    ├── ポータルへの公開・取り下げ
    └── 再レンダリング（Press Room へ）
```

## ルーム間の遷移ルール

| 遷移 | 挙動 |
|------|------|
| Home → Editor | プロジェクトを選択または新規作成 |
| Editor → Home | 未保存の場合は確認ダイアログ |
| Editor → Press Room | [プレスルームへ] ボタンで移動 |
| Press Room → Editor | キャンセル扱い。Press Room での設定は破棄。DSP は変更されない |
| Press Room → Works Room | 発行完了後に自動遷移（DSF が draft で登録される） |
| Works Room → Press Room | 再レンダリング時 |
| Works Room → Home | 自由に戻れる |

## Press Room の性質

- **プロジェクト専用** — 開いているプロジェクト1つに対して動作する（複数プロジェクトの一括管理ではない）
- **非破壊** — DSP ファイル自体は変更しない。DSP を読み込んで DSF を生成するだけ
- **公開境界は分離** — Press Room は `draft` を作る。ポータル一覧への反映は Works Room の `public` 切り替えだけが行う
- **書き出しフロー** — 動画編集ソフトの「書き出し」ダイアログに相当

## 未決事項

- 複数言語の一括レンダリング vs 言語ごとに個別レンダリング
- リジェクト通知の仕組み（運営側ツール）
- .dsf のバージョン管理（再レンダリング時の扱い）
