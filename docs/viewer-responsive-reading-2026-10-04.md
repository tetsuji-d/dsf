# Responsive reader controls and single-face book reading

Scope: approved Viewer-only follow-up, based on production `659f090`.
Worktree: `studio-owner-production/dsf`, branch `feature/viewer-responsive-reading`.

## Behavior

- Reader controls use the visible viewport and safe-area insets. Narrow portrait
  windows place controls horizontally at the bottom. Landscape and wide windows
  place controls vertically beside the visible paper when space permits.
- Controls remain at least 44px; spacing contracts for short/narrow safe areas.
  Browser fullscreen changes, standalone display-mode changes and visual viewport
  resize/scroll request layout updates. Central tap still toggles all controls.
- Book reading is available at phone widths. The selected curved face is fitted
  uniformly to the safe viewport; other faces fade out. Peek retains the full book.
  No text reflow or change to authored page dimensions is involved.
- Single-face book reading advances one face per completed swipe or edge tap.
  Cancelled swipes do not advance, and fast swipes do not launch multi-page riffles.
  Wide book reading and peek retain their spread navigation.
- Rotation preserves the fan's selected source page and reading pose. Changes to
  the underlying flat single/spread layout are deferred until returning to reading.
  Explicit Single preference also uses one face in the book view.

## Verification

- `verify-viewer-responsive-layout.mjs`: safe bounds at 320/390px portrait,
  short landscape and desktop, with viewport offsets and safe insets; uniform
  fitting of left/right curved sheets; no skipped faces in either direction.
- Existing peek geometry, pinch ownership, edge tap, wheel intent, preview bridge
  and production-boundary checks pass. Production build passes with the existing
  bundle-size advisory.
- Chrome at 390px: C1 -> C2 -> each body face, RTL and LTR touch swipes,
  touch cancellation, two-contact transition without page drift, and normal/book
  return checked. 390x844 -> 844x390 -> portrait keeps the selected source page.
- Browser fullscreen enter/exit checked. Actual installed iOS/Android PWA testing
  remains necessary; desktop viewport/touch emulation is not a physical-device test.

No manuscript, file-format, cloud storage or permission-rule changes are part of
this implementation. The user requested a commit and staging-only deployment on
2026-10-04. Preserve existing staging features when applying this change; production
promotion remains pending review of actual manuscripts, the gutter and spine, and
installed PWA behavior on physical devices.
