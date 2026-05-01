# Security Hardening Notes

## Current state

### OK / expected

- Firebase Web config (`apiKey`, `authDomain`, `projectId` など) は client-side app として公開前提
- R2 への書き込みは `functions/upload.js` 経由で Firebase ID token を検証している
- `functions/asset-proxy.js` でも Firebase ID token を検証している
- Firestore rules で owner / `dsfStatus` ベースの read 制御をしている

### Important clarification

Firebase の Web API key は **secret ではない**。
本当に守る対象は次:

- Firestore rules
- Pages Functions の token verification
- 認証 provider 設定
- abuse / rate limiting
- staging / production の分離

## Near-term hardening checklist

1. **Firebase App Check の導入検討**
   - bot / abuse 対策
   - Functions / Firestore / Storage への濫用を下げる

2. **Pages Functions 共通 auth utility 化**
   - `functions/upload.js`
   - `functions/asset-proxy.js`
   - Firebase token verify の重複実装をまとめる

3. **Rate limiting / abuse guard**
   - upload API の過剰利用対策
   - asset-proxy の濫用対策

4. **staging / production provider 設定の定期確認**
   - Google

5. **scripts の config 直書き整理**
   - `scripts/verify-firebase.js` の扱いを明確化
   - env ベースに寄せるか、sample 用途に限定する

## Things to avoid

- test account password を `VITE_*` に入れる
- frontend bundle に secret を埋め込む
- rules より client-side ガードを信用する

## Recommended next step

次は `functions/upload.js` / `functions/asset-proxy.js` の token verify 共通化を行う。
