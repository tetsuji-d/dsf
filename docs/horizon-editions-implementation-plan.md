# Horizon 版固定とリーズ実装計画

仕様: [horizon-editions-spec.md](horizon-editions-spec.md)。基点main 96b7a05、作業branch codex/horizon-publishing。

1. 版状態・URL・不変snapshot契約を実装。状態遷移とrevision競合、別作品へのURL流用を検証。
2. 認証済みserver APIで公開/非公開/アーカイブ/復元/廃棄を処理。旧URL固定、終了tombstone、版専用asset削除の再開を実装。Rulesでclient迂回を拒否。
3. Pressの再発行から旧公開index削除を外す。不変Releaseに原稿表示metadataをsnapshot保存。
4. リーズをRelease単位の4フォルダへ切り替え、アーカイブ/復元/シュレッダー、URLコピー、版別preview、後継指定を接続。原稿ゴミ箱操作を取り除く。
5. Readerの版URLと終了案内、後継リンク、Horizonの版別掲載を接続。v1/v2の既存検証は維持。
6. Studio共通入口をPC/mobileへ追加。
7. 対象検証、syntax、staging build、ローカルfixtureでUI操作。実Firebase/R2操作とstaging配備は別の承認を得て確認。実環境受入なしに公開運用完了としない。

## 受入条件

- 新版発行後も初版URLは初版だけを表示する。初版と第二版を別々に公開/停止できる。
- Pressの新規版は非公開に現れる。原稿変更を過去の版に反映しない。
- アーカイブで公開終了、復元で非公開。通常フォルダから廃棄不可。
- 廃棄後もURL予約記録は残り、原稿と他版は残る。途中削除は再開できる。
- 後継は同作品の現在閲覧可能版だけに案内し、循環/他人/別作品は拒否。
- 未ログイン・別owner・古いrevision・運営停止・期限切れ・不正JSONを拒否。
- Home/Editor/Press/WorksからPC/mobileでリーズへ遷移できる。

## 配備境界

新collectionのRulesとFunctionsを含むため、UIだけの先行本番反映は不可。既存データ移行前に公開indexの整合を検査し、旧Releaseが存在しない作品は移行エラーとして保持する。commit、main merge、staging/production deployは未承認。

## 2026-10-24 ローカル実装結果

| 単位 | 状態・主な実装 |
|---|---|
| 版・URL | 実装。`edition-policy.js`、不変Release、版専用public_editions。旧URLに新しい原稿を代入するfallbackを除去 |
| 状態管理 | 実装。`server/editions.js` / `/api/editions`。revision競合、初回公開snapshot、同作品の後継・循環拒否、版名 |
| 廃棄 | 実装。アーカイブ必須、tombstone先行、R2専用prefixの分割削除・再開、廃棄中upload競合防止、原稿/他版保持 |
| Press | 実装。旧公開indexを削除しない。タイトル/言語設定を版へsnapshot化。v1/v2切替時の古いlocator残留も除去 |
| リーズ | 実装。全Releaseを4フォルダ表示。選択スペースで絞込み、版名・公開・限定公開・停止・後継・アーカイブ・復元・廃棄を接続 |
| Reader/Horizon | 実装。版URL、終了案内、閲覧可能な後継へのリンク。公開版だけをページ単位取得し、旧indexとの重複を除去 |
| Studio導線 | 実装。PCのHomeでもリーズタブを表示。mobileヘッダーに常設入口 |

対象17検証が合格（一覧/出力は `outputs/horizon-editions/checks.json`）。新しい状態遷移、v1/v2、旧URL不変、別owner、公開期限、後継循環、版名、廃棄中断/再開、原稿保持、upload再生成拒否を検証した。従来の文言・import形式・Project単位UIに依存したassertは新しい境界に更新した。

Firestore EmulatorでRelease更新/削除、廃棄ID再作成、ownerによるpublic index直接write、他人による状態readを拒否することを確認。実サービスのRulesは変更していない。

加えて既存 `verify-private-authoring-rules.js` の110項目がローカルエミュレーターで合格した。旧形式でもWork/Releaseを持つ既存公開版は、既存URLを維持したまま「版の管理を有効にする」から新しい管理状態へ移行できる。移行前のURLコピーは有効な既存URLを使い、後継版候補は新管理へ移行済みの閲覧可能版に限る。

`npm run build:staging` 合格。大きいbundleの警告は残る。ブラウザでは使い捨てfixtureで公開、限定公開、アーカイブ、非公開復元、廃棄確認/キャンセル/実行、通信失敗、版名保存、JA/ENを確認。390×844で横はみ出しなし。実StudioのHome/Editor/Pressからリーズへの移動、mobile共通入口も未ログイン状態で確認した。

### 残る配備・移行・受入

- 実Firebase/R2での発行→公開→匿名Horizon→Readerの通し操作は未実施。新FunctionsとRulesを揃えたstaging反映後に確認する。
- Releaseのない旧Projectや、版専用prefix外のFirebase/共有assetは移行待ち。旧作品を一覧から隠したり、共有assetを削除して完了扱いにしたりしない。移行用の実データ調査と個別移行は別工程。
- 運営担当者による新public_editionsのclient write権限追加案は、自動承認レビューが「権限拡張の明示承認がない」と拒否したため未適用。server-only writeを維持した。新collectionの運営管理画面対応は、既存の運営操作と合わせて別途レビューする。既存の停止フラグを作者の再公開で解除しない防御は実装・検証済み。
- ブラウザ・CDN・取得済みファイルの回収は廃棄の保証に含めない。共有font/thumbnailは他版のため保持する。
- `dsf-writing-w0` は変更なし（未追跡outputsのみ）、mainも変更なし。作業は `codex/horizon-publishing` / 開始HEAD `96b7a05` に保持。commit/merge/deployなし。

### 2026-10-24 staging表示不具合の修正
- 同名行はWork配下のRelease全件を発行日時順で表示した履歴。重複生成処理ではない。
- 所有者プレビューが日本語Project IDをASCII限定検査で拒否する実ブラウザーエラーを再現。既存の安全なUnicode ID契約へ合わせ、区切り・URL escape・traversal拒否は維持。
- Releaseのthumbnail未保存時は同じ版のv1表紙を候補にする。v2等で候補がない場合と画像取得失敗時は固定枠のプレースホルダー。原稿の現在の表紙は過去版へ流用しない。
- 欠落した画像列にタイトルが詰まるgrid不具合を修正。
- owner preview回帰、edition lifecycle、release URL、project summaryとstaging build合格。staging deployment de790234完了。本番・mainは未変更。

### 発行文言と完了後の導線（2026-10-24）
- Pressの操作名を「Horizonに発行」、補足を「非公開で発行します。公開設定はリーズで変更できます。」へ変更（日英）。確認・進捗・失敗文言も版の発行に統一。
- Flow／従来形式とも、保存成功後に「発行しました」の完了ダイアログを表示。「リーズで公開設定へ」で非公開フォルダへ移動。「閉じる」とEscでPressに残る。
- staging最終deployment: 15dc7266。構文確認、Works v1/v2公開投影、Flow upload境界、owner-only draft metadata、staging build合格。
- 実画面で新しいボタン文言を確認。既存の復元原稿はAUTHORING_RELOAD_REQUIREDで発行前に停止。新規確認作品のクラウド作成を選び、プロジェクト切替確認後にChromeの操作接続が応答しなくなった。完了ダイアログの実操作と発行→公開→Readerの通し確認は未完了。既存原稿の強制保存・削除は実施していない。
- mainマージ、本番反映、コミットなし。

### リーズ一覧の余白と確認操作（2026-10-24）
- 一覧を最大1360px・中央配置、左右32px（小画面16px）にし、見出し15px・日付12px、PC操作34pxへ調整。表紙54×96px（9:16）、角丸なし、contain表示。
- 公開／限定公開への変更は公開履歴の有無で省略せず確認。画面内dialogでキャンセル・Esc・フォーカス復帰を提供。
- プレビューは従来すべてowner draft経路だった。公開／限定公開はコピーする版固定URLと同一経路へ統一。非公開はowner専用を維持。歴史版owner読込にReleaseのlanguageConfigsを継承。
- staging deployment 6a9af5a5。owner preview回帰、edition lifecycleとstaging build合格。
- 最終deployment 2390dabf（PCボタン34pxを優先する既存styleも修正）。staging実UIでprivate→unlisted/publicの確認表示・キャンセルを検証し、公開状態は変更しなかった。公開版プレビューボタンからe_993afc8c…の固定URLを開き確認用作品の表紙描画を確認。画像比率54×96、border-radius 0を実DOMで確認。証跡: reads-spacing-fixed.png / reads-confirm-dialog.png / reads-preview-fixed.png。
