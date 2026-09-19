import { normalizeBookSettings, getBookCompositionIssues, getPageCoverKey, getPageDisplayLabel } from './page-labels.js';

/** Read only a current, already generated projection. Never trigger pagination. */
export function describeBookComposition({ book, bookMode, languageKey, direction, projection, busy = false }, offset = 0) {
 const base = { languageKey, pageDirection: direction || null,
  binding: direction === 'rtl' ? 'right' : direction === 'ltr' ? 'left' : null,
  coverMode: (book?.mode || bookMode || 'simple') === 'none' ? 'none' : 'covers',
  scope: 'editor-layout', publicationValidated: false };
 if (busy || !projection || projection.languageKey !== languageKey) return { ...base,
  status: busy ? 'busy' : 'not-generated', totalPages: null, pages: [], nextOffset: null,
  issues: [], instruction: 'Page counts and cover positions are unknown. Wait for layout, or display this content language to generate it, then read again. Do not infer counts from paragraphs.' };
 const pages = projection.pages, count = pages.length;
 const normalized = normalizeBookSettings(book, bookMode, count);
 const fallback = pages.some(p => p.isSourceFallback);
 const sections = pages.map(p => p.kind === 'fixed' ? p.section || {} : {});
 const issues = getBookCompositionIssues({ pageCount: count, book, bookMode, sections });
 const covers = count ? Object.entries(normalized.covers).map(([key, value]) => ({ role: key.toUpperCase(), pageNumber: value.pageIndex + 1 })) : [];
 const warnings = [];
 if (!count) warnings.push('EMPTY_WORK');
 if (fallback) warnings.push('SOURCE_LANGUAGE_FALLBACK');
 if (covers.some(c => pages[c.pageNumber - 1]?.kind === 'flow')) warnings.push('FLOW_CONTENT_AT_COVER_POSITION_REVIEW_INTENT');
 const padding = (4 - count % 4) % 4;
 return { ...base, status: fallback ? 'source-fallback' : 'ready', effectiveCoverMode: normalized.mode,
  totalPages: count, covers, issues, warnings,
  booklet: { totalPagesWithPadding: count + padding, blankPages: padding, modifiesManuscript: false,
   defaultPaddingPosition: normalized.mode === 'full' ? 'before-C3' : normalized.mode === 'simple' && count ? 'before-C4' : 'end',
   availablePaddingPositions: normalized.mode === 'full' ? ['before-C3', 'before-C4'] : normalized.mode === 'simple' && count ? ['before-C4'] : ['end'],
   scope: 'all-pages-estimate; print selections and final Press output may differ' },
  pages: pages.slice(offset, offset + 50).map((page, index) => {
   const i = offset + index;
   return { pageNumber: i + 1, label: getPageDisplayLabel(i, count, book, bookMode),
    role: getPageCoverKey(i, book, bookMode, count).toUpperCase() || 'body',
    kind: page.kind, blockId: page.blockId, groupId: page.groupId || null,
    flowPageNumber: page.flowPageNumber || null, writingMode: page.writingMode || null,
    contentLanguage: page.languageKey || languageKey, sourceFallback: page.isSourceFallback === true };
  }), nextOffset: offset + 50 < count ? offset + 50 : null,
  instruction: 'Cover roles are positional, not author intent. Recheck after every insertion or repagination. Read all pages via nextOffset before planning. Ready means editor layout only; validate all languages in Press before publishing.' };
}
