import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createSectionFromPageBlock } from '../js/blocks.js';
import {
    moveFixedPageRangeInSpine,
    removeFixedPageRangeFromSpine,
} from '../js/fixed-page-spine.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { clearHistory, getHistoryInfo, pushState, redo, undo } from '../js/history.js';
import {
    deserializeProject,
    prepareProjectForSave,
    serializeProject,
} from '../js/project-persistence.js';
import { state } from '../js/state.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function fixedPage(id, pageKind, extensions = {}) {
    return {
        id,
        kind: 'page',
        futureBlock: { id, keep: true },
        content: {
            pageKind,
            text: pageKind === 'text' ? `本文:${id}` : '',
            texts: pageKind === 'text' ? { ja: `本文:${id}` } : {},
            backgrounds: pageKind === 'image' ? { ja: `asset:${id}` } : {},
            layers: [{ id: `layer:${id}`, type: 'shape', futureLayer: { keep: true } }],
            futureContent: { id, keep: true },
            ...extensions,
        },
    };
}

function flowGroup(id) {
    return createFlowGroupBlock({
        id,
        sourceLanguage: 'ja',
        idFactory: (prefix) => `${id}_${prefix}`,
        extensions: { futureFlowBlock: { id, keep: true } },
        flowExtensions: { futureFlowPayload: { id, keep: true } },
        document: {
            sourceLanguage: 'ja',
            sections: [{
                id: `${id}_section`,
                title: { ja: `見出し:${id}` },
                blocks: [{ id: `${id}_paragraph`, type: 'paragraph', texts: { ja: `本文:${id}` } }],
            }],
        },
    });
}

const imageA = fixedPage('image_a', 'image');
const textA = fixedPage('text_a', 'text');
const flowA = flowGroup('flow_a');
const flowB = flowGroup('flow_b');
const spreadLeft = fixedPage('spread_left', 'image', {
    spreadImage: { groupId: 'spread_pair', role: 'left' },
});
const spreadRight = fixedPage('spread_right', 'image', {
    spreadImage: { groupId: 'spread_pair', role: 'right' },
});
const imageB = fixedPage('image_b', 'image');
const fixture = [imageA, flowA, textA, flowB, spreadLeft, spreadRight, imageB];

const fixtureBefore = clone(fixture);
const singleMove = moveFixedPageRangeInSpine(fixture, {
    sourcePageIndex: 1,
    targetPageIndex: 4,
    position: 'after',
});
assert.equal(singleMove.changed, true);
assert.deepEqual(singleMove.blocks.map((block) => block.id), [
    'image_a', 'flow_a', 'flow_b', 'spread_left', 'spread_right', 'image_b', 'text_a',
]);
assert.equal(singleMove.blocks.at(-1), textA, 'A moved Fixed page must retain its opaque object and extensions');
assert.equal(singleMove.blocks.at(-1).content.layers, textA.content.layers);
assert.equal(singleMove.blocks.at(-1).content.futureContent, textA.content.futureContent);
assert.equal(singleMove.blocks[1], flowA, 'Flow blocks must remain exact opaque objects');
assert.equal(singleMove.blocks[2], flowB, 'Flow blocks must retain their relative order');
assert.deepEqual(flowA, fixtureBefore[1]);
assert.deepEqual(flowB, fixtureBefore[3]);
assert.deepEqual(fixture, fixtureBefore, 'Moving a Fixed page must not mutate the input spine');
assert.equal(singleMove.activeBlockIndex, 6);
assert.equal(singleMove.activePageIndex, 4);

const pairMove = moveFixedPageRangeInSpine(fixture, {
    sourcePageIndex: 2,
    targetPageIndex: 0,
    position: 'before',
});
assert.equal(pairMove.changed, true);
assert.deepEqual(pairMove.blocks.map((block) => block.id), [
    'spread_left', 'spread_right', 'image_a', 'flow_a', 'text_a', 'flow_b', 'image_b',
]);
assert.equal(pairMove.blocks[0], spreadLeft);
assert.equal(pairMove.blocks[1], spreadRight);
assert.deepEqual(pairMove.blocks.slice(0, 2).map((block) => block.content.spreadImage), [
    { groupId: 'spread_pair', role: 'left' },
    { groupId: 'spread_pair', role: 'right' },
]);
assert.deepEqual(fixture, fixtureBefore, 'Moving a spread pair must not mutate the input spine');

const brokenPair = [imageA, fixedPage('broken_left', 'image', {
    spreadImage: { groupId: 'broken_pair', role: 'left' },
}), imageB];
const brokenResult = moveFixedPageRangeInSpine(brokenPair, {
    sourcePageIndex: 1,
    targetPageIndex: 0,
    position: 'before',
});
assert.equal(brokenResult.changed, false);
assert.equal(brokenResult.reason, 'invalid_spread_pair');
assert.equal(brokenResult.blocks, brokenPair);

const nonContiguousPair = [
    fixedPage('far_left', 'image', { spreadImage: { groupId: 'far_pair', role: 'left' } }),
    flowA,
    fixedPage('far_right', 'image', { spreadImage: { groupId: 'far_pair', role: 'right' } }),
    imageB,
];
const nonContiguousResult = moveFixedPageRangeInSpine(nonContiguousPair, {
    sourcePageIndex: 0,
    targetPageIndex: 2,
    position: 'after',
});
assert.equal(nonContiguousResult.changed, false);
assert.equal(nonContiguousResult.reason, 'non_contiguous_spread_pair');
assert.equal(nonContiguousResult.blocks, nonContiguousPair);

const fixtureBeforeRemoval = clone(fixture);
const pairRemoval = removeFixedPageRangeFromSpine(fixture, {
    sourcePageIndex: 2,
    minimumRemainingPages: 1,
});
assert.equal(pairRemoval.changed, true);
assert.deepEqual(pairRemoval.blocks.map((block) => block.id), [
    'image_a', 'flow_a', 'text_a', 'flow_b', 'image_b',
]);
assert.equal(pairRemoval.blocks[1], flowA);
assert.equal(pairRemoval.blocks[3], flowB);
assert.deepEqual(fixture, fixtureBeforeRemoval, 'Removing a spread pair must not mutate the input spine');

const minimumRejected = removeFixedPageRangeFromSpine(fixture, {
    sourcePageIndex: 2,
    minimumRemainingPages: 4,
});
assert.equal(minimumRejected.changed, false);
assert.equal(minimumRejected.reason, 'minimum_fixed_pages');
assert.equal(minimumRejected.blocks, fixture);

const singleRemoval = removeFixedPageRangeFromSpine(fixture, {
    sourcePageIndex: 1,
    minimumRemainingPages: 1,
});
assert.equal(singleRemoval.changed, true);
assert.deepEqual(singleRemoval.blocks.map((block) => block.id), [
    'image_a', 'flow_a', 'flow_b', 'spread_left', 'spread_right', 'image_b',
]);
assert.equal(singleRemoval.blocks[0], imageA);
assert.equal(singleRemoval.blocks[1], flowA);
assert.equal(singleRemoval.blocks.at(-1), imageB);

const movedSections = singleMove.blocks
    .filter((block) => block.kind === 'page')
    .map(createSectionFromPageBlock);
const saved = prepareProjectForSave({
    version: 6,
    projectId: 'fixed_page_spine_roundtrip',
    languages: ['ja'],
    defaultLang: 'ja',
    blocks: singleMove.blocks,
    sections: movedSections,
});
const roundTripped = deserializeProject(serializeProject(saved));
assert.deepEqual(roundTripped.blocks.map((block) => block.id), singleMove.blocks.map((block) => block.id));
assert.deepEqual(roundTripped.blocks.filter((block) => block.kind === 'flow'), [flowA, flowB]);
assert.equal(roundTripped.blocks.at(-1).content.layers[0].futureLayer.keep, true);
assert.equal(roundTripped.blocks.at(-1).futureBlock.keep, true);

const stateBackup = structuredClone(state);
try {
    Object.assign(state, {
        version: 6,
        blocks: fixture,
        sections: fixture.filter((block) => block.kind === 'page').map(createSectionFromPageBlock),
        pages: [],
        activeBlockIdx: 2,
        activeIdx: 1,
        activePageIdx: 1,
        activeBubbleIdx: null,
    });
    clearHistory();
    pushState();
    const historyMove = moveFixedPageRangeInSpine(state.blocks, {
        sourcePageIndex: 1,
        targetPageIndex: 4,
        position: 'after',
    });
    state.blocks = historyMove.blocks;
    state.sections = historyMove.blocks
        .filter((block) => block.kind === 'page')
        .map(createSectionFromPageBlock);
    state.activeBlockIdx = historyMove.activeBlockIndex;
    state.activeIdx = historyMove.activePageIndex;
    state.activePageIdx = historyMove.activePageIndex;
    const movedSnapshot = structuredClone(state);
    assert.equal(getHistoryInfo().undoCount, 1);
    assert.equal(undo(() => {}), true);
    assert.deepEqual(state.blocks.map((block) => block.id), fixture.map((block) => block.id));
    assert.equal(redo(() => {}), true);
    assert.deepEqual(state.blocks.map((block) => block.id), movedSnapshot.blocks.map((block) => block.id));
    assert.equal(state.activeBlockIdx, movedSnapshot.activeBlockIdx);
    assert.equal(state.activeIdx, movedSnapshot.activeIdx);
} finally {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBackup);
    clearHistory();
}

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const sectionsSource = readFileSync(new URL('../js/sections.js', import.meta.url), 'utf8');
assert.match(appSource, /moveFixedPageRangeInSpine\(state\.blocks \|\| \[\]/,
    'Project v6 thumbnail drops must use the canonical mixed-spine operation');
assert.match(appSource, /if \(state\.version === 6\) return false;/,
    'The legacy flat-Section insertion path must reject Project v6');
assert.match(appSource, /if \(!canDeleteActive\(\)\) return;/,
    'Rejected deletes must not create an empty History entry or autosave');
assert.match(sectionsSource, /const canDragV6FixedPage = isDesktop && !spreadGroupId;/,
    'Only ordinary persisted Fixed pages may opt into Project v6 desktop DnD');
assert.match(sectionsSource, /draggable="false"/,
    'Flow and unsupported thumbnail cards must remain non-draggable');

console.log('Fixed page mixed-spine verification passed.');
