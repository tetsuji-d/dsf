import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
import { createFlowDirectEditSession, createFlowDirectEditTransaction,
    createFlowDirectBlockFormatTransaction } from '../js/flow-direct-edit.js';

for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const group = createFlowGroupBlock({
        id: 'format-group', sourceLanguage: 'ja',
        document: { id: 'format-document', sourceLanguage: 'ja', sections: [{
            id: 'section', blocks: [{ id: 'paragraph', type: 'paragraph',
                texts: { ja: '雪👩‍💻の朝', en: 'Snowy morning' }, future: { keep: true } }],
        }] },
    });
    const before = JSON.stringify(group);
    const session = createFlowDirectEditSession(group, { pageLanguageKey: 'ja', writingMode,
        sourcePoint: { sectionId: 'section', blockId: 'paragraph', blockType: 'paragraph',
            languageKey: 'ja', utf16Offset: 1, graphemeOffset: 1 } });
    assert.equal(createFlowDirectBlockFormatTransaction(group, session, { blockType: 'paragraph' }), null);
    const transaction = createFlowDirectBlockFormatTransaction(group, session, { blockType: 'heading', level: 3 });
    assert.equal(JSON.stringify(group), before);
    assert.equal(transaction.nextSession.selectionStart, 1);
    assert.equal(transaction.nextSession.expectedText, session.expectedText);
    assert.equal(transaction.nextSession.sourcePoint.blockType, 'heading');
    const converted = applyFlowAuthoringOperation([group], transaction.operation)[0];
    assert.equal(converted.flow.document.sections[0].blocks[0].level, 3);
    assert.deepEqual(converted.flow.document.sections[0].blocks[0].texts, group.flow.document.sections[0].blocks[0].texts);
    assert.deepEqual(converted.flow.document.sections[0].blocks[0].future, { keep: true });
    assert.equal(createFlowDirectBlockFormatTransaction(converted, transaction.nextSession, { blockType: 'heading', level: 3 }), null);
    const input = createFlowDirectEditTransaction(converted, transaction.nextSession, {
        text: '雪の朝', selectionStart: 1, selectionEnd: 1, selectionDirection: 'none',
    });
    assert.equal(input.operation.type, 'setText', 'typing must remain usable after conversion');
    const restored = createFlowDirectBlockFormatTransaction(converted, transaction.nextSession, { blockType: 'paragraph' });
    assert.equal(restored.nextSession.sourcePoint.blockType, 'paragraph');
    assert.equal(restored.nextSession.selectionStart, session.selectionStart);
    for (const bad of [{blockType:'pageBreak'}, {blockType:'heading',level:0},
        {blockType:'heading',level:7}, {blockType:'paragraph',level:2}]) {
        assert.throws(() => createFlowDirectBlockFormatTransaction(group, session, bad), { code: 'FLOW_DIRECT_FORMAT_INVALID' });
    }
    assert.throws(() => createFlowDirectBlockFormatTransaction(converted, session, {blockType:'heading'}),
        { code: 'FLOW_DIRECT_SESSION_STALE' });
    assert.throws(() => createFlowDirectBlockFormatTransaction(group, {...session, expectedText:'stale'}, {blockType:'heading'}),
        { code: 'FLOW_DIRECT_SOURCE_STALE' });
    assert.throws(() => createFlowDirectBlockFormatTransaction(group, {...session, languageKey:'en'}, {blockType:'heading'}),
        { code: 'FLOW_DIRECT_SESSION_STALE' });
}
const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(app, /function handleFlowDirectFormatChange\(event\)/);
assert.match(app, /createFlowDirectBlockFormatTransaction\(getFlowGroupById/);
assert.match(app, /select\.disabled = disabled/);
assert.match(app, /!proxy\?\.isConnected \|\| !session \|\| getActiveBlock\(\)\?\.id !== session\.groupId/);
assert.match(app, /getFlowAuthoringLanguage\(getFlowGroupById\(session\.groupId\)\) !== session\.languageKey/);
assert.match(app, /_flowDirectCompositionRange = Object\.freeze\(\{\s*start: event\.target\.selectionStart/);
assert.match(app, /alignFlowDirectCompositionElement\(\{/);
assert.match(app, /_flowDirectCompositionRange\?\.start/);
console.log('Flow direct format verification passed.');
