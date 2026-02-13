# PROJECT_STATUS

## 目的
Webtoonスタイルの縦スクロールコミックを作成できるWebエディタ「DSF Studio Pro」およびモバイル向け閲覧ビューワー。

## 現状
- **ステータス**: 稼働中 (ローカル / Firebase Hosting)
- **テストURL**: (未記載だが `firebase.json` によりHosting利用を確認)
- **主要制約**:
    - PC(エディタ) / Mobile(ビューワー) の利用を想定。
    - 認証機能がなく、全ユーザーが全プロジェクトにアクセス・編集可能（セキュリティリスクあり）。
    - プロジェクト一覧は全件取得のため、件数が増えると重くなる。

## ローカル起動手順
```bash
npm install
npm run dev
```

## デプロイ手順
```bash
# ビルド
npm run build

# Firebaseへのデプロイ
firebase deploy
```

## 既知の問題 (優先度順)
1.  **セキュリティ**: 認証(Auth)未実装のため、APIキーがあれば誰でもDB読み書きが可能。
2.  **スケーラビリティ**: プロジェクト一覧取得(`js/projects.js`)がページングなしの全件取得になっている。
3.  **CORS**: `js/firebase.js` 内で画像処理時にCORSエラーの懸念あり（`crossOrigin = "anonymous"` はあるがサーバー設定依存）。

## 次のTODO (優先度順)
1.  Firebase Authentication導入 (ログイン/登録)
2.  Firestore セキュリティルール設定 (User IDに基づくアクセス制御)
3.  プロジェクト一覧のページネーション実装
4.  PWA化 (オフライン対応、インストール促進)
5.  画像アップロード時の圧縮/リサイズ処理の最適化 (現在はクライアント側で実施)
6.  Undo/Redoの強化 (現在はメモリ内のみ、リロードで消失)
7.  エクスポート機能の拡充 (画像としての書き出しなど)
