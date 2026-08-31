import assert from 'node:assert/strict';
import {
    clearHistory, createHistorySnapshot, endHistoryGroup, getHistoryInfo,
    pushState, redo, undo,
} from '../js/history.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { deserializeProject, serializeProject } from '../js/project-persistence.js';
import { state } from '../js/state.js';

const clone = (value) => structuredClone(value);
const runtimeMarker = 'history-editor-focus-runtime-only';
function focus(blockId, offset) {
    return {
        mode: 'direct', groupId: 'history-focus-group', sectionId: 'history-focus-section',
        blockId, languageKey: 'ja', selectionStart: offset, selectionEnd: offset,
        selectionDirection: 'none', affinity: 'forward',
        futureFocusMetadata: { marker: runtimeMarker, coordinates: [offset, 0] },
    };
}
function blocks(afterBreak = false) {
    return [createFlowGroupBlock({
        id: 'history-focus-group', sourceLanguage: 'ja',
        document: {
            id: 'history-focus-document', sourceLanguage: 'ja',
            sections: [{ id: 'history-focus-section', title: { ja: '履歴検証' }, blocks: afterBreak
                ? [{ id: 'original', type: 'paragraph', texts: { ja: '冬の' } },
                    { id: 'manual-break', type: 'pageBreak' },
                    { id: 'tail', type: 'paragraph', texts: { ja: '金沢' } }]
                : [{ id: 'original', type: 'paragraph', texts: { ja: '冬の金沢' } }],
            }],
        },
    })];
}
function setFixture(afterBreak = false) {
    Object.assign(state, {
        version: 6, blocks: blocks(afterBreak), sections: [], pages: [],
        activeIdx: 0, activePageIdx: 0, activeBlockIdx: 0, activeBubbleIdx: null,
        languages: ['ja'], defaultLang: 'ja', activeLang: 'ja',
    });
}
function assertFocusNotPersisted() {
    assert.equal(Object.hasOwn(state, 'editorFocus'), false, 'restoring history must never add focus to state');
    const serialized = serializeProject(state);
    assert.equal(serialized.includes('editorFocus'), false);
    assert.equal(serialized.includes(runtimeMarker), false, 'runtime focus metadata must never enter DSP JSON');
    const restored = deserializeProject(serialized);
    assert.equal(Object.hasOwn(restored, 'editorFocus'), false);
    assert.deepEqual(restored.blocks, state.blocks, 'semantic source still round-trips independently of focus');
}

const stateBackup = clone(state);
try {
    setFixture();
    clearHistory();
    const beforeFocus = focus('original', 2);
    const beforeExpected = clone(beforeFocus);
    const beforeBlocks = clone(state.blocks);
    const snapshot = createHistorySnapshot(state, { editorFocus: beforeFocus });
    assert.deepEqual(snapshot.editorFocus, beforeExpected);
    assert.notEqual(snapshot.editorFocus, beforeFocus);
    assert.notEqual(snapshot.editorFocus.futureFocusMetadata, beforeFocus.futureFocusMetadata);
    beforeFocus.futureFocusMetadata.coordinates[0] = 999;
    assert.deepEqual(snapshot.editorFocus, beforeExpected, 'snapshot must deep-clone caller focus');
    snapshot.editorFocus.futureFocusMetadata.coordinates[1] = 999;
    assert.equal(beforeFocus.futureFocusMetadata.coordinates[1], 0, 'snapshot mutation must not leak to caller focus');
    snapshot.blocks[0].flow.document.sections[0].blocks[0].texts.ja = 'snapshot only';
    assert.deepEqual(state.blocks, beforeBlocks, 'focus support must preserve existing source snapshot isolation');
    assert.equal(Object.hasOwn(createHistorySnapshot(state), 'editorFocus'), false);
    assert.equal(Object.hasOwn(createHistorySnapshot(state, { editorFocus: undefined }), 'editorFocus'), false);
    assert.equal(Object.hasOwn(createHistorySnapshot({ ...state, editorFocus: beforeExpected }), 'editorFocus'), false,
        'focus is explicit snapshot metadata, never copied from project state');

    // A structural operation changes the current ID from original to tail.
    // Undo and Redo must carry the respective focus with their own data snapshots.
    const pushedFocus = clone(beforeExpected);
    assert.equal(pushState({ editorFocus: pushedFocus }), true);
    pushedFocus.blockId = 'caller-mutated';
    pushedFocus.futureFocusMetadata.coordinates[0] = 777;
    setFixture(true);
    const afterBlocks = clone(state.blocks);
    const afterFocus = focus('tail', 0);
    const afterExpected = clone(afterFocus);
    let restoredFocus;
    assert.equal(undo((value) => { restoredFocus = value; }, { editorFocus: afterFocus }), true);
    assert.deepEqual(restoredFocus, beforeExpected);
    assert.deepEqual(state.blocks, beforeBlocks);
    assert.equal(state.blocks[0].flow.document.sections[0].blocks.some((block) => block.id === 'tail'), false);
    assert.equal(restoredFocus.blockId, 'original', 'Undo must not try to focus the removed tail ID');
    assert.equal(getHistoryInfo().redoCount, 1);
    assertFocusNotPersisted();

    afterFocus.selectionStart = 999;
    afterFocus.futureFocusMetadata.coordinates[0] = 999;
    const currentBeforeFocus = clone(restoredFocus);
    assert.equal(redo((value) => { restoredFocus = value; }, { editorFocus: currentBeforeFocus }), true);
    assert.deepEqual(restoredFocus, afterExpected, 'Redo focus must be isolated from mutation after Undo');
    assert.deepEqual(state.blocks, afterBlocks);
    assert.equal(restoredFocus.blockId, 'tail');
    currentBeforeFocus.futureFocusMetadata.coordinates[0] = 888;
    assertFocusNotPersisted();

    assert.equal(undo((value) => { restoredFocus = value; }, { editorFocus: afterExpected }), true);
    assert.deepEqual(restoredFocus, beforeExpected, 'Redo must deep-clone the inverse Undo focus too');
    assert.deepEqual(state.blocks, beforeBlocks);
    assert.equal(redo((value) => { restoredFocus = value; }, { editorFocus: beforeExpected }), true);
    assert.deepEqual(restoredFocus, afterExpected);
    assert.deepEqual(state.blocks, afterBlocks);
    assertFocusNotPersisted();

    // A grouped typing burst retains the first source snapshot AND first focus.
    clearHistory();
    setFixture();
    const initialFocus = focus('original', 0);
    const initialExpected = clone(initialFocus);
    assert.equal(pushState({ groupKey: 'flow:typing', now: 1000, mergeWindowMs: 900, editorFocus: initialFocus }), true);
    initialFocus.selectionStart = 200;
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = '一';
    assert.equal(pushState({ groupKey: 'flow:typing', now: 1500, mergeWindowMs: 900, editorFocus: focus('original', 1) }), false);
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = '一二';
    assert.equal(getHistoryInfo().undoCount, 1);
    assert.equal(undo((value) => { restoredFocus = value; }, { editorFocus: focus('original', 2) }), true);
    assert.deepEqual(restoredFocus, initialExpected, 'merged typing must not replace the initial focus');
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, '冬の金沢');
    assert.equal(redo((value) => { restoredFocus = value; }, { editorFocus: initialExpected }), true);
    assert.deepEqual(restoredFocus, focus('original', 2));
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, '一二');
    endHistoryGroup();
    assert.equal(pushState({ groupKey: 'flow:typing', now: 1600, editorFocus: focus('original', 2) }), true,
        'an explicit group end must start a new source/focus snapshot');
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = '一二三';
    assert.equal(getHistoryInfo().undoCount, 2);
    assert.equal(undo((value) => { restoredFocus = value; }, { editorFocus: focus('original', 3) }), true);
    assert.deepEqual(restoredFocus, focus('original', 2));
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, '一二');
    assertFocusNotPersisted();

    // Old callers keep their existing behavior: no property and undefined focus.
    clearHistory();
    setFixture();
    assert.equal(pushState(), true);
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = 'legacy edit';
    let legacyCalls = 0;
    assert.equal(undo((value) => { legacyCalls += 1; assert.equal(value, undefined); }), true);
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, '冬の金沢');
    assert.equal(redo((value) => { legacyCalls += 1; assert.equal(value, undefined); }), true);
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, 'legacy edit');
    assert.equal(legacyCalls, 2);
    assertFocusNotPersisted();

    // A new legacy action must not inherit optional focus or keep the redo branch.
    assert.equal(undo(() => {}, { editorFocus: focus('original', 2) }), true);
    assert.equal(getHistoryInfo().canRedo, true);
    pushState();
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = 'new branch';
    assert.equal(getHistoryInfo().canRedo, false);
    assert.equal(undo((value) => { assert.equal(value, undefined); }), true);
    clearHistory();
    let emptyCalls = 0;
    assert.equal(undo(() => { emptyCalls += 1; }, { editorFocus: beforeExpected }), false);
    assert.equal(redo(() => { emptyCalls += 1; }, { editorFocus: afterExpected }), false);
    assert.equal(emptyCalls, 0, 'empty history must not restore any focus');
    assertFocusNotPersisted();
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBackup);
}

console.log('History editor focus verification passed.');
