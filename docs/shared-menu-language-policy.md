# Common navigation and Read languages

Updated: 2026-10-07. Committed and deployed to staging through c853070; production promotion pending.

## Current boundary

Horizon, Studio and Reader share a Horizon menu: Explore Reads (Horizon), Create
Read (Studio), Read with Reader, app settings, screen-specific help, and
version/update status. The account icon retains sign-in/out and My Page. Reader
Display retains reading layout controls; Read information (i) retains work
language, metadata, bookmarks and eligible reviews. Placeholder account actions
without handlers (restricted mode, location, feedback and settings) are removed.

Studio menu navigation uses the existing room switcher. Switching to another app uses the current window with an awaited Studio leave guard; deliberate editor previews remain separate.
Opening the modal changes neither page geometry nor the manuscript. Focus returns
to the trigger; Escape/backdrop close it. Icons use the bundled font.

## Two independent language choices

- Menu language: Japanese or English, shared on the same origin in
  `dsf_ui_language`. On first use, a valid old preference for the visited surface
  is imported; otherwise the first supported browser language is used, then English.
  Explicit changes update the three old preference keys for older screens.
  Storage events update open Horizon/Studio/Reader screens without reloading.
  My Page reads/writes this preference; its open forms are not rerendered by another tab.
  Production and staging have separate origins and therefore separate preferences.
- Read language: the actual language variants in that manuscript/publication.
  Studio manages existing authoring languages in Project settings; Reader lists
  the file's language keys in Read information. Localized names plus native names
  replace country flags/codes in the Reader picker. Choosing menu language does not
  translate, create, delete or switch work variants.

## Target reader-language catalog (20 entries)

| Code | Language |
|---|---|
| ja | Japanese |
| en | English |
| ko | Korean |
| zh-Hans | Chinese, simplified script |
| zh-Hant | Chinese, traditional script |
| th | Thai |
| vi | Vietnamese |
| id | Indonesian |
| fil | Filipino |
| ms | Malay |
| fr | French |
| de | German |
| es | Spanish |
| it | Italian |
| pt | Portuguese |
| ne | Nepali |
| my | Burmese |
| hi | Hindi |
| ru | Russian |
| ar | Arabic |

This is a naming/roadmap catalog, not 20 completed interface translations or a
claim that all 20 languages can be authored today. Japanese is included; Chinese
scripts count separately, English regions do not. No unsupported authoring option
is enabled. Existing `en`, `en-us`, `en-gb`, `zh-cn`, `zh-tw` and unknown imported
keys remain intact. Chinese aliases affect labels only; no manifest, metadata,
languageConfigs, source payload or cloud schema is migrated.

Before expanding authoring, verify font coverage/licensing, line breaking and
shaping, horizontal/vertical text support, RTL controls for Arabic, fixedText
delivery, DSP save/reopen and Reader round trip for each candidate. Before adding
a UI language, translate the complete reader journey and validate fallback and
layout. Do not imply a translated work is available merely because its language
has a display name. A separate explicit migration would be needed to normalize
persisted codes; this unit intentionally does not do that.

## Verification

`scripts/verify-menu-language.mjs` covers preference precedence, old-key migration,
same-tab and cross-tab changes, blocked storage, the 20-name catalog and preserved
legacy keys. Existing update, build/packaging, icon and language checks are retained.
Browser acceptance uses local synthetic data; cloud writes and installed iOS PWA
are outside this unit. On later staging integration preserve its additional
notification/review changes and untracked verification material.

Browser acceptance completed against the local staging build:

- Horizon preference carried into Studio and Reader; changing it in Reader updated
  another already-open Studio menu without reloading.
- Reader loaded a synthetic local file through the actual menu file chooser. Its
  selected zh-tw variant and page 1 of 2 survived UI language changes. Canvas
  bounds before/after opening the menu were identical (405 x 720 on desktop).
- A new local Studio manuscript with Traditional Chinese retained its typed title
  and selected Read language when menu language changed to English. The language
  settings list still contained only the existing authoring options.
- Reader Display settings and pose labels now translate with the UI; the existing
  input nodes and values are retained. A 390 x 844 menu fits within the viewport.
- Build, shared-language regression, Flow multilingual authoring, Press i18n,
  platform-update regression/packaging, Studio update-core and bundled-icon checks
  passed. Existing unrelated untranslated editor labels are not claimed complete.

User-facing names follow [product terminology](product-terminology.md). Internal names and language keys remain unchanged.
