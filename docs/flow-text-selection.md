# Flow generated-page selection (E2 first slice)

Selection is runtime-only and stays inside one Flow group and its source language.
The existing single-block editing path remains available. Cross-block selection is
read-only: copy is supported; typing, deletion, cut, paste, block formatting and
insertion at the caret cannot modify a partial focus block.

- Drag or Shift + navigation extends a selection across headings, paragraphs and
  generated pages. Ctrl/Cmd + Shift + Home/End selects to the group boundary.
- Selection endpoints are semantic section/block IDs and grapheme-safe UTF-16
  offsets. Pagination and line wrapping never insert characters into copied text.
- Copy joins semantic text blocks with LF. An explicit pageBreak contributes an
  empty segment (one extra LF); section boundaries introduce no extra separator.
- Repagination preserves the range if source text, order, types and IDs are intact.
  A changed source invalidates the range rather than guessing new positions.
- Arrow navigation without Shift collapses the range; clicking starts a new
  selection. Escape exits direct editing. Touch range handles and translated
  text selection are outside this unit.
- No persisted selection fields, document-format, Firestore or Viewer changes.

Validation command: `npm run verify:flow-text-selection`.
Existing source-mapping, direct-navigation, projection-recovery, history-focus and
mixed-canvas verifiers cover the unchanged neighboring paths. Browser acceptance
uses an isolated local fixture, not an authenticated manuscript.
