# DSF Writing W0 実装・検証記録

2026-10-11。W0のJSON契約とブラウザー内サブセット生成を隔離実装した。Windows Chromeで生成・再読込・横縦表示・オフライン再読み込みが成立した。スマホ実機のメモリと時間、ブラウザー全終了後の再起動は未検証であり、端末共通の上限は未確定。W0を製品受入完了とは扱わない。

## 作業範囲

- worktree: `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`
- branch: `feature/dsf-writing-w0`
- HEAD: `b16f3fc87575a3c7173984c3677320446f319bf5`
- main／origin/main `70e44be4d5ff5a81a579fabaed66e78c4a7571fa` から分岐し、既存ページリンクの依存commitまでfast-forward。新しいcommit・deploy・main変更なし。
- 既存 `dsf-page-links-editor` の仕様・計画をコピーして更新。元worktree、未追跡素材、作者原稿は保持した。
- 架空の2ページとWritingだけを利用。クラウド、Reader製品UI、Press出力、DSPの保存構造に接続していない。

## 実装した契約

`js/dsf-writing-contract.js` はDOM非依存の実験モジュール。通常版・編集用・共有用を厳密なキー集合で検証する。schemaは実行可能なvalidatorとfixtureで表現し、JSON Schema文書や実ZIPの仕様確定はまだ行っていない。

| 対象 | W0の具体化 |
|---|---|
| 形式 | `formatVersion:3`、`copyKind` は `original`／`writing-editable`／`writing-shared` |
| 原本 | 許可された原本entryの展開後bytesをhash化。path順にしたdescriptorのcanonical JSONをhash化し `baseContentHash` とする。ZIP圧縮、Writing、外側manifestは含めない |
| 文書 | schema 1、documentId、baseContentHash、headRevisionId、言語とpageIdで参照するpages |
| 履歴 | schema 1、単一の空root、親を先に置くrevision列。各revisionはページ状態の完全snapshot。枝を保持し、選択headと現在状態の一致を検証 |
| 共有用 | 現在状態だけを複製し、historyとhead参照をnullにする。編集用の元データは変更しない |
| 描画物 | stroke（pen／brush／marker／highlighter）、text、line、shape。数値、ID、styleと参照を検証。筆ペンはpressureだけでなく確定widthを保持 |
| 文字範囲 | runのstart／endはUTF-16 offset。ただし結合文字・絵文字等のgrapheme境界を分断しない。1テキスト内の複数書体を許可 |
| 固定位置 | layoutにテキスト範囲と座標を保存するW0案。製品のshaping結果と固定描画への接続はW1 |
| フォント | 認定元ID・版・元bytes hash、生成recipe、対象文字digest、派生bytes hash／サイズ、notice参照を別descriptorで検証 |

原本fontは `fonts/<sha256>.woff2`、noticeは `licenses/fonts/<sha256>.txt`。Writing側はそれぞれ `writing/fonts/` と `writing/licenses/fonts/` に分ける。通常版にも原本のnoticeを含める。共有用に残るfontのnoticeを履歴と一緒に削除しない。

原本fixtureのhashは `fc67674f5191219a1a7516079419ca79aff83349fb43f0a4e6622e492d7f6e7b`。このfixtureは領域・hash試験用の最小JSONであり、現行delivery schema 2の完全な発行データではない。font descriptorの宣言検証と、実際のfont bytes検査は現段階で別々。ZIP内の対応付けはW1で統合する。

## フォントの採用記録

`writing-w0-licenses/catalog.json` に、既存DSFのNoto Sans JP 2.004-H2／Noto Serif JP 2.003-H1を版・配布物hash付きで記録した。Google Fontsの固定commitとDSF配布noticeを取得し、本文hashを照合した。標準候補はこの2書体。追加カタログの個別書体は未採用。

Web配信、入力、オフラインcache、サブセット化、同梱再配布の用途別確認を記録した。条件は著作権表示・OFL本文保持、派生へのOFL適用、予約名、単体販売と推薦表示の制限。技術的に描画できることと許諾確認を別項目にする。

出典: [Sansの固定版OFL](https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/ofl/notosansjp/OFL.txt)、[Serifの固定版OFL](https://raw.githubusercontent.com/google/fonts/8a7c74854f766ae441c7584925cc0ec626fc5aa6/ofl/notoserifjp/OFL.txt)、[OFL公式FAQ](https://openfontlicense.org/ofl-faq/)。

Sansには予約名 `Source` があり、Noto名と区別して記録。Serifの外部noticeのcopyrightはGoogle 2012、配布font内部name ID 0はAdobe 2017–2024だった。片方で上書きせず、外部noticeと内部name情報を両方保持する。今回の派生はname ID 0／1／6／13／14／16を保持・照合している。候補や版の変更時は再確認する。

## ブラウザー生成器の判断

採用した試作は、WOFF2を `wawoff2 2.0.1` で展開し、[公式harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) `1.6.3` のsubset WASMで絞り込み、`woff2-encode-wasm 0.1.1` で再圧縮する構成。Workerを1書体ずつ起動し、完了・失敗・60秒timeout時に終了する。名前、layout feature、可変軸を保持する。

`hb-subset-wasm 0.4.0` は不採用。元fontで1000だった縦advanceが試作出力で0になり、Chrome実表示で文字が重なった。候補の[ビルド設定](https://raw.githubusercontent.com/kyosuke/hb-subset-wasm/main/scripts/build-wasm.sh)の `HB_NO_VERTICAL` と、公式版の[subset設定](https://raw.githubusercontent.com/harfbuzz/harfbuzzjs/main/config-override-subset.h)の相違を確認した。`inspect-font.mjs` と `outputs/writing-w0/results/probe.*` はこの不採用候補の再現用であり、採用結果ではない。依存には再現目的で残している。

結合濁点 `か + U+3099` では、元入力のcodepointだけを採用するとshaperが使う合成字形が不足することも確認した。各runの元文字列・NFC・NFDの字形和集合を、並べ替える前に作る。保存する本文は正規化で変更しない。元fontに存在しない字形は代替成功にせず拒否する。

最終追試では字形一覧をそのまま文章としてshapeした検査が失敗した。ソートで結合文字の前後が変わるため、採用字形集合と元の文章の比較を分離した。現在・履歴の各runを元の文字順のまま比較し、coverageは字形集合で検査する。サブセット前後のshaping比較は [HarfBuzzの処理](https://harfbuzz.github.io/harfbuzz-hb-subset.html) に加えて実ブラウザーでも行う。

## 実測結果

Windows、Chrome 154。架空の短文、2書体、weight 400／700、横書き／縦書き。これは短い検証用テキストであり、一般の原稿で同じ圧縮率になるという意味ではない。

次表と初回計測値は初回成功版の記録。最終版では各runで正規化字形を収集してから和集合にする修正を加えており、最終数値は後述の追試記録を正とする。

| 書体 | 元WOFF2 | 現在状態 | 履歴を含む状態 | 比較用短文 |
|---|---:|---:|---:|---:|
| Noto Sans JP | 4,350,080 B | 16,640 B | 20,944 B | 18,976 B |
| Noto Serif JP | 5,965,452 B | 2,876 B | 2,876 B | 25,076 B |

Serifの現在・履歴は「第二頁」のみ。Sansの履歴には削除した「蟹」と別枝の「鶴」を含める。編集用では両方保持し、共有用では両方除去する。収録済み履歴subsetから完全版を使わず現在subsetへ絞り直す試験も成功した。

初回オフライン計測では、書体ごとの検証一式がSans 4.422秒、Serif 2.498秒。これは3対象の生成・再生成・再展開・比較・共有用への再subsetを含み、1回の保存時間ではない。WASMの処理後live linear memory合計はSans 135,266,304 B（129 MiB）、Serif 152,961,024 B（約145.9 MiB）。JS heap、ブラウザー全体、処理中ピークは含まない。

HarfBuzzで字形path・位置を24組比較し、ブラウザーでも8組の文字範囲座標を比較した。初回結果の横書き最大差は0.001 CSS px、縦書きは0。ブラウザー座標の丸めを考慮した許容値は1/64 + 0.001 CSS px。同じ入力の再生成hash、可変軸、上記name情報も一致。字形のpixel単位の全端末一致を保証する試験ではない。

オフライン試験は59資源をcacheへ準備後、検証タブをネットワークofflineにしてreloadし、ローカルサーバーも停止して実行した。reportの `navigatorOnlineAtStart:false`、`serviceWorkerControlled:true`、`ok:true` を確認した。結果のファイル保存だけはサーバーと通信設定を戻した後に行った。`serverEvidence.blocked:false` は任意のHTTP故障注入を使っていない意味であり、検証時にサーバーが動いていたという証拠ではない。

## 検証・証拠

- JSON契約の46項目: 通常／編集／共有、枝と削除、原本hash、未知field、循環、不正参照、範囲、複数字体、結合文字、容量、ライセンス対応等。`results/contracts.json` と `fixtures.json`。
- 初回online: `outputs/writing-w0/results/browser-1791683457284.json`
- 初回offline: `outputs/writing-w0/results/browser-1791683544917.json`
- 画面: `outputs/writing-w0/results/browser-offline.png`
- 最終offline追試: `outputs/writing-w0/results/browser-1791683931206.json`、画面 `browser-offline-final.png`。元のrun単位での比較へ修正後、通信offline・サーバー停止のまま成功を確認し、その後サーバーと通信を戻して保存した。
- 最終追試はSans 3.015秒／Serif 2.064秒、WASM live memoryは初回と同じ。全6対象のサイズ・hashは初回と一致し、ブラウザー8組も成功。本文・履歴から抽出した必要字形の比較と、元の文字順による描画比較を両方通した。
- 既存 `verify:dsf-font-registry`、`verify:dsf-release-assembly` は成功。実験コードの構文検査も成功。
- 製品の保存操作、Writing道具UI、形式3の実ZIP往復、Press／Horizon、スマホ実機、Safari／Firefox、ブラウザープロセス終了後の再起動は未検証。

## 再現手順

新worktreeのrootで実行する。実験用npm依存は隔離し、root package.json／lockは変更しない。

```powershell
npm ci --prefix scripts/writing-w0 --ignore-scripts
node scripts/writing-w0/prepare.mjs
node scripts/writing-w0/verify.mjs
node scripts/writing-w0/serve.mjs
```

`prepare.mjs` は公開された固定版font／noticeを取得してhashを照合する。既存fontのあるディレクトリを第一引数に渡せば、そのfont bytesを読み取り再利用できる。出力先は `outputs/writing-w0/`。依存のlicense、版、配布資源hashも記録する。

`http://127.0.0.1:5192/` を開き「オフライン資源を準備」→準備完了→reload→「サブセットと形式3を検証」。表示成功後に「検証結果をローカル記録」。ネットワーク切断時の結果を記録する際は、実行終了後に通信とサーバーを戻す。HTTPはloopbackのみ、公開配信やリポジトリー全体の配信はしない。

## 残る判断と次の実装

1. **W0の端末上限**: スマホ実機で時間とピークメモリを測定する。暫定上限はfont 16 MiB、展開sfnt 32 MiB、JSON 8 MiB、全展開256 MiB、entry 4096、revision 256、snapshotあたりobject 4096／点200,000／文字UTF-16単位200,000。試作の拒否上限であり、快適動作の保証ではない。上限超過時に履歴を黙って切り捨てない。
2. **W1の最初の単位**: 実deliveryページと派生font／noticeを使う通常・編集・共有の実ZIPを作り、全entry検証、原本bytes一致、履歴専用文字列・資源除去を往復で確認する。最終manifest、resource参照、固定text shapingとfont digest対応を統合する。
3. **作者の複数書体**: 現行は `languageConfigs.fontPreset`、オブジェクトの `style.fontFamily` とFlowの意味テキストを分けて扱っている。今回のWriting runをそのままDSPへ書き込まない。作者の範囲style、リボン、保存・History・Pressまでの具体的なデータ契約をW1で提示する。
4. **起動とUI**: 実験専用service workerの成功をReaderのオフライン対応済みと読み替えない。W1で起動資源、W2で道具・入力・履歴・ファイル保存を接続する。

正式な `file-format-spec.md`／`data-model.md` は製品実装と一致する段階で更新する。W0の試作結果を理由に現行format・フォント認定・作者データを一括置換しない。
