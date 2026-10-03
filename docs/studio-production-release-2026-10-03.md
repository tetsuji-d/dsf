# Studio 本番反映記録 — 2026-10-03

本番反映・コミット・権限変更の明示承認後、所有者向け Studio（A）とゴミ箱保護（T）を段階適用した。
この記録は `studio-production-rollout-plan.md` / `studio-production-candidate.md` の準備段階の未配備記述を更新する。

## 配備物

- 本番: https://dsf.ink/studio
- 実行コード: `fcf35702753af269834a755e844fa52001b724da`
- Pages: `3613bd33-b30f-4c52-b195-299ddcc55077`
- 固定配備 URL: https://3613bd33.dsf-studio.pages.dev
- バージョン: `v2026.10.03-143113`（ビルド時刻 UTC）
- 作業: `release/studio-owner-production`、配備: clean な `private-authoring-main/dsf` の main。各段階を fast-forward / push 後に Pages のみ配備した。
- 元の開発場所 `review-boundaries/dsf` と `projects/dsf` を混同していない。元の未追跡 `outputs/` は保持。

コミット: `b775674` 所有者 Studio、`8c1ee52` T のみの Rules、`3bd5777` 保存・復元判定、`eb58424` ゴミ箱有効化、`fcf3570` エディタープレビュー受信接続。
この記録を追加するコミットは文書のみで、配信コードの識別子は上記のまま。

## 本番設定と権限

- `PUBLISHING_SPACES_ENABLED=true`、`PROJECT_TRASH_ENABLED=true`、`VITE_PROJECT_TRASH_ENABLED=true`。
- 原稿 API / private R2 は継続。新規作成の許可リストは既存の所有者 1 人のまま。
- 個人共有・招待・共同編集・発行時のスペース必須化は false。レビューの新 Rules（R）と発行条件（P）は未適用。
- Firestore Rules: `projects/vmnn-26345/rulesets/7e7bd8ee-a879-4e51-a2b9-eaca4285ff51`。
- LF SHA-256: `d946ca9ac1fdd7b72f76eb0c1a4e1a0456bb1ac136cd61e53e6a302af2e965cc`（T 候補と完全一致）。
- CLI の終了ログ取得が止まったためプロセスを終了したが、Rules は反映済みだった。公式 API の読み直しで ruleset と全文ハッシュを確認。代替適用スクリプトは既に T だったことを検出して書込み前に停止した。
- 原稿バケットは非公開。既存 Secret の存在と binding を照合。IAM は datastore.user / firebaseauth.viewer の既存権限を保持し、追加なし。Storage Rules、Firebase Hosting、index は未変更。

## 検証と検証中の修正

- 専用の非公開原稿 `prod_check_20261003`（本番反映確認用 2026-10-03）を、作成・検証後に残すことへの承認を得て作成した。既存原稿は編集しなかった。
- 実ブラウザーでクラウド読込、タイトル編集、自動保存、再読込、前のクラウド版への復元を確認。画像・本文 8 ページを保持した。
- 読込直後に保存確認が再表示される不具合を修正。検証済みクラウド読込だけを保存済みの根拠とし、復元コピーや DSP 保存には流用しない。編集後は未保存へ戻る。別セッションの遅延応答を拒否する。
- 復元前に無条件で保存して同じ版を追加する不具合を修正。保留中の編集だけを保存し、直前の異なる内容へ復元できることを実画面で確認した。
- 本番の更新 UI で `v2026.10.03-142055` から最終版への更新を操作。追加保存の要求・離脱警告なし。同じ原稿が保存済みのまま再開できた。
- 本番 API で専用原稿をゴミ箱へ移動・復元。移動中は古い保存要求を拒否。前後の source bytes の SHA-256 は `8451645ab4c150e957845f2a373a2b8144feb2395825e95e4b1c6283d48cc5b5` で一致。検証原稿は非公開・復元済みで残した。
- 本番の匿名 authoring 取得を拒否。本人でも head/control、ゴミ箱管理、catalogue、最近の作業の管理文書への直接取得を拒否。
- 分離候補で欠けていた Studio → Viewer のプレビュー受信接続を追加。呼出元・同一 origin・nonce・Blob を検査し、既存の DSF 検証経路で読む。配信 Viewer の大規模変更・OS ファイル連携は取り込んでいない。
- 修正候補の実画面でプレビューの画像表示、次ページ、固定テキスト「おはよう」の表示を確認した。
- 対象スクリプト 8 本、追加した保存状態・プレビュー接続検証、ゴミ箱 6 テスト、production build が成功。段階別 Rules の準備時の検証は 8 実行・310 チェック。
- 本番 HTML（Studio / Viewer）、Service Worker、version の bytes をビルド成果物と照合した。

## 既存データと検証の限界

既存 2 原稿と public_projects 2 文書の更新日時・作品 ID・Release ID・保存先を配備前後で比較し、不変を確認した。監査 JSON の初期 sha256 は Firestore map のキー順を正規化しておらず、本文変更の判定には使わない。既存文書の不変確認はサーバー updateTime と識別子で行った。専用原稿の source bytes 比較は正規化不要の完全一致である。

既存公開作品は公開期限切れで、配備前の実 Viewer では期限終了を確認済み。公開期間の変更や再公開はしていない。公開中作品としての全ページ読書確認はできていない。本文・画像表示は非公開の検証原稿プレビューで確認した。旧 Firestore 原稿は本番の対象アカウントに現存しないため、互換性は既存テスト・エミュレーターで確認した。

大きい bundle のビルド警告は継続。共有・招待・レビュー R・発行条件 P・Windows/Mac の追加インストーラー・OS アイコン/プレビューは今回の本番範囲外。

## 復旧

ゴミ箱利用後は T を維持する。不具合時は新規移動を止め、読み取り・復元を残す。原稿 API や private binding を停止しない。今回の直前段階配備は `d9d28fa3`（A、ゴミ箱 UI/API 無効）と `29ba6196`（A+T、プレビュー受信追加前）。古い `91db176` への無条件の巻き戻しは行わない。
