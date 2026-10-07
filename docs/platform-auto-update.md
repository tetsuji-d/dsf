# Platform automatic updates

Updated: 2026-10-05
Status: implementation verified; staging release authorized on 2026-10-05. Production remains pending device acceptance.

## User behavior

- Studio, Viewer, Library, My Page and Admin share the built-in update bootstrap.
- Online document navigation prefers the latest HTML. New releases are checked
  in the background on start, focus, reconnect and every 30 foreground minutes.
- Preparing/activating app resources never reloads, navigates or saves an open
  page. Studio unsaved content, Viewer local files and reading state stay in
  the existing document. Internal SPA room/work changes do not replace its JS;
  a subsequent document navigation/new launch uses the latest version.
- The Viewer Horizon menu has a collapsed App version and updates section. Studio's
  normal dashboard no longer offers an update action; manual update and guarded
  reload remain in Help as a recovery tool.
- Failures keep the current screen. Retry is rate limited; offline continues
  using a previously installed app snapshot.

## Compatibility and storage boundaries

- Keep /studio-sw.js for existing full offline Studio installations; add
  /platform-sw.js for ordinary clients and restore /viewer-sw.js as a compatible
  replacement at the legacy script URL. Preserve registration scope. Unknown
  worker paths/origins are rejected. Full Studio offline font preparation
  remains opt-in; ordinary clients cache the application and Firebase SDK only.
- Installation validates HTML build identity and script/style MIME types.
  The old cached-HTML-as-JavaScript failure is rejected and fetched again.
- Existing tabs retain old immutable asset caches. Only a failed newly created
  app cache may be removed; an existing cache is preserved on reinstall failure.
  No IndexedDB, localStorage, auth, manuscript, image or recovery-copy deletion.
- Authoring/publication API responses and Authorization requests are not
  intercepted. File format, save contract and permission rules are unchanged.
- New HTML is not written into an older offline snapshot. It uses network assets
  or exact cached asset URLs; offline navigation falls back to validated app HTML.
- Versions and worker scripts bypass app caching. Update modules have build query
  identifiers and are included in the offline inventory.

## Verification

- scripts/verify-platform-update.mjs: pending check deduplication, failure retry,
  reconnect, no downgrade, legacy/Studio/new worker paths, foreign worker rejection,
  network navigation, offline fallback, malformed script cache recovery, old
  chunks, API isolation and reinstall failure preservation.
- Existing Studio manual update-core checks still pass; staging build succeeds.
- scripts/serve-platform-update-fixture.mjs is localhost-only acceptance tooling.
  Browser A retained unsaved textarea content and its simulated reading position
  across a failed B download and successful retry. Another document opened B;
  A stayed unchanged. A legacy Viewer worker registration upgraded successfully.
- Actual built Viewer opens a synthetic local manuscript and reports its version
  in the common Horizon menu. No production data was edited.

## Release and acceptance

- Apply to the staging release branch while preserving its notifications/review
  features. The user authorized this commit and staging deployment on 2026-10-05.
- Verify installed iOS/Android PWA behavior and legacy migration on staging before
  production. Browser update discovery may be delayed for already-open legacy
  documents until their next navigation; do not promise instantaneous replacement.
- Opening a new app document is the update boundary. No unsafe automatic reload
  of a live editor or locally opened Viewer file is introduced.
- Old app caches are retained for existing tabs; bounded cleanup is a later unit
  and must track active versions rather than deleting all caches.
