# Viewer reading UI production rollout — 2026-10-04

The user approved bringing the staging peek and spine reading interface to production.
Baseline: production `a92422a`. Reading UI source: staging `24fb563`.

## Scope

- Bring the Viewer reading surface and its book geometry, page curl, peek, spine,
  wheel/swipe/pinch, reading guide and reader control modules from staging.
- Enable the book UI by default in production; `?bookEdges=0` remains an explicit
  flat comparison view. This does not change the stored book or page format.
- Preserve production review functions, public Release validation, file loading,
  and the Studio preview opener/origin/nonce checks. The new staging review client,
  notifications entry and OS file-launch wiring are excluded.
- Studio editing, private R2 storage, publication data, Rules, IAM, environment
  flags and the PWA file associations remain unchanged.

## Verification

- `node scripts/verify-viewer-production-boundary.mjs` checks the retained production
  boundaries against the baseline. This is a release-specific scope audit.
- Unit checks cover book thickness, peek geometry, edge tap cancellation, trackpad
  momentum, reading windows and pinch ownership. The imported wheel test now
  supplies the timestamp carried by real browser wheel events.
- Existing checks cover fixed text, portable DSF v2, Horizon loading, Release-locked
  URLs and the Studio preview handshake. The URL check uses the four current public
  actions rather than its stale count of three.
- Production build passed. Browser checks passed for RTL/LTR navigation, the
  reading/book/peek/edge/spine sequence and returning to reading, spine title,
  and single-page rendering at 390px. Chrome touch emulation advanced the LTR
  page with one swipe; a two-contact pinch showed 209% zoom without changing the
  page. Ctrl-wheel reached 500% and returned to fit without a page change.
  These are desktop browser/emulated-touch checks, not physical phone testing.
  Existing publicly listed works are expired; do not change their publication dates
  as part of this release. Use local synthetic books and the existing private
  production verification manuscript for actual reading/preview checks.

The last production version before this change is deployment `31997d11`.
For a reading UI regression, that deployment preserves the current authoring and
trash protection; do not roll back to an older pre-migration release.
