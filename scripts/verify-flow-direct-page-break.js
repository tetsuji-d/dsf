import assert from 'node:assert/strict';

import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
import { createFlowDirectEditSession, createFlowDirectEditTransaction,
    createFlowDirectPageBreakTransaction } from '../js/flow-direct-edit.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { createCanonicalFlowPageBox, paginateFlowDocument } from '../js/flow-pagination.js';
import { createIncrementalFlowPaginator } from '../js/flow-incremental-pagination.js';
import { findFlowSourcePointInPages } from '../js/flow-source-mapping.js';
import { deriveFlowTranslationStatus } from '../js/flow-translation-state.js';
import { deserializeProject, serializeProject } from '../js/project-persistence.js';
import { clearHistory, getHistoryInfo, pushState, redo, undo } from '../js/history.js';
import { state } from '../js/state.js';

const sourceText = '雪👩‍💻\n朝の光';
const ids = { newBlockId: 'after-manual-break', pageBreakId: 'manual-break' };
const pageBox = createCanonicalFlowPageBox();
const measurePage = () => ({ fits: true });

function fixture(type = 'paragraph', text = sourceText, sourcePresent = true) {
    return createFlowGroupBlock({
        id: 'page-break-group', sourceLanguage: 'ja',
        document: { id: 'page-break-document', sourceLanguage: 'ja', futureDocument: { keep: true },
            sections: [{ id: 'section', title: { ja: '章', en: 'Chapter' }, futureSection: 17,
                blocks: [{ id: 'target', type, ...(type === 'heading' ? { level: 3 } : {}),
                    texts: { ...(sourcePresent ? { ja: text } : {}), en: 'Snow and morning light', 'en-US': '' },
                    futureTextBlock: { keep: ['exact'] } },
                { id: 'following', type: 'paragraph', texts: { ja: '後続本文', en: 'Following text' } }],
            }, { id: 'other-section', title: {}, blocks: [{ id: 'other-block', type: 'paragraph', texts: { ja: '' } }] }],
        },
    });
}

function sessionFor(group, writingMode = 'vertical-rl', offset = 0) {
    return createFlowDirectEditSession(group, {
        pageLanguageKey: 'ja', writingMode,
        sourcePoint: { sectionId: 'section', blockId: 'target', languageKey: 'ja', utf16Offset: offset },
    });
}

function operationFor(group, offset = 1, newIds = ids) {
    return { type: 'insertPageBreakAtCaret', groupId: group.id, sectionId: 'section', blockId: 'target',
        languageKey: 'ja', utf16Offset: offset, ...newIds };
}

function mixedBlocks(group) {
    return [{ id: 'fixed-before', kind: 'page', content: { pageKind: 'image', future: 'before' } },
        group,
        { id: 'fixed-after', kind: 'page', content: { pageKind: 'image', future: 'after' } }];
}

function projectFor(blocks) {
    return { version: 6, languages: ['ja', 'en'], defaultLang: 'ja', blocks,
        sections: [{ type: 'image', backgrounds: {}, bubbles: [] }, { type: 'image', backgrounds: {}, bubbles: [] }],
        pages: [] };
}

for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    for (const type of ['paragraph', 'heading']) {
        for (const [text, offset] of [[sourceText, 0], [sourceText, 1],
            [sourceText, '雪👩‍💻'.length], [sourceText, '雪👩‍💻\n'.length],
            [sourceText, sourceText.length], ['', 0]]) {
            const group = fixture(type, text);
            const original = JSON.stringify(group);
            const session = sessionFor(group, writingMode, offset);
            const transaction = createFlowDirectPageBreakTransaction(group, session,
                { selectionStart: offset, selectionEnd: offset, ...ids });
            assert.deepEqual(transaction.operation, operationFor(group, offset));
            assert.equal(Object.isFrozen(transaction), true);
            assert.equal(JSON.stringify(group), original, 'Planning must not mutate semantic source');
            const beforeBlocks = mixedBlocks(group);
            const afterBlocks = applyFlowAuthoringOperation(beforeBlocks, transaction.operation);
            const applied = afterBlocks[1];
            const [leading, pageBreak, trailing, following] = applied.flow.document.sections[0].blocks;
            const old = group.flow.document.sections[0].blocks[0];
            assert.deepEqual(afterBlocks[0], beforeBlocks[0], 'Fixed prefix must stay untouched');
            assert.deepEqual(afterBlocks[2], beforeBlocks[2], 'Fixed suffix must stay untouched');
            assert.equal(leading.id, old.id);
            assert.equal(leading.type, type);
            assert.equal(leading.texts.ja, text.slice(0, offset));
            assert.equal(leading.texts.en, old.texts.en, 'Never guess translated split positions');
            assert.equal(leading.texts['en-US'], '', 'Empty translation keys must remain present');
            assert.deepEqual(leading.futureTextBlock, old.futureTextBlock);
            assert.deepEqual(pageBreak, { id: ids.pageBreakId, type: 'pageBreak' });
            assert.equal(trailing.id, ids.newBlockId);
            assert.equal(trailing.type, type === 'heading' && offset < text.length ? 'heading' : 'paragraph');
            assert.deepEqual(trailing.texts, { ja: text.slice(offset) });
            assert.deepEqual(Object.keys(trailing).sort(),
                (trailing.type === 'heading' ? ['id', 'type', 'texts', 'level'] : ['id', 'type', 'texts']).sort(),
                'Unknown source fields and translations must not be ambiguously duplicated');
            if (trailing.type === 'heading') assert.equal(trailing.level, old.level);
            assert.equal(leading.texts.ja + trailing.texts.ja, text, 'Every source character including LF must survive');
            assert.deepEqual(following, group.flow.document.sections[0].blocks[1]);
            const translation = deriveFlowTranslationStatus(applied, 'en');
            assert.deepEqual(translation.body.ids.stale, offset < text.length ? ['target'] : []);
            assert.equal(translation.body.ids.missing.includes(ids.newBlockId), true);
            if (offset === text.length) {
                assert.deepEqual(leading, old, 'End insertion must preserve the complete original source unit');
                assert.deepEqual(applied.flow.translationState, group.flow.translationState,
                    'End/empty insertion must not capture unchanged source or stale its translation');
            }
            assert.equal(transaction.nextSession.blockId, trailing.id);
            assert.equal(transaction.nextSession.blockType, trailing.type);
            assert.equal(transaction.nextSession.expectedText, trailing.texts.ja);
            assert.equal(transaction.nextSession.writingMode, writingMode);
            assert.equal(transaction.nextSession.selectionStart, 0);
            assert.equal(transaction.nextSession.selectionEnd, 0);
            assert.equal(transaction.selection.focusPoint.utf16Offset, 0);
            assert.equal(transaction.selection.focusPoint.graphemeOffset, 0);
            const editAfter = createFlowDirectEditTransaction(applied, transaction.nextSession,
                { text: `追記${trailing.texts.ja}`, selectionStart: 2, selectionEnd: 2 });
            assert.equal(editAfter.operation.blockId, trailing.id, 'Typing after insertion must target the new source block');

            const paginator = createIncrementalFlowPaginator({ pageBox, languageKey: 'ja', writingMode, measurePage,
                measurementKey: 'manual-page-break-verification', getPageVariantKey: () => 'uniform' });
            assert.equal(paginator.paginate(group.flow.document).pagination.pages.length, 1);
            const reflowed = paginator.paginate(applied.flow.document);
            const cold = paginateFlowDocument(applied.flow.document, { pageBox, languageKey: 'ja', writingMode, measurePage });
            assert.deepEqual(reflowed.pagination, cold, 'Manual break incremental reflow must equal a cold pagination');
            assert.equal(cold.pages.length, 2);
            assert.deepEqual(cold.pages[1].manualBreakBefore, { sectionId: 'section', blockId: ids.pageBreakId });
            assert.equal(findFlowSourcePointInPages(cold.pages, transaction.selection.focusPoint).pageIndex, 1,
                'Even an empty trailing block must provide an editable caret on the next page');
            assert.equal(cold.pages[0].fragments[0].blockId, 'target', 'Offset zero retains a real empty source block before the break');
            const restored = deserializeProject(serializeProject(projectFor(afterBlocks)));
            assert.deepEqual(restored.blocks[1], applied, 'Atomic page-break source and metadata must survive save/reload');
            assert.equal(JSON.stringify(restored.blocks[1]).includes('generatedPages'), false);
            assert.equal(JSON.stringify(group), original, 'Applying a transaction must not mutate its input');
        }
    }
}

const missingSource = fixture('heading', '', false);
const missingSession = sessionFor(missingSource);
const missingTransaction = createFlowDirectPageBreakTransaction(missingSource, missingSession,
    { selectionStart: 0, selectionEnd: 0, ...ids });
const missingApplied = applyFlowAuthoringOperation([missingSource], missingTransaction.operation)[0];
assert.deepEqual(missingApplied.flow.document.sections[0].blocks[0], missingSource.flow.document.sections[0].blocks[0],
    'An empty source-missing block must not gain an invented source-language key');
assert.deepEqual(missingApplied.flow.translationState, missingSource.flow.translationState);
assert.deepEqual(missingApplied.flow.document.sections[0].blocks[2].texts, { ja: '' });

const group = fixture();
const session = sessionFor(group);
const baseOperation = operationFor(group);
const original = JSON.stringify(group);
const directInput = { selectionStart: 1, selectionEnd: 1, ...ids };
for (const conflictingId of ['page-break-document', 'section', 'target', 'following', 'other-section', 'other-block']) {
    for (const field of ['newBlockId', 'pageBreakId']) {
        assert.throws(() => createFlowDirectPageBreakTransaction(group, session, { ...directInput, [field]: conflictingId }),
            { code: 'FLOW_DIRECT_BLOCK_ID_CONFLICT' });
        assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, [field]: conflictingId }),
            { code: 'FLOW_BLOCK_ID_CONFLICT' });
    }
}
assert.throws(() => createFlowDirectPageBreakTransaction(group, session, { ...directInput, pageBreakId: ids.newBlockId }),
    { code: 'FLOW_DIRECT_BLOCK_ID_CONFLICT' });
assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, pageBreakId: ids.newBlockId }),
    { code: 'FLOW_BLOCK_ID_CONFLICT' });
for (const value of ['', ' ', ' leading', 'trailing ', null, undefined, 17]) {
    for (const field of ['newBlockId', 'pageBreakId']) {
        assert.throws(() => createFlowDirectPageBreakTransaction(group, session, { ...directInput, [field]: value }),
            { code: 'FLOW_DIRECT_NEW_BLOCK_ID_INVALID' });
        assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, [field]: value }),
            { code: 'INVALID_FLOW_BLOCK_ID' });
    }
}
assert.throws(() => createFlowDirectPageBreakTransaction(group, session, { ...directInput, selectionEnd: 6 }),
    { code: 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED' });
assert.throws(() => createFlowDirectPageBreakTransaction(group, session,
    { ...directInput, selectionStart: 2, selectionEnd: 2 }), { code: 'FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED' });
assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, utf16Offset: 2 }),
    { code: 'FLOW_SPLIT_GRAPHEME_BOUNDARY_REQUIRED' });
for (const offset of [-1, sourceText.length + 1, 1.5]) {
    assert.throws(() => createFlowDirectPageBreakTransaction(group, session,
        { ...directInput, selectionStart: offset, selectionEnd: offset }), { code: 'FLOW_DIRECT_SELECTION_INVALID' });
    assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, utf16Offset: offset }),
        { code: 'INVALID_FLOW_SPLIT_OFFSET' });
}
assert.throws(() => applyFlowAuthoringOperation([group], { ...baseOperation, languageKey: 'en' }),
    { code: 'FLOW_PAGE_BREAK_SOURCE_LANGUAGE_ONLY' });
assert.throws(() => createFlowDirectPageBreakTransaction(group, { ...session, languageKey: 'en' }, directInput),
    { code: 'FLOW_DIRECT_SESSION_STALE' });
assert.throws(() => createFlowDirectPageBreakTransaction(group, { ...session, expectedText: 'stale' }, directInput),
    { code: 'FLOW_DIRECT_SOURCE_STALE' });
const pageBreakTarget = fixture();
pageBreakTarget.flow.document.sections[0].blocks.push({ id: 'existing-break', type: 'pageBreak' });
assert.throws(() => applyFlowAuthoringOperation([pageBreakTarget], { ...baseOperation, blockId: 'existing-break' }),
    { code: 'FLOW_BLOCK_NOT_TEXT' });
assert.equal(JSON.stringify(group), original, 'Rejected operations must be atomic and leave their input unchanged');

const backup = structuredClone(state);
try {
    Object.assign(state, { ...projectFor(mixedBlocks(group)), activeIdx: 0, activePageIdx: 0,
        activeBlockIdx: 1, activeBubbleIdx: null });
    clearHistory();
    const before = structuredClone(state.blocks);
    pushState();
    state.blocks = applyFlowAuthoringOperation(state.blocks, baseOperation);
    const after = structuredClone(state.blocks);
    assert.equal(getHistoryInfo().undoCount, 1, 'A page break must use one project history transaction');
    assert.equal(undo(() => {}), true);
    assert.deepEqual(state.blocks, before, 'One Undo must restore text, translation metadata, and both removed IDs');
    assert.equal(redo(() => {}), true);
    assert.deepEqual(state.blocks, after, 'One Redo must restore the same PageBreak and trailing source IDs');
} finally {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, backup);
    clearHistory();
}

console.log('Flow direct page break verification passed.');
