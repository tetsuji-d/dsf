# Reader / Writing performance verification — 2026-10-21

## Scope and checkout

- Worktree: C:\Users\tetsu\Documents\Codex\dsf-writing-w0
- Branch: feature/dsf-writing-w0
- Base HEAD: b0cbdc663ec5d33d45e413b1fd3e97e9cba87ee9
- At the time of the local measurements below, the change was uncommitted and had not been deployed. Production was not changed. Subsequent staging release evidence is retained under outputs/reader-writing-speed-staging-20261021/.
- Existing and new outputs/ files are preserved and must not be committed.
- No file-format, storage-permission, cloud-account, or publishing changes.

## Changes

Reader routes Writing v3 archives directly to the strict v3 loader and reuses the bytes already read. It avoids a preliminary full JSZip decode/CRC pass; strict ZIP, CRC and SHA-256 checks remain. Legacy/v2 paths remain supported.

Reader and Writing share a serialized font worker. WASM starts alongside catalog loading; the encoder starts only when needed. The worker ends after 60 seconds idle, on page exit, or on failure/timeout. Failed initialization can retry. Input font assets and FontFace loads share in-flight requests.

The font engine retains up to two decoded faces (each at most 16 MiB), 32 successful validation results, and eight derived subsets (each at most 512 KiB). Keys include actual byte hashes and trusted name records. Exact and nonexact verification are distinct; derivation also keys full run text for contextual shaping. Async inputs and returned values are copied to prevent mutation poisoning. Integrity failures are never cached as success.

Progress shows the current stage and elapsed seconds for reading, font validation, Writing startup, text confirmation and file generation. Local Performance measures use fixed dsf:* names, retain at most 64 entries per name, and contain no manuscript text or filenames. Nothing is transmitted for measurement.

## Measurements

Evidence: outputs/reader-writing-speed-20261021/.
Browser timing starts at the actual file-input change/button click and ends when the requested UI is ready. Native chooser/download waiting time is excluded.

| Browser UI operation | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Reader file open | 394.5 | 367.5 |
| Writing startup | 593.4 | 104.6 |
| First text confirmation | 143.3 | 168.4 |
| Second different-text confirmation | not measured | 36.3 |
| Editable DSF generation | 658.0 | 194.5 |

These are single local browser samples, not production or multi-device benchmarks. Cache conditions vary; the final save includes one more edit. Reader's small difference is not decisive, and first text confirmation did not improve. First font decode/compilation and font-family switching still cost time. A worker that has been idle for a minute incurs initialization again.

The separate Node/WASM benchmark runs three times. Medians: repeated different-text verification 111.32 → 13.56 ms; save 314.23 → 126.51 ms; repeat save 280.14 → 32.73 ms. These exclude browser module/worker startup and must not be compared directly to the UI table. Source and raw results: benchmark.mjs, baseline-core.json, final-core.json; UI: baseline-ui.json and rw-final-ui.json.

## Verification

- Existing 42 package assertions passed, including corruption and preservation cases. An output-local adapted verifier avoids overwriting historical evidence. Its inherited historical metadata is not the current HEAD.
- New verify-font-reuse.mjs passed: byte/metadata identity, exact-mode separation, missing glyph, async mutation, defensive copies, corrupted ZIP rejection, identical resave.
- New verify-runtime-reuse.mjs passed: worker reuse/concurrent callers, idle release, errors, timeout, retry and pagehide.
- Existing offline snapshot, file-save, portable v2 loader and Reader/Writing bridge checks passed. Bridge covers spread, Undo, failure atomicity, file reopen, original bytes and touch controls.
- Staging build and asset verification passed: 81 Writing distribution files, 79 offline assets. This is local packaging verification, not deployment or a remote hash comparison.
- Build completed with the existing large-chunk warning; syntax and git diff --check passed.

### Actual offline regression of the final build

1. Prepared Reader/Writing offline at http://127.0.0.1:5203/viewer.
2. Stopped the local Vite server and disabled HTTP cache via browser diagnostics. Reloaded Reader from the prepared Service Worker snapshot.
3. Opened the latest local draft. Writing restored the last text 二回目の編集を計測.
4. Changed it to 通信なしで銀河と珈琲・高速化確認, including new characters, and generated an editable DSFR.
5. Completed the browser download to C:\Users\tetsu\Downloads\reloaded-editable.dsfr; copied it to outputs/reader-writing-speed-20261021/offline-editable.dsfr.
6. Reopened that downloaded file in Reader while the server remained stopped. The new text was visibly present.
7. An uncached probe to the same stopped origin failed with TypeError: Failed to fetch.
8. Offline file verification passed: 132265 bytes; all eight original entries identical; new text present; prior text restorable from history; external font fetching forbidden; identical resave; shared export removes history and preserves originals.

This proves the final local build can reload/edit/save/reopen without its origin server. It is not a new production or physical-network-disconnection test. HTTP cache settings were restored afterward. The final local server is restarted for preview.

Evidence includes file-proof.json, verify-offline-file.mjs, offline-editable.dsfr, rw-offline-saved.png, rw-offline-reopened.png and rw-final-ready.png.
