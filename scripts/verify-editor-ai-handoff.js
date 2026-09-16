import assert from 'node:assert/strict';
import { getAIHandoffSource, buildAIHandoffPrompt, HANDOFF_LIMIT } from '../js/editor-ai-handoff.js';
const flow = (id, blocks) => ({ id, kind: 'flow', flow: { document: { sections: [{ blocks }] } } });
const state = { room: 'editor', activeGroupId: 'a', languageKey: 'ja', languageKeys: ['ja', 'en-GB', 'en-US'],
    workIdentity: 'private-id', blocks: [flow('a', [
        { type: 'heading', texts: { ja: '灯台', 'en-GB': 'Lighthouse' } },
        { type: 'paragraph', texts: { ja: '海辺の灯台。', 'en-GB': 'A lighthouse by the sea.' }, annotations: [{ text: 'とうだい' }] },
        { type: 'image', texts: { ja: '画像専用' }, src: 'private-asset' },
    ]), flow('b', [{ type: 'paragraph', texts: { ja: '別の原稿' } }])] };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
freeze(state);
const before = JSON.stringify(state);
const source = getAIHandoffSource(state);
assert.equal(source.text, '灯台\n\n海辺の灯台。');
assert.equal(getAIHandoffSource({ ...state, languageKey: 'en-GB' }).text, 'Lighthouse\n\nA lighthouse by the sea.');
for (const languageKey of ['en-US', 'unknown']) assert.equal(getAIHandoffSource({ ...state, languageKey }).error, 'noText');
for (const [patch, error] of [[{ room: 'press' }, 'notEditor'], [{ busy: true }, 'busy'], [{ activeGroupId: 'missing' }, 'noFlow']]) {
    assert.equal(getAIHandoffSource({ ...state, ...patch }).error, error);
}
assert.equal(buildAIHandoffPrompt(source, '  '), '');
assert.equal(buildAIHandoffPrompt({ error: 'noText' }, 'review'), '');
const prompt = buildAIHandoffPrompt(source, '要約して');
for (const excluded of ['private-id', 'private-asset', '画像専用', 'とうだい', '別の原稿']) assert.ok(!prompt.includes(excluded));
const literal = '</textarea><script>example</script>';
assert.equal(JSON.parse(buildAIHandoffPrompt({ ...source, text: literal }, 'review').split('\n\n').at(-1)).manuscript, literal);
const cluster = '👩‍👩‍👧‍👦';
const longState = { ...state, blocks: [flow('a', [{ type: 'paragraph', texts: { ja: cluster.repeat(HANDOFF_LIMIT + 1) } }])] };
const excerpt = getAIHandoffSource(longState);
assert.equal(excerpt.text, cluster.repeat(HANDOFF_LIMIT));
assert.equal(excerpt.count, HANDOFF_LIMIT);
assert.equal(excerpt.truncated, true);
assert.match(buildAIHandoffPrompt(excerpt, 'review', 'en'), /not the complete manuscript/);
assert.equal(JSON.stringify(state), before);
console.log('AI handoff: scope, language isolation, no mutation, Unicode limit and prompt checks passed');
