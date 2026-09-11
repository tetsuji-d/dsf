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

## Cover labels and thumbnail controls

Print labels use the original project cover settings and original page numbers.
For full-document booklet printing, padding is inserted before C3 (or C4 for
outer-cover-only books), preserving the outside C1/C4 and inside C2/C3 sheet.
Partial selections retain original labels but receive trailing padding; omitted
cover pages are never synthesized. Source project data is unchanged.

Thumbnails place larger images above labels and may be collapsed while retaining
selection and scroll position. Language writing mode and reading direction remain
visible. Page labels on paper are preview guides and excluded from printed output.

Booklet padding can be placed before C3 (default) or before C4 for complete
full-cover books. Before-C4 padding retains the old C3 content in the body and
labels the last inserted blank as C3 for this print session only. Outer-cover-only
books offer before C4; partial selections and books without covers use trailing
padding. Controls are hidden when no booklet padding is required.
Inserted blanks appear in the thumbnail strip and can navigate to their print
face. Amber outlines identify pages in the current preview independently of print
selection. Fold guides distinguish mountain folds on front faces and valley folds
on back faces, viewed from the shown side, and are excluded from print output.
