# プロジェクト画像ライブラリ

Editorの左側「アセット」はProjectに属する画像保管庫。使用されていない画像も保存する。

- 取り込みは既存のクライアントWebP encoderを共用。長辺7680pxを上限に縦横比を維持し、小画像は拡大しない。変換後25MiBを超える画像は登録しない。
- 元ファイルそのものは保持せず、変換済みWebPと軽量サムネイルを保存する。ページ配置時の再圧縮はしない。
- 複数ファイルは逐次処理する。失敗前に完了した画像は保持し、プロジェクト・ユーザー切替後は取り込み結果を別作品に追加しない。
- 左パネルで名前検索・使用中表示・選択画像ページへの適用・画像ページ追加ができる。Flow選択中の追加はFlow Group全体の後。Flow本文を画像へ変換しない。
- 画像の登録・配置はUndo/Redo対象。削除・R2 cleanupは実施しない。

## 保存

`projectAssets`配列の各要素は`id`, `name`, `background`, `thumbnail`, `width`, `height`, `byteLength`, `mimeType: image/webp`を持つ。画像本体は既存IndexedDB/R2、配列はProject v6のowner用`authoring/current`に保存する。アセットを追加したFixedプロジェクトも既存v6経路へ移行する。公開root projection、DSF delivery、Viewerにはライブラリを含めない。既存Rules・保存先を使用し、Rules変更はない。

DSPは使用・未使用の両方のWebP実体を`assets/library/`へ同梱する。インポート時にarchive内参照・画像signature・decode結果・寸法・byteLengthを確認してから復元する。既存ページと同一内容の画像は復元時に同じObject URLを共有する。ライブラリを持たない既存DSPの経路は維持する。

検証: `node scripts/verify-project-assets.js`。ブラウザーでは8000×4000→7680×3840、300×180維持、複数取り込み・検索・配置・再読込・未使用画像を含むDSP往復を確認する。
