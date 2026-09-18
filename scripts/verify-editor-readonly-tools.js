import assert from 'node:assert/strict';
import { withEditorToolRecovery, editorToolErrorMessage } from '../js/editor-tool-errors.js';
import { createEditorReadonlyTools } from '../js/editor-readonly-tools.js';
import { createFlowTextSelection } from '../js/flow-text-selection.js';

const paragraph = (id, texts) => ({ id, type: 'paragraph', texts,
    annotations: [{ type: 'ruby', start: 0, end: 1, text: 'うみ' }] });
const group = (id, blocks, sourceLanguage = 'ja') => ({ id, kind: 'flow', flow: {
    document: { sourceLanguage, sections: [{ id: 's', blocks }] },
} });
const blocks = [group('a', [paragraph('p', { ja: '海。海。👩‍👩‍👧‍👦 é [.*]', 'en-GB': 'Sea sea.' }),
    paragraph('long', { ja: '文'.repeat(200) + '探す' + '👩‍👩‍👧‍👦'.repeat(180) }),
    { id: 'image', type: 'image', texts: { ja: '画像専用' } }]),
    group('b', [paragraph('p', { ja: '海。'.repeat(30) })]),
    { id: 'fixed', kind: 'image', content: { text: '対象外' } }];
const point = offset => ({ sectionId: 's', blockId: 'p', languageKey: 'ja', utf16Offset: offset });
const selection = createFlowTextSelection(blocks[0], point(0), point(2));
let state = { room: 'editor', workIdentity: 'private-cloud-identifier',
    projectName: 'private-title', account: 'private-account', blocks,
    languageKeys: ['ja', 'en-GB', 'en-US'], languageKey: 'ja', sourceLanguage: 'ja',
    activeGroupId: 'a', selection, busy: false, history: [{ private: 'history' }] };
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
}
freeze(state);
const before = JSON.stringify(state);
let serial = 0;
const service = createEditorReadonlyTools({ readState: () => state, createToken: () => `session-${++serial}` });
const context = (args = {}) => service.execute('dsf_get_editor_context', args);
const code = (result, expected) => assert.equal(result.error?.code, expected);
code(context(), 'DISABLED');
assert.deepEqual(service.enable(), { enabled: true });
const initial = context();
assert.deepEqual(initial.target, { kind: 'flow', groupId: 'a' });
assert.deepEqual(initial.selection, { groupId: 'a', languageKey: 'ja', ranges: [
    { sectionId: 's', blockId: 'p', start: 0, end: 2 },
] });
const base = { workToken: initial.workToken, query: '海', languageKey: 'ja', scope: 'currentFlow' };
const search = overrides => service.execute('dsf_search_flow_text', { ...base, ...overrides });
assert.equal(search().matches.length, 2);
assert.equal(search({ scope: 'work', limit: 20 }).matches.length, 20);
assert.equal(search({ scope: 'work', limit: 20 }).truncated, true);
assert.equal(search({ limit: 2 }).truncated, false);
assert.equal(search({ limit: 1 }).truncated, true);
assert.equal(search({ languageKey: 'en-GB' }).matches.length, 0);
assert.equal(search({ languageKey: 'en-GB', query: 'sea' }).matches.length, 2);
assert.equal(search({ languageKey: 'en-GB', query: 'sea', caseSensitive: true }).matches.length, 1);
assert.equal(search({ languageKey: 'en-US', scope: 'work' }).matches.length, 0);
assert.equal(search({ query: '画像専用' }).matches.length, 0);
for (const query of ['👩', 'e']) assert.equal(search({ query }).matches.length, 0);
for (const query of ['👩‍👩‍👧‍👦', 'é', '[.*]']) assert.ok(search({ query }).matches.length);
const long = search({ query: '探す' }).matches[0];
assert.equal(long.start, 200);
assert.equal(long.end, 202);
assert.ok(long.excerpt.includes('探す'));
assert.equal([...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(long.excerpt)].length, 160);
assert.equal(long.excerpt, blocks[0].flow.document.sections[0].blocks[1].texts.ja.slice(long.excerptStart, long.excerptEnd));
for (const result of [initial, search(), { matches: [long] }]) {
    const json = JSON.stringify(result);
    for (const secret of ['expectedText', 'signature', 'private-', 'annotations', 'history']) assert.ok(!json.includes(secret));
}
for (const args of [null, [], 'x', { extra: true }]) code(context(args), 'INVALID_ARGUMENTS');
for (const bad of [{ query: '' }, { query: 'a'.repeat(513) }, { query: 42 }, { scope: 'all' },
    { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: '2' }, { limit: NaN },
    { caseSensitive: 'false' }, { extra: true }, { workToken: null }]) code(search(bad), 'INVALID_ARGUMENTS');
code(search({ languageKey: 'fr' }), 'UNKNOWN_LANGUAGE');
code(search({ workToken: 'old' }), 'STALE_WORK_TOKEN');
code(service.execute('delete_work', {}), 'UNKNOWN_TOOL');
assert.equal(JSON.stringify(state), before, 'context and search must not mutate manuscript, annotations or history');

state = { ...state, busy: true };
assert.equal(context().busy, true);
assert.equal(context().selectionReason, 'busy');
code(search(), 'BUSY');
state = { ...state, busy: false, languageKey: 'en-GB' };
assert.equal(context().selectionReason, 'unverified');
state = { ...state, languageKey: 'ja', blocks: structuredClone(blocks) };
state.blocks[0].flow.document.sections[0].blocks[0].texts.ja += '変化';
assert.equal(context().selectionReason, 'unverified');
state = { ...state, blocks, activeGroupId: 'missing' };
assert.equal(context().target, null);
code(search(), 'NO_CURRENT_FLOW');
assert.equal(search({ scope: 'work' }).matches.length, 10);

// Returned schemas and responses are detached from the private source and future calls.
const tools = service.getTools();
assert.equal(tools.length, 4);
assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
tools[1].inputSchema.properties.limit.maximum = 999;
assert.equal(service.getTools()[1].inputSchema.properties.limit.maximum, 20);
const oldCallback = tools[1].execute;
service.disable();
code(oldCallback(base), 'DISABLED');
service.enable();
code(oldCallback(base), 'STALE_SESSION');
code(tools[0].execute({}), 'STALE_SESSION');
code(search(), 'STALE_WORK_TOKEN');
assert.ok(service.getTools()[0].execute({}).workToken);
state = { ...state, workIdentity: 'another-private-work' };
code(context(), 'WORK_CHANGED');
code(context(), 'DISABLED');
service.enable();
state = { ...state, room: 'press' };
code(context(), 'NOT_IN_EDITOR');
state = { ...state, room: 'editor' };
code(context(), 'DISABLED');

// A non-Japanese original and its Japanese translation stay distinct.
state = { ...state, blocks: [group('english', [paragraph('p', { 'en-GB': 'Original', ja: '翻訳' })], 'en-GB')],
    activeGroupId: 'english', sourceLanguage: 'en-GB', languageKey: 'ja', selection: null };
service.enable();
assert.equal(context().sourceLanguage, 'en-GB');
assert.equal(context().languageKey, 'ja');
assert.equal(search({ workToken: context().workToken, query: 'Original' }).matches.length, 0);
assert.equal(search({ workToken: context().workToken, query: 'Original', languageKey: 'en-GB' }).matches.length, 1);
const broken = createEditorReadonlyTools({ readState: () => { throw Error('private manuscript'); } });
assert.deepEqual(broken.enable(), { error: { code: 'UNAVAILABLE' } });
assert.ok(!JSON.stringify(broken.execute('dsf_get_editor_context', {})).includes('private manuscript'));
console.log('Editor readonly tools: language separation, scope, graphemes, bounded output, immutable source, busy, stale tokens, revoked callbacks and fail-closed reads passed.');

// Cursor listing discovers headings, empty paragraphs and missing translations without a query.
const many = Array.from({ length: 25 }, (_, i) => paragraph(`p${i}`, { ja: `原文${i}`, 'en-GB': `English ${i}` }));
many[0].type = 'heading';
many[1].texts['en-GB'] = '';
delete many[2].texts['en-GB'];
many[3].texts['en-GB'] = '👨‍👩‍👧‍👦'.repeat(90);
state = { ...state, blocks: [group('list', many)], activeGroupId: 'list', languageKey: 'en-GB' };
state.blocks[0].flow.document.sections.push({ id: 's2', blocks: [{ id: 'image', type: 'image' }, paragraph('last', { ja: '末尾' })] });
service.enable();
const listToken = context().workToken;
const list = (extra = {}) => service.execute('dsf_list_flow_paragraphs', { workToken: listToken, ...extra });
const listingBefore = JSON.stringify(state);
const first = list();
assert.equal(first.total, 26);
assert.equal(first.items.length, 20);
assert.equal(first.items[0].type, 'heading');
assert.equal(first.items[1].empty, true);
assert.equal(first.items[1].missingTranslation, false);
assert.equal(first.items[2].missingTranslation, true);
assert.equal(first.items[2].excerpt, '', 'Never substitute source text for a missing translation');
assert.equal(first.items[3].excerpt, '👨‍👩‍👧‍👦'.repeat(80));
assert.equal(first.items[3].textLength, many[3].texts['en-GB'].length);
const second = list({ cursor: first.nextCursor });
assert.equal(second.items.length, 6);
assert.equal(second.items[0].index, 21);
assert.equal(second.items[5].sectionId, 's2');
assert.equal(second.nextCursor, null);
assert.equal(new Set([...first.items, ...second.items].map(x => x.blockId)).size, 26);
code(list({ cursor: first.nextCursor }), 'STALE_CURSOR');
assert.equal(JSON.stringify(state), listingBefore);
const detached = context(); detached.languageKeys.push('fr');
assert.ok(!context().languageKeys.includes('fr'));
for (const bad of [{ cursor: '' }, { cursor: 1 }, { cursor: 'x'.repeat(257) }, { unexpected: true }]) code(list(bad), 'INVALID_ARGUMENTS');
code(list({ workToken: 'old' }), 'STALE_WORK_TOKEN');
const stale = list().nextCursor;
state = structuredClone(state);
state.blocks[0].flow.document.sections[0].blocks[0].texts['en-GB'] += ' changed';
code(list({ cursor: stale }), 'STALE_CURSOR');
const languageCursor = list().nextCursor;
state = { ...state, languageKey: 'ja' };
code(list({ cursor: languageCursor }), 'STALE_CURSOR');
state = { ...state, busy: true }; code(list(), 'BUSY');
state = { ...state, busy: false, activeGroupId: 'missing' }; code(list(), 'NO_CURRENT_FLOW');
state = { ...state, activeGroupId: 'list', languageKey: 'fr' }; code(list(), 'UNKNOWN_LANGUAGE');
service.disable(); code(list(), 'DISABLED');
const success = { changed: true }; assert.equal(withEditorToolRecovery(success), success);
assert.match(withEditorToolRecovery({ error: { code: 'STALE_CURSOR' } }).error.recovery, /without cursor/);
assert.match(editorToolErrorMessage('BUSY', 'ja'), /完了/);
assert.ok(!editorToolErrorMessage('PRIVATE_SOURCE').includes('PRIVATE_SOURCE'));
console.log('Paragraph listing: pagination, empty/missing translation, grapheme bounds, stale cursors, immutable reads and recovery guidance passed.');
