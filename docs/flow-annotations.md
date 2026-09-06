# Flow ruby and emphasis: shared annotation model

## Contract

A text block keeps plain `texts[language]`. `annotations[language]` contains
`{id,type,start,end,...}` records. Ranges are half-open UTF-16 offsets constrained
to grapheme boundaries, never spanning newlines or semantic blocks.

- Ruby: `type: ruby`, `reading`, optional `reviewState: confirmed | needs-review`.
- Emphasis: `type: emphasis`, `mark: sesame | dot`.
- Different types may overlap; annotations of the same type cannot overlap.
- IDs are unique within one localized block. A paragraph merge renames colliding
  incoming IDs deterministically, preserving both annotations.
- Annotation edits produce a FlowDocument v2 candidate. Existing unannotated v1
  documents are not upgraded automatically; no version downgrade on removal.
- Text before an annotation shifts its range. Parent-text edits preserve ruby
  readings and mark them for review. Complete deletion removes the annotation.
- Split inside an annotation is rejected without a partial update. Split outside
  distributes annotations. Merge offsets trailing annotations by leading length.
- Legacy conversion recognizes ASCII and full-width ruby delimiters without
  normalizing surrounding text, whitespace or line breaks. Malformed notation
  remains literal text. Conversion is an explicit pure operation.
- Source-text equality is required when applying an annotation edit. Stale dialogs
  cannot attach a reading to newly edited text. Other languages remain intact.

## Studio integration (2026-09-06)

The approved UI is connected to Studio. Select parent characters in the source or
canvas and choose **ルビ・圏点…** from the context menu or annotation button.
A caret inside an existing annotation opens its complete range. Empty reading
removes only ruby; selecting なし removes emphasis. Cancel makes no changes.

Only explicit annotation application upgrades that FlowDocument to v2. Existing
v1 manuscripts, including literal legacy notation, are never automatically
converted. Project remains v6 and FlowLayout remains v1. No Firestore Rules change.
Annotated source blocks use a rich input; texts[language] still contains only
parent text. Runtime ruby readings and emphasis marks are excluded from source
selection offsets, copying and caret measurement. Generated pages use the shared
annotation renderer. Ruby groups stay together at line/page boundaries; emphasis
may continue onto the next page. Annotations reserve additional line spacing.

Existing project serialization, local autosave and Undo/Redo retain annotations.
Authoring replacements, translations, splits, image insertion and Flow joins use
the shared range operations. Splitting through an annotation is rejected atomically.
Parent-text edits retain readings with a visible needs-review underline.

## Publication

Annotations use existing DSF delivery v2 fixedText lines and styles. No delivery
schema, Firestore schema, Rules, or Viewer renderer change is required. Parent text
retains source ranges. Ruby readings and sesame/dot emphasis are separate measured
text lines; authoring annotation IDs and review metadata are not published.

The shared renderer exposes actual parent/reading/mark text nodes. Annotated DOM
disables pair kerning and optional ligatures for independent fixed glyph replay,
and reserves 0.8em of leading space. Ruby base and reading spans separate glyph
metrics from distributed ruby spacing. Capture compares each visible glyph with a
fixedText probe. Invisible whitespace preserves exact source text and its measured
anchor. Unsupported geometry still stops publication; no full-page raster fallback.

Projection checks annotation ranges against the exact source, refuses ruby split
across pages, and verifies the complete ordered reading/emphasis glyph inventory.
Missing, duplicate, changed and out-of-bounds glyphs stop publication. Existing font
certification, actual byte/hash verification and snapshot revision checks remain.

Press preparation, immutable Release assembly and portable DSF reuse their existing
paths. Annotation-only pages remain fixedText; listing thumbnails remain derivatives.

## Verification

Run node scripts/verify-flow-annotations.js and
node scripts/verify-flow-annotation-integration.js. The integration verifier covers
explicit v2 promotion, unchanged legacy data, serialization, Undo/Redo, safe text
edits, split/merge, annotation-only incremental invalidation, ruby page boundaries
in both writing modes and the certified-font publication gate.

Actual Studio browser checks cover source apply, canvas rendering, local reload,
Undo/Redo, parent-text typing, source offsets, arrow navigation, context menu,
ruby removal while retaining emphasis, and vertical ruby plus emphasis placement.
Authenticated cloud saving and actual R2 upload/publication have not been browser-tested in this unit.

The standalone design prototype remains at
/scripts/fixtures/flow-annotation-ui.html and uses an in-memory fixture only.


## Publication acceptance (2026-09-06)

Run node scripts/verify-flow-publication-projection.js for source/reading/emphasis
preservation, JSON round trips, missing/duplicate/changed glyph rejection and bounds.
The local /scripts/fixtures/flow-annotation-publication.html fixture runs actual
capture, full projection, existing Viewer, production Press preparation, portable
ZIP creation and the real local Viewer loader. It checks restored text, coordinates
and font sizes against the assembly, without saving/uploading a user Release.

Browser checked horizontal and vertical writing, two-page text, combined ruby and
emphasis, both marks, longer readings, Latin letters/digits, LF/TAB/spaces, headings,
missing-glyph rejection, and production Noto Sans JP / Noto Serif JP font-byte
verification plus portable round trips. All four font/direction packages contain
zero body image files. External R2/Firestore publication and deployment are separate
operations and were not performed.
