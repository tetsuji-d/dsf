# E2E Smoke Checklist (P0-1)

目的: staging 環境で最短動線 `ログイン -> 新規作成 -> 保存 -> 公開 -> Portal表示 -> Viewer表示` を安定確認する。

## 0. 事前確認

```bash
npm run smoke:staging
```

期待結果:
- `test:firebase` が `PASS`
- `build:staging` が成功

## 1. Studio での作成と保存

1. `npm run dev` で起動し、`studio.html` を開く
2. Google ログインする（staging 用アカウント）
3. 新規ページを1枚作り、テキストまたは画像を追加
4. プロジェクトIDを設定して保存

期待結果:
- 保存ステータスが Cloud 保存成功になる
- Firestore `users/{uid}/projects/{projectId}` が更新される

## 2. 公開設定

1. visibility を `public` に変更
2. 再保存を待つ（または明示的に保存）

期待結果:
- Firestore `public_projects/{projectId}` が作成または更新される
- `title`, `authorUid`, `publishedAt` が入る

## 3. Portal での確認

1. `index.html` を開く
2. 公開した作品が一覧に出るか確認
3. 検索欄でタイトル検索できるか確認
4. 端末側確認後、以下を実行して公開件数を検証

```bash
npm run verify:e2e:staging
```

期待結果:
- カード表示される
- 検索にヒットする
- 一覧読み込みエラーが出ない
- `verify:e2e:staging` が PASS（`public_projects` 1件以上）

## 4. Viewer での確認

1. Portal カードから作品を開く
2. ページ遷移・表示崩れを確認

期待結果:
- `viewer.html` が正常表示される
- 主要操作で致命エラーなし

## 5. 合格条件

- 上記 1〜4 を 3 回連続で実施して失敗ゼロ
- 失敗時は再現手順・画面・コンソールログを記録してチケット化
