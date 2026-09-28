# Studio authentication guidance and Press startup recovery

2026-09-28. Continuation on feature/studio-local-pwa; no file-format, persistence, Rules, Viewer geometry, or publication-policy changes.

## Reported failures

An already-open staging tab used studio-b22UF4Dh.js and requested flow-press-local-release-planning-CmNHrLRT.js after a newer deployment. The retired URL returned HTML rather than JavaScript. Current assets were available. Production Press modules were lazily imported at first use, so navigating to Press after deployment could fail even though Studio was already open.

The auth UI inserted the guest cloud-save prompt but never removed it after sign-in. This did not prove cloud persistence itself had failed.

## Changes

- Authentication transitions replace guest guidance with a signed-in save prompt, without claiming successful cloud persistence. Account switches/sign-out clear obsolete save-target labels. Repeated auth renders retain saving, saved, and error messages. Language changes cannot resurrect an earlier account's save result.
- Production Press preparation, planning, byte sealing, ZIP packaging, Horizon handoff/upload/draft helpers, and thumbnail modules are static imports. Their program bytes load before Studio becomes interactive, preventing deferred imports of those retired chunks. Font/image fetches and user-triggered cloud writes keep their existing boundaries. Development preview helpers remain lazy.
- Module-load errors provide DSP backup and return-to-editor actions. No automatic reload, draft deletion, permission relaxation, or forced upload is added.

## Verification

- Save-status and authentication-guidance regression checks: guest to login, account switch, logout, Japanese/English, preserving saving/success/failure; real UI operations on an isolated local fixture. No real-account sign-in or cloud write was performed.
- Press production preparation, local assembly/package, Horizon handoff/upload/draft regression checks passed; import assertions now require startup loading.
- Staging build passed (existing large-chunk warnings).
- Built Studio at 127.0.0.1:5198: after startup, all additional /assets/*.js requests were blocked through browser developer tooling. Imported a synthetic one-paragraph vertical Flow DSP; Press production preflight, release planning and six-entry ZIP integrity verification passed. Exported Press読み込み検証.dsf, 4,352,755 bytes. The block was then removed. Initial fixture envelope mistakes were corrected and validated with the production envelope validator before the successful run.
- Real users' open drafts were not modified or reloaded. Existing old tabs require a one-time DSP backup and reload to receive these changes.
