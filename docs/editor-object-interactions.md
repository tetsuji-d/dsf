# Editor object and page interactions

Implementation checkpoint: 2026-09-10, local verification; no deployment in this unit.

- Fixed-page graphic objects share ribbon/context-menu commands: crop, flip, four stacking moves, reset, replace, duplicate, delete, copy and cut.
- Copy/cut/paste uses a project-scoped runtime clipboard. Cut is committed only on successful paste, validates the source snapshot and lock, and updates both pages in one Undo snapshot. All language text/frames and original project asset references survive. Native text editing clipboard remains separate.
- Graphic frame handles resize from all four corners with the opposite corner anchored in rotated coordinates. Rotation supports Shift snapping. Image resizing keeps aspect unless Shift is held. Source crop handles work on the canvas; panning changes the image inside a stationary crop window. Cancel does not write authoring state.
- Existing v6 Fixed graphicObjects/objectOrder schema is unchanged. Flow generated pages do not acquire graphic overlays in this unit; their stable source anchoring is a separate storage/design decision.
- Flow/fixed canvas joins follow normalized book cover roles, plus existing spread-image joins. Page boundaries reuse the thumbnail insertion menu. Long-press page label/top edge moves an authoring unit, retaining Flow and spread groups. Text selection does not start page dragging.
- Viewer preview makes a local DSF snapshot through the existing Press renderer and certified Flow/portable ZIP pipeline. A same-origin, source-window-checked, nonce-bound handshake passes only the DSF Blob to the normal Viewer local-file loader. There are no Release, Firestore or R2 writes. Changed authoring inputs cancel preparation; derived cover coordinates are excluded from change detection. Invalid composition or missing images stop preparation.
- Dynamic graphic controls refresh on JA/EN UI changes. New commands include both languages.

Verification: graphic object model/geometry, existing graphic browser acceptance (including DSP roundtrip and Press pixels), cross-page object browser acceptance, and mixed-canvas/Viewer preview acceptance. Run the browser scripts against local Vite at port 5178 with DSF_PLAYWRIGHT_MODULE set when Playwright is provided externally.
