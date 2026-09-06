import assert from 'node:assert/strict';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { createFlowDirectEditSession, createFlowDirectTextSplitTransaction } from '../js/flow-direct-edit.js';
import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
const group = createFlowGroupBlock({ id: 'group', sourceLanguage: 'ja', document: { id: 'doc', sourceLanguage: 'ja', sections: [{ id: 'section', title: {}, blocks: [{ id: 'head', type: 'heading', level: 3, texts: { ja: '前半👩‍💻後半', en: 'Translated heading' }, extension: { keep: true } }] }] } });
for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const session = createFlowDirectEditSession(group, { pageLanguageKey: 'ja', writingMode, sourcePoint: { sectionId: 'section', blockId: 'head', languageKey: 'ja', utf16Offset: 2 } });
    const before = JSON.stringify(group);
    const split = createFlowDirectTextSplitTransaction(group, session, { selectionStart: 2, selectionEnd: 7, newBlockId: 'tail' });
    const blocks = applyFlowAuthoringOperation([group], split.operation);
    const [head, tail] = blocks[0].flow.document.sections[0].blocks;
    assert.equal(head.texts.ja, '前半');
    assert.equal(head.texts.en, 'Translated heading');
    assert.deepEqual(head.extension, { keep: true });
    assert.equal(tail.type, 'heading'); assert.equal(tail.level, 3); assert.equal(tail.texts.ja, '後半');
    assert.equal(tail.texts.en, undefined);
    assert.equal(split.nextSession.blockId, tail.id); assert.equal(split.nextSession.expectedText, tail.texts.ja);
    assert.equal(JSON.stringify(group), before);
    assert.throws(() => createFlowDirectTextSplitTransaction(group, session, { selectionStart: 3, selectionEnd: 7, newBlockId: 'tail' }));
    assert.throws(() => applyFlowAuthoringOperation([group], { ...split.operation, newBlockId: 'head' }));
    assert.throws(() => applyFlowAuthoringOperation([group], { ...split.operation, languageKey: 'en' }));
    const end = createFlowDirectTextSplitTransaction(group, session, { selectionStart: session.expectedText.length, selectionEnd: session.expectedText.length, newBlockId: 'tail' });
    assert.equal(applyFlowAuthoringOperation([group], end.operation)[0].flow.document.sections[0].blocks[1].type, 'paragraph');
}
console.log('Flow text split: vertical/horizontal selected Enter, heading level, translations, grapheme and identity preservation passed.');
