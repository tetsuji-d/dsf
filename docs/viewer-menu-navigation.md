# Reader menu navigation

Updated: 2026-10-07
Status: committed and deployed to staging through c853070; production promotion pending. See release-readiness-2026-10-07.md.

## Boundaries

The hamburger next to Horizon owns app navigation and app settings. The i panel
owns book metadata, Read language, bookmarks and reviews. Display owns page layout
and reading assistance. The round account icon owns authentication.

The new menu is a modal overlay. Opening it never changes page geometry, reloads
the document or writes manuscript data. Outside click and Escape close it; focus
returns to its trigger. Wheel and keyboard actions stay inside the menu. It is
available before a Read is opened. Mobile safe areas and viewport changes are
respected; the close button stays accessible while scrolling.

## Menu audit and changes

| Entry | Result |
|---|---|
| App version / updates | Moved from Read information to the Horizon menu; uses the existing shared updater. |
| Open a local file | Moved from an unlabeled header icon into the menu; reuses the existing input and loader. |
| Menu language / appearance | Moved out of account settings; uses the shared ja/en preference; see shared-menu-language-policy.md. |
| Horizon / Studio / Reader | Shared same-window navigation with an awaited Studio leave guard; deliberate editor previews remain separate. My Page remains an account action. |
| Display / reading assistance | Remain in Display. Assistance works on fixed text, not raster images; this limitation is explained in the guide. |
| Book pose up/down | Disabled at the ends of the supported sequence or while busy; not a missing implementation. |
| Fullscreen | Existing capability-based behavior retained; hidden on phones. |
| Read language / bookmarks / reviews | Stay in i. Login and publication eligibility remain enforced. Staging has additional review/notification changes and must keep them on integration. |
| Old info-sheet expand/collapse controls | Already hidden by the overlay implementation; not exposed as menu actions. |
| Account sign-in/out | Existing handlers retained; no authentication or permissions changes. |

No unimplemented destinations or placeholder actions were added. User-reported
nonfunctional entries whose names are not yet identified still require targeted
reproduction; this audit does not assert all existing functions are bug-free.

## Verification

- Built staging output and automatic-update regression/packaging checks passed.
- Actual browser: empty state menu; local synthetic file via menu; Japanese/English
  labels including version details; appearance selection; Escape focus return.
- Desktop and 390px mobile: page bounds unchanged by opening the menu; arrow keys
  in the menu do not change the page. At 320x568, the menu scrolls within the screen.
- Authenticated cloud bookmark/review writes and installed iOS PWA were not tested.
- Existing manuscript, file format, saving and security contracts are unchanged.

User-facing names follow [product terminology](product-terminology.md). Internal names and language keys remain unchanged.

## 2026-10-07: shared navigation and PWA launch policy

Horizon, Studio and Reader put the hamburger first and the brand immediately to its right. Studio's separate brand button switches to the dashboard in-place; it never reloads the editor. Common-menu navigation uses the current window. Studio refuses to leave while the shared work status is blocked or busy and directs the user to the existing save status on the dashboard. Deliberate editor previews remain separate so editing and inspection can coexist.

The installed app retains its existing id and root scope. launch_handler now requests focus-existing rather than navigate-new. A shortcut relaunch preserves the current Studio room. A different same-origin app URL is offered with an explicit Open / Keep current screen notice, never silently replacing an editor or local Reader file. URL and file launches share one consumer; early file deliveries are queued until the existing guarded file inbox subscribes. No file is opened or uploaded merely by receiving it.

Browser link capture preferences still determine whether an external link launches the installed PWA. The app cannot override that OS/browser choice. Manifest refresh timing and unsupported launch_handler fallbacks vary; native installed-PWA verification remains necessary. Keep this change on staging until the installed Windows app is checked for repeat launch, deep link, saved/unsaved Studio navigation, and file delivery. My Page and admin also receive URL launches within the existing root scope. iOS launch_handler support is not assumed.

Reference: https://developer.chrome.com/docs/capabilities/pwa-navigation-management
Regression: node scripts/verify-platform-navigation.mjs.


## 2026-10-07: untouched restored drafts and navigation

- Studio menu and incoming PWA URL navigation now await the existing exact-backup recovery verification for an untouched startup-restored local draft. A successful check permits the pending departure without claiming cloud or DSP saving.
- Edits, busy operations, a changed recovery snapshot, missing image blobs, or session changes retain the leave protection. The temporary beforeunload permission expires after one second and is invalidated by a new edit.
- Verified: platform-navigation and studio-restored-reload scripts, staging build, and local Studio -> Horizon -> Studio UI round trip with an untouched restored draft.
- Historical diagnosis: PRIVATE_IMAGE_CORRUPT was unresolved at this checkpoint. The later route fix and authenticated staging verification below resolve this incident.


## 2026-10-07: private image loading follow-up

- Confirmed on staging: the failing copy requested GET /api/projects/{projectId}/assets/{hash}, which returned HTTP 200 text/html (the application document). The owner image handlers existed on the server, but their Pages route entry files were absent. This was not evidence of damaged stored WebP bytes.
- Added GET and POST route entries into the existing authenticated authoring handler, preserving rollout, owner, generation, size and hash checks.
- Recent-work cards recover expired local blob thumbnail references from the existing IndexedDB image map, producing a small display-only thumbnail without changing stored manuscripts/indexes. Missing cloud covers are loaded only when a card becomes visible, through the authenticated source/image clients; only the selected cover is fetched and its temporary URL is revoked after thumbnail rendering. Account changes and detached cards cancel results.
- Verified: private authoring API regression tests, owner image route/thumbnail tests, real local Pages routing returns API JSON instead of HTML, browser fixture renders missing/expired cover cases and retains the cover after searching. Staging build passes. Deployed as c853070 / 802f3cc5 (v2026.10.07-133326). Authenticated staging verification opened 潮騒の図書館（コピー） with its text and images and cloud-saved status; both cloud/local card thumbnails decoded at width 180. No manuscript edit or cloud repair was required.

## 2026-10-08: shared installed identity (local, not deployed)

Horizon/Studio/Reader/My Page reference one manifest. Names: Horizon (production),
Horizon（検証版） (staging), Horizon（ローカル開発） (development server).
The id remains /studio, scope remains /, and the manifest URL remains unchanged.
New shortcut startup opens /?source=pwa. Existing windows ignore that plain
shortcut URL and retain their current screen; explicit deep links keep the guarded notice.

Audit limitation: this checkout has no manifest file_handlers and Reader has no
installFileLaunch consumer. Studio has a guarded DSP inbox. Do not claim OS DSF/DSP
association is complete or enable handlers until cross-surface file delivery and
unsaved-document protection are connected and tested. Native Windows icons/preview
registration is separate. Installed browser identity/name refresh remains a device check.
Regression: scripts/verify-platform-identity.mjs and verify-platform-navigation.mjs.

## 2026-10-08: file routing connected (local, not deployed)

The preceding missing-handler audit is now addressed in local code. The shared
manifest declares DSP -> Studio and DSF -> Reader with existing file-icon assets.
All app surfaces accept a transient received-file list; no file is read on receipt.
Opening in Studio retains boot/save/busy guards; Reader waits for initialization
and retains failed files for retry. Mismatched returned filenames are rejected.

With focus-existing, a file may arrive on a different surface. Explicit Open
hands it to a new same-origin window, retaining current work. A random token,
exact opener/window identity and origin validate ready/delivery/ack messages.
The receiving window presents its own Open action. A blocked popup/timeout keeps
the source list for retry; handles are never stored in IndexedDB or uploaded.
Ordinary menu navigation remains same-window.

Checks: verify-platform-files.mjs, verify-platform-navigation.mjs,
verify-platform-identity.mjs, staging build. Browser fixture verified no automatic
open, unsaved rejection, Later/reopen, and successful retry after removing the
fixture's unsaved condition. This is not a real document save test or Windows OS
file-association acceptance. Installed PWA file launch, actual cross-window native
handle delivery, icon display, and existing-app manifest update remain device checks.
Reference: https://developer.chrome.com/docs/capabilities/web-apis/file-handling
Reference: https://developer.chrome.com/docs/web-platform/launch-handler/
