# Staging Email Login

## Purpose

Google セッションに依存せず、staging 上で別ユーザー検証や AI テストを行うための限定ログイン導線。

## Scope

- **Studio only**
- **staging only**
- Firebase Auth の **Email/Password** provider を使う
- 本番 UI には出さない

## How it is enabled

`staging` ビルドで、かつ `VITE_ENABLE_EMAIL_LOGIN=true` のときだけ Studio の auth dropdown に email/password フォームを表示する。

想定ファイル:

`/.env.staging.local`

```bash
VITE_ENABLE_EMAIL_LOGIN=true
```

このファイルは `.gitignore` 対象で、repo には含めない。

## Test account storage

実際のテスト用 email/password は frontend env に入れない。

ローカル未追跡ファイルの例:

`/.local-test-accounts.json`

```json
{
  "stagingEmailLogin": {
    "email": "staging-tester@example.com",
    "password": "replace-me"
  }
}
```

用途:

- 人間が参照して入力する
- AI エージェントにテスト時だけ値を渡す
- ブラウザ配布物には埋め込まない

## Firebase Console steps

1. staging 用 Firebase project を開く
2. Authentication -> Sign-in method
3. **Email/Password** を有効化
4. テスト用ユーザーを 1-2 件作成

## Why secrets are not in VITE env

`VITE_`* はビルド後にクライアント JS へ埋め込まれる。
したがって test account の password を `VITE_TEST_PASSWORD` のように入れるのは禁止。

## Suggested workflow

1. `.env.staging.local` で UI を有効化
2. `.local-test-accounts.json` に test account を保存
3. Studio staging で email login
4. AI テスト時はその資格情報を明示的に使う

