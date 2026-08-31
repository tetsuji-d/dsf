# DSF & DSP File Format Specification

## 概要

**DSF（Digital Spread Format）** は、スマートフォン向け固定レイアウト出版のためのフォーマット総称です。リフロー型の EPUB とは対照的に、ZIP コンテナ内の **`manifest.json` / `meta.json` / `content.json`** とアセットにより、ページ構成・多言語・表示メタ（アスペクト比・綴じ方向など）を管理します。

本書は DSF Studio における 2 つの主要アーカイブ（**`.dsf`（配信）** および **`.dsp`（編集用プロジェクト）**）の構造とデータモデルを定義します。どちらも **ZIP アーカイブ** をコンテナとし、Excel（`.xlsx`）や EPUB と同様に、将来の拡張に対して上位/下位互換を保ちやすい設計を目指します。

**論理ページ（9:16）の基準**: アプリ内の編集・組版・Press の座標系は **`360×640` 論理ピクセル**を正とする（実装は `js/page-geometry.js`、表示トークンは `css/variables.css` の `--dsf-canonical-page-*`）。画像ページの配信用ラスタは **少なくとも `1080×1920`（論理の 3 倍）** を最低ラインとする。固定テキストページは同じ論理座標上の組版済み行／縦書き列を保持し、Viewerで再組版しない。どちらも`meta.json`の`presentation.aspectRatio`（例: `"9:16"`）と整合させる。

---

## 1. ファイル拡張子と用途の違い
根本的な内部構造（ZIP圧縮されたJSONと画像群）は同一ですが、用途と含まれるデータ粒度が異なります。

### `.dsp` (Digital Smart Project)
*   **用途**: DSF Studio 上での**編集用プロジェクトファイル**。バックアップや、別の端末・ユーザー間で作業状態をそのまま移行するために使用。
*   **特徴**:
    *   エディタのUI設定（サムネイルの列数、ズーム状態など）、編集途中のメタデータ、未翻訳の言語設定などを全て保持する。
    *   ユーザーが画質調整や切り抜きをやり直せるよう、**無劣化のオリジナル高解像度画像** を含む。
    *   編集履歴（Undo/Redoスタック）などを将来的に含める拡張の余地がある。

### `.dsf`（DSF 配信パッケージ / Digital Spread Format）
*   **用途**: エンドユーザー（読者）へ向けた**配信・配布用ファイル**。ブラウザ Viewer や将来のサードパーティリーダーでの閲覧に特化。（歴史的文脈では「Digital Smart Format」表記の資料もある）
*   **特徴**:
    *   エディタ固有のUI設定や不要なメタデータをパージし、ファイルサイズを最小限まで削ぎ落とす。
    *   グラフィック／写真ページは閲覧に最適なサイズと品質（WebP等の高圧縮フォーマット）に **事前リサイズ・最適化・切り抜き済み** のもののみを収録する。
    *   テキスト中心ページは、Studio／Pressで改行・改ページ・座標を確定した固定テキストprojectionを収録できる。
    *   ビューアが即座にパースして描画開始できるように、不要なリレーション階層（Sections と Blocks の関係など）をフラット化して軽量化する。

Flow LayoutはStudio／DSP側のauthoring方式であり、配信DSFをリフロー形式へ変更しない。Flow原稿もPressで
ページ境界と行／列を確定し、DSF delivery v2の`fixedText`ページへ投影する。端末幅や読者設定によるViewer内の
再改行・再ページ化は行わない。グラフィックページおよび固定テキスト非対応の効果を持つページはWebPを使う。

hybrid delivery v2の詳細は[fixed-text-delivery-contract.md](fixed-text-delivery-contract.md)を正本とする。
公開／共有URL runtimeはまだv1 WebP-onlyであり、9A実装完了まではFlowを含む作品の発行停止を維持する。
9A-4Aのpure release assemblerはv2 `content.json`／言語manifest相当の確定JSONとasset planをメモリ上で作るだけで、
`.dsf` ZIP、R2 object、Firestore Release、公開Viewer loadを生成しない。
9A-4Bのlocal byte sealingは、実WebP bytesのRIFF／chunk／codec寸法、静止画制約、SHA-256を検証して
immutable Blobへ結び付けるだけで、archive file inventory、ZIP、uploadを生成しない。
9A-4Cのlocal release file inventoryは、確定JSONとsealed WebPを実bytesから再hashし、`mimetype`、
`manifest.json`、`meta.json`、`content.json`、言語manifest、画像の完全なファイル一覧をメモリ上で作る。
ZIP bytes、download、upload、Firestore Release、公開Viewer loadはまだ生成しない。
9A-4Dのlocal ZIP packageはそのinventoryを決定的なentry順でZIP化し、CRC付き再展開と全entryのSHA-256照合を
完了したimmutable Blobだけを返す。download、Press UI、upload、Firestore Release、公開Viewerには接続しない。
9A-5Aのpure Flow publication projectionはsemantic source、成功pagination、認定fontで実測済みの行／列snapshotを
照合してv2 `fixedText` page fragmentを作る。snapshot自体やsemantic FlowDocumentを配信DSFへ保存せず、
9A-5Bのlocal browser sessionが認定font・no-hyphenation条件でpaginationとDOM Range snapshotを作れるが、
9A-5Cで現在revisionと完全一致する成功projectionをpure Press preflightへ通し、Fixed／Flow／WebPを作者順の
言語別manifestへpure release assemblyできる。9A-6Aではdevelopment-only Press UIで言語別候補page数と停止理由を
確認できるが、local fixture結果はDSFへ保存せず、staging／production Press、ZIP、upload、公開Viewerには接続しない。
9A-6B-Aでは本番font registry専用の準備ゲートをstaging／productionを含むPress UIへ接続した。この時点ではregistryが空なので
`FONT_NOT_CERTIFIED`で停止する。準備結果はDSFへ保存せず、発行、容量見積り、release assembly、ZIP、uploadにも使わない。
9A-6B-B1／B2では、registryに将来登録するWOFF2を実bytesのheader／byteLength／SHA-256で検証し、session専用familyへ
一時loadできた場合だけFlow captureへ進む。runtime evidenceと一時FontFaceはDSFへ保存しない。この時点ではregistryを空に保つ。
9A-6B-B3-AではNoto Sans JP 2.004-H2とNoto Serif JP 2.003-H1のfull variable WOFF2候補を固定したが、
production R2実体とremote evidence、Architect reviewが未完了なのでregistryへは登録しない。保存schemaは変更しない。
9A-6B-B3-Cではproduction evidenceとArchitect review済みの2候補だけをactive registryへ登録し、Flow Press実ブラウザー
pagination／projectionを確認した。registry、runtime lease、capture結果はDSFへ保存しないため、ファイルschemaは変更しない。
9A-6B-B3-A2ではHorizon用assemblyからダウンロード専用portable assemblyを派生し、使用fontのexact WOFF2を
`fonts/<sha256>.woff2`へ必須同梱できるlocal gateを追加した。download UI、upload、Firestore、公開Viewerには未接続である。
9A-6C-Aでは成功したFlow本番準備とsealed WebP descriptorから既存v2 assemblyをin-memory生成し、Horizon payloadと
portable payloadを見積もる。portable値は確定JSON、実WebP byte数、registry認定font byte数を含むがZIP container overheadは
含まない。assembly／見積りは非永続であり、ZIP、download、upload、発行には接続しないため、ファイルschemaは変更しない。
9A-6C-Bでは同じsealed WebPと、active registryから取得してexact検証した使用WOFF2を既存portable inventory／deterministic
ZIP builderへ渡す。全entryを再展開してpath／byteLength／SHA-256を照合し、ローカル検証用`.dsf`の実container容量を得る。
既存のembedded font declaration、`fonts/<sha256>.woff2`、WebP entryをそのまま使うためschema変更はない。生成物はruntime-onlyで、
download、upload、発行にはまだ接続しない。
9A-6C-C-Aでは9A-6C-Bのround-trip合格済みZIP Blobを現在のpackage signature、MIME、byteLength、SHA-256へ再照合し、
同じBlobをportable `.dsf`としてローカル保存できる。既存entry、embedded font declaration、archive hashを変更せず、
旧WebP-only builderで再生成しないためschema変更はない。Flow upload、Firestore、Horizon発行、公開Viewer loadは未接続である。
9A-6C-C-Bではportable v2 `.dsf`をローカルViewerで開ける。CRC付きZIPを展開し、canonical `manifest.json`／`meta.json`／
`content.json`／言語manifest、manifestの完全entry集合、MIME、byteLength、SHA-256を検証する。`fonts/<sha256>.woff2`は
active production registryのfamily／version／font ID／hash／埋込権と一致し、WOFF2実bytes検査を通った場合だけsession固有の
FontFaceへ登録する。画像は参照entryだけを静止WebP／指定寸法まで検証してobject URL化する。検証途中の不足、余分なentry、
case衝突、path traversal、hash不一致、未知の必須contentはpackage全体を拒否する。schemaは変更せず、WebP／`fixedText`混在と
言語別ページ列を既存Viewerへ渡す。旧v1／DSP／JSONのローカル読込は従来経路を維持し、公開／共有URL、upload、Firestore、
Horizon Releaseは変更しない。
9A-6C-C-C-0ではHorizon artifactの保存pathを`users/{uid}/dsf/{workId}/{releaseId}/`へ固定し、その下へ
`content.json`、言語manifest、WebP assetをassemblyの相対pathどおりに置くpure upload planを追加した。Horizonは認定fontの
共有immutable CDN URLを使うため、releaseごとのWOFF2は含めない。全fileの予定URL、MIME、byteLength、SHA-256、
`public, max-age=31536000, immutable`がupload receiptと完全一致するまで、v2 Release metadataをpublishableにしない。
これはschemaを変更せず、upload API、R2、Firestore、Press、Works、公開Viewerへまだ接続しない。
9A-6C-C-C-1Aでは、このfile plan専用の`POST /upload-release`を追加した。認証UIDを含むrelease rootと上記JSON／WebP pathだけを
許可し、serverが実bytesのSHA-256、byteLength、MIME、形式を再検証する。R2はcreate-onlyかつimmutable cacheで保存し、同じ
metadataの再送だけをidempotent成功とする。responseのexact receiptはC-C-C-0 sealと同じ6項目で、file format schemaは変更しない。
既存画像用`/upload`、Press、実R2、Firestore、Works、公開Viewerには未接続である。
9A-6C-C-C-1Bでは、plan内canonical JSONとcallerが解決したexact WebP Blobをclient側でbyteLength／SHA-256へ再照合してから、
全fileをrelease endpointへ逐次送信する。responseとreceiptのfield集合・値を厳密に検査し、完全集合が揃った場合だけpure sealを返す。
partial receiptはfile skipやmetadata生成に使用せず、retryでは完全planを再送してendpointのidempotent HEAD検証を通す。このclient
transportもfile format schemaを変更せず、Press、実R2、Firestore、Works、公開Viewerには未接続である。
9A-6C-C-C-1C-Aでは、Press planning内のassembly asset descriptorとsession内sealed WebP Blobをlanguage／block／page単位で
exactly oneに結び付け、実bytesの構造、寸法、byteLength、SHA-256を再検証してHorizon planのimage fileへ渡すdry-run handoffを
追加した。保存済みJSON、ZIP entry、Firestore fieldは増やさず、file format schemaを変更しない。
9A-6C-C-C-1C-Bでは、そのnetwork-idle resultをPressへread-only表示する。runtime release IDと状態表示はDSP／DSF／ZIPへ保存せず、
配信file set、canonical JSON、asset path、format schemaを変更しない。

---

## 2. ZIPコンテナ構造とポータビリティ
このフォーマットは**特定のサーバーシステム（FirebaseやAWS等）には一切依存しません。**
画像などのメディアは`assets/`、固定テキストが使うfontは`fonts/`として、**ダウンロード用ZIP内に必要な実体をすべて含みます。** これにより、ネットワーク接続がないオフライン環境であっても、使用された描画capabilityに対応するリーダーがあればファイル単体で完全に描画できる「ポータブル」なフォーマットとなります。Viewerコード自体はZIPに同梱しません。エクスポート時に画像またはfontの実bytesを確定できない場合は、URLだけを残して続行せず、書き出し全体を失敗として扱います。

どちらのファイルも、ZIP展開すると以下のようなファイル・ディレクトリ構造を持ちます。

```text
filename.dsf / filename.dsp
 ├── mimetype                // 必須: ファイル形式を定義する識別子（非圧縮配置を推奨）
 ├── manifest.json           // アーカイブ内の全ファイル一覧とそのハッシュ等
 ├── meta.json               // 作品のメタデータ（タイトル、作者、バージョン、言語構成など）
 ├── project.json            // [DSPのみ] エディタが復元するための状態（state）の完全なダンプ
 ├── content.json            // [DSFのみ] リーダー向けページindex（v1はページ列、v2は言語manifest index）
 ├── content/                // [DSF v2] 言語別の固定ページ列
 │    ├── ja.json
 │    └── en.json
 ├── fonts/                  // [DSF v2 download] 使用する固定テキスト用WOFF2（必須同梱）
 └── assets/                 // メディアファイル格納庫
      ├── images/            // DSF: 閲覧用最適化済み画像
      ├── originals/         // DSP: 編集用オリジナル高解像度画像
      └── thumbs/            // DSP: エディタ表示用サムネイル画像
```

**メタデータの分担**: アーカイブ整合性・ファイル一覧は主に **`manifest.json`**、作品タイトル・言語リスト・表示系のルート設定は **`meta.json`** が担う。DSF v1では **`content.json`** がフラットなWebPページ列、v2では小さな言語indexとなり、実ページ列は **`content/{language}.json`** が担う。**レーティング**など表示に影響しない出版メタは、解釈不能なら無視できる拡張キーとして追加する。

---

## 3. 各ファイルの仕様（JSON スキーマ案）

### `mimetype`
ファイルの先頭に非圧縮で配置するテキストファイル（ePub仕様を参考）。
*   `.dsp` の場合: `application/vnd.dsf.project+zip`
*   `.dsf` の場合: `application/vnd.dsf.content+zip`

### `manifest.json`

DSF archive manifest schema v1は、アーカイブpayloadのpath、MIME type、byteLength、SHA-256を列挙する。

```json
{
  "schemaVersion": 1,
  "format": "dsf-archive-manifest-1",
  "rootContent": "content.json",
  "self": {
    "path": "manifest.json",
    "integrity": "external-inventory"
  },
  "files": [
    {
      "path": "content.json",
      "mimeType": "application/json",
      "byteLength": 1234,
      "sha256": "..."
    }
  ],
  "fileCount": 1,
  "payloadByteLength": 1234
}
```

`files[]`は`manifest.json`自身以外の全payloadを列挙する。manifestが自分自身のhashを内部に含めると内容とhashが
再帰して確定できないためである。archiveの外側inventoryまたは配信metadataが`manifest.json`自身のSHA-256を保持する。
pathは相対pathだけを許可し、空segment、`.`、`..`、backslash、先頭slash、重複pathを拒否する。
9A-4Cはこのmanifestと外側inventoryを作るだけで、ZIP entryへはまだ変換しない。

### ZIP entry contract（9A-4D）

- 9A-4C inventoryの順序をそのままentry順にし、`mimetype`を先頭に置く。
- `mimetype`と既に圧縮済みのWOFF2 fontはSTORE、その他はDEFLATE level 9とする。
- entry日時は`1980-01-01T00:00:00Z`、platformはDOS、`streamFiles:false`に固定する。
- directory entry、暗号化、data descriptor、unsafe path、case-insensitive path衝突を認めない。
- 生成後にCRC検証付きで再展開し、local headerと全entryのpath、byteLength、SHA-256をinventoryへ照合する。

この固定は同じ入力から同じbyte列を再現し、archive hashを安定させるためのlocal package契約である。
9A-4D時点では生成Blobをdownload、upload、公開配信しない。

### `meta.json`
プロジェクト全体の基本情報。機能追加時はルートにキーを追加し、解釈できないキーは無視する仕組みで拡張性を担保。

```json
{
  "version": "1.0.0",               // フォーマットのバージョン
  "schemaVersion": 1,               // DSF v1／Fixed DSPは1、DSF hybrid v2／Project v6 DSPは2
  "projectVersion": 5,              // DSPのみ。Project authoring version
  "projectId": "proj_abc123",       // 編集単位のID（存在する場合）
  "workId": "work_abc123",          // 読者向けに不変の作品ID（存在する場合）
  "releaseId": "rel_abc123",        // 発行物のID（DSFの場合。DSPでは null/空文字可）
  "title": "作品タイトル",
  "author": "作者名",
  "labelName": "レーベル名",
  "rating": "all",
  "license": "all-rights-reserved",
  "meta": {
    "ja": {
      "title": "作品タイトル",
      "author": "作者名",
      "description": "作品の概要",
      "linerNotes": "ライナーノーツ本文。リンクは {{公式サイト|https://example.com}} のように記述",
      "copyright": "© 2026 作者名"
    }
  },
  "linerNotes": {
    "ja": "ライナーノーツ本文。リンクは {{公式サイト|https://example.com}} のように記述"
  },
  "languages": ["ja", "en", "zh"],  // 収録されている言語コード
  "defaultLang": "ja",
  "created": "2026-02-21T12:00:00Z",
  "modified": "2026-02-21T15:30:00Z",
  "generator": "DSF Studio v1.2",    // 生成したツール
  "presentation": {                 // 表示メタ（アプリは `js/page-geometry.js` と同期して書き出す）
    "orientation": "portrait",      // "portrait" (縦), "landscape" (16:9等の横)
    "aspectRatio": "9:16",          // 基準アスペクト比（正規表記）
    "spread": "auto",                // 見開き設定: "none" (単体), "auto" (画面幅で見開き)
    "canonicalLogicalWidth": 360,   // 論理ページ幅（実装定数と一致）
    "canonicalLogicalHeight": 640   // 論理ページ高さ（実装定数と一致）
  }
}
```

### `project.json` (DSP ファイル専用)
現在の `state.js` が保持しているデータをシリアライズした完全なダンプ。

Fixed-onlyのlegacy DSPは`meta.json.schemaVersion: 1`／Project v5を維持する。Flow Groupを含むDSPは
`meta.json.schemaVersion: 2`、`projectVersion: 6`、`project.json.version: 6`を必須とする。
schema v1/v2は読込可能だが、未知のfuture schemaは本文欠落を避けるため停止する。

```json
{
  "version": 6,
  "projectId": "local_abc123",
  "workId": "work_abc123",
  "releaseId": null,
  "languageConfigs": {
    "ja": { "writingMode": "vertical-rl", "fontPreset": "mincho" },
    "en": { "writingMode": "horizontal-tb", "fontPreset": "sans" }
  },
  "uiPrefs": { "desktop": { "thumbColumns": 4 } },
  "languages": ["ja", "en"],
  "defaultLang": "ja",
  "sections": [ /* state.sections の配列（オリジナル画像への相対パスを含む） */ ],
  "blocks": [ /* Fixed Blockとkind:'flow' Flow Groupの順序付きauthoring spine */ ],
  "pages": [ /* state.pages の配列 */ ]
}
```

Project v6の`blocks[].flow.document`がsemantic source、`flow.layout`がFlowLayout正本である。
任意の`blocks[].flow.translationState` v1は、言語別翻訳が対応する原文をBlock／Section title単位の短い
fingerprintで記録するauthoring metadataである。本文は従来どおり`document.sections[].blocks[].texts`／
`sections[].title`だけに保存し、translationStateへ原文・翻訳文を複製しない。provider／model／接続先、
翻訳job、進捗、error、cancel状態も収録しない。

translationStateはProject v6 DSPの任意拡張なので、`meta.json.schemaVersion:2`、`project.json.version:6`、
FlowDocument v1、FlowLayout v1は変更しない。translationState自身が`schemaVersion:1`を持つ。stateがない
8B-1以前の手動翻訳は有効な`untracked`本文として読み込み、暗黙生成・暗黙上書きしない。futureまたは不正な
translationState schemaは本文欠落を防ぐためProject validationで停止する。

生成ページ、fragment、pagination checkpoint/cacheは`project.json`へ収録しない。`sections`と`pages`は
Fixed Blockだけの互換投影であり、Flow-only DSPでは空配列となる。本文の完全な復元には必ず`blocks[]`を使う。

DSP importはProject v6全体をvalidationしてからasset Object URLを作成し、stateへdispatchする。
不正なFlow、Project v5へのFlow混入、future Project／FlowDocument／FlowLayout／FlowTranslationStateは
Fixedへfallbackしない。

### `content.json` (DSF ファイル専用)
ブラウザやネイティブリーダーが、最小の計算コストでページを描画するための最適化（フラット化）データ。
*   `sections` や `blocks` という編集用概念を統合・破棄し、純粋な `pages` サブシステムの配列へ変換される。
*   画像の `background` などのパスは、FirebaseのURLからZIP内の `assets/images/xxx.webp` のような相対パスに書き換えて格納する。

#### DSF v1（WebP-only、後方互換）

```json
{
  "projectId": "proj_abc123",
  "workId": "work_abc123",
  "releaseId": "rel_abc123",
  "pages": [
    {
      "pageId": "page-001",
      "type": "image",
      "assets": {
        "image": "assets/images/page1_optimized.webp"
      },
      "style": { "imagePosition": { "x": 0, "y": 0, "scale": 1 } },
      "bubbles": [
        {
          "id": "b-abc",
          "shape": "ellipse",
          "position": { "x": 50, "y": 30 },
          "localizedData": {
             "ja": { "text": "こんにちは", "writingMode": "vertical-rl" },
             "en": { "text": "Hello", "writingMode": "horizontal-tb" }
          }
        }
      ]
    }
  ]
}
```

#### DSF delivery v2（WebP + 固定テキスト）

v2の`content.json`は言語別固定ページ列への小さなindexとする。Flow翻訳は言語ごとにページ数が異なり得るため、
1つの物理ページ配列へ言語variantを押し込まない。

同じReleaseから2種類の配信artifactを作る。Horizonのオンライン閲覧用indexは`source:'registry'`と共有immutable CDN URLを
使用できる。ダウンロード用`.dsf`は、使用fontをすべて`fonts/<sha256>.woff2`へ1回だけ同梱し、indexを
`source:'embedded'`とarchive相対`href`へ書き換える。ダウンロード用indexに外部font URLを残してはならない。

```json
{
  "schemaVersion": 2,
  "layoutModel": "fixed-page-hybrid-1",
  "canonicalPage": { "width": 360, "height": 640, "aspectRatio": "9:16" },
  "defaultLang": "ja",
  "fonts": {
    "dsf-mincho-ja-v1": {
      "family": "DSF Mincho JA",
      "version": "1",
      "source": "registry",
      "href": "https://fonts.example/dsf-mincho-ja-v1.woff2",
      "sha256": "..."
    }
  },
  "languages": {
    "ja": { "href": "content/ja.json", "pageCount": 128, "pageDirection": "rtl", "sha256": "..." },
    "en": { "href": "content/en.json", "pageCount": 143, "pageDirection": "ltr", "sha256": "..." }
  }
}
```

ダウンロード用`.dsf`では、上のfont宣言だけが次の形へ変わる。family、version、SHA-256、固定ページ座標は同一である。

```json
{
  "family": "DSF Mincho JA",
  "version": "1",
  "source": "embedded",
  "href": "fonts/<full-sha256>.woff2",
  "sha256": "<full-sha256>"
}
```

`content/{language}.json`は`styles`と順序付き`pages[]`を持つ。各pageは必ず
`renderKind:'image'|'fixedText'`のいずれかである。

```json
{
  "schemaVersion": 1,
  "language": "ja",
  "styles": {
    "body": {
      "fontRef": "dsf-mincho-ja-v1",
      "fontSize": 16,
      "fontWeight": 400,
      "lineHeight": 1.8,
      "letterSpacing": 0,
      "color": "#1f2937"
    }
  },
  "pages": [
    {
      "id": "cover-front",
      "renderKind": "image",
      "sourceAnchor": { "kind": "fixed", "blockId": "cover_front" },
      "image": { "href": "../assets/images/cover.webp", "width": 1080, "height": 1920, "mimeType": "image/webp" }
    },
    {
      "id": "flow-story-ja-0001",
      "renderKind": "fixedText",
      "sourceAnchor": {
        "kind": "flow",
        "flowGroupId": "flow_group_story",
        "firstBlockId": "flow_paragraph_1",
        "blockProgress": 0
      },
      "background": { "color": "#fffdf8" },
      "lines": [
        {
          "x": 324,
          "y": 20,
          "width": 16,
          "height": 600,
          "writingMode": "vertical-rl",
          "textOrientation": "mixed",
          "styleRef": "body",
          "runs": [
            {
              "text": "冬の金沢は静かだった。",
              "source": { "blockId": "flow_paragraph_1", "startGrapheme": 0, "endGrapheme": 11 }
            }
          ]
        }
      ]
    }
  ]
}
```

固定テキストの`lines[]`はStudio／Pressで確定済みであり、Viewerは折り返さない。任意HTML／CSSは収録せず、
Viewerはwhitelist済みstyleだけをDOMへ適用し、本文は`textContent`で設定する。フォント、座標、overflow、
未知の必須機能をPressとViewerの両方で検証する。

#### 固定テキストの空白保持（2026-09-01承認）

言語manifestの`styles[styleId]`は任意の`whiteSpaceMode: 'preserve-v1'`を持てる。
DSF delivery v2／言語manifest v1／archive v1の数値versionは変えないが、指定された場合は必須の描画capabilityとする。
旧Viewerは未知style propertyとして描画前に拒否する。無視可能なmetadataではなく、未知mode値も拒否する。

- 指定なしは既存の`nowrap`相当を維持する。本拡張対応の新Flow publicationは明示指定し、旧Fixed／公開済みFlowへ補完しない。
- ASCII space（先頭・連続・末尾）、NBSP、全角空白、TABを元のまま保持する。TABは固定`tab-size: 8`のtab stopを使う。
- LF／CRも`runs[].text`とsource rangeに保持するが、Viewerでは非表示DOM textとして扱い、余計な行／列を生成しない。
  本文を別文字へ変換せず、連結DOM `textContent`と保存文字列を一致させる。
- run参照styleでmodeを省略した場合は行styleのmodeを継承し、明示したmodeが行と不一致なら拒否する。
- 座標と行／列境界はPressが確定し、Viewerで再計測・折返し・リフローしない。
- 新modeのinline進行は`direction:ltr`固定（縦の列送りは右→左）。RTL対応は別の拡張とする。
  新Flowの中央／後端揃えは実測座標に含め、配信styleは`textAlign:start`で二重の整列を防ぐ。
- ZIP保存・再読込でmode、本文、source rangeを維持する。必要なのは対応Viewerであり、font同梱だけで旧Viewer対応にはならない。

詳細は[固定テキスト配信契約](fixed-text-delivery-contract.md#空白保持style-capability2026-09-01承認)を参照する。
ここでは保存・描画契約を定義し、全ケースの実装検証完了を宣言しない。

---

## 4. 将来拡張（上位・下位互換性）の考え方
Excel（`.xlsx`）が Ooxml ベースで新機能（新しいグラフ、新しい関数のセルなど）を追加し続けても、極端に古いExcelで開くと「未定義の要素」として単に無視（またはフォールバック）されるように、以下のアプローチをとります。

1.  **未知データの扱い**: 表示に影響しない未知metadataは無視できる。一方、配信の未知style／必須描画capabilityは数値schemaVersionが既知でも拒否し、誤描画を避ける。authoring内容や順序に影響する未知Blockはround-tripのため保持し、対応できないEditorは編集保存を停止する。未知のFlow semantic Blockも保持したうえでvalidation／paginationを停止し、本文を黙って欠落させない。
2.  **`fallback` プロパティの推奨**: 新しい機能（例：動画背景 `type: "video"`）を追加した場合、ビューアが非対応なら代替表示ができるよう、`fallback_image` のようなプロパティを標準化する。
3.  **`schemaVersion` によるマイグレーション**: スキーマが根本的に変わる場合（例：旧来は配列だったものがオブジェクトのMapになる等）は、`schemaVersion` をインクリメントし、アプリ側で旧データを新データ構造にオンザフライで変換するマイグレーション関数を通してから読み込む (`syncModelsFromLegacy` 関数などの拡張)。
