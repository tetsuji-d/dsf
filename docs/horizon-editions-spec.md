# Horizonの版・公開URL・リーズ管理

2026-10-24 Architect合意。従来の「Workの現在版を差し替える」公開契約を本仕様で置き換える。

## 作品と版

Workは作品をまとめるID、ReleaseはPressが確定した版。本文・画像・ページ順・言語・本文内リンク・組版・配信locatorはReleaseの不変snapshotとする。Pressの再実行は新Releaseを作り、旧版の公開を取り下げない。原稿の編集や削除と、版の管理を分離する。

新しいReader共有URLは `/viewer?edition={editionId}`。editionIdはowner/Work/Releaseの組をSHA-256した恒久IDで、別内容へ再割当てしない。初版・第二版は別URL。最初の公開/限定公開時に内容固定を確認する。実装ではより厳密に、Pressで確定したRelease自体を上書きせず、修正時は新規発行する。

リーズの「版の設定」で「初版」「第二版・改訂版」などの版名を80文字まで付けられる。版名は案内metadataとして変更でき、本文・URL・発行snapshotを変えない。設定しない場合は発行日時で区別する。

初回公開時の公開snapshotをowner専用状態に保存し、非公開後の再公開も同じsnapshotを使う。紹介の変更を本文変更として扱わないが、原稿の現在値を旧版へ暗黙反映しない。版名は発行日時と版IDを初期表示に用いる。

## 4フォルダ

| フォルダ | 内部状態 | 閲覧 |
|---|---|---|
| 公開 | public | Horizon掲載・URL閲覧 |
| 限定公開 | unlisted | URL閲覧。Horizon掲載なし |
| 非公開 | private（従来draftもここへ表示） | ownerのプレビューのみ |
| アーカイブ | archived | 読者閲覧不可 |

Press成功後は非公開を開く。公開/限定公開/非公開からアーカイブへ移動できる。復元先は常に非公開。アーカイブ内だけに「廃棄する（シュレッダー）」を表示し、取り消せない確認を取る。廃棄した本文とその版専用配信ファイルを削除し、原稿・他版・共有font・共有thumbnailは削除しない。

物理削除は公開終了を確定してから分割実行する。失敗/途中終了時は再試行可能で、完了前に削除完了と表示しない。安全な版専用storage prefixを持たない旧データは物理削除完了と扱わず、移行対象として明示する。

期限切れは非公開フォルダへ表示する。公開の再開には現行プランと掲載期限を再評価する。運営停止は作者のフォルダ操作で解除できない。

## URL終了と後継版

非公開/アーカイブ/廃棄後もID・owner・Work・Release・終了状態の最小記録を保持する。本文へのlocatorは公開終了案内から除外する。URLを再利用せず、自動リダイレクトしない。

作者は同じWorkの公開中の別版を後継版として指定できる。循環を拒否する。Readerは対象が現在も閲覧可能な場合だけ後継版へのリンクを表示する。非公開や停止後の対象へ無条件に誘導しない。

既存 `?work=` / `?work=&r=` は既存public_projects snapshotへ固定し、新版作成で書き換えない。対応する旧版の公開停止時は終了案内にする。初期移行で既存indexの現在snapshotを信頼できる初期対応先とし、過去に失われた旧内容を推測復元しない。

旧 `?project=&author=` 等も公開indexの固定bindingだけから解決する。公開snapshot/Releaseが欠落している場合、現在の原稿を代わりに表示しない。Releaseを持たない旧データはリーズに移行待ちとして残し、原稿や共有assetを誤削除する操作を提供しない。

## 保存と認可

- `users/{uid}/works/{workId}/releases/{releaseId}`: 不変配信snapshot。新規作成のみ。廃棄は認証済みserver処理だけ。
- `users/{uid}/works/{workId}/edition_states/{releaseId}`: owner専用の可変状態、revision、初回公開日時、公開snapshot、後継、削除進捗。client write禁止。
- `public_editions/{editionId}`: 閲覧中は公開snapshot、終了後はlocatorを含まないtombstone。server writeのみ。匿名read。
- `public_projects/{workId|projectId}`: 既存URLの固定snapshot。別Releaseへの付け替えとownerによる削除を禁止。

管理APIはtokenと失効・所有者・版identity・revision・アカウント状態を検証する。共有authoringの権限をowner-only APIで迂回しない。原稿は配信の正本にしない。DSP/DSF ZIP形式は変更しない。物理assetの既知URLや既存端末キャッシュを非公開操作で回収できる保証はしない。

## Studio導線

Studio共通ヘッダーにリーズへの常設ボタンを置く。未ログインでもリーズへ移動してログイン案内を確認できる。Homeのタブ非表示やmobile専用表示の影響を受けない。編集内容を破棄せず既存ルーム遷移を使用する。
