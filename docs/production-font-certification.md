# DSF production font certification

更新日: 2026-08-24
状態: **Noto Sans JP / Noto Serif JPをactive production registryへ登録し、Flow Press実ブラウザー受け入れ確認済み。**

## 結論

最初のDSF固定テキスト配信用font候補は、次の2書体とする。

| candidate ID | family / version | full variable WOFF2 | SHA-256 |
|---|---|---:|---|
| `noto-sans-jp-2.004-h2` | Noto Sans JP 2.004-H2 | 4,350,080 bytes | `6fd94964d1990baa2a392cea7a036683d2b80b9dfd590cb3918e8dab98d8e188` |
| `noto-serif-jp-2.003-h1` | Noto Serif JP 2.003-H1 | 5,965,452 bytes | `075dddc7c1db881edb70818c6c1131085009f74086616fddb4ca805cc6b52888` |

2本の合計は10,315,532 bytesである。Horizonのオンライン閲覧は共有immutable CDN URLを使い、複数作品間でbrowser cacheを
共有する。ダウンロード用`.dsf`は外部CDNへ依存させず、作品が実際に使用するfontを必須同梱する。Sansだけなら
4,350,080 bytes、Serifだけなら5,965,452 bytes、両方なら10,315,532 bytesがpackageへ加わる。各fontはページ数や言語数に
かかわらずSHA-256単位で1回だけ格納する。

`js/dsf-font-certification-candidates.js`は技術・権利・remote evidenceを保持し、
`js/dsf-font-registry.js`は`createDsfProductionFontEntryFromCandidate()`の全gateを通して、この2候補だけを明示的に有効化する。
remote assetが存在しない状態やreview evidenceが不足した状態でregistryだけ有効化することは禁止する。

## 固定したsource

### Noto Sans JP

- distributor: [Google Fonts](https://github.com/google/fonts)
- Google Fonts commit: `295d98a7a0c17c68f1341eaeea354e7960ea70d3`
- path: `ofl/notosansjp/NotoSansJP[wght].ttf`
- upstream: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) `523d033d6cb47f4a80c58a35753646f5c3608a78`
- source TTF: 9,589,900 bytes
- source SHA-256: `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`

### Noto Serif JP

- distributor: [Google Fonts](https://github.com/google/fonts)
- Google Fonts commit: `8a7c74854f766ae441c7584925cc0ec626fc5aa6`
- path: `ofl/notoserifjp/NotoSerifJP[wght].ttf`
- upstream: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) `985fa52c81c1d6692ccdd82bc3656e8fb932fd89`
- source TTF: 13,574,352 bytes
- source SHA-256: `2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc`

## WOFF2生成と等価性

- `fontTools 4.59.0` + `Brotli 1.1.0`
- glyph、OpenType feature、variation axisを削らないfull font
- subsettingなし
- 元TTFとWOFF2再構成結果の23 tablesを比較
- 22 tablesはbyte完全一致
- `head` tableの差は次のWOFF2必須処理だけ
  - 全体checksum再計算による`checkSumAdjustment`
  - lossless modifying transformを示す`flags.bit11`（flags `3` → `2051`）

これは[W3C WOFF2 Recommendation](https://www.w3.org/TR/WOFF2/)がencoderへ要求する差である。
字形、metrics、variation、縦書き、license metadataは一致している。

| capability | Noto Sans JP | Noto Serif JP |
|---|---:|---:|
| glyphs | 17,936 | 17,923 |
| Unicode codepoints | 16,732 | 16,726 |
| weight axis | 100–900 | 200–900 |
| vertical metrics | あり | あり |
| vertical GSUB | `vert`, `vrt2` | `vert`, `vrt2` |
| embedding restriction (`OS/2.fsType`) | 0 | 0 |

初期のDSF capabilityは日本語と、fontがLatin / Latin Extendedを持つ現在のDSF Latin言語keyに限定する。
中国語・韓国語は地域字形とcoverageを別fontで認定するまで、この2候補へ割り当てない。

### Local browser acceptance

2026-08-23にcandidate WOFF2実bytesをlocal HTTPからChromiumへ読み込み、両familyで次を確認した。

- weight 400 / 700の`FontFace.load()`が`loaded`
- `document.fonts.check()`が日本語／Latin probeで`true`
- 横書きの実測boxが0より大きい
- 縦書きの実測boxが0より大きく、computed `writing-mode`が`vertical-rl`
- browser console error 0件

これはlocal bytesのbrowser parse evidenceであり、production URLのCORS／MIME／cache evidenceではない。

### Staging R2 / Chromium acceptance

2026-08-23に次のcontent-addressed objectを`dsf-media-staging`へ配置した。production objectではなく、
production registryも引き続き空である。

- `https://media-staging.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2`
- `https://media-staging.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2`

staging Pages Origin付きのHEAD／GETで、Sansは`4,350,080` bytes、Serifは`5,965,452` bytes、
`Content-Type: font/woff2`、`Access-Control-Allow-Origin: https://staging.dsf-studio.pages.dev`、
`Cache-Control: public, max-age=31536000, immutable`を確認した。再取得bytesは候補台帳のSHA-256と完全一致し、
WOFF2構造検査も通過した。

Chromiumのstaging originから両URLを`FontFace`として読み込み、weight 400／700、横書き、`vertical-rl`、
`document.fonts.check()`成功、console error 0件を確認した。検証用FontFaceは確認後に削除した。

Originなしのstaging GETは404となる。Horizonのcross-origin font requestはOriginを送るため上記browser確認は成功するが、
production activationではOriginなしの直接GETも含めて公開方針を再確認する。

再取得した2つの実WOFF2をportable `.dsf`へ`fonts/<sha256>.woff2`としてSTORE同梱し、ZIP再展開後の
byteLength／SHA-256一致を確認した。検証ZIPは`10,318,337` bytes、SHA-256は
`2235f22b18276a7a23fa11c743dd9a07c6ac3b53e5afb3f5230a533a2d64c7f3`である。

### Production R2 / Chromium acceptance

2026-08-24に次の4 objectを`dsf-media`へ新規配置した。

- `https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2`
- `https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2`
- `https://media.dsf.ink/fonts/licenses/noto-sans-jp-2.004-h2-ofl-1c05c68c34f97084.txt`
- `https://media.dsf.ink/fonts/licenses/noto-serif-jp-2.003-h1-ofl-5e0da210fb04058a.txt`

全objectでOriginなし／`https://dsf.ink` Origin付きGETが`200`となる。fontは`font/woff2`、noticeは
`text/plain; charset=utf-8`／`Content-Disposition:inline`、CORSは`*`、cacheは
`public, max-age=31536000, immutable`である。再取得した4 objectはlocal原本とSHA-256が完全一致した。

`https://dsf.ink`のChromiumから両production fontを読み込み、weight 400／700、横書き、`vertical-rl`、
`document.fonts.check()`成功、console error 0件を確認した。検証用FontFaceは確認後に削除した。

### Active registry / Flow Press acceptance

2026-08-24に候補台帳のproduction URL、remote exact bytes、CORS、MIME、immutable cache、OFL reviewを
`createDsfProductionFontEntryFromCandidate()`へ明示し、次の2 entryを`DSF_PRODUCTION_FONT_REGISTRY`へ登録した。

- `noto-sans-jp-2.004-h2`
- `noto-serif-jp-2.003-h1`

ローカルVite上のChromiumから、`prepareFlowPressPublication()`の既定active registry経路を使い、各familyについて
横書き／縦書き、weight 400本文＋weight 700見出し、巨大Paragraph、手動PageBreakを実測した。4ケースすべて
`state:'ready'`、4ページ、projection issue 0件となり、記録されたfont SHA-256はproduction bytesと一致した。
各case終了後はsession専用FontFaceとcapture DOMが0件へ戻り、browser console warning／errorも0件だった。

これはFlow Pressの本番準備ゲートが実fontで成功することの確認である。Flow発行ボタン、容量見積り、release assembly、
upload、Firestore、公開Viewer runtimeはまだ接続しない。

## License判断

両候補は`OFL-1.1`である。[OFL公式本文](https://openfontlicense.org/open-font-license-official-text/)は
fontの利用、埋込、変更、再配布を認める。[OFL FAQ](https://openfontlicense.org/ofl-faq/)はWeb font自己hostを認め、
元font dataを変えずWOFF2圧縮だけを行う場合は元のfont名を維持できるとしている。

- Sans rights holder: Adobe (2014–2021), Reserved Font Name `Source`
- Serif rights holder: Adobe (2017–2024); `Noto` is a trademark of Google Inc.
- Web配信: license上可能
- portable embedding: license上可能
- Architect review: 2026-08-24、`DSF Architect`としてWeb配信とportable embeddingを承認
- subsetting: 今回は行わない。将来行う場合はModified Versionと命名を再検討する

本番化時は、OFL本文とcopyright noticeを利用者が確認できる公開場所にも置く。

## proposed immutable URLs

- `https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2`
- `https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2`

filenameへversionとSHA-256先頭16桁を含める。同じURLの上書きを運用上禁止する。

## activation gate

次を全て満たした2書体だけをproduction registryへ登録した。

1. ✅ staging R2へ同一bytesを置き、横書き／縦書き、weight 400／700のFontFace実読込を確認する
2. ✅ production R2のproposed URLへ同一bytesとOFL noticeを置く
3. ✅ production GETが`200`、`Content-Type: font/woff2`、正しい`Content-Length`、CORS許可を返す
4. ✅ `Cache-Control: public, max-age=31536000, immutable`相当を確認する
5. ✅ `npm run check:dsf-font-candidate-assets -- <download-directory>`で実bytesを再照合する
6. ✅ ArchitectがWeb配信／portable embedding、確認日、確認者を明示する
7. ✅ `createDsfProductionFontEntryFromCandidate()`の全gateを通したentryだけregistryへ追加する
8. ✅ production URLからのexact-byte runtime testとFlow Press browser acceptanceを通す

7はNoto Sans JP／Noto Serif JPの2 entryだけをactive registryへ追加し、strict validationとfamily resolutionを確認した。
8はactive registry既定経路のFlow Pressで横書き／縦書き4ケースを実測し、exact hash、pagination、projection、cleanupを確認した。

本番asset uploadとregistry activationはそれぞれ明示指示を得て完了した。commit、staging deploy、production deployは未実施である。
