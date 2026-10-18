# Reader／Writingのオフライン準備と下書き復帰

2026-10-19。作業先は `C:/Users/tetsu/Documents/Codex/dsf-writing-w0`、ブランチは `feature/dsf-writing-w0`、基点は `73f07d4`。本変更はローカル実装・検証のみ。コミット・デプロイは未実施。

## 操作

1. ReaderのHorizonメニュー →「オフライン・端末内の下書き」→「Reader／Writingをオフライン用に準備」。
2. 「準備済み」の表示を確認する。Writingの保存パネルからも同じ準備を実行できる。
3. 再起動後は同じブラウザーで `/viewer` を開き、端末のDSFRを選ぶか、メニュー内の下書きを選択する。
4. 下書きはページ位置・言語・現在状態・Undo／Redo履歴を復帰する。再開後も元の下書きIDと競合検出versionを使う。新しい下書きには元ファイル名も記録し、書き出し時に引き継ぐ。
5. 入力・履歴操作・編集用／共有用のDSFR生成を行う。ファイルへの保存完了は従来どおりユーザーの明示確認で扱う。

下書きはブラウザーのIndexedDBに残る。別ブラウザー・別端末への移動はDSFRを使う。ブラウザーのサイトデータ削除や保存領域の破棄を越えた保持を保証するものではない。

## 実装

- `reader-writing-offline.js`：Readerのメニュー、準備・SHA-256再確認、下書き一覧。JA／EN対応。
- `reader-writing-offline-worker.js`：Writing有効ビルドだけで既存のroot Service Workerに組み込む。通常起動資源とSDKを既存の検証済みshellからコピーし、Writing・入力用2書体・WASM等はビルド時の固定一覧とbyteLength／SHA-256を照合して保存する。
- 全資源の保存が終わってからsnapshot参照を切り替える。取得失敗・版不一致・容量不足では候補だけを破棄し、前回の完成済みsnapshotを保つ。下書きDBには触れない。
- Readerのナビゲーションはonlineを優先し、通信不能時には準備済みReaderへ復帰。Writing資源もroot workerから取得できる。既存の `/writing/` 専用workerだけでは、`/viewer` 内のWriting overlayの通信は扱えなかった。
- 準備済みsnapshotにはReaderの依存資源も含む。通常shell cacheが欠けてもsnapshotから取得できる。準備状態の確認では保存済み資源を再hashし、欠落・破損を準備済みと表示しない。表示中のReaderと準備版が違う場合は再準備を案内する。
- オフラインのローカル起動を認証redirect解決待ちで止めないよう修正。owner draft／work／projectのクラウド読込は引き続き初回認証状態を待つ。
- DSFR原本、パッケージschema、クラウド保存先、公開権限、外部アカウント接続は変更しない。既存IndexedDB recordのmetadataにfilenameを追加するだけでDB versionは変更しない。
- productionではWriting資源と追加worker処理を出力しない。

## 自動検証

- `node scripts/writing-w1/verify-reader-offline.mjs`
  - 完成snapshot、未準備、build不一致、通信失敗・hash不一致・容量不足時のrollback、通常shell cache消失後のReader／Writing取得、破損検出と再準備、認証header／POST APIの除外。
- `node scripts/writing-w1/verify-reader-offline-file.mjs outputs/writing-w1/offline-restart-20261019/offline-editable.dsfr`
  - UI生成118,879 bytesを再読込。原本8entryの全bytes一致。新規字形の保存と以前の文字へのUndo、外部font／notice取得禁止で同一bytes再保存、共有用の履歴除外。
- 既存 `verify-file-save.mjs`、`verify-history-file.mjs`、`verify-staging.mjs` 成功。Writing配信資源80件、専用workerのoffline対象78件。
- `verify-platform-update.mjs`、`verify-platform-update-build.mjs` 成功。
- Writing有効staging build成功。別出力先のproduction buildでもWriting除外を確認。既存のchunkサイズ警告あり。

## ブラウザー操作で確認した範囲

Windows Chrome、専用origin `http://127.0.0.1:5197`、架空の8ページサンプルのみ使用。

- Readerメニューで準備 →「準備済み」。
- 「再起動前の書き込み」を配置し、下書き保存。タブを閉じてReaderを開き直し、下書き一覧を確認。
- ローカルサーバー停止、HTTP cache無効、通信遮断を設定してReaderをreload。空の起動画面からメニューの下書きを選び、文字と履歴を復帰。
- Undoで文字を取り消し、Redoで復帰。完全版の新字形を必要とする「通信なしで銀河と珈琲」へ変更し確定。
- オフラインで編集用DSFRを生成。保存された同一bytesのファイルを通常のファイル選択UIから再読込し、Readerに追記文字が表示されることを確認。
- JA／ENの準備状態表示を確認。検証後に言語を日本語、通信とHTTP cache設定を通常へ戻した。検証サーバーは停止済み。

## 検証上の限界

- 「ダウンロードで保存」のクリックと生成Blobは確認したが、ブラウザー操作ツールがBlob download完了を取得できず、通常のOS保存先への完了は今回確認できなかった。ダウンロード一覧の検査もブラウザーのURLポリシーで拒否された。代わりに、画面で生成された同じBlobのbytesを検証用ファイルに保存し、ファイル選択から再読込した。これはOS保存ダイアログの受入とは区別する。
- ブラウザープロセス全体の終了・端末再起動、iPhone／iPad実機、Filesへの保存・置き換え、Safariの保存領域制約は未確認。タブの開き直しと通信なしreloadの結果を、それらの合格とは扱わない。
- ステージング実配信でのCloudflare redirect／headersを含む受入は、デプロイ後に行う。

証拠は `outputs/writing-w1/offline-restart-20261019/`。既存のoutputsは保持している。

