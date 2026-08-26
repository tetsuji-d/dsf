# DSF 固定テキスト配信契約

ステータス: 9A-6C-C-C-1C-Bでnetwork-idle Horizon handoffをPressの既存ローカル配信設計表示へread-only接続した。Horizonは共有CDN、ダウンロード`.dsf`は使用font必須同梱とするartifact分離を維持する。実token／endpoint／R2、Firestore、公開Viewer runtimeは未接続で、Flow発行ボタンも無効のままである。
active branchのslider previewは対応済み。別branchの未統合full minimapへの接続は行っていない。

最終更新: 2026-08-26

## 1. プロダクト原則

DSFは、Webでデジタル冊子を低コストかつ大量の読者へ配信するための固定レイアウト出版形式である。
著作者が確定したレイアウト自体をコンテンツとして扱う。

- グラフィック／写真ページは最適化済みWebPで配信する。
- テキスト中心ページは、転送容量を抑え、拡大時の文字品質を保つため、固定座標の実テキストとして配信できる。
- 両者は同じ正規`360×640`論理ページとページ送りUIを使う。
- Viewerは端末サイズ、画面サイズ、向き、読者設定に応じた再改行、再ページ化、本文リフローを行わない。
- Viewerは本文文字サイズのカスタマイズ機能を提供しない。Zoomはページ全体を一様に拡大縮小する。
- ページ分割と行／縦書き列の組版はStudio／Pressが所有し、Viewerは公開済み固定projectionだけを描画する。

これはEPUB型のリフロー形式ではない。`fixedText`は「著作者が決めた固定ページ内の高品質な実テキスト」であり、
responsive text layoutではない。

## 2. Authoringと配信の所有境界

```text
DSP authoring source
  Fixed text source | FlowDocument semantic source | graphic layers
                         |
                         v
Studio / Pressでpaginationと組版を確定
                         |
                         v
DSF release projection
  image page (WebP) | fixedText page (固定座標の文字行／列)
                         |
                         v
Viewer fixed page renderer
  <img>              | 公開座標に置くDOM text
```

- Fixed authoring dataは既存Fixed Block modelに保持する。
- Flow authoring dataは`FlowDocument`に保持し、生成ページをProject state、DSP、owner authoring documentへ書き戻さない。
- Pressはimmutable release生成時だけ、Flow生成ページにrelease内IDを付けられる。これはauthoring page IDではない。
- DSF releaseには完全なFlowDocument、pagination cache、翻訳job状態、Undo／Redo履歴を収録しない。

## 3. 配信versionと後方互換

hybrid配信契約はDSF delivery schema v2とする。

- DSF v1: 既存`dsfPages[]`によるWebP-only release。Viewer supportを維持する。
- DSF v2: `image`と`fixedText`を含む言語別固定ページ列。
- v2を解釈できない古いViewerはunsupportedとして停止し、テキストページを黙って欠落させない。
- 全テキストページのfull-page WebP fallbackは必須にしない。必須にすると容量削減の目的を失う。
- 使用フォント、効果、組版が固定テキスト検証を満たさない特定ページは、Press判断を明示して`image` WebPとして発行できる。

`bodyKind:'text'`、legacy `normal_text`、Flow semantic Blocksはauthoring／互換概念である。
v2配信ページの判別子は`renderKind:'image'|'fixedText'`とする。

## 4. 低コストWeb配信topology

Firestoreは公開状態とRelease metadataを解決する面とし、ページpayloadはimmutableなR2／CDN assetとする。

```text
public_projects / release metadata
  dsfSchemaVersion
  dsfContentUrl  ----------------------+
  languages / pageCounts               |
                                       v
R2 release path                     content.json
  users/{uid}/dsf/{workId}/{releaseId}/
    content.json                    小さな言語index
    content/ja.json                 日本語の固定ページ列
    content/en.json                 英語の固定ページ列
    assets/images/*.webp            遅延読込するグラフィックasset
```

要件:

- ViewerはページごとのFirestore readを行わない。
- `content.json`と言語manifestは`releaseId`ごとにimmutableとし、CDNで長期cacheする。
- Viewerは小さなindexと選択言語manifestを読み、WebPは現在ページ周辺だけ遅延読込する。
- 長編のテキストページを1ページ1JSON requestにせず、言語manifestにまとめてrequest数とR2 operation costを抑える。
- 極端に長い作品の初回表示をbenchmarkし、必要なら言語manifestを連続page chunkへ拡張する。ページschemaは変えない。
- 再発行は新しい`releaseId`を作り、公開済みassetを上書きしない。
- 相対URLは`dsfContentUrl`をbaseに解決し、R2配信と展開済み`.dsf` ZIPで同じ契約を使う。

Firestoreのv2 Release metadataは次の最小projectionとする。

```json
{
  "dsfSchemaVersion": 2,
  "dsfContentUrl": "https://media.example/.../content.json",
  "dsfContentHash": "sha256-...",
  "dsfLangs": ["ja", "en"],
  "dsfPageCounts": { "ja": 128, "en": 143 },
  "dsfTotalBytes": 1234567
}
```

既存`dsfPages[]`はv1 WebP互換fieldとして維持する。長編v2本文をFirestoreへinline保存する用途には使わない。

## 5. Package index

DSF v2 `content.json`は小さなindexとする。Flow翻訳は言語ごとにページ数が変わるため、ページ列を言語別に分離する。

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
    "ja": {
      "href": "content/ja.json",
      "pageCount": 128,
      "sha256": "...",
      "pageDirection": "rtl"
    },
    "en": {
      "href": "content/en.json",
      "pageCount": 143,
      "sha256": "...",
      "pageDirection": "ltr"
    }
  }
}
```

- 保存済み言語keyは完全一致で使い、`en-us`を`en-US`へ暗黙変換しない。
- `pageDirection`はナビゲーション属性であり、本文リフローを起こさない。
- 初期のtext-safe fontは、安定したmetricsと適切なlicenseを持つversion固定のDSF認定Web fontに限定する。
- Horizonのオンライン閲覧は共有immutable font URLを使い、複数作品でbrowser cacheを共有する。
- ダウンロード用`.dsf`は、使用する埋込許可済みWOFF2を同じSHA-256ごとに1回だけ必須同梱する。font宣言は
  `source:'embedded'`と`fonts/<sha256>.woff2`へ書き換え、CDNや端末fontへ依存しない。
- 必須fontを読めない場合、Viewerはrender errorを表示する。device fontへ黙って差し替えて同一レイアウトと扱わない。

## 6. 言語manifestとpage union

各言語manifestは順序付きの固定ページ列を持つ。

```json
{
  "schemaVersion": 1,
  "language": "ja",
  "styles": {
    "body": {
      "fontRef": "dsf-mincho-ja-v1",
      "fontSize": 16,
      "fontWeight": 400,
      "fontStyle": "normal",
      "lineHeight": 1.8,
      "letterSpacing": 0,
      "color": "#1f2937",
      "textDecoration": "none"
    }
  },
  "pages": []
}
```

page union:

```ts
type DeliveryPage = ImagePage | FixedTextPage;

type DeliveryPageBase = {
  id: string;                 // release内delivery ID
  renderKind: 'image' | 'fixedText';
  sourceAnchor: FixedSourceAnchor | FlowSourceAnchor;
  pageLabel?: string;
};
```

画像ページは現在の最適化済みWebP経路を使う。

```json
{
  "id": "fixed-cover-front",
  "renderKind": "image",
  "sourceAnchor": { "kind": "fixed", "blockId": "cover_front" },
  "image": {
    "href": "../assets/images/cover_ja.webp",
    "width": 1080,
    "height": 1920,
    "mimeType": "image/webp"
  }
}
```

固定テキストページは、すでに組版された折返し禁止の横書き行／縦書き列を持つ。

```json
{
  "id": "flow-story-ja-0001",
  "renderKind": "fixedText",
  "sourceAnchor": {
    "kind": "flow",
    "flowGroupId": "flow_group_story",
    "sectionId": "flow_section_1",
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
          "source": {
            "blockId": "flow_paragraph_1",
            "startGrapheme": 0,
            "endGrapheme": 11
          }
        }
      ]
    }
  ]
}
```

### 固定テキストinvariant

- `lines[]`は座標にかかわらず論理的な読書順で並べる。
- 各横書き行／縦書き列は正規論理座標の明示的bounding boxを持つ。
- Viewer内では折り返さない。Studio／Pressが発行前に分割する。
- `runs[]`はwhitelist済み別styleを参照してinline markを表現できる。raw HTMLと任意CSSは禁止する。
- Viewerは本文をDOM `textContent`で設定し、DSF文字列をtrusted HTMLとして挿入しない。
- 全座標とstyle値をDOM生成前に有限範囲として検証する。
- Viewerは現在ページと周辺だけをDOM化し、数百ページ分のnodeを同時に保持しない。
- `fixedText`は共有背景WebPを1つ参照できる。自由配置graphic layerと未対応効果は`image`へflattenする。

初期精度は行／列単位の固定座標とする。将来glyph位置、ruby等を追加してもno-reflow原則を変えない。

## 7. レイアウト一致とfont契約

過去のテキストViewerはsource textをViewer内で再composeしていた。v2は境界をより厳格にする。

- Studio／Pressがpage boundaryと正確な行／列breakを生成する。
- Editor preview、Press validation、v2 serializationは同じ共有projection codeを使う。
- ViewerはFlow paginationや`composeText()`を呼ばず、page boundary決定のためのtext measurementを行わない。
- Viewerは参照fontが読み込まれるまで固定テキストページを表示しない。
- 正規ページをviewportへ一様scaleする。pinch／control zoomもページ全体をscaleし、本文font sizeだけを変えない。
- publication validationはoverflow、font欠落、未知style、未対応writing mode、非有限座標、未知の必須機能を拒否する。
- browser acceptanceは現行ChromiumとSafari／iOSで、日本語横書き、日本語縦書き、Latin text、長編Flow作品を確認する。

### 本番認定font registry（9A-3C）

`js/dsf-font-registry.js`を本番認定fontのpure契約とする。registry entryには、version固定の直接HTTPS WOFF2 URL、
実WOFF2 bytesのSHA-256、byte length、immutable宣言、license／権利確認者と確認日、Web配信可否、portable embedding可否、
対応する完全一致language key／writing mode／weight／styleを要求する。CSS URL、query／fragment付きURL、localhost／fixture host、
権利未確認、推測hashは拒否する。

9A-3C時点の`DSF_PRODUCTION_FONT_REGISTRY`は**意図的に空**である。配信権、実WOFF2 asset、実bytes hashを
人間が確認したfontがまだないためであり、test用のsynthetic fontやdevelopment preview fixtureを本番認定として登録しない。
したがって9A-3C時点の本番preflightでは既存Fixed textも`FONT_NOT_CERTIFIED`として安全なWebP経路を維持する。

## 8. 言語ごとにページ数が違う場合

Fixed pageとFlow Blockは言語別ページ列の間でsource anchorを共有する。

- Fixed page: `sourceAnchor.blockId`で対応付ける。
- Flow page: `flowGroupId`と表示中`blockId`を優先し、同じBlockが複数ページへ続く場合は`blockProgress`を使う。
- 対応anchorがなければ、作品全体の正規化済み読書進捗をfallbackにする。
- 言語切替後のページ番号と総ページ数は対象言語列から再計算する。
- 言語間で同じページ数を要求しない。手動PageBreak位置はFlow semantic structureを通じて共有する。

## 9. Viewer描画契約

Viewerはpageごとにrendererを1つだけ選ぶ。

```text
renderKind=image      -> 既存WebP image renderer
renderKind=fixedText  -> fixed text DOM renderer
unknown renderKind    -> 明示的unsupported-page error
```

fixed text rendererは次の順で処理する。

1. pageとstyle参照をvalidationする。
2. 宣言されたversionのfontをloadする。
3. clippingされた`360×640` page surfaceを作る。
4. 絶対座標、折返し禁止の行／列elementを論理読書順で作る。
5. whitelist済みtypography propertyだけを適用する。
6. 既存のページ送り、見開き、zoom、minimap、bookmark、metricsを使う。

Viewerに編集、本文文字サイズ変更、device-width reflow、pagination APIを公開しない。

## 10. Pressのpage方式選択

| Source page | 配信結果 |
|-------------|----------|
| Graphic／photo／layer composition | `image` WebP |
| DSF認定typographyを使う既存Fixed text | `fixedText` |
| DSF認定typographyを使うFlow generated page | `fixedText` |
| 未対応font／効果を持つtext page | 理由を明示して`image` WebP |

隠れたbest-effort Viewer fallbackではなく、決定的なcapability validationで選ぶ。Pressは発行前に選択結果と
推定Release容量を表示する。

9A-3Cの`js/dsf-press-preflight.js`は、この選択だけを副作用なしで行う。Fixed graphic pageは`GRAPHIC_PAGE_WEBP`、
未認定font、snapshot欠落、ruby等の未対応表現を持つFixed text pageは理由code付き`image`、認定fontと検証済みsnapshotを
満たすページだけを`FIXED_TEXT_CERTIFIED`とする。WebP fallbackは既存の安全な発行経路があるためpreflight上は公開可能である。
9A-5Cでは、Flow Group IDごとの検証済みprojectionと、現在のauthoring revisionを明示入力できる。Group／Document／言語／
revision、manifest、全page anchor、style fontと本番認定font registryが完全一致する場合だけ`FLOW_FIXED_TEXT_CERTIFIED`とする。
projectionまたは現在revisionの欠落、古いrevision、別言語、未知font、余剰projectionは理由code付きで公開不可にする。
Flowの生成page数や配信位置を推測せず、検証済みprojectionの実page数だけを使用する。現在のPress runtimeはこれらの入力を
渡していないため、実作品のFlow Groupは`FLOW_PUBLICATION_PROJECTION_MISSING`で停止する。

### Pure release assembly（9A-4A）

`js/dsf-release-assembly.js`は、公開可能な言語別preflight結果と、別工程で検証済みのWebP descriptorを受け取り、
次をI/Oなしで組み立てる。

- DSF delivery v2 `content.json`相当のindex
- `content/language-XXXX.json`相当の言語manifestと、その確定JSON
- assemblerが決めた衝突しないWebP asset path
- 言語manifest／content indexの確定UTF-8 bytesに対するSHA-256
- Firestore Release metadataへ将来渡せる言語、ページ数、content hash、合計byte数のpure projection

SHA-256関数はbyte関数として注入し、assemblerが生成した正確なJSON bytesへ適用する。WebPは`href`／`path`を
呼び出し元から受け付けず、hash、byteLength、寸法、`image/webp`だけを検証済みdescriptorとして受け取る。
異なる言語やページで同じfont declarationをdeduplicateし、同名で内容が違うstyle IDは決定的に付け替える。
最終結果は既存`validateDsfDeliveryBundle()`を通過しない限り返さない。

これは完成した`.dsf` ZIPでもR2 uploadでもない。WebP実bytesの検証、Web Crypto adapter、`meta.json`／archive manifest、
R2／Firestoreへの書込み、Press UI、公開Viewer loaderは9A-4Aの対象外である。blocked preflightは受け付けない。

### Release byte sealing（9A-4B）

`js/dsf-release-byte-sealing.js`は、Press等が生成済みの実WebP bytesをcopyして検証し、immutable Blobと
9A-4A互換descriptorを結び付ける。次をfail closedで確認する。

- `RIFF`／`WEBP`署名と、宣言RIFF sizeが実byteLengthへ完全一致すること
- 全chunk header、payload、偶数paddingが入力bytes内に収まること
- VP8 key frame、VP8L header、VP8X canvasから導出した実width／height
- VP8X feature flagとICCP／ALPH／EXIF／XMP chunkの整合
- VP8X canvasとVP8／VP8L primary imageの寸法一致
- 静止画であること。ANIM／ANMFまたはanimation flagを拒否する
- 許可外chunk、重複singleton chunk、複数primary imageを拒否する
- Pressが要求したwidth／height、任意の既知SHA-256との一致

SHA-256はWeb Crypto `subtle.digest('SHA-256', exactBytes)`で計算する。assembler用hash adapterはWebPだけでなく
確定JSON bytesもhashできる。typed array入力はcopyしてからBlob化するため、呼び出し元が元bufferを変更しても
sealed Blobとdescriptorは変わらない。

既存の軽量`isWebPBlob()`、現在のupload、Press render、R2、Firestoreには接続しない。9A-4Bはasset pathを決めず、
uploadも行わない。

### Local release file inventory（9A-4C）

`js/dsf-release-file-inventory.js`は、9A-4Aが確定したJSON／asset planと、9A-4Bがsealedした実WebP Blobを
1対1で再照合し、次の全ファイルをimmutableなメモリ上inventoryとして作る。

- 改行を付けない`mimetype`（`application/vnd.dsf.content+zip`）
- `meta.json` schema v2
- 9A-4Aとbyte単位で同一の`content.json`／言語manifest
- fixedTextを含むダウンロードでは、portable planとbyte単位で同一の`content.json`と、使用fontをdeduplicateした
  `fonts/<sha256>.woff2`
- asset planのpath・寸法・byteLength・SHA-256と一致するsealed WebP
- 上記payloadのpath・MIME・byteLength・SHA-256を列挙する`manifest.json`

言語manifest、画像page、asset plan、sealed Blob、embedded fontの欠落・重複・余剰・対応違いを拒否し、JSON、WebP、
WOFF2は実bytesから再hashする。固定テキストfontが`source:'registry'`のままならダウンロードinventoryを作らない。
`manifest.json`は自分自身のhashを内部に持つと再帰して確定できないため、manifest自身はpayload一覧から除外し、
完全な外側inventoryが`manifest.json`のhashを保持する。`meta.json`の日時は呼び出し元が渡し、module内で現在時刻を生成しない。

これはZIP byte列ではなく、ファイルを並べる前段の確定inventoryである。圧縮方式・ZIP entry metadata・download、
Press UI、R2、Firestore、公開Viewerには接続しない。

### In-memory ZIP packageとround-trip検証（9A-4D）

`js/dsf-release-zip-package.js`は9A-4C inventoryだけを入力にし、既存依存のJSZipで`.dsf` ZIP bytesを
メモリ上に生成する。生成前に全BlobのbyteLength／SHA-256、canonical JSON、archive manifest、summaryを再検証し、
次のZIP契約を固定する。

- entry順は9A-4C inventory順。`mimetype`を必ず先頭に置く
- `mimetype`と既に圧縮済みのWOFF2 fontはSTORE（無圧縮格納）、JSON／WebPはDEFLATE level 9
- 全entryの日時を`1980-01-01T00:00:00Z`、platformをDOS、stream descriptorなしに固定する
- 合成directory entry、暗号化entry、unsafe path、case-insensitive path衝突を許可しない
- ZIP32のfile数／byte上限を越える入力を拒否する

生成直後に同じbytesをCRC検証付きで再展開し、local header、entry順、圧縮方式、日時、path、byteLength、SHA-256を
inventory全件と照合する。照合が完了するまでZIP Blobを返さない。同じinventoryと同じJSZip実装からは同じZIP bytesを得る。

これはlocal-only package moduleである。ファイル名決定、download、Press UI、R2、Firestore、公開Viewer、
既存`exportDSF()`には接続しない。

### Horizon assemblyからportable download planへの変換（9A-6B-B3-A2）

`js/dsf-portable-release.js`はHorizon用assemblyを変更せず、ダウンロード専用assemblyを派生する。production registryと
完全一致し、`allowsPortableEmbedding:true`で、実WOFF2の構造・byteLength・SHA-256検証に成功したfontだけを受け入れる。
使用fontのいずれかが欠落すればpackage全体を停止する。portable `content.json`では全fontを`source:'embedded'`へ変え、
実bytes SHA-256を名前にした`fonts/<sha256>.woff2`へ向ける。同じfontは言語やページをまたいで1回だけ格納する。
9A-4C inventoryと9A-4D ZIPはこのportable planを受け取り、archive manifestとZIP round-tripへfont実bytesも含める。
download UI、R2、Firestore、公開Viewerにはまだ接続しない。

### Pure Flow publication projection（9A-5A）

`js/flow-publication-projection.js`は、semantic FlowDocument、完了済みpagination、認定fontで実測済みの
composition snapshotを副作用なしで照合し、1つのFlow Group／1言語の`fixedText` manifest fragmentへ変換する。
文字数や平均行長から行／列座標を推測しない。

composition snapshotは次を必須とする。

- `status:'complete'`、現在のauthoring `revision`、Flow DOM renderer version
- Flow Group ID、Document ID、完全一致language key、writing mode、canonical page box、Typography
- 本番font registryのfont ID／実bytes SHA-256
- 自動hyphenationを使わないpublication compositionである証明
- 各生成pageの論理読書順の行／列bounding boxと、source grapheme range付きrun

projectionはFlowDocument全Blockをpagination fragmentが欠落・重複なく覆うこと、巨大Paragraphのrangeが連続すること、
semantic `pageBreak`が順序どおり1回ずつ保持されること、snapshot runがpagination rangeと完全一致することを確認する。
行／列は作者指定content box内に収まり、1行がHeadingとParagraphを跨がない。Headingはlevel別styleへ投影し、
本文weightとHeading 700の両方をfont registryが認定している場合だけ成功する。

通常pageのsource anchorは最初のfragmentとblock progressから作る。PageBreakが生む空pageはそのsemantic pageBreakを
anchorにする。anchorを持てない完全な空Documentは公開しない。翻訳不足時に原文を別言語manifestとして発行するfallbackも行わない。

9A-5Aは実測snapshotをDOMから採取しない。Press preflight、9A-4A assembly、ZIP、download、R2、Firestore、
公開Viewerにも接続しない。9A-5A時点は本番registryが空なので、実作品のFlow publicationは引き続き停止する。

### Local Flow publication composition capture（9A-5B）

`js/flow-publication-composition-capture.js`は、1つのFlow Group／完全一致言語／authoring revision／本番font registry IDを
固定したbrowser sessionを作る。sessionは認定fontの本文weightとHeading 700を`FontFaceSet`で明示loadし、
fallback stackを除いた単一font family、`hyphenation:'none'`、canonical page boxでのみページネーションする。

同じsessionが返したpaginationだけをcapture対象とし、別sessionやpreview由来のpaginationは拒否する。各fragmentの
DOM Text nodeをgraphemeごとの`Range.getClientRects()`で測り、論理読書順の行／縦書き列へまとめる。各runには元Block IDと
連続する`startGrapheme`／`endGrapheme`を付け、空Paragraphは実DOM block boundsと空semantic rangeで保持する。
改ページだけの空pageはlineを持たず、paginationのsemantic `manualBreakBefore`を維持する。

capture前後でDOM overflow、author content box逸脱、font family差、hyphenation差、grapheme欠落、1graphemeの複数行跨ぎを
fail closedにする。snapshotはsession内のimmutable runtime結果であり、DSP／DSF／Firestoreへ保存しない。
development-only fixtureでは横書き・縦書き、巨大Paragraph、空Paragraph、PageBreakを実DOMでページ化し、capture直後に
9A-5Aへ渡してsource no-lossを確認する。このfixtureはbuild entryにせず、Press UI、9A-4A assembly、ZIP、download、
R2、Firestore、公開Viewerには接続しない。9A-5B時点は本番registryが空のため、実作品のFlow publication停止は継続する。

### Flow preflight／release assembly統合（9A-5C）

`js/dsf-press-preflight.js`は9A-5Aの成功projectionと現在のauthoring revisionをFlow Group単位で受け取り、
Group／Document／言語／revision／font／anchorを再検証する。成功したFlow decisionはprojectionのpage数を持つが、
従来の`fixedPageIndex`は消費しない。代わりにFixed／Flow／WebPすべての出力開始位置を`deliveryPageIndex`で表し、
後続Blockの作品順を確定する。

`js/dsf-release-assembly.js`はFlow decisionをprojection内の複数`fixedText` pageへ順序どおり展開し、前後のFixed text／WebPと
同じ言語manifestへmergeする。Flow styleも既存Fixed styleと同じ規則でdeduplicateし、全page anchorを再検証する。
言語ごとにFlow page数が異なっても、それぞれのmanifest内で連続した配信page indexを作る。Flowを暗黙にWebPへ変換する経路は
まだ定義せず、`RELEASE_FLOW_IMAGE_UNSUPPORTED`で拒否する。

9A-5C単体はpure data integrationに限り、Flow projection／revisionをPressへ接続しない。後続9A-6Aもdevelopment-onlyの
確認面に限定し、容量見積り、ZIP、download、R2、Firestore、公開Viewerには接続しない。本番registryも空のため、
実作品のFlow publication停止は継続する。

### Development-only Flow Press preflight preview（9A-6A）

`js/flow-press-preflight-preview.js`はdevelopment serverのPress Roomからだけ動的に読み込む。保存済み各言語とFlow Groupを
順に処理し、9A-5Bと同じno-hyphenation実DOM capture、9A-5A projection、9A-5C preflightを1つのruntime revisionで
連結する。候補page数、作品全体のdelivery page数、Group別停止理由を言語ごとにPressへ表示する。

翻訳本文がmissing／staleの場合は原文Flowを別言語の候補として使わず、`FLOW_PUBLICATION_TRANSLATION_NOT_READY`で停止する。
認定条件のfont、writing mode、本文、ページ内geometryを満たさない場合も理由codeを表示する。既定Flowの省略可能なfont設定は、
他のFlow paginationと同じ実効typographyへ解決してから認定font familyと照合する。

この確認で使うregistryはNoto系fontを対象としたsynthetic local fixtureであり、本番証明書ではない。結果はstate、DSP、DSF、
Firestoreへ保存しない。`import.meta.env.DEV`外のbuildへmodule／fixtureを含めず、DSF書き出し、Horizon発行、容量見積りは
Flowを含む間、従来どおり無効にする。

### Production Flow Press preparation gate（9A-6B-A）

`js/flow-press-preflight-preparation.js`は、言語完全一致、Flow実DOM capture、projection、preflightの共通処理を持つ。
font registryとfont resolverをcallerから必須入力にし、development fixtureを直接参照しない。9A-6Aはこの共通処理へ
local fixtureを渡し、`js/flow-press-publication-preparation.js`は空を含む本番registryだけを渡す。

Press Roomはdevelopment／staging／productionのすべてで本番準備ゲートを動的に読み込み、保存言語ごとの合否と停止codeを
表示する。authoring側のCSS familyは、本番registry内でfamilyが完全一致し、該当entryがちょうど1件の場合だけfont IDへ
解決する。未登録は`FONT_NOT_CERTIFIED`、同じfamilyの複数versionは`FONT_FAMILY_AMBIGUOUS`としてfail closedにする。
missing／stale翻訳も原文へ代替しない。

本番registryは権利、実WOFF2、実bytes hashを人間が確認していないため引き続き空である。この状態ではDOM captureを開始せず、
Pressに「本番発行の準備が完了していない」と表示する。Google Fonts stylesheetやsynthetic fixtureを認定assetへ昇格しない。
準備結果、revision、projectionは非永続で、DSF書き出し、Horizon発行、容量見積り、release assembly、ZIP、download、R2、
Firestore、公開Viewerへ渡さない。発行ボタンと`exportDSF`／`publishToCloud`のFlow guardも維持する。

### Production font exact-byte verification／runtime lease（9A-6B-B1／B2）

`js/dsf-font-asset-verification.js`は本番registryの1 entryと、callerが渡した実bytesを照合する。48-byte WOFF2 header、
`wOF2`署名、宣言length、table数、reserved field、圧縮領域、metadata／private data rangeを検査し、registryの
`asset.byteLength`と`declaration.sha256`へ完全一致した場合だけimmutable `font/woff2` Blobを持つruntime evidenceを返す。
SHA-256は9A-4Bと同じWeb Crypto exact-byte関数を再利用する。このpure verifierはfetch、DOM、Press、保存、発行を行わない。

`js/dsf-production-font-runtime.js`はregistryのversion固定HTTPS URLだけをcredentialなし、CORS、redirect拒否で取得する。
response MIME／Content-Lengthが提示された場合はregistryと照合し、その後B1の実bytes検査を必ず通す。検証済みBlobだけから
`DSF Verified <fontId> <hash-prefix>`というsession専用familyの`FontFace`を必要weightごとに作り、`FontFaceSet`へ一時登録する。
元のauthoring／certified familyと別名にするため、Studioが別経路で読み込んだGoogle Fontsや端末fontを誤って計測しない。
lease終了時は登録faceを必ず削除する。

`flow-publication-composition-capture.js`はpublication snapshotには認定familyを保持しながら、DOM pagination／Range実測だけを
verified runtime familyで行える。`flow-press-publication-preparation.js`は本番font family解決後、B2 lease作成に成功した場合だけ
captureへ進む。hash／length／WOFF2／browser parseのいずれかが不一致なら理由code付きで停止し、projectionを生成しない。
9A-6B-B1／B2時点は本番registryが空なので、Pressはnetwork requestもFontFace登録も開始せず`FONT_NOT_CERTIFIED`で停止する。

### First production registry activation（9A-6B-B3-C）

production R2のremote exact bytes、MIME、CORS、immutable cache、OFL notice、Architect reviewを確認したNoto Sans JP
2.004-H2とNoto Serif JP 2.003-H1だけを、候補projection gate経由でactive registryへ登録する。Flow Press既定経路で
両書体の横書き／縦書き、本文400／見出し700、巨大Paragraph、PageBreakを実測し、4ケースとも4ページのprojectionが
`ready`、issue 0件、font SHA-256一致となった。終了後のverified FontFaceとcapture DOMは0件へ戻す。

このactivationは本番準備ゲートを通過可能にするが、Flow発行ボタン、容量見積り、release assembly、ZIP、upload、
Firestore、公開Viewer runtimeを有効化しない。

### Flow Press local release planning（9A-6C-A）

成功した本番Flow準備結果、選択言語、page direction、Pressが生成・byte sealingしたFixed pageの実WebP descriptorを、
`js/flow-press-local-release-planning.js`が既存DSF v2 release assemblyへin-memoryで渡す。Flowの暗黙WebP fallback、
未準備言語、欠けた画像descriptorは従来どおり拒否する。

`js/dsf-portable-release-estimate.js`はHorizon用assemblyのregistry font declarationをportable用embedded declarationへ
書き換えた確定index byte数と、active registryが証明する使用font byte数を加算する。PressはWebP／fixedText件数、
Horizon payload、portable payload、同梱font容量をread-only表示する。これはZIP container overheadを含まないpayload見積りであり、
font fetch、ZIP生成、download、upload、発行は行わない。結果はruntime-onlyで、Flow発行guardを維持する。

### Flow Press exact local portable package（9A-6C-B）

`js/flow-press-local-release-package.js`は9A-6C-Aが成功した同じPress sessionのsealed WebPを受け取り、使用fontだけを
active registry URLから`credentials: 'omit'`、redirect拒否で取得する。WOFF2 responseのstatus／MIME／lengthと実bytesの
header／byteLength／SHA-256をregistryへ完全照合し、既存portable planner、complete file inventory、deterministic ZIP builderへ渡す。

ZIP完成後は全entryを再展開し、inventoryのpath／byteLength／SHA-256と一致した場合だけ`roundTripVerified`とする。Pressは
ローカル検証用`.dsf`の実測ZIP容量、展開時容量、entry数、SHA-256をread-only表示し、9A-6C-Aのpayload見積りと区別する。
ZIP Blob、取得WOFF2、inventory、検証結果はsession runtimeだけに保持し、入力変更、Press離脱、失敗時に破棄する。
download、upload、Firestore、Horizon発行、公開Viewerには接続せず、Flow発行guardを維持する。

### Verified Flow portable download handoff（9A-6C-C-A）

`js/flow-press-portable-download.js`は9A-6C-B結果からdownload用のread-only artifactを作る。package version／kind／ready、
round-trip結果、ZIP format／MIME、Blob size、byteLength、SHA-256、現在のpackage signatureを同期検証し、1つでも不一致なら
artifactを返さない。このmodule自体は`saveAs`、DOM、state、Firestore、uploadへ依存しない。

`js/export.js`はFlow作品の場合だけPressからこのartifactを取得し、既存WebP-only ZIPを再生成せず同じBlobをローカル保存する。
作品タイトルからOS禁止文字・予約名・長さを安全化した`.dsf`名を使い、保存直前にartifactを再取得してpackage signature、
Blob identity、size、SHA-256が変わっていない場合だけ`saveAs`する。
Pressは検証完了時だけFlow用DSF書き出しを有効にし、入力変更、検証待ち／失敗、離脱時は無効化する。Horizonボタンは常に停止する。

未保存guestの`workId`／`releaseId`はlocal preview用placeholderであり、Horizon Release IDとして使用しない。downloadしたv2
portable `.dsf`はfontを同梱する。公開Viewerのv2 release loadは後続単位で行う。

### Portable v2 local Viewer acceptance（9A-6C-C-B）

`js/dsf-local-viewer-package.js`は、ローカルで選択した`.dsf`／`.zip`がv2 packageの場合だけ専用loaderとして動作する。
CRC付きZIP展開、canonical JSON、manifestの完全entry集合、entry path／case衝突、MIME、byteLength、SHA-256、payload集計を
照合する。embedded fontはactive production registryのfamily／version／font ID／hash／portable embedding権と一致し、
WOFF2構造と実bytes検査を通った場合だけsession固有familyへ登録する。画像は言語manifestから参照されるentryだけを静止WebP、
codec寸法、declared寸法、hashへ照合してobject URL化する。外部fontやdevice fontへの暗黙fallback、欠落entryの読み飛ばし、
部分表示は行わない。

検証済みpackageは全言語の`fixedText` context、言語別page列、画像URL mapをruntime sessionとして保持する。Viewerの言語切替は
同じpackage内の言語manifestとanchor mappingを使い、既存page slider／固定ページ描画へ渡す。session固有FontFaceとobject URLは
別ファイル読込またはunload時に必ず破棄する。v2でないZIPは従来のv1 parserへ返し、`.dsp`／JSON読込も変更しない。

この単位はローカルファイルViewerだけを対象とする。公開／共有URL、Horizon artifact upload、Firestore Release、Release metadata、
CDN font経路は未接続である。Viewerは`fixedText`を端末幅で再組版せず、作者がPressで確定した正規`360×640`座標を既存の
canonical page surfaceで一様に拡大縮小する。

### Horizon v2 release／public Viewer transport contract（9A-6C-C-C-0）

`js/dsf-horizon-release-contract.js`は、verified v2 assemblyを次のimmutable rootへ投影するpure planである。

```text
users/{uid}/dsf/{workId}/{releaseId}/
  content.json
  content/language-0001.json
  content/language-0002.json
  assets/images/language-0001/page-00001.webp
```

Horizonはactive production registryの共有immutable CDN WOFF2を使い、作品ごとのrelease rootへfontを複製しない。
assemblyのfont declarationはregistry証明と完全一致し、Web配信権が確認済みでなければplanを作らない。固定テキスト背景画像は
現時点のassemblyに独立asset planがないため、暗黙に公開せず理由code付きで停止する。

Horizon publishは二段階とする。

1. `createDsfHorizonReleasePlan`がcanonical JSON／言語manifest／sealed WebPのstorage path、public URL、MIME、byteLength、
   SHA-256、`public, max-age=31536000, immutable`を確定する。この時点ではFirestoreへ書けるlocatorを返さない。
2. upload側が全fileの同じ値をreceiptとして返し、`sealDsfHorizonReleasePlan`が完全file集合を照合する。missing、duplicate、
   hash／size／URL／cache policy不一致が1つでもあればRelease metadataを生成しない。
3. seal成功後だけ既存の`dsfSchemaVersion`、`dsfContentUrl`、`dsfContentHash`、`dsfLangs`、`dsfPageCounts`、
   `dsfTotalBytes`をReleaseと`public_projects`へ投影できる。

JSON integrityはFirestoreの`dsfContentHash`から`content.json`、その言語descriptorのSHA-256から言語manifestへ連鎖する。
WebPはPressでsealed済みのexact bytesをupload receiptで確認してrelease固有immutable pathへ置く。低コスト大量閲覧のため、
各読者が全画像を再hashする契約にはしない。公開Viewerは遅延取得時にWebP decodeとdeclared寸法を確認する。

`selectDsfPublicReleaseTransport`は公開読込の優先順位を次のように固定する。

- `dsfSchemaVersion===2`: allowed HTTPS origin、identityを含むexact immutable path、hash、言語、page countを検証してv2を選ぶ。
- schema未指定またはv1で、v2 locator fieldがなく`dsfPages`がある: 既存WebP-only v1を選ぶ。
- schema v2が不正、未知version、またはv2 fieldが部分的: fail closed。staleな`dsfPages`へfallbackしない。

このpure契約は`publishToCloud`、`/upload`、Works、Viewer、Firestore、R2へimportしない。既存`/upload`はauthoring画像用として
URLだけを返す従来契約を維持する。

### Horizon v2 release upload endpoint（9A-6C-C-C-1A）

`functions/upload-release.js`は、上記planの1 fileだけを受け付ける`POST /upload-release`である。既存画像用`POST /upload`とは
routeも検証契約も分離し、PressやViewerからはまだ呼ばない。受理するpathは認証済みFirebase UIDと一致する次の3形式だけである。

```text
users/{uid}/dsf/{workId}/{releaseId}/content.json
users/{uid}/dsf/{workId}/{releaseId}/content/language-0001.json
users/{uid}/dsf/{workId}/{releaseId}/assets/images/language-0001/page-00001.webp
```

clientは`file`、`path`、`mimeType`、`byteLength`、`sha256`をmultipartで送る。serverは安全なID／path、JSONまたはWebPの
MIME、実byteLength、実bytesから計算したSHA-256、JSON objectまたはWebP signatureを照合してからR2へ書く。JSONは32 MiB、
WebPは64 MiBをendpoint上限とする。R2書込みは`If-None-Match: *`、`public, max-age=31536000, immutable`、検証済みhash／sizeの
custom metadataを使い、既存objectを上書きしない。

同じpathがすでに存在する場合は、size、MIME、cache policy、serverが保存したhash metadataがすべて一致するときだけ
idempotent retryとして成功する。1項目でも異なれば`409 IMMUTABLE_COLLISION`で停止する。conditional writeの競合時も再度HEADし、
同じ内容だけを成功扱いにする。成功responseは`receipt`にstorage path、public URL、MIME、byteLength、SHA-256、cache policyの
6項目だけを返し、plan sealへそのまま渡せる。`reused`はreceipt外のtransport情報である。

この単位のR2挙動はin-memory mockだけで検証する。Press接続、client upload loop、実R2 traffic、Firestore metadata write、
公開Viewer fetch、deployは行わない。

### Horizon v2 release upload client transport（9A-6C-C-C-1B）

`js/dsf-horizon-release-upload.js`は、C-C-C-0のverified planを順番どおり`POST /upload-release`へ送るbrowser-side transportである。
JSONはplan内のcanonical stringからBlobを作り、WebPはcallerがfile descriptorに対応するexact Blobを解決する。各fileは送信前に
MIME、byteLength、SHA-256をplanへ再照合し、Firebase access tokenはrequestごとにproviderから取得する。module自体はFirebase、
Press、Firestore、Viewerをimportしない。

responseはHTTP 200かつ`application/json`で、top-levelが`receipt`と`reused`だけ、receiptがstorage path、public URL、MIME、
byteLength、SHA-256、cache policyの6項目だけでなければ失敗する。1fileでもHTTP失敗、通信失敗、token欠落、abort、Blob不一致、
receipt改ざんがあれば直ちに後続fileを止め、partial receiptは診断用errorにだけ保持し、publishable sealを返さない。全fileのreceiptが
一致した場合だけ既存`sealDsfHorizonReleasePlan`を実行し、`readyForMetadataWrite:true`の結果を返す。

transportは安全性とfile単位のmemory上限を優先して逐次送信する。失敗後は同じ完全planを再実行し、1A endpointが既存の同一objectを
`reused:true`として再検証する。partial receiptを信用してfileをskipしないため、管理操作等でobjectが失われた場合にもstale receiptだけで
sealしない。この単位はmock fetchだけで検証し、Press UI、実token、実endpoint／R2、Firestore、公開Viewer、deployへ接続しない。

### PressからHorizonへのdry-run handoff（9A-6C-C-C-1C-A）

`js/flow-press-horizon-release-handoff.js`は、Press session内の成功したlocal release planningとsealed WebP集合を受け取り、
Horizon identity／public originを加えたimmutable file planへ投影する。assembly imageのlanguage、block ID、page indexごとにsealed assetが
exactly one存在することを要求し、欠落、重複、未計画asset、descriptor不一致を通信前に停止する。

各WebP Blobはhandoff生成時に再読込し、RIFF／codec構造、寸法、byteLength、stored inspection、SHA-256をassemblyと再照合する。
成功結果はplan image descriptorと同一Blob identityを結び付け、既存client transportが要求するfileだけをstrictに解決できる。
`readyForUpload:true`は「upload入力がローカルで検証済み」を表し、通信完了を表さないため`readyForMetadataWrite:false`を維持する。

この単位はmock transportへ渡して全receipt sealまで統合確認するが、handoff自身はfetch、token取得、R2、Firestore、Press UI、Viewerを
import／実行しない。実Press操作への接続、progress／retry UI、実endpoint確認、metadata writeは次の別単位とする。

### Press read-only Horizon readiness（9A-6C-C-C-1C-B）

Pressはlocal release planning完了後、同じsessionのsealed WebPと現在の認証UID、クラウド保存済みproject／work ID、環境別R2 public
originを1C-Aへ渡す。release IDはruntimeだけに確保し、state、DSP、Firestoreへ保存しない。結果は新しいカードを増やさず、既存の
「ローカル配信設計」内へ`working`／`blocked`／`error`／`ready`として表示する。

`ready`は全JSON／WebP file数、exact payload bytes、WebP照合数を示すが、「アップロード未実行」を明記する。未ログイン、所有者不一致、
未クラウド保存、HTTPS public origin欠落は理由code付きで`blocked`にする。設定、言語、解像度、Flow revision、認証identityが変わると
進行中検証をabortし、古いresultとruntime release IDを破棄して再計算する。

Horizon発行buttonはdry-run合格後も常にdisabledで、titleだけが合格状態を説明する。Pressはclient upload transport、`/upload-release`、
Firebase token取得、R2、Firestore writeを呼ばない。portable `.dsf` downloadは既存の独立したround-trip gateを維持する。

## 11. Securityとresource limit

- DSF text payloadからHTML、script、event handler、外部CSS、CSS `url()`、任意style propertyを受け付けない。
- URL schemeとasset originは既存DSF asset policyに従う。
- public接続前にtext length、line/run/style/font数、座標、manifest byte、page数の上限を定義する。
- hash不一致、不正manifest、未知の必須機能は、読めるViewer errorを表示してfail closedにする。
- 未知の任意metadataは無視できるが、page描画に必要な未知contentは無視しない。

## 12. 9A実装境界

9A-0は文書だけを変更した。9A-1は`js/dsf-delivery-v2.js`のpure model、strict validation、
言語別page mappingと専用verificationだけを追加した。9A-2は認定font gate、DOM fixed-text renderer、
既存Viewerのdual dispatchとslider previewをdevelopment-only fixtureへ接続した。9A-3Aは
`js/fixed-text-delivery-projection.js`で既存Fixed text blockと、その本文を認定fontで組んだcertified composition snapshotを
1ページのv2 manifest fragmentへpure projectionする。9A-3Bは同じprojectionとViewer DOM rendererを
development-only Pressサムネイルへ接続し、fixture fontの読み込み、fixedText候補、WebP fallback codeを表示する。
9A-3Cは空の本番registry、厳格なregistry validator、Fixed pageごとのpure Press preflightを追加した。
9A-4Aは公開可能preflightと検証済みWebP descriptorから、hash済みcontent index／言語manifestとasset planを作る
pure assemblerを追加した。
9A-4Bは実WebP bytesをRIFF chunk／codec headerまで検査し、実寸法とWeb Crypto SHA-256をimmutable Blobへ
結び付けるlocal byte sealingを追加した。
9A-4Cは9A-4Aの確定JSONと9A-4Bのsealed WebPを再検証し、`mimetype`、`manifest.json`、`meta.json`、
`content.json`、言語manifest、WebPの完全なlocal file inventoryを追加した。
9A-4Dはそのinventoryから決定的なZIPをメモリ生成し、再展開した全entryをCRC／byteLength／SHA-256で
照合するlocal package moduleを追加した。
9A-5Aはsemantic Flow source、成功pagination、認定font実測snapshotをno-lossで照合し、言語別固定テキストpageへ
pure projectionする契約を追加した。実測snapshotの採取とruntime統合は行わない。
9A-5Bは認定fontを明示loadし、no-hyphenationの同一DOM sessionでpaginationとRange実測snapshotを作り、
直後に9A-5Aへno-loss投影するlocal captureを追加した。Press／assembly／uploadへは接続しない。
9A-5Cは現在revisionと完全一致する成功Flow projectionだけをpure preflightへ通し、Fixed／Flow／WebPを
作者順の言語別manifestへpure assemblyする。Press UI／runtime、ZIP、uploadへは接続しない。
9A-6Aはdevelopment-only Press UIでFlow capture／projection／preflightを接続し、言語別候補page数と停止理由を表示する。
local fixtureだけを使い、発行ボタン、容量見積り、release assembly、uploadは接続しない。
9A-6B-Aは同じ共通preflightを本番registry専用のPress準備ゲートへ接続し、staging／productionでも停止理由を表示する。
この時点ではregistryが空なので実原稿はDOM capture前に停止し、発行処理へは接続しない。
9A-6B-B1／B2は実WOFF2 bytesのheader／length／SHA-256検証、credentialなし固定URL取得、verified runtime familyの
一時登録を追加した。実font entryは追加せず、発行／保存処理にも接続しない。
9A-6B-B3-A2はHorizon用registry declarationを変更せず、portable `.dsf`専用に全使用fontをembedded declarationへ
書き換え、exact WOFF2をarchive inventoryとZIP round-tripへ含めるlocal gateを追加した。download UI／uploadは未接続である。
9A-6C-Aは成功した本番Flow準備とsealed WebP descriptorを既存release assemblyへin-memory接続し、PressへHorizon／portable
payload見積りを表示する。ZIP overhead、download、upload、発行には接続しない。
9A-6C-Bは同じsealed WebPとexact検証済み使用WOFF2を既存portable inventory／deterministic ZIPへ渡し、全entryの
round-trip後にローカル検証用`.dsf`の実測ZIP容量とSHA-256をPressへ表示する。download、upload、発行には接続しない。
9A-6C-C-Aは現在設定とsignature一致するround-trip合格済みportable ZIP Blobだけを既存DSF書き出しへ渡す。Flow upload、
Firestore、Horizon発行、公開Viewer loadには接続しない。
9A-6C-C-Bはそのportable v2 `.dsf`をローカルViewerへ読み戻し、全entry、同梱font、WebPをfail closed検証してから
WebP／fixedText混在ページと言語列を表示する。旧v1／DSP fallbackは維持し、公開／共有URL、upload、Firestore、Horizon発行には
接続しない。
9A-6C-C-C-0はverified assemblyをimmutable Horizon file planへ投影し、全fileのexact receipt完了後だけRelease／public locatorを
sealするpure契約と、valid v2を優先してpartial／invalid v2をv1へfallbackしない公開Viewer transport選択を追加した。Press、Works、
Viewer、upload API、Firestore、R2には接続しない。
9A-6C-C-C-1Aは既存画像用`/upload`を変えず、release planのJSON／WebPだけを受ける`/upload-release`を追加した。server-side
SHA-256、実byteLength、MIME、形式、安全path、immutable cache metadataを照合し、create-only R2 writeと同一内容の再送だけを
許可してexact receiptを返す。mock R2だけで検証し、Press、実R2、Firestore、Viewer、deployには接続しない。
9A-6C-C-C-1Bはplanのcanonical JSON／exact WebP Blobを送信前に再hashし、requestごとにtokenを取得してrelease endpointへ
逐次送信するclient transportを追加した。全response／receiptを厳密照合し、partial failure、通信失敗、abort、改ざんreceiptではsealを
返さない。完全成功時だけ既存pure sealを返す。mock fetchだけで検証し、Press、実token／R2、Firestore、Viewer、deployには接続しない。
9A-6C-C-C-1C-AはPress planningのverified assemblyとsealed WebP集合をimmutable Horizon planへ再照合し、全画像のexact Blob binding、
容量、SHA-256を検証したnetwork-idle handoffを追加した。mock transport統合だけを確認し、Press UI、fetch／token、実R2、Firestore、
Viewer、deployには接続しない。
9A-6C-C-C-1C-BはそのhandoffをPress既存summaryへread-only接続し、認証／作品identity、working／blocked／error／ready、file数と
exact bytesを表示する。Flow Horizon発行buttonは合格後もdisabledで、実transport／token／R2／Firestore／Viewer／deployには接続しない。
いずれも発行を有効化せず、本番dataを変更しない。

承認後の推奨実装単位:

1. **9A-1: pure delivery modelとvalidation（実装済み、runtime未接続）**
   - v2 normalizer、strict validator、言語列、anchor mappingのtest。
   - Viewer、Press、Firestore、R2、UIへ未接続。
2. **9A-2: local fixtureによるViewer fixed text renderer（active branch実装済み、公開読込未接続）**
   - dual renderer dispatch、認定font gate、canonical scale、zoom、現行slider previewを確認。
   - full minimapはactive branchに存在しないため、未統合Viewer branchを取り込む段階で同じcanonical DOM surfaceを再検証する。
   - 既存v1 WebP releaseは無変更。
3. **9A-3A: 既存Fixed text pure projection（実装済み、runtime未接続）**
   - canonical Fixed text block、同一本文・layout version・font ID・font hashを結び付けたcomposition evidence、
     明示的な認定font登録を
     v2 `fixedText`の1ページmanifest fragmentへ変換する。
   - ruby、縦中横、overlay／interaction、overflow、font不一致、未計測の横書き中央／末尾揃えは
     理由code付きで既存WebP経路を選ぶ。暗黙のdevice font代替や文字欠落は行わない。
   - Flow、Press UI、R2、公開Viewerへは未接続。
4. **9A-3B: 既存Fixed text Press preview（実装済み、実発行未接続）**
   - 9A-3Aと同じprojectionをdevelopment-only Press previewへ接続し、正規`360×640` DOM page、
     fixture font load gate、WebP fallback code／理由を確認する。
   - fixture font declarationは本番証明書ではなく、staging buildと発行データへ含めない。
   - DSF書き出し、Horizon発行、容量見積り、Flow発行は変更しない。
5. **9A-3C: production font registryとPress preflight（実装済み、runtime未接続）**
   - license、version、immutable WOFF2 URL、実bytesのsha256を持つ本番認定font registryを確定する。
   - page方式選択と理由一覧をpure Press preflightとして作り、R2／公開Viewerへ接続しない。
   - 9A-3C時点は実assetと権利を確認したfontがないため本番registryを空にし、既存textはWebPを継続する。
6. **9A-4A: pure release assembly（実装済み、runtime未接続）**
   - 公開可能preflight、検証済みWebP descriptor、注入SHA-256関数から、確定JSON、content index、言語manifest、asset planを作る。
   - R2 URL、ファイル書込み、upload、Firestore、Press UI、公開Viewerには接続しない。
7. **9A-4B: release byte sealing（実装済み、runtime未接続）**
   - 実WebP bytesの形式／寸法／hash確認とWeb Crypto SHA-256 adapterを、まだuploadせずに接続する。
   - immutable Blobと9A-4A descriptorを結び付ける。既存upload経路は変更しない。
8. **9A-4C: local release file inventory（実装済み、runtime未接続）**
   - sealed WebP Blobを9A-4Aのasset path／hashへ再照合し、`content.json`、言語manifest、`meta.json`、archive manifestの
     完全なfile inventoryをメモリ上で作る。
   - ZIP生成、download、R2／Firestoreにはまだ接続しない。
9. **9A-4D: in-memory ZIP builderとround-trip検証（実装済み、runtime未接続）**
   - 9A-4Cのinventoryだけを入力に、決定的なentry順と安全なpathで`.dsf` ZIP bytesをメモリ上に作る。
   - 再展開して全entryのbyteLength／SHA-256を照合する。download、Press UI、R2／Firestoreにはまだ接続しない。
10. **9A-5A: pure Flow publication projection（実装済み、runtime未接続）**
   - semantic source、成功pagination、認定font実測snapshotを照合し、言語別固定ページとanchorをserializeする。
   - semantic sourceはDSP／owner authoring storageだけに保持する。
11. **9A-5B: publication composition snapshot capture（実装済み、runtime未接続）**
   - 認定fontとno-hyphenation設定でFlow pageをbrowser内実測し、9A-5Aが要求する行／列とsource runを採取する。
   - local captureと検証に限定し、Press UI、assembly、uploadには接続しない。
12. **9A-5C: Flow preflight／release assembly統合（実装済み、runtime未接続）**
   - 9A-5A成功結果をFixed page decisionと同じ言語manifestへ順序どおりmergeする。
   - 現在revision、言語、Group、font、anchorの完全一致を要求し、Flowの暗黙WebP fallbackは行わない。
13. **9A-6A: development-only Flow Press preflight preview（実装済み、実発行未接続）**
   - 実DOM captureからpreflightまでをPressのローカル確認面へ接続し、言語別page数と停止理由を表示する。
   - fixture fontを本番証明書として扱わず、発行ボタンと容量見積りは停止したままにする。
14. **9A-6B-A: production font／Press preparation gate（実装済み、実発行未接続）**
   - staging／production Pressの発行直前preflightへ空の本番registryを接続し、未認定・翻訳不足・組版不一致を理由付きで停止する。
   - fixtureを本番へ混入させず、発行ボタン、容量見積り、release assembly、uploadは停止したままにする。
15. **9A-6B-B1: production font exact-byte verifier（実装済み、実font未登録）**
   - WOFF2構造、実byteLength、Web Crypto SHA-256をregistry entryへ完全一致させ、immutable runtime evidenceを作る。
16. **9A-6B-B2: verified production FontFace runtime（実装済み、実font未登録）**
   - credentialなし固定URL取得、response検査、exact-byte検証、session専用familyのload／disposeをFlow capture前の必須gateにする。
17. **9A-6B-B3-C: first production font registration（実装・実font browser確認済み、実発行未接続）**
   - version固定WOFF2の配信先、ライセンスとWeb配信／portable embedding権、rights holder、対応language／writing mode／weightを
     人間が確認し、B1で得た実byteLength／SHA-256とともにregistryへ登録する。
   - B3-AでNoto Sans JP 2.004-H2（4,350,080 bytes）とNoto Serif JP 2.003-H1（5,965,452 bytes）を技術候補として固定した。
   - subsettingなしのWOFF2を元TTFと全table比較し、差はW3C WOFF2必須の`head.checkSumAdjustment`と`flags.bit11`だけである。
   - B3-Bはstaging／production R2配置、CORS／MIME／immutable cache／remote exact bytes、Architect license review後にのみregistryを有効化する。
   - B3-Cで上記gateを満たした2書体を有効化し、Flow Press既定経路の横書き／縦書きacceptanceを完了した。
18. **9A-6B-B3-A2: portable download font embedding（実装済み、download UI未接続）**
   - Horizonは共有immutable CDN URLを維持する。
   - ダウンロード`.dsf`は使用fontをSHA-256単位で必須同梱し、外部font依存、欠落、権利未確認、実bytes不一致を拒否する。
19. **9A-6C-A: Press local release assembly／payload estimate（実装済み、実発行未接続）**
   - WebP／fixedText混在assemblyとHorizon／portable payload見積りをin-memoryで確認する。
   - ZIP、download、upload、Firestore、Horizon発行、公開Viewerを変更せず、Flow発行guardを維持する。
20. **9A-6C-B: exact local portable ZIP／round-trip（実装済み、download UI未接続）**
   - sealed WebPとexact検証済み使用WOFF2から実ZIPをin-memory生成し、全entry再展開後の実測容量とSHA-256を確認する。
   - download、upload、Firestore、Horizon発行、公開Viewerを変更せず、Flow発行guardを維持する。
21. **9A-6C-C-A: verified portable download handoff（実装済み、upload未接続）**
   - round-trip合格済みBlobだけを現在signature再照合後、安全化した作品タイトルの名前でローカル`.dsf`として保存する。
   - 旧WebP-only builderへfallbackせず、Horizon／Firestore／公開Viewerを変更しない。
22. **9A-6C-C-B: portable v2 local Viewer acceptance（実装済み、公開runtime未接続）**
   - manifest、全entry hash、embedded font、WebPをfail closed検証し、WebP／fixedText混在と言語別ページ列を既存Viewerへ渡す。
   - session固有FontFace／object URLを破棄し、旧v1／DSP fallbackを維持する。公開／共有URL、upload、Firestore、Horizonを変更しない。
23. **9A-6C-C-C-0: Horizon release／public Viewer transport contract（実装済み、I/O未接続）**
   - immutable file planと全file exact receipt完了後だけRelease／public locatorをsealするpure契約を追加する。
   - valid v2を優先し、宣言済み／部分v2の失敗時にv1へfallbackしない。Press、Works、Viewer、Firestore、R2を変更しない。
24. **9A-6C-C-C-1A: DSF v2 release upload endpoint（実装済み、Press未接続）**
   - JSON／WebPの限定path、server-side hash／size／MIME、immutable cache、create-only write、exact receiptを検証する。
   - 同一内容のidempotent retryだけを許可し、path衝突は上書きせず停止する。mock R2だけで確認する。
   - 既存画像`/upload`、Press、実R2、Firestore、公開Viewer、deployを変更しない。
25. **9A-6C-C-C-1B: verified release upload client transport（実装済み、Press未接続）**
   - exact Blobを再hashし、plan全fileを逐次送信してresponse／receiptをstrict検証する。
   - partial failure、通信失敗、token欠落、abort、改ざんreceiptではsealを返さず、完全plan再実行で安全にretryする。
   - mock fetchだけで確認し、Press、実token／R2、Firestore、公開Viewer、deployを変更しない。
26. **9A-6C-C-C-1C-A: Press dry-run Horizon handoff（実装済み、Press UI／network未接続）**
   - Press planningとsealed WebPの完全対応、実Blob構造／寸法／byteLength／SHA-256を再検証してimmutable planへ結び付ける。
   - mock transportでupload sealまで確認するが、fetch、token、実R2、Firestore、Viewer、deployを変更しない。
27. **9A-6C-C-C-1C-B: Press read-only Horizon readiness（実装済み、実upload未接続）**
   - dry-run handoffを既存Press summaryへ統合し、identity前提、検証状態、file数、exact bytes、upload未実行を表示する。
   - Flow Horizon発行buttonを無効のまま保ち、設定／認証変更時は古いresultを破棄する。
28. **9A-6C-C-C-1C-C以降: Press upload／public Viewer integration**
   - 明示的な発行操作から実uploadを開始し、全receipt seal後のFirestore metadata、公開Viewer remote loaderを段階的に実装する。
   - staging device／browser test、partial failure、orphan cleanup、rollbackを実接続前に確認する。

各単位を別commitとしてreviewする。9A-6C-C-C-1C-BはPress内のread-only readinessまで完了したが、network transportからはまだ呼ばない。
production publication migrationはまだ許可しない。
