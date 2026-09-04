# DSF Release Operations Hardening

最終更新: 2026-09-05

この文書は、DSF delivery v1/v2 の公開運用を安全にする Unit P3 の契約をまとめる。Project／Work／Release schema、Firestore Rules、R2 object はこの単位では変更しない。

## 1. 所有者用 R2 棚卸し

- 棚卸しは Works の所有者が明示的に実行したときだけ開始する。Works 表示だけでは R2 一覧や Release 履歴を取得しない。
- `GET /release-inventory` は Firebase ID token を検証し、token から得た uid の `users/{uid}/dsf/` だけを R2 `list()` する。呼び出し側から prefix や uid は指定できない。
- response は path、byte数、upload時刻、許可した MIME／cache／DSF hash metadata に限定する。object body、token、任意custom metadataは返さない。
- cursorを使って上限付きでページングする。一覧が最後まで取得できていない場合は `complete:false` とし、「保存実体が無い」という判定を行わない。
- endpoint と UI のどちらにも R2 object の削除、更新、上書き操作を置かない。

## 2. 分類と保持方針

棚卸しは R2 path を Project／Work／Release／`public_projects` と照合し、次のように分類する。

| 分類 | 意味 | 現在の扱い |
|---|---|---|
| `published` | 公開indexが現在のReleaseを参照 | 保持。欠損やmetadata不整合は修復対象 |
| `current` | ProjectまたはWorkが現在のReleaseを参照 | 保持 |
| `historical-release` | Release履歴として正規に残る | 保持 |
| `detached-release-history` | ReleaseはあるがProject／Workとの接続が失われている | 人による確認 |
| `referenced-release-missing` | 参照はあるがRelease documentが無い | 削除せず修復 |
| `recent-untracked-upload` | Release documentが無く、uploadから7日未満 | partial uploadの可能性があるため待機 |
| `aged-untracked-upload` | Release documentが無く、uploadから7日以上 | 人による確認 |
| `untracked-upload-unknown-age` | Release documentも安全なupload時刻も無い | 人による確認 |

分類結果は常に `safeToDelete:false` である。「確認候補」は削除許可を意味しない。

将来削除を追加する場合は別の承認単位とし、少なくとも完全な再棚卸し、server側での参照再検証、十分な保持期間、対象一覧の人間承認、監査記録、失敗時の再開設計を必須とする。

## 3. 公開URLのRelease固定

- 新しい共有URLは `/viewer?work={workId}&r={releaseId}` を生成する。
- `r` は `public_projects/{workId}.releaseId` と完全一致する「現在公開中のReleaseの固定値」である。
- 不一致、不正ID、公開indexにRelease IDが無い場合は fail closed とし、別Releaseやowner専用履歴へfallbackしない。
- `r` の無い既存URLは v1/v2 後方互換のため維持する。
- 過去Releaseの閲覧やrollbackはこの契約に含めない。実装には current／active Release を分けるデータ契約と監査設計が必要である。

## 4. 再試行診断

Press／Works の失敗表示には、生のError message、stack、token、payload、receipt本文を出さない。表示可能な診断は次に限定する。

- `retry-safe` / `refresh-required` / `blocked`
- 検証済みcodeとpath
- 完了file数／総file数
- 検証済みrelease storage path
- 接続先の許可済みerror code

`retry-safe` のみ同じ操作を再実行できる。`refresh-required` は最新状態を読み直してから、`blocked` は原因を解消してから実行する。

## 5. private／draftのR2境界

`draft`／`private` は `public_projects` を削除してHorizon一覧と通常Viewer URLから閉じる。ただし現在のR2/CDNは immutable public URLを知っている者への物理的な失効を保証しない。この棚卸し機能もその境界を変更しない。

物理遮断が必要になった場合は、signed URL、認証proxy、または参照を再検証する削除jobを別設計する。production migrationもstaging acceptanceと人間の明示承認後に別途行う。
