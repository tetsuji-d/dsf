import assert from 'node:assert/strict';
import { createFlowTextSelection, validateFlowTextSelection } from '../js/flow-text-selection.js';
const group = { id: 'g', kind: 'flow', flow: { document: { sourceLanguage: 'ja', sections: [
    { id: 's', blocks: [{ id: 'h', type: 'heading', texts: { ja: '見出し' } },
        { id: 'a', type: 'paragraph', texts: { ja: '本文👨‍👩‍👧‍👦です\n次の行' } },
        { id: 'break', type: 'pageBreak' }] },
    { id: 's2', blocks: [{ id: 'b', type: 'paragraph', texts: { ja: '後半です' } }] },
] } } };
const p = (blockId, utf16Offset, sectionId = 's') => ({ sectionId, blockId, utf16Offset, languageKey: 'ja', affinity: 'forward' });
const before = JSON.stringify(group);
const forward = createFlowTextSelection(group, p('h', 1), p('b', 2, 's2'));
assert.equal(forward.text, '出し\n本文👨‍👩‍👧‍👦です\n次の行\n\n後半');
const backward = createFlowTextSelection(group, p('b', 2, 's2'), p('h', 1));
assert.equal(backward.text, forward.text);
assert.equal(backward.backward, true);
assert.equal(forward.ranges.length, 3);
assert.equal(createFlowTextSelection(group, p('a', 3), p('b', 1, 's2')), null, 'cannot split emoji');
assert.equal(createFlowTextSelection(group, p('missing', 0), p('b', 1, 's2')), null);
assert.equal(createFlowTextSelection(group, { ...p('h', 0), languageKey: 'en' }, p('h', 1)), null);
assert.equal(createFlowTextSelection(group, p('h', 2), p('h', 2)).collapsed, true);
assert.equal(createFlowTextSelection(group, p('h', 0), p('h', 3)).text, '見出し');
assert.equal(validateFlowTextSelection({ ...group, layout: { fontSize: 30 } }, forward), forward);
const changed = structuredClone(group); changed.flow.document.sections[0].blocks[1].texts.ja += '追加';
assert.equal(validateFlowTextSelection(changed, forward), null);
assert.equal(validateFlowTextSelection({ ...group, id: 'other' }, forward), null);
assert.equal(JSON.stringify(group), before, 'selection never mutates authoring state');
console.log('Flow source selection: forward/backward, page breaks, graphemes, stale source and read-only checks passed');
