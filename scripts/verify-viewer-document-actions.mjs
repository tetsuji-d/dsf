import assert from 'node:assert/strict';
import {readerPageText,searchReaderPages} from '../js/viewer-document-actions.js';
const pages=[{label:'1',text:readerPageText({deliveryV2:{lines:[{runs:[{text:'最初のページ'}]}]}},'メモです')},{label:'2',text:readerPageText({deliveryV2:{lines:[{runs:[{text:'ＡＢＣ の検索'}]}]}})},{label:'3',text:readerPageText({deliveryV2:{renderKind:'image'}})}];
assert.deepEqual(searchReaderPages(pages,'abc').map(r=>r.index),[1]);
assert.deepEqual(searchReaderPages(pages,'メモ').map(r=>r.index),[0]);
assert.equal(searchReaderPages(pages,'不存在').length,0);
assert.equal(searchReaderPages(pages,'  ').length,0);
assert.equal(pages[2].text,'');
console.log('All-page search: offscreen match, typed Writing, NFKC/case, empty and image-only passed.');
