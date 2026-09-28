# 出版スペースの解除・脱退 — ローカル実装・検証済み

2026-09-28。ユーザーは解除・脱退・未保存原稿保護の方針を承認。
作業場所: C:/Users/tetsu/.codex/worktrees/review-boundaries/dsf
ブランチ: fix/space-membership-lifecycle。main 2d957d3から作成後、Viewerとレビュー改修を含むf3b92b6へfast-forwardした。main自体は変更していない。

## 完了したローカル実装

- getMemberExit: 最新の参加情報と変更検出トークンを取得。所有者本人の終了操作は拒否。
- removeMember: 所有者は管理者・一般メンバーを、管理者は一般メンバーだけを解除する。自己解除は不可。
- leaveSpace: 非所有者が自分自身だけを脱退させる。
- membershipは物理削除せずstatusをrevokedまたはleftにする。endedAt/endedBy/endRequestIdを記録。
- 所有者配下memberExitChangesに操作署名、変更前後トークン、実行者、対象者、時刻、結果を保存。
- 最新トークンを条件にトランザクションで変更。同じ操作の再送だけを冪等に扱い、別操作の競合や再参加後の古い解除要求は拒否する。
- 原稿・画像・公開Release・共有作品binding・他の参加者のレコードを変更しない。
- 既存のstaging指定アカウント・スペース制限を新コマンドにも適用。利用対象を広げない。
- 編集ロックに保有者の参加情報トークンを記録し、現在権限と一致しないロックを無効扱いにする。解除された保有者の期限を待たずに、権限を持つ編集者が再取得できる。再参加しても古いfenceは復活しない。
- 旧形式のロックはトークンを持たないため再取得が必要。公開反映時は未保存保護を先に完成させる。

## 解除・脱退UIと端末内復旧

2026-09-28、利用者は「保存失敗分は本人が削除するまで保持する方式」を明示承認。先の保存方式確認は解消済み。

- 最新の参加情報で確認画面を開き、対象者・対象スペース・失われるアクセスを表示する。キャンセル、競合、通信結果不明時の同一操作再送を扱う。
- 本人脱退では同じタブの共有原稿の保存完了を待つ。保存に失敗した場合は脱退しない。他タブ・端末は利用者が先に保存する。
- 編集のたびに原稿スナップショットと取得済み画像Blobを端末内IndexedDB `dsf-shared-recovery` の `drafts` に退避する。schemaVersion:1、id、uid、spaceId、workId、revision、updatedAt、project、assets、任意のretainedを持つ。
- 成功した同じ版の通常退避だけを掃除する。保存失敗・権限失効でretainedになった下書きは、後の保存成功でも消さず、本人の明示削除まで保持する。次の編集は別の退避IDで開始する。
- 同じログインアカウントだけに一覧・内容・削除を提供し、ログアウトやアカウント変更で表示を閉じる。これはアプリ内の表示境界であり、OS利用者間の暗号化ではない。
- Homeと共有エディターから原稿JSONを確認し、取得済み画像を含む復旧ZIPをダウンロードできる。DSPとは別形式で、自動復元・自動クラウド再送はしない。未取得画像を権限失効後に取りに行かない。
- 端末保存の失敗時はメモリー内のコピーを残し、このタブを閉じずに内容を取り出すよう表示する。ブラウザーのサイトデータ消去は保持対象外。
- 固定レイアウト、DSP/DSF形式、既存保存・公開原稿は変更しない。コミット・デプロイ未実施。実アカウントの参加状態やFirestore Rulesも変更していない。

## 検証

- scripts/verify-member-exit.js: 9項目成功。所有者/管理者/本人の境界、原稿等の保持、再送、役割競合、再招待、同時終了、無効アカウント、古い招待再送、失効ロック回収、HTTPとrollout制限。
- scripts/verify-shared-recovery.js: 不変コピー、画像Blob、再起動、アカウント境界、容量不足、保存失敗分の保持、書込順序、古い保存の競合、明示削除、ZIPの原稿・画像バイト一致。
- 既存10本成功: verify-publishing-invitations、verify-member-access、verify-space-members、verify-joined-spaces、verify-shared-authoring、verify-shared-images、verify-shared-edit-lock、verify-shared-owner-boundary、verify-shared-runtime、verify-invitation-rollout。
- 実ブラウザー・ローカルfixture: 編集→保存失敗→参加解除→原稿JSONの保持、別タブと再読込後の保持、Homeからの参照、削除キャンセル、ログアウト時の非表示、所有者の解除確認/キャンセル、管理者本人の脱退成功。
- 復旧ZIPのブラウザーダウンロード完了は未確認。内容はNodeで生成してZIPを再読込し検証した。実環境の解除・脱退、実機iPhoneの確認ではない。
- npm run build:staging 成功。既存のチャンクサイズ・静的/動的import併用警告あり。

## 未ログイン・ローカル利用の現状確認

個人原稿の編集、端末内自動保存、DSP保存、DSF書き出しにはアカウント・クラウド保存を必須としていない。共有原稿の直接書き出し制限とは別の経路。
外部Firebase SDK、Google Fonts、一部サンプル画像を読み込むため、初回からの完全オフライン起動は保証していない。ロゴ/モバイルメニューのPressリンクにはログイン制限が残り、通常のPress遷移と不一致がある。
通常アプリの未ログイン状態でDSP保存操作、Press遷移、DSF書き出しボタンの利用可能状態を確認。検証ブラウザーではネイティブpromptが非対応のため、最終DSP/DSFダウンロードの完了は未確認。この調査ではゲスト機能を変更していない。

## Cloudflareの今後の候補

現在のFirebase Auth/Firestoreによる認証・権限を維持し、作品単位の制作チャットでWorkers + Durable Objects + WebSocketを検討する。R2は添付画像、Queuesは通知などの非同期処理に利用できる。D1への全面移行は不要。複数人による同時本文編集はPartyServer/Yjs等を候補に、canonical blocks、Undo、保存・競合処理の設計を別途行う。今回の解除・脱退に新サービスは導入していない。

公式資料:
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://github.com/cloudflare/partykit
- https://developers.cloudflare.com/queues/
