# DSFR / DSFP extension migration — 2026-10-15

Worktree: `C:\Users\tetsu\Documents\Codex\dsf-writing-w0`
Branch: `feature/dsf-writing-w0`; starting HEAD: `71d87e4`.

## Behavior

- Distribution and both Writing copy kinds download as `.dsfr`; Studio projects save as `.dsfp`.
- Existing supported `.dsf` / `.dsp` inputs remain accepted, case-insensitively. This does not add converters for previously unsupported archive versions.
- Naming strips the matching old/new suffix before appending the canonical suffix. MIME, archive entry names, internal `format`, schema versions, original bytes and cloud paths remain unchanged.
- Opening an old `.dsp` does not authorize rewriting it. Saving asks for a new `.dsfp` destination, or downloads a copy where native save pickers are unavailable. Cancel leaves the old file unchanged.
- Native project Open accepts both extensions; native Save accepts only `.dsfp`. HTML file pickers stay unfiltered so iOS does not disable custom extensions; archive parsers validate their contents.
- Reader local/remote loading, file-launch routing and cross-window transfer accept both names. PWA registrations advertise only new extensions, avoiding fresh claims on audio `.dsf` / other `.dsp` files.
- Writing sample is served at `/writing/sample.dsfr`; `/writing/sample.dsf` remains an alias to the identical reviewed bytes. Existing untracked test fixtures are preserved.
- Japanese/English extension labels and the canonical format document are updated. Product names, internal DSP/DSF identifiers and existing icon asset paths are retained.

## Verification

- `node scripts/verify-file-extensions.mjs`: naming, new/legacy launch inputs, native project save/cancel with memory-backed file handles, preservation of old files, actual Writing editable/shared ZIP save/reopen/resave and original-entry byte equality passed.
- `node scripts/verify-platform-files.mjs`: guarded launch, cross-window origin/source/nonce validation and failure behavior passed.
- `node scripts/verify-dsp-publication-thumbnail-import.js`: import validation passed.
- `node scripts/verify-platform-identity.mjs`: shared platform identity passed.
- `node scripts/writing-w1/verify-staging.mjs`: asset allowlist, offline cache atomicity and production exclusion passed.
- Modified JS/MJS syntax checks, `git diff --check`, and `DSF_WRITING_PREVIEW=1 npm run build:staging` passed.
- The existing `verify-flow-press-portable-download.js` passes its download behavior assertions but fails a pre-existing source-pattern assertion for `updatePressBookMode`. The same expression fails against `git show HEAD:js/press.js`; this unrelated assertion was not weakened. The new verification script runs the download behavior portion separately.

Browser at `http://127.0.0.1:5395`:

- Reader displayed the eight-page sample from `/writing/sample.dsfr`.
- Writing created and downloaded `Writing 操作サンプル-writing.dsfr`, then its reopen action completed. The downloaded ZIP was independently loaded and its base hash matched the original sample.
- An isolated browser fixture called the actual Studio `buildDSP` / `parseAndLoadDSP` functions: new output `.dsfp`, old `.dsp` and uppercase `.DSFP` input, then resave/reopen passed. It used synthetic state, not a user's manuscript.
- Browser-native automated clicks were unreliable in this session. DOM clicks through the browser developer interface exercised the actual button handlers; physical pointer/touch acceptance is not claimed.

Evidence is in `outputs/extensions/`: `verification.json`, `download-proof.json`, `project-browser.json`, `project-browser.png`, `writing-browser.png`, the synthetic `project.html` fixture and Writing ZIPs. Build log: `outputs/extensions-build.log`.

## Remaining release checks

iPhone Safari/PWA Files selection of both new extensions, desktop native Save picker, installed PWA association refresh and actual touch interaction remain unverified. No commit, push, merge or deployment was performed. Existing cloud releases and user files were not renamed.

## Mobile Studio navigation integrated with the extension change

- Editor bottom actions: Pages / Add / Edit / Press / Manuscript. Press directly opens the existing Press room; Press adds an Editor return action.
- Manuscript groups Save, Save as (.dsfp), Download project (.dsfp), Open local, project settings, read language, sharing, Undo/Redo and edit history. Existing save/open handlers and their guards are reused. Distribution download (.dsfr) stays in Press.
- The shared Horizon menu stays at the top. Japanese and English labels are included. Language-strip and zoom-bar redesign is outside this change.
- Browser validation at 390 x 844: actual locator clicks opened Manuscript, navigated directly to Press, returned to Editor, and switched JA/EN successfully. Unlike the earlier extension fixture session, normal browser clicks worked for this navigation check.
- At 320 x 568, the sheet remains within the viewport and scrolls internally; the bottom actions remain visible. No user manuscript was modified or published.
- Combined verification: verify-file-extensions.mjs, syntax checks, git diff --check and staging build passed. The existing unrelated Press source-pattern failure described above remains. The expected direct export button count was updated from two to one because mobile export now goes through Press.
- Screenshot: outputs/extensions/mobile-manuscript.png. Build log: outputs/mobile-extension-build.log.
- These changes remain uncommitted and undeployed. Actual iPhone acceptance remains pending.
