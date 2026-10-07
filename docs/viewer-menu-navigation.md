# Reader menu navigation

Updated: 2026-10-06
Status: local implementation; not committed or deployed.

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
| Horizon / Studio / Reader | Shared navigation; another app opens in a new tab from the reader/editor to preserve the current file. My Page remains an account action. |
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
- Separate open issue: staging shows PRIVATE_IMAGE_CORRUPT for 潮騒の図書館（コピー）. The error can originate in stored R2 metadata/bytes or client response MIME/hash verification. Authenticated browser inspection was interrupted repeatedly by a debugger disconnection, so no failing asset response was captured. No image integrity checks, stored images, or cloud records were changed. Next diagnostic: capture the failing asset request status and response error versus client-side MIME/hash failure before choosing a repair.


## 2026-10-07: private image loading follow-up

- Confirmed on staging: the failing copy requested GET /api/projects/{projectId}/assets/{hash}, which returned HTTP 200 text/html (the application document). The owner image handlers existed on the server, but their Pages route entry files were absent. This was not evidence of damaged stored WebP bytes.
- Added GET and POST route entries into the existing authenticated authoring handler, preserving rollout, owner, generation, size and hash checks.
- Recent-work cards recover expired local blob thumbnail references from the existing IndexedDB image map, producing a small display-only thumbnail without changing stored manuscripts/indexes. Missing cloud covers are loaded only when a card becomes visible, through the authenticated source/image clients; only the selected cover is fetched and its temporary URL is revoked after thumbnail rendering. Account changes and detached cards cancel results.
- Verified: private authoring API regression tests, owner image route/thumbnail tests, real local Pages routing returns API JSON instead of HTML, browser fixture renders missing/expired cover cases and retains the cover after searching. Staging build passes. Live reading of the affected private project requires deployment and remains unverified.
