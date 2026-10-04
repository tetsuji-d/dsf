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
- Book reading is available at phone widths. The complete book stays rendered;
  the safe viewport frames the selected half, its paper block and binding uniformly.
  The opposite face continues outside the viewport, with the gutter edge in view.
  No text reflow or change to authored page dimensions is involved.
- Single-face book reading advances one face per completed swipe or edge tap.
  Cancelled swipes do not advance, and fast swipes do not launch multi-page riffles.
  Wide book reading and peek retain their spread navigation.
- Within one spread, the phone camera pans between its two faces in either
  direction. Crossing a spread animates the physical sheet turn together with the
  camera. Cover opening lands directly on the focused half, without a second jump.
- Desktop and phone reading retain the binding and paper edges. Edges use the
  same reading geometry as the paper; the head/foot of the spine stays in frame.
  The binding is a soft-cover wrap ending flush at the cover edges (18..662),
  with no rounded caps protruding above or below the book.
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

## Follow-up after staging review

The deployed `7749ab1` hid the opposite page on phones and faded out paper edges
and binding on both screen sizes. User feedback rejected that isolated-sheet
interpretation. The follow-up above retains a full physical book and crops the
camera instead. After the soft-cover correction, the user requested commit and
staging deployment of this follow-up. Production promotion remains pending.

- Layout regression checks cover both halves and 8/32/64-unit book thickness:
  selected paper and spine fit, the opposite fore-edge lies outside the crop,
  and paper-block boundaries meet the readable surface within numerical tolerance.
- Responsive layout, peek geometry, pinch and edge-tap checks plus build passed.
- Local browser at 390x844: RTL/LTR C1 -> C2 -> body pages, camera pan between
  spread faces, forward/back drag across spreads, and book/peek switching passed.
  At 1440x900 the binding head/foot and paper block remained visible; resizing
  retained the selected source page.
- Touch injection was unavailable in the in-app browser; the Chrome connection
  timed out. This follow-up's interaction checks used real mouse drag and keyboard
  input, not emulated touch. Physical device / installed PWA acceptance remains open.
- Soft-cover correction: removed the rounded spine caps; the binding ends flush
  with the covers. Local 390px and 1440px screenshots, geometry checks and build
  confirmed the correction before staging release.
