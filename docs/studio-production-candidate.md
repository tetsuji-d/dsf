# Studio 初回本番候補と段階別 Rules

2026-10-03。ローカル準備の記録。コミット・main マージ・配備・本番設定変更は未実施。

## 1. 確定した候補範囲

作業場所は `C:/Users/tetsu/.codex/worktrees/review-boundaries/dsf`、`codex/windows-file-preview` / `8ecbd04`。main / origin/main は `2d957d3`。別の Architect checkout は変更していない。今回と前回の準備実装は未コミットで、既存の `outputs/` は保持した。

本番基準 `91db176` のローカル複製へ、現行 Studio の依存ファイルと本人用 API を重ねた。直近の修正だけを無理に取り出さず、既存の制作機能を含む依存関係を採用している。これは新しいソース形式を設計したり、保存済み原稿を書き換える処理ではない。

- 候補: `outputs/production-candidate/source-a-20261003134431574`。
- 採用入力 313 ファイル、本番基準に対する内容変更 227 ファイル。厳密なファイル一覧・理由・SHA-256 は `source-manifest.json`。
- Studio: ダッシュボード、保存状態、クラウド読込表示、未編集復元と更新、復元コピー、本人のスペース・履歴、現行の編集・Press 関連依存を採用。
- API: 既存 API の現行依存に、本人用 `publishing-spaces` / `recent-activity` / `project-trash` を追加。本文の private R2 読込・保存、非公開画像、既存の作成対象制限を維持。
- `viewer.html` / `js/viewer.js` / `css/viewer.css`、Portal・マイページ・管理画面の入口は本番基準を保持。新しい `review-client.js`、招待・個人共有・共有スペースの API 入口は含めない。
- Windows ネイティブ部品を含めない。Studio のインストール案内と更新機構は採用し、候補の Web Manifest から `file_handlers` を外して新規 OS ファイル関連付けを保留。
- package.json と lockfile は本番基準。依存パッケージ定義が現行と同じであることを確認。新しい検証コマンドだけを不完全に混ぜない。
- 候補の `firestore.rules` は実配備と一致する A0。作業ブランチの最終 Rules を混入させない。

**共有部品には変更がある。** Viewer 本体を据え置いても、保存・画像・原稿モデルなど変更された依存ファイルを Viewer が 70、Portal・マイページ・管理画面がそれぞれ 36 参照する（ビルド時の依存グラフ、動的 import を含む）。`source-verification.json` に全件記録した。「Viewer は無変更」とは扱わず、公開作品の互換確認を本番前の条件に残す。

この複製はレビュー・ローカル検証用であり、配備用 checkout ではない。承認後に main を基準とした清潔な配備候補へ内容を反映する。outputs 内で配備コマンドを実行しない。途中で作成した別の `source-a-*` は不採用で、採用先は `source-manifest.json` の snapshot に限定する。

## 2. 本番 Rules の読取照合

`scripts/audit-production-rules.mjs` で Firebase Rules API の GET のみ実行した。認証情報の本文を保存・表示していない。

- 照合時刻: 2026-10-03 13:34:18 UTC（22:34:18 JST）。
- project: `vmnn-26345`。
- ruleset: `3e90f5b9-ef0a-429e-b95d-a597e7373719`。
- 配備更新時刻: 2026-09-20 01:35:47 UTC。
- 本文は `91db176:firestore.rules` と一致。現在の作業ブランチの Rules とは異なる。
- 本文・照合結果: `production-live.rules` / `production-rules-audit.json`。

改行を LF に統一した SHA-256:

| 候補 | 含む制約 | SHA-256 |
|---|---|---|
| `a0-baseline.rules` | 現在の本番 | `4c067ea33e4f8a98842f73609ea66596a3ad49a5cbc173e941a3291a4ae0f76f` |
| `a-trash.rules` | ゴミ箱保護 T | `d946ca9ac1fdd7b72f76eb0c1a4e1a0456bb1ac136cd61e53e6a302af2e965cc` |
| `b-trash-review.rules` | T + レビュー保護 R | `e647166e690f8009b9afd717dbff5ffc3bd334497a8deb9155b12813ffa86bc0` |
| `c-trash-review-publication.rules` | T + R + 発行所属条件 P | `f103ac5238ee231667d5c0d8e3731233d9244c9096e0a5641583aa5b3e90bd4f` |

`scripts/prepare-production-rules.mjs` は本番と基準・審査対象 Rules のハッシュ一致を要求し、既知の範囲を外れる変更があれば停止する。各候補に対応した `firebase.<段階>.json` も生成した。ルートの firebase.json / firestore.rules は変更していない。

## 3. 設定と適用順序

| 段階 | Pages / UI | Rules |
|---|---|---|
| A 初回 | 本人用スペース・履歴 true。新規ゴミ箱移動・共有・招待・共同編集・発行所属必須 false | A0 を維持 |
| T | A のまま、旧式完全削除を復活させない | T を適用し通常保存を確認 |
| A ゴミ箱開始 | `PROJECT_TRASH_ENABLED` と `VITE_PROJECT_TRASH_ENABLED` を true | T を維持 |
| B 別単位 | 対応レビュークライアントを別候補として組み込む | T+R |
| C 別単位 | `PUBLISHING_SPACE_REQUIRED` と `VITE_PUBLISHING_SPACES_REQUIRED` を true | T+R+P |

今回のソース複製だけに `PUBLISHING_SPACES_ENABLED=true` を設定した。元の wrangler.toml と本番環境は false のまま変更していない。候補の新規ゴミ箱移動は無効だが、既に保管された原稿の読取・復元経路は保持する。

既存の Firebase Auth・Firestore・R2 binding と原稿 API を使い、新しい IAM 権限や Storage Rules は要求しない。現 IAM・Secrets の存在、実際の Pages 変数上書きは直前照合が必要。招待のインデックス配備は初回対象外。既存 index を空の定義で置換しない。

現在の一括 `deploy:prod:safe` は最終 Rules → Pages の順なので、この段階導入にはそのまま使わない。clean/main/remote の確認を維持した Pages 単独配備と段階別 Rules の適用を分ける。ゴミ箱利用開始後は T を外さず、新規移動を止めても復元経路を残す。原稿 API 停止を巻き戻し手段にしない。

## 4. 検証結果

- T / T+R / T+R+P のローカル Firestore エミュレーター検証: 8 実行、合計 310 チェック成功。通常 v5/v6 保存、公開版の維持と停止、復元、直接削除拒否、原稿・管理情報の隔離を全段階で検証。所属条件は C だけ有効。B/C のレビューは各 80 チェック。
- ゴミ箱検証の初期原稿は全段階で非公開 draft に統一した。以前のテストは所属制約で public 作成が拒否されることに依存していたため、T だけの場合に公開原稿の読取を誤って拒否期待していた。公開読取は別途明示して検証する。
- 分離した候補自身の production ビルド成功。保存・復元・更新・private authoring・発行操作・ゴミ箱・本人スペースの 8 検証スクリプト成功。検証用 fixture も現行のものを候補内の scripts に揃えた。これらは配信ファイルに含まれない。
- 実画面: 分離候補の未ログイン Dashboard → 設定を操作し、共有・招待・新規ゴミ箱入口が表示されないことを確認。
- 実画面: 本番基準の Viewer と更新された共有部品で、既存の検証用 DSF v1/原稿 v5 を読み込み、画像と作品情報・タイトルが表示された。両画面の JavaScript error ログは 0。検証用 DSF は専用ローカル URL で提供し、dist へコピーしていない。
- ビルドの大きな chunk 警告は残る。認証付きクラウド通信・複数ページの実読書・本番の既存公開作品まで完了した証拠ではない。

生成・検証の入口は `scripts/prepare-production-source.mjs` / `verify-production-source.mjs` / `verify-production-rules.mjs`。Java は既存 Android Studio の `jbr` を利用し、新規インストールしていない。Rules の検証は localhost と demo project のみに限定。

## 5. 本番承認へ進む前に残る確認

1. 分離候補を認証付きで検証し、専用原稿のクラウド読込 → 無編集更新 → 復元を繰り返す。実編集、保存失敗、別タブ競合の保護も確認する。
2. 旧 Firestore 原稿と private R2 原稿を別々に確認し、本文・画像・保存先・head と既存 Release を保持する。
3. 既存公開／限定公開作品の具体的な URL で画像表示・ページ送り・作品情報を確認する。今回の合成 1 ページ DSF を代わりにしない。
4. 現在の Pages 配備、設定上書き、binding、Secret の存在、IAM、index と Rules を直前照合する。秘密値を記録しない。
5. 確定した候補・設定・段階別適用順と復旧手順を対象として、必要な本番反映・main マージ・権限ルール適用の承認へ進む。

現時点の結論は「本番に出す対象を具体的なファイル候補として分離し、ローカル検証を通した」。本番配備可能の最終判定はまだ出していない。
