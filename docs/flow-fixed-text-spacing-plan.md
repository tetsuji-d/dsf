# Flow固定テキスト配信：空白保持の互換拡張

2026-08-31設計、2026-09-01 Architect承認・実装・ローカル検証済み。同日、コミットとステージング配信の指示を受領。本番反映は対象外。

## 結論と承認内容

先頭／連続半角spaceとTABの幅を保つには、新しく出力するFlowに限って適用する、明示的な配信指定が必要。
今回の承認・実装はこの任意拡張だけ。均等揃えの一般対応、罫線・方眼、インデントUIは含めない。
原稿のDSP形式、本文文字列、source offsets、固定ページの寸法、Viewerでリフローしない原則は変更しない。

採用した指定：言語manifestの既存`styles`内に限定enum `whiteSpaceMode: "preserve-v1"`を追加する。
任意CSSを受け付けるものではなく、以下の固定描画規則を表すversion付きの値とする。

| 配信データ | 新Viewerの動作 | 現行Viewerの動作 |
|---|---|---|
| 指定なし（既存Fixed／既存Flow） | 現行の`nowrap`描画を維持 | 従来どおり表示 |
| 新指定あり | 幅を保持する新しい固定行描画 | 未対応styleとしてDSFを拒否 |
| 不明な指定値 | 明示的に拒否 | 明示的に拒否 |

指定を省略したデータへ新しい既定値を補完しない。既発行DSFの書換えや、Flowという種類だけでの暗黙切替はしない。
新指定を使うDSFは対応Viewerが必要になる。旧Viewerに字下げ等の崩れたページを表示させない。

## 現行コードで確認した根拠

- `css/viewer.css`の`.viewer-fixed-text-line`は`white-space: nowrap`。Flow本文は`pre-wrap`。
  既存の行座標だけでは、行の途中で圧縮される複数spaceの距離を復元できない。
- `js/dsf-delivery-v2.js`の`validateStyle()`は未知style propertyを拒否する。
  一方、未知line propertyだけの追加は現行validatorが受け入れてしまうため、新機能の必須性を伝えられない。
  実validatorでこの差を確認した。新指定はstyle側に置き、旧Viewerの安全な拒否を維持する。
- `js/flow-publication-projection.js`は本文とsource rangeの一致を厳格に検査する。
  半角spaceをNBSP／全角spaceへ置換して通す方法は採用しない。
- `white-space: pre`への単純切替だけでは、runに保持したLFが余分な表示行を作る。
  空白を保持する規則と、すでに確定済みの行境界を二重に描画しない規則を一緒に定義する必要がある。

承認に基づき、既存styleへの任意拡張としてDSF delivery v2／言語manifest v1を維持した。
数値versionが同じでも使用時に必須の描画capabilityであり、古いViewerは描画前に拒否する。
`docs/fixed-text-delivery-contract.md`と`docs/file-format-spec.md`へ正式に反映した。

## 空白保持単位の描画規則

1. 半角spaceは先頭・途中・末尾を含めて保持する。全角spaceとNBSPも原文のまま扱う。
2. TABは現行Flowと同じ固定tab stopを使う。現行の既定は8スペース相当であり、実装時に実computed値を確認する。
   想定外のtab幅は推測して通さない。この単位でユーザーのTAB幅設定を新設しない。
3. 各line／columnの改行位置はPressで確定済み。run内のLFは元の文字列・source rangeとして保持するが、
   Viewerに追加の行／列を作らせない。DOMの本文連結結果も原文と一致する実装を検証する。
4. 新方式の実Viewer DOMと同じ構造・styleをcapture probeに使用し、全可視文字の位置・寸法を照合する。
   未測定、範囲外、再現できない空白や字間は理由付きで停止する。
5. Viewerは文字を測って再配置せず、配信済みの固定行／列を正規ページ上へ置く。
   書体・同梱font・配信JSONの既存検証も維持する。
6. `preserve-v1`はinline進行を`direction:ltr`へ固定する。縦の列は従来どおり右→左。RTL入力のcaptureは停止する。
   作者の中央／後端揃えは実測座標に含め、配信styleを`textAlign:start`にして二重の整列を防ぐ。
   原稿・snapshotの揃え設定は変更しない。行boxはinline終端だけ本文内へ縮め、縮小後も全Rangeを照合する。
7. 行末のspace／TAB／NBSP／全角spaceは、Flowの`pre-wrap`で本文領域外へhangする場合がある。
   幅を圧縮せず実測一致を確認した場合のみ、可視文字を含まないinline方向のoverflowを許可する。
   行途中の空白の差、cross-axis方向のoverflow、可視文字の切れは許可しない。
   改行だけの空行は計測専用のゼロ幅placeholderでfontのleadingを求め、出力には元の改行だけを保持する。

## 安全な実装順と変更範囲

1. **互換拡張を承認する**。上記の新指定、旧Viewerでの拒否、空白のみ先行する範囲に合意する。
2. **読み取り側を先に実装**。`dsf-delivery-v2.js`に限定enum検証、`viewer-fixed-text.js`に指定時だけの描画を追加。
   指定なしのDOM・style・既存Fixedは変えない。この段階では通常writerから新指定を出さない。
3. **Flow出力を接続**。Flow capture／publication projectionで新指定を明示し、対応する計測versionを更新。
   旧snapshotを使い回さず、原文無損失・全可視文字一致の検証後に既存portable／Press経路へ渡す。
4. **実描画を確認**。下記の検証を通し、対応していないケースを明示してこの単位を区切る。

主な対象：配信契約docs、`js/dsf-delivery-v2.js`、`js/viewer-fixed-text.js`、
`js/flow-publication-composition-capture.js`、`js/flow-publication-projection.js`と対応テスト。
既存Fixed projection、DSP原稿、入力処理、History、翻訳モデル、クラウド保存、発行済みデータは対象外。
commit／staging deployは別途の明示指示で行う。

## 検証条件

- Noto Sans JP／Noto Serif JP、400／700、縦／横、本文／見出し。
- 先頭・途中・末尾の半角space、複数space、TAB、全角space、NBSP、LF、空段落、手動改ページ。
- 先頭／中央／後端揃え、巨大Paragraph、ページ境界、文字選択に関係する原文・offsetの無損失。
- 新方式capture→projection→実Viewerの文字位置（許容差0.5 canonical px以内）。
- 旧DSFの表示不変、不明mode拒否、旧validatorが新指定を拒否、Fixedとの混在、portable ZIP再読込。
- 既存の保存・翻訳・Undo／Redoテスト、構文検査とbuild。OS実IMEを検証済みとは扱わない。

## 均等揃えは別単位

`textAlign: justify`だけでは、独立した折返し禁止行の途中行に元の分配が再現されない。
既存`letterSpacing`＋`styleRef`で表現できる一様な字間だけなら、行別実測・全可視文字照合を条件に
配信schemaの追加なしで対応できる可能性がある。ただし日本語の約物や和欧混在、英語の単語間伸張を一般化しない。

一般対応は測定済みの単語間隔またはrunの行内座標を正式に表現する契約が必要になる。
実際の行を`lines[]`に維持し、文字ごとの疑似line大量生成、本文置換、常時WebP化は採用しない。
低コスト配信のため、通常行の小さいデータ構造を維持し、圧縮後容量・DOM数・字形連結への影響を評価してから別途承認する。

## 今回の状態

実装済み。`fixed-text-whitespace.js`をViewerとcaptureが共有する。新Flowの本文・見出しstyleに明示指定し、
rendererVersionを8へ更新してv5／v6／v7の計測snapshot再利用を拒否する。既存Fixed projection・作者の本文・
DSP構造・入力処理・翻訳・History・クラウド保存は今回変更していない。前回の未コミット修正は保持。

### 2026-09-01検証

- ローカルChromium、実認定WOFF2のNoto Sans JP／Noto Serif JP × 400／700 × 縦／横の8条件。
  16入力条件、計128条件でcapture→projection→実Viewerの全Range比較・本文/offset無損失・DSP保存再読込が合格。
  最大差は約0.0293 canonical px（許容差0.5px）。Flowの実computed `tab-size:8`も確認。
- 入力条件：先頭／中央／後端揃えの空白混在、見出しの先頭／後端揃え、Heading＋本文＋手動改ページ＋空段落、
  空白/TAB/NBSP/全角空白混在の2,400字長文を3揃え、途中・先頭・末尾の空行を3揃え、改行のみ、space/TABのみ、
  長い英文、日本語3,000字。spaceの圧縮を許す旧例外は削除し、末尾空白も幅を比較した。
- 同じ環境の均等揃え長文は`FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH`で停止することを確認。一般対応は別単位。
- 関連31検証script、変更JSの構文検査、`git diff --check`、`npm run build:staging`合格。
  lint／TypeScript scriptは未設定。既存保存・翻訳・Undo／Redoも関連検証に含む。
- portable ZIPの実assemble→font同梱→ZIP→local loaderをNodeで往復し、新style・本文・source rangeを維持。
  既存Fixed＋imageとの混在、旧style未補完を検証（このtransportテストのfontは合成fixture、glyph比較は上記実font）。
- 旧コミット`f4603a7`の実validatorをNodeで読み、新指定を`unsupported_text_style_property`で拒否、指定なしを受理することを確認。
  Viewerの既存DOM/CSSは指定なしでは変更しない。通常のBrowser検証にconsole errorなし。

この単位ではOS実IME、ブラウザーUIからのDSFファイル選択、クラウド保存、Horizon発行、他ブラウザー実機は未再検証。
commit／staging deployは別途の明示指示で行う。
