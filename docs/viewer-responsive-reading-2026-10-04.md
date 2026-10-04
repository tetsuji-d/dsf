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

## Held page-turn gestures (2026-10-04)

- Phone book reading follows the pointer while it is held, including cover
  opening, camera movement within a spread, and the physical sheet turn across
  spreads. Reversing the drag reverses progress. Release beyond 40% accepts the
  turn; shorter, cancelled or interrupted gestures return to the original face.
- Desktop horizontal wheel/trackpad input controls page-turn progress in book
  and normal reading. Wheel events do not expose contact-up, so silence retains
  the intermediate position. Continue to the end to accept, or reverse to the
  start to cancel. Momentum after completion cannot start another turn.
- Blur, resize, hidden-document transitions, pointer interaction and competing
  vertical gestures cancel held wheel input. A second touch, lost capture and
  manuscript changes cancel pointer progress. Cancelled drags suppress clicks.
- Reduced-motion preference retains accept/cancel semantics without the held
  visual movement. No manuscript, storage, file-format or permission changes.

Verification for this local change:

- Held-progress tests cover five seconds of silence, reversal, acceptance,
  cancellation, reduced motion and cleanup. Wheel tests cover idle holding,
  reversal, completion, momentum-tail suppression and interrupted ownership.
- Responsive layout, peek geometry, pinch, edge taps, production-boundary
  checks, JavaScript syntax checks and production build passed.
- Local browser at 390x844: RTL cover open/cancel, within-spread move/cancel,
  cross-spread cancel/complete using mouse drag; held wheel turn stays at 35.75%
  between observations and reverses back. LTR cover and within-spread drag,
  held cross-spread turn at 44.69% and reverse cancellation also checked.
- At 1440x900: book wheel turn stayed at 52.8% between observations, then
  completed with further input. Normal reading wheel progress also held at 52.8%.
- The Chrome connection disconnected during setup. This change has not been
  verified with physical touch, a physical trackpad, or an installed PWA.
  Local browser mouse/wheel input is not hardware acceptance.
- The user requested commit and staging deployment of this gesture increment.
  Apply it to the staging release branch while preserving staging-only features.
  Production promotion remains pending physical-device acceptance.

## Compact progress and reader controls (2026-10-04, local)

- Viewer progress now uses one 6x11 px mark per source page. The gutter inside
  a spread is 1 px; spread groups are 3 px apart. Covers remain individual groups.
  Both ends and the current spread survive compaction; ellipses omit whole spreads.
- Hover/press previews a page thumbnail and its existing page label. Tracing
  visible page marks navigates continuously; tracing an omission previews its
  interpolated page and release selects it. The mark window stays fixed while
  held and re-centres after release. Keyboard range control is retained.
- Phone fullscreen control is hidden. Layout (Auto/Single/Spread), page furniture
  and reading assistance are together under Display. Existing settings persist.
- Portrait controls use the full safe width and sit 2 px above the bottom safe
  area. The circular backgrounds are 20% smaller, with 44/48 px hit targets.
  While phone controls are visible, normal and curved paper reserve menu space.
- Ordinary automatic turns use 520 ms; release settling has a 180/200 ms floor.
  Manual held progress, cancellation and reduced-motion behavior are retained.
  These were timing changes, not evidence that physical-device frame rate improved.
- No manuscript, storage, file-format, production or permissions changes.

Checks:

- Page grouping covers 1, 2, 18, 242 and 1002 pages at beginning/middle/end.
  Safe-area layouts cover portrait, landscape and desktop with 0/34 px insets.
- Local Chrome at 390x844: fullscreen hidden, all five lower buttons equally
  spaced inside the viewport, paper above the controls. Display contained the
  layout and reading-assistance settings. Emulated touch changed the thumbnail
  from page 2 to 9 and selected source index 10 before release; release hid it.
  Switching that selected page into curved book reading retained source index 10.
- Desktop LTR marks and fullscreen availability confirmed. In-app browser
  rendered a 240-body-page document with both covers and a whole-spread omission.
- Browser resizing/screenshot automation repeatedly disconnected. Do not count
  this as physical iOS/PWA or frame-rate acceptance. Curved-page scrubbing,
  installed-PWA safe area and hardware animation smoothness remain acceptance checks.
- The user approved commit and staging deployment of this increment. Preserve
  staging-only notification/PWA/review features; production promotion is separate.


## Follow-up: stable page size and peek position (2026-10-04)

- Removed menu-dependent paper insets. Normal pages and curved book faces keep
  exactly the same size/position when controls are shown or hidden.
- Root cause of peek falling below the viewport: a caller incremented offsetY
  directly on the cached peekViewportFrame object on each layout pass. Removed
  those increments and froze cached frame objects to prevent repeat mutation.
- Portrait buttons move 20 px inward on each side (less on very narrow displays
  to preserve 44 px targets). The dock uses 12 px of the upper home-indicator
  inset, retaining the lower area. Both controls and progress move lower; their
  hit areas remain separate. Desktop side controls are unchanged.
- Geometry tests repeat book/peek layout with immutable cached coordinates.
  Layout tests check centred buttons, target fit and 0/34 px bottom insets.
- Local browser at 430x932: normal and curved pages had identical bounds/style
  before and after menu toggles; four book/peek round trips had identical peek
  coordinates and stayed on screen. Safe-area emulation was unavailable; real
  iOS/PWA corner and home-bar placement still needs device confirmation.
- The user approved commit and staging deployment of these corrections. Production promotion remains separate.


### Zoom minimap follow-up

- Removed the interaction-wide corner lock that kept the map at its first corner
  during continuous page panning. It now chooses the corner opposite the viewed
  content, with a centre deadband. Only direct minimap dragging locks the corner;
  its idle-hide timer also pauses during that drag.
- Position comes from the current visual viewport and actual header, segment
  row and side-control rectangles. It clears these controls rather than using
  the old fixed 74 px bottom offset. Menu visibility changes refresh placement.
- Minimap geometry/pan tests and new corner/placement tests passed. In the local
  430 px browser, Ctrl-wheel zoom and page panning moved the map bottom-right to
  top-left; the top map cleared the header and the bottom map cleared segments
  by 8 px. Clicking inside the map retained its corner while moving the viewport.
- Final compact segment hit area ends at the button row, without overlap.
  Build passed; actual installed-PWA safe-area acceptance remains outstanding.


## Follow-up: centred phone paper and exterior swipe (2026-10-04, local)

- Use symmetric, stable phone paper margins that clear the OS status area,
  a 48 px header and the bottom segment/control rows. The paper stays centred
  in the visual viewport; menu visibility never changes its fit. The header
  occupies the gap between the status safe area and the paper. Curved single
  faces and closed covers use the same stable margins.
- Pointer and trackpad gestures now resolve outward exterior-cover targets
  before starting the held transition. Previously single-face pointer release
  returned before the exterior rollover fallback. C1/C4 rollover now uses the
  existing cover animation, including held progress and cancellation. Body
  pages keep their existing adjacent-page behavior.
- Targeted layout, held-progress, peek geometry, minimap and production-boundary
  checks passed; build passed (existing bundle-size warning only).
- Local browser, 430x932, simulated top/bottom safe areas 59/34: flat page bounds
  were identical before/after menu toggles (top 112.59, bottom 820.13), centred
  at viewport y=466.36. Header was y=61.79..109.79; lower segments clear paper.
  RTL/LTR phone-width pointer drags rolled C1 to C4 and back. A held RTL
  transition stayed at progress 0.4651; reversing an opposite transition
  cancelled to C4. Native touch injection is unsupported in this browser:
  these were real mouse-pointer drags at phone width, not physical iOS tests.
- Actual installed iOS/PWA touch and status-bar appearance remain device checks.
  No manuscript/storage/schema changes. Not committed or deployed in this turn.

## Follow-up: information window and work language (2026-10-04, local)

- Replaced the mobile stepped sheet with one page-aligned black translucent
  information window. Use a right-side panel only when the existing margin
  fits 320px after the reader controls; do not resize or shift the paper.
- Moved work-language choices into the information window, with language names
  and a selected check. Account trigger is circular again (40px phone/42px PC).
- Scroll the whole information body with a sticky close button. Close/i/Escape
  and outside dismissal retain focus and avoid click-through. Panel wheel and
  keyboard input no longer reaches page navigation. Menus stay visible while
  information is open, including after an asynchronous language refresh.
- Browser verification: 430x932 overlay matched the paper bounds; 1600x900 used
  a 420px right panel at x1128.49/y63.99, clearing the existing controls. Paper
  bounds were identical before and after opening. Long notes scrolled 520px
  while the close button stayed visible; language switched JA/EN and its title,
  selected check and direction updated. Escape returned focus to the i button;
  outside dismissal did not navigate the page. Real installed iOS remains a
  device acceptance check.
- Responsive geometry, minimap, production-boundary checks and build passed.
  No data, storage, permission, commit or deployment changes in this increment.

## Follow-up: translucent information and desktop spread placement (2026-10-04, local)

- Increased information background transparency from 18% to 30% (black alpha 0.70).
- Desktop widths of at least 1024px may translate the full-size paper left only
  when combined margins fit the 320px panel plus controls. Closing restores the
  centred baseline. Narrow screens and spreads that cannot fit keep the overlay.
- Actual browser at 1600x900: opening information moved a 1010px-wide spread
  about 113px left, from x295 to x182; its height stayed 897.77px. Panel began
  at x1268 with a 320px width. Closing restored x295 without resizing.
- At 430x932 the panel stayed page-aligned with zero page shift; computed shell
  background was rgba(0, 0, 0, 0.7). Physical iOS/PWA appearance remains a device check.
- Targeted geometry checks, JS syntax and build passed. No storage or permission
  changes; this increment is not committed or deployed.

## Staging release approval (2026-10-04)

The user approved committing and deploying the accumulated centred-paper,
exterior-cover gesture, round-account and information-window changes. Apply the
Viewer commit to release/studio-header-staging, retaining staging notifications,
file launch and review behavior. Production promotion remains separate.

## Follow-up: restore mobile paper size (local)

- Device screenshots exposed a regression in the centred-paper change: reserving
  the header and lower controls on both sides permanently reduced the page,
  especially when Safari browser bars reduced the visual viewport height.
- Paper fit now reserves only symmetric OS safe-area margins. Normal pages,
  curved faces and exterior covers retain menu-independent sizing and centring.
  Controls use available gaps and overlay when the full-size paper leaves too
  little space; opening menus must not shrink the page.
- Regression geometry includes browser heights 664/740 and PWA heights 844/932.
- Browser UI verification: 430x740 with simulated top safe area 47px produced
  a 361.99x643.55px flat page, identical before/after menu opening. Curved C2
  stayed in the viewport at the same browser height. At 430x932 with simulated
  safe areas 59/34, flat dimensions were 418.00x743.11px and curved reading
  filled the width with the header in the upper gap. These are browser
  emulations, not physical iOS tests. Layout/minimap checks and build passed.
- Not committed or deployed in this increment.

The user subsequently approved commit and deployment of this mobile sizing
correction to the existing Cloudflare Pages staging environment.
