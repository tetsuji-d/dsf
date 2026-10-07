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
