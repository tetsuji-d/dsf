# Physical spine design (2026-09-24)

The optional `book.spineDesign` describes the closed book edge, not the authoring
block order. It does not add a numbered page or change C1–C4/body composition.
The approved initial editor exposes title, author, publisherName, publisherIcon, backgroundColor, textColor and
fontSize in Project Settings with a live preview and Save/Cancel.

- title: plain text, maximum 120 characters; blank uses the active work title.
- author: plain text, maximum 80 characters; blank uses the active work author.
- backgroundColor/textColor: six-digit hex colors, defaults #173d42/#f4eddb.
- fontSize: 6–24 logical pixels on the 360×640 canvas (default 18).
- publisherSource: optional `space` selects publishing-space basic information.
  New designs default to this mode; existing manually entered values remain manual.
  Project Settings fetches the current owner's catalogue and the assigned space's
  icon, independently of dashboard selection or icon cache. Loading/failure blocks
  settings Save until retrieval succeeds or manual mode is chosen. Late responses
  after closing, changing project/account, or changing mode cannot change the draft.
- publisherName: optional plain text, maximum 80 characters. In reference mode,
  a project without an assigned publishing space omits publisher information.
- publisherIcon: optional embedded WebP data URL, maximum 88,000 characters.
  Manual uploads are center-cropped to 256×256 (maximum 64 KiB). With no icon,
  the publisher initial is shown. An empty string preserves explicit removal.
- Referenced publisher values are saved as a snapshot for offline DSP/DSF and
  Viewer use; reopening owner Project Settings refreshes the reference. Shared
  editors use the owner's saved snapshot; no cross-account profile access is added.
- Title/author references immediately reflect basic-information inputs in the same
  settings dialog. Resetting references keeps the chosen colors and text size.
- All spines use 32 logical pixels of width, including older books. The title is
  at the top (largest text); author (70%), publisher (50%), then icon sit at the
  bottom. Editor and Viewer share the renderer. Long text is clipped within
  bounded regions so it cannot overlap the imprint or change pagination.
- Blank title/author use the active work metadata even on unconfigured books.


The property is carried by existing `book` metadata in cloud authoring, DSP,
Fixed DSF content, and Horizon immutable release metadata. Portable DSF v2 uses
optional `meta.json.presentation.spineDesign`; older readers may ignore it.
No new collection, asset, access permission, or project version is introduced.
Saving an editor change does not modify an already published release; republish
for public readers to receive the new design.

Viewer defaults to automatic layout. Available reading width ≥600 CSS px and
space for two full-height 9:16 pages selects a spread; otherwise it selects a
single page. Covers remain single in book mode. The header cycles Auto → Single
→ Spread → Auto. Manual choices last for the current Viewer session. Resize and
rotation preserve the current spread/page; the spine stop has no visible hint.
