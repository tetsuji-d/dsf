# Editor printing

The ribbon print button opens an isolated print settings frame. This is a local,
read-only snapshot; it does not save authoring changes, upload files, publish a
Release, or change DSP/DSF or Firestore schemas. Closing the frame aborts preparation
and releases the portable session fonts and object URLs.

## Rendering

`createEditorFlowPreview` supplies the existing certified composition, fixed-text
projection, sealed graphics and portable archive checks. The print session loads
that archive with `loadDsfLocalViewerPackage` and uses the existing Viewer renderer.
Flow text remains fixed-position DOM text; it is not converted to a screenshot.
Graphics are rendered at 2160 x 3840 for printing (ordinary previews retain their
1080 x 1920 path). Low-resolution source assets cannot gain detail from upscaling.

Paper-color omission is applied to a detached Flow typography snapshot and cloned
Fixed text sections before composition. It does not remove intentional image or
shape fills or colors already baked into imported images. Normal publishing is
unchanged. Publication cover parity is not applied to printing: selected pages
and booklet padding determine the print sheet composition.

## Layout

- A4, A5, JIS B5 and Letter, portrait/landscape, 1/2/4-up.
- All or explicit page ranges; thumbnails use the generated language-specific pages.
- Saddle-stitch: select pages in document order, append blanks to a multiple of four,
  impose outer/inner pairs, reverse pairs for right binding.
- Trim-to-9:16 booklet pages meet at the physical central fold. Their common size
  uses the stricter outer margin. Gutter is zero in this mode.
- Edge bleed repeats image border pixels only outside the unchanged trim rectangle;
  booklet spine edges have no bleed or crop marks. Crop marks sit outside bleed.
- Preview guides are removed from output. Frames and crop marks remain when selected.
- Only sizes of at least 10 mm page width can print, preventing degenerate allocations.
- Language changes rebuild the snapshot; paper-color changes retain selected numbers.

`Print / Save PDF` opens the browser print dialog. Select the matching paper size,
100% scale, no additional margins and no browser headers/footers. Printer duplex
settings must match the indicated long/short edge. Booklet output is already
imposed; disable additional printer booklet or N-up layout. Physical printer
registration, creep compensation and true image-content bleed are outside this unit.
Settings are session-only. Creep and printer-specific calibration are not implemented.

## Verification

`node scripts/verify-editor-print-browser.cjs` uses an isolated Chrome session and
local Vite server. Covers real Flow output, selected booklet pages, paper-color
removal, original-source equality, guide exclusion, cleanup, Fixed image pages,
edge extension and English UI. It also captures the print document as a PDF using
Chrome. Physical duplex printer acceptance remains a manual step.
