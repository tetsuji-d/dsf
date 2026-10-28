import assert from 'node:assert/strict';
import { editableReadValues, compareEditableReads, editableReadRow, HOME_PROJECT_SORTS } from '../js/home-project-list.js';

const projects = [
    { id: 'b', projectName: '原稿10', title: '題名2', updatedAt: { seconds: 20 } },
    { id: 'a', projectName: '原稿2', meta: { ja: { title: '題名10' } }, lastUpdated: { toMillis: () => 10_000 } },
    { id: 'c', projectName: '名前だけ', updatedAt: 'invalid' },
];
const values = projects.map(p => editableReadValues(p));
assert.equal(values[2].title, '', 'management name must not replace a missing Read title');
assert.equal(values[2].updated, 0);
const expected = [['b','a','c'],['a','b','c'],['a','b','c'],['c','b','a'],['b','a','c'],['a','b','c']];
HOME_PROJECT_SORTS.forEach((sort,index) => assert.deepEqual([...values].sort((a,b)=>compareEditableReads(a,b,sort)).map(v=>v.id),expected[index],sort));
assert.equal(editableReadValues({title:'タイトルだけ'}).name,'');
assert.equal(editableReadValues({updatedAt:'2026-10-24T12:00:00Z'}).updated,Date.parse('2026-10-24T12:00:00Z'));
assert.equal(editableReadValues({meta:{ja:{title:'日本語'},en:{title:'English'}}},'en').title,'English');
assert.deepEqual(values.map(v=>v.id),['b','a','c']);
const markup=editableReadRow({id:'one',projectName:'<script>',title:'" & title'});
assert.ok(markup.includes('&lt;script&gt;') && markup.includes('&quot; &amp; title'));
console.log('Editable Read names, multilingual titles, timestamps, natural sorting, missing values and escaped rows passed.');
