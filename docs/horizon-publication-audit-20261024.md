# Horizon 公開機能棚卸し（2026-10-24）

対象は main `96b7a05`（origin/main とローカル参照一致、`1bdca31` を包含）。リモートfetch、配備、実アカウントの公開状態変更はしていない。以下の「実装済み」はコード上の接続を指し、実環境での一連の操作合格とは区別する。

## 作業環境

- 専用worktree: `C:/Users/tetsu/.codex/worktrees/horizon-publishing/dsf`
- 専用branch: `codex/horizon-publishing`、開始HEAD `96b7a05`
- 元の `C:/Users/tetsu/projects/dsf` は `codex/refactor-viewer-modules` / `2afa354`。多数の変更と未追跡outputsがあるため変更していない。
- 既存Writingは `feature/dsf-writing-w0` / `179b848`。確認時は `?? outputs/` のみ。保持した。
- mainは別worktree `C:/Users/tetsu/.codex/worktrees/private-authoring-main/dsf` にある。

## 公開経路

| 段階 | 実装済み | 残件・確認事項 |
|---|---|---|
| Studio / Press | 発行言語選択、検証、Flow fixedTextと画像のv2組立、immutable release upload、receipt照合、非公開draft保存、Worksへ遷移。従来WebP発行も存在 | 実token・R2・Firestoreを通す再確認、途中失敗・中止・再試行・再発行の通し確認 |
| Works | v1/v2一覧、public/unlisted/private/draft切替。Project/Work/Release照合、公開用表紙・タイトル検証、公開index更新と旧index除去。private-authoring対象はサーバーaction、legacyはFirestore transaction | 競合、期限、拒否、取り下げ、旧release URLの実動作。関連テストに実装変更に追従していない静的assertあり |
| Horizon | public_projects取得、publicかつ期限内を抽出、カードからReaderへ遷移。匿名表示の起動経路あり | クエリはupdatedAt順で取得件数制限後にクライアント絞込み。unlisted/期限切れが取得枠を占めるため、掲載漏れを防ぐページング・取得設計を優先。実データで空一覧・再試行・表紙・出版者表示を確認 |
| Reader | work URLから公開indexを解決。v2 content/manifest/hash/origin検証、認定font、画像/fixedText表示。v2失敗時の旧v1へのfallback禁止。期限判定、owner専用draftプレビュー、release指定照合も存在 | 匿名/別アカウントで公開/限定公開/非公開/期限切れを実確認。多言語・縦横・モバイル・再発行後URL・通信失敗を通し確認 |

主な根拠: `js/press.js`, `js/flow-press-horizon-release-upload.js`, `js/flow-press-horizon-draft-write.js`, `js/works.js`, `js/works-publication-transition.js`, `js/works-dsf-release.js`, `server/private-authoring/actions.js`, `js/portal.js`, `js/viewer.js`, `js/dsf-horizon-viewer-load.js`, `js/publication.js`, `firestore.rules`。

## 仕様と運用の注意

- `docs/pressroom-spec.md` の末尾段階記述はWorks v2公開を無効とするが、現行Worksではpublic/unlistedが選択可能でtransition実装へ接続済み。`docs/data-model.md`にも段階履歴が残る。履歴の「未接続」を現状の未実装と数えない。
- `CLAUDE.md` / `AGENTS.md` のWebP-only説明と、現行の認定fontによる固定組版fixedText v2との関係を明記する必要がある。リフローではない。`docs/fixed-text-delivery-contract.md`と実装を基準に整理する。
- 出版スペースへの所属と、作品のpublic/unlistedは別の操作。現行設定ファイルは本番 `PUBLISHING_SPACE_REQUIRED=false`、previewはtrue。文書の「本番無効」と設定にも差異がある。実配備の環境変数は未照合。
- unlistedはHorizon一覧から除外するが、URL解決用public_projectsには存在する。Firestoreは公開indexの匿名readを許すため、秘密情報や厳密なアクセス制御として扱わない。
- private/期限切れへの変更でR2直URLの物理遮断は保証しない。仕様でも別課題。変更する場合は配信・権限設計の合意が必要。
- 本番反映済みWriting道具バーは今回の再実装対象外。

## 実行した検証

合格: `verify-portal-public-feed`, `verify-dsf-horizon-viewer-load`, `verify-publication-window`, `verify-owner-draft-viewer`。

不合格:

- `verify-works-dsf-release`: 英語削除文言を `Delete` と固定するassertで停止。
- `verify-flow-press-horizon-release-upload`: dynamic import表記を期待するassertで停止（現行Pressはstatic import）。
- `verify-flow-press-horizon-draft-write`: 同様にdynamic import表記を期待するassertで停止。

この停止を公開機能自体の故障とは断定しない。ただしテスト全体は合格しておらず、後続assertの結果も保証しない。ブラウザ、build、実Firebase/R2、実共有URLの受入は今回未実施。

## 推奨する実装順

1. **現状契約と検証の整備**: 仕様の現行到達点を更新し、上記3検証を現在のimport/文言へ追従させる。公開境界の振る舞いを検証する形を優先。既存データ形式変更は不要。
2. **最短の公開往復をstagingで成立させる**: Flow+画像の作品1つでStudio保存→Press draft→owner preview→Works public→匿名Horizon→Readerを確認。legacyとprivate-authoring経路を別々に扱い、失敗箇所だけ修正。必要な環境設定・Rulesの配備状態も照合する。
3. **Horizonの掲載取得を修正**: 件数制限後フィルタによる掲載漏れを解消する。ページング、空状態、通信再試行を整える。クエリ/index変更は必要性を確定してから行う。
4. **公開状態と更新の境界を完成させる**: unlisted、private、期限開始/終了、拒否、競合、再発行、旧URL、途中upload失敗とretryを検証・修正。metadata非公開化と物理asset遮断を混同しない。
5. **掲載品質と閲覧体験**: 表紙・タイトル・出版スペース名、多言語、縦横、スマホ、リンク、font取得失敗、再読込を確認。検索・分類の拡張は基本の掲載が安定してから。
6. **レビューとリリース**: 対象検証とbuild、staging受入の証跡を揃え、人間レビュー後にmainマージと本番配備を個別に進める。

次の開発単位は1と2。新規に公開機構を作り直す段階ではなく、既存経路を実環境で確定し、掲載取得と失敗時挙動の穴を埋める段階である。
