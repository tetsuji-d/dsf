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

## Rollout boundary

`js/flow-annotations.js` is a pure foundation, currently not connected to Studio,
normalization, persistence, pagination or publication. The current FlowDocument v1
validator remains unchanged so partially implemented annotation data cannot enter
normal editing or publishing. No UI feature is enabled yet.

Following integration must cover:

1. v1/v2 readers, legacy conversion, Undo/Redo, authoring edits, translation apply,
   image insertion, Flow join, exact annotation-aware cache signatures.
2. Ruby-capable source editing (the current textarea cannot display ruby), shared
   annotated canvas rendering, semantic DOM mapping and selection/copy behavior.
3. Ruby-aware line/page boundaries, ruby plus emphasis collision avoidance,
   certified capture, strict no-loss projection of base and annotation text into
   fixedText, portable/Horizon/Viewer round trips and listing thumbnails.

Do not turn on annotation editing or auto-convert saved manuscripts before these
paths are ready. Keep body text as text. Never use silent raster fallback for Flow.
The project envelope stays v6; Firestore Rules and production remain unchanged.

## Verification

Run `node scripts/verify-flow-annotations.js`. It covers overlapping annotation
types, malformed ranges, Unicode boundaries, lossless legacy parsing, range edits,
split/merge, stale-source rejection, candidate v2 generation and JSON round trips.
This is model verification, not Browser or publication acceptance.
