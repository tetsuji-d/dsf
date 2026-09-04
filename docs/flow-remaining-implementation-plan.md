# Flow / DSF delivery v2 残実装計画・AI引き継ぎ

最終更新: 2026-09-05
確認済みcheckpoint: `feature/flow-layout-foundation` / `5cecb17`
対象: DSF Studio、Press、Works、Horizon、ViewerのFlow原稿とDSF delivery v2

## 1. この文書の役割

この文書は、Flow機能の現在地と残作業を、次に作業する人間またはAIエージェントへ引き継ぐための実装ロードマップである。
データ形式の正本ではない。仕様が衝突した場合は、次の順で確認する。

1. `AGENTS.md`の開発運用ルール
2. `docs/data-model.md`のFirestore／保存契約
3. `docs/file-format-spec.md`のDSP／DSFファイル契約
4. `docs/fixed-text-delivery-contract.md`の固定テキスト配信契約
5. `docs/pressroom-spec.md`のPress／Works／Viewer公開境界
6. この文書の実装順

古い段階計画には、その時点の「未接続」が履歴として残っている。現在の接続状態は本書と実コードで再確認し、古い記述だけを根拠に機能を作り直さないこと。

## 2. 絶対に維持する設計判断

- DSFは固定レイアウトである。Viewerは端末幅に応じて本文をリフローせず、読者向け文字サイズ変更も提供しない。
- グラフィック／写真／自由配置ページはWebP、テキスト中心ページは組版済み`fixedText`として配信できる。
- 既存WebP-only DSF v1を後方互換として維持する。
- Flow本文の正本は`FlowDocument`であり、生成ページ、fragment、pagination cacheは保存しない。
- 生成ページは、現在の原稿、組版設定、認定fontからruntime／Pressで再生成する派生物である。
- Fixed PageとFlow Groupは同じ順序付きauthoring spineに共存できるが、データ型として統合しない。
- Fixed／画像／見開き／FlowはUI上で一つの作品ページ列として見せてよい。内部の保存責務は分離したままにする。
- Flowを「ページごとの`contentEditable`間で文字をコピーする仕組み」に戻さない。
- 公開ViewerへDSPやsemantic Flow sourceを渡さない。公開Viewerは検証済みDSF releaseだけを読む。
- Flowの暗黙WebP fallbackは行わない。fixedTextとして安全に投影できないFlowは理由付きで発行を停止する。
- commit、staging deploy、production deployは、それぞれ人間の明示指示がある場合だけ行う。

## 3. 現在実装済みの範囲

### 3.1 Flow authoring／編集

- Project v6の`blocks[]`内でFixed BlockとFlow Groupが共存する。
- `FlowDocument -> pagination -> runtime generated pages`の分離を維持している。
- Heading、Paragraph、PageBreakを保存できる。
- 横書き／縦書きを切り替えられる。
- 入力に応じてページ数が増減し、後続ページが増分リフローする。
- 一つの巨大Paragraphを複数ページへ分割できる。
- 生成ページ上で原稿言語を直接編集できる。
- 日本語IME、caret、既存改行、段落分割、前後Paragraph結合、見出し末尾Enter、直接改ページに対応している。
- 直接編集時にParagraph／Heading 1〜6を変更できる。
- 複数生成ページを横方向のキャンバスへ同時表示できる。
- Flow Group全体の削除と既存Undo／Redo、autosaveに対応している。
- 本文用の罫線ガイドをEditor内だけに表示できる。
- Noto Sans JP／Noto Serif JPを認定fontとして利用できる。

### 3.2 翻訳

- 言語別本文、言語別ページ数、translation freshnessを保持する。
- Provider選択、翻訳実行、結果のatomic適用、cancel、Undo／Redoへ接続済みである。
- Pressの発行言語は制作言語と分離されている。原稿言語だけを選べば、未選択言語の未翻訳／stale状態は発行を妨げない。
- 翻訳ページ上のWYSIWYG直接編集は、原文fallbackを誤編集しないため未接続である。

### 3.3 DSF delivery v2／Viewer

- WebPと`fixedText`を同じ言語別固定ページ列へ組み立てられる。
- FlowのDOM実測結果を、行／列の固定座標とsource rangeを持つ`fixedText`へno-loss投影できる。
- content index、言語manifest、hash、asset path、font参照を検証する。
- 使用fontを同梱したportable `.dsf`を作成し、ローカルViewerで開ける。
- Horizonでは認定fontをimmutable CDN assetとして読み込む。
- 公開ViewerのDSF v2 remote loaderは実装済みである。
- PressからR2へverified releaseをuploadし、所有者用Firestoreへ非公開draftとして保存できる。
- Worksの「下書きプレビュー」から、ログイン中の所有者だけがdraftをViewerで確認できる。
- Worksの公開状態変更は、Project／Work／Releaseの再検証後にProject、Dashboard summary、`public_projects`を単一Firestore transactionで更新する。
- DSF v2の`public`／`unlisted`切替と、匿名Viewer／Horizonの公開境界はstaging実データで確認済みである。
- 2026-09-03時点のstagingで、所有者draftの固定テキスト表示、ページ送り、console errorなしを人間が確認済みである。

## 4. 初期Flow公開の現在地

FlowのHorizon releaseは、非公開draft保存、所有者preview、atomicな`public`／`unlisted`切替、匿名Viewer読込まで接続済みである。

`c6dd89b`で次を実装した。

- Project／Work／Releaseの`projectId`、`workId`、`releaseId`とlatest releaseを公開直前に再検証する。
- Release正本のv2 locator、hash、言語、言語別page数、default language、許可R2 originを再検証する。
- Project、Dashboard summary、`public_projects`の作成／削除を単一Firestore transactionへ統合する。
- v2の公開／限定公開UIを有効化し、v1／v2のpure契約とsource wiring testを更新する。

stagingではJA fixedText 4ページのFlow作品を`draft -> unlisted -> public -> draft`と遷移させ、unlisted時のHorizon非掲載、
public時のHorizon掲載と匿名Viewer表示、draft復帰後の一覧・匿名URL遮断、全工程のconsole errorなしを確認した。

技術・人間双方のstaging初期公開acceptanceを完了した。production migrationは引き続き別承認とする。

## 5. 初期Flow公開までの安全な実装順

### Unit P1: DSF v2公開切替のatomic化（実装・staging確認済み）

目的: WorksでFlow releaseを`public`／`unlisted`へ安全に切り替えられる土台を作る。

実装範囲:

1. 現在のProject／Work／Releaseが同じ`workId`、`releaseId`を指すことを再検証する。
2. `dsfContentUrl`、`dsfContentHash`、言語、言語別page数、default language、許可R2 originを公開直前に再検証する。
3. `public_projects/{workId}`用payloadを、検証済みRelease locatorから作る。
4. owner Projectの`dsfStatus`／`visibility`、Dashboard summary、`public_projects/{workId}`を可能な限り同一Firestore batchで更新する。
5. `draft`／`private`へ戻す操作では、owner側状態更新と公開index削除を同じ整合性境界で扱う。
6. 公開index作成に失敗した場合、Projectだけを`public`表示にしない。
7. v2の公開／限定公開UIを有効化し、旧disabled前提テストを新しい契約へ更新する。

非対象:

- release fileの再upload
- DSP／DSF schema変更
- production deploy
- 過去releaseの選択UI
- Editor UI整理

受け入れ条件:

- 不完全なv2 locatorでは公開操作が失敗し、既存draftが維持される。
- 完全なv2 locatorでは`public`／`unlisted`へ変更できる。
- `draft`／`private`へ戻すと`public_projects/{workId}`が残らない。
- v1作品の既存公開操作に回帰がない。
- 同じ操作の再試行が安全である。

主な確認:

```text
npm run verify:works-dsf-release
npm run verify:dsf-horizon-viewer-load
npm run verify:project-summary-dual-write
npm run verify:portal-public-feed
npm run build:staging
```

Firestore Rulesを変更する場合だけ、staging emulator検証とRulesの別承認を追加する。

結果: `c6dd89b`。Rules／schema変更なし。指定test、関連contract test、`build:staging`を通過し、staging実データの公開遷移も成功した。

### Unit P2: staging匿名公開acceptance（完了）

目的: 実データ、実R2、Firestore Rules、匿名Viewerを通した公開経路を確認する。

順序:

1. stagingで新しいFlow draftを作る。
2. Worksで`unlisted`へ変更する。
3. ログアウト／private windowで共有URLを開き、固定テキストとWebPの混在、font、ページ数、言語切替を確認する。
4. `unlisted`がHorizon一覧に出ないことを確認する。
5. `public`へ変更し、Horizon一覧から開けることを確認する。
6. `private`または`draft`へ戻し、一覧と匿名URLの両方が閉じることを確認する。
7. 公開期間の開始前／終了後を確認する。

静的test、build、HTTP 200だけでacceptance完了としない。実際にログアウト状態のブラウザーで操作する。

確認済み:

- JA fixedText 4ページのFlow作品を`unlisted`で匿名Viewer表示できる。
- `unlisted`はHorizon一覧へ出ず、`public`は一覧へ出て一覧リンクから開ける。
- `draft`へ戻すとHorizon一覧と匿名Viewerの両方から閉じる。
- status遷移中のconsole errorはない。
- WebP／fixedText混在の2言語v2 fixtureを、JA／EN-USとも各2ページで匿名Viewer表示できる。言語切替と表示page数も一致する。
- 同じ多言語v2 fixtureで`unlisted`非掲載、`public`掲載、`draft`復帰後の一覧・匿名URL閉鎖を確認した。canonical JSONの言語key順が異なる場合も言語集合を安全に照合する（`6cbc4de`）。
- staging fixtureで公開期間の開始前／終了後に、Horizon一覧と匿名Viewerがともに閉じる境界を確認した。対応する境界test checkpointは`879666d`。
- 使い捨てv1 fixtureで`draft -> unlisted -> public -> draft`を実操作し、匿名Viewer、Horizon掲載境界、2ページ表示、console errorなしを確認した。確認後にProjectを削除済みで、残るWork／Release／R2実体はUnit P3のorphan候補として扱う。v1 mapのkey順差修正checkpointは`00c8f41`。
- ログイン済みWorks直リンクを再読み込みしても、再クリックなしで所有者の作品一覧へ復帰する。未ログインの独立ブラウザーでは作品を表示せずログイン要求になる（`5cecb17`）。

最終確認:

- 2026-09-05、人間が上記staging結果を最終確認した。Unit P2を完了とし、次はUnit P3へ進む。

### Unit P3: 公開運用のhardening

初回公開acceptance後に、次を別単位で進める。

- partial uploadで公開されずに残ったR2 objectの棚卸しとorphan cleanup方針
- 公開切替失敗時の再試行表示と診断情報
- `r={releaseId}`による版指定URL
- rollback／過去release再公開のUIと監査
- private metadataとR2実体の保護境界の再確認。現在はopaque URLを知る者に対する物理遮断を保証しないため、必要ならsigned URL／proxy／削除jobを別設計する
- production migrationはstaging acceptanceと人間の別承認後に行う

2026-09-05 実装済み（staging実ブラウザー確認前）:

- 所有者が明示実行する読み取り専用R2棚卸し、参照照合、7日保持を含むorphan候補分類を追加した。分類結果はすべて`safeToDelete:false`で、自動削除は行わない。
- Press／Worksの失敗表示をredacted診断へ統一し、`retry-safe`だけ再試行可能にした。生のError message、stack、token、payloadは表示しない。
- 新規共有URLを`r={releaseId}`で現在公開中のReleaseへ固定した。`r`不一致はfail closed、`r`なしの既存v1/v2 URLは維持する。
- 詳細契約は[docs/dsf-release-operations-hardening.md](dsf-release-operations-hardening.md)に記録した。

この時点で意図的に残す範囲:

- R2 objectの実削除、自動cleanup、物理失効
- rollback／過去release再公開と、それに必要なactive Release／監査契約
- Firestore schema／Rules変更、production migration
- commit／staging deploy後の実ブラウザーacceptance

## 6. Flow編集の残作業

公開経路の完成後、次の順を推奨する。

### Unit E1: Word相当の基本操作の穴を閉じる

- 縦書きBlock境界でのBackspace／Delete結合
- `Shift+Enter`相当のsoft line break
- Heading途中のEnter／Heading分割
- 選択範囲を含む構造編集

各操作はsemantic transactionとして実装し、DOM fragmentの直接書換えを正本にしない。Undo／Redo、translation stale化、caret復元、増分reflowを同じ受け入れ条件に含める。

### Unit E2: 複数Block／複数ページ選択

- 選択端をsemantic Block IDとgrapheme offsetで保持する。
- 再ページ化後も選択方向と範囲を復元する。
- PageBreak、Heading、翻訳dataを跨ぐ削除は、最初にpure transactionの許可規則を定義する。
- ブラウザーSelectionや生成DOM nodeを保存データへ持ち込まない。

### Unit E3: 翻訳ページの直接編集

- 原文fallback表示と実翻訳本文をUIで明確に区別する。
- fallback中は直接編集を開始しない。
- 翻訳本文を編集した場合だけ、該当languageのtextとtranslation stateを更新する。
- 原文のBlock構造とPageBreakは共有し、翻訳側で勝手に構造を分岐させない。

## 7. Fixed／画像／見開き／Flowの統合UI

### 現在

- Project v6のauthoring spineにはFixed BlockとFlow Groupを混在できる。
- Fixed Pageの安全な移動／削除／Flow Group前後への挿入は実装済みである。
- Flow Groupは誤移動防止のため、サムネイル上で`SOURCE`として位置固定されている。
- Flowの生成ページはruntime派生物なので、生成ページ単位のdrag／削除／保存は行わない。

### 推奨する完成形

UIでは、Fixedテキスト、画像、見開き、Flow生成ページを分離せず、一つの横スクロールページ列として表示する。ただし内部モデルは次のように維持する。

```text
Fixed Block
Flow Group A -> runtime page 1, 2, 3
Image Block
Flow Group B -> runtime page 4, 5
Spread Block
```

画像ページをFlowの途中へ差し込む最初の安全な方式は、挿入するsemantic位置でFlow GroupをA／Bへ分割し、その間へFixed Image Blockを置くことである。生成page indexだけを挿入anchorにしてはいけない。前方編集でページ境界が変わるためである。

将来、文章の一部として画像を流し込みたい場合は、別途semantic `image` BlockをFlowDocumentへ追加する。Fixed Image Blockの仕組みをFlow内へコピーしない。

推奨実装順:

1. Flow Groupを一単位としてspine内で安全に移動するpure transaction
2. サムネイルでFlowの生成ページ数と作品通しページ番号を表示
3. 全page kindを一つの横スクロールcanvas／thumbnail列へ投影
4. semantic位置でFlow Groupを分割し、間へFixed Pageを挿入
5. 必要性を確認してからFlow `image` Blockを設計

## 8. 組版・表示補助の残作業

- 現在の罫線は本文の行／列送りを示す補助であり、文字サイズと余白が異なるHeadingとは一致しない。
- 見出しまで本文罫線へ強制的に合わせると、現在の見出しデザインとpaginationを変えてしまう。
- 最初の安全な改善は、本文罫線を維持しつつHeading領域では罫線を弱める／隠す、またはHeading boxを別表示することである。
- 一般的な均等揃え、インデント設定UI、方眼、guide色／pitch設定は未実装である。
- 縦中横、ルビ、圏点、割注、完全な行頭／行末禁則、RTL、段組みは将来拡張である。
- U+2026三点リーダーの縦書き中央表示はrenderer v6で対応・実font確認済みである。

## 9. 長文性能とインフラの残作業

- 100ページ以上の実作品で、入力遅延、pagination時間、DOM node数、memory、保存payloadを継続測定する。
- 現在の増分pagination／cacheを維持し、まず計測してからvirtualization範囲を決める。
- Horizon／Dashboardの軽量summaryとprogressive readは実装済みだが、大量作品・大量reviewでの実測は継続する。
- 公開用長文本文をFirestoreへinline保存しない。R2上のimmutable DSF v2 contentを正本とする。
- 画像・font・JSONのCDN cache keyはrelease ID／content hashでimmutableに保つ。

## 10. 初期Flow公開のDefinition of Done

- [x] Flow原稿を作成、保存、再読込できる
- [x] 横書き／縦書きで自動paginationできる
- [x] 生成ページ上で基本的な直接編集ができる
- [x] PageBreakを保存・反映できる
- [x] Fixed PageとFlow Groupを同じ作品に保存できる
- [x] 翻訳Providerと発行言語選択が使える
- [x] Noto Sans JP／Noto Serif JPを検証済みfontとして使える
- [x] WebP／fixedText混在のportable `.dsf`を作成・閲覧できる
- [x] Horizonへ非公開draftを保存できる
- [x] 所有者だけがdraft Viewerを確認できる
- [x] WorksでDSF v2を`unlisted`／`public`へ安全に切り替えられる
- [x] 匿名Viewerで実共有URLを閲覧できる
- [x] `unlisted`／`public`／`private`／`draft`の一覧・URL境界が正しい
- [x] 公開期間開始前／終了後の境界が正しい
- [x] v1作品の公開・閲覧に回帰がない
- [x] staging実ブラウザーacceptanceを人間が確認する

## 11. 作業開始時の確認手順

次の担当者は、実装前に必ず以下を行う。

1. `CLAUDE.md`、`AGENTS.md`、本書、変更対象の正本文書を読む。
2. `git worktree list --porcelain`、`git branch --show-current`、`git status --short`、`git log -1 --oneline`を確認する。
3. `package.json`の現在の`verify:*` scriptを確認する。
4. 無関係な変更をstage、restore、削除しない。
5. 一つのUnitだけを実装し、静的検証と実ブラウザーacceptanceを分けて報告する。
6. データ形式、Firestore Rules、公開境界を変更する場合は、人間の承認範囲を再確認する。
7. commit／deployは明示指示があるまで行わない。

現在の推奨開始点は **Unit P3の最初の安全単位: 削除を伴わないR2 orphan候補の棚卸しと保持方針の設計** である。自動削除、Rules変更、production migrationはこの単位に含めない。
